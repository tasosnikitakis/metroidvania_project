import { describe, expect, it } from 'vitest';
import { gridFromAscii } from '../src/game/physics/grid';
import { moveX, moveY } from '../src/game/physics/move';
import { derivePhysics } from '../src/game/player/derive';
import { DT, TEST_PLAYER, run, spawn } from './helpers';

const FLAT = gridFromAscii([
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '####################',
]);
const FLOOR_Y = 8 * 48;

describe('swept movement', () => {
  it('stops flush against walls and never tunnels, even at silly speeds', () => {
    const g = gridFromAscii(['....#', '....#', '#####']);
    const b = { x: 60, y: 96, w: 30, h: 66 };
    expect(moveX(g, b, 5000)).toBe(true);
    expect(b.x).toBeCloseTo(4 * 48 - 15);
    expect(moveX(g, b, -5000)).toBe(true); // room edge is solid
    expect(b.x).toBeCloseTo(15);
    expect(moveY(g, b, 9999)).toBe(true);
    expect(b.y).toBeCloseTo(96);
  });
});

describe('jumping', () => {
  it('a fully held jump reaches the configured height', () => {
    const p = spawn(FLAT, 5, 8);
    expect(p.onGround).toBe(true);
    let top = p.y;
    run(p, FLAT, 1.2, { jumpPressed: true, jumpHeld: true }, TEST_PLAYER, (q) => (top = Math.min(top, q.y)));
    expect(FLOOR_Y - top).toBeGreaterThan(TEST_PLAYER.jumpHeight - 1.5);
    expect(FLOOR_Y - top).toBeLessThan(TEST_PLAYER.jumpHeight + 1.5);
    expect(p.onGround).toBe(true);
  });

  it('height does not depend on the step size', () => {
    for (const hz of [60, 120, 240]) {
      const p = spawn(FLAT, 5, 8);
      let top = p.y;
      p.step({ moveX: 0, moveY: 0, jumpHeld: true, jumpPressed: true, dashPressed: false, attackPressed: false }, TEST_PLAYER, FLAT, 1 / hz);
      for (let i = 0; i < hz; i++) {
        p.step({ moveX: 0, moveY: 0, jumpHeld: true, jumpPressed: false, dashPressed: false, attackPressed: false }, TEST_PLAYER, FLAT, 1 / hz);
        top = Math.min(top, p.y);
      }
      expect(Math.abs(FLOOR_Y - top - TEST_PLAYER.jumpHeight)).toBeLessThan(3);
    }
  });

  it('releasing early gives a much lower jump (jump cut)', () => {
    const p = spawn(FLAT, 5, 8);
    let top = p.y;
    run(p, FLAT, 0.05, { jumpPressed: true, jumpHeld: true });
    run(p, FLAT, 1, {}, TEST_PLAYER, (q) => (top = Math.min(top, q.y)));
    expect(FLOOR_Y - top).toBeLessThan(TEST_PLAYER.jumpHeight * 0.6);
    expect(FLOOR_Y - top).toBeGreaterThan(10);
  });

  it('a one-step tap still jumps', () => {
    const p = spawn(FLAT, 5, 8);
    run(p, FLAT, DT, { jumpPressed: true });
    expect(p.onGround).toBe(false);
    expect(p.vy).toBeLessThan(0);
  });

  it('coyote time: can jump shortly after walking off a ledge, but not long after', () => {
    const ledge = gridFromAscii(['..........', '..........', '..........', '####......', '..........', '..........', '..........', '..........', '..........', '##########']);
    const walkOff = () => {
      const p = spawn(ledge, 3, 3);
      while (p.onGround) run(p, ledge, DT, { moveX: 1 });
      return p;
    };
    let p = walkOff();
    run(p, ledge, TEST_PLAYER.coyoteTime * 0.6, { moveX: 1 });
    run(p, ledge, DT, { jumpPressed: true, jumpHeld: true });
    expect(p.vy).toBeLessThan(0);
    expect(p.airJumpsLeft).toBe(TEST_PLAYER.airJumps); // it was a ground jump, not the double jump

    p = walkOff();
    run(p, ledge, TEST_PLAYER.coyoteTime + 0.05, { moveX: 1 });
    run(p, ledge, DT, { jumpPressed: true, jumpHeld: true });
    expect(p.airJumpsLeft).toBe(TEST_PLAYER.airJumps - 1); // too late: used the air jump
  });

  it('jump buffer: pressing just before landing jumps on touchdown', () => {
    const p = spawn(FLAT, 5, 8);
    const cfg = { ...TEST_PLAYER, airJumps: 0 };
    p.teleport(p.x, FLOOR_Y - 30);
    // fall until just above the floor
    while (FLOOR_Y - p.y > 6) run(p, FLAT, DT, {}, cfg);
    p.events.length = 0;
    run(p, FLAT, 0.1, { jumpPressed: true, jumpHeld: true }, cfg);
    expect(p.events.some((e) => e.type === 'land')).toBe(true);
    expect(p.events.some((e) => e.type === 'jump')).toBe(true);
    expect(p.vy).toBeLessThan(0);
  });

  it('double jump works once per airtime and respects airJumps = 0', () => {
    const p = spawn(FLAT, 5, 8);
    run(p, FLAT, 0.3, { jumpPressed: true, jumpHeld: true });
    run(p, FLAT, 0.05, {});
    run(p, FLAT, DT, { jumpPressed: true, jumpHeld: true });
    expect(p.events.filter((e) => e.type === 'airJump').length).toBe(1);
    run(p, FLAT, 0.1, {});
    run(p, FLAT, DT, { jumpPressed: true, jumpHeld: true });
    expect(p.events.filter((e) => e.type === 'airJump').length).toBe(1);

    const q = spawn(FLAT, 5, 8);
    const cfg = { ...TEST_PLAYER, airJumps: 0 };
    run(q, FLAT, 0.3, { jumpPressed: true, jumpHeld: true }, cfg);
    run(q, FLAT, DT, { jumpPressed: true, jumpHeld: true }, cfg);
    expect(q.events.some((e) => e.type === 'airJump')).toBe(false);
  });

  it('falls faster than it rises and respects max fall speed', () => {
    const tall = gridFromAscii([...Array(60).fill('....'), '####']);
    const p = spawn(tall, 1, 2);
    p.teleport(p.x, 100);
    let max = 0;
    run(p, tall, 2, {}, TEST_PLAYER, (q) => (max = Math.max(max, q.vy)));
    expect(max).toBeCloseTo(TEST_PLAYER.maxFallSpeed, 3);
    expect(derivePhysics(TEST_PLAYER).gravity).toBeCloseTo((2 * 150) / 0.16);
  });
});

