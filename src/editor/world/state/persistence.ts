/**
 * LOADING, SAVING, DRAFTS, IMPORT/EXPORT
 * --------------------------------------
 * - loadAll():   fetch every content file, repair anything odd, fill the Editor.
 * - saveAll():   write changed rooms + world.json, delete removed rooms, tell an open game tab to reload.
 * - drafts:      every few seconds unsaved work is copied to the browser's
 *                localStorage so a crash or closed tab never loses it.
 * - export/import: a single JSON file with the whole world - works even when
 *                the server is read-only.
 */
import { deleteContent, listContent, loadContent, saveContent } from '../../../shared/api';
import { CONTENT, LAYER_NAMES, type RoomData, type WorldData } from '../../../shared/types';
import { rleDecode, rleEncode } from '../logic/rle';
import { findFreeSpot } from '../logic/worldmap';
import {
  repairBackgrounds, repairDecorCatalog, repairRoom, repairTileset, repairWorld, syncRefSizes, type RepairContext,
} from '../logic/validate';
import type { Editor } from './editor';

const DRAFT_KEY = 'worldEditor.draft.v1';

async function tryLoad(path: string): Promise<unknown> {
  try {
    return await loadContent<unknown>(path);
  } catch {
    return undefined; // missing or unreadable -> the repair functions cope with undefined
  }
}

function repairContext(editor: Editor, id: string, extra: Partial<RepairContext> = {}): RepairContext {
  return {
    id,
    tileIds: editor.tileDefs.size > 0 ? new Set(editor.tileDefs.keys()) : null,
    decorKeys: editor.decorDefs.size > 0 ? new Set(editor.decorDefs.keys()) : null,
    backgrounds: editor.backgrounds.map((b) => b.key),
    ...extra,
  };
}

export interface LoadReport {
  /** Human-readable notes about things that were missing or repaired. */
  notices: string[];
  /** False if the server could not be reached at all. */
  online: boolean;
}

export async function loadAll(editor: Editor): Promise<LoadReport> {
  const notices: string[] = [];
  let files: string[] = [];
  let online = true;
  try {
    const list = await listContent();
    files = list.files;
    editor.writable = list.writable;
  } catch {
    online = false;
    editor.writable = false;
    notices.push('Could not reach the content server. You can still draw, and use Export to keep your work.');
  }

  // Catalogs made by the art tools. Missing ones just mean emptier palettes.
  const [rawTileset, rawDecor, rawBackgrounds, rawWorld] = await Promise.all([
    tryLoad(CONTENT.tileset), tryLoad(CONTENT.decor), tryLoad(CONTENT.backgrounds), tryLoad(CONTENT.world),
  ]);
  const tileset = repairTileset(rawTileset);
  if (rawTileset === undefined) notices.push('No tileset found yet (content/tileset.json) - tiles will show as plain colours.');
  else notices.push(...tileset.fixes.map((f) => `Tileset: ${f}`));
  editor.setCatalogs(tileset.value, repairDecorCatalog(rawDecor).decor, repairBackgrounds(rawBackgrounds).backgrounds);

  const world = repairWorld(rawWorld);
  if (rawWorld !== undefined) notices.push(...world.fixes.map((f) => `World: ${f}`));

  // Room files that exist but are not on the map are adopted so nothing is hidden or lost.
  const onDisk = files.filter((f) => /^rooms\/[\w-]+\.json$/.test(f)).map((f) => f.slice(6, -5));
  editor.serverRoomIds = new Set(onDisk);
  const orphans = onDisk.filter((id) => !world.value.rooms.some((r) => r.id === id));

  const rooms = new Map<string, RoomData>();
  const ids = [...world.value.rooms.map((r) => r.id), ...orphans];
  const raws = await Promise.all(ids.map((id) => tryLoad(CONTENT.room(id))));
  ids.forEach((id, i) => {
    const ref = world.value.rooms.find((r) => r.id === id);
    const fixed = repairRoom(raws[i], repairContext(editor, id, { name: ref?.name, width: ref?.w, height: ref?.h }));
    rooms.set(id, fixed.value);
    if (fixed.fixes.length > 0) notices.push(`Room "${fixed.value.name}": ${fixed.fixes.join('; ')}.`);
    if (!ref) {
      const spot = findFreeSpot(world.value.rooms, fixed.value.width, fixed.value.height, 0, 0);
      world.value.rooms.push({ id, name: fixed.value.name, x: spot.x, y: spot.y, w: fixed.value.width, h: fixed.value.height });
      notices.push(`Room "${fixed.value.name}" was not on the world map - added it.`);
    }
  });
  if (!world.value.startRoom && world.value.rooms.length > 0) world.value.startRoom = world.value.rooms[0].id;
  syncRefSizes(world.value, rooms);

  editor.replaceAll(world.value, rooms, [], false);
  return { notices, online };
}

