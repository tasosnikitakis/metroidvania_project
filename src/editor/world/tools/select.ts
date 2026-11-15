/**
 * Select tool (M): drag a rectangle of tiles on the active layer, then
 *   - drag inside it to MOVE the tiles (they "float" until you click elsewhere),
 *   - Ctrl+C / Ctrl+X / Ctrl+V to copy, cut, paste,
 *   - Delete to clear, flip buttons in the side panel.
 * A simple click (no drag) on decor or an entity selects that instead.
 *
 * While tiles float, ONE stroke stays open; dropping them commits it, so a
 * whole lift-move-drop is a single undo step.
 */
import { TILE_SIZE, type LayerName } from '../../../shared/types';
import { eraseCells, retileAround } from '../logic/autotile';
import { clipRect, extractStamp, flipStamp, rectCells, rectFromCorners, type Stamp, type TileRect } from '../logic/tileOps';
import type { Stroke } from '../state/editor';
import { strokeTileRect, tileRectOnScreen, type PointerInfo, type Tool, type ToolHost } from './tool';

/** Tiles in the air. Keeps its own copy of where it is, so it survives the selection being cleared by a room switch. */
interface Floating { stroke: Stroke; stamp: Stamp; roomId: string; layer: LayerName; rect: TileRect; roomW: number; roomH: number; label: string }

export class SelectTool implements Tool {
  private mode: 'marquee' | 'move' | null = null;
  private start = { x: 0, y: 0, sx: 0, sy: 0 };
  private grab = { x: 0, y: 0 };
  private float: Floating | null = null;

  constructor(private host: ToolHost, private pickObject: (p: PointerInfo) => boolean) {}

  hint(): string {
    if (this.float) return 'Drag to move the tiles · click outside or press Enter to drop them · Esc/Ctrl+Z to cancel';
    return 'Drag to select tiles · drag inside to move · Ctrl+C/X/V copy, cut, paste · Delete clears · click an object to select it';
  }
  cursor(): string { return 'default'; }

  private get sel() { return this.host.editor.tileSelection; }

  private setRect(layer: LayerName, rect: TileRect): void {
    if (this.float) this.float.rect = rect;
    this.host.editor.setTileSelection({ layer, rect, floating: this.float?.stamp ?? null });
  }

