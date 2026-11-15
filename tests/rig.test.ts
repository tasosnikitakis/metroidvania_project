import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnimData, RigData } from '../src/shared/types';
import { HERO_ANIMS } from '../src/shared/types';
import {
  EASE_NAMES, EASINGS, angleDelta, blendPoses, collectEvents, computeBoneMatrices, computeWorldTransforms,
  drawRigToCanvas, ease, mixDuration, sampleAnimation, sampleTrack, setupPose,
} from '../src/rig/pose';

const bone = (name: string, parent: string | null, x = 0, y = 0, rotation = 0) => ({ name, parent, x, y, rotation, scaleX: 1, scaleY: 1 });
const slot = (name: string, b: string, extra = {}) => ({ name, bone: b, image: `${name}.png`, w: 10, h: 4, imageScale: 2, x: 0, y: 0, rotation: 0, originX: 0, originY: 0.5, ...extra });

function tinyRig(animations: Record<string, AnimData> = {}): RigData {
  return {
    version: 1, name: 'tiny',
    // child listed BEFORE its parent on purpose: evaluation order must not depend on array order
    bones: [bone('hand', 'arm', 10, 0, 0), bone('root', null, 100, 50, 0), bone('arm', 'root', 0, -20, 90)],
    slots: [slot('armImg', 'arm'), slot('handImg', 'hand', { alpha: 0.5, x: 2, rotation: 90 })],
    animations, mix: { default: 0.1, pairs: { 'a>b': 0.3 } },
  };
}

describe('easing', () => {
  it('every EaseName maps 0 -> 0 and 1 -> 1', () => {
    expect(EASE_NAMES.length).toBe(13);
    for (const n of EASE_NAMES) {
      expect(EASINGS[n](1)).toBeCloseTo(1, 6);
      if (n !== 'step') expect(EASINGS[n](0)).toBeCloseTo(0, 6);
    }
    expect(ease('step', 0.99)).toBe(0);
    expect(ease('linear', 2)).toBe(1);
    expect(ease(undefined, 0.5)).toBeCloseTo(0.5, 6); // default sineInOut
    expect(ease('quadIn', 0.5)).toBeCloseTo(0.25, 6);
    expect(ease('quadOut', 0.5)).toBeCloseTo(0.75, 6);
    expect(EASINGS.backOut(0.6)).toBeGreaterThan(1); // overshoots
  });
});

describe('sampleTrack', () => {
  const keys = [{ t: 0.2, v: 10, ease: 'linear' as const }, { t: 0.6, v: 30, ease: 'linear' as const }];
  it('interpolates and clamps when not looping', () => {
    expect(sampleTrack(keys, 0.4, 1, false, 0)).toBeCloseTo(20);
    expect(sampleTrack(keys, 0, 1, false, 0)).toBe(10);
    expect(sampleTrack(keys, 5, 1, false, 0)).toBe(30);
    expect(sampleTrack(undefined, 0.3, 1, false, 7)).toBe(7);
    expect(sampleTrack([{ t: 0.5, v: 3 }], 0, 1, true, 0)).toBe(3);
  });
  it('wraps across the loop boundary seamlessly', () => {
    // last key (0.6 -> 30) to first key (0.2 + 1 -> 10): span 0.6
    expect(sampleTrack(keys, 0.9, 1, true, 0)).toBeCloseTo(20);
    expect(sampleTrack(keys, 0.0, 1, true, 0)).toBeCloseTo(30 - 20 * (0.4 / 0.6));
    const before = sampleTrack(keys, 0.99999, 1, true, 0), after = sampleTrack(keys, 1.00001, 1, true, 0);
    expect(Math.abs(before - after)).toBeLessThan(0.01);
    expect(sampleTrack(keys, -0.1, 1, true, 0)).toBeCloseTo(sampleTrack(keys, 0.9, 1, true, 0));
  });
  it('step easing holds the previous key', () => {
    const k = [{ t: 0, v: 1, ease: 'step' as const }, { t: 0.5, v: 0, ease: 'step' as const }];
    expect(sampleTrack(k, 0.49, 1, true, 9)).toBe(1);
    expect(sampleTrack(k, 0.5, 1, true, 9)).toBe(0);
    expect(sampleTrack(k, 0.99, 1, true, 9)).toBe(0);
  });
});

