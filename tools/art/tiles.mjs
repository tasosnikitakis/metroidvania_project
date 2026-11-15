// TILESET GENERATOR
// Every tile is drawn in a 48x48 box by a small function returning SVG.
// The order of `add(...)` calls defines the tile ids (1-based, row-major).
// To restyle: change colours in palette.mjs or the shapes below, then `npm run art`.
import { P } from './palette.mjs';
import {
  rng, n, uid, svgDoc, writePng, writeJson, poly, smooth, shape, fillPath, line, rect, circle, ellipse,
  group, clipDef, IMAGE_SCALE,
} from './lib.mjs';

const T = 48;
export const COLUMNS = 16;

/* ================================================================== */
/* Brick patterns (all periodic over 48px so tiles join seamlessly)     */
/* ================================================================== */

/** tint index per (row, parity). 0 = base, 1 = light, 2 = dark */
const STONE_TINTS = [[0, 1], [0, 2], [1, 0], [2, 0]];
const stoneCols = [P.stone, P.stoneLight, P.stoneDark];

function stoneBricks(override = {}) {
  let s = rect(-12, -12, 72, 72, P.stoneMortar);
  for (let r = -1; r < 5; r++) {
    const rr = ((r % 4) + 4) % 4;
    const off = rr % 2 ? 12 : 0;
    for (let k = -1; k < 3; k++) {
      const par = ((k % 2) + 2) % 2;
      const x = off - 24 + k * 24 + 24, y = r * 12;
      const key = `${rr},${par}`;
      const cut = rr % 2 === 1 && par === 1; // this brick wraps around the tile edge: never restyle it
      const tint = !cut && override[key] !== undefined ? override[key] : STONE_TINTS[rr][par];
      s += rect(x + 0.8, y + 0.8, 22.4, 10.4, stoneCols[tint], { rx: 2.4 });
      s += line(`M${x + 3.5},${y + 2.6}H${x + 15}`, P.stoneHi, 1.1, { op: tint === 2 ? 0.25 : 0.5 });
    }
  }
  return s;
}

function wallBricks(override = {}) {
  const cols = [P.wall, P.wallLight, P.wallDark];
  const tints = [0, 2, 0, 1, 0, 0];
  let s = rect(-12, -12, 72, 72, P.wallMortar);
  for (let r = -1; r < 4; r++) {
    const rr = ((r % 3) + 3) % 3;
    const off = rr * 16;
    for (let k = -2; k < 2; k++) {
      const x = off + k * 48, y = r * 16;
      const tint = override[rr] ?? tints[rr];
      s += rect(x + 0.8, y + 0.8, 46.4, 14.4, cols[tint], { rx: 2.5 });
      s += line(`M${x + 4},${y + 3}H${x + 20}`, P.wallHi, 1.1, { op: 0.35 });
    }
  }
  return s;
}

/* ================================================================== */
/* Terrain: castle-stone (solid ground)                                 */
/* ================================================================== */

const GRASS_DEPTH = [8, 12.5, 8.5, 13.5, 9, 11.5, 8, 13, 8]; // every 6px, periodic
function grassCap() {
  const pts = [];
  for (let x = -12; x <= 60; x += 6) pts.push([x, GRASS_DEPTH[((x / 6) % 8 + 8) % 8]]);
  const edge = smooth(pts, false);
  const d = `M-12,-4 L${edge.slice(1)} L60,-4 Z`;
  return fillPath(d, P.moss)
    + fillPath(`M-12,6 L${smooth(pts.map(([x, y]) => [x, y - 0.2]), false).slice(1)} L60,6Z`, P.mossDark, { op: 0.75 })
    + line(edge, P.outline, 1.8)
    + line('M-12,4.3H60', P.mossHi, 1.6, { dash: '7 5', op: 0.9 });
}

function stoneTile(mask, variant = 0) {
  const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
  const x0 = W ? -14 : 0, x1 = E ? 62 : 48, y0 = N ? -14 : 0, y1 = S ? 62 : 48;
  const id = uid('c');
  const r = `x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="8"`;
  let body = stoneBricks(STONE_VARIANTS[variant].tints);
  body += STONE_VARIANTS[variant].extra();
  if (!S) body += rect(-12, 41, 72, 8, P.outline, { op: 0.3 });
  if (!E) body += rect(42.5, -12, 6, 72, P.outline, { op: 0.22 });
  if (!W) body += rect(2.4, -12, 2, 72, P.stoneHi, { op: 0.45 });
  if (!N) body += grassCap();
  body += `<rect ${r} fill="none" stroke="${P.outline}" stroke-width="5.4"/>`;
  return clipDef(id, `<rect ${r}/>`) + group(body, { clip: id });
}

