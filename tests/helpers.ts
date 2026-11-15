import type { PlayerConfig } from '../src/shared/types';
import { NO_INPUT, PlayerController, type StepInput } from '../src/game/player/controller';
import type { CollisionGrid } from '../src/game/physics/grid';

export const DT = 1 / 120;

/** A fixed config for tests so retuning content/game-config.json never breaks them. */
export const TEST_PLAYER: PlayerConfig = {
  width: 30, height: 66,
  runSpeed: 300, groundAccel: 3000, groundDecel: 3600, airAccel: 2200, airDecel: 1400, turnBoost: 1.6,
  jumpHeight: 150, jumpTimeToApex: 0.4, fallGravityMult: 1.6, jumpCutMult: 0.45,
  apexHangThreshold: 60, apexHangGravityMult: 0.5, maxFallSpeed: 900, coyoteTime: 0.1, jumpBuffer: 0.12,
  airJumps: 1, airJumpHeight: 110,
  wallSlideEnabled: true, wallSlideSpeed: 120, wallJumpEnabled: true, wallJumpSpeedX: 320, wallJumpHeight: 130,
  wallJumpLockTime: 0.16,
  dashEnabled: true, dashSpeed: 800, dashTime: 0.18, dashCooldown: 0.3, airDashes: 1,
  attackEnabled: true, attackTime: 0.3, attackCooldown: 0.1,
};

export function input(partial: Partial<StepInput> = {}): StepInput {
  return { ...NO_INPUT, ...partial };
}

/** Run `seconds` of simulation with the same input (pressed flags only on the first step). */
export function run(
  p: PlayerController, grid: CollisionGrid, seconds: number, inp: Partial<StepInput> = {},
  cfg: PlayerConfig = TEST_PLAYER, each?: (p: PlayerController) => void,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const first = i === 0;
    p.step(
      input({ ...inp, jumpPressed: first && !!inp.jumpPressed, dashPressed: first && !!inp.dashPressed, attackPressed: first && !!inp.attackPressed }),
      cfg, grid, DT,
    );
    each?.(p);
  }
}

/** Create a player standing at tile column/row (feet on top of row `floorRow`). */
export function spawn(grid: CollisionGrid, col: number, floorRow: number): PlayerController {
  const p = new PlayerController();
  p.teleport((col + 0.5) * grid.tileSize, floorRow * grid.tileSize);
  run(p, grid, 0.05);
  p.events.length = 0;
  return p;
}
