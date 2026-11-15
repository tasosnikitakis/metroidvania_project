/**
 * ANIMATION TAB - THE STAGE
 * -------------------------
 * A Canvas2D picture of the hero, drawn with the same pose maths the game uses
 * (src/rig/pose.ts). You can pan (drag empty space / right-drag), zoom (mouse
 * wheel) and POSE: click a body part to select its bone, then drag to rotate,
 * move or scale it (depending on the tool). Posing writes a key at the playhead.
 *
 * Reminder: key values are OFFSETS from the setup pose. Dragging an arm round by
 * 30° adds 30 to whatever its rotation offset was at that moment.
 */
import type { RigData } from '../../../shared/types';
import {
  angleDelta, computeBoneMatrices, computeWorldTransforms, drawRigToCanvas, sampleAnimation,
  type LocalPose, type SlotTransform,
} from '../../../rig/pose';
import { keyTimes, sampleOffset, setKey, type TrackRef } from '../logic/keyframes';
import { fitCanvas } from '../ui/dom';
import type { AnimModel } from './model';

export interface StageView {
  showBones: boolean;
  onion: boolean;
  showBox: boolean;
  flip: boolean;
  background: string;
}

export const BACKGROUNDS: Array<{ name: string; color: string; dark: boolean }> = [
  { name: 'Night', color: '#17141f', dark: true },
  { name: 'Dusk', color: '#4a4666', dark: true },
  { name: 'Moss', color: '#5f7a66', dark: true },
  { name: 'Paper', color: '#d9d3e8', dark: false },
];

type Drag =
  | { kind: 'pan'; x: number; y: number; panX: number; panY: number }
  | {
      kind: 'pose'; bone: string; boneIndex: number; mode: 'rotate' | 'move' | 'scaleX' | 'scaleY' | 'scaleBoth';
      x: number; y: number; started: boolean;
      startAnim: NonNullable<AnimModel['anim']>; time: number;
      start: { rotation: number; x: number; y: number; scaleX: number; scaleY: number };
      lastAngle: number; turned: number;
      /** bone origin on screen + parent matrix at drag start */
      ox: number; oy: number; pa: number; pb: number; pc: number; pd: number; spin: number;
    };

const HANDLE = 7;

export class Stage {
  readonly canvas: HTMLCanvasElement;
  view: StageView = { showBones: true, onion: false, showBox: false, flip: false, background: BACKGROUNDS[0].color };
  zoom = 4;
  panX = 0;
  panY = 0;
  /** When true (sequence tester running) posing is switched off. */
  locked = false;
  onDirty: () => void = () => {};
  onPoseStart: () => void = () => {};
  /** Text shown in the corner while dragging, e.g. "armF rotation +12°". */
  hud = '';

  private w = 0;
  private h = 0;
  private drag: Drag | null = null;
  private pose: LocalPose = { bones: [], slotAlpha: [] };
  private matrices: number[] = [];
  private transforms: SlotTransform[] = [];
  private ghostPose: LocalPose = { bones: [], slotAlpha: [] };
  private ghostCanvas = document.createElement('canvas');
  private masks = new Map<string, { w: number; h: number; data: Uint8ClampedArray } | null>();
  private userMoved = false;