const niche = () => rect(13.5, 10.5, 21, 19, P.stoneMortar, { rx: 4 }) + rect(15, 12.5, 18, 16, P.outline, { rx: 3, op: 0.55 });
const STONE_VARIANTS = [
  { tints: {}, extra: () => '' },
  { // crack + shuffled bricks
    tints: { '0,0': 2, '0,1': 0, '2,0': 0, '2,1': 1, '1,0': 1 },
    extra: () => line('M30,-1 L27,7 L31,12 L26,19 L29,25 L25,30', P.stoneMortar, 2) + line('M27,7 L22,10 M26,19 L32,22', P.stoneMortar, 1.4),
  },
  { // tiny friendly skull in a niche
    tints: { '0,0': 1, '2,1': 2, '3,0': 0 },
    extra: () => niche()
      + shape('M17.5,19 Q17.5,13.5 24,13.5 Q30.5,13.5 30.5,19 Q30.5,22.5 28,23.5 L28,26.5 L20,26.5 L20,23.5 Q17.5,22.5 17.5,19Z', P.bone, { sw: 1.4 })
      + circle(21.4, 19.5, 1.9, P.outline) + circle(26.6, 19.5, 1.9, P.outline)
      + line('M22.6,24.3V26.3 M25.4,24.3V26.3', P.outline, 0.9) + fillPath('M24,21.6 L23.2,23 L24.8,23Z', P.outline),
  },
  { // glowing rune
    tints: { '0,1': 0, '2,0': 2, '2,1': 1 },
    extra: () => niche()
      + line('M24,14.5 L28.5,20 L24,26 L19.5,20 Z M24,14.5 V26 M21,23.5 H27', P.mint, 3.2, { op: 0.25 })
      + line('M24,14.5 L28.5,20 L24,26 L19.5,20 Z M24,14.5 V26 M21,23.5 H27', P.mint, 1.4),
  },
];

/* ================================================================== */
/* Terrain: castle-wall (background brick with crumbling edges)         */
/* ================================================================== */

const JAG = [
  [[0, 4], [9, 4], [9, 8.5], [20, 8.5], [20, 3], [31, 3], [31, 9.5], [40, 9.5], [40, 4], [48, 4]],
  [[0, 4], [7, 4], [7, 2.5], [17, 2.5], [17, 9], [27, 9], [27, 5], [38, 5], [38, 8], [43, 8], [43, 4], [48, 4]],
  [[0, 4], [11, 4], [11, 9], [19, 9], [19, 5.5], [33, 5.5], [33, 2.5], [41, 2.5], [41, 4], [48, 4]],
  [[0, 4], [8, 4], [8, 7], [16, 7], [16, 10], [26, 10], [26, 3.5], [36, 3.5], [36, 7.5], [42, 7.5], [42, 4], [48, 4]],
];
const SIDE_TF = [
  (t, d) => [t, d], (t, d) => [48 - d, t], (t, d) => [48 - t, 48 - d], (t, d) => [d, 48 - t],
];
function wallShape(mask) {
  const open = [!(mask & 1), !(mask & 2), !(mask & 4), !(mask & 8)]; // N E S W exposed?
  const pts = [];
  for (let s = 0; s < 4; s++) {
    const prev = open[(s + 3) % 4], next = open[(s + 1) % 4];
    const tf = SIDE_TF[s];
    if (!open[s]) { pts.push(tf(-14, -14), tf(62, -14)); continue; }
    const a = prev ? 4 : -14, b = next ? 44 : 62;
    pts.push(tf(a, 4));
    for (const [t, d] of JAG[s]) if (t > a && t < b && t > 0 && t < 48) pts.push(tf(t, d));
    pts.push(tf(b, 4));
  }
  return poly(pts);
}
const WALL_VARIANTS = [
  { tints: {}, extra: () => '' },
  { tints: { 0: 2, 2: 1 }, extra: () => line('M14,17 L18,24 L15,31 M18,24 L23,26', P.wallMortar, 1.8) },
  { // little barred drain
    tints: { 1: 0 },
    extra: () => shape('M18,31 V23 Q18,17 24,17 Q30,17 30,23 V31Z', P.wallMortar, { sw: 1.6, stroke: P.wallDark })
      + line('M22,18V31 M26,18V31', P.wallHi, 1.3, { op: 0.6 }),
  },
  { // missing bricks
    tints: { 2: 2 },
    extra: () => rect(17, 17, 15, 14, P.wallMortar, { rx: 2 }) + rect(33, 33, 10, 14, P.wallMortar, { rx: 2 }),
  },
];
function wallTile(mask, variant = 0) {
  const id = uid('w');
  const d = wallShape(mask);
  const body = wallBricks(WALL_VARIANTS[variant].tints) + WALL_VARIANTS[variant].extra()
    + `<path d="${d}" fill="none" stroke="${P.wallMortar}" stroke-width="3.2" stroke-linejoin="round"/>`;
  return clipDef(id, `<path d="${d}"/>`) + group(body, { clip: id });
}

