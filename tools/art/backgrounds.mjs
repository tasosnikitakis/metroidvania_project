// PARALLAX BACKGROUNDS - every layer tiles seamlessly in X (anything crossing the edge is drawn wrapped).
// All layers are bottom/top anchored with offsetY 0 and filled solid down to their anchored edge.
import { P } from './palette.mjs';
import { n, uid, rng, svgDoc, writePng, writeJson, poly, smooth, fillPath, line, rect, circle, ellipse, group, radialGlow, linGrad, IMAGE_SCALE } from './lib.mjs';

/** Repeat `body` at -W and +W so shapes crossing the edges wrap. */
const wrap = (body, W) => group(body, { tf: `translate(${-W} 0)` }) + body + group(body, { tf: `translate(${W} 0)` });
const win = (x, y, w, h, col = P.window) => `<path d="M${n(x)},${n(y + h)} V${n(y + w / 2)} Q${n(x)},${n(y)} ${n(x + w / 2)},${n(y)} Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + w / 2)} V${n(y + h)}Z" fill="${col}"/>`;

/** A crooked tower silhouette standing on baseY. */
function tower(x, baseY, w, h, { lean = 0, roof = 0.9, col, rnd, windows = 3, winCol = P.window, crenel = false, glow = true }) {
  let s = '';
  const top = baseY - h;
  s += rect(x - w / 2, top, w, h + 4, col);
  if (crenel) {
    for (let i = 0; i < 4; i++) s += rect(x - w / 2 - 3 + (i * (w + 6)) / 3.5, top - 7, (w + 6) / 7, 9, col);
    s += rect(x - w / 2 - 3, top - 1, w + 6, 7, col);
  } else {
    const rh = w * roof * 1.5;
    s += fillPath(`M${x - w / 2 - 5},${top + 2} Q${x - w * 0.2},${top - rh * 0.45} ${x + lean * 0.6},${top - rh} Q${x + w * 0.2},${top - rh * 0.45} ${x + w / 2 + 5},${top + 2}Z`, col);
    s += line(`M${x + lean * 0.6},${top - rh + 2}v-9`, col, 1.6) + fillPath(`M${x + lean * 0.6},${top - rh - 7} l8,2.5 -8,2.5Z`, col);
  }
  for (let i = 0; i < windows; i++) {
    if (rnd() < 0.3) continue;
    const wy = top + 12 + i * (h / (windows + 0.5)), wx = x - 3 + (rnd() - 0.5) * (w - 14), ww = 5 + rnd() * 2, wh = 9 + rnd() * 5;
    if (glow) s += circle(wx + ww / 2, wy + wh / 2, 13, winCol, { op: 0.06 }) + circle(wx + ww / 2, wy + wh / 2, 8, winCol, { op: 0.08 });
    s += win(wx, wy, ww, wh, winCol);
  }
  return group(s, { tf: `skewX(${-lean}) translate(${n(Math.tan((lean * Math.PI) / 180) * baseY)} 0)` });
}
const hills = (W, H, baseY, amp, k, col, phase = 0) => {
  const pts = [];
  for (let x = -20; x <= W + 20; x += 20) pts.push([x, baseY - amp * (0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * k + phase)) - amp * 0.3 * Math.sin((x / W) * Math.PI * 2 * (k * 2 + 1) + phase * 2)]);
  return fillPath(smooth(pts, false) + `L${W + 20},${H + 2} L-20,${H + 2}Z`, col);
};