describe('running', () => {
  it('accelerates to run speed and stops', () => {
    const p = spawn(FLAT, 2, 8);
    run(p, FLAT, 0.5, { moveX: 1 });
    expect(p.vx).toBeCloseTo(TEST_PLAYER.runSpeed);
    expect(p.state).toBe('run');
    run(p, FLAT, 0.5, {});
    expect(p.vx).toBe(0);
    expect(p.state).toBe('idle');
  });
});

describe('one-way platforms', () => {
  const g = gridFromAscii([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '..---..',
    '.......',
    '.......',
    '#######',
  ]);
  it('can be jumped through from below and landed on from above', () => {
    const p = spawn(g, 3, 8);
    run(p, g, 1.5, { jumpPressed: true, jumpHeld: true });
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(5 * 48);
  });
  it('down + jump drops through', () => {
    const p = spawn(g, 3, 5);
    expect(p.onGround).toBe(true);
    run(p, g, 1, { moveY: 1, jumpPressed: true });
    expect(p.y).toBeCloseTo(8 * 48);
    expect(p.events.some((e) => e.type === 'dropThrough')).toBe(true);
  });
  it('down + jump on solid ground is a normal jump', () => {
    const p = spawn(g, 0, 8);
    run(p, g, DT, { moveY: 1, jumpPressed: true, jumpHeld: true });
    expect(p.vy).toBeLessThan(0);
  });
  it('does not block sideways movement', () => {
    const p = spawn(g, 0, 8);
    p.teleport(60, 5 * 48 + 30);
    run(p, g, 0.4, { moveX: 1 });
    expect(p.x).toBeGreaterThan(48 * 3);
  });
});

describe('walls', () => {
  const shaft = gridFromAscii([
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '#....#',
    '######',
  ]);
  it('slides slowly down a wall when pushing into it', () => {
    const p = spawn(shaft, 1, 9);
    p.teleport(48 + 15, 200);
    run(p, shaft, 0.6, { moveX: -1 });
    expect(p.state).toBe('wallSlide');
    expect(p.vy).toBeCloseTo(TEST_PLAYER.wallSlideSpeed, 0);
    // letting go falls normally
    run(p, shaft, 0.15, {});
    expect(p.vy).toBeGreaterThan(TEST_PLAYER.wallSlideSpeed * 1.5);
  });
  it('wall jump kicks away from the wall and upward', () => {
    const p = spawn(shaft, 1, 9);
    p.teleport(48 + 15, 250);
    run(p, shaft, 0.3, { moveX: -1 });
    run(p, shaft, DT, { moveX: -1, jumpPressed: true, jumpHeld: true });
    expect(p.events.some((e) => e.type === 'wallJump')).toBe(true);
    expect(p.vx).toBeGreaterThan(TEST_PLAYER.wallJumpSpeedX * 0.9);
    expect(p.vy).toBeLessThan(0);
    expect(p.facing).toBe(1);
  });
  it('can climb a shaft by alternating wall jumps', () => {
    const tall = gridFromAscii([...Array(30).fill('#...#'), '#####']);
    const p = spawn(tall, 1, 30);
    const startY = p.y;
    run(p, tall, 0.25, { moveX: -1, jumpPressed: true, jumpHeld: true });
    let dir = -1;
    for (let i = 0; i < 8; i++) {
      // hold toward the current wall until we touch it, then jump off it
      let guard = 0;
      while (p.wallDir !== dir && guard++ < 240) run(p, tall, DT, { moveX: dir, jumpHeld: true });
      run(p, tall, DT, { moveX: dir, jumpPressed: true, jumpHeld: true });
      dir = -dir;
    }
    expect(startY - p.y).toBeGreaterThan(48 * 8);
  });
  it('respects the enable flags', () => {
    const cfg = { ...TEST_PLAYER, wallSlideEnabled: false, wallJumpEnabled: false, airJumps: 0 };
    const p = spawn(shaft, 1, 9);
    p.teleport(48 + 15, 200);
    run(p, shaft, 0.4, { moveX: -1 }, cfg);
    expect(p.state).toBe('fall');
    run(p, shaft, DT, { moveX: -1, jumpPressed: true }, cfg);
    expect(p.events.some((e) => e.type === 'wallJump')).toBe(false);
  });
});