/** Ask the server again whether we may save (after the password was entered). */
export async function refreshWritable(editor: Editor): Promise<boolean> {
  try {
    editor.writable = (await listContent()).writable;
  } catch {
    editor.writable = false;
  }
  editor.events.emit('ui');
  return editor.writable;
}

/** Tell an already-open game tab that content changed so it hot-reloads the room. */
function notifyGame(): void {
  try {
    const channel = new BroadcastChannel('metroidvania');
    channel.postMessage({ type: 'reload' });
    channel.close();
  } catch {
    /* BroadcastChannel not available - the player can simply refresh the game */
  }
}

export async function saveAll(editor: Editor): Promise<{ rooms: number }> {
  if (!editor.writable) throw new Error('read-only');
  const counterAtStart = editor.changeCounter;
  const roomIds = [...editor.dirtyRooms].filter((id) => editor.rooms.has(id));
  const worldWasDirty = editor.worldDirty;
  syncRefSizes(editor.world, editor.rooms);

  // Rooms first, then the world list, then deletions - so world.json never points at a missing file.
  for (const id of roomIds) {
    await saveContent(CONTENT.room(id), editor.rooms.get(id));
    editor.serverRoomIds.add(id);
  }
  // A room that only exists in the editor (never saved) must be written even if "clean".
  for (const id of editor.rooms.keys()) {
    if (!editor.serverRoomIds.has(id)) {
      await saveContent(CONTENT.room(id), editor.rooms.get(id));
      editor.serverRoomIds.add(id);
    }
  }
  const removed = [...editor.serverRoomIds].filter((id) => !editor.rooms.has(id));
  if (worldWasDirty || removed.length > 0) await saveContent(CONTENT.world, editor.world);
  for (const id of removed) {
    await deleteContent(CONTENT.room(id));
    editor.serverRoomIds.delete(id);
  }

  if (editor.changeCounter === counterAtStart) {
    editor.dirtyRooms.clear();
    editor.worldDirty = false;
    clearDraft();
  }
  // (if something changed while we were saving, everything simply stays marked unsaved)
  notifyGame();
  editor.events.emit('ui', 'rooms');
  return { rooms: roomIds.length };
}

/* ------------------------------------------------------------------ */
/* Crash-recovery drafts                                                */
/* ------------------------------------------------------------------ */

interface DraftRoom extends Omit<RoomData, 'layers'> { layers: Record<string, number[]> }
interface Draft {
  savedAt: number;
  world: WorldData;
  worldDirty: boolean;
  rooms: Record<string, DraftRoom>;
}

export function writeDraft(editor: Editor): boolean {
  if (!editor.dirty) { clearDraft(); return true; }
  const draft: Draft = { savedAt: Date.now(), world: editor.world, worldDirty: editor.worldDirty, rooms: {} };
  for (const id of editor.dirtyRooms) {
    const room = editor.rooms.get(id);
    if (!room) continue;
    const layers: Record<string, number[]> = {};
    for (const l of LAYER_NAMES) layers[l] = rleEncode(room.layers[l]); // compressed: localStorage is small
    draft.rooms[id] = { ...room, layers };
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false; // storage full or blocked: nothing we can do, Save/Export still work
  }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

export function readDraft(): { savedAt: number; roomCount: number } | null {
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    if (!text) return null;
    const draft = JSON.parse(text) as Draft;
    if (typeof draft.savedAt !== 'number' || typeof draft.rooms !== 'object' || draft.rooms === null) return null;
    return { savedAt: draft.savedAt, roomCount: Object.keys(draft.rooms).length };
  } catch {
    return null;
  }
}

