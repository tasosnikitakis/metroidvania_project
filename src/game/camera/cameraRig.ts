/**
 * CAMERA RIG  (pure TypeScript - no Phaser)
 * -----------------------------------------
 * Works out where the camera should look. It is stepped in the fixed
 * simulation loop (like the player) and interpolated when rendering, so the
 * camera and the hero always move in lock-step and never jitter against each
 * other.
 *
 *  - deadzone:   the hero can move inside a small box without the camera moving
 *  - lerp:       the camera eases toward where it wants to be
 *  - look-ahead: the view leads in the direction the hero faces
 *  - bounds:     never shows outside the room (small rooms are centred)
 *  - shake:      a short damped "thump" on hard landings
 */
import type { CameraConfig } from '../../shared/types';
import { clamp, lerp, lerpFactor } from '../core/math';

export class CameraRig {
  /** Point the camera is centred on (before look-ahead), logical px. */
  x = 0;
  y = 0;
  /** Current look-ahead offset. */
  lookX = 0;

  private prevX = 0;
  private prevY = 0;
  private prevLookX = 0;
  private shakeAmp = 0;
  private shakeTime = 0;
  /** Reused result object for getView() so rendering creates no garbage. */
  private out = { x: 0, y: 0 };

  /** Jump straight to a target (room start, respawn, room change). */
  snapTo(targetX: number, targetY: number, facing: number, cfg: CameraConfig): void {
    this.x = this.prevX = targetX;
    this.y = this.prevY = targetY;
    this.lookX = this.prevLookX = facing * cfg.lookAhead;
  }

  /** One fixed simulation step. `target` is the point to follow (the hero's chest). */
  step(targetX: number, targetY: number, facing: number, cfg: CameraConfig, dt: number): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevLookX = this.lookX;

    // Deadzone: only chase the part of the target that pokes out of the box.
    const halfW = Math.max(0, cfg.deadzoneW) / 2;
    const halfH = Math.max(0, cfg.deadzoneH) / 2;
    const wantX = clamp(this.x, targetX - halfW, targetX + halfW);
    const wantY = clamp(this.y, targetY - halfH, targetY + halfH);

    // lerpX / lerpY are "per 60 fps frame" factors; convert for our step size.
    this.x = lerp(this.x, wantX, lerpFactor(cfg.lerpX, dt));
    this.y = lerp(this.y, wantY, lerpFactor(cfg.lerpY, dt));
    this.lookX = lerp(this.lookX, facing * cfg.lookAhead, lerpFactor(cfg.lookAheadLerp, dt));

    this.shakeTime += dt;
  }

  /** Start a landing thump. `strength` is in logical px. */
  shake(strength: number): void {
    if (strength <= 0) return;
    this.shakeAmp = Math.max(this.currentShakeEnvelope(), strength);
    this.shakeTime = 0;
  }

  private currentShakeEnvelope(): number {
    return this.shakeAmp * Math.exp(-this.shakeTime * 14);
  }

  /**
   * Final camera centre for rendering. (Returns a shared object - read it, don't keep it.)
   * @param alpha     interpolation fraction from the fixed-step loop
   * @param viewW/H   visible logical px
   * @param roomW/H   room size in logical px
   */
  getView(alpha: number, viewW: number, viewH: number, roomW: number, roomH: number): { x: number; y: number } {
    let x = lerp(this.prevX, this.x, alpha) + lerp(this.prevLookX, this.lookX, alpha);
    let y = lerp(this.prevY, this.y, alpha);
    x = clampToRoom(x, viewW, roomW);
    y = clampToRoom(y, viewH, roomH);
    // Damped vertical bounce; applied after clamping so it is visible at room edges too.
    const t = this.shakeTime + alpha / 120;
    const env = this.shakeAmp * Math.exp(-t * 14);
    if (env > 0.02) y += env * Math.cos(t * 42);
    this.out.x = x;
    this.out.y = y;
    return this.out;
  }
}

/** Keep a view of size `view` inside 0..room; centre it if the room is smaller. */
export function clampToRoom(center: number, view: number, room: number): number {
  if (room <= view) return room / 2;
  return clamp(center, view / 2, room - view / 2);
}
