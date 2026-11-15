/**
 * EDITOR STATE
 * ------------
 * One `Editor` object holds everything the World Editor knows: the loaded
 * content, which room/tool/layer is active, the selection, and the undo
 * history. The UI and the canvas never change content directly - they call
 * methods here, so every change is undoable and marks the room as "unsaved".
 *
 * How undo works here:
 *  - Tile painting records a compact patch (changed cells only), see beginStroke().
 *  - Everything else (decor, entities, room settings, the world map) uses
 *    snapshots: room objects are never modified in place, they are REPLACED
 *    by a changed copy. A snapshot is then just a list of pointers to the
 *    room objects that were current at that moment - cheap and simple.
 */
import {
  LAYER_NAMES, TILE_SIZE,
  type BackgroundDef, type DecorDef, type DecorInstance, type EntityInstance, type LayerName,
  type RoomData, type RoomRef, type TileCollision, type TileDef, type TilesetData, type WorldData,
} from '../../../shared/types';
import { defaultProps, entityType } from '../../../shared/entities';
import { buildTerrainIndex, paintTerrain, type TerrainIndex } from '../logic/autotile';
import { applyPatch, History, PatchBuilder, type Command, type TilePatch } from '../logic/history';
import { copyName, nextRoomId, uid } from '../logic/ids';
import { resizeRoom, type AnchorPos } from '../logic/resize';
import { rectCells, type Stamp, type TileRect } from '../logic/tileOps';
import { blankRoom, emptyTileset } from '../logic/validate';
import { findFreeSpot, overlapsAny, placeNewRoom } from '../logic/worldmap';

export type ToolId =
  | 'terrain' | 'tile' | 'eraser' | 'rect' | 'fill' | 'eyedropper'
  | 'select' | 'decor' | 'entity' | 'pan' | 'play';

/** What the paint tools put down: an auto-tiling terrain or a block of specific tiles. */
export type Brush = { kind: 'terrain'; index: number } | { kind: 'tiles'; stamp: Stamp };

export interface ObjectSelection { kind: 'decor' | 'entity'; ids: string[] }

/** A selected rectangle of tiles. `floating` holds tiles that were lifted and are being moved. */
export interface TileSelection { layer: LayerName; rect: TileRect; floating: Stamp | null }

export type Clipboard =
  | { kind: 'tiles'; stamp: Stamp }
  | { kind: 'decor'; items: DecorInstance[] }
  | { kind: 'entity'; items: EntityInstance[] };

/**
 * Things the UI can listen for:
 *  render    - the canvas needs repainting
 *  ui        - tool / layer / toggles / undo state / unsaved marker changed
 *  palette   - the chosen brush, decor or entity changed (or content reloaded)
 *  selection - selected objects or their values changed
 *  rooms     - the room list or the current room changed
 *  cursor    - the mouse moved to another tile
 */
export type Topic = 'render' | 'ui' | 'palette' | 'selection' | 'rooms' | 'cursor';

export class Emitter {
  private listeners = new Map<Topic, Array<() => void>>();
  on(topics: Topic | Topic[], fn: () => void): void {
    for (const t of Array.isArray(topics) ? topics : [topics]) {
      if (!this.listeners.has(t)) this.listeners.set(t, []);
      this.listeners.get(t)!.push(fn);
    }
  }
  emit(...topics: Topic[]): void {
    for (const t of topics) for (const fn of this.listeners.get(t) ?? []) fn();
  }
}

interface Snapshot { world: WorldData; rooms: Map<string, RoomData>; focus: string | null }

/** An in-progress change that can still be cancelled (used for drags). */
export interface Transaction { commit(): void; cancel(): void }

/** An in-progress brush stroke on one layer of the current room. */
export interface Stroke {
  readonly layer: LayerName;
  readonly tiles: number[];
  set(index: number, id: number): void;
  /** Finish and add to the undo history. Returns false if nothing changed. */
  commit(label: string): boolean;
  cancel(): void;
}

export interface NewRoomOptions {
  name: string;
  width: number;
  height: number;
  background: string;
  /** Paint a floor along the bottom with the first solid terrain. */
  addFloor: boolean;
  /** Put a Player Start just above the floor. */
  addPlayerStart: boolean;
}

