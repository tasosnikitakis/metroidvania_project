/**
 * SWEPT AABB vs TILE GRID  (pure TypeScript - no Phaser)
 * -----------------------------------------------------
 * A body is an axis-aligned box described by its FEET: `x` is the horizontal
 * centre and `y` is the bottom edge. Movement is resolved one axis at a time:
 * the box sweeps along the axis and stops flush against the first blocking
 * tile, so it can never tunnel through walls however fast it moves.
 *
 *  - solid   blocks from every side
 *  - one-way blocks only a box moving DOWN whose feet started above its top
 *  - hazard  never blocks (the controller checks overlap and respawns)
 */
import { CELL_HAZARD, CELL_ONEWAY, CELL_SOLID, cellAt, type Cell, type CollisionGrid } from './grid';

export interface Body {
  /** Horizontal centre, logical px. */
  x: number;
  /** Bottom edge (feet), logical px. */
  y: number;
  w: number;
  h: number;
}

/** Tolerance so a box resting exactly against a tile does not count as inside it. */
const EPS = 0.001;

function span(lo: number, hi: number, ts: number): [number, number] {
  return [Math.floor((lo + EPS) / ts), Math.floor((hi - EPS) / ts)];
}

/** Sweep horizontally by dx. Returns true if a solid tile stopped the move. */
export function moveX(grid: CollisionGrid, b: Body, dx: number): boolean {
  if (dx === 0) return false;
  const ts = grid.tileSize;
  const [ty0, ty1] = span(b.y - b.h, b.y, ts);
  if (dx > 0) {
    const edge = b.x + b.w / 2;
    const last = Math.floor((edge + dx - EPS) / ts);
    for (let tx = Math.floor((edge - EPS) / ts) + 1; tx <= last; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (cellAt(grid, tx, ty) === CELL_SOLID) {
          b.x = tx * ts - b.w / 2;
          return true;
        }
      }
    }
  } else {
    const edge = b.x - b.w / 2;
    const last = Math.floor((edge + dx + EPS) / ts);
    for (let tx = Math.floor((edge + EPS) / ts) - 1; tx >= last; tx--) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (cellAt(grid, tx, ty) === CELL_SOLID) {
          b.x = (tx + 1) * ts + b.w / 2;
          return true;
        }
      }
    }
  }
  b.x += dx;
  return false;
}

/**
 * Sweep vertically by dy. Returns true if something stopped the move.
 * @param ignoreOneWay true while dropping through a one-way platform
 */
export function moveY(grid: CollisionGrid, b: Body, dy: number, ignoreOneWay = false): boolean {
  if (dy === 0) return false;
  const ts = grid.tileSize;
  const [tx0, tx1] = span(b.x - b.w / 2, b.x + b.w / 2, ts);
  if (dy > 0) {
    const edge = b.y;
    const last = Math.floor((edge + dy - EPS) / ts);
    // Starting one row below the feet means a one-way tile only counts when
    // the feet began above its top - exactly the "land on top only" rule.
    for (let ty = Math.floor((edge - EPS) / ts) + 1; ty <= last; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = cellAt(grid, tx, ty);
        if (c === CELL_SOLID || (c === CELL_ONEWAY && !ignoreOneWay)) {
          b.y = ty * ts;
          return true;
        }
      }
    }
  } else {
    const edge = b.y - b.h;
    const last = Math.floor((edge + dy + EPS) / ts);
    for (let ty = Math.floor((edge + EPS) / ts) - 1; ty >= last; ty--) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (cellAt(grid, tx, ty) === CELL_SOLID) {
          b.y = (ty + 1) * ts + b.h;
          return true;
        }
      }
    }
  }
  b.y += dy;
  return false;
}

/** Does a box (feet at x,y) overlap any tile of the given type? `inset` shrinks the box on every side. */
export function overlapsCell(
  grid: CollisionGrid, x: number, y: number, w: number, h: number, type: Cell, inset = 0,
): boolean {
  const ts = grid.tileSize;
  const [tx0, tx1] = span(x - w / 2 + inset, x + w / 2 - inset, ts);
  const [ty0, ty1] = span(y - h + inset, y - inset, ts);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (cellAt(grid, tx, ty) === type) return true;
    }
  }
  return false;
}

export function overlapsSolid(grid: CollisionGrid, x: number, y: number, w: number, h: number): boolean {
  return overlapsCell(grid, x, y, w, h, CELL_SOLID);
}

export function overlapsHazard(grid: CollisionGrid, b: Body, inset: number): boolean {
  return overlapsCell(grid, b.x, b.y, b.w, b.h, CELL_HAZARD, inset);
}

/** What is directly under the feet (within a hair)? */
export function probeGround(grid: CollisionGrid, b: Body): { solid: boolean; oneWay: boolean } {
  const ts = grid.tileSize;
  const out = { solid: false, oneWay: false };
  const ty = Math.floor((b.y - EPS) / ts) + 1;
  // Only a tile whose top is right at the feet counts as "standing on".
  if (ty * ts - b.y > 0.05) return out;
  const [tx0, tx1] = span(b.x - b.w / 2, b.x + b.w / 2, ts);
  for (let tx = tx0; tx <= tx1; tx++) {
    const c = cellAt(grid, tx, ty);
    if (c === CELL_SOLID) out.solid = true;
    else if (c === CELL_ONEWAY) out.oneWay = true;
  }
  return out;
}

/**
 * Is there a solid wall touching the given side (dir -1 left, +1 right)?
 * Sampled at chest and knee height so a low step does not count as a wall.
 */
export function touchingWall(grid: CollisionGrid, b: Body, dir: 1 | -1): boolean {
  const ts = grid.tileSize;
  const probeX = b.x + dir * (b.w / 2 + 1);
  const tx = Math.floor(probeX / ts);
  const chest = Math.floor((b.y - b.h * 0.7) / ts);
  const knee = Math.floor((b.y - b.h * 0.3) / ts);
  return cellAt(grid, tx, chest) === CELL_SOLID && cellAt(grid, tx, knee) === CELL_SOLID;
}