/** Put the draft's unsaved rooms on top of what was loaded from the server. */
export function restoreDraft(editor: Editor): boolean {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    if (!draft) return false;
    const world = draft.worldDirty ? repairWorld(draft.world).value : editor.world;
    const rooms = new Map(editor.rooms);
    const dirty: string[] = [];
    for (const [id, stored] of Object.entries(draft.rooms)) {
      if (!world.rooms.some((r) => r.id === id)) continue;
      const layers: Record<string, number[]> = {};
      for (const l of LAYER_NAMES) layers[l] = rleDecode(stored.layers?.[l] ?? []);
      rooms.set(id, repairRoom({ ...stored, layers }, repairContext(editor, id)).value);
      dirty.push(id);
    }
    // Rooms the draft's world no longer lists were deleted in the lost session; rooms it lists
    // but we don't have get a blank room rather than a crash.
    for (const id of [...rooms.keys()]) if (!world.rooms.some((r) => r.id === id)) rooms.delete(id);
    for (const ref of world.rooms) {
      if (!rooms.has(ref.id)) rooms.set(ref.id, repairRoom(undefined, repairContext(editor, ref.id, { name: ref.name, width: ref.w, height: ref.h })).value);
    }
    syncRefSizes(world, rooms);
    editor.replaceAll(world, rooms, dirty, draft.worldDirty);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Export / import                                                      */
/* ------------------------------------------------------------------ */

interface ExportBundle {
  type: 'metroidvania-world-export';
  version: 1;
  world: WorldData;
  rooms: Record<string, RoomData>;
}

export function exportBundle(editor: Editor): string {
  syncRefSizes(editor.world, editor.rooms);
  const bundle: ExportBundle = { type: 'metroidvania-world-export', version: 1, world: editor.world, rooms: Object.fromEntries(editor.rooms) };
  return JSON.stringify(bundle, null, 2);
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Import a file made by Export (whole world) or a single room JSON file.
 * Returns a message for the user. Throws with a friendly message if the file is not usable.
 */
export function importJson(editor: Editor, text: string): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;

  if (obj.type === 'metroidvania-world-export' && typeof obj.rooms === 'object' && obj.rooms !== null) {
    const world = repairWorld(obj.world).value;
    const rawRooms = obj.rooms as Record<string, unknown>;
    const rooms = new Map<string, RoomData>();
    for (const ref of world.rooms) {
      rooms.set(ref.id, repairRoom(rawRooms[ref.id], repairContext(editor, ref.id, { name: ref.name, width: ref.w, height: ref.h })).value);
    }
    syncRefSizes(world, rooms);
    editor.replaceAll(world, rooms, rooms.keys(), true);
    return `Imported ${rooms.size} room${rooms.size === 1 ? '' : 's'}. Press Save to keep them.`;
  }

  if (typeof obj.layers === 'object' && obj.layers !== null && typeof obj.width === 'number') {
    // A single room file: add it (or replace the room with the same id).
    const id = typeof obj.id === 'string' && /^[\w-]+$/.test(obj.id) ? obj.id : `room-import-${Date.now().toString(36)}`;
    const room = repairRoom(obj, repairContext(editor, id)).value;
    editor.change('Import room', () => {
      const existing = editor.refOf(id);
      editor.rooms.set(id, room);
      editor.onTiles(id, null, null);
      if (existing) {
        const spot = findFreeSpot(editor.world.rooms, room.width, room.height, existing.x, existing.y, id);
        Object.assign(existing, { name: room.name, w: room.width, h: room.height, x: spot.x, y: spot.y });
      } else {
        const spot = findFreeSpot(editor.world.rooms, room.width, room.height, 0, 0);
        editor.world.rooms.push({ id, name: room.name, x: spot.x, y: spot.y, w: room.width, h: room.height });
      }
      if (!editor.world.startRoom) editor.world.startRoom = id;
    });
    editor.openRoom(id);
    return `Imported room "${room.name}". Press Save to keep it.`;
  }

  throw new Error('That file does not look like a world export or a room file.');
}