export class Editor {
  readonly events = new Emitter();

  /* ---- content catalogs (read-only in this editor) ---- */
  tileset: TilesetData = emptyTileset();
  tileDefs = new Map<number, TileDef>();
  terrainIndex: TerrainIndex = buildTerrainIndex([]);
  decorDefs = new Map<string, DecorDef>();
  backgrounds: BackgroundDef[] = [];

  /* ---- the world being edited ---- */
  world: WorldData = { version: 1, name: 'My World', startRoom: '', rooms: [] };
  rooms = new Map<string, RoomData>();
  roomId: string | null = null;

  /* ---- UI state ---- */
  mode: 'room' | 'map' = 'room';
  tool: ToolId = 'terrain';
  activeLayer: LayerName = 'main';
  layerVisible: Record<LayerName, boolean> = { back: true, main: true, front: true };
  view = { grid: true, collision: false, cameraFrame: false, dim: false, decor: true, entities: true, background: true };
  brush: Brush = { kind: 'terrain', index: 0 };
  /** Remembered so the B and T keys can switch back to the last terrain / tiles. */
  lastTerrain = 0;
  lastStamp: Stamp = { w: 1, h: 1, ids: [0] };
  brushSize = 1;
  /** Decor key that the next click will place (null = select/move mode). */
  decorArmed: string | null = null;
  decorLayer: DecorInstance['layer'] = 'back';
  /** Entity type that the next click will place (null = select/move mode). */
  entityArmed: string | null = null;
  selection: ObjectSelection | null = null;
  tileSelection: TileSelection | null = null;
  clipboard: Clipboard | null = null;
  cursor: { tx: number; ty: number; x: number; y: number } | null = null;

  /* ---- history & saving ---- */
  readonly history = new History(500);
  dirtyRooms = new Set<string>();
  worldDirty = false;
  /** Goes up by one on every content change (the autosave uses it to know when to write a draft). */
  changeCounter = 0;
  /** False when the server refuses saves (production without the editor password). */
  writable = true;
  /** Room ids that exist as files on the server (so Save can delete removed rooms). */
  serverRoomIds = new Set<string>();

  /** The canvas hooks in here to keep its tile caches fresh. layer/index null = "everything". */
  onTiles: (roomId: string, layer: LayerName | null, index: number | null) => void = () => {};
  /** Called just before undo/redo so a tool can finish or drop what it is doing. Return true to swallow the undo. */
  onBeforeHistory: (direction: 'undo' | 'redo') => boolean = () => false;

  /* ================================================================ */
  /* Content                                                           */
  /* ================================================================ */

  setCatalogs(tileset: TilesetData, decor: DecorDef[], backgrounds: BackgroundDef[]): void {
    this.tileset = tileset;
    this.tileDefs = new Map(tileset.tiles.map((t) => [t.id, t]));
    this.terrainIndex = buildTerrainIndex(tileset.terrains);
    this.decorDefs = new Map(decor.map((d) => [d.key, d]));
    this.backgrounds = backgrounds;
    const first = tileset.tiles[0];
    this.lastStamp = { w: 1, h: 1, ids: [first ? first.id : 0] };
    this.lastTerrain = 0;
    if (tileset.terrains.length === 0) {
      this.brush = { kind: 'tiles', stamp: this.lastStamp };
      this.tool = 'tile';
    } else {
      this.brush = { kind: 'terrain', index: 0 };
      this.activeLayer = tileset.terrains[0].layer;
    }
    this.events.emit('palette', 'ui', 'render');
  }

  collisionOf(tileId: number): TileCollision {
    return this.tileDefs.get(tileId)?.collision ?? 'none';
  }
  isSolid = (tileId: number): boolean => this.collisionOf(tileId) === 'solid';

  /* ================================================================ */
  /* Simple getters                                                    */
  /* ================================================================ */

  get room(): RoomData | null {
    return this.roomId ? this.rooms.get(this.roomId) ?? null : null;
  }
  refOf(id: string): RoomRef | undefined {
    return this.world.rooms.find((r) => r.id === id);
  }
  get dirty(): boolean {
    return this.worldDirty || this.dirtyRooms.size > 0;
  }
  background(key: string): BackgroundDef | undefined {
    return this.backgrounds.find((b) => b.key === key);
  }

