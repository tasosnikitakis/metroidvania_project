/**
 * POSE PLAYER  (pure logic, no DOM, no Phaser)
 * --------------------------------------------
 * Plays animations with cross-fades EXACTLY the way the game's RigView does
 * (src/rig/index.ts: play() + update()), but produces a pose instead of
 * moving Phaser images. The Animation tab uses it for the "play sequence"
 * tester, so a fade you judge here looks the same in the game.
 *
 * The rules copied from RigView:
 *  - a fade always starts from the pose currently on screen;
 *  - the fade amount is smooth-stepped: k*k*(3-2k);
 *  - non-looping animations hold their last frame;
 *  - the default fade time comes from rig.mix (per-pair value, else default).
 */
import type { AnimData, RigData } from '../../../shared/types';
import { blendPoses, copyPose, mixDuration, sampleAnimation, type LocalPose } from '../../../rig/pose';

const emptyPose = (): LocalPose => ({ bones: [], slotAlpha: [] });

export class PosePlayer {
  private anim: AnimData | undefined;
  private animName = '';
  private time = 0;
  private shown = emptyPose();
  private target = emptyPose();
  private fadeFrom = emptyPose();
  private fadeTime = 0;
  private fadeDuration = 0;

  constructor(private rig: RigData) {
    sampleAnimation(rig, undefined, 0, this.shown);
  }

  get current(): string { return this.animName; }
  get currentTime(): number { return this.time; }
  get finished(): boolean { return !!this.anim && !this.anim.loop && this.time >= this.anim.duration; }
  /** 0..1 while cross-fading, 1 when the fade is done. */
  get fadeProgress(): number { return this.fadeDuration > 0 ? Math.min(1, this.fadeTime / this.fadeDuration) : 1; }
  get pose(): LocalPose { return this.shown; }

  /** Swap in edited data without restarting (like RigView.setRigData). */
  setRig(rig: RigData): void {
    this.rig = rig;
    this.anim = this.animName ? rig.animations[this.animName] : undefined;
    if (!this.anim) this.animName = '';
  }

  play(name: string, opts: { mix?: number; restart?: boolean } = {}): void {
    const next = this.rig.animations[name];
    if (!next) return;
    if (name === this.animName && this.anim && !opts.restart) { this.anim = next; return; }
    const mix = opts.mix ?? (this.animName ? mixDuration(this.rig, this.animName, name) : 0);
    copyPose(this.shown, this.fadeFrom);
    this.fadeTime = 0;
    this.fadeDuration = Math.max(0, mix);
    this.anim = next;
    this.animName = name;
    this.time = 0;
  }

  update(dt: number): LocalPose {
    const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
    const anim = this.anim;
    if (anim) {
      this.time += step;
      sampleAnimation(this.rig, anim, anim.loop ? this.time : Math.min(this.time, anim.duration), this.target);
    } else {
      sampleAnimation(this.rig, undefined, 0, this.target);
    }
    if (this.fadeTime < this.fadeDuration) {
      this.fadeTime += step;
      const k = this.fadeDuration > 0 ? Math.min(1, this.fadeTime / this.fadeDuration) : 1;
      blendPoses(this.fadeFrom, this.target, k * k * (3 - 2 * k), this.shown);
    } else {
      copyPose(this.target, this.shown);
    }
    return this.shown;
  }
}

/** One step of a test sequence. Looping animations play for `hold` seconds; others play once through. */
export interface SequenceStep { anim: string; hold: number }

/**
 * Runs a list of steps on a PosePlayer: run -> jump -> fall -> land -> idle...
 * Call update(dt) every frame; `index` tells you which step is playing.
 */
export class SequenceRunner {
  index = 0;
  done = false;
  private elapsed = 0;

  constructor(private player: PosePlayer, private rig: RigData, private steps: SequenceStep[], private repeat = true) {
    this.start(0);
  }

  private start(i: number): void {
    this.index = i;
    this.elapsed = 0;
    const step = this.steps[i];
    if (step) this.player.play(step.anim, { restart: true });
  }

  /** How long a step stays on screen. */
  static stepLength(rig: RigData, step: SequenceStep): number {
    const a = rig.animations[step.anim];
    if (!a) return 0;
    return a.loop ? Math.max(step.hold, 0.05) : a.duration + Math.max(0, step.hold);
  }

  update(dt: number): LocalPose {
    if (this.done || this.steps.length === 0) return this.player.update(0);
    this.elapsed += dt;
    const len = SequenceRunner.stepLength(this.rig, this.steps[this.index]);
    if (this.elapsed >= len) {
      const over = this.elapsed - len;
      if (this.index + 1 < this.steps.length) this.start(this.index + 1);
      else if (this.repeat) this.start(0);
      else { this.done = true; return this.player.update(dt - over); }
      this.elapsed = over;
      return this.player.update(over);
    }
    return this.player.update(dt);
  }
}
