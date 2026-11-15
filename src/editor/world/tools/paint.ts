/**
 * The pencil tools: Terrain brush (B), Tile brush (T) and Eraser (E).
 * - Drag to paint. One drag = one undo step.
 * - Hold Shift while dragging to draw a straight line.
 * - Alt+click picks up the tile under the cursor (eyedropper).
 */
import { TILE_SIZE } from '../../../shared/types';
import { brushRect, linePoints } from '../logic/tileOps';
import type { Stroke } from '../state/editor';
import { brushLabel, dabBrush, eyedrop } from './paintOps';
import { ACCENT, strokeTileRect, type PointerInfo, type Tool, type ToolHost } from './tool';

export class PaintTool implements Tool {
  private stroke: Stroke | null = null;
  private origin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  /** Set while a Shift-line is being rubber-banded. */
  private line: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private host: ToolHost, private erase: boolean) {}

  hint(): string {
    const what = this.erase ? 'erase' : 'paint';
    return `Drag to ${what} · Shift+drag: straight line · Alt+click: pick a tile · [ ]: brush size`;
  }

  cursor(): string { return 'crosshair'; }

  onDown(p: PointerInfo): void {
    const ed = this.host.editor;
    if (p.alt) {
      if (!eyedrop(ed, p.tx, p.ty)) this.host.toast('Nothing to pick up here');
      return;
    }
    const room = ed.room;
    if (!room) return;
    this.stroke = ed.beginStroke();
    if (!this.stroke) return;
    this.origin = { x: p.tx, y: p.ty };
    this.last = { x: p.tx, y: p.ty };
    if (p.shift) {
      this.line = { x0: p.tx, y0: p.ty, x1: p.tx, y1: p.ty };
    } else {
      dabBrush(ed, this.stroke, room, p.tx, p.ty, this.origin, this.erase);
    }
    this.host.redraw();
  }

  onDrag(p: PointerInfo): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!this.stroke || !room) return;
    if (this.line) {
      this.line.x1 = p.tx;
      this.line.y1 = p.ty;
    } else if (p.tx !== this.last.x || p.ty !== this.last.y) {
      // Fill in every tile between the last position and this one so fast drags leave no gaps.
      const pts = linePoints(this.last.x, this.last.y, p.tx, p.ty);
      for (let i = 1; i < pts.length; i++) dabBrush(ed, this.stroke, room, pts[i][0], pts[i][1], this.origin, this.erase);
      this.last = { x: p.tx, y: p.ty };
    }
    this.host.redraw();
  }

  onUp(): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!this.stroke || !room) return;
    if (this.line) {
      for (const [x, y] of linePoints(this.line.x0, this.line.y0, this.line.x1, this.line.y1)) {
        dabBrush(ed, this.stroke, room, x, y, this.origin, this.erase);
      }
    }
    this.stroke.commit(brushLabel(ed, this.erase));
    this.stroke = null;
    this.line = null;
    this.host.redraw();
  }

  onCancel(): void {
    this.stroke?.cancel();
    this.stroke = null;
    this.line = null;
  }

  flush(): void { this.onCancel(); }

  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    const ed = this.host.editor;
    const view = this.host.view;
    const color = this.erase ? '#ff6b81' : ACCENT;
    if (this.line) {
      for (const [x, y] of linePoints(this.line.x0, this.line.y0, this.line.x1, this.line.y1)) {
        strokeTileRect(ctx, view, brushRect(x, y, this.sizeForPreview()), color);
      }
      return;
    }
    if (!hover) return;
    const brush = ed.brush;
    if (!this.erase && brush.kind === 'tiles' && !this.stroke) {
      // Ghost of the tiles about to be placed.
      const s = brush.stamp;
      const single = s.w === 1 && s.h === 1;
      const size = TILE_SIZE * view.zoom;
      const r = single ? brushRect(hover.tx, hover.ty, ed.brushSize) : { x: hover.tx, y: hover.ty, w: s.w, h: s.h };
      ctx.save();
      ctx.globalAlpha = 0.65;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const id = single ? s.ids[0] : s.ids[y * s.w + x];
          if (id > 0) this.host.drawTile(ctx, id, view.sx((r.x + x) * TILE_SIZE), view.sy((r.y + y) * TILE_SIZE), size);
        }
      }
      ctx.restore();
      strokeTileRect(ctx, view, r, color);
      return;
    }
    const multi = !this.erase && brush.kind === 'tiles' && (brush.stamp.w > 1 || brush.stamp.h > 1);
    if (!multi) strokeTileRect(ctx, view, brushRect(hover.tx, hover.ty, ed.brushSize), color);
  }

  private sizeForPreview(): number {
    const b = this.host.editor.brush;
    return !this.erase && b.kind === 'tiles' && (b.stamp.w > 1 || b.stamp.h > 1) ? 1 : this.host.editor.brushSize;
  }
}
