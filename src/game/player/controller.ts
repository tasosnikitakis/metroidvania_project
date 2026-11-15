/**
 * PLAYER CONTROLLER  (pure TypeScript - no Phaser)
 * ------------------------------------------------
 * A hand-written "kinematic" platformer controller: we decide the velocity
 * ourselves every step (instead of a physics engine pushing us around),
 * which is what makes movement feel tight and predictable.
 *
 * It is stepped at a fixed rate by the game scene:
 *     controller.step(input, config.player, grid, dt)
 * and reports what happened through `controller.events` so the scene can
 * play animations, dust, camera shake and sound without the physics knowing
 * about any of that.
 *
 * Every number comes from PlayerConfig (content/game-config.json).
 */
import type { PlayerConfig } from '../../shared/types';
import { approach } from '../core/math';
import type { CollisionGrid } from '../physics/grid';
import {
  moveX, moveY, overlapsHazard, overlapsSolid, probeGround, touchingWall, type Body,
} from '../physics/move';
import { derivePhysics } from './derive';

/** What the player is asking for during ONE simulation step. */
export interface StepInput {
  /** -1 (left) .. 1 (right). */
  moveX: number;
  /** -1 (up) .. 1 (down). */
  moveY: number;
  jumpHeld: boolean;
  /** True only on the step the button went down. */
  jumpPressed: boolean;
  dashPressed: boolean;
  attackPressed: boolean;
}

export const NO_INPUT: StepInput = {
  moveX: 0, moveY: 0, jumpHeld: false, jumpPressed: false, dashPressed: false, attackPressed: false,
};

export type MoveState = 'idle' | 'run' | 'jump' | 'fall' | 'wallSlide' | 'dash' | 'dead';

export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'airJump' }
  | { type: 'wallJump'; wallDir: 1 | -1 }
  | { type: 'land'; speed: number }
  | { type: 'turn'; dir: 1 | -1 }
  | { type: 'dashStart'; dir: 1 | -1 }
  | { type: 'dashEnd' }
  | { type: 'attack'; dir: 1 | -1 }
  | { type: 'wallSlideStart'; wallDir: 1 | -1 }
  | { type: 'dropThrough' }
  | { type: 'hazard' };

export interface Rect { x: number; y: number; w: number; h: number }

/* Small fixed feel constants that are not worth a config slider. */
const CORNER_CORRECTION = 8;   // px we nudge sideways to slip past a ceiling corner
const LEDGE_STEP = 8;          // px we pop up when the feet just miss a ledge
const WALL_COYOTE = 0.09;      // s after leaving a wall that a wall jump still works
const DROP_THROUGH_TIME = 0.16; // s one-way platforms are ignored after down+jump
const ACTION_BUFFER = 0.1;     // s a dash/attack press is remembered
const HAZARD_INSET = 5;        // px of forgiveness around spikes
const INPUT_DEADZONE = 0.3;

export class PlayerController implements Body {
  /* --- position & motion (feet centre, logical px) --- */
  x = 0;
  y = 0;
  w = 30;
  h = 66;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;

  /* --- status the rest of the game reads --- */
  onGround = false;
  state: MoveState = 'idle';
  /** -1 / +1 when touching a wall on that side while airborne, else 0. */
  wallDir: -1 | 0 | 1 = 0;
  wallSliding = false;
  dashing = false;
  dead = false;
  airJumpsLeft = 0;
  airDashesLeft = 0;
  /** Seconds left of the current attack (0 = not attacking). */
  attackTimer = 0;
  /** Things that happened during recent steps; the scene reads then clears this. */
  events: PlayerEvent[] = [];

  /* --- internal timers (seconds) --- */
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private dashBufferTimer = 0;
  private attackBufferTimer = 0;
  private dashTimer = 0;
  private dashCooldownTimer = 0;
  private dashDir: 1 | -1 = 1;
  private attackCooldownTimer = 0;
  private attackTotal = 0;
  private wallCoyoteTimer = 0;
  private lastWallDir: 1 | -1 = 1;
  private wallJumpLockTimer = 0;
  private dropTimer = 0;
  /** True while a jump is still rising and releasing the button should cut it short. */
  private jumpCutArmed = false;
  private lastMoveDir = 0;

  get attacking(): boolean {
    return this.attackTimer > 0;
  }

  /** Put the player somewhere and clear all motion (start, respawn, room change with `keepMotion`). */
  teleport(x: number, y: number, facing?: 1 | -1, keepMotion = false): void {
    this.x = x;
    this.y = y;
    if (facing) this.facing = facing;
    this.dead = false;
    if (keepMotion) return;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.dashing = false;
    this.wallSliding = false;
    this.wallDir = 0;
    this.attackTimer = 0;
    this.coyoteTimer = this.jumpBufferTimer = this.dashBufferTimer = this.attackBufferTimer = 0;
    this.dashTimer = this.wallCoyoteTimer = this.wallJumpLockTimer = this.dropTimer = 0;
    this.dashCooldownTimer = this.attackCooldownTimer = 0;
    this.jumpCutArmed = false;
    this.state = 'idle';
  }