/* ================================================================== */
/* One-way platforms                                                    */
/* ================================================================== */

function plank(kind) { // 'l' | 'm' | 'r'
  const x0 = kind === 'l' ? 1.5 : -6, x1 = kind === 'r' ? 46.5 : 54;
  let s = '';
  // little support pegs under the ends
  if (kind === 'l') s += shape('M8,12 L8,24 Q8,27 11,25 L22,13Z', P.woodDark, { sw: 2.2 });
  if (kind === 'r') s += shape('M40,12 L40,24 Q40,27 37,25 L26,13Z', P.woodDark, { sw: 2.2 });
  s += rect(x0, 1.3, x1 - x0, 12.4, P.wood, { rx: 3.5, stroke: P.outline });
  s += rect(Math.max(x0 + 1.4, -6), 9.6, x1 - x0 - 2.8, 2.8, P.woodDark, { op: 0.75, rx: 1 });
  s += line(`M${x0 + 4},4.3H${x1 - 4}`, P.woodHi, 1.6, { dash: '13 4 5 2', op: 0.95 });
  s += line('M12,7.6H22 M30,8.2H41', P.woodDark, 1, { op: 0.8 });
  if (kind === 'm') s += line('M24,2V13', P.outline, 1.6) + circle(21, 6, 1, P.woodDeep) + circle(27, 6, 1, P.woodDeep);
  if (kind === 'l') s += rect(4.5, 1.3, 5, 12.4, P.iron, { stroke: P.outline, sw: 1.8 }) + circle(7, 7.5, 1.1, P.ironHi);
  if (kind === 'r') s += rect(38.5, 1.3, 5, 12.4, P.iron, { stroke: P.outline, sw: 1.8 }) + circle(41, 7.5, 1.1, P.ironHi);
  return s;
}

function ledge(kind) {
  const x0 = kind === 'l' ? 1.5 : -6, x1 = kind === 'r' ? 46.5 : 54;
  let s = '';
  if (kind === 'l') s += shape('M6,12 H30 Q26,20 16,21 Q7,21 6,12Z', P.stoneDark, { sw: 2.2 });
  if (kind === 'r') s += shape('M42,12 H18 Q22,20 32,21 Q41,21 42,12Z', P.stoneDark, { sw: 2.2 });
  if (kind === 'm') s += shape('M14,12 H34 Q32,18 24,18.5 Q16,18 14,12Z', P.stoneDark, { sw: 2.2 });
  s += rect(x0, 1.3, x1 - x0, 13, P.stone, { rx: 4, stroke: P.outline });
  s += rect(Math.max(x0 + 1.4, -6), 10.4, x1 - x0 - 2.8, 2.6, P.stoneDark, { rx: 1 });
  const id = uid('l');
  s += clipDef(id, `<rect x="${x0 + 1.2}" y="2.5" width="${x1 - x0 - 2.4}" height="10.6" rx="3"/>`)
    + group(fillPath('M-6,0 H54 V5 Q48,8 42,5.2 Q36,3 30,5.6 Q24,8.5 18,5.4 Q12,3 6,5.6 Q0,8 -6,5Z', P.moss)
      + line('M-6,3.6H54', P.mossHi, 1.3, { dash: '6 6', op: 0.9 }), { clip: id });
  s += line(kind === 'm' ? 'M24,8V13' : kind === 'l' ? 'M30,8.5V13' : 'M18,8.5V13', P.stoneMortar, 1.4);
  return s;
}