describe('sampleAnimation + world transforms', () => {
  it('setup pose places slots through the hierarchy', () => {
    const rig = tinyRig();
    const tr = computeWorldTransforms(rig, setupPose(rig));
    expect(tr.map((t) => t.slot.name)).toEqual(['armImg', 'handImg']); // draw order
    expect(tr[0].x).toBeCloseTo(100); expect(tr[0].y).toBeCloseTo(30); expect(tr[0].rotation).toBeCloseTo(90);
    // hand: 10 along the arm (which points down the screen) -> (100, 40); slot offset 2 further
    expect(tr[1].x).toBeCloseTo(100); expect(tr[1].y).toBeCloseTo(42);
    expect(((tr[1].rotation % 360) + 360) % 360).toBeCloseTo(180);
    expect(tr[1].alpha).toBe(0.5);
    expect(tr[1].scaleX).toBeCloseTo(1); expect(tr[1].scaleY).toBeCloseTo(1);
  });
  it('keyframes are offsets from setup (rotation adds, scale multiplies)', () => {
    const rig = tinyRig({ a: { duration: 1, loop: false, bones: { arm: { rotation: [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: -90 }], scaleX: [{ t: 0, v: 2 }] }, root: { x: [{ t: 0, v: 5 }] } }, slots: { handImg: { alpha: [{ t: 0, v: 1, ease: 'linear' }, { t: 1, v: 0 }] } } } });
    const p = sampleAnimation(rig, rig.animations.a, 0.5);
    const arm = p.bones[2];
    expect(arm.rotation).toBeCloseTo(45); expect(arm.scaleX).toBe(2); expect(p.bones[1].x).toBe(105);
    expect(p.slotAlpha).toEqual([1, 0.5]);
    const end = computeWorldTransforms(rig, sampleAnimation(rig, rig.animations.a, 1));
    // arm now points right (rotation 0) and is stretched x2: hand at root + (20, -20)
    expect(end[1].x).toBeCloseTo(105 + 20 + 4); expect(end[1].y).toBeCloseTo(30);
    expect(end[0].scaleX).toBeCloseTo(2);
  });
  it('matrix and decomposition agree for a mirrored bone', () => {
    const rig = tinyRig();
    const pose = setupPose(rig); pose.bones[1].scaleX = -1;
    const [t] = computeWorldTransforms(rig, pose);
    expect(t.a * t.d - t.b * t.c).toBeLessThan(0);
    expect(t.scaleX * t.scaleY).toBeCloseTo(-1);
    expect(computeBoneMatrices(rig, pose).length).toBe(18);
  });
});

describe('blending', () => {
  it('takes the shortest arc for rotations', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20);
    expect(angleDelta(10, 350)).toBeCloseTo(-20);
    expect(angleDelta(0, 360)).toBeCloseTo(0);
    const rig = tinyRig();
    const a = setupPose(rig), b = setupPose(rig);
    a.bones[2].rotation = 350; b.bones[2].rotation = 370; a.bones[2].x = 0; b.bones[2].x = 10; a.slotAlpha[0] = 0;
    const m = blendPoses(a, b, 0.5);
    expect(m.bones[2].rotation).toBeCloseTo(360); expect(m.bones[2].x).toBeCloseTo(5); expect(m.slotAlpha[0]).toBeCloseTo(0.5);
    expect(blendPoses(a, b, 0).bones[2].rotation).toBeCloseTo(350);
    // in-place blending is allowed
    blendPoses(a, b, 1, a); expect(a.bones[2].x).toBeCloseTo(10);
  });
});

describe('events + mix', () => {
  const once: AnimData = { duration: 0.3, loop: false, bones: {}, events: [{ t: 0, name: 'start' }, { t: 0.1, name: 'hit' }] };
  const loop: AnimData = { duration: 0.6, loop: true, bones: {}, events: [{ t: 0, name: 'step' }, { t: 0.3, name: 'step2' }] };
  it('fires each event once in (prev, next]', () => {
    expect(collectEvents(once, -1, 0)).toEqual(['start']);
    expect(collectEvents(once, 0, 0.09)).toEqual([]);
    expect(collectEvents(once, 0.09, 0.12)).toEqual(['hit']);
    expect(collectEvents(once, 0.12, 5)).toEqual([]);
    expect(collectEvents(once, -1, 5)).toEqual(['start', 'hit']);
  });
  it('fires looping events every lap, across the wrap', () => {
    expect(collectEvents(loop, -1, 0.01)).toEqual(['step']);
    expect(collectEvents(loop, 0.5, 0.65)).toEqual(['step']);
    expect(collectEvents(loop, 0.25, 1.0)).toEqual(['step2', 'step', 'step2']);
    expect(collectEvents(loop, 0.65, 0.7)).toEqual([]);
  });
  it('looks up per-pair mix times', () => {
    const rig = tinyRig();
    expect(mixDuration(rig, 'a', 'b')).toBe(0.3); expect(mixDuration(rig, 'b', 'a')).toBe(0.1);
  });
});