  /** Advance the simulation by `dt` seconds. */
  step(input: StepInput, cfg: PlayerConfig, grid: CollisionGrid, dt: number): void {
    if (this.dead) return;
    const phys = derivePhysics(cfg);
    this.w = cfg.width;
    this.h = cfg.height;

    const dir: -1 | 0 | 1 = input.moveX > INPUT_DEADZONE ? 1 : input.moveX < -INPUT_DEADZONE ? -1 : 0;

    /* 1. ---- timers ---- */
    this.coyoteTimer -= dt;
    this.wallCoyoteTimer -= dt;
    this.dashCooldownTimer -= dt;
    this.attackCooldownTimer -= dt;
    this.wallJumpLockTimer -= dt;
    this.dropTimer -= dt;
    if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - dt);

    // Remember presses for a moment so a slightly-early tap still counts.
    this.jumpBufferTimer = input.jumpPressed ? Math.max(cfg.jumpBuffer, dt) : this.jumpBufferTimer - dt;
    this.dashBufferTimer = input.dashPressed ? ACTION_BUFFER : this.dashBufferTimer - dt;
    this.attackBufferTimer = input.attackPressed ? ACTION_BUFFER : this.attackBufferTimer - dt;

    // Keep the air-ability counters valid if the config was edited live.
    this.airJumpsLeft = Math.min(this.airJumpsLeft, Math.max(0, Math.floor(cfg.airJumps)));
    this.airDashesLeft = Math.min(this.airDashesLeft, Math.max(0, Math.floor(cfg.airDashes)));

    /* 2. ---- dash start ---- */
    if (
      this.dashBufferTimer > 0 && cfg.dashEnabled && !this.dashing && this.dashCooldownTimer <= 0 &&
      (this.onGround || this.airDashesLeft > 0)
    ) {
      if (!this.onGround) this.airDashesLeft--;
      // Dash where the stick points; off a wall we dash away from it.
      this.dashDir = dir !== 0 ? dir : this.wallSliding ? (-this.wallDir as 1 | -1) : this.facing;
      this.facing = this.dashDir;
      this.dashing = true;
      this.dashTimer = cfg.dashTime;
      this.dashBufferTimer = 0;
      this.jumpCutArmed = false;
      this.wallSliding = false;
      this.events.push({ type: 'dashStart', dir: this.dashDir });
    }

    /* 3. ---- attack start ---- */
    if (this.attackBufferTimer > 0 && cfg.attackEnabled && !this.dashing && this.attackCooldownTimer <= 0) {
      this.attackTimer = this.attackTotal = Math.max(cfg.attackTime, dt);
      this.attackCooldownTimer = cfg.attackTime + cfg.attackCooldown;
      this.attackBufferTimer = 0;
      this.events.push({ type: 'attack', dir: this.facing });
    }

    /* 4. ---- jumping ---- */
    let jumpedThisStep = false;
    if (this.jumpBufferTimer > 0) {
      const ground = this.onGround ? probeGround(grid, this) : null;
      if (ground && input.moveY > 0.5 && ground.oneWay && !ground.solid) {
        // Down + jump on a one-way platform: fall through it.
        this.dropTimer = DROP_THROUGH_TIME;
        this.onGround = false;
        this.jumpBufferTimer = 0;
        this.events.push({ type: 'dropThrough' });
      } else if (this.onGround || this.coyoteTimer > 0) {
        this.vy = -phys.jumpSpeed;
        jumpedThisStep = true;
        this.events.push({ type: 'jump' });
      } else if (cfg.wallJumpEnabled && (this.wallDir !== 0 || this.wallCoyoteTimer > 0)) {
        const wall = this.wallDir !== 0 ? this.wallDir : this.lastWallDir;
        this.vy = -phys.wallJumpSpeed;
        this.vx = -wall * cfg.wallJumpSpeedX;
        this.facing = -wall as 1 | -1;
        this.wallJumpLockTimer = cfg.wallJumpLockTime;
        // A wall jump hands back the air abilities, so walls chain nicely.
        this.airJumpsLeft = Math.max(0, Math.floor(cfg.airJumps));
        this.airDashesLeft = Math.max(0, Math.floor(cfg.airDashes));
        jumpedThisStep = true;
        this.events.push({ type: 'wallJump', wallDir: wall });
      } else if (this.airJumpsLeft > 0) {
        this.airJumpsLeft--;
        this.vy = -phys.airJumpSpeed;
        jumpedThisStep = true;
        this.events.push({ type: 'airJump' });
      }
      if (jumpedThisStep) {
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.wallCoyoteTimer = 0;
        this.onGround = false;
        this.wallSliding = false;
        this.jumpCutArmed = true;
        if (this.dashing) this.endDash(cfg, false);
      }
    }

