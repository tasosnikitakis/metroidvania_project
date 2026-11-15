/**
 * WORLD MAP VIEW
 * Shows every room as a rectangle at its world position with a small picture
 * of its tiles. Drag rooms to arrange them (they snap to tiles and cannot
 * overlap). Touching rooms are connected: shared borders are highlighted,
 * walk-through gaps in green, and gaps that face a wall in red.
 *
 * In this view the Viewport works in TILES: zoom = screen px per tile.
 */
import type { RoomData, RoomRef } from '../../../shared/types';
import { overlapsAny } from '../logic/worldmap';
import { findConnections } from '../state/connections';
import type { Editor } from '../state/editor';
import type { TileDrawer } from './tiles';
import type { Viewport } from './viewport';

interface Thumb { canvas: HTMLCanvasElement; main: number[]; back: number[]; ppt: number }

interface MapHost {
  redraw(): void;
  toast(message: string): void;
}

export class MapView {
  private thumbs = new Map<string, Thumb>();
  private drag: {
    id: string; startX: number; startY: number; origX: number; origY: number;
    x: number; y: number; validX: number; validY: number; moved: boolean;
  } | null = null;
  private hoverId: string | null = null;

  constructor(private editor: Editor, private drawer: TileDrawer, private host: MapHost) {}

  /** Tiles of a room changed: its little picture must be redrawn. */
  notify(roomId: string): void { this.thumbs.delete(roomId); }
  clearThumbs(): void { this.thumbs.clear(); }

