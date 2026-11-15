/**
 * GAME-FEEL SETTINGS TABLE  (pure data + tiny helpers, no DOM)
 * -----------------------------------------------------------
 * One entry for EVERY field of GameConfig (src/shared/types.ts). The Game Feel
 * tab builds its sliders straight from this table, so adding a new tunable
 * number to the game means: add it to the type, then add one line here.
 * (TypeScript refuses to compile if a field is missing from the table.)
 *
 *   label - short name on the slider
 *   help  - one plain sentence a child can understand
 *   unit  - shown after the number
 *   min / max / step - the slider's range. Typing a number allows going past
 *                      max (up to hardMax) for experiments.
 */
import type { CameraConfig, FeelConfig, GameConfig, PlayerConfig } from '../../../shared/types';

export type Section = 'player' | 'camera' | 'feel';
export type ConfigValue = number | boolean;

export const GROUPS = [
  { id: 'movement', title: 'Movement', icon: '🏃', blurb: 'Running left and right.' },
  { id: 'jump', title: 'Jump', icon: '⬆️', blurb: 'How high, how fast, how forgiving.' },
  { id: 'doubleJump', title: 'Double Jump', icon: '⏫', blurb: 'Extra jumps in mid-air.' },
  { id: 'wall', title: 'Wall', icon: '🧱', blurb: 'Sliding down walls and jumping off them.' },
  { id: 'dash', title: 'Dash', icon: '💨', blurb: 'A quick burst of speed.' },
  { id: 'attack', title: 'Attack', icon: '⚔️', blurb: 'Swinging the weapon.' },
  { id: 'camera', title: 'Camera', icon: '🎥', blurb: 'How the view follows the hero.' },
  { id: 'feel', title: 'Feel', icon: '✨', blurb: 'Juice: squash, dust and sparkle.' },
  { id: 'body', title: 'Body Size', icon: '📏', blurb: 'The invisible box that bumps into walls.' },
] as const;
export type GroupId = (typeof GROUPS)[number]['id'];

interface MetaBase { label: string; help: string; group: GroupId }
export interface NumberMeta extends MetaBase {
  kind: 'number';
  unit: string;
  min: number; max: number; step: number;
  /** Whole numbers only (e.g. number of air jumps). */
  integer?: boolean;
  /** Typed values may go this far beyond the slider (default: 4 x max). */
  hardMax?: number;
}
export interface BoolMeta extends MetaBase { kind: 'boolean' }
export type FieldMeta = NumberMeta | BoolMeta;

const num = (group: GroupId, label: string, unit: string, min: number, max: number, step: number, help: string, extra: Partial<NumberMeta> = {}): NumberMeta =>
  ({ kind: 'number', group, label, unit, min, max, step, help, ...extra });
const bool = (group: GroupId, label: string, help: string): BoolMeta => ({ kind: 'boolean', group, label, help });

