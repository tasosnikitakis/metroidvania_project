/**
 * WORLD MAP helpers  (pure TypeScript - no Phaser)
 * ------------------------------------------------
 * Rooms sit on a big tile map (RoomRef x/y/w/h, in tiles). Rooms that touch
 * are connected: leaving one through an edge enters the neighbour at the same
 * world position.
 */
import type { RoomRef, WorldData } from '../../shared/types';

export function findRoomRef(world: WorldData, id: string): RoomRef | undefined {
  return world.rooms.find((r) => r.id === id);
}

/** Which room (other than `exceptId`) covers this world tile? */
export function roomAtWorldTile(world: WorldData, wx: number, wy: number, exceptId?: string): RoomRef | undefined {
  return world.rooms.find(
    (r) => r.id !== exceptId && wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h,
  );
}

/**
 * For the collision grid: is the tile (tx,ty) - given in the CURRENT room's
 * tile coordinates but lying outside it - part of a neighbouring room?
 */
export function makeOpenOutsideTest(world: WorldData, current: RoomRef | undefined) {
  if (!current) return () => false;
  return (tx: number, ty: number): boolean =>
    roomAtWorldTile(world, current.x + tx, current.y + ty, current.id) !== undefined;
}

export interface RoomExit {
  room: RoomRef;
  /** Where the hero's feet end up in the new room, logical px. */
  x: number;
  y: number;
}

/**
 * If the hero (feet at x,y px in the current room; `bodyH` tall) has left the
 * room, work out which room they entered and where. Returns null when still
 * inside or when nothing is there.
 */
export function findRoomExit(
  world: WorldData, current: RoomRef | undefined, x: number, y: number, bodyH: number, tileSize: number,
): RoomExit | null {
  if (!current) return null;
  const roomW = current.w * tileSize;
  const roomH = current.h * tileSize;
  // We use the body's middle so the hero is at least half-way out before switching.
  const midY = y - bodyH / 2;
  if (x >= 0 && x < roomW && midY >= 0 && midY < roomH) return null;
  const wx = current.x + Math.floor(x / tileSize);
  const wy = current.y + Math.floor(midY / tileSize);
  const next = roomAtWorldTile(world, wx, wy, current.id);
  if (!next) return null;
  return {
    room: next,
    x: x + (current.x - next.x) * tileSize,
    y: y + (current.y - next.y) * tileSize,
  };
}
