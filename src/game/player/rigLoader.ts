/**
 * Bridge to the skeletal animation code in src/rig (owned by the art/rig
 * side of the project). The game only relies on this small interface, and
 * falls back to a simple placeholder hero if the rig code or data is missing,
 * so gameplay work never blocks on art.
 */
import Phaser from 'phaser';
import type { RigData } from '../../shared/types';

/** What the game needs from a hero view. src/rig's RigView matches this. */
export interface RigViewLike {
  readonly root: Phaser.GameObjects.Container;
  readonly current: string;
  setPosition(x: number, y: number): void;
  setFacing(dir: 1 | -1): void;
  setSquash(sx: number, sy: number): void;
  setDepth(d: number): void;
  setAlpha(a: number): void;
  setVisible(v: boolean): void;
  play(name: string, opts?: { mix?: number; restart?: boolean; speed?: number }): void;
  update(dtSeconds: number): void;
  onEvent(cb: (name: string, anim: string) => void): void;
  destroy(): void;
}

export interface RigModule {
  preloadRig(scene: Phaser.Scene, rig: RigData): void;
  RigView: new (scene: Phaser.Scene, rig: RigData) => RigViewLike;
}

/**
 * Load src/rig lazily. If that code fails to load for any reason the game
 * carries on with the placeholder hero instead of a blank screen.
 */
export async function loadRigModule(): Promise<RigModule | null> {
  try {
    const mod = (await import('../../rig/index')) as unknown as Partial<RigModule>;
    if (typeof mod.preloadRig === 'function' && typeof mod.RigView === 'function') return mod as RigModule;
    console.warn('[hero] src/rig does not export preloadRig + RigView - using the placeholder hero.');
  } catch (err) {
    console.warn('[hero] could not load src/rig - using the placeholder hero.', err);
  }
  return null;
}

/**
 * Placeholder hero: a caped capsule with an eye so you can see which way it
 * faces. Implements the same interface as the real rig.
 */
export class FallbackRigView implements RigViewLike {
  readonly root: Phaser.GameObjects.Container;
  current = 'idle';
  private body: Phaser.GameObjects.Graphics;
  private facing: 1 | -1 = 1;
  private sx = 1;
  private sy = 1;
  private time = 0;

  constructor(scene: Phaser.Scene, width = 30, height = 66) {
    const g = scene.add.graphics();
    const w = width;
    const h = height;
    g.fillStyle(0x5a2a4a, 1); // cape
    g.fillTriangle(-w * 0.2, -h * 0.8, -w * 0.9, -h * 0.12, w * 0.1, -h * 0.2);
    g.fillStyle(0xd8d2e8, 1); // body
    g.fillRoundedRect(-w / 2, -h, w, h, w * 0.45);
    g.fillStyle(0x1a1626, 1); // eye
    g.fillCircle(w * 0.22, -h * 0.78, 3.4);
    this.body = g;
    this.root = scene.add.container(0, 0, [g]);
  }

  setPosition(x: number, y: number): void { this.root.setPosition(x, y); }
  setFacing(dir: 1 | -1): void { this.facing = dir; this.applyScale(); }
  setSquash(sx: number, sy: number): void { this.sx = sx; this.sy = sy; this.applyScale(); }
  private applyScale(): void { this.root.setScale(this.sx * this.facing, this.sy); }
  setDepth(d: number): void { this.root.setDepth(d); }
  setAlpha(a: number): void { this.root.setAlpha(a); }
  setVisible(v: boolean): void { this.root.setVisible(v); }
  play(name: string): void { this.current = name; }
  update(dt: number): void {
    this.time += dt;
    // A hint of life: lean into runs/dashes, bob when idle.
    const lean = this.current === 'dash' ? 0.35 : this.current === 'run' ? 0.12 : this.current === 'attack' ? 0.2 : 0;
    this.body.rotation = lean;
    this.body.y = this.current === 'idle' ? Math.sin(this.time * 3) * 1.2 - 1.2 : 0;
  }
  onEvent(): void { /* the placeholder has no animation events */ }
  destroy(): void { this.root.destroy(); }
}