  /* ================================================================ */
  /* UI state setters                                                  */
  /* ================================================================ */

  setTool(tool: ToolId): void {
    // The terrain and tile brushes are the same pencil with a different "ink".
    if (tool === 'terrain' && this.tileset.terrains.length === 0) tool = 'tile';
    if (tool === 'terrain' && this.brush.kind !== 'terrain') this.brush = { kind: 'terrain', index: this.lastTerrain };
    if (tool === 'tile' && this.brush.kind !== 'tiles') this.brush = { kind: 'tiles', stamp: this.lastStamp };
    this.tool = tool;
    // A selected lamp should not stay selected (and deletable!) while you are painting tiles.
    const keeps = tool === 'decor' ? 'decor' : tool === 'entity' ? 'entity' : tool === 'pan' || tool === 'play' ? this.selection?.kind : null;
    if (this.selection && this.selection.kind !== keeps) this.selection = null;
    // Picking the Decor/Entity tool un-hides them, or you would be placing invisible things.
    if (tool === 'decor') this.view.decor = true;
    if (tool === 'entity') this.view.entities = true;
    this.events.emit('ui', 'render', 'selection', 'palette');
  }

  setMode(mode: 'room' | 'map'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.events.emit('ui', 'render', 'rooms', 'selection');
  }

  setActiveLayer(layer: LayerName): void {
    this.activeLayer = layer;
    this.layerVisible[layer] = true; // never paint on a layer you cannot see
    this.events.emit('ui', 'render');
  }

  toggleLayerVisible(layer: LayerName): void {
    this.layerVisible[layer] = !this.layerVisible[layer];
    this.events.emit('ui', 'render');
  }

  toggleView(key: keyof Editor['view']): void {
    this.view[key] = !this.view[key];
    this.events.emit('ui', 'render');
  }

  setBrushSize(size: number): void {
    this.brushSize = size;
    this.events.emit('palette', 'ui', 'render');
  }

  /** Choose a terrain to paint with. Switches to its usual layer and to a paint tool. */
  pickTerrain(index: number): void {
    const def = this.tileset.terrains[index];
    if (!def) return;
    this.brush = { kind: 'terrain', index };
    this.lastTerrain = index;
    this.activeLayer = def.layer;
    this.layerVisible[def.layer] = true;
    if (this.tool !== 'rect' && this.tool !== 'fill') this.tool = 'terrain';
    this.selection = null;
    this.events.emit('palette', 'ui', 'render', 'selection');
  }

  /** Choose specific tile(s) to paint with. */
  pickTiles(stamp: Stamp): void {
    this.brush = { kind: 'tiles', stamp };
    this.lastStamp = stamp;
    if (this.tool !== 'rect' && this.tool !== 'fill') this.tool = 'tile';
    this.selection = null;
    this.events.emit('palette', 'ui', 'render', 'selection');
  }

  armDecor(key: string | null): void {
    this.decorArmed = key;
    this.tool = 'decor';
    this.view.decor = true;
    if (key || this.selection?.kind !== 'decor') this.selection = null;
    this.events.emit('palette', 'ui', 'render', 'selection');
  }

  armEntity(type: string | null): void {
    this.entityArmed = type;
    this.tool = 'entity';
    this.view.entities = true;
    if (type || this.selection?.kind !== 'entity') this.selection = null;
    this.events.emit('palette', 'ui', 'render', 'selection');
  }

  select(selection: ObjectSelection | null): void {
    this.selection = selection && selection.ids.length > 0 ? selection : null;
    this.events.emit('selection', 'render');
  }

  setTileSelection(sel: TileSelection | null): void {
    this.tileSelection = sel;
    this.events.emit('selection', 'render');
  }

  setCursor(cursor: Editor['cursor']): void {
    const prev = this.cursor;
    this.cursor = cursor;
    if (prev?.tx !== cursor?.tx || prev?.ty !== cursor?.ty || (prev === null) !== (cursor === null)) this.events.emit('cursor');
  }

  /** Make a room the current one. `stayOnMap` keeps the world map open (used when clicking a room there). */
  openRoom(id: string, stayOnMap = false): void {
    if (!this.rooms.has(id)) return;
    const changed = this.roomId !== id;
    this.roomId = id;
    if (changed) {
      this.selection = null;
      this.tileSelection = null;
    }
    if (!stayOnMap) this.mode = 'room';
    this.events.emit('rooms', 'ui', 'selection', 'render');
  }