    /* 5. ---- horizontal velocity ---- */
    if (this.dashing) {
      this.vx = this.dashDir * cfg.dashSpeed;
      this.vy = 0; // dashes ignore gravity
      this.dashTimer -= dt;
    } else {
      const target = input.moveX * cfg.runSpeed * (dir === 0 ? 0 : 1);
      let accel: number;
      if (dir === 0) accel = this.onGround ? cfg.groundDecel : cfg.airDecel;
      else {
        accel = this.onGround ? cfg.groundAccel : cfg.airAccel;
        // Reversing direction gets a boost so turning feels snappy.
        if (this.vx !== 0 && Math.sign(this.vx) !== dir) accel *= Math.max(cfg.turnBoost, 1);
      }
      // Just after a wall jump the stick has reduced authority, so the
      // player cannot instantly steer back into the same wall.
      if (this.wallJumpLockTimer > 0 && cfg.wallJumpLockTime > 0) {
        accel *= 1 - this.wallJumpLockTimer / cfg.wallJumpLockTime;
      }
      this.vx = approach(this.vx, target, accel * dt);

      if (dir !== 0 && this.wallJumpLockTimer <= 0 && !this.attacking) this.facing = dir;

      // Skid/turn event for dust + animation.
      if (dir !== 0 && dir !== this.lastMoveDir && this.onGround && this.vx * dir < -0.5 * cfg.runSpeed) {
        this.events.push({ type: 'turn', dir });
      }
    }
    this.lastMoveDir = dir;

    /* 6. ---- vertical velocity ---- */
    let dy = 0;
    if (!this.dashing) {
      if (this.vy >= 0) this.jumpCutArmed = false;
      // Variable jump height: letting go early chops the upward speed.
      if (this.jumpCutArmed && !input.jumpHeld) {
        this.vy *= cfg.jumpCutMult;
        this.jumpCutArmed = false;
      }
      let g = phys.gravity;
      if (this.vy > 0) g *= cfg.fallGravityMult;
      // Floaty apex while the button is held: more time to aim the landing.
      if (!this.onGround && input.jumpHeld && Math.abs(this.vy) < cfg.apexHangThreshold) {
        g *= cfg.apexHangGravityMult;
      }
      // "Velocity Verlet" integration: exact for constant gravity, so the
      // jump height matches the config regardless of the step size.
      dy = this.vy * dt + 0.5 * g * dt * dt;
      this.vy += g * dt;
      const maxFall = this.wallSliding ? Math.min(cfg.wallSlideSpeed, cfg.maxFallSpeed) : cfg.maxFallSpeed;
      if (this.vy > maxFall) {
        // Ease into the wall-slide speed instead of snapping to it.
        this.vy = this.wallSliding ? approach(this.vy - g * dt, maxFall, g * 2 * dt) : maxFall;
        dy = Math.min(dy, this.vy * dt);
      }
    }

    /* 7. ---- move horizontally ---- */
    const dx = this.vx * dt;
    const startX = this.x;
    if (moveX(grid, this, dx)) {
      const remaining = dx - (this.x - startX);
      if (!this.tryLedgeStep(grid, remaining)) {
        this.vx = 0;
        if (this.dashing) this.dashTimer = 0; // dashing into a wall ends the dash
      }
    }

    /* 8. ---- move vertically ---- */
    const fallSpeed = this.vy;
    let landed = false;
    if (dy < 0) {
      const startY = this.y;
      if (moveY(grid, this, dy)) {
        const remaining = dy - (this.y - startY);
        if (!this.tryCornerCorrection(grid, remaining)) this.vy = 0;
      }
    } else if (dy > 0) {
      landed = moveY(grid, this, dy, this.dropTimer > 0);
    }

    /* 9. ---- ground status ---- */
    const wasOnGround = this.onGround || jumpedThisStep;
    if (this.vy >= 0 && !jumpedThisStep) {
      const g = probeGround(grid, this);
      this.onGround = landed || g.solid || (g.oneWay && this.dropTimer <= 0);
    } else {
      this.onGround = false;
    }
    if (this.onGround) {
      if (!wasOnGround) this.events.push({ type: 'land', speed: fallSpeed });
      this.vy = 0;
      this.airJumpsLeft = Math.max(0, Math.floor(cfg.airJumps));
      this.airDashesLeft = Math.max(0, Math.floor(cfg.airDashes));
      this.wallJumpLockTimer = 0;
    } else if (wasOnGround && !jumpedThisStep && this.dropTimer <= 0) {
      // Walked off a ledge: a jump is still allowed for a short "coyote" moment.
      this.coyoteTimer = cfg.coyoteTime;
    }

