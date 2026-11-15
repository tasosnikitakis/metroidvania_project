/**
 * Decor tool (D) and Entity tool (N).
 *
 * Both work the same way:
 *  - Pick something in the palette -> it follows the cursor as a ghost; click to place it
 *    (snaps to half tiles; hold Alt for free placement). Esc puts the "stamp" away.
 *  - With nothing picked: click to select, Shift+click to add to the selection,
 *    drag to move, drag on empty space for a selection box, arrow keys to nudge.
 *
 * The shared behaviour lives in ObjectTool; DecorTool and EntityTool fill in the details.
 */
import { TILE_SIZE, type DecorInstance, type EntityInstance, type RoomData } from '../../../shared/types';
import { entityType, type PropSchema } from '../../../shared/entities';
import { getImage } from '../render/assets';
import { decorCorners, decorHit, drawDecor } from '../render/decorGeom';
import type { Transaction } from '../state/editor';
import { ACCENT, type PointerInfo, type Tool, type ToolHost } from './tool';

const HALF = TILE_SIZE / 2;

/** Snap to the half-tile grid unless Alt is held. */
export function snap(v: number, free: boolean): number {
  return free ? Math.round(v) : Math.round(v / HALF) * HALF;
}

interface Placed { id: string; x: number; y: number }

abstract class ObjectTool<T extends Placed> implements Tool {
  protected drag: { tx: Transaction; startX: number; startY: number; primary: string; origin: Map<string, { x: number; y: number }>; moved: boolean } | null = null;
  protected marquee: { x0: number; y0: number; x1: number; y1: number; add: string[] } | null = null;

  constructor(protected host: ToolHost) {}

  protected abstract readonly kind: 'decor' | 'entity';
  protected abstract armed(): string | null;
  protected abstract disarm(): void;
  protected abstract list(room: RoomData): T[];
  protected abstract write(roomId: string, next: T[]): void;
  protected abstract hitTest(room: RoomData, p: PointerInfo): T | null;
  protected abstract place(key: string, x: number, y: number): void;
  protected abstract drawGhost(ctx: CanvasRenderingContext2D, key: string, x: number, y: number): void;
  protected abstract drawSelected(ctx: CanvasRenderingContext2D, item: T): void;
  /** Extra drag handles (entity extents). Return true if the press was taken. */
  protected handleDown(_p: PointerInfo): boolean { return false; }
  protected handleDrag(_p: PointerInfo): boolean { return false; }
  protected handleUp(): boolean { return false; }

  abstract hint(): string;

  cursor(): string { return this.armed() ? 'copy' : 'default'; }

  protected selectedIds(): string[] {
    const sel = this.host.editor.selection;
    return sel && sel.kind === this.kind ? sel.ids : [];
  }