const PLAYER_META: Record<keyof PlayerConfig, FieldMeta> = {
  width: num('body', 'Body width', 'px', 12, 60, 1, 'How wide the hero\'s bump-box is. Thinner fits through tighter gaps.'),
  height: num('body', 'Body height', 'px', 24, 120, 1, 'How tall the hero\'s bump-box is. A tile is 48 px tall.'),

  runSpeed: num('movement', 'Run speed', 'px/s', 60, 700, 5, 'Top running speed. Bigger = faster hero.'),
  groundAccel: num('movement', 'Speed-up on ground', 'px/s²', 200, 8000, 50, 'How quickly the hero gets up to full speed. Low feels like ice, high feels snappy.'),
  groundDecel: num('movement', 'Slow-down on ground', 'px/s²', 200, 8000, 50, 'How quickly the hero stops when you let go. Low = slippery slide.'),
  airAccel: num('movement', 'Speed-up in air', 'px/s²', 0, 8000, 50, 'How much you can steer while in the air.'),
  airDecel: num('movement', 'Slow-down in air', 'px/s²', 0, 8000, 50, 'How quickly the hero stops moving sideways in the air when you let go.'),
  turnBoost: num('movement', 'Turn-around boost', '×', 1, 4, 0.05, 'Extra push when you suddenly change direction. Bigger = quicker U-turns.'),

  jumpHeight: num('jump', 'Jump height', 'px', 24, 400, 2, 'How high a full jump goes when you hold the button. One tile is 48 px.'),
  jumpTimeToApex: num('jump', 'Time to the top', 's', 0.12, 1, 0.01, 'How long the hero takes to reach the top. Short = zippy, long = floaty.'),
  fallGravityMult: num('jump', 'Fall heaviness', '×', 1, 4, 0.05, 'Falling is this many times heavier than rising. Bigger = drops like a rock.'),
  jumpCutMult: num('jump', 'Tap-jump keep', '×', 0, 1, 0.01, 'When you let go early, the hero keeps this much upward speed. Small = tiny hop on a quick tap.'),
  apexHangThreshold: num('jump', 'Hang-time zone', 'px/s', 0, 300, 5, 'Near the top (moving slower than this), gravity goes soft while the button is held.'),
  apexHangGravityMult: num('jump', 'Hang-time softness', '×', 0.1, 1, 0.01, 'How soft gravity is at the top. Smaller = more floating at the peak. 1 = off.'),
  maxFallSpeed: num('jump', 'Top falling speed', 'px/s', 200, 2400, 10, 'The hero never falls faster than this.'),
  coyoteTime: num('jump', 'Coyote time', 's', 0, 0.4, 0.01, 'You can still jump this long after running off a ledge (like a cartoon coyote!).'),
  jumpBuffer: num('jump', 'Early-press memory', 's', 0, 0.4, 0.01, 'Press jump a bit before landing and the game remembers it for this long.'),

  airJumps: num('doubleJump', 'Air jumps', '', 0, 5, 1, 'Extra jumps in mid-air. 0 = none, 1 = double jump, 2 = triple jump...', { integer: true, hardMax: 20 }),
  airJumpHeight: num('doubleJump', 'Air-jump height', 'px', 0, 400, 2, 'How high each mid-air jump goes.'),

  wallSlideEnabled: bool('wall', 'Wall slide', 'Push against a wall while falling to slide down slowly.'),
  wallSlideSpeed: num('wall', 'Slide speed', 'px/s', 20, 600, 5, 'How fast the hero slides down a wall.'),
  wallJumpEnabled: bool('wall', 'Wall jump', 'Jump off walls.'),
  wallJumpSpeedX: num('wall', 'Kick-off speed', 'px/s', 0, 900, 5, 'How hard the hero pushes away from the wall.'),
  wallJumpHeight: num('wall', 'Wall-jump height', 'px', 0, 400, 2, 'How high a wall jump goes.'),
  wallJumpLockTime: num('wall', 'Steering lock', 's', 0, 0.6, 0.01, 'For this long after a wall jump you cannot steer straight back into the wall.'),

  dashEnabled: bool('dash', 'Dash', 'Turn the dash move on or off.'),
  dashSpeed: num('dash', 'Dash speed', 'px/s', 200, 2000, 10, 'How fast the dash moves.'),
  dashTime: num('dash', 'Dash length', 's', 0.04, 0.6, 0.01, 'How long one dash lasts.'),
  dashCooldown: num('dash', 'Dash rest', 's', 0, 2, 0.01, 'Wait this long before dashing again.'),
  airDashes: num('dash', 'Air dashes', '', 0, 5, 1, 'How many dashes you get before touching the ground again.', { integer: true, hardMax: 20 }),

  attackEnabled: bool('attack', 'Attack', 'Turn the weapon swing on or off.'),
  attackTime: num('attack', 'Swing time', 's', 0.08, 1, 0.01, 'How long one swing takes.'),
  attackCooldown: num('attack', 'Swing rest', 's', 0, 1, 0.01, 'Wait this long after a swing before the next one.'),
};

const CAMERA_META: Record<keyof CameraConfig, FieldMeta> = {
  lerpX: num('camera', 'Follow speed (sideways)', '', 0.01, 1, 0.01, 'How quickly the camera catches up sideways. 1 = glued to the hero, small = lazy and smooth.'),
  lerpY: num('camera', 'Follow speed (up/down)', '', 0.01, 1, 0.01, 'How quickly the camera catches up when the hero jumps or falls.'),
  lookAhead: num('camera', 'Look ahead', 'px', 0, 300, 5, 'The camera peeks this far in front of the hero so you can see where you are going.'),
  lookAheadLerp: num('camera', 'Look-ahead speed', '', 0.005, 0.5, 0.005, 'How quickly the camera swings round when the hero turns.'),
  deadzoneW: num('camera', 'Still zone width', 'px', 0, 400, 5, 'The hero can move this far sideways before the camera starts to follow.'),
  deadzoneH: num('camera', 'Still zone height', 'px', 0, 400, 5, 'The hero can move this far up or down before the camera follows. Stops little hops shaking the view.'),
  zoom: num('camera', 'Zoom', '×', 0.5, 2.5, 0.05, 'Bigger = closer to the hero. 1 is normal.'),
  landShake: num('camera', 'Landing shake', 'px', 0, 30, 0.5, 'How much the screen shakes after a big fall. 0 = no shake.'),
};

const FEEL_META: Record<keyof FeelConfig, FieldMeta> = {
  squashStretch: num('feel', 'Squash & stretch', '', 0, 1.5, 0.05, 'How bouncy and rubbery the hero looks when jumping and landing. 0 = stiff.', { hardMax: 1.5 }),
  dustParticles: bool('feel', 'Dust puffs', 'Little clouds when running, jumping and landing.'),
  afterImages: bool('feel', 'Dash trail', 'Ghostly copies of the hero behind a dash.'),
  hitPauseMs: num('feel', 'Hit pause', 'ms', 0, 250, 5, 'The game freezes for a blink when something big happens. Makes hits feel powerful.'),
};

/** A field's address inside GameConfig, e.g. "player.jumpHeight". */
export type FieldPath = string;
export interface FieldDef { path: FieldPath; section: Section; key: string; meta: FieldMeta }