describe('drawRigToCanvas', () => {
  it('draws visible slots in order with their matrices', () => {
    const rig = tinyRig();
    const calls: string[] = [];
    const ctx = {
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { calls.push('save'); }, restore() { calls.push('restore'); },
      transform(...m: number[]) { calls.push('t:' + m.map((v) => Math.round(v)).join(',')); },
      drawImage(img: unknown, x: number, y: number, w: number, h: number) { calls.push(`d:${img}:${x},${y},${w},${h}:${this.globalAlpha}`); },
    };
    const pose = setupPose(rig);
    drawRigToCanvas(ctx, rig, computeWorldTransforms(rig, pose), { 'armImg.png': 'A', 'handImg.png': 'H' });
    expect(calls).toEqual(['save', 't:0,1,-1,0,100,30', 'd:A:0,-2,10,4:1', 'restore', 'save', 't:-1,0,0,-1,100,42', 'd:H:0,-2,10,4:0.5', 'restore']);
    calls.length = 0; pose.slotAlpha[0] = 0;
    drawRigToCanvas(ctx, rig, computeWorldTransforms(rig, pose), new Map([['handImg.png', 'H']]));
    expect(calls.filter((c) => c.startsWith('d:')).length).toBe(1);
  });
});

describe('hero rig content', () => {
  const rig = JSON.parse(readFileSync(resolve(__dirname, '../content/rigs/hero.rig.json'), 'utf8')) as RigData;
  const boneNames = new Set(rig.bones.map((b) => b.name));
  it('has every animation the runtime expects, with valid references', () => {
    for (const name of HERO_ANIMS) {
      const a = rig.animations[name];
      expect(a, name).toBeTruthy();
      expect(a.duration).toBeGreaterThan(0);
      for (const [b, track] of Object.entries(a.bones)) {
        expect(boneNames.has(b), `${name}: bone ${b}`).toBe(true);
        for (const keys of Object.values(track)) {
          for (let i = 0; i < keys!.length; i++) {
            expect(keys![i].t).toBeGreaterThanOrEqual(0); expect(keys![i].t).toBeLessThanOrEqual(a.duration + 1e-6);
            if (i) expect(keys![i].t).toBeGreaterThanOrEqual(keys![i - 1].t);
          }
        }
      }
      for (const s of Object.keys(a.slots ?? {})) expect(rig.slots.some((x) => x.name === s), `${name}: slot ${s}`).toBe(true);
    }
    expect(rig.animations.attack.events?.some((e) => e.name === 'hit')).toBe(true);
    for (const s of rig.slots) expect(boneNames.has(s.bone)).toBe(true);
    for (const b of rig.bones) expect(b.parent === null || boneNames.has(b.parent)).toBe(true);
  });
  it('loops are seamless (no pop between the last and first frame)', () => {
    for (const name of HERO_ANIMS) {
      const a = rig.animations[name];
      if (!a.loop) continue;
      const p0 = computeWorldTransforms(rig, sampleAnimation(rig, a, a.duration - 1e-4)).map((t) => ({ ...t }));
      const p1 = computeWorldTransforms(rig, sampleAnimation(rig, a, a.duration + 1e-4));
      p1.forEach((t, i) => {
        if (t.slot.name.startsWith('eyes')) return; // blink is a deliberate step
        expect(Math.hypot(t.x - p0[i].x, t.y - p0[i].y), `${name}/${t.slot.name}`).toBeLessThan(0.2);
        expect(Math.abs(angleDelta(t.rotation, p0[i].rotation))).toBeLessThan(1);
      });
    }
  });
  it('idle keeps the feet planted at ground level', () => {
    const a = rig.animations.idle;
    const fi = rig.bones.findIndex((b) => b.name === 'shinF'), bi = rig.bones.findIndex((b) => b.name === 'shinB');
    for (let i = 0; i < 20; i++) {
      const m = computeBoneMatrices(rig, sampleAnimation(rig, a, (a.duration * i) / 20));
      for (const idx of [fi, bi]) {
        const L = rig.bones[idx].length ?? 0;
        const ankleY = m[idx * 6 + 5] + m[idx * 6 + 1] * L;
        expect(Math.abs(ankleY)).toBeLessThan(0.6);
      }
    }
  });
});