  onDown(p: PointerInfo): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!room) return;
    const key = this.armed();
    if (key) {
      this.place(key, snap(p.x, p.alt), snap(p.y, p.alt));
      return;
    }
    if (this.handleDown(p)) return;
    const hit = this.hitTest(room, p);
    if (!hit) {
      this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: p.shift ? this.selectedIds() : [] };
      if (!p.shift) ed.select(null);
      return;
    }
    let ids = this.selectedIds();
    if (p.shift) ids = ids.includes(hit.id) ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
    else if (!ids.includes(hit.id)) ids = [hit.id];
    ed.select({ kind: this.kind, ids });
    if (!ids.includes(hit.id)) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const o of this.list(room)) if (ids.includes(o.id)) origin.set(o.id, { x: o.x, y: o.y });
    this.drag = { tx: ed.begin(this.kind === 'decor' ? 'Move decor' : 'Move entity'), startX: p.x, startY: p.y, primary: hit.id, origin, moved: false };
  }

  onDrag(p: PointerInfo): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!room) return;
    if (this.handleDrag(p)) return;
    if (this.marquee) {
      this.marquee.x1 = p.x;
      this.marquee.y1 = p.y;
      this.host.redraw();
      return;
    }
    const d = this.drag;
    if (!d) return;
    // Ignore tiny wobbles so a click does not nudge things.
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) * this.host.view.zoom < 4) return;
    d.moved = true;
    const first = d.origin.get(d.primary)!;
    // Snap the grabbed object, then move the others by the same amount.
    const dx = snap(first.x + (p.x - d.startX), p.alt) - first.x;
    const dy = snap(first.y + (p.y - d.startY), p.alt) - first.y;
    this.write(room.id, this.list(room).map((o) => {
      const from = d.origin.get(o.id);
      return from ? { ...o, x: from.x + dx, y: from.y + dy } : o;
    }));
  }

  onUp(p: PointerInfo): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (this.handleUp()) return;
    if (this.marquee && room) {
      const m = this.marquee;
      this.marquee = null;
      const x0 = Math.min(m.x0, m.x1);
      const x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1);
      const y1 = Math.max(m.y0, m.y1);
      if ((x1 - x0) * this.host.view.zoom > 4 || (y1 - y0) * this.host.view.zoom > 4) {
        const inside = this.list(room).filter((o) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1).map((o) => o.id);
        ed.select({ kind: this.kind, ids: [...new Set([...m.add, ...inside])] });
      }
      this.host.redraw();
    }
    if (this.drag) {
      if (this.drag.moved) this.drag.tx.commit();
      else this.drag.tx.cancel();
      this.drag = null;
      ed.events.emit('selection', 'ui');
    }
    void p;
  }

  onCancel(): void {
    this.drag?.tx.cancel();
    this.drag = null;
    this.marquee = null;
  }

  flush(): void { this.onCancel(); }

  onKey(e: KeyboardEvent): boolean {
    const ed = this.host.editor;
    const room = ed.room;
    if (e.key === 'Escape') {
      if (this.armed()) { this.disarm(); return true; }
      if (this.selectedIds().length > 0) { ed.select(null); return true; }
      return false;
    }
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[e.key];
    const ids = this.selectedIds();
    if (d && room && ids.length > 0) {
      // Arrows nudge by half a tile; Alt = 1 px for fine work; Shift = a whole tile.
      const n = e.altKey ? 1 : e.shiftKey ? TILE_SIZE : HALF;
      const tx = ed.begin('Nudge', `nudge:${ids.join(',')}`);
      this.write(room.id, this.list(room).map((o) => (ids.includes(o.id) ? { ...o, x: o.x + d[0] * n, y: o.y + d[1] * n } : o)));
      tx.commit();
      ed.events.emit('selection', 'ui');
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (!room) return;
    const ids = this.selectedIds();
    for (const o of this.list(room)) if (ids.includes(o.id)) this.drawSelected(ctx, o);
    const key = this.armed();
    if (key && hover) this.drawGhost(ctx, key, snap(hover.x, hover.alt), snap(hover.y, hover.alt));
    if (this.marquee) {
      const v = this.host.view;
      const m = this.marquee;
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = 'rgba(110,231,255,0.12)';
      ctx.setLineDash([5, 4]);
      const x = v.sx(Math.min(m.x0, m.x1));
      const y = v.sy(Math.min(m.y0, m.y1));
      const w = Math.abs(m.x1 - m.x0) * v.zoom;
      const h = Math.abs(m.y1 - m.y0) * v.zoom;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.restore();
    }
  }

  /** Switch the context to room space for a moment (for drawing room-sized things). */
  protected inRoomSpace(ctx: CanvasRenderingContext2D, fn: () => void): void {
    const v = this.host.view;
    ctx.save();
    ctx.translate(-v.x * v.zoom, -v.y * v.zoom);
    ctx.scale(v.zoom, v.zoom);
    fn();
    ctx.restore();
  }
}

/* ================================================================== */
/* Decor                                                               */
/* ================================================================== */

export class DecorTool extends ObjectTool<DecorInstance> {
  protected readonly kind = 'decor' as const;

  hint(): string {
    return this.armed()
      ? 'Click to place · snaps to half tiles (hold Alt for free placement) · Esc: stop placing'
      : 'Click decor to select, drag to move · Shift+click: select more · arrows nudge · Ctrl+D duplicate · Delete removes';
  }

  protected armed(): string | null { return this.host.editor.decorArmed; }
  protected disarm(): void { this.host.editor.armDecor(null); }
  protected list(room: RoomData): DecorInstance[] { return room.decor; }
  protected write(roomId: string, next: DecorInstance[]): void { this.host.editor.patchRoom(roomId, { decor: next }); }
  protected place(key: string, x: number, y: number): void { this.host.editor.placeDecor(key, x, y); }