/* ================================================================== */
/* Hazards                                                              */
/* ================================================================== */

function spikes() {
  const tips = [17, 12, 15, 11];
  let s = '';
  for (let i = 0; i < 4; i++) {
    const x = i * 12, t = tips[i];
    s += shape(`M${x + 0.6},45 L${x + 6},${t} L${x + 11.4},45Z`, P.bone, { sw: 2.2 });
    s += fillPath(`M${x + 6},${t + 3} L${x + 10},44 L${x + 6.4},44Z`, P.boneShade);
    s += line(`M${x + 4.6},${t + 9} L${x + 3.2},38`, P.white, 1.1, { op: 0.9 });
  }
  s += rect(-4, 42.5, 56, 8, P.ironDark, { stroke: P.outline, sw: 2.2 });
  s += line('M-4,45.3H52', P.ironHi, 1.2, { dash: '5 7', op: 0.7 });
  return s;
}

function brambles() {
  const vines = [
    'M-4,34 C8,22 14,44 24,33 S40,22 52,34',
    'M-4,16 C6,26 16,6 26,16 S42,26 52,16',
    'M10,50 C4,38 20,30 14,18 S22,4 18,-4',
    'M38,50 C44,40 30,30 36,20 S30,6 34,-4',
  ];
  let s = '';
  for (const v of vines) s += line(v, P.outline, 7.5);
  const thorns = [[6, 27, -40], [15, 37, 160], [24, 33, -20], [33, 27, 200], [43, 27, -30], [5, 19, 150], [14, 12, -10], [27, 16, 190], [38, 21, 20], [46, 20, 170],
    [9, 41, 250], [15, 24, 80], [17, 6, 260], [36, 40, 100], [33, 27, 280], [33, 9, 80]];
  for (const [x, y, a] of thorns) s += shape('M-2.6,0 L0,-8 L2.6,0Z', P.magentaHi, { sw: 1.6, tf: `translate(${x} ${y}) rotate(${a})` });
  for (const v of vines) s += line(v, P.bramble, 4.2);
  for (const v of vines) s += line(v, P.brambleHi, 1.2, { dash: '5 9', op: 0.9, tf: 'translate(-0.8 -0.9)' });
  return s;
}

/* ================================================================== */
/* Solid ornaments                                                      */
/* ================================================================== */

function pillarShaft(y0, y1) {
  return rect(8, y0, 32, y1 - y0, P.stoneLight)
    + rect(31, y0, 9, y1 - y0, P.stone)
    + line(`M16.5,${y0}V${y1} M24,${y0}V${y1} M31,${y0}V${y1}`, P.stoneDark, 1.8, { cap: 'butt' })
    + line(`M11.6,${y0}V${y1}`, P.stoneHi, 1.6, { cap: 'butt' })
    + line(`M8,${y0}V${y1} M40,${y0}V${y1}`, P.outline, 2.6, { cap: 'butt' });
}
const pillarMid = () => pillarShaft(-4, 52);
const pillarTop = () => pillarShaft(18, 52)
  + shape('M4.5,11 H43.5 L39.5,21.5 H8.5Z', P.stone)
  + rect(1.3, 1.3, 45.4, 10.4, P.stoneLight, { rx: 3.5, stroke: P.outline })
  + line('M5,4.3H36', P.stoneHi, 1.5) + line('M10,16H38', P.stoneDark, 1.5);
const pillarBase = () => pillarShaft(-4, 30)
  + shape('M8.5,26.5 H39.5 L43.5,37 H4.5Z', P.stone)
  + rect(1.3, 36.3, 45.4, 10.4, P.stoneLight, { rx: 3.5, stroke: P.outline })
  + line('M5,39.3H36', P.stoneHi, 1.5) + rect(3, 43, 42, 2.6, P.stoneDark, { rx: 1 });

