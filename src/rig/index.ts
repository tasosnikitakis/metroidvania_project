/**
 * RIG VIEW - draws a RigData skeleton in Phaser (one Image per slot, flat inside `root`).
 * All pose maths lives in ./pose.ts (pure, unit tested) and is re-exported from here.
 *
 *   preloadRig(scene, rig)        in Scene.preload - texture key === slot.image URL
 *   const view = new RigView(scene, rig)
 *   view.play('run'); view.update(dt) every render frame.
 *
 * Notes
 * - play(name) with the animation that is already current does NOT restart it
 *   (looping or not) unless `restart: true` is passed, so it is safe to call every frame.
 * - Cross-fades always start from the pose currently on screen, so interrupting a
 *   fade half-way never pops.
 * - setRigData(rig) hot-swaps the data (live editing); the current animation and time are kept.
 */
import Phaser from 'phaser';
import type { AnimData, RigData } from '../shared/types';
import {
  blendPoses, collectEvents, computeWorldTransforms, copyPose, mixDuration, sampleAnimation,
  type LocalPose, type SlotTransform,
} from './pose';

export * from './pose';

const DEG = Math.PI / 180;

/** Queue every slot image of the rig. Texture key === slot.image (the URL). */
export function preloadRig(scene: Phaser.Scene, rig: RigData): void {
  const seen = new Set<string>();
  for (const s of rig.slots) {
    if (seen.has(s.image) || scene.textures.exists(s.image)) continue;
    seen.add(s.image);
    scene.load.image(s.image, s.image);
  }
}

/**
 * Packs all of a rig's (separately loaded, separately editable) slot images into ONE
 * runtime canvas texture, so the whole character draws in a single batch with linear
 * filtering. Returns the atlas texture key (frames are named by slot.image), or null
 * if nothing could be packed. Safe to call repeatedly; rebuilt when the image list changes.
 */