/* ================= castle-exterior-night ================= */
function extSky() {
  const W = 1600, H = 520, rnd = rng(11);
  let s = '';
  for (let i = 0; i < 230; i++) {
    const x = rnd() * W, y = rnd() * rnd() * H, r = 0.5 + rnd() * rnd() * 1.6, a = 0.35 + rnd() * 0.6;
    s += r > 1.5 ? fillPath('M0,-4 L0.9,-0.9 4,0 0.9,0.9 0,4 -0.9,0.9 -4,0 -0.9,-0.9Z', P.white, { op: n(a), tf: `translate(${n(x)} ${n(y)}) scale(${n(r * 0.7)})` }) : circle(x, y, r, rnd() < 0.2 ? P.goldHi : P.white, { op: n(a) });
  }
  const g = uid('m');
  // the moon: big, warm, with a soft halo and friendly craters
  const mx = 1130, my = 170, R = 78;
  let moon = radialGlow(g, P.moon, [[0, 0.5], [0.42, 0.22], [1, 0]]) + `<circle cx="${mx}" cy="${my}" r="${R * 3}" fill="url(#${g})"/>`;
  moon += circle(mx, my, R, P.moon) + fillPath(`M${mx + 12},${my - R + 2} A${R},${R} 0 0 1 ${mx + 12},${my + R - 2} A${R * 1.25},${R * 1.25} 0 0 0 ${mx + 12},${my - R + 2}Z`, P.moonShade, { op: 0.55 });
  for (const [dx, dy, r] of [[-30, -22, 13], [12, 24, 17], [-18, 36, 7], [30, -34, 8], [-46, 10, 5]]) moon += circle(mx + dx, my + dy, r, P.moonShade, { op: 0.6 }) + circle(mx + dx - 1.5, my + dy - 1.5, r * 0.78, P.moon, { op: 0.5 });
  s += moon;
  // long thin clouds
  const cloud = (x, y, w, op) => ellipse(x, y, w, 9, P.horizon, { op }) + ellipse(x + w * 0.4, y + 7, w * 0.7, 7, P.horizon, { op }) + ellipse(x - w * 0.5, y + 5, w * 0.5, 6, P.horizon, { op });
  s += cloud(260, 210, 190, 0.22) + cloud(820, 320, 240, 0.2) + cloud(1380, 260, 170, 0.2) + cloud(1040, 205, 120, 0.28) + cloud(540, 420, 260, 0.16);
  // a few bats
  const bat = (x, y, sc) => fillPath('M0,0 Q-4,-6 -10,-4 Q-8,-1 -9,3 Q-5,0 -3,3 L0,1.5 L3,3 Q5,0 9,3 Q8,-1 10,-4 Q4,-6 0,0Z', P.far3, { tf: `translate(${x} ${y}) scale(${sc})` });
  s += bat(980, 120, 1.2) + bat(1010, 142, 0.8) + bat(420, 150, 1) + bat(1290, 300, 0.9);
  return { W, H, svg: wrap(s, W) };
}
function extFar() {
  const W = 1280, H = 430, TOP = 110, rnd = rng(5), col = P.far1; // art is drawn 430 high then shifted down by TOP
  let s = hills(W, H, 330, 46, 2, col, 1);
  // the great castle on its hill
  const cx = 520;
  s += fillPath(`M${cx - 330},${H} Q${cx - 200},250 ${cx - 60},236 L${cx + 120},236 Q${cx + 260},260 ${cx + 380},${H}Z`, col);
  s += rect(cx - 110, 170, 250, 80, col);
  for (let i = 0; i < 12; i++) s += rect(cx - 112 + i * 21.5, 162, 11, 10, col);
  const T = [[-120, 250, 44, 150, 2], [-58, 250, 36, 200, -2], [10, 250, 56, 270, 1], [84, 250, 34, 190, 3], [142, 250, 46, 140, -3], [-170, 262, 26, 90, -4], [196, 264, 28, 80, 4]];
  for (const [dx, by, w, h, lean] of T) s += tower(cx + dx, by, w, h, { lean, col, rnd, windows: Math.round(h / 45) });
  for (let i = 0; i < 9; i++) s += win(cx - 96 + i * 26 + rnd() * 6, 196 + rnd() * 24, 5, 10) ;
  s += win(cx + 2, 206, 16, 40, P.far3); // gate
  // little outlying towers
  s += tower(1010, 318, 30, 90, { lean: -3, col, rnd, windows: 2 }) + tower(1060, 322, 22, 60, { lean: 4, col, rnd, windows: 1 }) + tower(110, 312, 26, 70, { lean: 3, col, rnd, windows: 2 });
  const g = uid('f');
  s += linGrad(g, [[0, P.horizon, 0], [1, P.horizon, 0.55]]) + `<rect x="-10" y="${H - 190}" width="${W + 20}" height="190" fill="url(#${g})"/>`;
  return { W, H: H + TOP, svg: wrap(group(s, { tf: `translate(0 ${TOP})` }), W) };
}
function extMid() {
  const W = 1400, H = 400, rnd = rng(23), col = P.far2;
  let s = hills(W, H, 330, 36, 3, col, 2.2);
  const T = [[90, 340, 54, 190, 5, true], [170, 344, 38, 120, -4, false], [430, 336, 46, 240, -6, false], [500, 340, 60, 150, 2, true], [585, 346, 34, 100, 6, false],
    [840, 338, 50, 210, 4, false], [905, 344, 40, 130, -5, true], [1150, 336, 58, 170, -3, true], [1225, 342, 36, 250, 5, false], [1295, 346, 30, 110, -6, false]];
  for (const [x, by, w, h, lean, cr] of T) s += tower(x, by, w, h, { lean, col, rnd, windows: Math.round(h / 50), crenel: cr });
  // crooked bridges between some towers
  const bridge = (x0, x1, y) => fillPath(`M${x0},${y} Q${(x0 + x1) / 2},${y + 10} ${x1},${y + 4} V${y + 14} Q${(x0 + x1) / 2},${y + 20} ${x0},${y + 10}Z`, col)
    + fillPath(`M${x0 + 12},${y + 60} Q${(x0 + x1) / 2},${y - 6} ${x1 - 12},${y + 60} V${y + 12} H${x0 + 12}Z`, col, { op: 0.0 });
  s += bridge(455, 480, 200) + bridge(865, 890, 250) + bridge(1175, 1212, 230);
  const g = uid('f');
  s += linGrad(g, [[0, P.fog, 0], [1, P.fog, 0.3]]) + `<rect x="-10" y="${H - 150}" width="${W + 20}" height="150" fill="url(#${g})"/>`;
  return { W, H, svg: wrap(s, W) };
}
function extFog() {
  const W = 1024, H = 260, rnd = rng(3);
  const g = uid('g');
  let s = linGrad(g, [[0, P.fog, 0], [0.6, P.fog, 0.35], [1, P.fog, 0.6]]) + `<rect x="-10" y="60" width="${W + 20}" height="${H - 60}" fill="url(#${g})"/>`;
  for (let i = 0; i < 9; i++) { const x = rnd() * W, y = 60 + rnd() * 120, w = 120 + rnd() * 160; s += ellipse(x, y, w, 14 + rnd() * 10, P.fog, { op: 0.16 }); }
  return { W, H, svg: wrap(s, W) };
}
function extNear() {
  const W = 1500, H = 260, col = P.near, rnd = rng(77);
  let s = hills(W, H, 226, 22, 4, col, 0.6);
  const tree = (x, by, sc, flip) => group(
    line('M0,0 Q-4,-40 2,-74 Q4,-92 -4,-112 M1,-66 Q-18,-80 -26,-104 Q-28,-112 -38,-116 M-22,-96 Q-30,-96 -38,-102 M2,-84 Q20,-96 26,-118 Q27,-126 36,-130 M24,-112 Q32,-110 40,-114 M-3,-108 Q-8,-124 -2,-140 M-4,-124 Q4,-130 6,-140', col, 9)
    + line('M-26,-104 Q-28,-112 -38,-116 M-22,-96 Q-30,-96 -38,-102 M26,-118 Q27,-126 36,-130 M24,-112 Q32,-110 40,-114 M-3,-118 Q-8,-128 -2,-142 M-4,-124 Q4,-130 6,-140 M-38,-116 l-8,-6 M36,-130 l8,-8 M-2,-142 l-2,-10', col, 3.2)
    + fillPath('M-12,2 Q-2,-10 -3,-30 H7 Q6,-10 14,2Z', col), { tf: `translate(${x} ${by}) scale(${flip ? -sc : sc} ${sc})` });
  s += tree(180, 214, 1.25, false) + tree(700, 220, 0.95, true) + tree(1190, 212, 1.4, true);
  const stone = (x, by, w, h, tilt) => group(`<path d="M${-w / 2},0 V${-h + w / 2} Q${-w / 2},${-h} 0,${-h} Q${w / 2},${-h} ${w / 2},${-h + w / 2} V0Z" fill="${col}"/>`, { tf: `translate(${x} ${by}) rotate(${tilt})` });
  const cross = (x, by, sc, tilt) => group(rect(-3.5, -40, 7, 42, col) + rect(-13, -30, 26, 7, col), { tf: `translate(${x} ${by}) rotate(${tilt}) scale(${sc})` });
  for (let i = 0; i < 16; i++) {
    const x = 40 + i * 92 + rnd() * 40, by = 222 + Math.sin((x / W) * Math.PI * 8 + 0.6) * -8 + 6;
    s += rnd() < 0.4 ? cross(x, by, 0.8 + rnd() * 0.5, (rnd() - 0.5) * 16) : stone(x, by, 16 + rnd() * 10, 24 + rnd() * 16, (rnd() - 0.5) * 14);
  }
  // fence
  let f = '';
  for (let x = 420; x < 640; x += 14) f += `M${x},230 V${196 + ((x / 14) % 2) * 4} `;
  s += line(f, col, 3) + line('M414,206 H646 M414,220 H646', col, 2.6) ;
  for (let x = 420; x < 640; x += 14) s += fillPath(`M${x - 3},${197 + ((x / 14) % 2) * 4} l3,-8 3,8Z`, col);
  // grass blades along the top edge
  let gr = '';
  for (let i = 0; i < 150; i++) { const x = rnd() * W, y = 218 + Math.sin((x / W) * Math.PI * 8 + 0.6) * -10; gr += `M${n(x)},${n(y + 10)} q${n((rnd() - 0.5) * 6)},-8 ${n((rnd() - 0.5) * 10)},${n(-12 - rnd() * 8)} `; }
  s += line(gr, col, 2);
  return { W, H, svg: wrap(s, W) };
}