/** Every field in display order. */
export const FIELDS: FieldDef[] = [
  ...Object.entries(PLAYER_META).map(([key, meta]) => ({ path: `player.${key}`, section: 'player' as const, key, meta })),
  ...Object.entries(CAMERA_META).map(([key, meta]) => ({ path: `camera.${key}`, section: 'camera' as const, key, meta })),
  ...Object.entries(FEEL_META).map(([key, meta]) => ({ path: `feel.${key}`, section: 'feel' as const, key, meta })),
];
export const FIELD_BY_PATH = new Map(FIELDS.map((f) => [f.path, f]));

/**
 * Factory defaults. These mirror DEFAULT_CONFIG in src/game/core/content.ts
 * (the numbers the game uses when game-config.json is missing).
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 1,
  player: {
    width: 30, height: 66,
    runSpeed: 330, groundAccel: 3200, groundDecel: 3800, airAccel: 2400, airDecel: 1500, turnBoost: 1.8,
    jumpHeight: 168, jumpTimeToApex: 0.4, fallGravityMult: 1.55, jumpCutMult: 0.45,
    apexHangThreshold: 70, apexHangGravityMult: 0.55, maxFallSpeed: 980, coyoteTime: 0.1, jumpBuffer: 0.12,
    airJumps: 1, airJumpHeight: 120,
    wallSlideEnabled: true, wallSlideSpeed: 130, wallJumpEnabled: true, wallJumpSpeedX: 340,
    wallJumpHeight: 140, wallJumpLockTime: 0.17,
    dashEnabled: true, dashSpeed: 820, dashTime: 0.17, dashCooldown: 0.28, airDashes: 1,
    attackEnabled: true, attackTime: 0.32, attackCooldown: 0.08,
  },
  camera: { lerpX: 0.12, lerpY: 0.1, lookAhead: 90, lookAheadLerp: 0.04, deadzoneW: 40, deadzoneH: 90, zoom: 1, landShake: 5 },
  feel: { squashStretch: 0.6, dustParticles: true, afterImages: true, hitPauseMs: 60 },
};

export function cloneConfig(c: GameConfig): GameConfig {
  return { version: 1, player: { ...c.player }, camera: { ...c.camera }, feel: { ...c.feel } };
}

export function getValue(c: GameConfig, path: FieldPath): ConfigValue {
  const f = FIELD_BY_PATH.get(path);
  if (!f) throw new Error(`Unknown setting ${path}`);
  return (c[f.section] as unknown as Record<string, ConfigValue>)[f.key];
}

/** Round to the slider step so we never store 0.30000000000000004. */
export function tidyNumber(meta: NumberMeta, v: number): number {
  if (!Number.isFinite(v)) return meta.min;
  const hardMax = meta.hardMax ?? meta.max * 4;
  let out = Math.min(Math.max(v, Math.min(meta.min, 0)), hardMax);
  if (meta.integer) return Math.round(out);
  const decimals = Math.max(0, Math.ceil(-Math.log10(meta.step)) + 1);
  out = Number(out.toFixed(Math.min(decimals, 6)));
  return out;
}

/** Returns a NEW config with one value changed (the input is never modified). */
export function withValue(c: GameConfig, path: FieldPath, value: ConfigValue): GameConfig {
  const f = FIELD_BY_PATH.get(path);
  if (!f) throw new Error(`Unknown setting ${path}`);
  const next = cloneConfig(c);
  const v = f.meta.kind === 'number' ? tidyNumber(f.meta, Number(value)) : Boolean(value);
  (next[f.section] as unknown as Record<string, ConfigValue>)[f.key] = v;
  return next;
}

/**
 * Make any JSON safe to use as a GameConfig: unknown keys are dropped, missing
 * or wrong-typed values fall back to `base`. (Same idea as mergeConfig in the game.)
 */
export function sanitizeConfig(raw: unknown, base: GameConfig = DEFAULT_GAME_CONFIG): GameConfig {
  const out = cloneConfig(base);
  if (!raw || typeof raw !== 'object') return out;
  for (const f of FIELDS) {
    const src = (raw as Record<string, unknown>)[f.section];
    if (!src || typeof src !== 'object') continue;
    const v = (src as Record<string, unknown>)[f.key];
    const dst = out[f.section] as unknown as Record<string, ConfigValue>;
    if (f.meta.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) dst[f.key] = v;
    else if (f.meta.kind === 'boolean' && typeof v === 'boolean') dst[f.key] = v;
  }
  return out;
}

/** Paths whose values differ between two configs. */
export function diffConfig(a: GameConfig, b: GameConfig): FieldPath[] {
  return FIELDS.filter((f) => getValue(a, f.path) !== getValue(b, f.path)).map((f) => f.path);
}

export const configsEqual = (a: GameConfig, b: GameConfig): boolean => diffConfig(a, b).length === 0;

/** "168 px", "0.4 s", "On" - for tooltips and read-outs. */
export function formatValue(meta: FieldMeta, v: ConfigValue): string {
  if (meta.kind === 'boolean') return v ? 'On' : 'Off';
  return `${v}${meta.unit ? (meta.unit === '×' ? '×' : ' ' + meta.unit) : ''}`;
}
