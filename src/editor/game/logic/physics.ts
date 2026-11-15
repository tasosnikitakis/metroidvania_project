/**
 * JUMP MATHS FOR THE READ-OUTS AND THE ARC GRAPH  (pure, no DOM)
 * -------------------------------------------------------------
 * The game does not store "gravity" - it stores friendlier numbers
 * ("jump THIS high in THIS much time") and works gravity out:
 *
 *      gravity    = 2 x height / time²
 *      launch speed ≈ 2 x height / time     (then corrected for the floaty "hang time")
 *
 * That conversion lives in the GAME (src/game/player/derive.ts) and we import
 * it rather than copying it, so the editor can never disagree with the game.
 *
 * Everything else here (how long is a jump in the air? how far does it go?)
 * is found by *playing the jump in fast-forward*: `simulateJump` repeats the
 * exact per-step rules of the player controller (src/game/player/controller.ts,
 * section "6. vertical velocity") at the game's own step rate, on flat ground.
 */
import { TILE_SIZE, type PlayerConfig } from '../../../shared/types';
import { SIM_DT } from '../../../game/constants';
import { derivePhysics } from '../../../game/player/derive';

export interface ArcPoint { t: number; x: number; /** height above the ground, px (up is positive) */ h: number }

export interface JumpArc {
  points: ArcPoint[];
  /** Highest point above the ground, px. */
  apexHeight: number;
  /** Seconds from take-off to the highest point. */
  apexTime: number;
  /** Seconds from take-off to landing. */
  airTime: number;
  /** Sideways distance covered when running at full speed, px. */
  distance: number;
  /** Times at which mid-air jumps were used. */
  airJumpTimes: number[];
}

export interface JumpOptions {
  /** Seconds the jump button is held. Infinity = held all the way (full jump). */
  hold: number;
  /** When to use the mid-air jumps: at the top of each arc, or at the last moment before landing. */
  airJumps?: 'none' | 'atApex' | 'lastMoment';
  /** Sideways speed during the jump (defaults to runSpeed). */
  speedX?: number;
  dt?: number;
}

/** A quick tap: the button is down for about one 60 fps frame. */
export const TAP_HOLD = 1 / 60;

export function simulateJump(cfg: PlayerConfig, opts: JumpOptions): JumpArc {
  const dt = opts.dt ?? SIM_DT;
  const phys = derivePhysics(cfg);
  const speedX = opts.speedX ?? cfg.runSpeed;
  const mode = opts.airJumps ?? 'none';
  let airJumpsLeft = mode === 'none' ? 0 : Math.max(0, Math.floor(cfg.airJumps));

  let y = 0;                 // screen-style: negative = above the ground
  let vy = -phys.jumpSpeed;  // negative = moving up
  let cutArmed = true;       // letting go while rising chops the jump
  let holdUntil = opts.hold; // air jumps are always "held" fully
  let t = 0;
  let apexHeight = 0, apexTime = 0;
  const points: ArcPoint[] = [{ t: 0, x: 0, h: 0 }];
  const airJumpTimes: number[] = [];
  const maxSteps = Math.ceil(20 / dt); // safety net: no jump lasts 20 s

  const airJump = () => {
    airJumpsLeft--;
    vy = -phys.airJumpSpeed;
    cutArmed = true;
    holdUntil = Infinity;
    airJumpTimes.push(t);
  };

  for (let i = 0; i < maxSteps; i++) {
    // -- use a mid-air jump? (the controller does this before moving) --
    if (airJumpsLeft > 0 && i > 0) {
      if (mode === 'atApex' && vy >= 0) airJump();
      else if (mode === 'lastMoment' && vy > 0) {
        const g = phys.gravity * cfg.fallGravityMult;
        if (y + vy * dt + 0.5 * g * dt * dt >= 0) airJump();
      }
    }
    const held = t < holdUntil;
    // -- the controller's vertical rules, in the same order --
    if (vy >= 0) cutArmed = false;
    if (cutArmed && !held) { vy *= cfg.jumpCutMult; cutArmed = false; }
    let g = phys.gravity;
    if (vy > 0) g *= cfg.fallGravityMult;
    if (held && Math.abs(vy) < cfg.apexHangThreshold) g *= cfg.apexHangGravityMult;
    let dy = vy * dt + 0.5 * g * dt * dt;
    vy += g * dt;
    if (vy > cfg.maxFallSpeed) { vy = cfg.maxFallSpeed; dy = Math.min(dy, vy * dt); }

    if (y + dy >= 0 && dy > 0) {
      // Landed part-way through this step: find the exact moment.
      const frac = dy > 0 ? Math.min(1, Math.max(0, -y / dy)) : 1;
      t += dt * frac;
      y = 0;
      points.push({ t, x: speedX * t, h: 0 });
      break;
    }
    y += dy;
    t += dt;
    if (-y > apexHeight) { apexHeight = -y; apexTime = t; }
    points.push({ t, x: speedX * t, h: -y });
  }
  return { points, apexHeight, apexTime, airTime: t, distance: speedX * t, airJumpTimes };
}

