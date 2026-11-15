/**
 * ANIMATION TAB - THE TIMELINE ("dope sheet")
 * -------------------------------------------
 * Time runs left to right. Each row is a bone (open it with the little
 * triangle to see its rotation / x / y / scale channels) or a slot's
 * see-through (alpha) track. Every diamond is a key.
 *
 *   drag the ruler ........ scrub the playhead
 *   click a diamond ....... select it (Shift/Ctrl adds), drag to move it in time
 *                           (snaps to 1/60 s frames; hold Alt to move freely)
 *   drag on empty space ... rubber-band select
 *   double-click a row .... add a key there
 *   top row ............... events ("step", "hit"...): double-click to add / rename
 *
 * Drawn on ONE canvas and only the rows on screen are painted, so it stays
 * fast with dozens of rows and hundreds of keys.
 */
import type { Keyframe } from '../../../shared/types';
import {
  BONE_CHANNELS, addEvent, getTrack, moveKeys, sameTime, sampleOffset, setKey, snapTime, updateEvent,
  type Channel, type KeyRef, type TrackRef,
} from '../logic/keyframes';
import { askText, fitCanvas, h } from '../ui/dom';
import type { AnimModel } from './model';

const LABEL_W = 148;
const RULER_H = 26;
const ROW_H = 22;
const PAD = 12; // space left/right of the time area so the first/last diamonds are not cut off
const KEY_R = 5.5;

type Row =
  | { type: 'events' }
  | { type: 'bone'; bone: string; depth: number; hasKeys: boolean }
  | { type: 'channel'; bone: string; channel: Channel }
  | { type: 'slot'; slot: string };

const CHANNEL_COLOR: Record<string, string> = {
  rotation: '#b58cff', x: '#6ee7ff', y: '#6ee7ff', scaleX: '#7be0a0', scaleY: '#7be0a0', alpha: '#ffc46b',
};
const CHANNEL_LABEL: Record<string, string> = { rotation: 'rotation', x: 'move x', y: 'move y', scaleX: 'scale x', scaleY: 'scale y', alpha: 'see-through' };

type Drag =
  | { kind: 'scrub' }
  | { kind: 'keys'; x: number; started: boolean; grabT: number; startAnim: NonNullable<AnimModel['anim']>; startRefs: KeyRef[] }
  | { kind: 'event'; x: number; started: boolean; startAnim: NonNullable<AnimModel['anim']>; index: number; t0: number }
  | { kind: 'box'; x: number; y: number; x1: number; y1: number; started: boolean; add: boolean };

export class Timeline {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private spacer: HTMLElement;
  private rows: Row[] = [];
  private w = 0;
  private h = 0;
  private drag: Drag | null = null;
  /** Show slots that have no alpha keys too. */
  showAllSlots = false;
  onDirty: () => void = () => {};
  /** Called when the user starts scrubbing or editing (playback should pause). */
  onInteract: () => void = () => {};