  private thumb(room: RoomData): Thumb {
    let t = this.thumbs.get(room.id);
    if (t && (t.main !== room.layers.main || t.back !== room.layers.back)) t = undefined;
    if (!t) {
      const ppt = Math.max(2, Math.min(8, Math.floor(1024 / Math.max(room.width, room.height))));
      const canvas = document.createElement('canvas');
      canvas.width = room.width * ppt;
      canvas.height = room.height * ppt;
      const ctx = canvas.getContext('2d')!;
      const bg = this.editor.background(room.background);
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, bg?.skyTop ?? '#2a2440');
      grad.addColorStop(1, bg?.skyBottom ?? '#3a3157');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const [layer, alpha] of [[room.layers.back, 0.55], [room.layers.main, 1]] as const) {
        ctx.globalAlpha = alpha;
        for (let y = 0; y < room.height; y++) {
          for (let x = 0; x < room.width; x++) {
            const id = layer[y * room.width + x];
            if (id > 0) this.drawer.draw(ctx, id, x * ppt, y * ppt, ppt, 0.5);
          }
        }
      }
      t = { canvas, main: room.layers.main, back: room.layers.back, ppt };
      this.thumbs.set(room.id, t);
    }
    return t;
  }

  /** Room positions including the one being dragged right now. */
  private liveRefs(): RoomRef[] {
    const d = this.drag;
    if (!d || !d.moved) return this.editor.world.rooms;
    return this.editor.world.rooms.map((r) => (r.id === d.id ? { ...r, x: d.x, y: d.y } : r));
  }

  bounds(): { x: number; y: number; w: number; h: number } {
    const refs = this.editor.world.rooms;
    if (refs.length === 0) return { x: 0, y: 0, w: 30, h: 17 };
    const x0 = Math.min(...refs.map((r) => r.x));
    const y0 = Math.min(...refs.map((r) => r.y));
    const x1 = Math.max(...refs.map((r) => r.x + r.w));
    const y1 = Math.max(...refs.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private roomAt(wx: number, wy: number): RoomRef | undefined {
    const refs = this.editor.world.rooms;
    for (let i = refs.length - 1; i >= 0; i--) {
      const r = refs[i];
      if (wx >= r.x && wy >= r.y && wx < r.x + r.w && wy < r.y + r.h) return r;
    }
    return undefined;
  }

  /* ---------------- input (positions in world tiles) ---------------- */

  onDown(wx: number, wy: number): void {
    const ref = this.roomAt(wx, wy);
    if (!ref) return;
    this.editor.openRoom(ref.id, true);
    this.drag = { id: ref.id, startX: wx, startY: wy, origX: ref.x, origY: ref.y, x: ref.x, y: ref.y, validX: ref.x, validY: ref.y, moved: false };
  }

  onDrag(wx: number, wy: number): void {
    const d = this.drag;
    const ref = d && this.editor.refOf(d.id);
    if (!d || !ref) return;
    const x = Math.round(d.origX + wx - d.startX);
    const y = Math.round(d.origY + wy - d.startY);
    if (x === d.x && y === d.y) return;
    d.x = x;
    d.y = y;
    d.moved = true;
    if (!overlapsAny({ x, y, w: ref.w, h: ref.h }, this.editor.world.rooms, d.id)) {
      d.validX = x;
      d.validY = y;
    }
    this.host.redraw();
  }

  onUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.moved) return;
    if (d.x !== d.validX || d.y !== d.validY) this.host.toast('Rooms cannot overlap - moved to the nearest free spot you passed');
    this.editor.moveRoomOnMap(d.id, d.validX, d.validY);
    this.host.redraw();
  }

  onCancel(): void {
    this.drag = null;
    this.host.redraw();
  }

  onHover(wx: number, wy: number): void {
    const id = this.roomAt(wx, wy)?.id ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.host.redraw();
    }
  }

  /** Double-click: open the room for editing. */
  onDoubleClick(wx: number, wy: number): void {
    const ref = this.roomAt(wx, wy);
    if (ref) this.editor.openRoom(ref.id);
  }

  cursor(): string {
    return this.drag ? 'grabbing' : this.hoverId ? 'grab' : 'default';
  }

  /* ---------------- drawing (context in CSS px) ---------------- */

  draw(ctx: CanvasRenderingContext2D, view: Viewport): void {
    const ed = this.editor;
    const refs = this.liveRefs();
    const z = view.zoom;

    // Dotted backdrop every 10 tiles to give a sense of distance.
    const step = 10;
    if (z * step >= 14) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      const x0 = Math.floor(view.x / step) * step;
      const y0 = Math.floor(view.y / step) * step;
      for (let y = y0; y < view.wy(view.height); y += step) {
        for (let x = x0; x < view.wx(view.width); x += step) ctx.fillRect(Math.round(view.sx(x)) - 1, Math.round(view.sy(y)) - 1, 2, 2);
      }
    }

    const order = [...refs].sort((a, b) => Number(a.id === this.drag?.id) - Number(b.id === this.drag?.id));
    for (const ref of order) {
      const room = ed.rooms.get(ref.id);
      const x = Math.round(view.sx(ref.x));
      const y = Math.round(view.sy(ref.y));
      const w = Math.round(ref.w * z);
      const h = Math.round(ref.h * z);
      if (x > view.width || y > view.height || x + w < 0 || y + h < 0) continue;
      const dragging = this.drag?.id === ref.id && this.drag.moved;
      const invalid = dragging && (this.drag!.x !== this.drag!.validX || this.drag!.y !== this.drag!.validY);

      ctx.save();
      if (dragging) ctx.globalAlpha = 0.85;
      if (room) {
        const t = this.thumb(room);
        ctx.imageSmoothingEnabled = z < t.ppt * 1.5;
        ctx.drawImage(t.canvas, x, y, w, h);
      } else {
        ctx.fillStyle = '#2a2440';
        ctx.fillRect(x, y, w, h);
      }
      if (invalid) {
        ctx.fillStyle = 'rgba(255,70,90,0.4)';
        ctx.fillRect(x, y, w, h);
      }
      const current = ref.id === ed.roomId;
      ctx.lineWidth = current ? 3 : this.hoverId === ref.id ? 2 : 1.5;
      ctx.strokeStyle = invalid ? '#ff6b81' : current ? '#b58cff' : this.hoverId === ref.id ? '#e8e4f5' : 'rgba(232,228,245,0.5)';
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // Name tag.
      const star = ref.id === ed.world.startRoom ? '★ ' : '';
      const label = star + ref.name;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      if (w > 40 && h > 22) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        const tw = Math.min(w - 8, ctx.measureText(label).width + 10);
        ctx.fillStyle = 'rgba(20,18,28,0.78)';
        ctx.fillRect(x + 4, y + 4, tw, 18);
        ctx.fillStyle = ref.id === ed.world.startRoom ? '#6ee7ff' : '#e8e4f5';
        ctx.fillText(label, x + 9, y + 7, w - 18);
        ctx.restore();
      }
      ctx.restore();
    }

    // Connections between touching rooms.
    for (const c of findConnections(ed, refs)) {
      const line = (from: number, to: number, color: string, width: number): void => {
        ctx.beginPath();
        if (c.edge.orientation === 'vertical') {
          ctx.moveTo(view.sx(c.edge.pos), view.sy(from));
          ctx.lineTo(view.sx(c.edge.pos), view.sy(to));
        } else {
          ctx.moveTo(view.sx(from), view.sy(c.edge.pos));
          ctx.lineTo(view.sx(to), view.sy(c.edge.pos));
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'butt';
        ctx.stroke();
      };
      line(c.edge.from, c.edge.to, 'rgba(110,231,255,0.55)', 2);
      for (const s of c.report.doorways) line(s.from, s.to, '#7be0a0', 6);
      for (const s of c.report.blocked) {
        line(s.from, s.to, '#ff5d73', 6);
        const mid = (s.from + s.to) / 2;
        const mx = c.edge.orientation === 'vertical' ? view.sx(c.edge.pos) : view.sx(mid);
        const my = c.edge.orientation === 'vertical' ? view.sy(mid) : view.sy(c.edge.pos);
        ctx.beginPath();
        ctx.arc(mx, my, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#ff5d73';
        ctx.fill();
        ctx.fillStyle = '#17102a';
        ctx.font = '800 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', mx, my + 0.5);
        ctx.textAlign = 'left';
      }
    }

    if (refs.length === 0) {
      ctx.fillStyle = '#9a93b5';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No rooms yet - create one with "New room"', view.width / 2, view.height / 2);
      ctx.textAlign = 'left';
    }
  }
}
