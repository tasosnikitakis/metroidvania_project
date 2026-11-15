/**
 * VALIDATE & REPAIR (pure logic)
 * Content files are hand-editable JSON, and other tools write them too, so the
 * editor never trusts what it loads. Every function here takes "anything" and
 * returns a well-formed object plus a list of human-readable fixes it made.
 * Nothing in here throws.
 */
import {
  LAYER_NAMES, TILE_SIZE,
  type BackgroundCatalog, type DecorCatalog, type DecorInstance, type EntityInstance,
  type RoomData, type RoomRef, type TilesetData, type WorldData, type TerrainDef, type TileDef,
} from '../../../shared/types';
import { ENTITY_TYPES, type EntityTypeDef, type PropSchema } from '../../../shared/entities';

export const ROOM_MIN_W = 8;
export const ROOM_MIN_H = 6;
export const ROOM_MAX_W = 400;
export const ROOM_MAX_H = 200;
export const DEFAULT_ROOM_W = 30;
export const DEFAULT_ROOM_H = 17;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const int = (v: unknown, fallback: number, lo: number, hi: number): number => clamp(Math.round(num(v, fallback)), lo, hi);

export function blankRoom(id: string, name: string, width: number, height: number, background: string): RoomData {
  const empty = (): number[] => new Array<number>(width * height).fill(0);
  return {
    version: 1, id, name, width, height, background,
    layers: { back: empty(), main: empty(), front: empty() },
    decor: [], entities: [],
  };
}

export interface RepairContext {
  /** The id this room must have (from world.json / the file name). */
  id: string;
  /** Fallbacks from the world map entry, used when the room file is missing or broken. */
  name?: string;
  width?: number;
  height?: number;
  /** Known tile ids. null = tileset not available, so don't judge tile ids. */
  tileIds: Set<number> | null;
  /** Known decor keys. null = decor catalog not available, so keep all decor. */
  decorKeys: Set<string> | null;
  /** Known background keys ([] = not available, keep whatever the room says). */
  backgrounds: string[];
  entityTypes?: EntityTypeDef[];
}

export interface Repaired<T> { value: T; fixes: string[] }

/** Coerce one entity property to its schema. Returns the default when the value makes no sense. */
export function repairProp(schema: PropSchema, value: unknown): number | string | boolean {
  switch (schema.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return schema.default;
      return clamp(value, schema.min ?? -Infinity, schema.max ?? Infinity);
    }
    case 'boolean': return typeof value === 'boolean' ? value : schema.default;
    case 'string': return typeof value === 'string' ? value : schema.default;
    case 'color': return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : schema.default;
    case 'select': return typeof value === 'string' && schema.options.includes(value) ? value : schema.default;
  }
}

