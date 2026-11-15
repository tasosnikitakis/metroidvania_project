/**
 * RIG POSE MATH - pure TypeScript, no Phaser, no DOM types required at runtime.
 * (Only erasable TS syntax here: Node can import this file directly for the art preview tools.)
 *
 *   sampleAnimation(rig, anim, time)  -> LocalPose  (per-bone local transforms + per-slot alpha)
 *   blendPoses(a, b, t)               -> LocalPose  (cross-fade, shortest-arc rotations)
 *   computeWorldTransforms(rig, pose) -> SlotTransform[] in draw order
 *   collectEvents(anim, t0, t1)       -> event names fired in (t0, t1]
 *   drawRigToCanvas(ctx, rig, slotTransforms, images)
 *
 * Conventions (see src/shared/types.ts): y is DOWN, rotations are degrees and
 * positive = clockwise on screen. Keyframe values are OFFSETS from the setup pose.
 */
import type { AnimData, BoneChannel, EaseName, Keyframe, RigData, SlotDef } from '../shared/types.ts';

/* ------------------------------------------------------------------ */
/* Easing                                                               */
/* ------------------------------------------------------------------ */

const { PI, sin, cos, pow, sqrt, atan2 } = Math;

export const EASINGS: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  step: (t) => (t >= 1 ? 1 : 0),
  sineIn: (t) => 1 - cos((t * PI) / 2),
  sineOut: (t) => sin((t * PI) / 2),
  sineInOut: (t) => 0.5 - 0.5 * cos(PI * t),
  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  cubicIn: (t) => t * t * t,
  cubicOut: (t) => 1 - pow(1 - t, 3),
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - 4 * pow(1 - t, 3)),
  backOut: (t) => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
  elasticOut: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : pow(2, -10 * t) * sin(((t * 10 - 0.75) * 2 * PI) / 3) + 1),
};
export const EASE_NAMES = Object.keys(EASINGS) as EaseName[];
export const DEFAULT_EASE: EaseName = 'sineInOut';

export function ease(name: EaseName | undefined, t: number): number {
  const f = EASINGS[name ?? DEFAULT_EASE] ?? EASINGS.sineInOut;
  return f(t < 0 ? 0 : t > 1 ? 1 : t);
}

/* ------------------------------------------------------------------ */
/* Pose types                                                           */
/* ------------------------------------------------------------------ */

export interface BonePose { x: number; y: number; rotation: number; scaleX: number; scaleY: number }

/** Local pose: `bones[i]` belongs to `rig.bones[i]`, `slotAlpha[i]` to `rig.slots[i]`. */
export interface LocalPose { bones: BonePose[]; slotAlpha: number[] }

/** World placement of one slot image. `a,b,c,d,tx,ty` is the exact affine matrix
 *  (x' = a*x + c*y + tx, y' = b*x + d*y + ty); x/y/rotation/scale are its
 *  decomposition (any shear is dropped) for engines that want TRS values. */
export interface SlotTransform {
  slot: SlotDef;
  x: number; y: number;
  /** degrees */
  rotation: number;
  scaleX: number; scaleY: number;
  alpha: number;
  a: number; b: number; c: number; d: number; tx: number; ty: number;
}

const DEG = PI / 180;
export const wrapTime = (t: number, duration: number): number => {
  if (duration <= 0) return 0;
  const m = t % duration;
  return m < 0 ? m + duration : m;
};
/** Shortest signed angular difference b - a in degrees, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360; else if (d <= -180) d += 360;
  return d;
}
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

/* ------------------------------------------------------------------ */
/* Keyframe sampling                                                    */
/* ------------------------------------------------------------------ */

/**
 * Sample a keyframe track at `time`.
 * Looping tracks interpolate from the last key across the loop boundary to the
 * first key, so loops are seamless even if no key sits exactly at 0 / duration.
 */