/** All the "what does this actually mean?" numbers shown next to the sliders. */
export interface DerivedStats {
  gravity: number;            // px/s², while rising
  fallGravity: number;        // px/s², while falling
  jumpSpeed: number;          // px/s at take-off
  fullJumpHeight: number;     // px
  tapJumpHeight: number;      // px
  timeToApex: number;         // s (real, including hang time)
  airTime: number;            // s for a full jump on flat ground
  jumpDistance: number;       // px at run speed
  doubleJumpHeight: number;   // px: full jump + all air jumps used at the top
  doubleJumpDistance: number; // px: air jumps used at the last moment
  doubleJumpAirTime: number;  // s
  wallJumpHeight: number;     // px (the configured number)
  dashDistance: number;       // px
  timeToTopSpeed: number;     // s from standing to full run speed
  stopTime: number;           // s from full speed to standing
}

export function deriveStats(cfg: PlayerConfig): DerivedStats {
  const phys = derivePhysics(cfg);
  const full = simulateJump(cfg, { hold: Infinity });
  const tap = simulateJump(cfg, { hold: TAP_HOLD });
  const high = simulateJump(cfg, { hold: Infinity, airJumps: 'atApex' });
  const far = simulateJump(cfg, { hold: Infinity, airJumps: 'lastMoment' });
  return {
    gravity: phys.gravity,
    fallGravity: phys.gravity * cfg.fallGravityMult,
    jumpSpeed: phys.jumpSpeed,
    fullJumpHeight: full.apexHeight,
    tapJumpHeight: tap.apexHeight,
    timeToApex: full.apexTime,
    airTime: full.airTime,
    jumpDistance: full.distance,
    doubleJumpHeight: high.apexHeight,
    doubleJumpDistance: far.distance,
    doubleJumpAirTime: far.airTime,
    wallJumpHeight: cfg.wallJumpHeight,
    // The dash holds dashSpeed for dashTime and ignores gravity (give or take one 1/120 s step).
    dashDistance: cfg.dashEnabled ? cfg.dashSpeed * cfg.dashTime : 0,
    timeToTopSpeed: cfg.groundAccel > 0 ? cfg.runSpeed / cfg.groundAccel : Infinity,
    stopTime: cfg.groundDecel > 0 ? cfg.runSpeed / cfg.groundDecel : Infinity,
  };
}

export const toTiles = (px: number): number => px / TILE_SIZE;

/** The three curves drawn on the jump-arc graph. */
export function jumpArcs(cfg: PlayerConfig): { tap: JumpArc; full: JumpArc; double: JumpArc | null } {
  return {
    tap: simulateJump(cfg, { hold: TAP_HOLD }),
    full: simulateJump(cfg, { hold: Infinity }),
    double: Math.floor(cfg.airJumps) > 0 && cfg.airJumpHeight > 0 ? simulateJump(cfg, { hold: Infinity, airJumps: 'atApex' }) : null,
  };
}