/* ================= castle-interior ================= */
function intFar() { // wall of deep gothic arches
  const W = 1200, H = 760, sp = 240;
  let s = rect(-10, 0, W + 20, H, P.hall1);
  for (let x = sp / 2; x < W; x += sp) {
    s += `<path d="M${x - 78},${H} V330 Q${x - 78},170 ${x},130 Q${x + 78},170 ${x + 78},330 V${H}Z" fill="${P.hall3}"/>`;
    s += `<path d="M${x - 78},${H} V330 Q${x - 78},170 ${x},130 Q${x + 78},170 ${x + 78},330 V${H}" fill="none" stroke="${P.hall2}" stroke-width="9"/>`;
    s += `<path d="M${x - 50},${H} V360 Q${x - 50},250 ${x},222 Q${x + 50},250 ${x + 50},360 V${H}Z" fill="${P.hallTop}" opacity="0.7"/>`;
    s += circle(x, 78, 26, P.hall3) + `<circle cx="${x}" cy="78" r="26" fill="none" stroke="${P.hall2}" stroke-width="6"/>`;
  }
  for (let x = 0; x <= W; x += sp) s += rect(x - 16, 0, 32, H, P.hall2, { op: 0.75 }) + rect(x - 24, 300, 48, 16, P.hall2) + rect(x - 16, 0, 7, H, P.wallLight, { op: 0.12 });
  let bl = '';
  for (let y = 40; y < H; y += 46) bl += `M-10,${y}H${W + 10} `;
  s += line(bl, P.hallTop, 2, { op: 0.35, cap: 'butt' });
  return { W, H, svg: wrap(s, W) };
}
function intWindows() { // tall glowing windows and their light shafts
  const W = 960, H = 680, sp = 480;
  let s = '';
  for (let x = sp / 2; x < W; x += sp) {
    const g = uid('s'), wg = uid('w');
    s += linGrad(g, [[0, '#9fd0ff', 0.26], [1, '#9fd0ff', 0]]);
    s += `<path d="M${x - 36},150 L${x + 36},150 L${x + 250},${H} L${x + 40},${H}Z" fill="url(#${g})"/>`;
    s += `<path d="M${x - 16},180 L${x + 12},180 L${x + 150},${H} L${x + 90},${H}Z" fill="url(#${g})"/>`;
    const frame = `M${x - 50},430 V190 Q${x - 50},90 ${x},66 Q${x + 50},90 ${x + 50},190 V430Z`;
    const glass = `M${x - 38},420 V192 Q${x - 38},106 ${x},84 Q${x + 38},106 ${x + 38},192 V420Z`;
    s += fillPath(frame, P.hall2) + linGrad(wg, [[0, '#b9dcff'], [1, P.glass]]) + `<path d="${glass}" fill="url(#${wg})" opacity="0.9"/>`;
    let l = `M${x},84V420 M${x - 19},100V420 M${x + 19},100V420 `;
    for (let y = 150; y < 420; y += 54) l += `M${x - 38},${y}H${x + 38} `;
    s += line(l, P.hall2, 5, { cap: 'butt' }) + circle(x, 140, 15, P.hall2) + circle(x, 140, 9, P.moon, { op: 0.9 });
    s += rect(x - 60, 428, 120, 14, P.hall2, { rx: 3 });
    s += circle(x, 250, 150, '#9fd0ff', { op: 0.05 });
  }
  return { W, H, svg: wrap(s, W) };
}
function intPillars() {
  const W = 800, H = 760, col = P.hall3;
  let s = '';
  for (const x of [160, 560]) {
    s += rect(x - 34, 0, 68, H, col) + rect(x - 34, 0, 9, H, P.hall2, { op: 0.6 });
    s += line(`M${x - 12},60V${H - 70} M${x + 8},60V${H - 70}`, P.hallTop, 4, { op: 0.6, cap: 'butt' });
    s += fillPath(`M${x - 60},0 H${x + 60} V34 L${x + 40},64 H${x - 40} L${x - 60},34Z`, col) + rect(x - 60, 26, 120, 8, P.hall2, { op: 0.6 });
    s += fillPath(`M${x - 40},${H - 70} H${x + 40} L${x + 58},${H - 34} V${H} H${x - 58} V${H - 34}Z`, col) + rect(x - 58, H - 38, 116, 7, P.hall2, { op: 0.6 });
  }
  // a hanging banner between them
  s += fillPath('M330,0 H390 V170 L360,144 L330,170Z', P.magentaDark, { op: 0.55 }) + line('M338,0V150 M382,0V150', P.goldDark, 3, { op: 0.5, cap: 'butt' });
  return { W, H, svg: wrap(s, W) };
}
function intNearTop() { // chains and torn drapes hanging in the foreground
  const W = 1100, H = 220, col = P.hallTop, rnd = rng(9);
  let s = rect(-10, 0, W + 20, 16, col);
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 122 + rnd() * 50, L = 60 + rnd() * 120;
    if (i % 3 === 1) s += fillPath(`M${x - 40},0 H${x + 40} Q${x + 30},${L * 0.5} ${x + 34},${L} L${x + 18},${L - 18} L${x + 4},${L + 6} L${x - 12},${L - 22} L${x - 30},${L - 4} Q${x - 28},${L * 0.5} ${x - 40},0Z`, col);
    else s += line(`M${x},0V${L}`, col, 4, { dash: '7 3', cap: 'butt' }) + `<circle cx="${n(x)}" cy="${n(L + 8)}" r="8" fill="none" stroke="${col}" stroke-width="4"/>`;
  }
  return { W, H, svg: wrap(s, W) };
}

