// Small SVG + raster helpers shared by all art generators.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { P } from './palette.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const IMAGE_SCALE = 2;
export const abs = (p) => resolve(ROOT, p);

/** Deterministic random numbers (so `npm run art` always gives the same pixels). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const n = (v) => +(+v).toFixed(2);
let uidCounter = 0;
export const uid = (p = 'u') => `${p}${++uidCounter}`;
export const resetUid = () => { uidCounter = 0; };

/** Wrap body in an <svg> of w x h logical px rendered at IMAGE_SCALE. */
export function svgDoc(w, h, body, scale = IMAGE_SCALE) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
export async function writePng(svg, relPath) {
  const out = abs(relPath);
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
}
export function writeJson(relPath, data) {
  const out = abs(relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
}
export function writeText(relPath, text) {
  const out = abs(relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
}

/* ---------- path builders ---------- */
export const poly = (pts, close = true) => 'M' + pts.map((p) => `${n(p[0])},${n(p[1])}`).join('L') + (close ? 'Z' : '');
/** Smooth curve through points (Catmull-Rom -> cubic bezier). */
export function smooth(pts, close = true, tension = 1) {
  const N = pts.length;
  if (N < 3) return poly(pts, close);
  const g = (i) => (close ? pts[(i + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
  let d = `M${n(pts[0][0])},${n(pts[0][1])}`;
  const segs = close ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    const k = tension / 6;
    d += `C${n(p1[0] + (p2[0] - p0[0]) * k)},${n(p1[1] + (p2[1] - p0[1]) * k)} ${n(p2[0] - (p3[0] - p1[0]) * k)},${n(p2[1] - (p3[1] - p1[1]) * k)} ${n(p2[0])},${n(p2[1])}`;
  }
  return d + (close ? 'Z' : '');
}
/** Nudge points a little for a hand-drawn feel. */
export const jitter = (pts, amp, rnd) => pts.map(([x, y]) => [x + (rnd() - 0.5) * 2 * amp, y + (rnd() - 0.5) * 2 * amp]);

/* ---------- element builders ---------- */
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${v}"`).join('');
/** Filled shape with the standard cartoon outline. opts: {sw, stroke, op, extra} */
export function shape(d, fill, o = {}) {
  return `<path d="${d}"${attrs({ fill, stroke: o.stroke === undefined ? P.outline : o.stroke, 'stroke-width': o.sw ?? 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: o.op, transform: o.tf })}/>`;
}
export const fillPath = (d, fill, o = {}) => `<path d="${d}"${attrs({ fill, opacity: o.op, transform: o.tf })}/>`;
export const line = (d, stroke, sw = 1.5, o = {}) => `<path d="${d}"${attrs({ fill: 'none', stroke, 'stroke-width': sw, 'stroke-linecap': o.cap ?? 'round', 'stroke-linejoin': 'round', opacity: o.op, 'stroke-dasharray': o.dash, transform: o.tf })}/>`;
export const rect = (x, y, w, h, fill, o = {}) => `<rect${attrs({ x: n(x), y: n(y), width: n(w), height: n(h), rx: o.rx, fill, stroke: o.stroke, 'stroke-width': o.stroke ? (o.sw ?? 2.5) : undefined, 'stroke-linejoin': 'round', opacity: o.op, transform: o.tf })}/>`;
export const circle = (cx, cy, r, fill, o = {}) => `<circle${attrs({ cx: n(cx), cy: n(cy), r: n(r), fill, stroke: o.stroke, 'stroke-width': o.stroke ? (o.sw ?? 2.5) : undefined, opacity: o.op })}/>`;
export const ellipse = (cx, cy, rx, ry, fill, o = {}) => `<ellipse${attrs({ cx: n(cx), cy: n(cy), rx: n(rx), ry: n(ry), fill, stroke: o.stroke, 'stroke-width': o.stroke ? (o.sw ?? 2.5) : undefined, opacity: o.op, transform: o.tf })}/>`;
export const group = (body, o = {}) => `<g${attrs({ transform: o.tf, opacity: o.op, 'clip-path': o.clip ? `url(#${o.clip})` : undefined, filter: o.filter ? `url(#${o.filter})` : undefined })}>${body}</g>`;
export const clipDef = (id, inner) => `<defs><clipPath id="${id}">${inner}</clipPath></defs>`;
export function radialGlow(id, color, stops = [[0, 1], [1, 0]]) {
  return `<defs><radialGradient id="${id}">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="${color}" stop-opacity="${a}"/>`).join('')}</radialGradient></defs>`;
}
export function linGrad(id, stops, vertical = true) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a ?? 1}"/>`).join('')}</linearGradient></defs>`;
}