  constructor(
    private model: AnimModel,
    private images: Map<string, HTMLImageElement>,
    private getBox: () => { w: number; h: number },
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Hero stage: click a body part and drag to pose it');
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => this.pointerUp(e));
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dblclick', (e) => { const [x, y] = this.local(e); if (!this.pickBone(x, y)) { this.fit(); this.onDirty(); } });
  }

  /* ---------------- coordinates ---------------- */
  private get facing(): 1 | -1 { return this.view.flip ? -1 : 1; }
  private get originX(): number { return this.w / 2 + this.panX; }
  private get originY(): number { return this.h * 0.82 + this.panY; }
  private toScreen(wx: number, wy: number): [number, number] {
    return [this.originX + wx * this.zoom * this.facing, this.originY + wy * this.zoom];
  }
  private toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.originX) / (this.zoom * this.facing), (sy - this.originY) / this.zoom];
  }

  /** Zoom so the whole hero fits comfortably. */
  fit(): void {
    this.panX = 0; this.panY = 0;
    this.userMoved = false;
    this.zoom = Math.max(1, Math.min(10, (this.h * 0.66) / 78));
  }

  resize(cssW: number, cssH: number): void {
    this.w = cssW; this.h = cssH;
    // Until the user pans or zooms by hand, keep the hero nicely framed.
    if (!this.userMoved && cssH > 50) this.fit();
  }

  /* ---------------- drawing ---------------- */

  draw(pose: LocalPose): void {
    if (this.w < 10 || this.h < 10) return;
    const rig = this.model.rig;
    this.pose = pose;
    computeBoneMatrices(rig, pose, this.matrices);
    computeWorldTransforms(rig, pose, this.transforms);

    const ctx = fitCanvas(this.canvas, this.w, this.h);
    const bg = BACKGROUNDS.find((b) => b.color === this.view.background) ?? BACKGROUNDS[0];
    const ink = bg.dark ? '255,255,255' : '20,16,40';
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, this.w, this.h);

    // faint tile grid (48 px squares) + the ground line
    const tile = 48 * this.zoom;
    ctx.strokeStyle = `rgba(${ink},0.06)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ((this.originX % tile) + tile) % tile; x < this.w; x += tile) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, this.h); }
    for (let y = ((this.originY % tile) + tile) % tile; y < this.h; y += tile) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(this.w, Math.round(y) + 0.5); }
    ctx.stroke();
    ctx.fillStyle = `rgba(${ink},0.07)`;
    ctx.fillRect(0, this.originY, this.w, this.h - this.originY);
    ctx.strokeStyle = `rgba(${ink},0.45)`;
    ctx.beginPath(); ctx.moveTo(0, Math.round(this.originY) + 0.5); ctx.lineTo(this.w, Math.round(this.originY) + 0.5); ctx.stroke();

    if (this.view.onion && !this.locked) this.drawOnionSkins(ctx);

    // the hero
    ctx.save();
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.zoom * this.facing, this.zoom);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawRigToCanvas(ctx, rig, this.transforms, this.images);
    ctx.restore();

    if (this.view.showBox) {
      const box = this.getBox();
      const [x0, y0] = this.toScreen(-box.w / 2 * this.facing, -box.h);
      ctx.strokeStyle = '#7be0a0';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, box.w * this.zoom, box.h * this.zoom);
      ctx.setLineDash([]);
      ctx.fillStyle = '#7be0a0';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`collision box ${box.w}×${box.h}`, x0 + 4, y0 - 5);
    }

    if (this.view.showBones) this.drawBones(ctx, rig, bg.dark);
    this.drawGizmo(ctx, rig);

    if (this.hud) {
      ctx.font = '600 13px system-ui, sans-serif';
      const tw = ctx.measureText(this.hud).width;
      ctx.fillStyle = 'rgba(16,14,23,0.8)';
      ctx.fillRect(8, this.h - 32, tw + 16, 24);
      ctx.fillStyle = '#fff';
      ctx.fillText(this.hud, 16, this.h - 15);
    }
  }

  /** Ghosts of the previous (blue) and next (orange) key poses. */
  private drawOnionSkins(ctx: CanvasRenderingContext2D): void {
    const anim = this.model.anim;
    if (!anim) return;
    const times = keyTimes(anim);
    const t = this.model.time;
    let prev = [...times].reverse().find((k) => k < t - 0.0005);
    let next = times.find((k) => k > t + 0.0005);
    if (anim.loop && times.length > 1) { prev ??= times[times.length - 1]; next ??= times[0]; }
    const ghosts: Array<[number | undefined, string]> = [[prev, '#58b7ff'], [next, '#ffa24a']];
    const dpr = this.canvas.width / this.w;
    const g = this.ghostCanvas;
    if (g.width !== this.canvas.width || g.height !== this.canvas.height) { g.width = this.canvas.width; g.height = this.canvas.height; }
    const gctx = g.getContext('2d')!;
    for (const [time, color] of ghosts) {
      if (time === undefined) continue;
      sampleAnimation(this.model.rig, anim, time, this.ghostPose);
      const tr = computeWorldTransforms(this.model.rig, this.ghostPose);
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.globalCompositeOperation = 'source-over';
      gctx.clearRect(0, 0, g.width, g.height);
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gctx.translate(this.originX, this.originY);
      gctx.scale(this.zoom * this.facing, this.zoom);
      drawRigToCanvas(gctx, this.model.rig, tr.filter((s) => !s.slot.additive), this.images);
      // tint: paint the colour only where the ghost has pixels
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.globalCompositeOperation = 'source-atop';
      gctx.globalAlpha = 0.7;
      gctx.fillStyle = color;
      gctx.fillRect(0, 0, g.width, g.height);
      gctx.globalAlpha = 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(g, 0, 0);
      ctx.restore();
    }
  }

  private boneScreen(i: number): { ox: number; oy: number; tx: number; ty: number } {
    const m = this.matrices, o = i * 6;
    const len = this.model.rig.bones[i].length ?? 0;
    const [ox, oy] = this.toScreen(m[o + 4], m[o + 5]);
    const [tx, ty] = this.toScreen(m[o + 4] + m[o] * len, m[o + 5] + m[o + 1] * len);
    return { ox, oy, tx, ty };
  }

  private drawBones(ctx: CanvasRenderingContext2D, rig: RigData, dark: boolean): void {
    const sel = this.model.selectedBone;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      rig.bones.forEach((b, i) => {
        const isSel = b.name === sel;
        if ((pass === 1) !== isSel) return; // selected bone drawn last, on top
        const { ox, oy, tx, ty } = this.boneScreen(i);
        const color = isSel ? '#ffd45e' : dark ? 'rgba(255,255,255,0.75)' : 'rgba(40,30,80,0.8)';
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = isSel ? 6 : 4;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = isSel ? 3.5 : 2;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ox, oy, isSel ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
  }

  /** Where the scale handles sit on screen for bone i. */
  private scaleHandles(i: number): { x: [number, number]; y: [number, number] } {
    const { ox, oy, tx, ty } = this.boneScreen(i);
    let dx = tx - ox, dy = ty - oy;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      // zero-length bone: use its x axis direction
      const o = i * 6;
      dx = this.matrices[o] * this.facing; dy = this.matrices[o + 1];
    }
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    const reach = Math.max(len, 24) + 16;
    return { x: [ox + dx * reach, oy + dy * reach], y: [ox - dy * 34, oy + dx * 34] };
  }

  private drawGizmo(ctx: CanvasRenderingContext2D, rig: RigData): void {
    const i = rig.bones.findIndex((b) => b.name === this.model.selectedBone);
    if (i < 0 || this.locked) return;
    const { ox, oy } = this.boneScreen(i);
    ctx.lineWidth = 2;
    if (this.model.tool === 'rotate') {
      ctx.strokeStyle = 'rgba(255,212,94,0.55)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(ox, oy, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (this.model.tool === 'move') {
      ctx.strokeStyle = '#6ee7ff';
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(ox + dx * 9, oy + dy * 9); ctx.lineTo(ox + dx * 24, oy + dy * 24);
        ctx.moveTo(ox + dx * 24, oy + dy * 24); ctx.lineTo(ox + dx * 18 + dy * 5, oy + dy * 18 + dx * 5);
        ctx.moveTo(ox + dx * 24, oy + dy * 24); ctx.lineTo(ox + dx * 18 - dy * 5, oy + dy * 18 - dx * 5);
      }
      ctx.stroke();
    } else {
      const hnd = this.scaleHandles(i);
      for (const [p, color] of [[hnd.x, '#ff8fa3'], [hnd.y, '#7be0a0']] as Array<[[number, number], string]>) {
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p[0], p[1]); ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeStyle = '#17141f';
        ctx.fillRect(p[0] - HANDLE, p[1] - HANDLE, HANDLE * 2, HANDLE * 2);
        ctx.strokeRect(p[0] - HANDLE, p[1] - HANDLE, HANDLE * 2, HANDLE * 2);
      }
    }
  }

  /* ---------------- picking ---------------- */

  /** See-through test: is this spot of the image actually painted? */
  private opaqueAt(url: string, u: number, v: number): boolean {
    let mask = this.masks.get(url);
    if (mask === undefined) {
      const img = this.images.get(url);
      if (!img || !img.complete || !img.naturalWidth) return true; // not loaded yet: treat the whole box as solid
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const cx = c.getContext('2d', { willReadFrequently: true })!;
        cx.drawImage(img, 0, 0);
        mask = { w: c.width, h: c.height, data: cx.getImageData(0, 0, c.width, c.height).data };
      } catch { mask = null; }
      this.masks.set(url, mask);
    }
    if (!mask) return true;
    const px = Math.min(mask.w - 1, Math.max(0, Math.floor(u * mask.w)));
    const py = Math.min(mask.h - 1, Math.max(0, Math.floor(v * mask.h)));
    return mask.data[(py * mask.w + px) * 4 + 3] > 24;
  }

  /** Which bone is under the pointer? Bone joints win (when shown), then the top-most painted body part. */
  pickBone(sx: number, sy: number): string | null {
    const rig = this.model.rig;
    if (this.view.showBones) {
      let best = -1, bestD = 9;
      for (let i = rig.bones.length - 1; i >= 0; i--) {
        const { ox, oy } = this.boneScreen(i);
        const d = Math.hypot(sx - ox, sy - oy);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) return rig.bones[best].name;
    }
    const [wx, wy] = this.toWorld(sx, sy);
    for (let i = this.transforms.length - 1; i >= 0; i--) {
      const t = this.transforms[i], s = t.slot;
      if (s.additive || t.alpha < 0.05) continue;
      const det = t.a * t.d - t.b * t.c;
      if (Math.abs(det) < 1e-9) continue;
      const dx = wx - t.tx, dy = wy - t.ty;
      const lx = (t.d * dx - t.c * dy) / det, ly = (-t.b * dx + t.a * dy) / det;
      const u = lx / s.w + s.originX, v = ly / s.h + s.originY;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (this.opaqueAt(s.image, u, v)) return s.bone;
    }
    if (this.view.showBones) {
      // near a bone's line?
      let best = -1, bestD = 7;
      rig.bones.forEach((_, i) => {
        const { ox, oy, tx, ty } = this.boneScreen(i);
        const vx = tx - ox, vy = ty - oy, len2 = vx * vx + vy * vy;
        if (len2 < 1) return;
        const k = Math.min(1, Math.max(0, ((sx - ox) * vx + (sy - oy) * vy) / len2));
        const d = Math.hypot(sx - ox - vx * k, sy - oy - vy * k);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) return rig.bones[best].name;
    }
    return null;
  }

  /* ---------------- pointer handling ---------------- */

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private pointerDown(e: PointerEvent): void {
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
    const startPan = () => { this.drag = { kind: 'pan', x, y, panX: this.panX, panY: this.panY }; this.canvas.classList.add('panning'); };
    if (e.button !== 0 || this.locked || !this.model.anim) { startPan(); e.preventDefault(); return; }

    const rig = this.model.rig;
    let mode: 'rotate' | 'move' | 'scaleX' | 'scaleY' | 'scaleBoth' = this.model.tool === 'scale' ? 'scaleBoth' : this.model.tool;
    let bone: string | null = null;
    // Scale handles belong to the bone that is already selected.
    const selIndex = rig.bones.findIndex((b) => b.name === this.model.selectedBone);
    if (this.model.tool === 'scale' && selIndex >= 0) {
      const hnd = this.scaleHandles(selIndex);
      if (Math.hypot(x - hnd.x[0], y - hnd.x[1]) <= HANDLE + 4) { bone = rig.bones[selIndex].name; mode = 'scaleX'; }
      else if (Math.hypot(x - hnd.y[0], y - hnd.y[1]) <= HANDLE + 4) { bone = rig.bones[selIndex].name; mode = 'scaleY'; }
    }
    bone ??= this.pickBone(x, y);
    if (!bone) { startPan(); return; }
    this.model.selectBone(bone);
    const i = rig.bones.findIndex((b) => b.name === bone);
    const anim = this.model.anim;
    const t = this.model.time;
    const off = (channel: TrackRef['channel']) => sampleOffset(anim, { kind: 'bone', target: bone!, channel }, t, rig);
    const { ox, oy } = this.boneScreen(i);
    // parent matrix (identity for the root) - needed to turn screen movement into the bone's own x/y
    const parentIndex = rig.bones.findIndex((b) => b.name === rig.bones[i].parent);
    let pa = 1, pb = 0, pc = 0, pd = 1;
    if (parentIndex >= 0) { const q = parentIndex * 6; pa = this.matrices[q]; pb = this.matrices[q + 1]; pc = this.matrices[q + 2]; pd = this.matrices[q + 3]; }
    const det = pa * pd - pb * pc;
    this.drag = {
      kind: 'pose', bone, boneIndex: i, mode, x, y, started: false, startAnim: anim, time: t,
      start: { rotation: off('rotation'), x: off('x'), y: off('y'), scaleX: off('scaleX'), scaleY: off('scaleY') },
      lastAngle: Math.atan2(y - oy, x - ox), turned: 0, ox, oy, pa, pb, pc, pd,
      // a mirrored view (or a mirrored parent) reverses which way "clockwise" is
      spin: this.facing * (det < 0 ? -1 : 1),
    };
    this.onDirty();
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const [x, y] = this.local(e);
    if (d.kind === 'pan') {
      this.panX = d.panX + (x - d.x); this.panY = d.panY + (y - d.y);
      this.userMoved = true;
      this.onDirty();
      return;
    }
    if (!d.started) {
      if (Math.hypot(x - d.x, y - d.y) < 4) return; // a click, not a drag (yet)
      d.started = true;
      // The drag really begins now: stop playback and work from the frame that is showing.
      this.onPoseStart();
      const now = this.model.anim;
      if (!now) return;
      d.startAnim = now;
      d.time = this.model.time;
      const at = (channel: TrackRef['channel']) => sampleOffset(now, { kind: 'bone', target: d.bone, channel }, d.time, this.model.rig);
      d.start = { rotation: at('rotation'), x: at('x'), y: at('y'), scaleX: at('scaleX'), scaleY: at('scaleY') };
    }
    const bone = d.bone;
    const ref = (channel: TrackRef['channel']): TrackRef => ({ kind: 'bone', target: bone, channel });
    let anim = d.startAnim;
    const sign = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
    if (d.mode === 'rotate') {
      const a = Math.atan2(y - d.oy, x - d.ox);
      d.turned += angleDelta((d.lastAngle * 180) / Math.PI, (a * 180) / Math.PI);
      d.lastAngle = a;
      let v = d.start.rotation + d.turned * d.spin;
      if (e.shiftKey) v = Math.round(v / 5) * 5; // Shift = snap to 5 degree steps
      anim = setKey(anim, ref('rotation'), d.time, v);
      this.hud = `${bone}  rotation ${sign(v)}°`;
    } else if (d.mode === 'move') {
      const wdx = (x - d.x) / (this.zoom * this.facing), wdy = (y - d.y) / this.zoom;
      const det = d.pa * d.pd - d.pb * d.pc || 1;
      const lx = (d.pd * wdx - d.pc * wdy) / det, ly = (-d.pb * wdx + d.pa * wdy) / det;
      const nx = d.start.x + lx, ny = d.start.y + ly;
      anim = setKey(setKey(anim, ref('x'), d.time, nx), ref('y'), d.time, ny);
      this.hud = `${bone}  move x ${sign(nx)}  y ${sign(ny)}`;
    } else {
      const d0 = Math.hypot(d.x - d.ox, d.y - d.oy), d1 = Math.hypot(x - d.ox, y - d.oy);
      const ratio = d0 > 6 ? d1 / d0 : 1 + (d.y - y) / 80;
      const clamp = (v: number) => Math.min(10, Math.max(0.05, v));
      let sx = d.start.scaleX, sy = d.start.scaleY;
      if (d.mode !== 'scaleY') { sx = clamp(sx * ratio); anim = setKey(anim, ref('scaleX'), d.time, sx); }
      if (d.mode !== 'scaleX') { sy = clamp(sy * ratio); anim = setKey(anim, ref('scaleY'), d.time, sy); }
      this.hud = `${bone}  scale ${sx.toFixed(2)} × ${sy.toFixed(2)}`;
    }
    this.model.setAnim(anim, 'stage-pose');
  }

  private pointerUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.classList.remove('panning');
    if (this.drag?.kind === 'pose' && this.drag.started) this.model.seal();
    this.drag = null;
    this.hud = '';
    this.onDirty();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [x, y] = this.local(e);
    const [wx, wy] = this.toWorld(x, y);
    this.zoom = Math.min(16, Math.max(0.8, this.zoom * Math.exp(-e.deltaY * 0.0015)));
    // keep the point under the cursor still
    const [nx, ny] = this.toScreen(wx, wy);
    this.panX += x - nx; this.panY += y - ny;
    this.userMoved = true;
    this.onDirty();
  }

  /** Call when a slot image finishes loading. */
  imagesChanged(): void { this.masks.clear(); this.onDirty(); }
}
