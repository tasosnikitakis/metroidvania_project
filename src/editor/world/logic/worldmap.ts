/**
 * WORLD MAP GEOMETRY (pure logic)
 * Rooms are rectangles on a big tile grid. Rooms that touch along an edge are
 * connected: walking off one room enters the other at the same world position.
 */
import type { RoomData, RoomRef } from '../../../shared/types';

export interface Box { x: number; y: number; w: number; h: number }

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Would `box` (belonging to room `selfId`) sit on top of any other room? */
export function overlapsAny(box: Box, refs: RoomRef[], selfId?: string): boolean {
  return refs.some((r) => r.id !== selfId && boxesOverlap(box, r));
}

/** A stretch of border shared by two touching rooms, in WORLD tile coordinates. */
export interface SharedEdge {
  a: string;
  b: string;
  /** 'vertical': a is left of b, the shared line is x = pos. 'horizontal': a is above b, the line is y = pos. */
  orientation: 'vertical' | 'horizontal';
  pos: number;
  /** Range along the line: tiles from..to (to is exclusive). */
  from: number;
  to: number;
}

export function sharedEdges(refs: RoomRef[]): SharedEdge[] {
  const out: SharedEdge[] = [];
  for (const a of refs) {
    for (const b of refs) {
      if (a === b) continue;
      if (a.x + a.w === b.x) { // a's right side touches b's left side
        const from = Math.max(a.y, b.y);
        const to = Math.min(a.y + a.h, b.y + b.h);
        if (to > from) out.push({ a: a.id, b: b.id, orientation: 'vertical', pos: b.x, from, to });
      }
      if (a.y + a.h === b.y) { // a's bottom touches b's top
        const from = Math.max(a.x, b.x);
        const to = Math.min(a.x + a.w, b.x + b.w);
        if (to > from) out.push({ a: a.id, b: b.id, orientation: 'horizontal', pos: b.y, from, to });
      }
    }
  }
  return out;
}

export interface Span { from: number; to: number }

export interface EdgeReport {
  /** Open on both sides: the player can walk through here. */
  doorways: Span[];
  /** Open on one side but solid wall on the other: the player would get stuck. */
  blocked: Span[];
}

function pushSpan(spans: Span[], at: number): void {
  const last = spans[spans.length - 1];
  if (last && last.to === at) last.to = at + 1;
  else spans.push({ from: at, to: at + 1 });
}

/**
 * Walk along a shared edge and compare the border tiles of both rooms' main layer.
 * Spans are in world tile coordinates along the edge.
 */
export function inspectEdge(
  edge: SharedEdge,
  aRef: RoomRef, aRoom: RoomData,
  bRef: RoomRef, bRoom: RoomData,
  isSolid: (tileId: number) => boolean,
): EdgeReport {
  const report: EdgeReport = { doorways: [], blocked: [] };
  const tileAt = (ref: RoomRef, room: RoomData, wx: number, wy: number): number => {
    const x = wx - ref.x;
    const y = wy - ref.y;
    if (x < 0 || y < 0 || x >= room.width || y >= room.height) return 0;
    return room.layers.main[y * room.width + x] ?? 0;
  };
  for (let t = edge.from; t < edge.to; t++) {
    const aSolid = edge.orientation === 'vertical'
      ? isSolid(tileAt(aRef, aRoom, edge.pos - 1, t))
      : isSolid(tileAt(aRef, aRoom, t, edge.pos - 1));
    const bSolid = edge.orientation === 'vertical'
      ? isSolid(tileAt(bRef, bRoom, edge.pos, t))
      : isSolid(tileAt(bRef, bRoom, t, edge.pos));
    if (!aSolid && !bSolid) pushSpan(report.doorways, t);
    else if (aSolid !== bSolid) pushSpan(report.blocked, t);
  }
  return report;
}

/**
 * Find the free position closest to (nearX, nearY) for a w*h room.
 * Searches outwards in growing square rings.
 */
export function findFreeSpot(refs: RoomRef[], w: number, h: number, nearX: number, nearY: number, selfId?: string): { x: number; y: number } {
  const free = (x: number, y: number): boolean => !overlapsAny({ x, y, w, h }, refs, selfId);
  if (free(nearX, nearY)) return { x: nearX, y: nearY };
  for (let r = 1; r < 2000; r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    const consider = (x: number, y: number): void => {
      if (!free(x, y)) return;
      const d = (x - nearX) ** 2 + (y - nearY) ** 2;
      if (d < bestD) { bestD = d; best = { x, y }; }
    };
    for (let i = -r; i <= r; i++) {
      consider(nearX + i, nearY - r);
      consider(nearX + i, nearY + r);
      consider(nearX - r, nearY + i);
      consider(nearX + r, nearY + i);
    }
    if (best) return best;
  }
  return { x: nearX, y: nearY };
}

/** Where to put a brand new room: directly right of `after` if there is space, else the nearest gap. */
export function placeNewRoom(refs: RoomRef[], w: number, h: number, after?: RoomRef): { x: number; y: number } {
  if (refs.length === 0) return { x: 0, y: 0 };
  const anchor = after ?? refs[refs.length - 1];
  return findFreeSpot(refs, w, h, anchor.x + anchor.w, anchor.y);
}
