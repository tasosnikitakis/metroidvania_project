/** Small dependency-free maths helpers shared by the whole runtime. */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move `current` toward `target` by at most `maxDelta` (never overshoots). */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/**
 * Convert a "per 60 fps frame" lerp factor (the usual way camera smoothing is
 * expressed, e.g. 0.12) into the equivalent factor for a step of `dt` seconds,
 * so smoothing feels identical at any update rate.
 */
export function lerpFactor(per60: number, dt: number): number {
  const p = clamp(per60, 0, 1);
  if (p >= 1) return 1;
  return 1 - Math.pow(1 - p, dt * 60);
}

/** Parse "#rrggbb" / "#rgb" into 0xRRGGBB. Falls back to white on bad input. */
export function parseColor(css: string | undefined, fallback = 0xffffff): number {
  if (!css) return fallback;
  let s = css.trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  return Number.isFinite(n) && s.length >= 6 ? n : fallback;
}

/** Cheap deterministic hash -> 0..1, handy for per-object random phases. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Smooth organic flicker in 0..1 (a few sine waves mixed together).
 * `seed` de-synchronises different lights.
 */
export function flickerNoise(time: number, seed: number): number {
  const t = time + seed * 100;
  const v = Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.7 + 1.3) * 0.3 + Math.sin(t * 23.1 + 4.1) * 0.2;
  return v * 0.5 + 0.5;
}