  /** Topmost decor under the pointer: front layer first, and later items before earlier ones. */
  protected hitTest(room: RoomData, p: PointerInfo): DecorInstance | null {
    return pickDecor(this.host, room, p);
  }

  protected drawGhost(ctx: CanvasRenderingContext2D, key: string, x: number, y: number): void {
    const def = this.host.editor.decorDefs.get(key);
    if (!def) return;
    const ghost: DecorInstance = { id: '', key, x, y, layer: this.host.editor.decorLayer };
    this.inRoomSpace(ctx, () => drawDecor(ctx, getImage(def.image), def, ghost, 0.7));
    this.anchorDot(ctx, x, y);
  }

  protected drawSelected(ctx: CanvasRenderingContext2D, d: DecorInstance): void {
    const def = this.host.editor.decorDefs.get(d.key);
    const v = this.host.view;
    if (!def) return;
    const pts = decorCorners(def, d);
    ctx.save();
    ctx.beginPath();
    pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(v.sx(pt.x), v.sy(pt.y)) : ctx.lineTo(v.sx(pt.x), v.sy(pt.y))));
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    ctx.restore();
    this.anchorDot(ctx, d.x, d.y);
  }

  /** The little cross that shows exactly where the decor's anchor point is. */
  private anchorDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const v = this.host.view;
    const sx = v.sx(x);
    const sy = v.sy(y);
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy);
    ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 6);
    ctx.stroke();
    ctx.strokeStyle = '#ffd27a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export function pickDecor(host: ToolHost, room: RoomData, p: PointerInfo): DecorInstance | null {
  if (!host.editor.view.decor) return null;
  const pad = 4 / host.view.zoom;
  for (const layer of ['front', 'back', 'far'] as const) {
    for (let i = room.decor.length - 1; i >= 0; i--) {
      const d = room.decor[i];
      if (d.layer !== layer) continue;
      const def = host.editor.decorDefs.get(d.key);
      if (def ? decorHit(def, d, p.x, p.y, pad) : Math.abs(p.x - d.x) < 20 && p.y > d.y - 40 && p.y < d.y) return d;
    }
  }
  return null;
}

/* ================================================================== */
/* Entities                                                            */
/* ================================================================== */

/** The game treats a particle area as centred on the entity position. */
type HandleId = 'radius' | 'width' | 'height' | 'both';

export function entityRadius(zoom: number): number {
  return Math.max(15, 11 / zoom);
}

export function pickEntity(host: ToolHost, room: RoomData, p: PointerInfo): EntityInstance | null {
  if (!host.editor.view.entities) return null;
  const r = entityRadius(host.view.zoom) + 3 / host.view.zoom;
  let best: EntityInstance | null = null;
  let bestD = r;
  for (const e of room.entities) {
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d <= bestD) { best = e; bestD = d; }
  }
  return best;
}

export class EntityTool extends ObjectTool<EntityInstance> {
  protected readonly kind = 'entity' as const;
  private handle: { id: HandleId; entity: string; tx: Transaction } | null = null;

  hint(): string {
    return this.armed()
      ? 'Click to place · snaps to half tiles (hold Alt for free placement) · Esc: stop placing'
      : 'Click an entity to select, drag to move · drag the round handles to resize lights and particle areas · Delete removes';
  }

  protected armed(): string | null { return this.host.editor.entityArmed; }
  protected disarm(): void { this.host.editor.armEntity(null); }
  protected list(room: RoomData): EntityInstance[] { return room.entities; }
  protected write(roomId: string, next: EntityInstance[]): void { this.host.editor.patchRoom(roomId, { entities: next }); }
  protected place(key: string, x: number, y: number): void { this.host.editor.placeEntity(key, x, y); }
  protected hitTest(room: RoomData, p: PointerInfo): EntityInstance | null { return pickEntity(this.host, room, p); }

