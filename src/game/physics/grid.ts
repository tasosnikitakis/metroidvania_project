/**
 * COLLISION GRID  (pure TypeScript - no Phaser)
 * ---------------------------------------------
 * A room's gameplay layer boiled down to one byte per tile.
 */
import type { RoomData, TilesetData, TileCollision } from '../../shared/types';

export const CELL_EMPTY = 0;
export const CELL_SOLID = 1;
export const CELL_ONEWAY = 2;
export const CELL_HAZARD = 3;
export type Cell = 0 | 1 | 2 | 3;

const CELL_OF: Record<TileCollision, Cell> = {
  none: CELL_EMPTY,
  solid: CELL_SOLID,
  oneway: CELL_ONEWAY,
  hazard: CELL_HAZARD,
};

export interface CollisionGrid {
  /** Size in tiles. */
  width: number;
  height: number;
  /** Tile size in logical px. */
  tileSize: number;
  /** Row-major, width*height. */
  cells: Uint8Array;
  /**
   * What lies beyond the left/right room edges. Return true where a
   * neighbouring room continues (the hero may walk out); anywhere else the
   * edge behaves like a solid wall. Above and below the room is always open.
   */
  isOpenOutside?: (tx: number, ty: number) => boolean;
}

/** Build the grid from a room's `main` layer and the tileset's collision types. */
export function buildCollisionGrid(
  room: RoomData,
  tileset: TilesetData,
  isOpenOutside?: (tx: number, ty: number) => boolean,
): CollisionGrid {
  const byId = new Map<number, Cell>();
  for (const t of tileset.tiles) byId.set(t.id, CELL_OF[t.collision] ?? CELL_EMPTY);
  const cells = new Uint8Array(room.width * room.height);
  const main = room.layers.main ?? [];
  for (let i = 0; i < cells.length; i++) cells[i] = byId.get(main[i] ?? 0) ?? CELL_EMPTY;
  return { width: room.width, height: room.height, tileSize: tileset.tileSize, cells, isOpenOutside };
}

/** Handy for tests: build a grid from ASCII rows. '#' solid, '-' one-way, '^' hazard, anything else empty. */
export function gridFromAscii(rows: string[], tileSize = 48): CollisionGrid {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      cells[y * width + x] = c === '#' ? CELL_SOLID : c === '-' ? CELL_ONEWAY : c === '^' ? CELL_HAZARD : CELL_EMPTY;
    }
  });
  return { width, height, tileSize, cells };
}

/** Collision type of a tile, including the area outside the room. */
export function cellAt(grid: CollisionGrid, tx: number, ty: number): Cell {
  if (tx < 0 || tx >= grid.width) {
    return grid.isOpenOutside?.(tx, ty) ? CELL_EMPTY : CELL_SOLID;
  }
  if (ty < 0 || ty >= grid.height) return CELL_EMPTY;
  return grid.cells[ty * grid.width + tx] as Cell;
}
