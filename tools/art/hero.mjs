// HERO ART + RIG
// "Wick" - a small apprentice lamplighter in an oversized hooded cloak.
// Every body part is drawn here in CHARACTER SPACE (feet centre = 0,0, y up is negative,
// facing right) and exported as its own upright PNG in public/assets/hero/.
// The skeleton is described by world positions/directions; local bone values are derived.
// To re-skin: edit colours in palette.mjs / shapes below (or paint over the PNGs), `npm run art`.
import { P } from './palette.mjs';
import { n, uid, svgDoc, writePng, writeJson, poly, smooth, shape, fillPath, line, rect, circle, ellipse, group, clipDef, radialGlow, linGrad, IMAGE_SCALE } from './lib.mjs';
import { buildAnimations, MIX } from './hero-anims.mjs';

const OUT = 2; // outline width
const rad = (d) => (d * Math.PI) / 180;

/* ------------------------------------------------------------------ */
/* Skeleton: name, parent, world x, world y, world direction (deg), length */
/* ------------------------------------------------------------------ */
const along = (b, d) => [b[2] + Math.cos(rad(b[4])) * d, b[3] + Math.sin(rad(b[4])) * d];
const B = [];
const bone = (name, parent, x, y, dir, length) => { const b = [name, parent, x, y, dir, length]; B.push(b); return b; };
const endOf = (b) => along(b, b[5]);

bone('root', null, 0, 0, 0, 0);
bone('hip', 'root', 0, -21, 0, 6);
const torso = bone('torso', 'hip', 0, -22, -90, 16);
bone('head', 'torso', 1, -39, -90, 30);
const tip1 = bone('hoodTip1', 'head', -9, -68, 160, 11);
bone('hoodTip2', 'hoodTip1', ...endOf(tip1), 112, 10);
const cape1 = bone('cape1', 'torso', -3, -37, 100, 10);
const cape2 = bone('cape2', 'cape1', ...endOf(cape1), 97, 10);
bone('cape3', 'cape2', ...endOf(cape2), 95, 10);
const scarf1 = bone('scarf1', 'torso', -8.5, -40, 150, 9);
const scarf2 = bone('scarf2', 'scarf1', ...endOf(scarf1), 118, 9);
bone('scarf3', 'scarf2', ...endOf(scarf2), 98, 9);
bone('armB', 'torso', -4.5, -35.5, 100, 13.5);
const armF = bone('armF', 'torso', 4.5, -35.5, 80, 13.5);
bone('weapon', 'armF', ...endOf(armF), -40, 30);
const thighB = bone('thighB', 'hip', -2.5, -20, 90, 9);
bone('shinB', 'thighB', ...endOf(thighB), 90, 11);
const thighF = bone('thighF', 'hip', 3, -20, 90, 9);
bone('shinF', 'thighF', ...endOf(thighF), 90, 11);
bone('fx', 'root', 2, -30, 0, 10);

export const SKELETON = Object.fromEntries(B.map(([name, parent, x, y, dir, length]) => [name, { name, parent, x, y, dir, length }]));

function localBones() {
  return B.map(([name, parent, x, y, dir, length]) => {
    if (!parent) return { name, parent, x, y, rotation: dir, scaleX: 1, scaleY: 1, length };
    const p = SKELETON[parent];
    const dx = x - p.x, dy = y - p.y, c = Math.cos(rad(-p.dir)), s = Math.sin(rad(-p.dir));
    return { name, parent, x: n(dx * c - dy * s), y: n(dx * s + dy * c), rotation: n(dir - p.dir), scaleX: 1, scaleY: 1, length };
  });
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                      */
/* ------------------------------------------------------------------ */
/** Capsule between two points with different end radii. */
function limb(x0, y0, x1, y1, r0, r1) {
  const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
  return `M${n(x0 + nx * r0)},${n(y0 + ny * r0)} A${r0},${r0} 0 0 1 ${n(x0 - nx * r0)},${n(y0 - ny * r0)} L${n(x1 - nx * r1)},${n(y1 - ny * r1)} A${r1},${r1} 0 0 1 ${n(x1 + nx * r1)},${n(y1 + ny * r1)}Z`;
}
/** Draw in bone-local coordinates (x runs along the bone). */
const onBone = (name, body) => { const b = SKELETON[name]; return group(body, { tf: `translate(${n(b.x)} ${n(b.y)}) rotate(${b.dir})` }); };
/** Char-space bounding box of a bone-local box. */
function boneBox(name, lx0, ly0, lx1, ly1) {
  const b = SKELETON[name], c = Math.cos(rad(b.dir)), s = Math.sin(rad(b.dir));
  const pts = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]].map(([x, y]) => [b.x + x * c - y * s, b.y + x * s + y * c]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.floor(Math.min(...xs)) - 1, Math.floor(Math.min(...ys)) - 1, Math.ceil(Math.max(...xs)) + 1, Math.ceil(Math.max(...ys)) + 1];
}