export function ensureRigAtlas(scene: Phaser.Scene, rig: RigData): string | null {
  const urls = [...new Set(rig.slots.map((s) => s.image))].filter((u) => scene.textures.exists(u));
  if (urls.length === 0) return null;
  const key = `rig-atlas:${rig.name}:${urls.join('|')}`;
  if (scene.textures.exists(key)) return key;
  const PAD = 2;
  const items = urls.map((u) => { const src = scene.textures.get(u).getSourceImage() as HTMLImageElement; return { u, src, w: src.width, h: src.height }; })
    .sort((p, q) => q.h - p.h);
  const area = items.reduce((sum, it) => sum + (it.w + PAD * 2) * (it.h + PAD * 2), 0);
  const W = Math.max(256, Math.min(4096, 2 ** Math.ceil(Math.log2(Math.sqrt(area * 1.3)))));
  let x = 0, y = 0, rowH = 0;
  const placed = items.map((it) => {
    if (x + it.w + PAD * 2 > W) { x = 0; y += rowH; rowH = 0; }
    const p = { ...it, x: x + PAD, y: y + PAD };
    x += it.w + PAD * 2; rowH = Math.max(rowH, it.h + PAD * 2);
    return p;
  });
  const tex = scene.textures.createCanvas(key, W, y + rowH);
  if (!tex) return null;
  const ctx = tex.getContext();
  for (const p of placed) { ctx.drawImage(p.src, p.x, p.y); tex.add(p.u, 0, p.x, p.y, p.w, p.h); }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

export interface PlayOptions { mix?: number; restart?: boolean; speed?: number }
export type RigEventCallback = (name: string, anim: string) => void;

export class RigView {
  readonly root: Phaser.GameObjects.Container;
  private scene: Phaser.Scene;
  private rig: RigData;
  private images: Phaser.GameObjects.Image[] = [];
  private anim: AnimData | undefined;
  private animName = '';
  private time = 0;
  private lastEventTime = -1;
  private speed = 1;
  private facing: 1 | -1 = 1;
  private squashX = 1;
  private squashY = 1;
  /** Pose currently on screen. */
  private shown: LocalPose = { bones: [], slotAlpha: [] };
  private target: LocalPose = { bones: [], slotAlpha: [] };
  private fadeFrom: LocalPose = { bones: [], slotAlpha: [] };
  private fadeTime = 0;
  private fadeDuration = 0;
  private transforms: SlotTransform[] = [];
  private listeners: RigEventCallback[] = [];
  private eventScratch: string[] = [];
  private destroyed = false;

  constructor(scene: Phaser.Scene, rig: RigData) {
    this.scene = scene;
    this.rig = rig;
    this.root = scene.add.container(0, 0);
    this.buildImages();
    sampleAnimation(rig, undefined, 0, this.shown);
    this.apply();
  }

  /** Name of the animation being played ('' before the first play). */
  get current(): string { return this.animName; }
  /** Seconds since the current animation started (keeps counting through loops). */
  get currentTime(): number { return this.time; }
  /** True once a non-looping animation has reached its end. */
  get finished(): boolean { return !!this.anim && !this.anim.loop && this.time >= this.anim.duration; }
  get data(): RigData { return this.rig; }

  setPosition(x: number, y: number): void { this.root.setPosition(x, y); }
  setFacing(dir: 1 | -1): void { this.facing = dir < 0 ? -1 : 1; this.applyScale(); }
  /** Squash & stretch around the feet (1,1 = normal). */
  setSquash(sx: number, sy: number): void { this.squashX = sx; this.squashY = sy; this.applyScale(); }
  setDepth(d: number): void { this.root.setDepth(d); }
  setAlpha(a: number): void { this.root.setAlpha(a); }
  setVisible(v: boolean): void { this.root.setVisible(v); }

  play(name: string, opts: PlayOptions = {}): void {
    const next = this.rig.animations[name];
    if (!next) return;
    if (opts.speed !== undefined) this.speed = opts.speed;
    if (name === this.animName && this.anim && !opts.restart) { this.anim = next; return; }
    // start the cross-fade from whatever is on screen right now
    const mix = opts.mix ?? (this.animName ? mixDuration(this.rig, this.animName, name) : 0);
    copyPose(this.shown, this.fadeFrom);
    this.fadeTime = 0;
    this.fadeDuration = Math.max(0, mix);
    this.anim = next;
    this.animName = name;
    this.time = 0;
    this.lastEventTime = -1; // so events at t = 0 fire on the next update
    if (opts.speed === undefined) this.speed = 1;
  }

  /** Advance by dt seconds and redraw. Call once per render frame. */
  update(dtSeconds: number): void {
    if (this.destroyed) return;
    const dt = dtSeconds > 0 && Number.isFinite(dtSeconds) ? dtSeconds : 0;
    const anim = this.anim;
    if (anim) {
      this.time += dt * this.speed;
      const evTime = anim.loop ? this.time : Math.min(this.time, anim.duration);
      if (anim.events && anim.events.length && this.listeners.length) {
        const fired = collectEvents(anim, this.lastEventTime, evTime, this.eventScratch);
        for (let i = 0; i < fired.length; i++) for (const cb of this.listeners) cb(fired[i], this.animName);
      }
      this.lastEventTime = evTime;
      sampleAnimation(this.rig, anim, anim.loop ? this.time : Math.min(this.time, anim.duration), this.target);
    } else {
      sampleAnimation(this.rig, undefined, 0, this.target);
    }
    if (this.fadeTime < this.fadeDuration) {
      this.fadeTime += dt;
      const k = this.fadeDuration > 0 ? Math.min(1, this.fadeTime / this.fadeDuration) : 1;
      blendPoses(this.fadeFrom, this.target, k * k * (3 - 2 * k), this.shown);
    } else {
      copyPose(this.target, this.shown);
    }
    this.apply();
  }

  onEvent(cb: RigEventCallback): void { this.listeners.push(cb); }

  /** Hot-swap the rig data (e.g. after editing an animation). Keeps the current animation & time. */
  setRigData(rig: RigData): void {
    const prev = this.rig;
    this.rig = rig;
    const sameSlots = prev.slots.length === rig.slots.length && prev.slots.every((s, i) => s.image === rig.slots[i].image && !!s.additive === !!rig.slots[i].additive);
    if (!sameSlots) this.buildImages();
    this.anim = this.animName ? rig.animations[this.animName] : undefined;
    if (!this.anim) this.animName = '';
    this.fadeDuration = 0;
    this.update(0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.length = 0;
    this.root.destroy(true);
    this.images.length = 0;
  }

  /* ---------------- internals ---------------- */

  private buildImages(): void {
    for (const img of this.images) img.destroy();
    this.images.length = 0;
    this.root.removeAll();
    const atlas = ensureRigAtlas(this.scene, this.rig);
    for (const s of this.rig.slots) {
      const img = atlas && this.scene.textures.get(atlas).has(s.image)
        ? this.scene.add.image(0, 0, atlas, s.image)
        : this.scene.add.image(0, 0, s.image);
      img.setOrigin(s.originX, s.originY);
      if (s.additive) img.setBlendMode(Phaser.BlendModes.ADD);
      this.root.add(img);
      this.images.push(img);
    }
  }

  private applyScale(): void { this.root.setScale(this.facing * this.squashX, this.squashY); }

  private apply(): void {
    const tr = computeWorldTransforms(this.rig, this.shown, this.transforms);
    const n = Math.min(tr.length, this.images.length);
    for (let i = 0; i < n; i++) {
      const t = tr[i], img = this.images[i], s = t.slot;
      if (t.alpha <= 0.001) { if (img.visible) img.setVisible(false); continue; }
      if (!img.visible) img.setVisible(true);
      // texture pixels -> logical size (works for any imageScale, even a re-skinned higher-res PNG)
      const fw = img.frame.realWidth || s.w * s.imageScale, fh = img.frame.realHeight || s.h * s.imageScale;
      img.setOrigin(s.originX, s.originY);
      img.setPosition(t.x, t.y);
      img.setRotation(t.rotation * DEG);
      img.setScale((t.scaleX * s.w) / fw, (t.scaleY * s.h) / fh);
      img.setAlpha(t.alpha);
    }
  }
}

/** Functional alias for `view.setRigData(rig)`. */
export function setRigData(view: RigView, rig: RigData): void { view.setRigData(rig); }
