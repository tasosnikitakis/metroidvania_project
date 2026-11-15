import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/game/core/fixedLoop';
import { CameraRig, clampToRoom } from '../src/game/camera/cameraRig';
import { findRoomExit, makeOpenOutsideTest } from '../src/game/world/worldMap';
import { lerpFactor } from '../src/game/core/math';
import type { CameraConfig, WorldData } from '../src/shared/types';

describe('FixedStepLoop', () => {
  it('runs the same number of steps per second on any display rate', () => {
    for (const hz of [50, 60, 90, 120, 144, 240]) {
      const loop = new FixedStepLoop(120);
      let steps = 0;
      for (let i = 0; i < hz * 2; i++) loop.advance(1 / hz, () => steps++);
      expect(Math.abs(steps - 240)).toBeLessThanOrEqual(1);
      expect(loop.alpha).toBeGreaterThanOrEqual(0);
      expect(loop.alpha).toBeLessThan(1);
    }
  });
  it('gives exactly 2 steps per frame at 60 Hz (no beat pattern)', () => {
    const loop = new FixedStepLoop(120);
    for (let i = 0; i < 600; i++) expect(loop.advance(1 / 60, () => {})).toBe(2);
  });
  it('clamps huge frames instead of spiralling', () => {
    const loop = new FixedStepLoop(120, 0.1);
    expect(loop.advance(5, () => {})).toBeLessThanOrEqual(13);
  });
  it('interpolated motion is uniform on a 144 Hz display', () => {
    // An object moving 1 unit per step, rendered with interpolation, must
    // advance by the same amount every frame.
    const loop = new FixedStepLoop(120);
    let prev = 0, cur = 0, lastRender = 0;
    const deltas: number[] = [];
    for (let i = 0; i < 300; i++) {
      loop.advance(1 / 144, () => { prev = cur; cur += 1; });
      const render = prev + (cur - prev) * loop.alpha;
      if (i > 2) deltas.push(render - lastRender);
      lastRender = render;
    }
    for (const d of deltas) expect(d).toBeCloseTo(120 / 144, 6);
  });
});

describe('CameraRig', () => {
  const cfg: CameraConfig = { lerpX: 0.15, lerpY: 0.1, lookAhead: 80, lookAheadLerp: 0.05, deadzoneW: 60, deadzoneH: 80, zoom: 1, landShake: 4 };
  it('settles on the target plus look-ahead, at any step rate', () => {
    for (const hz of [60, 120]) {
      const cam = new CameraRig();
      cam.snapTo(0, 0, 1, cfg);
      for (let i = 0; i < hz * 6; i++) cam.step(1000, 500, 1, cfg, 1 / hz);
      const v = cam.getView(1, 1280, 720, 100000, 100000);
      expect(v.x).toBeCloseTo(1000 - 30 + 80, 0); // stops at the deadzone edge
      expect(v.y).toBeCloseTo(500 - 40, 0);
    }
  });
  it('does not move while the target stays in the deadzone', () => {
    const cam = new CameraRig();
    cam.snapTo(500, 500, 1, cfg);
    for (let i = 0; i < 120; i++) cam.step(520, 530, 1, cfg, 1 / 120);
    expect(cam.x).toBe(500);
    expect(cam.y).toBe(500);
  });
  it('clamps to the room and centres small rooms', () => {
    expect(clampToRoom(10, 1280, 5000)).toBe(640);
    expect(clampToRoom(4990, 1280, 5000)).toBe(5000 - 640);
    expect(clampToRoom(123, 1280, 800)).toBe(400);
  });
  it('lerpFactor is frame-rate independent', () => {
    const a = 1 - Math.pow(1 - lerpFactor(0.1, 1 / 120), 2);
    expect(a).toBeCloseTo(0.1, 6);
  });
});

describe('world map', () => {
  const world: WorldData = {
    version: 1, name: 't', startRoom: 'a',
    rooms: [
      { id: 'a', name: 'A', x: 0, y: 0, w: 20, h: 10 },
      { id: 'b', name: 'B', x: 20, y: 5, w: 20, h: 10 },
      { id: 'c', name: 'C', x: 0, y: 10, w: 10, h: 10 },
    ],
  };
  it('finds the neighbour and converts the position', () => {
    const a = world.rooms[0];
    expect(findRoomExit(world, a, 100, 100, 66, 48)).toBeNull();
    const right = findRoomExit(world, a, 20 * 48 + 2, 9 * 48, 66, 48)!;
    expect(right.room.id).toBe('b');
    expect(right.x).toBeCloseTo(2);
    expect(right.y).toBeCloseTo(4 * 48);
    const down = findRoomExit(world, a, 100, 10 * 48 + 40, 66, 48)!;
    expect(down.room.id).toBe('c');
    expect(down.y).toBeCloseTo(40);
    // nothing to the left, nothing right of the top rows
    expect(findRoomExit(world, a, -5, 100, 66, 48)).toBeNull();
    expect(findRoomExit(world, a, 20 * 48 + 2, 2 * 48, 66, 48)).toBeNull();
  });
  it('room edges are open only where a neighbour touches', () => {
    const open = makeOpenOutsideTest(world, world.rooms[0]);
    expect(open(20, 7)).toBe(true);
    expect(open(20, 2)).toBe(false);
    expect(open(-1, 5)).toBe(false);
  });
});
