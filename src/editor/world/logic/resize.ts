/**
 * ROOM RESIZE (pure logic)
 * Makes a room bigger or smaller while keeping what is already painted.
 * The "anchor" says which side stays put: anchor (0,0) keeps the top-left
 * corner fixed and grows/crops at the right and bottom; (1,1) keeps the
 * bottom-right fixed; (0.5,0.5) grows evenly on all sides.
 */
import { LAYER_NAMES, TILE_SIZE, type RoomData } from '../../../shared/types';

export type AnchorPos = 0 | 0.5 | 1;

export interface ResizeResult {
  room: RoomData;
  /** How many tiles the old content moved right / down inside the new room. */
  shiftX: number;
  shiftY: number;
  /** Decor that fell outside the new room and was removed. */
  droppedDecor: number;
}

export function resizeRoom(room: RoomData, newW: number, newH: number, anchorX: AnchorPos, anchorY: AnchorPos): ResizeResult {
  const shiftX = Math.round((newW - room.width) * anchorX);
  const shiftY = Math.round((newH - room.height) * anchorY);

  const layers = {} as RoomData['layers'];
  for (const name of LAYER_NAMES) {
    const src = room.layers[name];
    const dst = new Array<number>(newW * newH).fill(0);
    for (let y = 0; y < room.height; y++) {
      const ny = y + shiftY;
      if (ny < 0 || ny >= newH) continue;
      for (let x = 0; x < room.width; x++) {
        const nx = x + shiftX;
        if (nx < 0 || nx >= newW) continue;
        dst[ny * newW + nx] = src[y * room.width + x];
      }
    }
    layers[name] = dst;
  }

  const px = shiftX * TILE_SIZE;
  const py = shiftY * TILE_SIZE;
  const maxX = newW * TILE_SIZE;
  const maxY = newH * TILE_SIZE;
  const margin = 2 * TILE_SIZE; // decor may poke a little outside the room

  const movedDecor = room.decor.map((d) => ({ ...d, x: d.x + px, y: d.y + py }));
  const decor = movedDecor.filter((d) => d.x >= -margin && d.y >= -margin && d.x <= maxX + margin && d.y <= maxY + margin);

  // Entities are never thrown away (losing the player start would be nasty) - they are pulled back inside.
  const entities = room.entities.map((e) => ({
    ...e,
    x: Math.min(maxX, Math.max(0, e.x + px)),
    y: Math.min(maxY, Math.max(0, e.y + py)),
  }));

  return {
    room: { ...room, width: newW, height: newH, layers, decor, entities },
    shiftX,
    shiftY,
    droppedDecor: movedDecor.length - decor.length,
  };
}
