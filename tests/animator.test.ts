import { describe, expect, it } from 'vitest';
import { gridFromAscii } from '../src/game/physics/grid';
import { HeroAnimator, type AnimTarget } from '../src/game/player/animator';
import { DT, TEST_PLAYER, input, spawn } from './helpers';

class FakeRig implements AnimTarget {
  current = '';
  log: string[] = [];
  play(name: string): void {
    if (name !== this.current) this.log.push(name);
    this.current = name;
  }
}

const ALL = { idle: 1, run: 0.6, jump: 0.3, fall: 0.3, land: 0.15, doubleJump: 0.3, wallSlide: 0.5, dash: 0.2, attack: 0.3, turn: 0.12 };
const FLAT = gridFromAscii(['..........', '..........', '..........', '..........', '..........', '##########']);

/** Step the controller and the animator together, like the game scene does. */
function drive(anims: Record<string, number>, script: (t: number) => Parameters<typeof input>[0], seconds: number) {
  const rig = new FakeRig();
  const animator = new HeroAnimator(rig, anims);
  const p = spawn(FLAT, 2, 5);
  for (let t = 0; t < seconds; t += DT) {
    p.step(input(script(t)), TEST_PLAYER, FLAT, DT);
    for (const e of p.events) animator.handleEvent(e, p, TEST_PLAYER);
    p.events.length = 0;
    animator.update(p, TEST_PLAYER, DT);
  }
  return rig;
}

describe('HeroAnimator', () => {
  it('idle -> run -> idle', () => {
    const rig = drive(ALL, (t) => ({ moveX: t > 0.1 && t < 0.6 ? 1 : 0 }), 1.2);
    expect(rig.log).toEqual(['idle', 'run', 'idle']);
  });
  it('jump -> fall -> land -> idle', () => {
    const rig = drive(ALL, (t) => ({ jumpPressed: t > 0.1 && t < 0.1 + DT * 1.5, jumpHeld: t > 0.1 && t < 0.6 }), 1.6);
    expect(rig.log).toEqual(['idle', 'jump', 'fall', 'land', 'idle']);
  });
  it('plays doubleJump, dash and attack', () => {
    const tap = (t: number, at: number) => t > at && t < at + DT * 1.5;
    const rig = drive(ALL, (t) => ({
      jumpPressed: tap(t, 0.1) || tap(t, 0.4), jumpHeld: t > 0.1 && t < 0.7,
      dashPressed: tap(t, 1.5), attackPressed: tap(t, 2.2),
    }), 3);
    expect(rig.log).toContain('doubleJump');
    expect(rig.log).toContain('dash');
    expect(rig.log).toContain('attack');
    expect(rig.current).toBe('idle');
  });
  it('falls back to idle when the rig lacks animations (never crashes)', () => {
    const rig = drive({ idle: 1 }, (t) => ({ moveX: 1, jumpPressed: t > 0.2 && t < 0.2 + DT * 1.5, dashPressed: t > 0.5 && t < 0.5 + DT * 1.5 }), 1);
    expect(new Set(rig.log)).toEqual(new Set(['idle']));
    const empty = drive({}, () => ({ moveX: 1 }), 0.2);
    expect(empty.log).toEqual([]);
  });
});