export function repairRoom(raw: unknown, ctx: RepairContext): Repaired<RoomData> {
  const fixes: string[] = [];
  const src: Obj = isObj(raw) ? raw : {};
  if (!isObj(raw)) fixes.push('room file was missing or unreadable - started from an empty room');

  const width = int(src.width, ctx.width ?? DEFAULT_ROOM_W, ROOM_MIN_W, ROOM_MAX_W);
  const height = int(src.height, ctx.height ?? DEFAULT_ROOM_H, ROOM_MIN_H, ROOM_MAX_H);
  if (isObj(raw) && (src.width !== width || src.height !== height)) fixes.push(`room size corrected to ${width}x${height}`);

  // --- tile layers -------------------------------------------------
  const srcLayers: Obj = isObj(src.layers) ? src.layers : {};
  const layers = {} as RoomData['layers'];
  for (const name of LAYER_NAMES) {
    const rawLayer = srcLayers[name];
    const out = new Array<number>(width * height).fill(0);
    if (Array.isArray(rawLayer)) {
      if (rawLayer.length !== out.length) fixes.push(`layer "${name}" had ${rawLayer.length} tiles, expected ${out.length}`);
      let bad = 0;
      const n = Math.min(out.length, rawLayer.length);
      for (let i = 0; i < n; i++) {
        const v: unknown = rawLayer[i];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) { if (v !== 0) bad++; continue; }
        if (v !== 0 && ctx.tileIds && !ctx.tileIds.has(v)) { bad++; continue; }
        out[i] = v;
      }
      if (bad > 0) fixes.push(`layer "${name}": removed ${bad} unknown tile${bad === 1 ? '' : 's'}`);
    } else if (isObj(raw)) {
      fixes.push(`layer "${name}" was missing`);
    }
    layers[name] = out;
  }

  // --- decor -------------------------------------------------------
  const ids = new Set<string>();
  const uniqueId = (wanted: unknown, prefix: string): string => {
    let id = typeof wanted === 'string' && wanted !== '' ? wanted : '';
    let n = ids.size + 1;
    while (id === '' || ids.has(id)) id = `${prefix}-${n++}`;
    ids.add(id);
    return id;
  };
  const decor: DecorInstance[] = [];
  let droppedDecor = 0;
  for (const item of Array.isArray(src.decor) ? src.decor : []) {
    if (!isObj(item) || typeof item.key !== 'string' || (ctx.decorKeys && !ctx.decorKeys.has(item.key))) { droppedDecor++; continue; }
    const d: DecorInstance = {
      ...(item as unknown as DecorInstance),
      id: uniqueId(item.id, 'd'),
      key: item.key,
      x: num(item.x, 0),
      y: num(item.y, 0),
      layer: item.layer === 'far' || item.layer === 'front' ? item.layer : 'back',
    };
    if (d.flipX !== undefined && typeof d.flipX !== 'boolean') delete d.flipX;
    if (d.scale !== undefined) d.scale = clamp(num(d.scale, 1), 0.05, 20);
    if (d.rotation !== undefined) d.rotation = num(d.rotation, 0);
    if (d.alpha !== undefined) d.alpha = clamp(num(d.alpha, 1), 0, 1);
    decor.push(d);
  }
  if (droppedDecor > 0) fixes.push(`removed ${droppedDecor} decor item${droppedDecor === 1 ? '' : 's'} with an unknown picture`);

  // --- entities ----------------------------------------------------
  const types = ctx.entityTypes ?? ENTITY_TYPES;
  const entities: EntityInstance[] = [];
  const seenUnique = new Set<string>();
  let droppedEntities = 0;
  let extraUnique = 0;
  for (const item of Array.isArray(src.entities) ? src.entities : []) {
    const def = isObj(item) ? types.find((t) => t.type === item.type) : undefined;
    if (!isObj(item) || !def) { droppedEntities++; continue; }
    if (def.unique) {
      if (seenUnique.has(def.type)) { extraUnique++; continue; }
      seenUnique.add(def.type);
    }
    const rawProps: Obj = isObj(item.props) ? item.props : {};
    const props: EntityInstance['props'] = {};
    // keep unknown props that are simple values (a newer runtime may use them)
    for (const [k, v] of Object.entries(rawProps)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') props[k] = v;
    }
    for (const [k, schema] of Object.entries(def.props)) props[k] = repairProp(schema, rawProps[k]);
    entities.push({
      ...(item as unknown as EntityInstance),
      id: uniqueId(item.id, 'e'),
      type: def.type,
      x: clamp(num(item.x, 0), 0, width * TILE_SIZE),
      y: clamp(num(item.y, 0), 0, height * TILE_SIZE),
      props,
    });
  }
  if (droppedEntities > 0) fixes.push(`removed ${droppedEntities} entit${droppedEntities === 1 ? 'y' : 'ies'} of an unknown type`);
  if (extraUnique > 0) fixes.push(`removed ${extraUnique} duplicate one-per-room entit${extraUnique === 1 ? 'y' : 'ies'}`);

  // --- simple fields -----------------------------------------------
  let background = str(src.background, '');
  if (ctx.backgrounds.length > 0 && !ctx.backgrounds.includes(background)) {
    if (isObj(raw) && background !== '') fixes.push(`unknown background "${background}" replaced`);
    background = ctx.backgrounds[0];
  }

  const value: RoomData = {
    ...(src as unknown as RoomData), // keep any extra fields other tools added
    version: 1,
    id: ctx.id,
    name: str(src.name, ctx.name ?? ctx.id) || ctx.id,
    width, height, background, layers, decor, entities,
  };
  return { value, fixes };
}

/** Repair the room list. Room sizes are synced with the real rooms later (see syncRefSizes). */
export function repairWorld(raw: unknown): Repaired<WorldData> {
  const fixes: string[] = [];
  const src: Obj = isObj(raw) ? raw : {};
  const rooms: RoomRef[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(src.rooms) ? src.rooms : []) {
    if (!isObj(item) || typeof item.id !== 'string' || !/^[\w-]+$/.test(item.id) || seen.has(item.id)) {
      fixes.push('removed a broken or duplicate room entry from the world map');
      continue;
    }
    seen.add(item.id);
    rooms.push({
      ...(item as unknown as RoomRef),
      id: item.id,
      name: str(item.name, item.id) || item.id,
      x: Math.round(num(item.x, 0)),
      y: Math.round(num(item.y, 0)),
      w: int(item.w, DEFAULT_ROOM_W, ROOM_MIN_W, ROOM_MAX_W),
      h: int(item.h, DEFAULT_ROOM_H, ROOM_MIN_H, ROOM_MAX_H),
    });
  }
  let startRoom = str(src.startRoom, '');
  if (!seen.has(startRoom)) {
    const fallback = rooms[0]?.id ?? '';
    if (startRoom !== '' || fallback !== '') fixes.push(fallback ? `start room set to "${fallback}"` : 'start room cleared');
    startRoom = fallback;
  }
  return {
    value: { ...(src as unknown as WorldData), version: 1, name: str(src.name, 'My World') || 'My World', startRoom, rooms },
    fixes,
  };
}