function blockBase() {
  return rect(1.3, 1.3, 45.4, 45.4, P.stone, { rx: 6, stroke: P.outline })
    + rect(3, 40, 42, 5, P.stoneDark, { rx: 2.5 })
    + rect(7.5, 7.5, 33, 31, P.stoneDark, { rx: 4 })
    + rect(9, 9.5, 30, 28, P.stoneMortar, { rx: 3 })
    + line('M5.5,4.4H30', P.stoneHi, 1.6);
}
const carvedMoon = () => blockBase()
  + fillPath('M27,13 A11,11 0 1 0 34,30 A9,9 0 1 1 27,13Z', P.gold)
  + line('M21,17.5 A8,8 0 0 0 19.5,26', P.goldHi, 1.4)
  + fillPath('M31,16 l1,2.4 2.4,1 -2.4,1 -1,2.4 -1,-2.4 -2.4,-1 2.4,-1Z', P.goldHi);
const carvedRune = () => blockBase()
  + line('M24,13 L33,23.5 L24,34 L15,23.5Z M24,18.5V28.5 M19.5,23.5H28.5', P.mint, 5, { op: 0.22 })
  + line('M24,13 L33,23.5 L24,34 L15,23.5Z M24,18.5V28.5 M19.5,23.5H28.5', P.mint, 1.8);
const plainBlock = () => rect(1.3, 1.3, 45.4, 45.4, P.stone, { rx: 6, stroke: P.outline })
  + rect(3, 40, 42, 5, P.stoneDark, { rx: 2.5 }) + line('M5.5,4.4H30', P.stoneHi, 1.6)
  + line('M3,24H45 M24,3V24 M14,24V45 M34,24V45', P.stoneMortar, 1.8, { cap: 'butt' });

/* ================================================================== */
/* Back-layer details                                                   */
/* ================================================================== */

function lattice(clipId) {
  let l = '';
  for (let i = -48; i <= 96; i += 12) l += `M${i},-2 L${i + 52},50 M${i},-2 L${i - 52},50 `;
  return group(line(l, P.glassDeep, 1.3), { clip: clipId });
}
function windowPiece(kind) {
  const id = uid('g');
  let frame, glass;
  if (kind === 't') {
    frame = 'M5,52 V25 Q5,4 24,1.5 Q43,4 43,25 V52Z';
    glass = 'M12,52 V26 Q12,11 24,8.5 Q36,11 36,26 V52Z';
  } else if (kind === 'm') {
    frame = 'M5,-4 H43 V52 H5Z'; glass = 'M12,-4 H36 V52 H12Z';
  } else {
    frame = 'M5,-4 H43 V40 H5Z'; glass = 'M12,-4 H36 V33 H12Z';
  }
  let s = shape(frame, P.wallHi, { sw: 2.2, stroke: P.wallMortar });
  s += clipDef(id, `<path d="${glass}"/>`);
  s += group(rect(0, -4, 48, 60, P.glass) + fillPath('M12,-4 H24 L14,52 H12Z', P.glassLight, { op: 0.55 })
    + fillPath('M28,-4 H33 L25,52 H20Z', P.glassLight, { op: 0.3 }), { clip: id });
  s += lattice(id);
  s += `<path d="${glass}" fill="none" stroke="${P.wallMortar}" stroke-width="2"/>`;
  if (kind === 'm') s += rect(11, 21.5, 26, 3.4, P.wallHi, { stroke: P.wallMortar, sw: 1.4 });
  if (kind === 'b') s += rect(2, 36, 44, 8, P.wallHi, { rx: 2.5, stroke: P.wallMortar, sw: 2.2 }) + line('M5,38.6H30', P.stoneHi, 1.2, { op: 0.6 });
  return s;
}

