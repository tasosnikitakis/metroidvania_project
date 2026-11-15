/**
 * Game Editor - pure logic tests (no browser needed).
 * Settings table, jump maths, undo history, presets, keyframe editing, sequence player.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnimData, GameConfig, RigData } from '../src/shared/types';
import { HERO_ANIMS } from '../src/shared/types';
import { gridFromAscii } from '../src/game/physics/grid';
import { derivePhysics } from '../src/game/player/derive';
import { blendPoses, sampleAnimation, sampleTrack } from '../src/rig/pose';
import {
  DEFAULT_GAME_CONFIG, FIELDS, GROUPS, configsEqual, diffConfig, getValue, sanitizeConfig, tidyNumber, withValue,
  type NumberMeta,
} from '../src/editor/game/logic/configMeta';
import { deriveStats, jumpArcs, simulateJump, TAP_HOLD } from '../src/editor/game/logic/physics';
import { History } from '../src/editor/game/logic/history';
import {
  BUILTIN_PRESETS, applyPreset, makeUserPreset, parseUserPresets, removeUserPreset, serializeUserPresets, upsertUserPreset,
} from '../src/editor/game/logic/presets';
import * as K from '../src/editor/game/logic/keyframes';
import { PosePlayer, SequenceRunner } from '../src/editor/game/logic/posePlayer';
import { DT, TEST_PLAYER, run, spawn } from './helpers';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../content/${path}`, import.meta.url), 'utf8')) as T;

/* ------------------------------------------------------------------ */
describe('settings table', () => {
  it('covers every field of content/game-config.json, and nothing else', () => {
    const onDisk = readJson<GameConfig>('game-config.json');
    const expected: string[] = [];
    for (const section of ['player', 'camera', 'feel'] as const) for (const key of Object.keys(onDisk[section])) expected.push(`${section}.${key}`);
    expect(FIELDS.map((f) => f.path).sort()).toEqual(expected.sort());
  });

  it('every field has help text, a known group and a sane range containing its default', () => {
    const groups = new Set<string>(GROUPS.map((g) => g.id));
    for (const f of FIELDS) {
      expect(f.meta.help.length, f.path).toBeGreaterThan(10);
      expect(groups.has(f.meta.group), f.path).toBe(true);
      const def = getValue(DEFAULT_GAME_CONFIG, f.path);
      if (f.meta.kind === 'number') {
        expect(typeof def, f.path).toBe('number');
        expect(f.meta.min, f.path).toBeLessThan(f.meta.max);
        expect(def as number, f.path).toBeGreaterThanOrEqual(f.meta.min);
        expect(def as number, f.path).toBeLessThanOrEqual(f.meta.max);
      } else expect(typeof def, f.path).toBe('boolean');
    }
  });

  it('withValue copies instead of mutating, tidies numbers and clamps silly input', () => {
    const a = DEFAULT_GAME_CONFIG;
    const b = withValue(a, 'player.jumpHeight', 200.00000001);
    expect(a.player.jumpHeight).toBe(168);
    expect(b.player.jumpHeight).toBe(200);
    expect(b.player).not.toBe(a.player);
    expect(withValue(a, 'player.airJumps', 1.6).player.airJumps).toBe(2);
    expect(withValue(a, 'player.runSpeed', -50).player.runSpeed).toBe(0);
    expect(withValue(a, 'player.runSpeed', Number.NaN).player.runSpeed).toBe(60);
    expect(withValue(a, 'feel.dustParticles', false).feel.dustParticles).toBe(false);
    const meta = FIELDS.find((f) => f.path === 'player.jumpTimeToApex')!.meta as NumberMeta;
    expect(tidyNumber(meta, 0.1 + 0.2)).toBe(0.3);
    expect(diffConfig(a, b)).toEqual(['player.jumpHeight']);
  });

  it('sanitizeConfig survives rubbish and keeps good values', () => {
    expect(configsEqual(sanitizeConfig(null), DEFAULT_GAME_CONFIG)).toBe(true);
    const c = sanitizeConfig({ player: { jumpHeight: 99, runSpeed: 'fast', nonsense: 1 }, feel: { dustParticles: 0 }, camera: 7 });
    expect(c.player.jumpHeight).toBe(99);
    expect(c.player.runSpeed).toBe(DEFAULT_GAME_CONFIG.player.runSpeed);
    expect(c.feel.dustParticles).toBe(true);
    expect('nonsense' in c.player).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe('jump maths', () => {
  const cfg = DEFAULT_GAME_CONFIG.player;

  it('uses the game\'s own gravity / launch speed', () => {
    const s = deriveStats(cfg);
    const phys = derivePhysics(cfg);
    expect(s.gravity).toBe(phys.gravity);
    expect(s.jumpSpeed).toBe(phys.jumpSpeed);
    expect(s.gravity).toBeCloseTo((2 * cfg.jumpHeight) / cfg.jumpTimeToApex ** 2);
  });

  it('a full jump tops out at the configured height', () => {
    for (const c of [cfg, TEST_PLAYER, { ...cfg, jumpHeight: 264, jumpTimeToApex: 0.62, apexHangGravityMult: 0.4 }]) {
      expect(deriveStats(c).fullJumpHeight).toBeGreaterThan(c.jumpHeight - 1.5);
      expect(deriveStats(c).fullJumpHeight).toBeLessThan(c.jumpHeight + 1.5);
    }
  });

  it('agrees with the real player controller on flat ground', () => {
    const FLAT = gridFromAscii([...Array(12).fill('.'.repeat(60)), '#'.repeat(60)]);
    const floorY = 12 * 48;
    for (const hold of [Infinity, TAP_HOLD]) {
      const p = spawn(FLAT, 3, 12);
      let top = p.y, t = 0, landedAt = 0;
      const holdSteps = Math.round(Math.min(hold, 10) / DT);
      let i = 0;
      run(p, FLAT, 0, {});
      // drive by hand so the button can be released part-way
      while (t < 3 && !landedAt) {
        p.step({ moveX: 1, moveY: 0, jumpHeld: i < holdSteps, jumpPressed: i === 0, dashPressed: false, attackPressed: false }, TEST_PLAYER, FLAT, DT);
        t += DT; i++;
        top = Math.min(top, p.y);
        if (i > 2 && p.onGround) landedAt = t;
      }
      const sim = simulateJump(TEST_PLAYER, { hold });
      expect(sim.apexHeight).toBeCloseTo(floorY - top, 0);
      expect(Math.abs(sim.airTime - landedAt)).toBeLessThan(2.5 * DT);
    }
  });

  it('tap < full < double, and the numbers move the right way when settings change', () => {
    const s = deriveStats(cfg);
    expect(s.tapJumpHeight).toBeLessThan(s.fullJumpHeight * 0.6);
    expect(s.doubleJumpHeight).toBeCloseTo(s.fullJumpHeight + cfg.airJumpHeight, 0);
    expect(s.doubleJumpDistance).toBeGreaterThan(s.jumpDistance);
    expect(s.jumpDistance).toBeCloseTo(cfg.runSpeed * s.airTime);
    expect(s.dashDistance).toBeCloseTo(cfg.dashSpeed * cfg.dashTime);
    const higher = deriveStats({ ...cfg, jumpHeight: cfg.jumpHeight + 48 });
    expect(higher.fullJumpHeight).toBeGreaterThan(s.fullJumpHeight + 40);
    const heavier = deriveStats({ ...cfg, fallGravityMult: 3 });
    expect(heavier.airTime).toBeLessThan(s.airTime);
    expect(deriveStats({ ...cfg, airJumps: 0 }).doubleJumpHeight).toBeCloseTo(s.fullJumpHeight);
    expect(deriveStats({ ...cfg, dashEnabled: false }).dashDistance).toBe(0);
  });

  it('arcs start and end on the ground; no double arc without air jumps', () => {
    const arcs = jumpArcs(cfg);
    for (const arc of [arcs.tap, arcs.full, arcs.double!]) {
      expect(arc.points[0].h).toBe(0);
      expect(arc.points[arc.points.length - 1].h).toBe(0);
      expect(arc.points.every((p) => p.h >= 0)).toBe(true);
    }
    expect(arcs.double!.airJumpTimes).toHaveLength(1);
    expect(jumpArcs({ ...cfg, airJumps: 0 }).double).toBeNull();
    // extreme settings never hang
    expect(simulateJump({ ...cfg, jumpTimeToApex: 0, jumpHeight: 0, maxFallSpeed: 0 }, { hold: Infinity }).points.length).toBeLessThan(5000);
  });
});

/* ------------------------------------------------------------------ */
describe('undo history', () => {
  it('steps back and forward and tracks unsaved changes', () => {
    const h = new History('a');
    expect(h.dirty).toBe(false);
    h.set('b'); h.set('c');
    expect(h.dirty).toBe(true);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.dirty).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe('b');
    h.set('d'); // a new edit forgets the redo branch
    expect(h.canRedo).toBe(false);
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
  });

  it('merges a slider drag into one step until sealed', () => {
    const h = new History(0);
    h.set(1, 'jump'); h.set(2, 'jump'); h.set(3, 'jump');
    h.seal();
    h.set(4, 'jump');
    h.set(5, 'run');
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(0);
  });

  it('forgets the oldest steps beyond the limit', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.set(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
describe('presets', () => {
  it('built-ins only touch real settings and keep values inside the slider ranges', () => {
    for (const p of BUILTIN_PRESETS) {
      const c = applyPreset(DEFAULT_GAME_CONFIG, p);
      for (const section of ['player', 'camera', 'feel'] as const) {
        for (const key of Object.keys(p.values[section] ?? {})) expect(FIELDS.some((f) => f.path === `${section}.${key}`), `${p.name}: ${key}`).toBe(true);
      }
      for (const f of FIELDS) {
        const v = getValue(c, f.path);
        if (f.meta.kind === 'number') {
          expect(v as number, `${p.name} ${f.path}`).toBeGreaterThanOrEqual(f.meta.min);
          expect(v as number, `${p.name} ${f.path}`).toBeLessThanOrEqual(f.meta.max);
        }
      }
    }
    expect(configsEqual(applyPreset(withValue(DEFAULT_GAME_CONFIG, 'player.runSpeed', 99), BUILTIN_PRESETS[0]), DEFAULT_GAME_CONFIG)).toBe(true);
  });

  it('partial presets leave other settings alone', () => {
    const base = withValue(DEFAULT_GAME_CONFIG, 'player.width', 40);
    const floaty = applyPreset(base, BUILTIN_PRESETS.find((p) => p.name === 'Floaty')!);
    expect(floaty.player.width).toBe(40);
    expect(floaty.player.jumpTimeToApex).toBeGreaterThan(base.player.jumpTimeToApex);
    expect(base.player.jumpTimeToApex).toBe(0.4);
  });

  it('user presets round-trip through storage and survive broken data', () => {
    const mine = withValue(DEFAULT_GAME_CONFIG, 'player.jumpHeight', 300);
    let list = upsertUserPreset([], makeUserPreset('Sky high', mine));
    list = upsertUserPreset(list, makeUserPreset('Floaty', mine)); // clashes with a built-in
    list = upsertUserPreset(list, makeUserPreset('Sky high', DEFAULT_GAME_CONFIG)); // replace
    expect(list.map((p) => p.name)).toEqual(['Floaty (mine)', 'Sky high']);
    const back = parseUserPresets(serializeUserPresets(list));
    expect(back).toHaveLength(2);
    expect(applyPreset(DEFAULT_GAME_CONFIG, back[0]).player.jumpHeight).toBe(300);
    expect(removeUserPreset(back, 'Sky high')).toHaveLength(1);
    expect(parseUserPresets('not json')).toEqual([]);
    expect(parseUserPresets('{"a":1}')).toEqual([]);
    expect(parseUserPresets(null)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
const rot = (bone: string): K.TrackRef => ({ kind: 'bone', target: bone, channel: 'rotation' });
const baseAnim = (): AnimData => ({
  duration: 1, loop: true,
  bones: { arm: { rotation: [{ t: 0, v: 0 }, { t: 0.5, v: 40, ease: 'linear' }], x: [{ t: 0.25, v: 3 }] } },
  slots: { glow: { alpha: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } },
  events: [{ t: 0.2, name: 'step' }],
});
const tinyRig = (): RigData => ({
  version: 1, name: 'tiny',
  bones: [
    { name: 'root', parent: null, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    { name: 'arm', parent: 'root', x: 0, y: -10, rotation: 90, scaleX: 1, scaleY: 1, length: 10 },
  ],
  slots: [{ name: 'glow', bone: 'arm', image: 'g.png', w: 4, h: 4, imageScale: 1, x: 0, y: 0, rotation: 0, originX: 0.5, originY: 0.5, alpha: 0.5 }],
  animations: { idle: baseAnim(), wave: { duration: 0.4, loop: false, bones: { arm: { rotation: [{ t: 0, v: 90 }, { t: 0.4, v: 90 }] } } } },
  mix: { default: 0.2, pairs: { 'idle>wave': 0.1, 'wave>idle': 0.3 } },
});

describe('keyframe editing', () => {
  it('snaps to 1/60 s frames unless free', () => {
    expect(K.snapTime(0.26)).toBeCloseTo(16 / 60, 4);
    expect(K.snapTime(0.26, true)).toBe(0.26);
    expect(K.snapTime(0.123456, true)).toBe(0.1235);
  });

  it('setKey inserts sorted, replaces at the same time, keeps the old ease, never mutates', () => {
    const a = baseAnim();
    const frozen = JSON.stringify(a);
    let b = K.setKey(a, rot('arm'), 0.25, 10);
    expect(b.bones.arm.rotation!.map((k) => k.t)).toEqual([0, 0.25, 0.5]);
    b = K.setKey(b, rot('arm'), 0.5, -5);
    expect(b.bones.arm.rotation![2]).toEqual({ t: 0.5, v: -5, ease: 'linear' });
    expect(K.setKey(a, rot('arm'), 9, 1).bones.arm.rotation!.at(-1)!.t).toBe(1); // clamped to the end
    const c = K.setKey(a, rot('leg'), 0.1, 7, 'backOut');
    expect(c.bones.leg.rotation).toEqual([{ t: 0.1, v: 7, ease: 'backOut' }]);
    expect(JSON.stringify(a)).toBe(frozen);
    expect(b.bones.arm.x).toBe(a.bones.arm.x); // untouched tracks are shared, not copied
  });

  it('the value the editor shows equals what pose.ts samples', () => {
    const a = baseAnim();
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      expect(K.sampleOffset(a, rot('arm'), t)).toBe(sampleTrack(a.bones.arm.rotation, t, a.duration, a.loop, 0));
    }
    expect(K.sampleOffset(a, rot('nobody'), 0.3)).toBe(0);
    expect(K.sampleOffset(a, { kind: 'bone', target: 'nobody', channel: 'scaleX' }, 0.3)).toBe(1);
    expect(K.sampleOffset({ ...a, slots: undefined }, { kind: 'slot', target: 'glow', channel: 'alpha' }, 0.3, tinyRig())).toBe(0.5);
  });

  it('deleteKeys removes keys, then empty tracks, then empty bones', () => {
    const a = baseAnim();
    let b = K.deleteKeys(a, [{ ...rot('arm'), t: 0 }]);
    expect(b.bones.arm.rotation).toHaveLength(1);
    b = K.deleteKeys(b, [{ ...rot('arm'), t: 0.5 }, { kind: 'bone', target: 'arm', channel: 'x', t: 0.25 }]);
    expect(b.bones.arm).toBeUndefined();
    b = K.deleteKeys(b, [{ kind: 'slot', target: 'glow', channel: 'alpha', t: 0 }, { kind: 'slot', target: 'glow', channel: 'alpha', t: 1 }]);
    expect(b.slots).toBeUndefined();
    expect(K.listTracks(b)).toEqual([]);
  });

  it('moveKeys keeps spacing, stops at the ends and overwrites what it lands on', () => {
    const a = baseAnim();
    const sel: K.KeyRef[] = [{ ...rot('arm'), t: 0 }, { ...rot('arm'), t: 0.5 }];
    const far = K.moveKeys(a, sel, 5);
    expect(far.anim.bones.arm.rotation!.map((k) => k.t)).toEqual([0.5, 1]);
    expect(far.refs.map((r) => r.t).sort()).toEqual([0.5, 1]);
    expect(K.moveKeys(a, sel, -5).anim).toBe(a); // already at the start
    const one = K.moveKeys(a, [{ ...rot('arm'), t: 0 }], 0.5);
    expect(one.anim.bones.arm.rotation).toEqual([{ t: 0.5, v: 0 }]); // replaced the key that was there
    const multi = K.moveKeys(a, [{ ...rot('arm'), t: 0.5 }, { kind: 'bone', target: 'arm', channel: 'x', t: 0.25 }], 0.1);
    expect(multi.anim.bones.arm.rotation![1].t).toBe(0.6);
    expect(multi.anim.bones.arm.x![0].t).toBe(0.35);
    expect(multi.anim.bones.arm.rotation![1].ease).toBe('linear');
  });

  it('setKeyProps edits value and ease of many keys', () => {
    const a = baseAnim();
    const refs: K.KeyRef[] = [{ ...rot('arm'), t: 0 }, { ...rot('arm'), t: 0.5 }];
    const b = K.setKeyProps(a, refs, { ease: 'cubicOut' });
    expect(b.bones.arm.rotation!.map((k) => k.ease)).toEqual(['cubicOut', 'cubicOut']);
    const c = K.setKeyProps(b, refs, { v: 12, ease: null });
    expect(c.bones.arm.rotation).toEqual([{ t: 0, v: 12 }, { t: 0.5, v: 12 }]);
  });

  it('copy / paste, and paste mirrored in time', () => {
    const a = baseAnim();
    const clip = K.copyKeys(a, [{ ...rot('arm'), t: 0 }, { ...rot('arm'), t: 0.5 }, { kind: 'bone', target: 'arm', channel: 'x', t: 0.25 }]);
    expect(clip.span).toBe(0.5);
    const blank: AnimData = { duration: 1, loop: false, bones: {} };
    const p = K.pasteKeys(blank, clip, 0.2);
    expect(p.anim.bones.arm.rotation).toEqual([{ t: 0.2, v: 0 }, { t: 0.7, v: 40, ease: 'linear' }]);
    expect(p.anim.bones.arm.x).toEqual([{ t: 0.45, v: 3 }]);
    expect(p.refs).toHaveLength(3);
    const m = K.pasteKeys(blank, clip, 0, true);
    expect(m.anim.bones.arm.rotation!.map((k) => [k.t, k.v])).toEqual([[0, 40], [0.5, 0]]);
    expect(K.pasteKeys(blank, clip, 0.8).anim.bones.arm.rotation).toHaveLength(1); // the second key would be past the end
  });

  it('pose helpers: key all, copy pose, paste pose', () => {
    const rig = tinyRig();
    const a = rig.animations.idle;
    const all = K.keyAllBones(rig, a, 0.25);
    expect(all.anim.bones.root.rotation).toEqual([{ t: 0.25, v: 0 }]);
    expect(all.anim.bones.arm.rotation!.find((k) => k.t === 0.25)!.v).toBeCloseTo(sampleTrack(a.bones.arm.rotation, 0.25, 1, true, 0), 3);
    // keying the pose that is already there must not change what is drawn
    const before = sampleAnimation(rig, a, 0.25), after = sampleAnimation(rig, all.anim, 0.25);
    expect(after.bones[1].rotation).toBeCloseTo(before.bones[1].rotation, 2);

    const pose = K.copyPoseAt(a, 0.5, rig);
    const pasted = K.pastePoseAt(rig.animations.wave, pose, 0.2, rig);
    expect(pasted.anim.bones.arm.rotation!.find((k) => k.t === 0.2)!.v).toBe(40);
    expect(pasted.anim.bones.arm.x).toEqual([{ t: 0.2, v: sampleTrack(a.bones.arm.x, 0.5, 1, true, 0) }]);
  });

  it('closeLoop copies first keys to the end', () => {
    const a = baseAnim();
    const { anim, count } = K.closeLoop(a);
    expect(count).toBe(2); // arm.rotation and glow.alpha start at 0; arm.x does not
    expect(anim.bones.arm.rotation!.at(-1)).toEqual({ t: 1, v: 0 });
    expect(anim.slots!.glow.alpha!.at(-1)).toEqual({ t: 1, v: 0 });
    expect(K.closeLoop(anim).count).toBe(0);
  });

  it('setDuration trims or stretches', () => {
    const a = baseAnim();
    const trimmed = K.setDuration(a, 0.4, false);
    expect(trimmed.bones.arm.rotation).toHaveLength(1);
    expect(trimmed.slots!.glow.alpha).toHaveLength(1);
    const stretched = K.setDuration(a, 2, true);
    expect(stretched.bones.arm.rotation!.map((k) => k.t)).toEqual([0, 1]);
    expect(stretched.events).toEqual([{ t: 0.4, name: 'step' }]);
    expect(K.setDuration(a, 0.1, false).events).toBeUndefined();
  });

  it('events stay sorted through add / move / rename / delete', () => {
    let { anim, index } = K.addEvent(baseAnim(), 0.1, 'whoosh');
    expect(index).toBe(0);
    ({ anim, index } = K.updateEvent(anim, 0, { t: 0.9 }));
    expect(index).toBe(1);
    ({ anim } = K.updateEvent(anim, 1, { name: 'hit' }));
    expect(anim.events).toEqual([{ t: 0.2, name: 'step' }, { t: 0.9, name: 'hit' }]);
    anim = K.deleteEvent(K.deleteEvent(anim, 0), 0);
    expect(anim.events).toBeUndefined();
  });

  it('animation management protects the names the game needs', () => {
    const rig = tinyRig();
    for (const n of HERO_ANIMS) expect(K.isProtectedAnim(n)).toBe(true);
    expect(() => K.renameAnimation(rig, 'idle', 'rest')).toThrow(/used by the game/);
    expect(() => K.deleteAnimation(rig, 'idle')).toThrow(/used by the game/);
    const renamed = K.renameAnimation(rig, 'wave', 'hello');
    expect(Object.keys(renamed.animations)).toEqual(['idle', 'hello']);
    expect(renamed.mix.pairs).toEqual({ 'idle>hello': 0.1, 'hello>idle': 0.3 });
    expect(K.deleteAnimation(rig, 'wave').mix.pairs).toEqual({});
    expect(K.checkAnimName(rig, 'has space')).toMatch(/letters/);
    expect(K.checkAnimName(rig, 'idle')).toMatch(/already/);
    expect(K.checkAnimName(rig, 'wave', 'wave')).toBeNull();
    expect(K.uniqueAnimName(rig, 'wave')).toBe('wave2');
    const dup = K.withAnimation(rig, 'wave2', K.cloneAnimation(rig.animations.wave));
    expect(dup.animations.wave2).toEqual(rig.animations.wave);
    expect(dup.animations.wave2).not.toBe(rig.animations.wave);
    expect(Object.keys(rig.animations)).toHaveLength(2);
    expect(K.setMixPair(rig, 'idle', 'wave', null).mix.pairs).toEqual({ 'wave>idle': 0.3 });
    expect(K.setMixPair(rig, 'a', 'b', 0.25).mix.pairs!['a>b']).toBe(0.25);
    expect(K.setMixDefault(rig, -1).mix.default).toBe(0);
    expect(K.countKeys(rig.animations.idle)).toBe(5);
    expect(K.keyTimes(rig.animations.idle)).toEqual([0, 0.25, 0.5, 1]);
  });

  it('works on the real hero rig: every edit keeps other animations identical', () => {
    const rig = readJson<RigData>('rigs/hero.rig.json');
    const run0 = rig.animations.run;
    const edited = K.withAnimation(rig, 'run', K.setKey(run0, rot('head'), 0.1, 12));
    expect(edited.animations.idle).toBe(rig.animations.idle);
    expect(rig.animations.run).toBe(run0);
    const bi = rig.bones.findIndex((b) => b.name === 'head');
    const pose = sampleAnimation(edited, edited.animations.run, 0.1);
    expect(pose.bones[bi].rotation).toBeCloseTo(rig.bones[bi].rotation + 12, 5); // offset from the setup pose
  });
});

/* ------------------------------------------------------------------ */
describe('sequence player (same blending as the game\'s RigView)', () => {
  it('cross-fades from the pose on screen with a smooth-step', () => {
    const rig = tinyRig();
    const p = new PosePlayer(rig);
    p.play('wave');                  // first play: no fade
    p.update(0.1);
    expect(p.pose.bones[1].rotation).toBeCloseTo(180);
    const from = sampleAnimation(rig, rig.animations.wave, 0.1);
    p.play('idle');                  // wave>idle = 0.3 s
    p.update(0.15);                  // half-way: smoothstep(0.5) = 0.5
    const target = sampleAnimation(rig, rig.animations.idle, 0.15);
    expect(p.pose.bones[1].rotation).toBeCloseTo(blendPoses(from, target, 0.5).bones[1].rotation, 5);
    expect(p.fadeProgress).toBeCloseTo(0.5);
    p.update(0.2);
    expect(p.pose.bones[1].rotation).toBeCloseTo(sampleAnimation(rig, rig.animations.idle, 0.35).bones[1].rotation, 5);
    p.play('idle');                  // same animation again: no restart
    expect(p.currentTime).toBeCloseTo(0.35);
  });

  it('non-looping animations hold their last frame and report finished', () => {
    const p = new PosePlayer(tinyRig());
    p.play('wave');
    p.update(5);
    expect(p.finished).toBe(true);
    expect(p.pose.bones[1].rotation).toBeCloseTo(180);
  });

  it('SequenceRunner walks the steps and repeats', () => {
    const rig = tinyRig();
    const p = new PosePlayer(rig);
    const seq = new SequenceRunner(p, rig, [{ anim: 'idle', hold: 0.5 }, { anim: 'wave', hold: 0 }], true);
    expect(p.current).toBe('idle');
    seq.update(0.49); expect(seq.index).toBe(0);
    seq.update(0.02); expect(seq.index).toBe(1); expect(p.current).toBe('wave');
    seq.update(0.41); expect(seq.index).toBe(0);
    const once = new SequenceRunner(new PosePlayer(rig), rig, [{ anim: 'wave', hold: 0 }], false);
    once.update(1);
    expect(once.done).toBe(true);
  });
});