  /* ================================================================ */
  /* Dirty tracking                                                    */
  /* ================================================================ */

  private touchRoom(id: string): void {
    this.dirtyRooms.add(id);
    this.changeCounter++;
  }
  private touchWorld(): void {
    this.worldDirty = true;
    this.changeCounter++;
  }

  /* ================================================================ */
  /* Tile strokes                                                      */
  /* ================================================================ */

  beginStroke(layer: LayerName = this.activeLayer): Stroke | null {
    const room = this.room;
    if (!room) return null;
    const roomId = room.id;
    const tiles = room.layers[layer];
    if (!this.layerVisible[layer]) {
      this.layerVisible[layer] = true; // never paint on a layer you cannot see
      this.events.emit('ui');
    }
    const builder = new PatchBuilder(tiles, (i) => this.onTiles(roomId, layer, i));
    let open = true;
    return {
      layer,
      tiles,
      set: (index, id) => {
        if (open) builder.set(index, id);
      },
      commit: (label) => {
        if (!open) return false;
        open = false;
        const patch = builder.finish();
        if (patch.idx.length === 0) return false;
        this.touchRoom(roomId);
        this.history.push({
          label,
          undo: () => this.applyTilePatch(roomId, layer, patch, 'undo'),
          redo: () => this.applyTilePatch(roomId, layer, patch, 'redo'),
        });
        this.events.emit('ui', 'render');
        return true;
      },
      cancel: () => {
        if (!open) return;
        open = false;
        builder.revert();
        this.events.emit('render');
      },
    };
  }

