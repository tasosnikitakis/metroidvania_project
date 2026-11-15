/**
 * AMBIENT PARTICLES - drifting dust motes, rising embers, wandering
 * fireflies and falling leaves inside a rectangle (the `particles` entity).
 *
 * Each area owns a fixed set of particles that wrap around inside the area,
 * so there is nothing to spawn or destroy while playing. Areas that are off
 * screen are skipped entirely.
 */
import Phaser from 'phaser';
import { DEPTH } from '../constants';
import { hash01 } from '../core/math';
import { TEX } from './textures';
import type { ViewRect } from './view';

export type ParticleKind = 'dust' | 'embers' | 'fireflies' | 'leaves';

interface KindStyle {
  texture: string;
  additive: boolean;
  colors: number[];
  /** Particles per 100x100 px of area. */
  density: number;
  size: [number, number];
  alpha: [number, number];
  /** Base drift, px/s. */
  vx: [number, number];
  vy: [number, number];
  /** Sideways wobble: distance px and speed. */
  wobble: number;
  wobbleSpeed: number;
  /** How strongly brightness pulses (0..1) and how fast. */
  pulse: number;
  pulseSpeed: number;
  spin: number;
}

const STYLES: Record<ParticleKind, KindStyle> = {
  dust: {
    texture: TEX.DOT, additive: true, colors: [0xbfc6e8, 0xd8d0f0, 0xa9b4d8], density: 0.55,
    size: [2.5, 6], alpha: [0.1, 0.32], vx: [-8, 8], vy: [-6, 5], wobble: 14, wobbleSpeed: 0.5,
    pulse: 0.5, pulseSpeed: 0.7, spin: 0,
  },
  embers: {
    texture: TEX.DOT, additive: true, colors: [0xffa040, 0xff7a2a, 0xffd070], density: 0.4,
    size: [2.5, 6], alpha: [0.5, 0.95], vx: [-12, 12], vy: [-70, -28], wobble: 10, wobbleSpeed: 1.6,
    pulse: 0.6, pulseSpeed: 5, spin: 0,
  },
  fireflies: {
    texture: TEX.GLOW, additive: true, colors: [0xd8ff7a, 0xa8ff9a, 0xfff08a], density: 0.14,
    size: [9, 16], alpha: [0.55, 1], vx: [-10, 10], vy: [-7, 7], wobble: 36, wobbleSpeed: 0.8,
    pulse: 0.9, pulseSpeed: 1.6, spin: 0,
  },
  leaves: {
    texture: TEX.LEAF, additive: false, colors: [0x8a4a2a, 0xa8642c, 0x6a3a30, 0x9a7a34], density: 0.16,
    size: [9, 15], alpha: [0.75, 1], vx: [-40, -14], vy: [26, 52], wobble: 26, wobbleSpeed: 1.3,
    pulse: 0, pulseSpeed: 0, spin: 1.6,
  },
};

const MAX_PER_AREA = 140;

interface Mote {
  img: Phaser.GameObjects.Image;
  /** Position inside the area, px from its top-left. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  alpha: number;
  size: number;
}

export class AmbientParticleArea {
  private motes: Mote[] = [];
  private style: KindStyle;
  private left: number;
  private top: number;
  private visible = true;

  /** @param cx,cy centre of the area (the entity position), logical px */
  constructor(scene: Phaser.Scene, kind: string, cx: number, cy: number, private w: number, private h: number, seed: number) {
    this.style = STYLES[(kind as ParticleKind)] ?? STYLES.dust;
    this.left = cx - w / 2;
    this.top = cy - h / 2;
    const s = this.style;
    const count = Math.min(MAX_PER_AREA, Math.max(3, Math.round(((w * h) / 10000) * s.density)));
    const rnd = (i: number, k: number) => hash01(seed * 13.7 + i * 7.31 + k * 101.3);
    const pick = (range: [number, number], r: number) => range[0] + (range[1] - range[0]) * r;
    for (let i = 0; i < count; i++) {
      const img = scene.add.image(0, 0, s.texture).setDepth(DEPTH.PARTICLES);
      if (s.additive) img.setBlendMode(Phaser.BlendModes.ADD);
      img.setTint(s.colors[Math.floor(rnd(i, 0) * s.colors.length) % s.colors.length]);
      const size = pick(s.size, rnd(i, 1));
      const aspect = s.texture === TEX.LEAF ? 0.5 : 1;
      img.setDisplaySize(size, size * aspect);
      this.motes.push({
        img, size,
        x: rnd(i, 2) * w, y: rnd(i, 3) * h,
        vx: pick(s.vx, rnd(i, 4)), vy: pick(s.vy, rnd(i, 5)),
        phase: rnd(i, 6) * Math.PI * 2,
        alpha: pick(s.alpha, rnd(i, 7)),
      });
    }
  }

  /** Call every rendered frame. `time` in seconds. */
  update(dt: number, time: number, view: ViewRect): void {
    const margin = 80;
    const onScreen =
      this.left < view.right + margin && this.left + this.w > view.left - margin &&
      this.top < view.bottom + margin && this.top + this.h > view.top - margin;
    if (onScreen !== this.visible) {
      this.visible = onScreen;
      for (const m of this.motes) m.img.setVisible(onScreen);
    }
    if (!onScreen) return;

    const s = this.style;
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      // Wrap around inside the area.
      if (m.x < 0) m.x += this.w; else if (m.x >= this.w) m.x -= this.w;
      if (m.y < 0) m.y += this.h; else if (m.y >= this.h) m.y -= this.h;

      const wob = Math.sin(time * s.wobbleSpeed + m.phase);
      m.img.setPosition(this.left + m.x + wob * s.wobble, this.top + m.y + Math.cos(time * s.wobbleSpeed * 0.7 + m.phase) * s.wobble * 0.4);

      // Fade near the area's edges so wrapping is invisible.
      const edge = Math.min(m.x, this.w - m.x, m.y, this.h - m.y);
      const edgeFade = Math.min(1, edge / 40);
      const pulse = 1 - s.pulse * (0.5 + 0.5 * Math.sin(time * s.pulseSpeed + m.phase * 3));
      m.img.setAlpha(m.alpha * edgeFade * pulse);
      if (s.spin) m.img.setRotation(wob * 0.9 + m.phase + time * s.spin * 0.2);
    }
  }

  destroy(): void {
    for (const m of this.motes) m.img.destroy();
    this.motes.length = 0;
  }
}
