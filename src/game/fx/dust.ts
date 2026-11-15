/**
 * DUST PUFFS - little clouds kicked up by jumping, landing, turning and
 * wall-sliding. A fixed pool of images is recycled, so spawning dust never
 * allocates memory during play (no stutter).
 */
import Phaser from 'phaser';
import { DEPTH } from '../constants';
import { TEX } from './textures';

interface Puff {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

const POOL_SIZE = 48;

export class DustFx {
  private puffs: Puff[] = [];
  private next = 0;
  enabled = true;

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const img = scene.add.image(0, 0, TEX.DOT).setDepth(DEPTH.FX_FRONT).setVisible(false).setTint(0xcfc8d8);
      this.puffs.push({ img, vx: 0, vy: 0, life: 0, maxLife: 1, size: 10 });
    }
  }

  /**
   * Spawn `count` puffs at (x,y).
   * @param spreadX  how far they fly sideways (px/s)
   * @param biasX    -1..1 pushes the cloud to one side (e.g. behind a turn)
   * @param up       upward speed (px/s)
   */
  burst(x: number, y: number, count: number, spreadX = 70, biasX = 0, up = 30, size = 12): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const p = this.puffs[this.next];
      this.next = (this.next + 1) % POOL_SIZE;
      const side = count > 1 ? (i / (count - 1)) * 2 - 1 : 0;
      p.vx = (side + biasX) * spreadX * (0.6 + Math.random() * 0.6);
      p.vy = -up * (0.4 + Math.random());
      p.maxLife = p.life = 0.28 + Math.random() * 0.22;
      p.size = size * (0.7 + Math.random() * 0.6);
      p.img.setPosition(x + side * 6, y - 3).setVisible(true);
    }
  }

  /** Call every rendered frame. */
  update(dt: number): void {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.img.setVisible(false);
        continue;
      }
      const t = 1 - p.life / p.maxLife; // 0 -> 1 over the puff's life
      // Slow down quickly (drag) and drift up a little.
      const drag = Math.exp(-dt * 5);
      p.vx *= drag;
      p.vy *= drag;
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      p.img.setDisplaySize(p.size * (0.6 + t * 1.2), p.size * (0.6 + t * 1.2));
      p.img.setAlpha(0.55 * (1 - t) * (1 - t));
    }
  }

  destroy(): void {
    for (const p of this.puffs) p.img.destroy();
    this.puffs.length = 0;
  }
}
