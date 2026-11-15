// HERO ANIMATIONS - authored in code, emitted into content/rigs/hero.rig.json.
//
// All values are OFFSETS from the setup pose. Rotation sign cheat-sheet
// (degrees, + = clockwise on screen, hero faces RIGHT):
//   torso / head (point up)        : + leans forward,  - leans back
//   arms / legs / cape (point down): + swings BACK,    - swings FORWARD
//   scarf / hood tip (point back)  : + lifts up,       - droops down
//   weapon (points up-forward)     : + tips forward/down, - tips back
//   hip x/y: px, +x forward, +y DOWN.
//
// Helpers:
//   a.key(bone, channel, [[t, value, ease?], ...])     raw keys
//   a.pose(t, { bone: { r, x, y, sx, sy } }, ease?)    one pose across many bones
//   a.wave(bone, channel, { amp, phase, cycles, base }) exact sine loop (keys at the extremes)
//   a.chain([bones], { base:[], amp:[], lag, phase, cycles }) follow-through: each link lags the previous
//   a.plant(t, { dx, dy, footF:[dx,dy], footB:[dx,dy] }, ease?) moves the hip and solves both legs with
//                                                      2-bone IK so the feet stay where you put them
const round = (v, p = 1000) => Math.round(v * p) / p;
const CH = { r: 'rotation', x: 'x', y: 'y', sx: 'scaleX', sy: 'scaleY' };
const deg = (r) => (r * 180) / Math.PI;

class Anim {
  constructor(sk, duration, loop) { this.sk = sk; this.duration = duration; this.loop = loop; this.bones = {}; this.slots = {}; this.events = []; }
  key(bone, channel, keys) {
    const ch = CH[channel] ?? channel;
    const track = ((this.bones[bone] ??= {})[ch] ??= []);
    for (const [t, v, ease] of keys) track.push(ease ? { t: round(t), v: round(v), ease } : { t: round(t), v: round(v) });
    track.sort((p, q) => p.t - q.t);
    return this;
  }
  pose(t, bones, ease) {
    for (const [bone, chans] of Object.entries(bones)) for (const [c, v] of Object.entries(chans)) this.key(bone, c, [[t, v, ease]]);
    return this;
  }
  /** Hold a constant offset for the whole animation. */
  hold(bones) { return this.pose(0, bones); }
  wave(bone, channel, { amp = 1, phase = 0, cycles = 1, base = 0 }) {
    const d = this.duration, keys = [];
    for (let k = -2; k < cycles + 2; k++) {
      for (const [frac, sign] of [[0.25, 1], [0.75, -1]]) {
        const t = (d * (frac + phase + k)) / cycles;
        if (t >= -1e-6 && t < d - 1e-6) keys.push([Math.max(0, t), base + sign * amp]);
      }
    }
    return this.key(bone, channel, keys);
  }
  chain(bones, { base = [], amp = [], lag = 0.12, phase = 0, cycles = 1, channel = 'r' }) {
    bones.forEach((b, i) => this.wave(b, channel, { amp: amp[i] ?? 0, base: base[i] ?? 0, phase: phase + lag * i, cycles }));
    return this;
  }
  /** Two-bone IK for one leg. foot = [dx, dy] offset of the ankle from its setup position. */
  legIK(side, hip, foot) {
    const th = this.sk['thigh' + side], sh = this.sk['shin' + side], hp = this.sk.hip;
    const L1 = th.length, L2 = sh.length;
    // hip joint position after hip translation + rotation about the hip bone
    const hr = ((hip.r ?? 0) * Math.PI) / 180;
    const ox = th.x - hp.x, oy = th.y - hp.y;
    const jx = hp.x + (hip.dx ?? 0) + ox * Math.cos(hr) - oy * Math.sin(hr);
    const jy = hp.y + (hip.dy ?? 0) + ox * Math.sin(hr) + oy * Math.cos(hr);
    const tx = th.x + foot[0], ty = foot[1]; // setup ankle is directly under the hip joint at y = 0
    let dx = tx - jx, dy = ty - jy;
    let dist = Math.hypot(dx, dy);
    const max = L1 + L2 - 0.02;
    if (dist > max) { dx *= max / dist; dy *= max / dist; dist = max; }
    const phi = deg(Math.atan2(dy, dx));
    const a = deg(Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)))));
    const b = deg(Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)))));
    return { thigh: phi - a - 90 - (hip.r ?? 0), shin: 180 - b };
  }
  plant(t, { dx = 0, dy = 0, r = 0, footF = [0, 0], footB = [0, 0] }, ease) {
    this.key('hip', 'x', [[t, dx, ease]]).key('hip', 'y', [[t, dy, ease]]);
    if (r || this.bones.hip?.rotation) this.key('hip', 'r', [[t, r, ease]]);
    for (const [side, foot] of [['F', footF], ['B', footB]]) {
      const k = this.legIK(side, { dx, dy, r }, foot);
      this.key('thigh' + side, 'r', [[t, k.thigh, ease]]).key('shin' + side, 'r', [[t, k.shin, ease]]);
    }
    return this;
  }
  slot(name, keys) { this.slots[name] = { alpha: keys.map(([t, v, ease]) => (ease ? { t: round(t), v, ease } : { t: round(t), v })) }; return this; }
  event(t, name) { this.events.push({ t: round(t), name }); return this; }
  build() {
    const out = { duration: this.duration, loop: this.loop, bones: this.bones };
    if (Object.keys(this.slots).length) out.slots = this.slots;
    if (this.events.length) out.events = this.events;
    return out;
  }
}

