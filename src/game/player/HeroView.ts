/**
 * HERO VIEW - the visible hero. Wraps the skeletal rig (or the placeholder),
 * drives its animations from the controller, and adds the "juice":
 * squash & stretch, dust puffs and dash after-images.
 */
import Phaser from 'phaser';
import type { GameConfig, RigData } from '../../shared/types';
import { DEPTH } from '../constants';
import { clamp } from '../core/math';
import { AfterImages } from '../fx/afterImages';
import type { DustFx } from '../fx/dust';
import { HeroAnimator } from './animator';
import type { PlayerController, PlayerEvent } from './controller';
import { FallbackRigView, type RigModule, type RigViewLike } from './rigLoader';

export class HeroView {
  readonly view: RigViewLike;
  readonly usingRig: boolean;
  private animator: HeroAnimator;
  private afterImages: AfterImages;
  /** Current squash/stretch scale; springs back to 1. */
  private sx = 1;
  private sy = 1;
  private wallDustTimer = 0;
  private afterImageTimer = 0;
  /** Animation name -> seconds. Shared with the animator, so live rig edits can update it in place. */
  private durations: Record<string, number> = {};
  /** Last drawn position (interpolated), for effects. */
  x = 0;
  y = 0;

  constructor(
    private scene: Phaser.Scene, rig: RigData | null, rigModule: RigModule | null,
    private dust: DustFx, playerW: number, playerH: number,
  ) {
    let view: RigViewLike | null = null;
    let durations: Record<string, number> = {};
    if (rig && rigModule) {
      try {
        view = new rigModule.RigView(scene, rig);
        for (const [name, anim] of Object.entries(rig.animations ?? {})) durations[name] = anim.duration;
      } catch (err) {
        console.warn('[hero] the rig failed to build - using the placeholder hero.', err);
        view = null;
      }
    }
    this.usingRig = view !== null;
    if (!view) {
      view = new FallbackRigView(scene, playerW, playerH);
      // The placeholder "has" every animation so the state names still show up in the debug overlay.
      durations = { idle: 1, run: 0.6, jump: 0.4, fall: 0.4, land: 0.18, doubleJump: 0.4, wallSlide: 0.5, dash: 0.2, attack: 0.3, turn: 0.15 };
    }
    this.view = view;
    this.view.setDepth(DEPTH.PLAYER);
    this.durations = durations;
    this.animator = new HeroAnimator(view, durations);
    this.afterImages = new AfterImages(scene);
    // Footstep puffs, if the run animation carries "step"/"foot" events.
    this.view.onEvent((name) => {
      if (/step|foot/i.test(name)) this.dust.burst(this.x, this.y, 1, 20, 0, 14, 7);
    });
  }

  /** React to something the controller reported (called in order, right after the sim steps). */
  handleEvent(e: PlayerEvent, p: PlayerController, cfg: GameConfig): void {
    this.animator.handleEvent(e, p, cfg.player);
    const k = clamp(cfg.feel.squashStretch, 0, 1.5);
    this.dust.enabled = cfg.feel.dustParticles;
    switch (e.type) {
      case 'jump':
        this.setSquash(1 - 0.22 * k, 1 + 0.3 * k);
        this.dust.burst(p.x, p.y, 4, 60, 0, 20);
        break;
      case 'airJump':
        this.setSquash(1 - 0.16 * k, 1 + 0.22 * k);
        this.dust.burst(p.x, p.y, 5, 90, 0, -30, 9); // a little ring pushed downward
        break;
      case 'wallJump':
        this.setSquash(1 - 0.2 * k, 1 + 0.26 * k);
        this.dust.burst(p.x + e.wallDir * p.w * 0.5, p.y - p.h * 0.4, 4, 30, -e.wallDir, 40);
        break;
      case 'land': {
        const impact = clamp(e.speed / Math.max(cfg.player.maxFallSpeed, 1), 0, 1);
        if (impact > 0.15) {
          this.setSquash(1 + 0.34 * k * impact, 1 - 0.3 * k * impact);
          this.dust.burst(p.x, p.y, 3 + Math.round(impact * 5), 80 + impact * 80, 0, 18);
        }
        break;
      }
      case 'turn':
        this.dust.burst(p.x - e.dir * 8, p.y, 3, 50, -e.dir * 1.2, 22, 10);
        break;
      case 'dashStart':
        this.setSquash(1 + 0.24 * k, 1 - 0.16 * k);
        if (p.onGround) this.dust.burst(p.x, p.y, 4, 70, -e.dir, 16);
        this.afterImageTimer = 0;
        break;
    }
  }

  /**
   * The Game Editor sent edited animations: swap them into the live rig (no rebuild, the
   * current animation keeps playing). Returns false when there is no real rig to update.
   */
  setRigData(rig: RigData): boolean {
    if (!this.usingRig || typeof this.view.setRigData !== 'function') return false;
    if (!rig || !Array.isArray(rig.bones) || !Array.isArray(rig.slots) || !rig.animations) return false;
    try {
      this.view.setRigData(rig);
    } catch (err) {
      console.warn('[hero] could not apply the live rig from the editor.', err);
      return false;
    }
    for (const name of Object.keys(this.durations)) delete this.durations[name];
    for (const [name, anim] of Object.entries(rig.animations)) this.durations[name] = anim.duration;
    return true;
  }

  private setSquash(sx: number, sy: number): void {
    this.sx = sx;
    this.sy = sy;
  }

  /**
   * Call once per rendered frame.
   * @param x,y  interpolated feet position
   * @param dt   real seconds since the last frame
   */
  update(p: PlayerController, x: number, y: number, cfg: GameConfig, dt: number): void {
    this.x = x;
    this.y = y;
    this.dust.enabled = cfg.feel.dustParticles;
    this.animator.update(p, cfg.player, dt);

    // Squash & stretch eases back to normal; falling fast stretches slightly.
    const ease = 1 - Math.exp(-dt * 11);
    const k = clamp(cfg.feel.squashStretch, 0, 1.5);
    const fallStretch = !p.onGround && !p.dashing ? clamp(Math.abs(p.vy) / Math.max(cfg.player.maxFallSpeed, 1), 0, 1) * 0.1 * k : 0;
    this.sx += (1 - fallStretch * 0.7 - this.sx) * ease;
    this.sy += (1 + fallStretch - this.sy) * ease;

    this.view.setPosition(x, y);
    this.view.setFacing(p.facing);
    this.view.setSquash(this.sx, this.sy);
    this.view.update(dt);

    // Wall-slide dust trickle.
    if (p.wallSliding) {
      this.wallDustTimer -= dt;
      if (this.wallDustTimer <= 0) {
        this.wallDustTimer = 0.09;
        this.dust.burst(x + p.wallDir * p.w * 0.5, y - p.h * 0.75, 1, 14, -p.wallDir * 0.5, -20, 8);
      }
    } else this.wallDustTimer = 0;

    // Dash after-images.
    if (p.dashing && cfg.feel.afterImages) {
      this.afterImageTimer -= dt;
      if (this.afterImageTimer <= 0) {
        this.afterImageTimer = 0.032;
        this.afterImages.spawn(this.view.root, x, y);
      }
    }
    this.afterImages.update(dt);
  }

  setVisible(v: boolean): void {
    this.view.setVisible(v);
  }

  destroy(): void {
    this.afterImages.destroy();
    this.view.destroy();
  }
}