/** Make each map entry agree with its room file (the room file wins). Returns true if anything changed. */
export function syncRefSizes(world: WorldData, rooms: Map<string, RoomData>): boolean {
  let changed = false;
  for (const ref of world.rooms) {
    const room = rooms.get(ref.id);
    if (!room) continue;
    if (ref.w !== room.width || ref.h !== room.height || ref.name !== room.name) {
      ref.w = room.width; ref.h = room.height; ref.name = room.name;
      changed = true;
    }
  }
  return changed;
}

export function emptyTileset(): TilesetData {
  return { version: 1, image: '', tileSize: TILE_SIZE, imageScale: 1, columns: 8, tiles: [], terrains: [] };
}

export function repairTileset(raw: unknown): Repaired<TilesetData> {
  const fixes: string[] = [];
  if (!isObj(raw)) return { value: emptyTileset(), fixes: ['tileset missing'] };
  const tiles: TileDef[] = [];
  const seen = new Set<number>();
  for (const t of Array.isArray(raw.tiles) ? raw.tiles : []) {
    if (!isObj(t) || typeof t.id !== 'number' || !Number.isInteger(t.id) || t.id < 1 || seen.has(t.id)) continue;
    seen.add(t.id);
    const collision = t.collision === 'solid' || t.collision === 'oneway' || t.collision === 'hazard' ? t.collision : 'none';
    tiles.push({ ...(t as unknown as TileDef), id: t.id, name: str(t.name, `Tile ${t.id}`), collision, group: str(t.group, 'other') || 'other' });
  }
  const terrains: TerrainDef[] = [];
  for (const t of Array.isArray(raw.terrains) ? raw.terrains : []) {
    if (!isObj(t) || !Array.isArray(t.tiles)) continue;
    const ids = (t.tiles as unknown[]).map((v) => (typeof v === 'number' && seen.has(v) ? v : 0));
    const fallback = ids[15] || ids.find((v) => v > 0) || 0;
    if (fallback === 0) { fixes.push(`terrain "${str(t.name, '?')}" has no usable tiles - skipped`); continue; }
    const full = Array.from({ length: 16 }, (_, i) => ids[i] || fallback);
    const variants = (Array.isArray(t.fillVariants) ? (t.fillVariants as unknown[]) : []).filter((v): v is number => typeof v === 'number' && seen.has(v));
    terrains.push({
      ...(t as unknown as TerrainDef),
      name: str(t.name, `Terrain ${terrains.length + 1}`),
      layer: t.layer === 'back' || t.layer === 'front' ? t.layer : 'main',
      tiles: full,
      ...(variants.length > 0 ? { fillVariants: variants } : { fillVariants: undefined }),
    });
  }
  return {
    value: {
      version: 1,
      image: str(raw.image, ''),
      tileSize: num(raw.tileSize, TILE_SIZE) || TILE_SIZE,
      imageScale: num(raw.imageScale, 1) || 1,
      columns: int(raw.columns, 8, 1, 4096),
      tiles, terrains,
    },
    fixes,
  };
}

export function repairDecorCatalog(raw: unknown): DecorCatalog {
  const out: DecorCatalog = { version: 1, decor: [] };
  if (!isObj(raw) || !Array.isArray(raw.decor)) return out;
  const seen = new Set<string>();
  for (const d of raw.decor) {
    if (!isObj(d) || typeof d.key !== 'string' || seen.has(d.key)) continue;
    seen.add(d.key);
    out.decor.push({
      ...(d as unknown as DecorCatalog['decor'][number]),
      key: d.key,
      name: str(d.name, d.key),
      image: str(d.image, ''),
      w: Math.max(1, num(d.w, TILE_SIZE)),
      h: Math.max(1, num(d.h, TILE_SIZE)),
      imageScale: num(d.imageScale, 1) || 1,
      originX: num(d.originX, 0.5),
      originY: num(d.originY, 1),
      group: str(d.group, 'other') || 'other',
    });
  }
  return out;
}

export function repairBackgrounds(raw: unknown): BackgroundCatalog {
  const out: BackgroundCatalog = { version: 1, backgrounds: [] };
  if (!isObj(raw) || !Array.isArray(raw.backgrounds)) return out;
  for (const b of raw.backgrounds) {
    if (!isObj(b) || typeof b.key !== 'string') continue;
    out.backgrounds.push({
      ...(b as unknown as BackgroundCatalog['backgrounds'][number]),
      key: b.key,
      name: str(b.name, b.key),
      skyTop: str(b.skyTop, '#1b1830'),
      skyBottom: str(b.skyBottom, '#3a2f55'),
      layers: (Array.isArray(b.layers) ? b.layers : []).filter((l) => isObj(l) && typeof l.image === 'string'),
    });
  }
  return out;
}