/* ------------------------------------------------------------------ */
/* Parts. Each: { name, bone, box:[x0,y0,x1,y1] in char space, svg, alpha?, additive? } */
/* Listed in DRAW ORDER (first = furthest back).                         */
/* ------------------------------------------------------------------ */
const parts = [];
const part = (name, boneName, box, svg, extra = {}) => parts.push({ name, bone: boneName, box, svg, ...extra });

// --- cloak: three feathery tiers, upper tiers overlap lower ones ---
function capeTier(name, len, f0, b0, f1, b1, fill, hi) {
  // local: x down the cape, -y = front (towards the body), +y = back
  const L = len + 3.2, w = f1 + b1, s = w / 3;
  const d = `M-3,${-f0} L${L - 1},${-f1} Q${L + 3.5},${n(-f1 + s * 0.5)} ${L - 0.5},${n(-f1 + s)} Q${L + 4},${n(-f1 + s * 1.5)} ${L},${n(-f1 + 2 * s)} Q${L + 4},${n(-f1 + s * 2.5)} ${L - 1.5},${b1} L-3,${b0}Z`;
  const svg = onBone(name, shape(d, fill, { sw: OUT }) + line(`M0,${n(b0 - 2.4)} L${L - 5},${n(b1 - 2.6)}`, hi, 1.4, { op: 0.8 }));
  part(name, name, boneBox(name, -5, -f1 - 2, L + 5, b1 + 2), svg);
}
capeTier('cape3', 10, 9.5, 12.5, 10.5, 14.5, P.cloakInner, P.cloak);
capeTier('cape2', 10, 8, 10.5, 9.5, 13, P.cloakDark, P.cloak);
capeTier('cape1', 10, 6, 8, 8, 11, P.cloak, P.cloakHi);

// --- scarf tail: three segments, seamless joints (sides outlined only) ---
function scarfSeg(name, w0, w1, last) {
  const L = 9;
  let s;
  if (last) {
    const d = `M-2,${-w0} L${L},${-w1} L${L + 6},${-w1 - 1.2} L${L + 2.5},0 L${L + 6},${w1 + 1.2} L${L},${w1} L-2,${w0}Z`;
    s = shape(d, P.scarf, { sw: OUT }) + line(`M${L - 2},${-w1 + 1.3} L${L + 3},${-w1 + 0.4}`, P.scarfHi, 1.2);
  } else {
    s = fillPath(`M-2,${-w0} L${L},${-w1} L${L},${w1} L-2,${w0}Z`, P.scarf) + circle(L, 0, w1, P.scarf)
      + line(`M-2,${-w0} L${L},${-w1} M-2,${w0} L${L},${w1}`, P.outline, OUT)
      + line(`M0,${-w0 + 1.6} L${L - 1},${-w1 + 1.6}`, P.scarfHi, 1.2)
      + (name === 'scarf2' ? fillPath(`M3,${-w0 + 0.9} L6,${-w1 + 0.9} L6,${w1 - 0.9} L3,${w0 - 0.9}Z`, P.scarfDark) : '');
  }
  part(name, name, boneBox(name, -4, -6, L + 8, 6), onBone(name, s));
}
scarfSeg('scarf3', 3.2, 3, true);
scarfSeg('scarf2', 3.4, 3.2, false);
scarfSeg('scarf1', 3.6, 3.4, false);