  onDown(p: PointerInfo): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!room) return;
    const sel = this.sel;
    this.start = { x: p.tx, y: p.ty, sx: p.sx, sy: p.sy };
    if (sel && p.tx >= sel.rect.x && p.ty >= sel.rect.y && p.tx < sel.rect.x + sel.rect.w && p.ty < sel.rect.y + sel.rect.h) {
      this.mode = 'move';
      if (!this.float) this.lift();
      this.grab = { x: p.tx - sel.rect.x, y: p.ty - sel.rect.y };
      return;
    }
    this.drop();
    ed.setTileSelection(null);
    this.mode = 'marquee';
  }

  onDrag(p: PointerInfo): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!room) return;
    if (this.mode === 'marquee') {
      const moved = Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) > 4 || p.tx !== this.start.x || p.ty !== this.start.y;
      if (!moved && !this.sel) return;
      const rect = clipRect(rectFromCorners(this.start.x, this.start.y, p.tx, p.ty), room.width, room.height);
      if (rect) this.setRect(ed.activeLayer, rect);
    } else if (this.mode === 'move' && this.sel) {
      const rect = { ...this.sel.rect, x: p.tx - this.grab.x, y: p.ty - this.grab.y };
      if (rect.x !== this.sel.rect.x || rect.y !== this.sel.rect.y) this.setRect(this.sel.layer, rect);
    }
  }

  onUp(p: PointerInfo): void {
    if (this.mode === 'marquee' && !this.sel) {
      // It was just a click: maybe on a decor item or entity.
      this.pickObject(p);
    }
    this.mode = null;
    this.host.editor.events.emit('ui');
  }

  onCancel(): void { this.mode = null; }

  /** Cut the selected tiles out of the layer and hold them "in the air". */
  private lift(label = 'Move tiles'): void {
    const ed = this.host.editor;
    const room = ed.room;
    const sel = this.sel;
    if (!room || !sel || this.float) return;
    const stroke = ed.beginStroke(sel.layer);
    if (!stroke) return;
    const stamp = extractStamp(stroke.tiles, room.width, room.height, sel.rect);
    const hole = rectCells(sel.rect, room.width, room.height);
    for (const c of hole) stroke.set(c, 0);
    // Terrain left behind grows proper edges around the hole.
    retileAround(stroke.tiles, room.width, room.height, hole, ed.terrainIndex, stroke.set);
    this.float = { stroke, stamp, roomId: room.id, layer: sel.layer, rect: sel.rect, roomW: room.width, roomH: room.height, label };
    this.setRect(sel.layer, sel.rect);
  }

  /** Put floating tiles down where they are and finish the undo step. */
  drop(): void {
    const f = this.float;
    if (!f) return;
    this.float = null;
    for (let y = 0; y < f.stamp.h; y++) {
      for (let x = 0; x < f.stamp.w; x++) {
        const id = f.stamp.ids[y * f.stamp.w + x];
        const cx = f.rect.x + x;
        const cy = f.rect.y + y;
        if (id > 0 && cx >= 0 && cy >= 0 && cx < f.roomW && cy < f.roomH) f.stroke.set(cy * f.roomW + cx, id);
      }
    }
    // Terrain tiles that were moved (or flipped) re-shape themselves to fit their new neighbours.
    retileAround(f.stroke.tiles, f.roomW, f.roomH, rectCells(f.rect, f.roomW, f.roomH), this.host.editor.terrainIndex, f.stroke.set);
    f.stroke.commit(f.label);
    if (this.host.editor.roomId === f.roomId) {
      const clipped = clipRect(f.rect, f.roomW, f.roomH);
      this.host.editor.setTileSelection(clipped ? { layer: f.layer, rect: clipped, floating: null } : null);
    }
  }

  flush(): void {
    this.drop();
    this.mode = null;
  }

  /** Forget everything without touching tiles (the room was replaced under us). */
  reset(): void {
    this.drop();
    this.mode = null;
    this.host.editor.setTileSelection(null);
  }

  onBeforeHistory(): boolean {
    if (!this.float) return false;
    // Undo while tiles float = "never mind": put the layer back as it was.
    this.float.stroke.cancel();
    this.float = null;
    this.host.editor.setTileSelection(null);
    return true;
  }

  /* ---- commands (also called from the keyboard shortcuts and the side panel) ---- */

  hasSelection(): boolean { return this.sel !== null; }

  copy(): boolean {
    const ed = this.host.editor;
    const room = ed.room;
    const sel = this.sel;
    if (!room || !sel) return false;
    const stamp = this.float?.stamp ?? extractStamp(room.layers[sel.layer], room.width, room.height, sel.rect);
    ed.clipboard = { kind: 'tiles', stamp: { ...stamp, ids: [...stamp.ids] } };
    return true;
  }

  deleteSelection(): boolean {
    const ed = this.host.editor;
    const room = ed.room;
    const sel = this.sel;
    if (!room || !sel) return false;
    if (this.float) {
      // Floating tiles are already cut out of the layer: just don't put them back.
      const f = this.float;
      this.float = null;
      f.stroke.commit('Delete tiles');
    } else {
      const stroke = ed.beginStroke(sel.layer);
      if (stroke) {
        eraseCells(stroke.tiles, room.width, room.height, rectCells(sel.rect, room.width, room.height), ed.terrainIndex, stroke.set);
        stroke.commit('Delete tiles');
      }
    }
    ed.setTileSelection(null);
    return true;
  }

  cut(): boolean {
    return this.copy() && this.deleteSelection();
  }

  /** Start floating the clipboard tiles with their top-left at tile (tx,ty). */
  paste(tx: number, ty: number): boolean {
    const ed = this.host.editor;
    const room = ed.room;
    const clip = ed.clipboard;
    if (!room || !clip || clip.kind !== 'tiles') return false;
    this.drop();
    const stroke = ed.beginStroke(ed.activeLayer);
    if (!stroke) return false;
    const stamp = { ...clip.stamp, ids: [...clip.stamp.ids] };
    const x = Math.min(room.width - 1, Math.max(1 - stamp.w, tx));
    const y = Math.min(room.height - 1, Math.max(1 - stamp.h, ty));
    this.float = { stroke, stamp, roomId: room.id, layer: ed.activeLayer, rect: { x, y, w: stamp.w, h: stamp.h }, roomW: room.width, roomH: room.height, label: 'Paste tiles' };
    this.setRect(ed.activeLayer, { x, y, w: stamp.w, h: stamp.h });
    return true;
  }

  duplicate(): boolean {
    const sel = this.sel;
    if (!sel || !this.copy()) return false;
    return this.paste(sel.rect.x + 1, sel.rect.y + 1);
  }

  flip(dir: 'h' | 'v'): boolean {
    if (!this.sel) return false;
    if (!this.float) this.lift('Flip tiles');
    if (!this.float) return false;
    this.float.stamp = flipStamp(this.float.stamp, dir);
    this.setRect(this.sel.layer, this.sel.rect);
    return true;
  }

  selectAll(): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!room) return;
    this.drop();
    this.setRect(ed.activeLayer, { x: 0, y: 0, w: room.width, h: room.height });
  }

  onKey(e: KeyboardEvent): boolean {
    const sel = this.sel;
    if (!sel) return false;
    if (e.key === 'Escape') {
      this.drop();
      this.host.editor.setTileSelection(null);
      return true;
    }
    if (e.key === 'Enter') { this.drop(); return true; }
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[e.key];
    if (d) {
      if (!this.float) this.lift();
      const n = e.shiftKey ? 5 : 1;
      this.setRect(sel.layer, { ...sel.rect, x: sel.rect.x + d[0] * n, y: sel.rect.y + d[1] * n });
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sel = this.sel;
    if (!sel) return;
    const view = this.host.view;
    if (this.float) {
      const size = TILE_SIZE * view.zoom;
      const s = this.float.stamp;
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const id = s.ids[y * s.w + x];
          if (id > 0) this.host.drawTile(ctx, id, view.sx((sel.rect.x + x) * TILE_SIZE), view.sy((sel.rect.y + y) * TILE_SIZE), size);
        }
      }
    }
    const r = tileRectOnScreen(view, sel.rect);
    ctx.save();
    ctx.fillStyle = this.float ? 'rgba(110,231,255,0.08)' : 'rgba(110,231,255,0.16)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
    strokeTileRect(ctx, view, sel.rect, '#ffffff', true);
  }
}