  /** Where the drag handles of the single selected entity are, in room px. */
  private handles(): Array<{ id: HandleId; x: number; y: number; entity: EntityInstance }> {
    const selected = this.host.editor.selectedEntities();
    if (selected.length !== 1) return [];
    const e = selected[0];
    if (e.type === 'light' && typeof e.props.radius === 'number') {
      return [{ id: 'radius', x: e.x + e.props.radius, y: e.y, entity: e }];
    }
    if (e.type === 'particles' && typeof e.props.width === 'number' && typeof e.props.height === 'number') {
      const hw = e.props.width / 2;
      const hh = e.props.height / 2;
      return [
        { id: 'width', x: e.x + hw, y: e.y, entity: e },
        { id: 'height', x: e.x, y: e.y + hh, entity: e },
        { id: 'both', x: e.x + hw, y: e.y + hh, entity: e },
      ];
    }
    return [];
  }

  protected handleDown(p: PointerInfo): boolean {
    const grab = 10 / this.host.view.zoom;
    for (const h of this.handles()) {
      if (Math.hypot(p.x - h.x, p.y - h.y) <= grab) {
        this.handle = { id: h.id, entity: h.entity.id, tx: this.host.editor.begin('Resize ' + (h.id === 'radius' ? 'light' : 'particle area')) };
        return true;
      }
    }
    return false;
  }

  protected handleDrag(p: PointerInfo): boolean {
    const h = this.handle;
    const room = this.host.editor.room;
    if (!h || !room) return false;
    const e = room.entities.find((o) => o.id === h.entity);
    const schema = entityType(e?.type ?? '')?.props;
    if (!e || !schema) return true;
    const fit = (key: string, value: number): number => {
      const s: PropSchema | undefined = schema[key];
      if (!s || s.kind !== 'number') return value;
      const step = s.step ?? 1;
      return Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, Math.round(value / step) * step));
    };
    const props = { ...e.props };
    if (h.id === 'radius') props.radius = fit('radius', Math.hypot(p.x - e.x, p.y - e.y));
    if (h.id === 'width' || h.id === 'both') props.width = fit('width', Math.abs(p.x - e.x) * 2);
    if (h.id === 'height' || h.id === 'both') props.height = fit('height', Math.abs(p.y - e.y) * 2);
    this.write(room.id, room.entities.map((o) => (o.id === e.id ? { ...o, props } : o)));
    return true;
  }

  protected handleUp(): boolean {
    if (!this.handle) return false;
    this.handle.tx.commit();
    this.handle = null;
    this.host.editor.events.emit('selection', 'ui');
    return true;
  }

  onCancel(): void {
    this.handle?.tx.cancel();
    this.handle = null;
    super.onCancel();
  }

  protected drawGhost(ctx: CanvasRenderingContext2D, key: string, x: number, y: number): void {
    const def = entityType(key);
    const v = this.host.view;
    const r = entityRadius(v.zoom) * v.zoom;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(v.sx(x), v.sy(y), r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,18,28,0.8)';
    ctx.fill();
    ctx.strokeStyle = def?.color ?? '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = def?.color ?? '#fff';
    ctx.font = `${r * 1.15}px system-ui, "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def?.glyph ?? '?', v.sx(x), v.sy(y));
    ctx.restore();
  }

  protected drawSelected(ctx: CanvasRenderingContext2D, e: EntityInstance): void {
    const v = this.host.view;
    const color = entityType(e.type)?.color ?? '#fff';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    if (e.type === 'light' && typeof e.props.radius === 'number') {
      const lightColor = typeof e.props.color === 'string' ? e.props.color : color;
      ctx.strokeStyle = lightColor;
      ctx.beginPath();
      ctx.arc(v.sx(e.x), v.sy(e.y), e.props.radius * v.zoom, 0, Math.PI * 2);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = lightColor;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    if (e.type === 'particles' && typeof e.props.width === 'number' && typeof e.props.height === 'number') {
      const w = e.props.width * v.zoom;
      const h = e.props.height * v.zoom;
      ctx.fillStyle = 'rgba(201,160,255,0.1)';
      ctx.fillRect(v.sx(e.x) - w / 2, v.sy(e.y) - h / 2, w, h);
      ctx.strokeRect(v.sx(e.x) - w / 2, v.sy(e.y) - h / 2, w, h);
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    super.draw(ctx, hover);
    const v = this.host.view;
    for (const h of this.handles()) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(v.sx(h.x), v.sy(h.y), 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#17102a';
      ctx.stroke();
      ctx.restore();
    }
  }
}
