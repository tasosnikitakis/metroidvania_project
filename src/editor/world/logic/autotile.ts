/**
 * AUTO-TILING (pure logic, no DOM)
 * --------------------------------
 * A "terrain" is a set of 16 tiles, one for every combination of
 * "is my neighbour the same terrain?" in the four directions.
 *
 *   mask bit:  N = 1,  E = 2,  S = 4,  W = 8
 *
 * e.g. mask 0  = a lonely block with nothing around it,
 *      mask 15 = completely surrounded (the "inside" of a wall).
 *
 * When you paint, we first mark the cells as belonging to the terrain and
 * then re-pick the right tile for those cells AND their neighbours.
 */
import type { TerrainDef } from '../../../shared/types';

export const MASK_N = 1;
export const MASK_E = 2;
export const MASK_S = 4;
export const MASK_W = 8;

/** Fast lookups built once from the tileset's terrain list. */
export interface TerrainIndex {
  terrains: TerrainDef[];
  /** tile id -> index into `terrains` (which terrain does this tile belong to?). */
  tileToTerrain: Map<number, number>;
}

export function buildTerrainIndex(terrains: TerrainDef[]): TerrainIndex {
  const tileToTerrain = new Map<number, number>();
  terrains.forEach((t, i) => {
    for (const id of [...t.tiles, ...(t.fillVariants ?? [])]) {
      // 0 means "empty" and never belongs to a terrain. First terrain wins on clashes.
      if (id > 0 && !tileToTerrain.has(id)) tileToTerrain.set(id, i);
    }
  });
  return { terrains, tileToTerrain };
}

/** Deterministic pseudo-random number from a tile position (same input -> same output, always). */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Neighbour mask for cell (x,y) as if it belonged to terrain `terrain`.
 * Cells outside the room count as "same terrain" so walls continue past the edge.
 */
export function terrainMask(
  layer: ArrayLike<number>, w: number, h: number,
  x: number, y: number, terrain: number, index: TerrainIndex,
): number {
  const same = (nx: number, ny: number): boolean => {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
    return index.tileToTerrain.get(layer[ny * w + nx]) === terrain;
  };
  let mask = 0;
  if (same(x, y - 1)) mask |= MASK_N;
  if (same(x + 1, y)) mask |= MASK_E;
  if (same(x, y + 1)) mask |= MASK_S;
  if (same(x - 1, y)) mask |= MASK_W;
  return mask;
}

/** The tile id a terrain uses for a given mask at a given position. */
export function terrainTileFor(def: TerrainDef, mask: number, x: number, y: number): number {
  if (mask === 15 && def.fillVariants && def.fillVariants.length > 0) {
    // Interior tiles: mix the plain fill with the variants so big walls don't look repetitive.
    const options = [def.tiles[15], ...def.fillVariants];
    return options[hash2(x, y) % options.length];
  }
  return def.tiles[mask];
}

type SetTile = (index: number, id: number) => void;

/**
 * Re-pick tiles for `cells` and their four neighbours. Only cells that hold a
 * terrain tile are touched; hand-placed non-terrain tiles are left alone.
 */
export function retileAround(
  layer: ArrayLike<number>, w: number, h: number,
  cells: Iterable<number>, index: TerrainIndex, set: SetTile,
): void {
  const todo = new Set<number>();
  for (const c of cells) {
    const x = c % w;
    const y = (c - x) / w;
    todo.add(c);
    if (y > 0) todo.add(c - w);
    if (y < h - 1) todo.add(c + w);
    if (x > 0) todo.add(c - 1);
    if (x < w - 1) todo.add(c + 1);
  }
  for (const c of todo) {
    const t = index.tileToTerrain.get(layer[c]);
    if (t === undefined) continue;
    const x = c % w;
    const y = (c - x) / w;
    const mask = terrainMask(layer, w, h, x, y, t, index);
    set(c, terrainTileFor(index.terrains[t], mask, x, y));
  }
}

/** Paint terrain number `terrain` onto `cells` (indices into the layer) and fix up the edges. */
export function paintTerrain(
  layer: ArrayLike<number>, w: number, h: number,
  cells: number[], terrain: number, index: TerrainIndex, set: SetTile,
): void {
  const def = index.terrains[terrain];
  if (!def) return;
  // Step 1: claim the cells for this terrain (any tile of the terrain will do for now).
  for (const c of cells) {
    if (index.tileToTerrain.get(layer[c]) !== terrain) set(c, def.tiles[15]);
  }
  // Step 2: choose the correct edge/corner/inside tile everywhere that could have changed.
  retileAround(layer, w, h, cells, index, set);
}

/** Erase `cells` and let the surrounding terrain grow new edges. */
export function eraseCells(
  layer: ArrayLike<number>, w: number, h: number,
  cells: number[], index: TerrainIndex, set: SetTile,
): void {
  for (const c of cells) set(c, 0);
  retileAround(layer, w, h, cells, index, set);
}
