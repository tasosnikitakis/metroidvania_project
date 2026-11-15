/**
 * TILE GEOMETRY HELPERS (pure logic, no DOM)
 * Lines, brush squares, rectangles, flood fill and "stamps" (little blocks of tiles).
 */

export interface TileRect { x: number; y: number; w: number; h: number }

/** A rectangular block of tile ids, row-major. id 0 = "nothing here". */
export interface Stamp { w: number; h: number; ids: number[] }

/** All tile positions on a straight line between two tiles (Bresenham's algorithm). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** The square a brush of `size` tiles covers when centred on (cx,cy), before clipping. */
export function brushRect(cx: number, cy: number, size: number): TileRect {
  const off = Math.floor((size - 1) / 2);
  return { x: cx - off, y: cy - off, w: size, h: size };
}

/** Layer indices covered by a rectangle, clipped to the room. */
export function rectCells(rect: TileRect, w: number, h: number): number[] {
  const out: number[] = [];
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(w, rect.x + rect.w);
  const y1 = Math.min(h, rect.y + rect.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(y * w + x);
  return out;
}

/** Layer indices covered by a square brush centred on (cx,cy), clipped to the room. */
export function brushCells(cx: number, cy: number, size: number, w: number, h: number): number[] {
  return rectCells(brushRect(cx, cy, size), w, h);
}

/** Rectangle spanning two corner tiles (in any order), inclusive. */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number): TileRect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

export function clipRect(r: TileRect, w: number, h: number): TileRect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(w, r.x + r.w);
  const y1 = Math.min(h, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Flood fill: every cell connected (up/down/left/right) to the start cell
 * whose "kind" matches the start cell's kind. `kindOf` lets the caller decide
 * what counts as the same (e.g. "any tile of the same terrain").
 */
export function floodRegion(
  layer: ArrayLike<number>, w: number, h: number,
  startX: number, startY: number,
  kindOf: (id: number) => number | string = (id) => id,
): number[] {
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return [];
  const target = kindOf(layer[startY * w + startX]);
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  const stack = [startY * w + startX];
  seen[stack[0]] = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    out.push(c);
    const x = c % w;
    const tryCell = (n: number): void => {
      if (seen[n] === 0 && kindOf(layer[n]) === target) { seen[n] = 1; stack.push(n); }
    };
    if (x > 0) tryCell(c - 1);
    if (x < w - 1) tryCell(c + 1);
    if (c >= w) tryCell(c - w);
    if (c < w * (h - 1)) tryCell(c + w);
  }
  return out;
}

/** Copy a rectangle of tiles out of a layer (cells outside the room become 0). */
export function extractStamp(layer: ArrayLike<number>, w: number, h: number, rect: TileRect): Stamp {
  const ids: number[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      ids.push(x >= 0 && y >= 0 && x < w && y < h ? layer[y * w + x] : 0);
    }
  }
  return { w: rect.w, h: rect.h, ids };
}

/** Mirror a stamp left-right ('h') or top-bottom ('v'). */
export function flipStamp(stamp: Stamp, dir: 'h' | 'v'): Stamp {
  const ids = new Array<number>(stamp.ids.length);
  for (let y = 0; y < stamp.h; y++) {
    for (let x = 0; x < stamp.w; x++) {
      const sx = dir === 'h' ? stamp.w - 1 - x : x;
      const sy = dir === 'v' ? stamp.h - 1 - y : y;
      ids[y * stamp.w + x] = stamp.ids[sy * stamp.w + sx];
    }
  }
  return { w: stamp.w, h: stamp.h, ids };
}

/** The stamp tile that lands on (x,y) when the stamp is tiled like wallpaper from (originX,originY). */
export function stampTileAt(stamp: Stamp, originX: number, originY: number, x: number, y: number): number {
  const sx = (((x - originX) % stamp.w) + stamp.w) % stamp.w;
  const sy = (((y - originY) % stamp.h) + stamp.h) % stamp.h;
  return stamp.ids[sy * stamp.w + sx];
}
