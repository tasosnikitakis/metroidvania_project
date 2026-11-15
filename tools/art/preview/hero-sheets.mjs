// Hero preview sheets, rendered through the REAL runtime math (src/rig/pose.ts).
//   hero-setup.png           big setup pose + exploded parts
//   hero-anim-<name>.png     contact sheet (frames sampled across the duration)
import { readFileSync } from 'node:fs';
import { abs, svgDoc, writePng } from '../lib.mjs';
import { P } from '../palette.mjs';
import { sampleAnimation, computeWorldTransforms, computeBoneMatrices } from '../../../src/rig/pose.ts';

const OUT = 'tools/art/preview/out/';
const cache = new Map();
const b64 = (rel) => { if (!cache.has(rel)) cache.set(rel, `data:image/png;base64,${readFileSync(abs('public/' + rel)).toString('base64')}`); return cache.get(rel); };

/** SVG for a posed rig with the feet at (0,0). Same maths as drawRigToCanvas. */
export function rigSvg(rig, pose, { bones = false } = {}) {
  let s = '';
  for (const t of computeWorldTransforms(rig, pose)) {
    if (t.alpha <= 0.001) continue;
    const sl = t.slot;
    s += `<image href="${b64(sl.image)}" x="${-sl.originX * sl.w}" y="${-sl.originY * sl.h}" width="${sl.w}" height="${sl.h}" opacity="${t.alpha.toFixed(3)}" transform="matrix(${[t.a, t.b, t.c, t.d, t.tx, t.ty].map((v) => v.toFixed(4)).join(' ')})"${sl.additive ? ' style="mix-blend-mode:screen"' : ''}/>`;
  }
  if (bones) {
    const m = computeBoneMatrices(rig, pose);
    rig.bones.forEach((b, i) => {
      const o = i * 6, L = b.length ?? 5;
      s += `<path d="M${m[o + 4]},${m[o + 5]} L${m[o + 4] + m[o] * L},${m[o + 5] + m[o + 1] * L}" stroke="#ff0" stroke-width="0.6"/><circle cx="${m[o + 4]}" cy="${m[o + 5]}" r="1" fill="#f44"/>`;
    });
  }
  return s;
}

export async function build() {
  const rig = JSON.parse(readFileSync(abs('content/rigs/hero.rig.json'), 'utf8'));
  // ---- setup pose, big, plus bones overlay and exploded parts ----
  {
    const setup = sampleAnimation(rig, undefined, 0);
    let body = `<rect width="330" height="130" fill="${P.skyMid}"/><rect y="110" width="330" height="20" fill="${P.stoneDark}"/>`;
    body += `<g transform="translate(60 110)">${rigSvg(rig, setup)}</g>`;
    body += `<g transform="translate(160 110)"><rect x="-15" y="-66" width="30" height="66" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="0.5"/>${rigSvg(rig, setup, { bones: true })}</g>`;
    body += `<g transform="translate(270 110) scale(-1 1)">${rigSvg(rig, setup)}</g>`;
    await writePng(svgDoc(330, 130, body, 5), OUT + 'hero-setup.png');
    // small size check (1x game scale) on tiles colour
    let small = `<rect width="330" height="100" fill="${P.wall}"/><rect y="88" width="330" height="12" fill="${P.stone}"/>`;
    ['idle', 'run', 'jump', 'fall', 'attack', 'dash', 'wallSlide'].forEach((nm, i) => {
      const a = rig.animations[nm];
      small += `<g transform="translate(${30 + i * 45} 88)">${rigSvg(rig, sampleAnimation(rig, a, a.duration * 0.37))}</g>`;
    });
    await writePng(svgDoc(330, 100, small, 2), OUT + 'hero-small.png');
  }
  // ---- contact sheets ----
  for (const [name, anim] of Object.entries(rig.animations)) {
    const N = 10, COLS = 5, CW = 112, CH = 116, G = 96, ROWS = N / COLS;
    let body = `<rect width="${COLS * CW}" height="${ROWS * CH}" fill="${P.skyMid}"/>`;
    for (let i = 0; i < N; i++) {
      const t = anim.loop ? (anim.duration * i) / N : (anim.duration * i) / (N - 1);
      const pose = sampleAnimation(rig, anim, t);
      const ox = (i % COLS) * CW, oy = Math.floor(i / COLS) * CH;
      body += `<rect x="${ox}" y="${oy + G}" width="${CW}" height="${CH - G}" fill="${P.stoneDark}"/>`;
      body += `<g transform="translate(${ox + 50} ${oy + G})"><rect x="-15" y="-66" width="30" height="66" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="0.5"/>${rigSvg(rig, pose)}</g>`;
      body += `<text x="${ox + 4}" y="${oy + CH - 6}" font-size="8" fill="#fff" font-family="sans-serif">${name} ${t.toFixed(3)}s</text>`;
    }
    await writePng(svgDoc(COLS * CW, ROWS * CH, body, 3), OUT + `hero-anim-${name}.png`);
  }
}