    /* 10. ---- walls ---- */
    const wasSliding = this.wallSliding;
    this.wallDir = 0;
    this.wallSliding = false;
    if (!this.onGround && !this.dashing) {
      const right = touchingWall(grid, this, 1);
      const left = touchingWall(grid, this, -1);
      if (right && (dir === 1 || !left)) this.wallDir = 1;
      else if (left) this.wallDir = -1;
      if (this.wallDir !== 0) {
        this.wallCoyoteTimer = WALL_COYOTE;
        this.lastWallDir = this.wallDir;
        // Slide only while pushing into the wall and already moving down.
        if (cfg.wallSlideEnabled && dir === this.wallDir && this.vy > 0) {
          this.wallSliding = true;
          this.facing = -this.wallDir as 1 | -1; // look away from the wall, ready to jump
          if (!wasSliding) this.events.push({ type: 'wallSlideStart', wallDir: this.wallDir });
        }
      }
    }

    /* 11. ---- dash end ---- */
    if (this.dashing && this.dashTimer <= 0) this.endDash(cfg, true);

    /* 12. ---- hazards ---- */
    if (overlapsHazard(grid, this, HAZARD_INSET)) {
      this.dead = true;
      this.dashing = false;
      this.attackTimer = 0;
      this.events.push({ type: 'hazard' });
    }

    this.state = this.computeState(dir);
  }

  /**
   * The area the current attack can hit, or null when no attack is active.
   * Enemies do not exist yet - this is ready for them (and drawn by the debug overlay).
   * The swing is "live" during the middle part of the attack animation.
   */
  getAttackHitbox(): Rect | null {
    if (this.attackTimer <= 0 || this.attackTotal <= 0) return null;
    const progress = 1 - this.attackTimer / this.attackTotal;
    if (progress < 0.15 || progress > 0.7) return null;
    const reach = 58;
    const height = this.h * 0.8;
    const left = this.facing === 1 ? this.x + this.w / 2 - 6 : this.x - this.w / 2 + 6 - reach;
    return { x: left, y: this.y - this.h * 0.95, w: reach, h: height };
  }

  /** 0..1 progress through the current attack (0 when idle). */
  get attackProgress(): number {
    return this.attackTimer > 0 && this.attackTotal > 0 ? 1 - this.attackTimer / this.attackTotal : 0;
  }

  private endDash(cfg: PlayerConfig, emit: boolean): void {
    this.dashing = false;
    this.dashTimer = 0;
    this.dashCooldownTimer = cfg.dashCooldown;
    // Leave the dash at running speed so it flows straight into a run.
    const cap = Math.min(cfg.runSpeed, cfg.dashSpeed);
    if (Math.abs(this.vx) > cap) this.vx = Math.sign(this.vx) * cap;
    if (emit) this.events.push({ type: 'dashEnd' });
  }

  /** Ledge forgiveness: feet clipped the lip of a ledge by a few px -> pop up onto it. */
  private tryLedgeStep(grid: CollisionGrid, remainingDx: number): boolean {
    if (this.onGround || this.vy < 0 || remainingDx === 0) return false;
    const sign = Math.sign(remainingDx);
    for (let up = 1; up <= LEDGE_STEP; up++) {
      if (!overlapsSolid(grid, this.x + sign, this.y - up, this.w, this.h)) {
        this.y -= up;
        moveX(grid, this, remainingDx);
        this.vy = 0;
        return true;
      }
    }
    return false;
  }

  /** Corner correction: head clipped the edge of a ceiling by a few px -> slide around it. */
  private tryCornerCorrection(grid: CollisionGrid, remainingDy: number): boolean {
    for (let off = 1; off <= CORNER_CORRECTION; off++) {
      for (const sign of [1, -1]) {
        const nx = this.x + off * sign;
        if (!overlapsSolid(grid, nx, this.y - 1, this.w, this.h)) {
          this.x = nx;
          moveY(grid, this, remainingDy);
          return true;
        }
      }
    }
    return false;
  }

  private computeState(dir: number): MoveState {
    if (this.dead) return 'dead';
    if (this.dashing) return 'dash';
    if (this.wallSliding) return 'wallSlide';
    if (!this.onGround) return this.vy < 0 ? 'jump' : 'fall';
    return dir !== 0 || Math.abs(this.vx) > 12 ? 'run' : 'idle';
  }
}