function banner(kind) {
  let s = '';
  const cloth = (d) => shape(d, P.magenta, { sw: 2.2 });
  if (kind === 't') {
    s += cloth('M10,7 H38 V52 H10Z');
    s += rect(10, 7, 28, 5, P.magentaDark, { op: 0.7 });
    s += rect(3, 3.5, 42, 5, P.gold, { rx: 2.5, stroke: P.outline, sw: 2 }) + circle(4.5, 6, 3.2, P.gold, { stroke: P.outline, sw: 2 }) + circle(43.5, 6, 3.2, P.gold, { stroke: P.outline, sw: 2 });
  } else if (kind === 'm') {
    s += cloth('M10,-4 H38 V52 H10Z');
    s += fillPath('M26.5,14 A9,9 0 1 0 32,28 A7.4,7.4 0 1 1 26.5,14Z', P.gold);
    s += fillPath('M29,31 l1,2.2 2.2,1 -2.2,1 -1,2.2 -1,-2.2 -2.2,-1 2.2,-1Z', P.goldHi);
  } else {
    s += cloth('M10,-4 H38 V38 L24,24 L10,38Z');
    s += line('M13.8,30.5 L24,20 L34.2,30.5', P.gold, 2.2);
  }
  const y1 = kind === 'b' ? 27 : 52, y0 = kind === 't' ? 12 : -4;
  s += line(`M13.8,${y0}V${y1} M34.2,${y0}V${y1}`, P.gold, 2.2, { cap: 'butt' });
  s += line(`M17.5,${y0 + 1}V${kind === 'b' ? 18 : y1}`, P.magentaHi, 1.3, { op: 0.6, dash: '14 6' });
  s += rect(29, y0, 4, (kind === 'b' ? 22 : y1) - y0, P.magentaDark, { op: 0.45 });
  return s;
}

function chain(end) {
  let s = '';
  const face = (y) => ellipse(24, y, 3.6, 5.6, 'none', { stroke: P.outline, sw: 4.4 }) + ellipse(24, y, 3.6, 5.6, 'none', { stroke: P.iron, sw: 2 })
    + line(`M21.2,${y - 3} Q20.6,${y} 21.2,${y + 2}`, P.ironHi, 1);
  const side = (y) => line(`M24,${y - 4.2}V${y + 4.2}`, P.outline, 4.6) + line(`M24,${y - 4.2}V${y + 4.2}`, P.ironDark, 2.2);
  const last = end ? 24 : 48;
  for (let y = 6; y <= last + 6; y += 12) s += side(y - 6 + 0) ;
  for (let y = 6; y <= last; y += 12) s += face(y);
  s = '';
  for (let y = 0; y <= last; y += 12) { s += side(y); if (y + 6 <= last) s += face(y + 6); }
  if (end) {
    s += circle(24, 33, 6.5, 'none', { stroke: P.outline, sw: 5 }) + circle(24, 33, 6.5, 'none', { stroke: P.iron, sw: 2.4 })
      + line('M19.5,29.5 Q18,33 19.6,36', P.ironHi, 1);
  }
  return s;
}

function cobweb() { // top-left corner
  let s = '';
  const rays = [[46, 2], [42, 16], [32, 30], [17, 41], [2, 46]];
  s += line(rays.map(([x, y]) => `M0,0L${x},${y}`).join(' '), P.white, 1.1, { op: 0.75 });
  for (const f of [0.3, 0.55, 0.8, 1]) {
    let d = '';
    for (let i = 0; i < rays.length - 1; i++) {
      const a = rays[i], b = rays[i + 1];
      const mx = (a[0] + b[0]) / 2 * f * 0.82, my = (a[1] + b[1]) / 2 * f * 0.82;
      d += `M${n(a[0] * f)},${n(a[1] * f)} Q${n(mx)},${n(my)} ${n(b[0] * f)},${n(b[1] * f)} `;
    }
    s += line(d, P.white, 1, { op: 0.6 });
  }
  return s;
}

/* ================================================================== */
/* Front-layer details                                                  */
/* ================================================================== */

function blade(x, h, lean, col, w = 3.4) {
  const tipX = x + lean, tipY = 48 - h;
  return shape(`M${x - w},49 Q${x - w + lean * 0.2},${48 - h * 0.5} ${tipX},${tipY} Q${x + w * 0.6 + lean * 0.5},${48 - h * 0.45} ${x + w},49Z`, col, { sw: 1.8 });
}
const tuftA = () => blade(8, 12, -4, P.mossDark) + blade(15, 20, 3, P.moss) + blade(22, 14, -2, P.mossDark) + blade(29, 24, 5, P.moss)
  + blade(35, 13, -3, P.mossDark) + blade(41, 17, 4, P.moss) + line('M15.5,44 Q16,36 17.5,31 M29.6,44 Q30.5,34 33,27', P.mossHi, 1.1, { op: 0.9 });
