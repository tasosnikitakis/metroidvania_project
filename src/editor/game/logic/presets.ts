/**
 * FEEL PRESETS  (pure logic, no DOM)
 * ----------------------------------
 * A preset is a named bundle of settings. Built-in presets only list the
 * numbers that make them special; everything else is left as it is.
 * "My presets" are full snapshots kept in the browser (localStorage), so they
 * belong to this computer, not to the game files.
 */
import type { GameConfig } from '../../../shared/types';
import { DEFAULT_GAME_CONFIG, cloneConfig, sanitizeConfig } from './configMeta';

export type PartialConfig = { [S in 'player' | 'camera' | 'feel']?: Partial<GameConfig[S]> };

export interface Preset {
  name: string;
  description: string;
  builtIn: boolean;
  values: PartialConfig;
}

export const BUILTIN_PRESETS: Preset[] = [
  {
    name: 'Factory settings', builtIn: true,
    description: 'The numbers the game shipped with.',
    values: { player: { ...DEFAULT_GAME_CONFIG.player }, camera: { ...DEFAULT_GAME_CONFIG.camera }, feel: { ...DEFAULT_GAME_CONFIG.feel } },
  },
  {
    name: 'Floaty', builtIn: true,
    description: 'Big slow moon jumps with lots of hang time.',
    values: {
      player: {
        runSpeed: 280, groundAccel: 2200, groundDecel: 2400, airAccel: 1800, airDecel: 800,
        jumpHeight: 216, jumpTimeToApex: 0.62, fallGravityMult: 1.15, jumpCutMult: 0.6,
        apexHangThreshold: 110, apexHangGravityMult: 0.4, maxFallSpeed: 640,
        airJumpHeight: 150, wallSlideSpeed: 80,
      },
      camera: { lerpY: 0.07 },
      feel: { squashStretch: 0.9 },
    },
  },
  {
    name: 'Tight & Snappy', builtIn: true,
    description: 'Instant starts and stops, quick sharp jumps.',
    values: {
      player: {
        runSpeed: 360, groundAccel: 6000, groundDecel: 7000, airAccel: 4200, airDecel: 3200, turnBoost: 2.4,
        jumpHeight: 156, jumpTimeToApex: 0.3, fallGravityMult: 1.8, jumpCutMult: 0.3,
        apexHangThreshold: 40, apexHangGravityMult: 0.75, maxFallSpeed: 1150,
        airJumpHeight: 110, dashSpeed: 950, dashTime: 0.14, dashCooldown: 0.2,
      },
      camera: { lerpX: 0.18, lerpY: 0.16 },
      feel: { squashStretch: 0.45 },
    },
  },
  {
    name: 'Heavy Knight', builtIn: true,
    description: 'A big armoured hero: slow to start, lands with a thud.',
    values: {
      player: {
        runSpeed: 250, groundAccel: 1500, groundDecel: 1900, airAccel: 1100, airDecel: 700, turnBoost: 1.2,
        jumpHeight: 120, jumpTimeToApex: 0.36, fallGravityMult: 2.3, jumpCutMult: 0.55,
        apexHangThreshold: 30, apexHangGravityMult: 0.85, maxFallSpeed: 1400,
        airJumps: 0, wallSlideSpeed: 260, dashSpeed: 640, dashTime: 0.22, dashCooldown: 0.6,
        attackTime: 0.42, attackCooldown: 0.18,
      },
      camera: { landShake: 14 },
      feel: { squashStretch: 0.35, hitPauseMs: 110 },
    },
  },
  {
    name: 'Bouncy Bunny', builtIn: true,
    description: 'Super high hops and a triple jump. Silly and fun!',
    values: {
      player: {
        runSpeed: 380, jumpHeight: 264, jumpTimeToApex: 0.42, fallGravityMult: 1.4,
        airJumps: 2, airJumpHeight: 192, maxFallSpeed: 900,
      },
      feel: { squashStretch: 1.3 },
    },
  },
];

/** Returns a NEW config: `base` with the preset's values written over the top. */
export function applyPreset(base: GameConfig, preset: Preset): GameConfig {
  const merged = cloneConfig(base);
  Object.assign(merged.player, preset.values.player ?? {});
  Object.assign(merged.camera, preset.values.camera ?? {});
  Object.assign(merged.feel, preset.values.feel ?? {});
  return sanitizeConfig(merged, base); // drops anything of the wrong type
}

export function makeUserPreset(name: string, config: GameConfig): Preset {
  const c = cloneConfig(config);
  return { name: name.trim() || 'My preset', description: 'Saved on this computer.', builtIn: false, values: { player: c.player, camera: c.camera, feel: c.feel } };
}

/** Add or replace (by name) a user preset. Built-in names cannot be taken. */
export function upsertUserPreset(list: Preset[], preset: Preset): Preset[] {
  let name = preset.name;
  if (BUILTIN_PRESETS.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name} (mine)`;
  const next = list.filter((p) => p.name !== name);
  next.push({ ...preset, name, builtIn: false });
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

export const removeUserPreset = (list: Preset[], name: string): Preset[] => list.filter((p) => p.name !== name);

export const USER_PRESETS_KEY = 'gameEditor.feelPresets.v1';

export function serializeUserPresets(list: Preset[]): string {
  return JSON.stringify(list.map((p) => ({ name: p.name, values: p.values })));
}

/** Read presets back from storage; anything broken is skipped rather than crashing. */
export function parseUserPresets(text: string | null): Preset[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const out: Preset[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || typeof (item as Preset).name !== 'string') continue;
      const clean = sanitizeConfig((item as Preset).values);
      out.push(makeUserPreset((item as Preset).name, clean));
    }
    return out;
  } catch {
    return [];
  }
}
