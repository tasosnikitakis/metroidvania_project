/**
 * HERO ANIMATION STATE MACHINE  (no Phaser - works on anything with play())
 * -------------------------------------------------------------------------
 * Looks at what the controller is doing and decides which rig animation to
 * show. Loops (idle/run/jump/fall/wallSlide/dash) follow the movement state;
 * one-shots (land/turn/doubleJump/attack) are triggered by events and play
 * once on top, as long as they still make sense.
 */
import type { PlayerConfig } from '../../shared/types';
import { clamp } from '../core/math';
import type { PlayerController, PlayerEvent } from './controller';

/** The bit of RigView the animator needs. */
export interface AnimTarget {
  readonly current: string;
  play(name: string, opts?: { mix?: number; restart?: boolean; speed?: number }): void;
}

interface OneShot {
  name: string;
  timeLeft: number;
  /** Stop early when this returns false (e.g. "land" once the hero leaves the ground). */
  stillValid: (p: PlayerController) => boolean;
}

export class HeroAnimator {
  private oneShot: OneShot | null = null;
  private lastPlayed = '';
  private lastSpeed = 1;

  /**
   * @param target    the rig view
   * @param durations animation name -> seconds, for every animation the rig actually has
   */
  constructor(private target: AnimTarget, private durations: Record<string, number>) {}

  private has(name: string): boolean {
    return name in this.durations;
  }

  /** Feed controller events (jump, land, ...) as they happen. */
  handleEvent(e: PlayerEvent, p: PlayerController, cfg: PlayerConfig): void {
    switch (e.type) {
      case 'airJump':
        this.startOneShot('doubleJump', (q) => !q.onGround && !q.dashing && !q.wallSliding && !q.attacking);
        break;
      case 'land':
        // Only show the landing pose when not immediately running off.
        if (Math.abs(p.vx) < cfg.runSpeed * 0.35 && e.speed > 250) {
          this.startOneShot('land', (q) => q.onGround && !q.dashing && !q.attacking && Math.abs(q.vx) < cfg.runSpeed * 0.5);
        }
        break;
      case 'turn':
        this.startOneShot('turn', (q) => q.onGround && !q.dashing && !q.attacking);
        break;
      case 'attack':
        this.startOneShot('attack', (q) => q.attacking && !q.dashing, cfg.attackTime);
        break;
      case 'jump':
      case 'wallJump':
      case 'dashStart':
      case 'hazard':
        if (this.oneShot?.name !== 'attack') this.oneShot = null;
        break;
    }
  }

  private startOneShot(name: string, stillValid: OneShot['stillValid'], fitToSeconds?: number): void {
    if (!this.has(name)) return;
    const duration = this.durations[name] || 0.2;
    // An attack is stretched/squeezed to last exactly as long as the gameplay attack.
    const speed = fitToSeconds && fitToSeconds > 0 ? duration / fitToSeconds : 1;
    this.oneShot = { name, timeLeft: duration / speed, stillValid };
    this.play(name, speed, true);
  }

  /** Call once per rendered frame. */
  update(p: PlayerController, cfg: PlayerConfig, dt: number): void {
    if (this.oneShot) {
      this.oneShot.timeLeft -= dt;
      if (this.oneShot.timeLeft > 0 && this.oneShot.stillValid(p)) return;
      this.oneShot = null;
    }
    switch (p.state) {
      case 'dash': this.play('dash'); break;
      case 'wallSlide': this.play('wallSlide'); break;
      case 'jump': this.play('jump'); break;
      case 'fall':
      case 'dead': this.play('fall'); break;
      case 'run':
        // Legs keep pace with the actual ground speed.
        this.play('run', clamp(Math.abs(p.vx) / Math.max(cfg.runSpeed, 1), 0.45, 1.4));
        break;
      default: this.play('idle');
    }
  }

  private play(name: string, speed = 1, restart = false): void {
    // Missing animation? Fall back to something sensible instead of crashing.
    if (!this.has(name)) {
      const fallback = name === 'jump' || name === 'doubleJump' ? 'fall' : name === 'fall' ? 'jump' : 'idle';
      name = this.has(fallback) ? fallback : this.has('idle') ? 'idle' : '';
      if (!name) return;
    }
    if (!restart && name === this.lastPlayed && Math.abs(speed - this.lastSpeed) < 0.03) return;
    this.lastPlayed = name;
    this.lastSpeed = speed;
    this.target.play(name, { speed, restart });
  }
}
