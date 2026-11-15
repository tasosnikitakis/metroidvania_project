/**
 * Runtime-wide constants. Tunable *gameplay* numbers live in
 * content/game-config.json (GameConfig) - only engine plumbing lives here.
 */

/** Physics / game-logic steps per second. Rendering interpolates between steps. */
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

/** Never use more device pixels per CSS pixel than this (protects weak phones). */
export const MAX_DEVICE_PIXEL_RATIO = 3;

/** On tall/narrow screens we zoom out so at least this many logical px are visible across. */
export const MIN_VIEW_WIDTH = 960;

/**
 * Draw order. Bigger = closer to the viewer.
 * Level designers: decor 'far' sits behind the back tiles, 'back' between the
 * back tiles and the gameplay tiles, 'front' in front of the hero.
 */
export const DEPTH = {
  SKY: 0,
  PARALLAX: 10, // +index of the background layer
  FOG_BACK: 90,
  DECOR_FAR: 100,
  TILES_BACK: 200,
  DECOR_BACK: 300,
  ENTITIES: 350, // checkpoints
  TILES_MAIN: 400,
  FX_BEHIND: 450, // dash after-images
  PLAYER: 500,
  FX_FRONT: 550, // dust puffs
  DECOR_FRONT: 600,
  TILES_FRONT: 700,
  PARTICLES: 750, // ambient motes
  AMBIENT: 800, // colour multiplied over everything below
  LIGHTS: 850, // additive glows punch through the ambient tint
  FOG_FRONT: 870,
  VIGNETTE: 900,
  DEBUG: 950,
  FADE: 1000,
} as const;

/** Seconds for the fade used by room transitions and hazard respawns. */
export const FADE_OUT_TIME = 0.14;
export const FADE_IN_TIME = 0.22;