  constructor(private model: AnimModel) {
    this.canvas = h('canvas', { class: 'timeline-canvas', tabindex: 0, 'aria-label': 'Timeline: keys of the open animation' });
    this.spacer = h('div', { class: 'timeline-spacer' });
    this.el = h('div', { class: 'timeline-scroll', onscroll: () => this.onDirty() }, this.canvas, this.spacer);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => this.pointerUp(e));
    c.addEventListener('dblclick', (e) => void this.doubleClick(e));
    new ResizeObserver(() => { this.layout(); this.onDirty(); }).observe(this.el);
  }

  /* ---------------- rows & geometry ---------------- */

  /** Rebuild the list of rows (call when the rig, animation or expanded set changes). */
  rebuildRows(): void {
    const { rig, anim } = this.model;
    const rows: Row[] = [{ type: 'events' }];
    const depthOf = new Map<string, number>();
    for (const b of rig.bones) depthOf.set(b.name, b.parent ? (depthOf.get(b.parent) ?? 0) + 1 : 0);
    for (const b of rig.bones) {
      const track = anim?.bones[b.name];
      const hasKeys = !!track && BONE_CHANNELS.some((c) => track[c]?.length);
      rows.push({ type: 'bone', bone: b.name, depth: depthOf.get(b.name) ?? 0, hasKeys });
      if (this.model.expanded.has(b.name)) for (const channel of BONE_CHANNELS) rows.push({ type: 'channel', bone: b.name, channel });
    }
    for (const s of rig.slots) {
      if (this.showAllSlots || anim?.slots?.[s.name]?.alpha?.length) rows.push({ type: 'slot', slot: s.name });
    }
    this.rows = rows;
    this.layout();
  }

  private layout(): void {
    this.w = this.el.clientWidth;
    this.h = this.el.clientHeight;
    this.canvas.style.height = `${this.h}px`;
    const content = RULER_H + this.rows.length * ROW_H + 8;
    this.spacer.style.height = `${Math.max(0, content - this.h)}px`;
  }

  private get pxPerSec(): number {
    return Math.max(10, (this.w - LABEL_W - PAD * 2) / Math.max(this.model.duration, 0.05));
  }
  private timeToX(t: number): number { return LABEL_W + PAD + t * this.pxPerSec; }
  private xToTime(x: number): number { return (x - LABEL_W - PAD) / this.pxPerSec; }
  private rowY(i: number): number { return RULER_H + i * ROW_H - this.el.scrollTop; }
  private rowAt(y: number): number {
    if (y < RULER_H) return -1;
    const i = Math.floor((y - RULER_H + this.el.scrollTop) / ROW_H);
    return i >= 0 && i < this.rows.length ? i : -1;
  }

  /** The tracks a row stands for (a closed bone row stands for all its channels). */
  private rowTracks(row: Row): TrackRef[] {
    if (row.type === 'bone') return BONE_CHANNELS.map((channel) => ({ kind: 'bone' as const, target: row.bone, channel }));
    if (row.type === 'channel') return [{ kind: 'bone', target: row.bone, channel: row.channel }];
    if (row.type === 'slot') return [{ kind: 'slot', target: row.slot, channel: 'alpha' }];
    return [];
  }

  /** Scroll so the selected bone's row can be seen. */
  revealBone(bone: string): void {
    const i = this.rows.findIndex((r) => r.type === 'bone' && r.bone === bone);
    if (i < 0) return;
    // an open bone brings its channel rows along (as many as fit)
    const rowsWanted = this.model.expanded.has(bone) ? 1 + BONE_CHANNELS.length : 1;
    const top = i * ROW_H, view = this.h - RULER_H;
    const bottom = top + Math.min(rowsWanted * ROW_H, view);
    if (top < this.el.scrollTop) this.el.scrollTop = top;
    else if (bottom > this.el.scrollTop + view) this.el.scrollTop = bottom - view;
  }

  /* ---------------- drawing ---------------- */

  draw(): void {
    if (this.w < 50 || this.h < 30) return;
    const ctx = fitCanvas(this.canvas, this.w, this.h);
    const { model } = this;
    const anim = model.anim;
    const dur = model.duration;
    ctx.fillStyle = '#16131f';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!anim) return;
    const x0 = this.timeToX(0), x1 = this.timeToX(dur);
    const pps = this.pxPerSec;

    // rows
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const first = Math.max(0, Math.floor(this.el.scrollTop / ROW_H));
    const last = Math.min(this.rows.length - 1, Math.ceil((this.el.scrollTop + this.h) / ROW_H));
    for (let i = first; i <= last; i++) {
      const row = this.rows[i];
      const y = this.rowY(i);
      const cy = y + ROW_H / 2;
      const selected = (row.type === 'bone' || row.type === 'channel') && row.bone === model.selectedBone;
      ctx.fillStyle = row.type === 'events' ? '#231d2e' : selected ? '#2f2947' : row.type === 'channel' ? '#191622' : i % 2 ? '#1d1a29' : '#1a1724';
      ctx.fillRect(0, y, this.w, ROW_H);
      // the part of the row that is inside the animation
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x0, y, x1 - x0, ROW_H);

      // label
      ctx.textAlign = 'left';
      if (row.type === 'events') {
        ctx.fillStyle = '#ffc46b';
        ctx.fillText('⚑ events', 8, cy);
      } else if (row.type === 'bone') {
        const lx = 6 + Math.min(row.depth, 5) * 8;
        ctx.fillStyle = '#9a93b5';
        ctx.fillText(model.expanded.has(row.bone) ? '▾' : '▸', lx, cy);
        ctx.fillStyle = selected ? '#ffd45e' : row.hasKeys ? '#e8e4f5' : '#7a7396';
        ctx.fillText(row.bone, lx + 14, cy);
      } else if (row.type === 'channel') {
        ctx.fillStyle = CHANNEL_COLOR[row.channel];
        ctx.fillText(CHANNEL_LABEL[row.channel], 62, cy);
      } else {
        ctx.fillStyle = '#ffc46b';
        ctx.fillText(`◐ ${row.slot}`, 8, cy);
      }

      // keys
      if (row.type === 'events') {
        (anim.events ?? []).forEach((ev, idx) => {
          const x = this.timeToX(ev.t);
          const sel = model.selectedEvent === idx;
          ctx.fillStyle = sel ? '#ffffff' : '#ffc46b';
          ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + 9, y + 7.5); ctx.lineTo(x, y + 12); ctx.closePath(); ctx.fill();
          ctx.fillRect(x - 1, y + 3, 2, ROW_H - 6);
          ctx.fillStyle = sel ? '#ffffff' : '#d9c9a0';
          ctx.fillText(ev.name, x + 12, cy);
        });
        continue;
      }
      if (row.type === 'bone') {
        // one diamond per time at which ANY channel of the bone has a key
        const times: number[] = [];
        const track = anim.bones[row.bone];
        if (track) for (const c of BONE_CHANNELS) for (const k of track[c] ?? []) if (!times.some((t) => sameTime(t, k.t))) times.push(k.t);
        if (times.length > 1) this.spanLine(ctx, Math.min(...times), Math.max(...times), cy, 'rgba(232,228,245,0.18)');
        for (const t of times) {
          const keys = model.boneKeysAt(row.bone, t);
          const sel = keys.length > 0 && keys.every((k) => model.isKeySelected(k));
          this.diamond(ctx, this.timeToX(t), cy, KEY_R, sel ? '#ffffff' : '#cfc7ea', sel);
        }
        continue;
      }
      const ref = this.rowTracks(row)[0];
      const keys: Keyframe[] = getTrack(anim, ref) ?? [];
      const color = CHANNEL_COLOR[ref.channel];
      if (keys.length > 1) this.spanLine(ctx, keys[0].t, keys[keys.length - 1].t, cy, color + '55');
      for (const k of keys) {
        const sel = model.isKeySelected({ ...ref, t: k.t });
        this.diamond(ctx, this.timeToX(k.t), cy, KEY_R - 0.5, sel ? '#ffffff' : color, sel);
      }
    }

    // label column edge
    ctx.fillStyle = '#353048';
    ctx.fillRect(LABEL_W - 1, 0, 1, this.h);

    // ruler (always on top)
    ctx.fillStyle = '#211d2d';
    ctx.fillRect(0, 0, this.w, RULER_H);
    ctx.fillStyle = '#353048';
    ctx.fillRect(0, RULER_H - 1, this.w, 1);
    ctx.fillStyle = '#9a93b5';
    ctx.textAlign = 'left';
    ctx.fillText('seconds', 8, RULER_H / 2);
    const frame = pps / 60;
    const labelStep = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => s * pps >= 46) ?? 2;
    ctx.textAlign = 'center';
    const frames = Math.round(dur * 60);
    for (let f = 0; f <= frames; f++) {
      const t = f / 60;
      const x = Math.round(this.timeToX(t)) + 0.5;
      const onLabel = Math.abs(t / labelStep - Math.round(t / labelStep)) < 0.004;
      if (frame >= 5 || onLabel || f % 6 === 0) {
        ctx.strokeStyle = onLabel ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.045)';
        ctx.beginPath(); ctx.moveTo(x, onLabel ? RULER_H - 9 : RULER_H); ctx.lineTo(x, this.h); ctx.stroke();
      }
      if (onLabel) { ctx.fillStyle = '#9a93b5'; ctx.fillText(t.toFixed(2).replace(/0$/, ''), x, RULER_H / 2 - 2); }
    }
    // end of the animation
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x1 + 1, RULER_H, this.w - x1, this.h);
    ctx.strokeStyle = '#ff6b81';
    ctx.beginPath(); ctx.moveTo(Math.round(x1) + 0.5, 0); ctx.lineTo(Math.round(x1) + 0.5, this.h); ctx.stroke();

    // rubber band
    if (this.drag?.kind === 'box' && this.drag.started) {
      const d = this.drag;
      ctx.fillStyle = 'rgba(110,231,255,0.12)';
      ctx.strokeStyle = '#6ee7ff';
      const bx = Math.min(d.x, d.x1), by = Math.min(d.y, d.y1), bw = Math.abs(d.x1 - d.x), bh = Math.abs(d.y1 - d.y);
      ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    }

    // playhead
    const px = Math.round(this.timeToX(model.time)) + 0.5;
    ctx.strokeStyle = '#ff5d7a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 4); ctx.lineTo(px, this.h); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ff5d7a';
    ctx.beginPath(); ctx.moveTo(px - 7, 2); ctx.lineTo(px + 7, 2); ctx.lineTo(px + 7, 10); ctx.lineTo(px, 17); ctx.lineTo(px - 7, 10); ctx.closePath(); ctx.fill();
  }

  private spanLine(ctx: CanvasRenderingContext2D, t0: number, t1: number, cy: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(this.timeToX(t0), cy - 1, this.timeToX(t1) - this.timeToX(t0), 2);
  }

  private diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, selected: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = selected ? '#ff5d7a' : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /* ---------------- hit testing ---------------- */

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Keys under the pointer (a summary diamond returns every channel key at that time). */
  private keysAt(x: number, y: number): { row: Row; keys: KeyRef[]; t: number } | null {
    const anim = this.model.anim;
    const i = this.rowAt(y);
    if (!anim || i < 0 || x < LABEL_W) return null;
    const row = this.rows[i];
    let best: { keys: KeyRef[]; t: number } | null = null, bestD = KEY_R + 3;
    for (const ref of this.rowTracks(row)) {
      for (const k of getTrack(anim, ref) ?? []) {
        const d = Math.abs(this.timeToX(k.t) - x);
        if (d < bestD) { bestD = d; best = { keys: [], t: k.t }; }
      }
    }
    if (!best) return null;
    for (const ref of this.rowTracks(row)) {
      const k = getTrack(anim, ref)?.find((key) => sameTime(key.t, best!.t));
      if (k) best.keys.push({ ...ref, t: k.t });
    }
    return { row, ...best };
  }

  private eventAt(x: number, y: number): number {
    const i = this.rowAt(y);
    if (i < 0 || this.rows[i].type !== 'events') return -1;
    const events = this.model.anim?.events ?? [];
    let best = -1, bestD = 12;
    events.forEach((ev, idx) => {
      const ex = this.timeToX(ev.t);
      const d = x >= ex - 4 && x <= ex + 12 ? 0 : Math.abs(x - ex);
      if (d < bestD) { bestD = d; best = idx; }
    });
    return best;
  }

  /* ---------------- pointer handling ---------------- */

  private scrubTo(x: number, free: boolean): void {
    this.model.setTime(snapTime(Math.min(Math.max(this.xToTime(x), 0), this.model.duration), free));
  }

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.model.anim) return;
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
    const { model } = this;
    const anim = model.anim!;

    if (y < RULER_H) {
      if (x < LABEL_W) return;
      this.onInteract();
      this.drag = { kind: 'scrub' };
      this.scrubTo(x, e.altKey);
      return;
    }
    const i = this.rowAt(y);
    if (i < 0) { model.selectKeys([]); return; }
    const row = this.rows[i];

    // label column: open/close a bone, or select it
    if (x < LABEL_W) {
      if (row.type === 'bone') {
        const lx = 6 + Math.min(row.depth, 5) * 8;
        if (x < lx + 13) {
          if (model.expanded.has(row.bone)) model.expanded.delete(row.bone); else model.expanded.add(row.bone);
          this.rebuildRows();
          this.revealBone(row.bone);
          this.onDirty();
        } else model.selectBone(row.bone);
      } else if (row.type === 'channel') model.selectBone(row.bone);
      return;
    }

    if (row.type === 'events') {
      const idx = this.eventAt(x, y);
      if (idx >= 0) {
        this.onInteract();
        model.selectEvent(idx);
        this.drag = { kind: 'event', x, started: false, startAnim: anim, index: idx, t0: anim.events![idx].t };
        return;
      }
    }

    const hit = this.keysAt(x, y);
    if (hit) {
      this.onInteract();
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const already = hit.keys.every((k) => model.isKeySelected(k));
      const bone = hit.row.type === 'bone' || hit.row.type === 'channel' ? hit.row.bone : undefined;
      if (add) {
        const rest = model.selectedKeys.filter((k) => !hit.keys.some((q) => q.kind === k.kind && q.target === k.target && q.channel === k.channel && sameTime(q.t, k.t)));
        model.selectKeys(already ? rest : [...model.selectedKeys, ...hit.keys], bone);
      } else if (!already) model.selectKeys(hit.keys, bone);
      else if (bone) model.selectBone(bone);
      if (model.selectedKeys.length) {
        this.drag = { kind: 'keys', x, started: false, grabT: hit.t, startAnim: anim, startRefs: [...model.selectedKeys] };
      }
      return;
    }

    this.drag = { kind: 'box', x, y, x1: x, y1: y, started: false, add: e.shiftKey || e.ctrlKey || e.metaKey };
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const [x, y] = this.local(e);
    const { model } = this;
    if (d.kind === 'scrub') { this.scrubTo(x, e.altKey); return; }

    if (d.kind === 'keys') {
      if (!d.started && Math.abs(x - d.x) < 4) return;
      d.started = true;
      // Where should the grabbed key land? Snap THAT, then move the whole group by the same amount.
      const want = snapTime(Math.min(Math.max(d.grabT + (x - d.x) / this.pxPerSec, 0), model.duration), e.altKey);
      const res = moveKeys(d.startAnim, d.startRefs, want - d.grabT);
      model.selectedKeys = res.refs;
      if (res.anim !== model.anim) model.setAnim(res.anim, 'timeline-move');
      else this.onDirty();
      return;
    }
    if (d.kind === 'event') {
      if (!d.started && Math.abs(x - d.x) < 4) return;
      d.started = true;
      const t = snapTime(Math.min(Math.max(d.t0 + (x - d.x) / this.pxPerSec, 0), model.duration), e.altKey);
      const res = updateEvent(d.startAnim, d.index, { t });
      model.selectedEvent = res.index;
      model.setAnim(res.anim, 'timeline-event');
      return;
    }
    // rubber band
    d.x1 = x; d.y1 = y;
    if (!d.started && Math.hypot(x - d.x, y - d.y) < 5) return;
    d.started = true;
    const anim = model.anim!;
    const tMin = this.xToTime(Math.min(d.x, d.x1) - 3), tMax = this.xToTime(Math.max(d.x, d.x1) + 3);
    const rMin = Math.max(0, this.rowAt(Math.max(RULER_H, Math.min(d.y, d.y1))));
    let rMax = this.rowAt(Math.max(d.y, d.y1));
    if (rMax < 0) rMax = this.rows.length - 1;
    const picked: KeyRef[] = d.add ? [...model.selectedKeys] : [];
    for (let r = rMin; r <= rMax; r++) {
      for (const ref of this.rowTracks(this.rows[r])) {
        for (const k of getTrack(anim, ref) ?? []) if (k.t >= tMin && k.t <= tMax) picked.push({ ...ref, t: k.t });
      }
    }
    model.selectKeys(picked);
  }

  private pointerUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if ((d.kind === 'keys' || d.kind === 'event') && d.started) this.model.seal();
    if (d.kind === 'box' && !d.started) {
      // a plain click on empty space: move the playhead there and clear the selection
      this.onInteract();
      if (!d.add) this.model.selectKeys([]);
      this.scrubTo(d.x, e.altKey);
    }
    this.onDirty();
  }

  private async doubleClick(e: MouseEvent): Promise<void> {
    const [x, y] = this.local(e);
    const { model } = this;
    const anim = model.anim;
    const i = this.rowAt(y);
    if (!anim || i < 0 || x < LABEL_W) return;
    const row = this.rows[i];
    const t = snapTime(Math.min(Math.max(this.xToTime(x), 0), anim.duration), e.altKey);
    if (row.type === 'events') {
      const idx = this.eventAt(x, y);
      if (idx >= 0) {
        const name = await askText('Rename event', 'The game listens for these names (for example "step" makes a dust puff, "hit" is when an attack lands).', anim.events![idx].name);
        if (name && model.anim) model.setAnim(updateEvent(model.anim, idx, { name }).anim);
      } else {
        const name = await askText('New event', 'Name this moment (for example "step" or "hit"):', 'step');
        if (name && model.anim) { const res = addEvent(model.anim, t, name); model.setAnim(res.anim); model.selectEvent(res.index); }
      }
      return;
    }
    if (this.keysAt(x, y)) return; // double-click on an existing key: nothing to add
    const ref: TrackRef = row.type === 'slot' ? { kind: 'slot', target: row.slot, channel: 'alpha' }
      : { kind: 'bone', target: row.bone, channel: row.type === 'channel' ? row.channel : 'rotation' };
    const next = setKey(anim, ref, t, sampleOffset(anim, ref, t, model.rig));
    model.selectedKeys = [{ ...ref, t }];
    model.setAnim(next);
    if (ref.kind === 'bone') model.selectBone(ref.target);
    model.setTime(t);
    model.emit('selection');
  }
}