const tuftB = () => blade(6, 15, 3, P.moss) + blade(13, 10, -3, P.mossDark) + blade(34, 18, -4, P.moss) + blade(42, 11, 3, P.mossDark)
  + line('M24,49 Q23,36 25,27', P.mossDeep, 2.2)
  + [0, 72, 144, 216, 288].map((a) => ellipse(25, 22, 2.6, 4, P.magentaHi, { stroke: P.outline, sw: 1.4, tf: `rotate(${a} 25 26)` })).join('')
  + circle(25, 26, 2.4, P.gold, { stroke: P.outline, sw: 1.3 });

function leaf(x, y, a, col, sc = 1) {
  return shape('M0,0 Q5,-4.5 9.5,0 Q5,4.5 0,0Z', col, { sw: 1.5, tf: `translate(${x} ${y}) rotate(${a}) scale(${sc})` });
}
function ivy(end) {
  const stems = end
    ? ['M10,-4 Q6,10 11,22 T9,38', 'M26,-4 Q30,8 25,18 T27,30', 'M40,-4 Q36,6 39,14 T38,22']
    : ['M10,-4 Q5,12 11,24 T10,52', 'M26,-4 Q31,12 25,26 T26,52', 'M40,-4 Q35,10 40,24 T40,52'];
  let s = stems.map((d) => line(d, P.outline, 3.6) + line(d, P.mossDeep, 1.8)).join('');
  const L = end
    ? [[10, 4, 200], [9, 14, -20], [11, 24, 160], [9, 34, 30], [9.5, 39, 90], [27, 2, -30], [27, 12, 190], [25, 22, 10], [27, 31, 80], [39, 3, 210], [38, 12, 0], [38.5, 22, 95]]
    : [[10, 2, 200], [8, 11, -20], [10, 21, 160], [11, 31, -10], [10, 41, 190], [27, 4, -30], [28, 14, 190], [25, 24, 10], [26, 35, 170], [26, 45, 0], [39, 3, 210], [37, 13, 0], [40, 23, 200], [40, 34, -10], [40, 44, 170]];
  L.forEach(([x, y, a], i) => { s += leaf(x, y, a, i % 3 === 0 ? P.moss : i % 3 === 1 ? P.mossDark : P.mossDeep, 1.05); });
  if (end) s += circle(9.5, 43, 1.8, P.magentaHi, { stroke: P.outline, sw: 1.2 }) + circle(38.5, 27, 1.6, P.magentaHi, { stroke: P.outline, sw: 1.2 });
  return s;
}
const rimBottom = () => fillPath(smooth([[-12, 40], [-6, 33], [0, 36], [7, 30], [13, 37], [20, 34], [27, 28], [33, 36], [40, 32], [48, 36], [54, 30], [60, 37]], false) + 'L60,52 L-12,52Z', P.near)
  + line(smooth([[1, 37.5], [7, 32], [12, 37]], false) + smooth([[22, 34], [27, 30], [31, 35]], false), P.wall, 1.4, { op: 0.9 });
const rimTop = () => fillPath(poly([[-2, -4], [50, -4], [50, 6], [48, 5], [45, 9], [41, 24], [37, 8], [32, 5], [28, 11], [25, 17], [21, 7], [16, 5], [12, 12], [8, 30], [4, 9], [0, 5], [-2, 6]]), P.near)
  + line('M7,10 L8,24 M40,10 L41,19', P.wall, 1.3, { op: 0.9 });

/* ================================================================== */
/* Sheet assembly                                                       */
/* ================================================================== */

