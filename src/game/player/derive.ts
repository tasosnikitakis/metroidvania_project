/**
 * Turns the designer-friendly numbers in PlayerConfig ("jump this high in
 * this much time") into the raw physics values the controller needs.
 */
import type { PlayerConfig } from '../../shared/types';

export interface DerivedPhysics {
  /** Rising gravity, px/s^2. */
  gravity: number;
  /** Initial upward speed of each kind of jump, px/s (positive numbers). */
  jumpSpeed: number;
  airJumpSpeed: number;
  wallJumpSpeed: number;
}

/**
 * Basic projectile maths:  h = v²/(2g)  and  t = v/g
 *   =>  g = 2h / t²   and   v = 2h / t
 *
 * The "apex hang" makes gravity weaker for the last |vy| < threshold of the
 * rise, which would make jumps go higher than configured. We compensate the
 * launch speed so a fully held jump tops out at exactly `height` px.
 */
function launchSpeed(height: number, gravity: number, cfg: PlayerConfig): number {
  const hang = Math.min(Math.max(cfg.apexHangGravityMult, 0.05), 1);
  const th = Math.max(cfg.apexHangThreshold, 0);
  const plain = 2 * gravity * Math.max(height, 0);
  // Height gained in the hang zone is th²/(2·g·hang) instead of th²/(2·g).
  const compensated = plain - th * th * (1 / hang - 1);
  // If the whole jump is inside the hang zone the simple formula applies.
  return Math.sqrt(compensated > th * th ? compensated : plain * hang);
}

export function derivePhysics(cfg: PlayerConfig): DerivedPhysics {
  const t = Math.max(cfg.jumpTimeToApex, 0.05);
  const gravity = (2 * Math.max(cfg.jumpHeight, 1)) / (t * t);
  return {
    gravity,
    jumpSpeed: launchSpeed(cfg.jumpHeight, gravity, cfg),
    airJumpSpeed: launchSpeed(cfg.airJumpHeight, gravity, cfg),
    wallJumpSpeed: launchSpeed(cfg.wallJumpHeight, gravity, cfg),
  };
}
