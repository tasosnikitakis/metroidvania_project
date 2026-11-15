/**
 * Shared "put tiles down" operations used by the brush, rectangle and fill tools.
 * All of them write through a Stroke so the result is one undo step.
 */
import type { RoomData } from '../../../shared/types';
import { eraseCells, paintTerrain } from '../logic/autotile';
import { brushCells, stampTileAt } from '../logic/tileOps';
import type { Editor, Stroke } from '../state/editor';

/** One dab of the current brush centred on tile (tx,ty). `origin` is where the stroke started. */
export function dabBrush(
  editor: Editor, stroke: Stroke, room: RoomData,
  tx: number, ty: number, origin: { x: number; y: number }, erase: boolean,
): void {
  const { width: w, height: h } = room;
  const brush = editor.brush;
  if (erase) {
    eraseCells(stroke.tiles, w, h, brushCells(tx, ty, editor.brushSize, w, h), editor.terrainIndex, stroke.set);
  } else if (brush.kind === 'terrain') {
    paintTerrain(stroke.tiles, w, h, brushCells(tx, ty, editor.brushSize, w, h), brush.index, editor.terrainIndex, stroke.set);
  } else if (brush.stamp.w === 1 && brush.stamp.h === 1) {
    const id = brush.stamp.ids[0];
    if (id > 0) for (const c of brushCells(tx, ty, editor.brushSize, w, h)) stroke.set(c, id);
  } else {
    // Multi-tile stamp: snap to a grid starting where the stroke began, so dragging lays a neat pattern.
    const s = brush.stamp;
    const bx = origin.x + Math.floor((tx - origin.x) / s.w) * s.w;
    const by = origin.y + Math.floor((ty - origin.y) / s.h) * s.h;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const id = s.ids[y * s.w + x];
        const cx = bx + x;
        const cy = by + y;
        if (id > 0 && cx >= 0 && cy >= 0 && cx < w && cy < h) stroke.set(cy * w + cx, id);
      }
    }
  }
}

/** Fill a list of cells with the current brush (terrain, or the stamp repeated like wallpaper). */
export function fillCells(
  editor: Editor, stroke: Stroke, room: RoomData,
  cells: number[], originX: number, originY: number, erase: boolean,
): void {
  const { width: w, height: h } = room;
  const brush = editor.brush;
  if (erase) {
    eraseCells(stroke.tiles, w, h, cells, editor.terrainIndex, stroke.set);
  } else if (brush.kind === 'terrain') {
    paintTerrain(stroke.tiles, w, h, cells, brush.index, editor.terrainIndex, stroke.set);
  } else {
    for (const c of cells) {
      const x = c % w;
      const id = stampTileAt(brush.stamp, originX, originY, x, (c - x) / w);
      if (id > 0) stroke.set(c, id);
    }
  }
}

/**
 * Pick up whatever is under the cursor as the new brush. Looks at the active
 * layer first, then the other visible layers from front to back.
 */
export function eyedrop(editor: Editor, tx: number, ty: number): boolean {
  const room = editor.room;
  if (!room || tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return false;
  const i = ty * room.width + tx;
  const order = [editor.activeLayer, 'front', 'main', 'back'] as const;
  for (const layer of order) {
    if (!editor.layerVisible[layer]) continue;
    const id = room.layers[layer][i];
    if (id <= 0) continue;
    const terrain = editor.terrainIndex.tileToTerrain.get(id);
    const wasShape = editor.tool === 'rect' || editor.tool === 'fill';
    if (terrain !== undefined) editor.pickTerrain(terrain);
    else editor.pickTiles({ w: 1, h: 1, ids: [id] });
    editor.setActiveLayer(layer);
    if (!wasShape) editor.setTool(terrain !== undefined ? 'terrain' : 'tile');
    return true;
  }
  return false;
}

/** The label used in the undo history for the current brush. */
export function brushLabel(editor: Editor, erase: boolean): string {
  if (erase) return 'Erase';
  return editor.brush.kind === 'terrain' ? 'Paint terrain' : 'Paint tiles';
}