// --- arms ---
function arm(name, sleeve, sleeveHi, skin) {
  const s = shape(limb(0, 0, 10.5, 0, 3.8, 3.5), sleeve, { sw: OUT })
    + line('M1,-1.6 L8,-1.5', sleeveHi, 1.2, { op: 0.9 })
    + circle(13.2, 0, 3.5, skin, { stroke: P.outline, sw: OUT })
    + rect(8.6, -3.9, 3, 7.8, P.tunic, { rx: 1.4, stroke: P.outline, sw: 1.5 });
  part(name, name, boneBox(name, -5, -5, 18, 5), onBone(name, s));
}
arm('armB', P.cloakDark, P.cloak, P.skinShade);

// --- legs ---
function leg(side, x, legging, boot, bootHi, bootDark) {
  const thigh = shape(limb(x, -20, x, -11, 3.9, 3.6), legging, { sw: OUT });
  part('thigh' + side, 'thigh' + side, [x - 6, -26, x + 6, -5], thigh);
  const s = shape(limb(x, -11, x, -4, 3.8, 4), boot, { sw: OUT })
    + shape(`M${x - 4},-6.5 L${x + 3.5},-7 Q${x + 9.2},-6.3 ${x + 9.6},-2.2 Q${x + 9.8},0 ${x + 7.6},0 L${x - 3},0 Q${x - 4},0 ${x - 4},-1Z`, boot, { sw: OUT })
    + rect(x - 2.9, -9, 5.9, 4.6, boot)
    + line(`M${x + 2.2},-5.3 Q${x + 6},-5 ${x + 7.4},-2.8`, bootHi, 1.3)
    + line(`M${x - 3},-0.9 H${x + 8}`, bootDark, 1.5)
    + rect(x - 4.4, -12.6, 8.8, 3.6, bootHi, { rx: 1.6, stroke: P.outline, sw: 1.5 });
  part('shin' + side, 'shin' + side, [x - 7, -15, x + 12, 2], s);
}
leg('B', -2.5, P.leggingDark, P.bootDark, P.boot, P.woodDeep);
leg('F', 3, P.legging, P.boot, P.bootHi, P.bootDark);

// --- torso: cream tunic, belt, cloak mantle over the shoulders ---
{
  const tunic = 'M-7.5,-38 Q-8.6,-30 -7,-27 Q-10.8,-21 -10.8,-16.2 Q0,-13.2 10.8,-16.2 Q10.8,-21 7,-27 Q8.6,-30 7.5,-38Z';
  const id = uid('t');
  const s = clipDef(id, `<path d="${tunic}"/>`)
    + fillPath(tunic, P.tunic)
    + group(rect(-12, -40, 7.5, 28, P.tunicShade) + rect(-12, -18.6, 24, 4, P.tunicShade, { op: 0.8 }), { clip: id })
    + shape(tunic, 'none', { sw: OUT })
    + shape('M-7.4,-28.4 L7.4,-28.4 L7.9,-25 L-7.9,-25Z', P.boot, { sw: 1.5 })
    + rect(1, -29.1, 3.8, 4.8, P.gold, { rx: 1, stroke: P.outline, sw: 1.3 })
    + shape('M-10.6,-32 Q-11.4,-39.5 -5,-42 L6,-42 Q11.4,-39.5 10.6,-32 Q8,-29.8 5.3,-32.2 Q2.6,-29.4 0,-32 Q-2.6,-29.4 -5.3,-32.2 Q-8,-29.8 -10.6,-32Z', P.cloak, { sw: OUT })
    + line('M3,-39.6 Q8,-38.6 8.6,-34.4', P.cloakHi, 1.3);
  part('torso', 'torso', [-14, -45, 14, -11], s);
}

// --- scarf wrap around the neck ---
part('scarf', 'torso', [-14, -47, 13, -33],
  circle(-8.6, -40, 3.2, P.scarfDark, { stroke: P.outline, sw: OUT })
  + shape(smooth([[-9, -40.5], [-4, -43.6], [3, -44], [9.5, -41.6], [10.5, -38.6], [5, -35.6], [-3, -35.4], [-8.5, -37.4]]), P.scarf, { sw: OUT })
  + line('M-3,-41.6 Q2,-42.4 6.5,-40.8', P.scarfHi, 1.3));