describe('dash', () => {
  it('covers dashSpeed * dashTime in a straight line with no gravity', () => {
    const p = spawn(FLAT, 2, 8);
    p.teleport(p.x, FLOOR_Y - 100); // in the air
    const x0 = p.x;
    const y0 = p.y;
    run(p, FLAT, TEST_PLAYER.dashTime, { dashPressed: true });
    expect(Math.abs(p.x - x0 - TEST_PLAYER.dashSpeed * TEST_PLAYER.dashTime)).toBeLessThan(TEST_PLAYER.dashSpeed * DT + 0.01); // within one step
    expect(p.y).toBeCloseTo(y0);
    expect(Math.abs(p.vx)).toBeLessThanOrEqual(TEST_PLAYER.runSpeed);
  });
  it('limits air dashes and applies the cooldown', () => {
    const tall = gridFromAscii([...Array(40).fill('....................'), '####################']);
    const p = spawn(tall, 2, 40);
    p.teleport(p.x, 100);
    run(p, tall, 0.5, { dashPressed: true });
    run(p, tall, 0.2, { dashPressed: true });
    expect(p.events.filter((e) => e.type === 'dashStart').length).toBe(1);

    const q = spawn(FLAT, 2, 8);
    run(q, FLAT, TEST_PLAYER.dashTime + 0.02, { dashPressed: true });
    run(q, FLAT, 0.02, { dashPressed: true }); // still cooling down
    expect(q.events.filter((e) => e.type === 'dashStart').length).toBe(1);
    run(q, FLAT, TEST_PLAYER.dashCooldown + 0.3, {});
    run(q, FLAT, 0.02, { dashPressed: true });
    expect(q.events.filter((e) => e.type === 'dashStart').length).toBe(2);
  });
  it('is disabled by dashEnabled = false', () => {
    const p = spawn(FLAT, 2, 8);
    run(p, FLAT, 0.1, { dashPressed: true }, { ...TEST_PLAYER, dashEnabled: false });
    expect(p.events.some((e) => e.type === 'dashStart')).toBe(false);
  });
});

describe('hazards, attack, corners', () => {
  it('touching a hazard kills the player and freezes the controller', () => {
    const g = gridFromAscii(['.....', '.....', '..^..', '#####']);
    const p = spawn(g, 0, 3);
    run(p, g, 1, { moveX: 1 });
    expect(p.dead).toBe(true);
    expect(p.events.filter((e) => e.type === 'hazard').length).toBe(1);
  });
  it('attack exposes a hitbox in front of the player for part of the swing', () => {
    const p = spawn(FLAT, 5, 8);
    let sawBox = false;
    run(p, FLAT, TEST_PLAYER.attackTime, { attackPressed: true }, TEST_PLAYER, (q) => {
      const box = q.getAttackHitbox();
      if (box) {
        sawBox = true;
        expect(box.x + box.w).toBeGreaterThan(q.x + q.w / 2);
      }
    });
    expect(sawBox).toBe(true);
    expect(p.events.some((e) => e.type === 'attack')).toBe(true);
    run(p, FLAT, 0.05, {});
    expect(p.getAttackHitbox()).toBeNull();
  });
  it('corner correction slips past the edge of a ceiling block', () => {
    const g = gridFromAscii(['.....', '.....', '..#..', '.....', '.....', '.....', '#####']);
    const p = spawn(g, 2, 6);
    // stand so only 5px of the head would clip the block's left corner
    p.teleport(2 * 48 - 15 + 5, 6 * 48);
    run(p, g, 0.02, {});
    let top = p.y;
    run(p, g, 0.5, { jumpPressed: true, jumpHeld: true }, TEST_PLAYER, (q) => (top = Math.min(top, q.y)));
    expect(6 * 48 - top).toBeGreaterThan(140); // full jump, was not stopped by the block
  });
  it('ledge forgiveness pops the feet up onto a ledge they barely missed', () => {
    const g = gridFromAscii(['......', '......', '...###', '...###', '######']);
    const p = spawn(g, 0, 4);
    p.teleport(3 * 48 - 15 - 2, 2 * 48 + 5); // feet 5px below the ledge top, just left of it
    run(p, g, 0.1, { moveX: 1 }, { ...TEST_PLAYER, runSpeed: 300 });
    expect(p.y).toBeCloseTo(2 * 48);
    expect(p.onGround).toBe(true);
  });
});