export function sampleTrack(keys: Keyframe[] | undefined, time: number, duration: number, loop: boolean, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  const n = keys.length;
  if (n === 1) return keys[0].v;
  const t = loop ? wrapTime(time, duration) : time;
  const first = keys[0], last = keys[n - 1];
  if (t < first.t || t >= last.t) {
    if (!loop) return t < first.t ? first.v : last.v;
    const span = first.t + duration - last.t;
    if (span <= 1e-9) return t < first.t ? first.v : last.v;
    const local = t >= last.t ? t - last.t : t + duration - last.t;
    return last.v + (first.v - last.v) * ease(last.ease, local / span);
  }
  // binary search for the segment [lo, lo+1] containing t
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].t <= t) lo = mid; else hi = mid; }
  const k0 = keys[lo], k1 = keys[hi];
  const span = k1.t - k0.t;
  if (span <= 1e-9) return k1.v;
  return k0.v + (k1.v - k0.v) * ease(k0.ease, (t - k0.t) / span);
}

/** The rig's setup pose (no animation). */
export function setupPose(rig: RigData): LocalPose {
  return {
    bones: rig.bones.map((b) => ({ x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY })),
    slotAlpha: rig.slots.map((s) => s.alpha ?? 1),
  };
}

/** Sample `anim` at `time` (seconds). Pass `out` to reuse a pose object and avoid garbage. */
export function sampleAnimation(rig: RigData, anim: AnimData | undefined, time: number, out?: LocalPose): LocalPose {
  const pose = out ?? { bones: [], slotAlpha: [] };
  const nb = rig.bones.length, ns = rig.slots.length;
  pose.bones.length = nb; pose.slotAlpha.length = ns;
  for (let i = 0; i < nb; i++) {
    const b = rig.bones[i];
    const p = pose.bones[i] ?? (pose.bones[i] = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    const tr = anim?.bones[b.name];
    if (!tr || !anim) { p.x = b.x; p.y = b.y; p.rotation = b.rotation; p.scaleX = b.scaleX; p.scaleY = b.scaleY; continue; }
    const d = anim.duration, l = anim.loop;
    p.x = b.x + sampleTrack(tr.x, time, d, l, 0);
    p.y = b.y + sampleTrack(tr.y, time, d, l, 0);
    p.rotation = b.rotation + sampleTrack(tr.rotation, time, d, l, 0);
    p.scaleX = b.scaleX * sampleTrack(tr.scaleX, time, d, l, 1);
    p.scaleY = b.scaleY * sampleTrack(tr.scaleY, time, d, l, 1);
  }
  for (let i = 0; i < ns; i++) {
    const s = rig.slots[i];
    const base = s.alpha ?? 1;
    const keys = anim?.slots?.[s.name]?.alpha;
    pose.slotAlpha[i] = keys && anim ? clamp01(sampleTrack(keys, time, anim.duration, anim.loop, base)) : base;
  }
  return pose;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function copyPose(src: LocalPose, out?: LocalPose): LocalPose {
  const pose = out ?? { bones: [], slotAlpha: [] };
  pose.bones.length = src.bones.length;
  for (let i = 0; i < src.bones.length; i++) {
    const s = src.bones[i];
    const p = pose.bones[i] ?? (pose.bones[i] = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    p.x = s.x; p.y = s.y; p.rotation = s.rotation; p.scaleX = s.scaleX; p.scaleY = s.scaleY;
  }
  pose.slotAlpha.length = src.slotAlpha.length;
  for (let i = 0; i < src.slotAlpha.length; i++) pose.slotAlpha[i] = src.slotAlpha[i];
  return pose;
}

/** Blend two poses: t=0 -> a, t=1 -> b. Rotations take the shortest arc. `out` may be `a` or `b`. */
export function blendPoses(a: LocalPose, b: LocalPose, t: number, out?: LocalPose): LocalPose {
  const pose = out ?? { bones: [], slotAlpha: [] };
  const nb = Math.min(a.bones.length, b.bones.length);
  pose.bones.length = nb;
  for (let i = 0; i < nb; i++) {
    const pa = a.bones[i], pb = b.bones[i];
    const p = pose.bones[i] ?? (pose.bones[i] = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    const rot = lerpAngle(pa.rotation, pb.rotation, t);
    const x = pa.x + (pb.x - pa.x) * t, y = pa.y + (pb.y - pa.y) * t;
    const sx = pa.scaleX + (pb.scaleX - pa.scaleX) * t, sy = pa.scaleY + (pb.scaleY - pa.scaleY) * t;
    p.x = x; p.y = y; p.rotation = rot; p.scaleX = sx; p.scaleY = sy;
  }
  const ns = Math.min(a.slotAlpha.length, b.slotAlpha.length);
  pose.slotAlpha.length = ns;
  for (let i = 0; i < ns; i++) pose.slotAlpha[i] = a.slotAlpha[i] + (b.slotAlpha[i] - a.slotAlpha[i]) * t;
  return pose;
}

/* ------------------------------------------------------------------ */
/* World transforms                                                     */
/* ------------------------------------------------------------------ */

interface RigIndex { parent: number[]; order: number[]; slotBone: number[]; bonesRef: unknown; slotsRef: unknown; nb: number; ns: number }
const indexCache = new WeakMap<RigData, RigIndex>();

/** Cached lookup tables (parent indices, parent-first evaluation order, slot -> bone). */
function rigIndex(rig: RigData): RigIndex {
  let ix = indexCache.get(rig);
  if (ix && ix.bonesRef === rig.bones && ix.slotsRef === rig.slots && ix.nb === rig.bones.length && ix.ns === rig.slots.length) return ix;
  const byName = new Map<string, number>();
  rig.bones.forEach((b, i) => byName.set(b.name, i));
  const parent = rig.bones.map((b) => (b.parent === null ? -1 : byName.get(b.parent) ?? -1));
  const order: number[] = [];
  const done = new Array<boolean>(rig.bones.length).fill(false);
  const visit = (i: number, depth: number) => {
    if (done[i] || depth > rig.bones.length) return;
    if (parent[i] >= 0) visit(parent[i], depth + 1);
    if (!done[i]) { done[i] = true; order.push(i); }
  };
  for (let i = 0; i < rig.bones.length; i++) visit(i, 0);
  const slotBone = rig.slots.map((s) => byName.get(s.bone) ?? -1);
  ix = { parent, order, slotBone, bonesRef: rig.bones, slotsRef: rig.slots, nb: rig.bones.length, ns: rig.slots.length };
  indexCache.set(rig, ix);
  return ix;
}
/** Call after structurally editing a rig in place (renaming / re-parenting bones). */
export function invalidateRig(rig: RigData): void { indexCache.delete(rig); }

/** World matrices of every bone as a flat array [a,b,c,d,tx,ty] * boneCount. */
export function computeBoneMatrices(rig: RigData, pose: LocalPose, out?: number[]): number[] {
  const ix = rigIndex(rig);
  const m = out ?? [];
  m.length = rig.bones.length * 6;
  for (const i of ix.order) {
    const p = pose.bones[i] ?? rig.bones[i];
    const r = p.rotation * DEG, cs = cos(r), sn = sin(r);
    const la = cs * p.scaleX, lb = sn * p.scaleX, lc = -sn * p.scaleY, ld = cs * p.scaleY;
    const o = i * 6, pi = ix.parent[i];
    if (pi < 0) { m[o] = la; m[o + 1] = lb; m[o + 2] = lc; m[o + 3] = ld; m[o + 4] = p.x; m[o + 5] = p.y; continue; }
    const q = pi * 6;
    const pa = m[q], pb = m[q + 1], pc = m[q + 2], pd = m[q + 3];
    m[o] = pa * la + pc * lb; m[o + 1] = pb * la + pd * lb;
    m[o + 2] = pa * lc + pc * ld; m[o + 3] = pb * lc + pd * ld;
    m[o + 4] = pa * p.x + pc * p.y + m[q + 4]; m[o + 5] = pb * p.x + pd * p.y + m[q + 5];
  }
  return m;
}

const scratchMatrices: number[] = [];

/**
 * Per-slot world transforms in draw order (index-aligned with rig.slots).
 * The transform places the slot image's ORIGIN point; the image itself spans
 * [-originX*w, (1-originX)*w] x [-originY*h, (1-originY)*h] in that local frame.
 * Pass `out` to reuse the array between frames.
 */
export function computeWorldTransforms(rig: RigData, pose: LocalPose, out?: SlotTransform[]): SlotTransform[] {
  const ix = rigIndex(rig);
  const m = computeBoneMatrices(rig, pose, scratchMatrices);
  const res = out ?? [];
  res.length = rig.slots.length;
  for (let i = 0; i < rig.slots.length; i++) {
    const s = rig.slots[i];
    const bi = ix.slotBone[i];
    let pa = 1, pb = 0, pc = 0, pd = 1, px = 0, py = 0;
    if (bi >= 0) { const q = bi * 6; pa = m[q]; pb = m[q + 1]; pc = m[q + 2]; pd = m[q + 3]; px = m[q + 4]; py = m[q + 5]; }
    const r = s.rotation * DEG, cs = cos(r), sn = sin(r);
    const a = pa * cs + pc * sn, b = pb * cs + pd * sn;
    const c = -pa * sn + pc * cs, d = -pb * sn + pd * cs;
    const tx = pa * s.x + pc * s.y + px, ty = pb * s.x + pd * s.y + py;
    const sx = sqrt(a * a + b * b);
    const det = a * d - b * c;
    const t = res[i] ?? (res[i] = { slot: s, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1, a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    t.slot = s;
    t.x = tx; t.y = ty;
    t.rotation = atan2(b, a) / DEG;
    t.scaleX = sx; t.scaleY = sx > 1e-9 ? det / sx : 0;
    t.alpha = pose.slotAlpha[i] ?? s.alpha ?? 1;
    t.a = a; t.b = b; t.c = c; t.d = d; t.tx = tx; t.ty = ty;
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

/**
 * Names of the events passed when animation time advances from `prev` to `next`
 * (both unwrapped seconds since the animation started, next >= prev).
 * An event at time t fires when prev < t <= next; pass prev < 0 on the very
 * first update so events at t = 0 fire. Looping animations fire every lap.
 */
export function collectEvents(anim: AnimData | undefined, prev: number, next: number, out: string[] = []): string[] {
  out.length = 0;
  const evs = anim?.events;
  if (!anim || !evs || evs.length === 0 || next < prev) return out;
  if (!anim.loop || anim.duration <= 0) {
    for (const e of evs) if (e.t > prev && e.t <= next) out.push(e.name);
    return out;
  }
  const d = anim.duration;
  const sorted = evs.length > 1 ? [...evs].sort((p, q) => p.t - q.t) : evs;
  const firstLap = Math.max(0, Math.floor(prev / d)), lastLap = Math.floor(next / d);
  for (let lap = Math.max(firstLap, lastLap - 8); lap <= lastLap; lap++) {
    for (const e of sorted) { const t = lap * d + Math.min(e.t, d - 1e-6); if (t > prev && t <= next) out.push(e.name); }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mix (cross-fade) lookup                                              */
/* ------------------------------------------------------------------ */

export function mixDuration(rig: RigData, from: string, to: string): number {
  const v = rig.mix?.pairs?.[`${from}>${to}`];
  return v ?? rig.mix?.default ?? 0;
}

/* ------------------------------------------------------------------ */
/* Canvas2D drawing (editors, previews)                                 */
/* ------------------------------------------------------------------ */

/** Minimal structural type so this file needs no DOM lib at runtime. */
export interface RigCanvasContext {
  save(): void; restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void;
  globalAlpha: number;
  globalCompositeOperation: any;
}
export type RigImageSource = Record<string, unknown> | Map<string, unknown> | ((url: string) => unknown);

/**
 * Draw a posed rig. The context's current transform is where the rig origin
 * (feet) goes, e.g. `ctx.translate(x, y); ctx.scale(facing * zoom, zoom)` first.
 * `images` maps slot.image URL -> loaded image (missing images are skipped).
 */
export function drawRigToCanvas(ctx: RigCanvasContext, rig: RigData, slotTransforms: SlotTransform[], images: RigImageSource): void {
  for (let i = 0; i < slotTransforms.length; i++) {
    const t = slotTransforms[i];
    const s = t.slot ?? rig.slots[i];
    if (!s || t.alpha <= 0.001) continue;
    const img = typeof images === 'function' ? images(s.image) : images instanceof Map ? images.get(s.image) : images[s.image];
    if (!img) continue;
    ctx.save();
    ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * t.alpha;
    if (s.additive) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, -s.originX * s.w, -s.originY * s.h, s.w, s.h);
    ctx.restore();
  }
}

/** Convenience: pose a rig at `time` of animation `name` and return slot transforms. */
export function poseRig(rig: RigData, name: string | null, time: number): SlotTransform[] {
  const anim = name ? rig.animations[name] : undefined;
  return computeWorldTransforms(rig, sampleAnimation(rig, anim, time));
}

/** All channels a BoneTrack can animate, with their neutral offset value. */
export const CHANNEL_DEFAULTS: Record<BoneChannel, number> = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
