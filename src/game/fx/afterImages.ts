/**
 * DASH AFTER-IMAGES - ghostly copies of the hero left behind during a dash.
 *
 * Each ghost is a small off-screen texture. We "photograph" the hero's rig
 * into it (whatever pose it is in right now), tint it and let it fade out.
 * A handful of ghosts are created once and reused.
 */
import Phaser from 'phaser';
import { DEPTH } from '../constants';

const COUNT = 6;
/** Logical size of the snapshot area around the hero (feet at 80% height). */
const SNAP_W = 200;
const SNAP_H = 180;
const FEET_Y = 0.8;
/** Snapshot pixels per logical px (2 = crisp on HiDPI screens). */
const RESOLUTION = 2;
const LIFE = 0.26;
const TINT = 0x8fb8ff;

interface Ghost {
  rt: Phaser.GameObjects.RenderTexture;
  life: number;
}

export class AfterImages {
  private ghosts: Ghost[] = [];
  private next = 0;
  private broken = false;

  constructor(private scene: Phaser.Scene) {}

  private ensurePool(): void {
    if (this.ghosts.length > 0) return;
    for (let i = 0; i < COUNT; i++) {
      const rt = this.scene.add.renderTexture(0, 0, SNAP_W * RESOLUTION, SNAP_H * RESOLUTION);
      rt.setOrigin(0.5, FEET_Y).setScale(1 / RESOLUTION).setDepth(DEPTH.FX_BEHIND).setVisible(false);
      rt.setTint(TINT).setBlendMode(Phaser.BlendModes.ADD);
      // The snapshot camera looks at the hero, zoomed to the snapshot resolution.
      rt.camera.setZoom(RESOLUTION);
      this.ghosts.push({ rt, life: 0 });
    }
  }

  /** Photograph `source` (the hero's root container, feet at x,y) and leave a ghost there. */
  spawn(source: Phaser.GameObjects.Container, x: number, y: number): void {
    if (this.broken) return;
    try {
      this.ensurePool();
      const g = this.ghosts[this.next];
      this.next = (this.next + 1) % COUNT;
      // Aim the snapshot camera so the hero's feet land at the texture's (50%, 80%) point.
      g.rt.camera.centerOn(x, y - SNAP_H * (FEET_Y - 0.5));
      g.rt.clear();
      g.rt.draw(source);
      g.rt.render();
      g.rt.setPosition(x, y).setVisible(true).setAlpha(0.5);
      g.life = LIFE;
    } catch (err) {
      // Purely cosmetic: if the renderer cannot do this, quietly switch the effect off.
      console.warn('[fx] after-images disabled:', err);
      this.broken = true;
    }
  }

  update(dt: number): void {
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) g.rt.setVisible(false);
      else g.rt.setAlpha(0.5 * (g.life / LIFE));
    }
  }

  destroy(): void {
    for (const g of this.ghosts) g.rt.destroy();
    this.ghosts.length = 0;
  }
}