export function buildTileDefs() {
  const tiles = [];
  const add = (name, collision, group_, svg) => { tiles.push({ id: tiles.length + 1, name, collision, group: group_, svg }); return tiles.length; };
  const pad = () => { while (tiles.length % COLUMNS) add(`unused-${tiles.length + 1}`, 'none', 'unused', ''); };

  // row 0: castle-stone masks 0..15
  const stone = []; for (let m = 0; m < 16; m++) stone.push(add(`castle-stone-${m}`, 'solid', 'stone', stoneTile(m)));
  // row 1: castle-wall masks 0..15
  const wall = []; for (let m = 0; m < 16; m++) wall.push(add(`castle-wall-${m}`, 'none', 'wall', wallTile(m)));
  // row 2: fill variants, platforms, hazards
  const stoneFill = [
    add('castle-stone-fill-crack', 'solid', 'stone', stoneTile(15, 1)),
    add('castle-stone-fill-skull', 'solid', 'stone', stoneTile(15, 2)),
    add('castle-stone-fill-rune', 'solid', 'stone', stoneTile(15, 3)),
  ];
  const wallFill = [
    add('castle-wall-fill-crack', 'none', 'wall', wallTile(15, 1)),
    add('castle-wall-fill-drain', 'none', 'wall', wallTile(15, 2)),
    add('castle-wall-fill-holes', 'none', 'wall', wallTile(15, 3)),
  ];
  add('plank-left', 'oneway', 'platforms', plank('l'));
  add('plank-middle', 'oneway', 'platforms', plank('m'));
  add('plank-right', 'oneway', 'platforms', plank('r'));
  add('ledge-left', 'oneway', 'platforms', ledge('l'));
  add('ledge-middle', 'oneway', 'platforms', ledge('m'));
  add('ledge-right', 'oneway', 'platforms', ledge('r'));
  add('spikes-floor', 'hazard', 'hazards', spikes());
  add('spikes-ceiling', 'hazard', 'hazards', group(spikes(), { tf: 'translate(0 48) scale(1 -1)' }));
  add('brambles', 'hazard', 'hazards', brambles());
  add('spikes-wall-left', 'hazard', 'hazards', group(spikes(), { tf: 'rotate(90 24 24)' }));
  pad();
  // row 3: solid ornaments + back details
  add('pillar-top', 'solid', 'ornaments', pillarTop());
  add('pillar-middle', 'solid', 'ornaments', pillarMid());
  add('pillar-base', 'solid', 'ornaments', pillarBase());
  add('block-moon', 'solid', 'ornaments', carvedMoon());
  add('block-rune', 'solid', 'ornaments', carvedRune());
  add('block-plain', 'solid', 'ornaments', plainBlock());
  add('window-top', 'none', 'back-details', windowPiece('t'));
  add('window-middle', 'none', 'back-details', windowPiece('m'));
  add('window-bottom', 'none', 'back-details', windowPiece('b'));
  add('banner-top', 'none', 'back-details', banner('t'));
  add('banner-middle', 'none', 'back-details', banner('m'));
  add('banner-bottom', 'none', 'back-details', banner('b'));
  add('chain', 'none', 'back-details', chain(false));
  add('chain-end', 'none', 'back-details', chain(true));
  add('cobweb-left', 'none', 'back-details', cobweb());
  add('cobweb-right', 'none', 'back-details', group(cobweb(), { tf: 'translate(48 0) scale(-1 1)' }));
  // row 4: front details
  add('grass-tuft', 'none', 'front-details', tuftA());
  add('grass-flower', 'none', 'front-details', tuftB());
  add('ivy-hanging', 'none', 'front-details', ivy(false));
  add('ivy-end', 'none', 'front-details', ivy(true));
  add('rim-bottom', 'none', 'front-details', rimBottom());
  add('rim-top', 'none', 'front-details', rimTop());
  pad();

  const terrains = [
    { name: 'castle-stone', layer: 'main', tiles: stone, fillVariants: stoneFill },
    { name: 'castle-wall', layer: 'back', tiles: wall, fillVariants: wallFill },
  ];
  return { tiles, terrains };
}

export function tileSheetSvg(tiles) {
  const rows = Math.ceil(tiles.length / COLUMNS);
  let body = '';
  tiles.forEach((t, i) => {
    if (!t.svg) return;
    const x = (i % COLUMNS) * T, y = Math.floor(i / COLUMNS) * T;
    body += `<svg x="${x}" y="${y}" width="${T}" height="${T}" viewBox="0 0 ${T} ${T}" overflow="hidden">${t.svg}</svg>`;
  });
  return svgDoc(COLUMNS * T, rows * T, body);
}

export async function buildTileset() {
  const { tiles, terrains } = buildTileDefs();
  await writePng(tileSheetSvg(tiles), 'public/assets/tiles/tileset.png');
  writeJson('content/tileset.json', {
    version: 1,
    image: 'assets/tiles/tileset.png',
    tileSize: T,
    imageScale: IMAGE_SCALE,
    columns: COLUMNS,
    tiles: tiles.filter((t) => t.svg).map(({ id, name, collision, group: g }) => ({ id, name, collision, group: g })),
    terrains,
  });
  return { tiles, terrains };
}
