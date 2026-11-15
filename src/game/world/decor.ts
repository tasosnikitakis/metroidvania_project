/**
 * DECOR - free-placed props (candelabras, statues, vines...).
 * Supports flip / scale / rotation / alpha per instance, plus two optional
 * extras from the catalog: a gentle idle `sway` and an additive `glow`.
 */
import Phaser from 'phaser';
import type { DecorCatalog, DecorDef, DecorInstance } from '../../shared/types';
import { DEPTH } from '../constants';
import { flickerNoise, hash01, parseColor } from '../core/math';
import { TEX } from '../fx/textures';

const LAYER_DEPTH = { far: DEPTH.DECOR_FAR, back: DEPTH.DECOR_BACK, front: DEPTH.DECOR_FRONT } as const;

interface Swaying {
  img: Phaser.GameObjects.Image;
  baseRotation: number;
  angle: number; // radians
  period: number;
  phase: number;
}

interface Glowing {
  img: Phaser.GameObjects.Image;
  baseAlpha: number;
  baseSize: number;
  flicker: number;
  seed: number;
}

export class DecorLayer {
  private objects: Phaser.GameObjects.Image[] = [];
  private swaying: Swaying[] = [];
  private glowing: Glowing[] = [];

  constructor(scene: Phaser.Scene, instances: DecorInstance[], catalog: DecorCatalog) {
    const defs = new Map<string, DecorDef>(catalog.decor.map((d) => [d.key, d]));
    instances.forEach((inst, index) => {
      const def = defs.get(inst.key);
      if (!def || !scene.textures.exists(def.image)) return; // unknown or not-yet-drawn decor is skipped
      const scale = inst.scale ?? 1;
      const flip = inst.flipX ? -1 : 1;
      const rotation = Phaser.Math.DegToRad(inst.rotation ?? 0);
      const seed = hash01(index * 3.1 + inst.x * 0.013 + inst.y * 0.007);

      const img = scene.add.image(inst.x, inst.y, def.image);
      // Flipping mirrors around the anchor, so the anchor stays where it was placed.
      img.setOrigin(inst.flipX ? 1 - def.originX : def.originX, def.originY);
      img.setDisplaySize(def.w * scale, def.h * scale);
      img.setFlipX(!!inst.flipX);
      img.setRotation(rotation);
      img.setAlpha(inst.alpha ?? 1);
      // Tiny per-index offset keeps the draw order stable (later in the list = on top).
      img.setDepth((LAYER_DEPTH[inst.layer] ?? DEPTH.DECOR_BACK) + Math.min(index, 9000) * 0.001);
      this.objects.push(img);

      if (def.sway && def.sway.period > 0) {
        this.swaying.push({
          img, baseRotation: rotation, angle: Phaser.Math.DegToRad(def.sway.angle),
          period: def.sway.period, phase: seed * Math.PI * 2,
        });
      }

      if (def.glow) {
        const size = def.glow.radius * 2 * scale;
        // Glow offset is measured from the anchor, in the un-flipped image.
        const ox = def.glow.x * scale * flip;
        const oy = def.glow.y * scale;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const glow = scene.add.image(inst.x + ox * cos - oy * sin, inst.y + ox * sin + oy * cos, TEX.GLOW);
        glow.setBlendMode(Phaser.BlendModes.ADD).setTint(parseColor(def.glow.color, 0xffcc88));
        glow.setDisplaySize(size, size).setDepth(DEPTH.LIGHTS);
        const baseAlpha = 0.55 * (inst.alpha ?? 1);
        glow.setAlpha(baseAlpha);
        this.objects.push(glow);
        this.glowing.push({ img: glow, baseAlpha, baseSize: size, flicker: def.glow.flicker ?? 0, seed });
      }
    });
  }

  /** Call every rendered frame. `time` in seconds. */
  update(time: number): void {
    for (const s of this.swaying) {
      s.img.rotation = s.baseRotation + Math.sin((time / s.period) * Math.PI * 2 + s.phase) * s.angle;
    }
    for (const g of this.glowing) {
      if (g.flicker <= 0) continue;
      const n = flickerNoise(time, g.seed);
      g.img.setAlpha(g.baseAlpha * (1 - g.flicker * n));
      const size = g.baseSize * (1 - g.flicker * 0.15 * n);
      g.img.setDisplaySize(size, size);
    }
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.swaying.length = 0;
    this.glowing.length = 0;
  }
}