// --- floppy hood tip (2 segments) ---
{
  const t2 = shape('M-1,-4.4 L9,-2 L9,2 L-1,4.4Z', P.cloakDark, { sw: OUT })
    + circle(11.8, 0, 3.8, P.gold, { stroke: P.outline, sw: OUT }) + circle(10.8, -1, 1.3, P.goldHi);
  part('hoodTip2', 'hoodTip2', boneBox('hoodTip2', -3, -6, 17, 6), onBone('hoodTip2', t2));
  const t1 = fillPath('M-4,-7.6 L11,-4.6 L11,4.6 L-4,7.6Z', P.cloak) + circle(11, 0, 4.6, P.cloak)
    + line('M-4,-7.6 L11,-4.6 M-4,7.6 L11,4.6', P.outline, OUT) + line('M-2,5 L10,2.6', P.cloakHi, 1.2, { op: 0.8 });
  part('hoodTip1', 'hoodTip1', boneBox('hoodTip1', -6, -9.5, 17, 9.5), onBone('hoodTip1', t1));
}

// --- face ---
part('head', 'head', [-11, -69, 20, -38],
  ellipse(4.3, -53.3, 12.6, 12.8, P.skin, { stroke: P.outline, sw: OUT })
  + fillPath('M-7,-48 Q-2,-41.5 6,-41.2 Q0,-43 -4.5,-50Z', P.skinShade, { op: 0.8 })
  + shape('M-8,-56 Q-7,-67 5,-67 Q16,-67 17.6,-57.5 Q14.5,-62 10.5,-61.2 Q9.6,-58.4 6,-58 Q4.6,-61.4 0,-61.2 Q-4.5,-60.6 -8,-56Z', P.hair, { sw: 1.2, stroke: P.hairShade })
  + ellipse(-0.2, -47.6, 2.7, 1.7, P.scarfHi, { op: 0.7 }) + ellipse(14, -47.8, 2, 1.6, P.scarfHi, { op: 0.7 })
  + line('M6.4,-46.3 Q8,-44.8 9.8,-46.3', P.outline, 1.3));

// --- hood (with face opening) ---
{
  const outer = smooth([[1, -75], [11, -72.5], [17.6, -65], [19.6, -54], [17.2, -44], [9, -38.4], [-3, -37.8], [-12, -41.5], [-16.6, -51], [-15, -63], [-8.5, -72]]);
  const cx = 6.2, cy = -52.6, rx = 11, ry = 11.4;
  const hole = `M${cx - rx},${cy} a${rx},${ry} 0 1 0 ${2 * rx},0 a${rx},${ry} 0 1 0 ${-2 * rx},0Z`;
  const id = uid('h');
  const s = `<defs><clipPath id="${id}"><path d="${outer} ${hole}" clip-rule="evenodd"/></clipPath></defs>`
    + group(rect(-20, -80, 44, 46, P.cloakDark) + circle(5, -60, 19.5, P.cloak)
      + ellipse(cx, cy, rx + 1.3, ry + 1.3, 'none', { stroke: P.cloakHi, sw: 2.6 })
      + line('M2,-71.6 Q11,-70.6 15,-63', P.cloakHi, 1.8, { op: 0.9 }), { clip: id })
    + `<path d="${outer} ${hole}" fill="none" fill-rule="evenodd" stroke="${P.outline}" stroke-width="${OUT}" stroke-linejoin="round"/>`;
  part('hood', 'head', [-19, -78, 22, -35], s);
}

// --- eyes (open / closed swap with slot alpha) ---
part('eyes', 'head', [-2, -59, 16, -46],
  ellipse(3, -52.2, 2.6, 4.1, P.eye) + ellipse(11.8, -52.2, 2.2, 3.9, P.eye)
  + circle(2.2, -54, 1.15, P.white) + circle(11.1, -54, 1, P.white)
  + circle(3.9, -50.2, 0.6, P.white, { op: 0.7 }) + circle(12.5, -50.3, 0.5, P.white, { op: 0.7 }));