  private applyTilePatch(roomId: string, layer: LayerName, patch: TilePatch, direction: 'undo' | 'redo'): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    applyPatch(room.layers[layer], patch, direction);
    if (patch.idx.length > 4000) this.onTiles(roomId, layer, null);
    else for (const i of patch.idx) this.onTiles(roomId, layer, i);
    this.touchRoom(roomId);
    this.focusRoom(roomId);
  }

  /** After undo/redo: show the room the change happened in. */
  private focusRoom(roomId: string | null): void {
    if (this.mode === 'room' && roomId && roomId !== this.roomId && this.rooms.has(roomId)) {
      this.roomId = roomId;
      this.selection = null;
      this.tileSelection = null;
    }
  }

  /* ================================================================ */
  /* Snapshot transactions (everything that is not tile painting)       */
  /* ================================================================ */

  private capture(): Snapshot {
    return { world: structuredClone(this.world), rooms: new Map(this.rooms), focus: this.roomId };
  }

  /** Put a snapshot back. Returns true if anything was different. */
  private restore(snap: Snapshot, markDirty: boolean): boolean {
    let changed = false;
    const ids = new Set([...this.rooms.keys(), ...snap.rooms.keys()]);
    for (const id of ids) {
      const now = this.rooms.get(id);
      const then = snap.rooms.get(id);
      if (now === then) continue;
      changed = true;
      if (markDirty) this.touchRoom(id);
      if (!now || !then) this.onTiles(id, null, null);
      else for (const l of LAYER_NAMES) if (now.layers[l] !== then.layers[l]) this.onTiles(id, l, null);
    }
    if (JSON.stringify(this.world) !== JSON.stringify(snap.world)) {
      changed = true;
      if (markDirty) this.touchWorld();
    }
    this.rooms = new Map(snap.rooms);
    this.world = structuredClone(snap.world);
    this.fixCurrentRoom(snap.focus);
    return changed;
  }

  /** Make sure roomId and the selection still point at things that exist. */
  private fixCurrentRoom(prefer: string | null): void {
    this.focusRoom(prefer);
    if (this.roomId && !this.rooms.has(this.roomId)) {
      this.roomId = prefer && this.rooms.has(prefer) ? prefer : this.world.rooms[0]?.id ?? null;
      this.selection = null;
      this.tileSelection = null;
    }
    if (!this.roomId && this.world.rooms.length > 0) this.roomId = this.world.rooms[0].id;
    const room = this.room;
    if (this.selection && room) {
      const list: Array<{ id: string }> = this.selection.kind === 'decor' ? room.decor : room.entities;
      const ids = this.selection.ids.filter((id) => list.some((o) => o.id === id));
      this.selection = ids.length > 0 ? { kind: this.selection.kind, ids } : null;
    }
    if (this.tileSelection && room) {
      const r = this.tileSelection.rect;
      if (r.x + r.w > room.width || r.y + r.h > room.height) this.tileSelection = null;
    }
  }

  private emitAll(): void {
    this.events.emit('rooms', 'ui', 'selection', 'render');
  }

  /**
   * Start a change. Make your edits with patchRoom()/direct world edits, then
   * commit() to add ONE undo step, or cancel() to put everything back.
   */
  begin(label: string, mergeKey?: string): Transaction {
    const before = this.capture();
    let open = true;
    return {
      commit: () => {
        if (!open) return;
        open = false;
        const after = this.capture();
        // Work out what differs so the right rooms are marked unsaved.
        let changed = JSON.stringify(before.world) !== JSON.stringify(after.world);
        if (changed) this.touchWorld();
        for (const id of new Set([...before.rooms.keys(), ...after.rooms.keys()])) {
          if (before.rooms.get(id) !== after.rooms.get(id)) { changed = true; this.touchRoom(id); }
        }
        if (!changed) return;
        const cmd: Command & { after: Snapshot } = {
          label, mergeKey, after,
          undo: () => { this.restore(before, true); this.emitAll(); },
          redo: () => { this.restore(cmd.after, true); this.emitAll(); },
          merge: (newer) => { cmd.after = (newer as typeof cmd).after; return true; },
        };
        this.history.push(cmd);
        this.events.emit('ui');
      },
      cancel: () => {
        if (!open) return;
        open = false;
        this.restore(before, false);
        this.emitAll();
      },
    };
  }

  /** Convenience: begin + run + commit. */
  change(label: string, fn: () => void, mergeKey?: string): void {
    const tx = this.begin(label, mergeKey);
    fn();
    tx.commit();
    this.emitAll();
  }

  /** Replace a room with a changed copy (never modify room objects in place). Use inside begin()/change(). */
  patchRoom(id: string, patch: Partial<RoomData>): void {
    const old = this.rooms.get(id);
    if (!old) return;
    const next = { ...old, ...patch };
    this.rooms.set(id, next);
    for (const l of LAYER_NAMES) if (old.layers[l] !== next.layers[l]) this.onTiles(id, l, null);
    const ref = this.refOf(id);
    if (ref) { ref.name = next.name; ref.w = next.width; ref.h = next.height; }
    this.events.emit('render', 'selection');
  }

  undo(): void {
    if (this.onBeforeHistory('undo')) return;
    this.history.undo();
    this.fixCurrentRoom(this.roomId);
    this.emitAll();
  }

  redo(): void {
    if (this.onBeforeHistory('redo')) return;
    this.history.redo();
    this.fixCurrentRoom(this.roomId);
    this.emitAll();
  }

  /* ================================================================ */
  /* Decor & entities                                                  */
  /* ================================================================ */

  setDecor(next: DecorInstance[], label: string, mergeKey?: string): void {
    const id = this.roomId;
    if (id) this.change(label, () => this.patchRoom(id, { decor: next }), mergeKey);
  }

  setEntities(next: EntityInstance[], label: string, mergeKey?: string): void {
    const id = this.roomId;
    if (id) this.change(label, () => this.patchRoom(id, { entities: next }), mergeKey);
  }

  selectedDecor(): DecorInstance[] {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel || sel.kind !== 'decor') return [];
    return room.decor.filter((d) => sel.ids.includes(d.id));
  }

  selectedEntities(): EntityInstance[] {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel || sel.kind !== 'entity') return [];
    return room.entities.filter((e) => sel.ids.includes(e.id));
  }

  /** Change fields on every selected decor item. */
  updateSelectedDecor(patch: Partial<DecorInstance>, label: string, mergeKey?: string): void {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel || sel.kind !== 'decor') return;
    this.setDecor(room.decor.map((d) => (sel.ids.includes(d.id) ? { ...d, ...patch } : d)), label, mergeKey);
  }

  /** Change one property on every selected entity (of the same type). */
  updateSelectedEntityProp(key: string, value: number | string | boolean, mergeKey?: string): void {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel || sel.kind !== 'entity') return;
    this.setEntities(
      room.entities.map((e) => (sel.ids.includes(e.id) ? { ...e, props: { ...e.props, [key]: value } } : e)),
      'Change ' + key, mergeKey,
    );
  }

  /** Add a decor item and select it. */
  placeDecor(key: string, x: number, y: number): void {
    const room = this.room;
    if (!room || !this.decorDefs.has(key)) return;
    const item: DecorInstance = { id: uid('d', new Set(room.decor.map((d) => d.id))), key, x, y, layer: this.decorLayer };
    this.setDecor([...room.decor, item], 'Place decor');
    this.select({ kind: 'decor', ids: [item.id] });
  }

  /** Add an entity and select it. One-per-room entities are moved instead of duplicated. */
  placeEntity(type: string, x: number, y: number): void {
    const room = this.room;
    const def = entityType(type);
    if (!room || !def) return;
    const existing = def.unique ? room.entities.find((e) => e.type === type) : undefined;
    if (existing) {
      this.setEntities(room.entities.map((e) => (e === existing ? { ...e, x, y } : e)), `Move ${def.name}`);
      this.select({ kind: 'entity', ids: [existing.id] });
      return;
    }
    const item: EntityInstance = { id: uid('e', new Set(room.entities.map((e) => e.id))), type, x, y, props: defaultProps(type) };
    this.setEntities([...room.entities, item], `Place ${def.name}`);
    this.select({ kind: 'entity', ids: [item.id] });
  }

  deleteSelection(): boolean {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel) return false;
    if (sel.kind === 'decor') this.setDecor(room.decor.filter((d) => !sel.ids.includes(d.id)), 'Delete decor');
    else this.setEntities(room.entities.filter((e) => !sel.ids.includes(e.id)), 'Delete entity');
    this.select(null);
    return true;
  }

  /** Copy the selected objects one tile down-right (or to explicit positions) and select the copies. */
  duplicateSelection(dx = TILE_SIZE, dy = TILE_SIZE): boolean {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel) return false;
    if (sel.kind === 'decor') {
      const taken = new Set(room.decor.map((d) => d.id));
      const copies = this.selectedDecor().map((d) => {
        const id = uid('d', taken);
        taken.add(id);
        return { ...d, id, x: d.x + dx, y: d.y + dy };
      });
      this.setDecor([...room.decor, ...copies], 'Duplicate decor');
      this.select({ kind: 'decor', ids: copies.map((c) => c.id) });
    } else {
      const taken = new Set(room.entities.map((e) => e.id));
      const copies = this.selectedEntities()
        .filter((e) => !entityType(e.type)?.unique)
        .map((e) => {
          const id = uid('e', taken);
          taken.add(id);
          return { ...e, id, x: e.x + dx, y: e.y + dy, props: { ...e.props } };
        });
      if (copies.length === 0) return false;
      this.setEntities([...room.entities, ...copies], 'Duplicate entity');
      this.select({ kind: 'entity', ids: copies.map((c) => c.id) });
    }
    return true;
  }

  /** Paste copied objects so that their middle lands on (x,y). */
  pasteObjects(x: number, y: number): boolean {
    const room = this.room;
    const clip = this.clipboard;
    if (!room || !clip || clip.kind === 'tiles' || clip.items.length === 0) return false;
    const cx = clip.items.reduce((s, o) => s + o.x, 0) / clip.items.length;
    const cy = clip.items.reduce((s, o) => s + o.y, 0) / clip.items.length;
    const half = TILE_SIZE / 2;
    const dx = Math.round((x - cx) / half) * half;
    const dy = Math.round((y - cy) / half) * half;
    if (clip.kind === 'decor') {
      const taken = new Set(room.decor.map((d) => d.id));
      const copies = clip.items.map((d) => {
        const id = uid('d', taken);
        taken.add(id);
        return { ...d, id, x: d.x + dx, y: d.y + dy };
      });
      this.tool = 'decor';
      this.decorArmed = null;
      this.setDecor([...room.decor, ...copies], 'Paste decor');
      this.select({ kind: 'decor', ids: copies.map((c) => c.id) });
    } else {
      const taken = new Set(room.entities.map((e) => e.id));
      const copies = clip.items
        .filter((e) => !(entityType(e.type)?.unique && room.entities.some((o) => o.type === e.type)))
        .map((e) => {
          const id = uid('e', taken);
          taken.add(id);
          return { ...e, id, x: e.x + dx, y: e.y + dy, props: { ...e.props } };
        });
      if (copies.length === 0) return false;
      this.tool = 'entity';
      this.entityArmed = null;
      this.setEntities([...room.entities, ...copies], 'Paste entity');
      this.select({ kind: 'entity', ids: copies.map((c) => c.id) });
    }
    this.events.emit('ui', 'palette');
    return true;
  }

  copySelection(): boolean {
    if (this.selection?.kind === 'decor') this.clipboard = { kind: 'decor', items: this.selectedDecor().map((d) => ({ ...d })) };
    else if (this.selection?.kind === 'entity') this.clipboard = { kind: 'entity', items: this.selectedEntities().map((e) => ({ ...e, props: { ...e.props } })) };
    else return false;
    return true;
  }

  /** Move the selected decor within its layer's drawing order. */
  reorderSelectedDecor(how: 'forward' | 'backward' | 'front' | 'back'): void {
    const room = this.room;
    const sel = this.selection;
    if (!room || !sel || sel.kind !== 'decor') return;
    const list = [...room.decor];
    const chosen = (d: DecorInstance): boolean => sel.ids.includes(d.id);
    if (how === 'front') {
      this.setDecor([...list.filter((d) => !chosen(d)), ...list.filter(chosen)], 'Bring to front');
    } else if (how === 'back') {
      this.setDecor([...list.filter(chosen), ...list.filter((d) => !chosen(d))], 'Send to back');
    } else {
      // Swap each selected item with the next item on the SAME layer in the chosen direction.
      const order = how === 'forward' ? [...list.keys()].reverse() : [...list.keys()];
      const step = how === 'forward' ? 1 : -1;
      for (const i of order) {
        if (!chosen(list[i])) continue;
        let j = i + step;
        while (j >= 0 && j < list.length && list[j].layer !== list[i].layer) j += step;
        if (j < 0 || j >= list.length || chosen(list[j])) continue;
        [list[i], list[j]] = [list[j], list[i]];
      }
      this.setDecor(list, how === 'forward' ? 'Bring forward' : 'Send backward');
    }
  }

  /* ================================================================ */
  /* Rooms & world                                                     */
  /* ================================================================ */

  createRoom(opts: NewRoomOptions): string {
    const id = nextRoomId([...this.rooms.keys(), ...this.serverRoomIds]);
    const room = blankRoom(id, opts.name.trim() || id, opts.width, opts.height, opts.background);

    if (opts.addFloor) {
      // First terrain that normally lives on the main layer and is solid = a good floor.
      const terrain = this.tileset.terrains.findIndex((t) => t.layer === 'main' && this.isSolid(t.tiles[15]));
      if (terrain >= 0) {
        const cells = rectCells({ x: 0, y: room.height - 2, w: room.width, h: 2 }, room.width, room.height);
        paintTerrain(room.layers.main, room.width, room.height, cells, terrain, this.terrainIndex, (i, t) => { room.layers.main[i] = t; });
      }
    }
    if (opts.addPlayerStart) {
      const floorY = (room.height - (opts.addFloor ? 2 : 1)) * TILE_SIZE;
      room.entities.push({ id: uid('e'), type: 'playerStart', x: 3.5 * TILE_SIZE, y: floorY, props: defaultProps('playerStart') });
    }

    this.change('New room', () => {
      const spot = placeNewRoom(this.world.rooms, room.width, room.height, this.roomId ? this.refOf(this.roomId) : undefined);
      this.rooms.set(id, room);
      this.world.rooms.push({ id, name: room.name, x: spot.x, y: spot.y, w: room.width, h: room.height });
      if (!this.world.startRoom) this.world.startRoom = id;
    });
    this.openRoom(id);
    return id;
  }

  duplicateRoom(sourceId: string): string | null {
    const src = this.rooms.get(sourceId);
    const srcRef = this.refOf(sourceId);
    if (!src || !srcRef) return null;
    const id = nextRoomId([...this.rooms.keys(), ...this.serverRoomIds]);
    const copy: RoomData = structuredClone(src);
    copy.id = id;
    copy.name = copyName(src.name, this.world.rooms.map((r) => r.name));
    this.change('Duplicate room', () => {
      const spot = placeNewRoom(this.world.rooms, copy.width, copy.height, srcRef);
      this.rooms.set(id, copy);
      this.world.rooms.push({ id, name: copy.name, x: spot.x, y: spot.y, w: copy.width, h: copy.height });
    });
    return id;
  }

  deleteRoom(id: string): void {
    if (!this.rooms.has(id)) return;
    this.change('Delete room', () => {
      this.rooms.delete(id);
      this.world.rooms = this.world.rooms.filter((r) => r.id !== id);
      if (this.world.startRoom === id) this.world.startRoom = this.world.rooms[0]?.id ?? '';
      this.onTiles(id, null, null);
      this.fixCurrentRoom(null);
    });
  }

  renameRoom(id: string, name: string): void {
    const clean = name.trim();
    if (!clean || this.rooms.get(id)?.name === clean) return;
    this.change('Rename room', () => this.patchRoom(id, { name: clean }), `rename:${id}`);
  }

  setRoomBackground(id: string, background: string): void {
    this.change('Change background', () => this.patchRoom(id, { background }));
  }

  setStartRoom(id: string): void {
    if (this.world.startRoom === id) return;
    this.change('Set start room', () => { this.world.startRoom = id; });
  }

  renameWorld(name: string): void {
    const clean = name.trim();
    if (!clean || clean === this.world.name) return;
    this.change('Rename world', () => { this.world.name = clean; }, 'rename-world');
  }

  /** Move a room on the world map (tile units). Refuses positions that overlap another room. */
  moveRoomOnMap(id: string, x: number, y: number): boolean {
    const ref = this.refOf(id);
    if (!ref || (ref.x === x && ref.y === y)) return false;
    if (overlapsAny({ x, y, w: ref.w, h: ref.h }, this.world.rooms, id)) return false;
    this.change('Move room on map', () => {
      const r = this.refOf(id)!;
      r.x = x;
      r.y = y;
    });
    return true;
  }

  /** Resize a room. Returns a short message describing side effects (or '' if none). */
  resizeRoomTo(id: string, width: number, height: number, anchorX: AnchorPos, anchorY: AnchorPos): string {
    const room = this.rooms.get(id);
    if (!room || (room.width === width && room.height === height)) return '';
    const result = resizeRoom(room, width, height, anchorX, anchorY);
    let message = result.droppedDecor > 0 ? `${result.droppedDecor} decor item(s) outside the new size were removed. ` : '';
    this.change('Resize room', () => {
      this.patchRoom(id, result.room);
      const ref = this.refOf(id);
      if (ref) {
        // Keep the painted content at the same place in the world, if there is space for it.
        const wantX = ref.x - result.shiftX;
        const wantY = ref.y - result.shiftY;
        const spot = findFreeSpot(this.world.rooms, width, height, wantX, wantY, id);
        if (spot.x !== wantX || spot.y !== wantY) message += 'The room was nudged on the world map to avoid overlapping a neighbour.';
        ref.x = spot.x;
        ref.y = spot.y;
      }
      if (id === this.roomId) { this.tileSelection = null; }
    });
    return message.trim();
  }

  /** Replace everything (used by draft restore and JSON import). Clears the undo history. */
  replaceAll(world: WorldData, rooms: Map<string, RoomData>, dirtyRooms: Iterable<string>, worldDirty: boolean): void {
    for (const id of this.rooms.keys()) this.onTiles(id, null, null);
    this.world = world;
    this.rooms = rooms;
    for (const id of rooms.keys()) this.onTiles(id, null, null);
    this.history.clear();
    this.dirtyRooms = new Set(dirtyRooms);
    this.worldDirty = worldDirty;
    this.changeCounter++;
    this.selection = null;
    this.tileSelection = null;
    if (!this.roomId || !rooms.has(this.roomId)) {
      this.roomId = rooms.has(world.startRoom) ? world.startRoom : world.rooms[0]?.id ?? null;
    }
    this.emitAll();
  }
}