const CAPE = ['cape1', 'cape2', 'cape3'];
const SCARF = ['scarf1', 'scarf2', 'scarf3'];
const TIP = ['hoodTip1', 'hoodTip2'];
/** Set a whole chain's rotations at time t. */
const links = (bones, vals) => Object.fromEntries(bones.map((b, i) => [b, { r: vals[i] }]));

export function buildAnimations(sk) {
  const A = (duration, loop) => new Anim(sk, duration, loop);
  const anims = {};

  /* ---------------- idle: breathing, cloth sway, blink ---------------- */
  {
    const a = A(2.6, true);
    a.plant(0, { dy: 0 }).plant(1.3, { dy: 1.1 });           // gentle knee bob (feet stay planted)
    a.wave('torso', 'r', { amp: 1.2, phase: 0.05 });
    a.wave('head', 'r', { amp: 1.6, phase: 0.18 });
    a.wave('head', 'x', { amp: 0.5, phase: 0.12 });           // head bone space: x = up the neck
    a.wave('armB', 'r', { amp: 3, phase: 0.22 });
    a.wave('armF', 'r', { amp: 2.5, phase: 0.28, base: -6 });
    a.wave('weapon', 'r', { amp: 3, phase: 0.36, base: 2 });
    a.chain(CAPE, { amp: [1.6, 2.6, 3.6], lag: 0.12, phase: 0.2 });
    a.chain(SCARF, { amp: [3, 5, 7], lag: 0.14, phase: 0.1 });
    a.chain(TIP, { amp: [3, 6], lag: 0.16, phase: 0.25 });
    a.slot('eyes', [[0, 1, 'step'], [1.95, 0, 'step'], [2.07, 1, 'step']]);
    a.slot('eyesClosed', [[0, 0, 'step'], [1.95, 1, 'step'], [2.07, 0, 'step']]);
    a.slot('glow', [[0, 0.5], [0.65, 0.68], [1.3, 0.5], [1.95, 0.68]]);
    anims.idle = a.build();
  }

  /* ---------------- run: 2 steps per loop ---------------- */
  {
    const D = 0.6, a = A(D, true);
    // hip bob: lowest just after each contact, highest mid-air
    const bob = [1.6, 3.2, 0.4, -1.8];
    // ankle path relative to its setup spot, 8 phases (stance: slides back on the ground, swing: arcs forward)
    const path = [[9, 0], [4, 0], [-1.5, 0], [-7, -2.8], [-11.5, -7], [-8, -12], [0.5, -10.5], [8.5, -5.5]];
    for (let i = 0; i <= 8; i++) {
      const t = (D * i) / 8, dy = bob[i % 4];
      const kf = a.legIK('F', { dy }, path[i % 8]), kb = a.legIK('B', { dy }, path[(i + 4) % 8]);
      if (i < 8) a.key('hip', 'y', [[t, dy]]);
      a.key('thighF', 'r', [[t, kf.thigh, 'linear']]).key('shinF', 'r', [[t, kf.shin, 'linear']]);
      a.key('thighB', 'r', [[t, kb.thigh, 'linear']]).key('shinB', 'r', [[t, kb.shin, 'linear']]);
    }
    a.wave('hip', 'x', { amp: 0.6, cycles: 2, phase: 0.1 });
    a.wave('torso', 'r', { amp: 2.2, cycles: 2, phase: 0.05, base: 11 });
    a.wave('head', 'r', { amp: 2.2, cycles: 2, phase: 0.2, base: -8 });
    a.wave('head', 'x', { amp: 0.6, cycles: 2, phase: 0.15 });
    a.wave('armB', 'r', { amp: 44, phase: 0.25, base: -4 });          // opposite to the front leg
    a.wave('armF', 'r', { amp: 9, phase: 0.78, base: -52 });          // lantern held out in front
    a.wave('weapon', 'r', { amp: 7, phase: 0.9, base: 34 });
    a.chain(CAPE, { base: [34, 14, 10], amp: [5, 8, 11], cycles: 2, lag: 0.14, phase: 0.1 });
    a.chain(SCARF, { base: [26, 26, 16], amp: [7, 11, 15], cycles: 2, lag: 0.16, phase: 0.05 });
    a.chain(TIP, { base: [10, 20], amp: [7, 12], cycles: 2, lag: 0.18, phase: 0.15 });
    a.event(0, 'step').event(D / 2, 'step');
    anims.run = a.build();
  }

  /* ---------------- jump: rising pose with flutter ---------------- */
  {
    const a = A(0.5, true);
    a.hold({
      hip: { r: -3 }, torso: { r: 4 }, head: { r: -10 },
      thighF: { r: -64 }, shinF: { r: 88 }, thighB: { r: 20 }, shinB: { r: 24 },
      armB: { r: 38 },
    });
    a.wave('armF', 'r', { amp: 3, base: -72, cycles: 1 });
    a.wave('weapon', 'r', { amp: 4, base: 50, phase: 0.2 });
    a.chain(CAPE, { base: [-6, -7, -6], amp: [2.5, 4, 6], cycles: 2, lag: 0.15 });
    a.chain(SCARF, { base: [-34, -8, 2], amp: [5, 8, 10], cycles: 2, lag: 0.15 });
    a.chain(TIP, { base: [-28, -8], amp: [5, 8], cycles: 2, lag: 0.15 });
    anims.jump = a.build();
  }

  /* ---------------- fall: arms up, cloak lifted ---------------- */
  {
    const a = A(0.5, true);
    a.hold({
      torso: { r: -5 }, head: { r: 9 },
      thighF: { r: -36 }, shinF: { r: 52 }, thighB: { r: 12 }, shinB: { r: 42 },
    });
    a.wave('armB', 'r', { amp: 6, base: 128, cycles: 2 });
    a.wave('armF', 'r', { amp: 5, base: -100, cycles: 2, phase: 0.3 });
    a.wave('weapon', 'r', { amp: 5, base: 78, cycles: 2, phase: 0.4 });
    a.chain(CAPE, { base: [58, 28, 18], amp: [6, 10, 14], cycles: 2, lag: 0.16 });
    a.chain(SCARF, { base: [72, 34, 18], amp: [8, 12, 16], cycles: 2, lag: 0.16, phase: 0.1 });
    a.chain(TIP, { base: [48, 30], amp: [8, 12], cycles: 2, lag: 0.16, phase: 0.2 });
    anims.fall = a.build();
  }

  /* ---------------- land: squash and recover ---------------- */
  {
    const a = A(0.25, false);
    a.plant(0, { dy: 6, footF: [2.5, 0], footB: [-2.5, 0] }, 'quadOut')
      .plant(0.06, { dy: 8.5, footF: [2.5, 0], footB: [-2.5, 0] }, 'backOut')
      .plant(0.25, { dy: 0 });
    a.pose(0, { torso: { r: 10 }, head: { r: 4 }, armB: { r: 70 }, armF: { r: -60 }, weapon: { r: 30 } }, 'quadOut');
    a.pose(0.06, { torso: { r: 17 }, head: { r: 11 }, armB: { r: 38 }, armF: { r: -26 }, weapon: { r: 12 } }, 'backOut');
    a.pose(0.25, { torso: { r: 0 }, head: { r: 0 }, armB: { r: 0 }, armF: { r: 0 }, weapon: { r: 0 } });
    // cloth: still up from the fall, slams down past rest, settles (each link later than the last)
    a.key('cape1', 'r', [[0, 46, 'quadIn'], [0.09, -9, 'quadOut'], [0.17, 3], [0.25, 0]]);
    a.key('cape2', 'r', [[0, 26, 'quadIn'], [0.11, -9, 'quadOut'], [0.19, 3], [0.25, 0]]);
    a.key('cape3', 'r', [[0, 16, 'quadIn'], [0.13, -8, 'quadOut'], [0.21, 3], [0.25, 0]]);
    a.key('scarf1', 'r', [[0, 60, 'quadIn'], [0.1, -22, 'quadOut'], [0.19, 6], [0.25, 0]]);
    a.key('scarf2', 'r', [[0, 30, 'quadIn'], [0.12, -18, 'quadOut'], [0.21, 6], [0.25, 0]]);
    a.key('scarf3', 'r', [[0, 16, 'quadIn'], [0.14, -14, 'quadOut'], [0.22, 5], [0.25, 0]]);
    a.key('hoodTip1', 'r', [[0, 40, 'quadIn'], [0.1, -26, 'quadOut'], [0.2, 6], [0.25, 0]]);
    a.key('hoodTip2', 'r', [[0, 26, 'quadIn'], [0.12, -22, 'quadOut'], [0.22, 6], [0.25, 0]]);
    a.event(0, 'land');
    anims.land = a.build();
  }

  /* ---------------- doubleJump: forward flip ---------------- */
  {
    const a = A(0.42, false);
    a.key('hip', 'r', [[0, 0, 'quadIn'], [0.07, 40, 'linear'], [0.28, 310, 'quadOut'], [0.38, 360]]);
    a.key('hip', 'y', [[0, 0, 'quadOut'], [0.14, -5], [0.38, 0]]);
    const tuck = { torso: { r: 22 }, head: { r: 20 }, thighF: { r: -96 }, shinF: { r: 118 }, thighB: { r: -74 }, shinB: { r: 112 }, armB: { r: -50 }, armF: { r: -72 }, weapon: { r: 20 } };
    const open = { torso: { r: -4 }, head: { r: 6 }, thighF: { r: -30 }, shinF: { r: 46 }, thighB: { r: 12 }, shinB: { r: 38 }, armB: { r: 110 }, armF: { r: -110 }, weapon: { r: 60 } };
    a.pose(0, { torso: { r: 8 }, head: { r: 4 }, thighF: { r: -50 }, shinF: { r: 70 }, thighB: { r: -10 }, shinB: { r: 40 }, armB: { r: 20 }, armF: { r: -60 }, weapon: { r: 30 } }, 'quadOut');
    a.pose(0.08, tuck).pose(0.27, tuck, 'quadInOut').pose(0.42, open);
    // cloth drags behind the spin, then overshoots
    a.key('cape1', 'r', [[0, 0, 'quadOut'], [0.1, -46], [0.27, -40, 'quadInOut'], [0.37, 40], [0.42, 52]]);
    a.key('cape2', 'r', [[0, 0, 'quadOut'], [0.12, -34], [0.29, -30, 'quadInOut'], [0.39, 24], [0.42, 28]]);
    a.key('cape3', 'r', [[0, 0, 'quadOut'], [0.14, -30], [0.31, -26, 'quadInOut'], [0.42, 18]]);
    a.key('scarf1', 'r', [[0, 0, 'quadOut'], [0.1, -70], [0.28, -60, 'quadInOut'], [0.42, 66]]);
    a.key('scarf2', 'r', [[0, 0, 'quadOut'], [0.12, -30], [0.3, -30, 'quadInOut'], [0.42, 30]]);
    a.key('scarf3', 'r', [[0, 0, 'quadOut'], [0.14, -25], [0.32, -25, 'quadInOut'], [0.42, 16]]);
    a.key('hoodTip1', 'r', [[0, 0, 'quadOut'], [0.1, -50], [0.28, -40, 'quadInOut'], [0.42, 44]]);
    a.key('hoodTip2', 'r', [[0, 0, 'quadOut'], [0.12, -40], [0.3, -30, 'quadInOut'], [0.42, 28]]);
    a.slot('glow', [[0, 0.55, 'quadOut'], [0.1, 1], [0.42, 0.55]]);
    a.event(0, 'flip');
    anims.doubleJump = a.build();
  }

  /* ---------------- wallSlide: the WALL IS BEHIND the hero (rig's left) ---------------- */
  {
    const a = A(0.8, true);
    const footB = [-6.5, -11], hip = { dx: -1, dy: 0 };
    const kb = a.legIK('B', hip, footB);
    a.hold({
      hip: { x: -1 }, torso: { r: -5 }, head: { r: 16 },
      thighB: { r: kb.thigh }, shinB: { r: kb.shin },
      thighF: { r: -14 }, shinF: { r: 30 },
      weapon: { r: 24 },
    });
    a.wave('hip', 'y', { amp: 0.6, cycles: 2 });
    a.wave('armB', 'r', { amp: 3, base: 92, cycles: 2, phase: 0.2 });   // hand up on the wall
    a.wave('armF', 'r', { amp: 4, base: -30, phase: 0.1 });
    a.chain(CAPE, { base: [66, 80, 24], amp: [2, 4, 7], cycles: 2, lag: 0.16 });
    a.chain(SCARF, { base: [96, 40, 20], amp: [6, 10, 14], cycles: 2, lag: 0.16, phase: 0.1 });
    a.chain(TIP, { base: [44, 26], amp: [6, 10], cycles: 2, lag: 0.16, phase: 0.2 });
    anims.wallSlide = a.build();
  }

  /* ---------------- dash: stretched forward streak ---------------- */
  {
    const a = A(0.24, true);
    a.hold({
      hip: { r: 48, y: 5, x: 1 }, torso: { r: 12 }, head: { r: -44 },
      thighF: { r: 26 }, shinF: { r: 12 }, thighB: { r: -8 }, shinB: { r: 58 },
      armF: { r: -134 }, weapon: { r: 112 }, armB: { r: 20 },
    });
    a.chain(CAPE, { base: [26, 2, -2], amp: [2, 4, 6], cycles: 2, lag: 0.18 });
    a.chain(SCARF, { base: [-24, 30, 20], amp: [3, 6, 9], cycles: 2, lag: 0.18, phase: 0.1 });
    a.chain(TIP, { base: [6, 36], amp: [3, 6], cycles: 2, lag: 0.18, phase: 0.2 });
    a.slot('glow', [[0, 0.9]]);
    anims.dash = a.build();
  }

  /* ---------------- attack: wind-up -> slash (hit @0.10) -> recover ---------------- */
  {
    const a = A(0.3, false);
    a.plant(0, { dx: -1.5, dy: 1, footF: [1, 0] }, 'quadOut')
      .plant(0.05, { dx: -2.5, dy: 1.5, footF: [1, 0] }, 'cubicIn')
      .plant(0.11, { dx: 4, dy: 2.8, footF: [5, 0] }, 'quadOut')
      .plant(0.17, { dx: 4.5, dy: 2.4, footF: [5, 0] }, 'sineInOut')
      .plant(0.3, { dx: 0, dy: 0 });
    // rising slash: arm cocked low behind -> sweeps under and up in front (never crosses the face)
    a.key('armF', 'r', [[0, 58, 'quadOut'], [0.05, 74, 'cubicIn'], [0.11, -112, 'quadOut'], [0.17, -128, 'sineInOut'], [0.3, 0]]);
    a.key('weapon', 'r', [[0, 128, 'quadOut'], [0.05, 136, 'cubicIn'], [0.11, 112, 'quadOut'], [0.17, 104, 'sineInOut'], [0.3, 0]]);
    a.key('torso', 'r', [[0, 10, 'quadOut'], [0.05, 14, 'cubicIn'], [0.11, 4, 'quadOut'], [0.17, -6, 'sineInOut'], [0.3, 0]]);
    a.key('head', 'r', [[0, -6, 'quadOut'], [0.05, -8, 'cubicIn'], [0.11, -4, 'quadOut'], [0.17, 2, 'sineInOut'], [0.3, 0]]);
    a.key('armB', 'r', [[0, -34, 'quadOut'], [0.05, -40, 'cubicIn'], [0.11, 56, 'quadOut'], [0.17, 62, 'sineInOut'], [0.3, 0]]);
    a.key('cape1', 'r', [[0, -10], [0.05, -14, 'cubicIn'], [0.12, 26, 'quadOut'], [0.2, -10], [0.3, 0]]);
    a.key('cape2', 'r', [[0, -6], [0.06, -10, 'cubicIn'], [0.14, 18, 'quadOut'], [0.22, -9], [0.3, 0]]);
    a.key('cape3', 'r', [[0, -3], [0.07, -8, 'cubicIn'], [0.16, 14, 'quadOut'], [0.24, -8], [0.3, 0]]);
    a.key('scarf1', 'r', [[0, -14], [0.05, -20, 'cubicIn'], [0.12, 34, 'quadOut'], [0.21, -14], [0.3, 0]]);
    a.key('scarf2', 'r', [[0, -8], [0.06, -14, 'cubicIn'], [0.14, 26, 'quadOut'], [0.23, -14], [0.3, 0]]);
    a.key('scarf3', 'r', [[0, -4], [0.07, -10, 'cubicIn'], [0.16, 18, 'quadOut'], [0.25, -10], [0.3, 0]]);
    a.key('hoodTip1', 'r', [[0, -12], [0.05, -18, 'cubicIn'], [0.12, 26, 'quadOut'], [0.21, -12], [0.3, 0]]);
    a.key('hoodTip2', 'r', [[0, -8], [0.06, -14, 'cubicIn'], [0.14, 24, 'quadOut'], [0.23, -12], [0.3, 0]]);
    // the slash arc: pops in just before contact, sweeps and grows while fading
    a.slot('slash', [[0, 0, 'step'], [0.075, 1, 'quadIn'], [0.21, 0]]);
    a.key('fx', 'r', [[0, 34, 'step'], [0.075, 34, 'cubicOut'], [0.21, -16]]);
    a.key('fx', 'sx', [[0, 0.8, 'step'], [0.075, 0.8, 'cubicOut'], [0.21, 1.15]]);
    a.key('fx', 'sy', [[0, 0.8, 'step'], [0.075, 0.8, 'cubicOut'], [0.21, 1.15]]);
    a.slot('glow', [[0, 0.7], [0.1, 1], [0.3, 0.55]]);
    a.event(0.1, 'hit');
    anims.attack = a.build();
  }

  /* ---------------- turn: quick skid (played AFTER the facing has flipped) ---------------- */
  {
    const a = A(0.12, false);
    a.plant(0, { dx: -3, dy: 2.5, footF: [6, 0], footB: [-1, 0] }, 'quadOut').plant(0.12, { dx: 0, dy: 0 });
    a.pose(0, { torso: { r: -17 }, head: { r: 6 }, armB: { r: 48 }, armF: { r: -44 }, weapon: { r: 26 } }, 'quadOut');
    a.pose(0.12, { torso: { r: 0 }, head: { r: 0 }, armB: { r: 0 }, armF: { r: 0 }, weapon: { r: 0 } });
    // cloth keeps travelling the old way = flung towards the new front, then swings back
    a.pose(0, { ...links(CAPE, [-40, -24, -16]), ...links(SCARF, [-56, -30, -20]), ...links(TIP, [-34, -24]) }, 'quadOut');
    a.pose(0.12, { ...links(CAPE, [0, 0, 0]), ...links(SCARF, [0, 0, 0]), ...links(TIP, [0, 0]) });
    anims.turn = a.build();
  }

  return anims;
}

/** Cross-fade times. "from>to" pairs override the default. */
const NAMES = ['idle', 'run', 'jump', 'fall', 'land', 'doubleJump', 'wallSlide', 'dash', 'attack', 'turn'];
const fastInto = { attack: 0.03, dash: 0.04, turn: 0.03, jump: 0.06, land: 0.04, doubleJump: 0.05, wallSlide: 0.08 };
const pairs = {};
for (const from of NAMES) for (const [to, v] of Object.entries(fastInto)) if (from !== to) pairs[`${from}>${to}`] = v;
Object.assign(pairs, { 'land>idle': 0.12, 'land>run': 0.08, 'turn>run': 0.08, 'attack>idle': 0.12, 'attack>run': 0.1, 'dash>run': 0.08, 'dash>fall': 0.1, 'jump>fall': 0.16, 'doubleJump>fall': 0.12, 'idle>run': 0.08, 'run>idle': 0.12 });
export const MIX = { default: 0.1, pairs };