part('eyesClosed', 'head', [-2, -59, 16, -46],
  line('M0.4,-52 Q3,-49.6 5.6,-52 M9.6,-52 Q11.8,-49.8 14,-52', P.eye, 1.5), { alpha: 0 });

// --- lantern-blade: a short glowing sword whose guard is a tiny lantern ---
{
  const s = rect(-4.5, -1.5, 9, 3, P.woodDark, { rx: 1.2, stroke: P.outline, sw: 1.5 })
    + circle(-5.4, 0, 2.2, P.gold, { stroke: P.outline, sw: 1.5 })
    + shape('M11.5,-2.7 Q20,-5 26.5,-3.2 L32.5,0 L26.5,3.2 Q20,5 11.5,2.7Z', P.blade, { sw: 1.8 })
    + line('M13,0 L28.5,0', P.bladeEdge, 1.4) + line('M14,-2 Q20,-3.4 25.5,-2.2', P.white, 1)
    + rect(4, -5.2, 8.4, 10.4, P.gold, { rx: 2.6, stroke: P.outline, sw: 1.8 })
    + rect(5.9, -3.2, 4.6, 6.4, P.flameCore, { rx: 1.6, stroke: P.goldDark, sw: 1 })
    + circle(8.2, 0.2, 1.4, P.white);
  part('weapon', 'weapon', boneBox('weapon', -9, -7, 34, 7), onBone('weapon', s));
  const id = uid('g');
  const g = radialGlow(id, P.flame, [[0, 0.95], [0.35, 0.45], [1, 0]]) + `<circle cx="10" cy="0" r="24" fill="url(#${id})"/>`;
  part('glow', 'weapon', boneBox('weapon', -15, -25, 35, 25), onBone('weapon', g), { additive: true, alpha: 0.55 });
}
arm('armF', P.cloak, P.cloakHi, P.skin);

// --- slash arc effect (hidden except while attacking) ---
{
  const cx = 2, cy = -30, R = 42, a0 = rad(-72), a1 = rad(58);
  const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
  const cres = (r2) => `M${n(p0[0])},${n(p0[1])} A${R},${R} 0 0 1 ${n(p1[0])},${n(p1[1])} A${r2},${r2} 0 0 0 ${n(p0[0])},${n(p0[1])}Z`;
  const id = uid('s');
  const s = linGrad(id, [[0, P.flameCore, 0.95], [0.5, P.glow, 0.9], [1, P.glow, 0.05]])
    + `<path d="${cres(66)}" fill="url(#${id})"/>` + fillPath(cres(48), P.white, { op: 0.85 })
    + line(`M${n(p0[0])},${n(p0[1])} A${R},${R} 0 0 1 ${n(p1[0])},${n(p1[1])}`, P.flame, 1.6, { op: 0.9 });
  part('slash', 'fx', [10, -74, 48, 10], s, { alpha: 0 });
}

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */
export function heroRig() {
  const slots = parts.map((p) => {
    const b = SKELETON[p.bone];
    const [x0, y0, x1, y1] = p.box;
    const w = x1 - x0, h = y1 - y0;
    const slot = {
      name: p.name, bone: p.bone, image: `assets/hero/${p.name}.png`, w, h, imageScale: IMAGE_SCALE,
      x: 0, y: 0, rotation: n(-b.dir), originX: +((b.x - x0) / w).toFixed(4), originY: +((b.y - y0) / h).toFixed(4),
    };
    if (p.alpha !== undefined) slot.alpha = p.alpha;
    if (p.additive) slot.additive = true;
    return slot;
  });
  return { version: 1, name: 'hero', bones: localBones(), slots, animations: buildAnimations(SKELETON), mix: MIX };
}
export const heroPartSvg = (p) => { const [x0, y0, x1, y1] = p.box; return svgDoc(x1 - x0, y1 - y0, group(p.svg, { tf: `translate(${-x0} ${-y0})` })); };
export const heroParts = parts;

export async function buildHero() {
  for (const p of parts) await writePng(heroPartSvg(p), `public/assets/hero/${p.name}.png`);
  writeJson('content/rigs/hero.rig.json', heroRig());
}