/* ================= catalog ================= */
const L = (file, f, scrollX, scrollY, anchorY, extra = {}) => ({ file, f, scrollX, scrollY, anchorY, ...extra });
const THEMES = [
  {
    key: 'castle-exterior-night', name: 'Castle exterior (night)', skyTop: P.skyTop, skyBottom: P.skyBottom, ambient: '#c2c0f0', fog: { color: P.fog, alpha: 0.1 },
    layers: [
      L('ext-sky', extSky, 0.02, 0.02, 'top'),
      L('ext-far', extFar, 0.08, 0.04, 'bottom'),
      L('ext-mid', extMid, 0.2, 0.1, 'bottom'),
      L('ext-fog', extFog, 0.32, 0.14, 'bottom', { alpha: 0.8 }),
      L('ext-near', extNear, 0.55, 0.3, 'bottom'),
    ],
  },
  {
    key: 'castle-interior', name: 'Castle interior (great hall)', skyTop: P.hallTop, skyBottom: P.hallBottom, ambient: '#cdbfe6', fog: { color: '#4a3a8a', alpha: 0.1 },
    layers: [
      L('int-far', intFar, 0.06, 0.03, 'bottom'),
      L('int-windows', intWindows, 0.14, 0.06, 'bottom'),
      L('int-pillars', intPillars, 0.34, 0.12, 'bottom'),
      L('int-near-top', intNearTop, 0.62, 0.3, 'top'),
    ],
  },
];

export async function buildBackgrounds() {
  const backgrounds = [];
  for (const t of THEMES) {
    const layers = [];
    for (const l of t.layers) {
      const { W, H, svg } = l.f();
      await writePng(svgDoc(W, H, svg), `public/assets/bg/${l.file}.png`);
      const layer = { image: `assets/bg/${l.file}.png`, w: W, h: H, imageScale: IMAGE_SCALE, scrollX: l.scrollX, scrollY: l.scrollY, repeatX: true, anchorY: l.anchorY, offsetY: 0 };
      if (l.alpha !== undefined) layer.alpha = l.alpha;
      layers.push(layer);
    }
    backgrounds.push({ key: t.key, name: t.name, skyTop: t.skyTop, skyBottom: t.skyBottom, layers, ambient: t.ambient, fog: t.fog });
  }
  writeJson('content/backgrounds.json', { version: 1, backgrounds });
}
