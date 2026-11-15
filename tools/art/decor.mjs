// DECOR GENERATOR - free-placed props. Each prop is drawn in its own w x h box (logical px).
// Add a prop: write a draw function, add an entry to DECOR, run `npm run art`.
// `glow` offsets are measured from the anchor (origin) point, in logical px.
import { P } from './palette.mjs';
import { n, uid, rng, svgDoc, writePng, writeJson, poly, smooth, shape, fillPath, line, rect, circle, ellipse, group, clipDef, radialGlow, linGrad, IMAGE_SCALE } from './lib.mjs';

const O = 2.5; // outline

/* ---------- shared bits ---------- */
const flame = (x, y, s = 1) => group(
  shape('M0,0 Q-6,-5 -3.5,-11 Q-2,-14 0,-19 Q2.5,-13.5 4,-10.5 Q6,-5 0,0Z', P.flame, { sw: 2 })
  + fillPath('M0,-1.5 Q-3,-5 -1,-9 Q0,-11 0.3,-12.5 Q2.6,-8 2.6,-5.6 Q2.6,-3 0,-1.5Z', P.flameCore), { tf: `translate(${x} ${y}) scale(${s})` });
const candle = (x, y, h, w = 6) => rect(x - w / 2, y - h, w, h, P.bone, { rx: 1.5, stroke: P.outline, sw: 2 })
  + rect(x + w / 2 - 2.4, y - h + 1, 1.6, h - 2, P.boneShade) + flame(x, y - h - 0.5, 0.62);
const softGlow = (cx, cy, r, color, a = 0.5) => { const id = uid('gl'); return radialGlow(id, color, [[0, a], [1, 0]]) + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`; };
const moonGlass = (id, x, y, w, h) => linGrad(id, [[0, '#9fd0ff'], [0.55, P.glassLight], [1, P.glass]]) + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
function stoneColumn(x, y0, y1, w) { // fluted shaft
  let s = rect(x - w / 2, y0, w, y1 - y0, P.stoneLight, { stroke: P.outline, sw: O });
  s += rect(x + w / 2 - w * 0.28, y0 + 1.2, w * 0.28 - 1.2, y1 - y0 - 2.4, P.stone);
  for (const f of [-0.22, 0, 0.22]) s += line(`M${n(x + w * f)},${y0 + 2}V${y1 - 2}`, P.stoneDark, 1.8, { cap: 'butt' });
  s += line(`M${n(x - w / 2 + 3.6)},${y0 + 3}V${y1 - 3}`, P.stoneHi, 1.6);
  return s;
}
const slab = (x, y, w, h, fill = P.stoneLight) => rect(x - w / 2, y, w, h, fill, { rx: 3, stroke: P.outline, sw: O })
  + line(`M${x - w / 2 + 4},${y + 3}H${x + w / 2 - 10}`, P.stoneHi, 1.4) ;
const leaf = (x, y, a, col, sc = 1) => shape('M0,0 Q5,-4.5 9.5,0 Q5,4.5 0,0Z', col, { sw: 1.5, tf: `translate(${x} ${y}) rotate(${a}) scale(${sc})` });
const chainV = (x, y0, y1) => line(`M${x},${y0}V${y1}`, P.outline, 4.4, { cap: 'butt' }) + line(`M${x},${y0}V${y1}`, P.iron, 2, { dash: '4 2.5', cap: 'butt' });

/* ---------- props ---------- */
const D = {};

D.candelabra = () => {
  let s = line('M20,70V30', P.outline, 7) + line('M20,70V30', P.gold, 3.4);
  s += line('M7,34 Q7,46 20,46 Q33,46 33,34', P.outline, 6.4) + line('M7,34 Q7,46 20,46 Q33,46 33,34', P.gold, 3);
  s += shape('M9,71 Q20,60 31,71Z', P.gold) + line('M14,68.5 Q20,64.5 24,66', P.goldHi, 1.3);
  for (const [x, y] of [[7, 33], [20, 27], [33, 33]]) s += shape(`M${x - 5},${y} H${x + 5} L${x + 3},${y + 4} H${x - 3}Z`, P.gold, { sw: 2 });
  s += circle(20, 46, 3.4, P.goldDark, { stroke: P.outline, sw: 2 });
  return s + candle(7, 33, 10) + candle(20, 27, 13) + candle(33, 33, 10);
};
D.wallTorch = () => shape('M5,22 H19 L16,31 L13.5,45 H10.5 L8,31Z', P.woodDark)
  + rect(3.5, 19, 17, 5.5, P.iron, { rx: 2, stroke: P.outline, sw: 2 }) + line('M6,21H13', P.ironHi, 1.2)
  + flame(12, 19.5, 1.0) ;
D.hangingLantern = () => chainV(14, 0, 62)
  + shape('M7,66 Q14,56 21,66Z', P.iron, { sw: 2 })
  + rect(6, 66, 16, 20, P.flameCore, { rx: 2, stroke: P.outline, sw: O })
  + softGlow(14, 76, 9, P.white, 0.9)
  + line('M11.5,66V86 M16.5,66V86', P.outline, 1.6, { cap: 'butt' })
  + rect(4, 85, 20, 5, P.iron, { rx: 2, stroke: P.outline, sw: 2 }) + rect(4, 63.5, 20, 4.5, P.iron, { rx: 2, stroke: P.outline, sw: 2 })
  + circle(14, 92.5, 2, P.gold, { stroke: P.outline, sw: 1.6 });
D.windowArch = () => {
  const id = uid('w'), g = uid('wg');
  const frame = 'M6,162 V62 Q6,10 48,4 Q90,10 90,62 V162Z', glass = 'M17,154 V63 Q17,22 48,16 Q79,22 79,63 V154Z';
  let s = shape(frame, P.stoneLight, { sw: 3 }) + clipDef(id, `<path d="${glass}"/>`);
  let inner = moonGlass(g, 0, 0, 96, 168);
  inner += circle(60, 50, 15, P.moon, { op: 0.95 }) + circle(66, 46, 13, '#9fd0ff', { op: 0.9 }); // crescent moon in the glass
  for (const [x, y] of [[30, 40], [38, 74], [66, 92], [28, 110]]) inner += fillPath('M0,-3 L0.8,-0.8 3,0 0.8,0.8 0,3 -0.8,0.8 -3,0 -0.8,-0.8Z', P.white, { op: 0.9, tf: `translate(${x} ${y})` });
  inner += fillPath('M17,154 L40,16 L52,16 L30,154Z', P.white, { op: 0.16 });
  let l = '';
  for (let y = 40; y < 160; y += 26) l += `M10,${y}H86 `;
  inner += line(l + 'M48,10V160 M32.5,20V160 M63.5,20V160', P.glassDeep, 2.2, { cap: 'butt' });
  s += group(inner, { clip: id }) + `<path d="${glass}" fill="none" stroke="${P.outline}" stroke-width="2.6"/>`;
  s += line('M11,60 Q12,18 46,9', P.stoneHi, 1.8, { op: 0.8 });
  s += rect(1.5, 153, 93, 12, P.stoneLight, { rx: 3, stroke: P.outline, sw: 3 }) + line('M6,157H70', P.stoneHi, 1.5);
  return s;
};
D.roseWindow = () => {
  const id = uid('r'); const c = 60;
  let s = circle(c, c, 56, P.stoneLight, { stroke: P.outline, sw: 3 }) + circle(c, c, 46, P.glassDeep, { stroke: P.outline, sw: 2.6 });
  const cols = [P.magenta, P.gold, P.glassLight, P.moss, P.scarf, P.glassLight, P.gold, P.magentaHi];
  for (let i = 0; i < 8; i++) {
    s += shape('M0,-13 Q10,-28 0,-44 Q-10,-28 0,-13Z', cols[i], { sw: 2, tf: `translate(${c} ${c}) rotate(${i * 45})` });
    s += circle(c + Math.sin((i + 0.5) * Math.PI / 4) * 37, c - Math.cos((i + 0.5) * Math.PI / 4) * 37, 4.6, cols[(i + 3) % 8], { stroke: P.outline, sw: 1.8 });
    s += line('M-3,-22 Q-5,-30 -1.5,-38', P.white, 1.3, { op: 0.6, tf: `translate(${c} ${c}) rotate(${i * 45})` });
  }
  s += circle(c, c, 11, P.flameCore, { stroke: P.outline, sw: 2.4 }) + circle(c, c, 5, P.gold, { stroke: P.outline, sw: 1.6 });
  s += `<circle cx="${c}" cy="${c}" r="51" fill="none" stroke="${P.stoneHi}" stroke-width="1.6" stroke-dasharray="9 9" opacity="0.7"/>`;
  return s;
};
D.pillar = () => stoneColumn(24, 16, 176, 28)
  + shape('M6,10 H42 L38,20 H10Z', P.stone) + slab(24, 1.5, 45, 10)
  + shape('M10,172 H38 L42,182 H6Z', P.stone) + slab(24, 180.5, 45, 10);
D.brokenColumn = () => stoneColumn(26, 26, 66, 28).replace('', '')
  + shape('M11,28 L15,20 L20,25 L26,15 L31,24 L36,19 L41,28 L41,34 H11Z', P.stoneLight)
  + line('M27,30 L24,40 L28,47', P.stoneMortar, 1.6)
  + shape('M12,62 H40 L44,71 H8Z', P.stone) + slab(26, 69.5, 46, 9)
  + shape('M44,78.5 L46,68 L53,65 L55,72 L54.5,78.5Z', P.stone, { sw: 2 }) + shape('M1.5,78.5 L3,73 L8,72 L9,78.5Z', P.stoneLight, { sw: 2 })
  + leaf(13, 30, 110, P.moss, 1.1) + leaf(12, 30, 60, P.mossDark, 0.9);
D.gargoyle = () => {
  // a round, sleepy-looking gargoyle sitting on a plinth
  let s = slab(32, 58, 54, 12) + rect(9, 66, 46, 3, P.stoneDark, { rx: 1 });
  s += shape('M14,30 Q2,18 6,6 Q14,14 22,22Z', P.stoneDark) + shape('M50,30 Q62,18 58,6 Q50,14 42,22Z', P.stoneDark); // wings
  s += shape(smooth([[32, 22], [46, 28], [50, 44], [46, 58], [18, 58], [14, 44], [18, 28]]), P.stone);
  s += shape('M20,58 Q18,50 24,50 Q29,50 28,58Z', P.stoneLight, { sw: 2 }) + shape('M36,58 Q35,50 40,50 Q46,50 44,58Z', P.stoneLight, { sw: 2 });
  s += shape('M21,12 L18,2 L27,9Z', P.stoneLight, { sw: 2 }) + shape('M43,12 L46,2 L37,9Z', P.stoneLight, { sw: 2 });
  s += shape(smooth([[32, 8], [44, 13], [46, 24], [40, 33], [24, 33], [18, 24], [20, 13]]), P.stoneLight);
  s += line('M24,21 Q27,23.5 30,21 M34,21 Q37,23.5 40,21', P.outline, 1.8); // sleepy eyes
  s += line('M27,27.5 Q32,30.5 37,27.5', P.outline, 1.6) + fillPath('M28.6,28.4 l1.6,2.6 1.2,-2Z', P.bone) + fillPath('M35.4,28.4 l-1.6,2.6 -1.2,-2Z', P.bone);
  s += line('M23,14 Q27,10.5 32,10.5', P.stoneHi, 1.5);
  return s;
};
D.knightArmor = () => {
  let s = slab(24, 86, 40, 8.5);
  s += line('M38,20V86', P.outline, 4.6) + line('M38,20V86', P.woodDark, 2.2) + shape('M38,4 L42.5,16 L38,22 L33.5,16Z', P.ironHi, { sw: 2 }); // spear
  s += shape('M15,62 L14,84 H22 L23,64Z', P.ironDark, { sw: 2.2 }) + shape('M25,64 L26,84 H34 L33,62Z', P.iron, { sw: 2.2 });
  s += rect(12, 82, 11, 5, P.ironDark, { rx: 2, stroke: P.outline, sw: 2 }) + rect(25, 82, 11, 5, P.iron, { rx: 2, stroke: P.outline, sw: 2 });
  s += shape('M12,36 Q24,31 36,36 L34,60 Q24,66 14,60Z', P.iron) + line('M24,35V62', P.ironDark, 1.6) + line('M16,39 Q17,50 17.5,57', P.ironHi, 1.5);
  s += shape('M6,36 Q6,30 13,31 L14,50 Q8,50 7,44Z', P.ironDark, { sw: 2.2 }) + shape('M42,36 Q42,30 35,31 L34,50 Q40,50 41,44Z', P.iron, { sw: 2.2 });
  s += shape('M13,22 Q13,8 24,8 Q35,8 35,22 L35,29 Q24,34 13,29Z', P.iron) + rect(15, 18.5, 18, 4, P.outline, { rx: 2 });
  s += circle(20, 20.5, 1.3, P.mint) + circle(28, 20.5, 1.3, P.mint); // friendly glowing eyes
  s += shape('M24,8 Q25,-1 34,3 Q29,5 28,9Z', P.magenta, { sw: 2 }) + line('M16,14 Q18,10.5 22,10', P.ironHi, 1.5);
  return s;
};
D.tombstoneRound = () => shape('M6,46 V20 Q6,4 20,4 Q34,4 34,20 V46Z', P.stone)
  + fillPath('M27,7.5 Q32.5,11 32.5,20 V44.5 H27Z', P.stoneDark, { op: 0.7 })
  + line('M20,13V27 M14.5,18H25.5', P.stoneMortar, 2.6) + line('M12,33H28 M14,38H26', P.stoneMortar, 1.6)
  + line('M10,22 Q10,9 19,7.5', P.stoneHi, 1.5)
  + shape('M1.5,47 Q4,40 9,44 Q13,39 18,44.5 Q24,40 29,44 Q35,39.5 38.5,47Z', P.moss, { sw: 2 });
D.tombstoneCross = () => shape('M13,54 V24 H5 V14 H13 V3 H23 V14 H31 V24 H23 V54Z', P.stoneLight)
  + fillPath('M20,4.5 H21.6 V52.5 H20Z M27,15.5 H29.5 V22.5 H27Z', P.stoneDark, { op: 0.7 })
  + line('M15.5,6V22', P.stoneHi, 1.5) + line('M17,33 L15,38 L19,42', P.stoneMortar, 1.5)
  + shape('M1.5,55 Q5,47 10,52 Q15,46 20,52.5 Q26,47 30,52 Q33,48 34.5,55Z', P.moss, { sw: 2 });
D.ironFence = () => {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 16, top = i % 2 ? 10 : 4;
    s += line(`M${x},${top + 6}V56`, P.outline, 5.4, { cap: 'butt' }) + line(`M${x},${top + 6}V56`, P.ironDark, 2.6, { cap: 'butt' });
    s += shape(`M${x},${top} L${x + 4},${top + 8} L${x},${top + 12} L${x - 4},${top + 8}Z`, P.iron, { sw: 2 });
  }
  for (const y of [24, 46]) s += rect(-3, y, 102, 4.6, P.iron, { stroke: P.outline, sw: 2 }) + line(`M0,${y + 1.5}H96`, P.ironHi, 1, { dash: '10 6', op: 0.7 });
  return s;
};
D.deadTree = () => {
  const br = (d, w) => line(d, P.outline, w + 4.5) ;
  const fl = (d, w) => line(d, P.woodDeep, w);
  const B = [['M70,180 Q64,140 72,104 Q76,84 68,60', 15], ['M71,110 Q50,96 40,70 Q36,58 24,52', 8], ['M40,72 Q30,74 18,66', 5], ['M30,56 Q28,44 32,34', 4.5],
    ['M70,84 Q92,70 100,46 Q103,34 116,28', 8], ['M100,48 Q112,52 124,46', 5], ['M108,32 Q106,20 112,10', 4.5], ['M68,62 Q62,40 70,22 Q72,14 66,6', 7], ['M69,30 Q80,24 84,12', 4]];
  let s = B.map(([d, w]) => br(d, w)).join('') + B.map(([d, w]) => fl(d, w)).join('');
  s += shape('M52,180 Q62,170 62,150 L80,150 Q80,170 90,180Z', P.woodDeep) + fillPath('M60,178 Q66,168 66,152 H78 Q78,168 84,178Z', P.woodDeep);
  s += line('M66,170 Q64,140 70,112 M74,96 Q76,80 70,64', P.woodDark, 2.2, { op: 0.9 });
  s += ellipse(73, 128, 5, 7, P.outline) + circle(71.6, 127, 1.2, P.gold) + circle(75, 127, 1.2, P.gold); // someone lives in the knothole
  return s;
};
D.bookshelf = () => {
  let s = rect(2, 3, 76, 116, P.woodDark, { rx: 3, stroke: P.outline, sw: 3 }) + rect(7, 8, 66, 106, P.woodDeep, { rx: 1 });
  const rnd = rng(42), cols = [P.magenta, P.cloak, P.moss, P.gold, P.scarf, P.mossDark, P.cloakHi, P.pumpkin, P.magentaDark, P.bone];
  for (let r = 0; r < 4; r++) {
    const base = 31 + r * 27; let x = 9;
    while (x < 66) {
      const w = 4 + Math.floor(rnd() * 4), h = 14 + Math.floor(rnd() * 8), c = cols[Math.floor(rnd() * cols.length)];
      if (rnd() < 0.12) { x += w + 2; continue; }
      if (x + w > 71) break;
      s += rect(x, base - h, w, h, c, { rx: 1, stroke: P.outline, sw: 1.5 }) + line(`M${x + 1.2},${base - h + 4}H${x + w - 1.2}`, P.goldHi, 1, { op: 0.8 });
      x += w + 0.4;
    }
    s += rect(5, base, 70, 4, P.wood, { stroke: P.outline, sw: 1.8 });
  }
  s += rect(0.5, 1.5, 79, 6, P.wood, { rx: 2.5, stroke: P.outline, sw: 2.4 }) + line('M5,3.8H50', P.woodHi, 1.3);
  s += circle(60, 99, 5.4, P.bone, { stroke: P.outline, sw: 1.6 }) + circle(58.2, 98.6, 1.2, P.outline) + circle(61.8, 98.6, 1.2, P.outline) + rect(57.4, 103, 5.2, 3, P.bone, { stroke: P.outline, sw: 1.2 });
  return s;
};
D.banner = () => rect(2, 1.5, 36, 5, P.gold, { rx: 2.5, stroke: P.outline, sw: 2 })
  + shape('M6,6 H34 V102 L20,88 L6,102Z', P.magenta)
  + fillPath('M26,7 H33 V98 L26,91Z', P.magentaDark, { op: 0.55 })
  + line('M9.5,7V95 M30.5,7V95', P.gold, 2, { cap: 'butt' }) + line('M9.5,95.5 L20,84.5 L30.5,95.5', P.gold, 2)
  + fillPath('M23,30 A11,11 0 1 0 29,47 A9,9 0 1 1 23,30Z', P.gold)
  + fillPath('M0,-4 L1,-1 4,0 1,1 0,4 -1,1 -4,0 -1,-1Z', P.goldHi, { tf: 'translate(20 62)' })
  + line('M13.5,10V70', P.magentaHi, 1.3, { op: 0.6, dash: '16 7' });
D.chandelier = () => {
  let s = chainV(48, 0, 36);
  s += line('M10,56 Q10,74 48,74 Q86,74 86,56', P.outline, 7) + line('M10,56 Q10,74 48,74 Q86,74 86,56', P.gold, 3.4);
  s += line('M29,52 Q29,66 48,66 Q67,66 67,52', P.outline, 6.4) + line('M29,52 Q29,66 48,66 Q67,66 67,52', P.goldDark, 3);
  s += shape('M42,34 H54 L57,44 L48,82 L39,44Z', P.gold) + line('M45,38 L44,46 L48,66', P.goldHi, 1.4) + circle(48, 84, 3, P.magenta, { stroke: P.outline, sw: 1.8 });
  for (const [x, y, h] of [[10, 55, 11], [29, 51, 10], [67, 51, 10], [86, 55, 11], [48, 34, 0]]) {
    if (!h) continue;
    s += shape(`M${x - 5.5},${y} H${x + 5.5} L${x + 3},${y + 4.5} H${x - 3}Z`, P.gold, { sw: 2 }) + candle(x, y, h);
  }
  return s;
};
D.cobweb = () => {
  let s = '';
  const rays = [[62, 3], [56, 22], [44, 40], [24, 55], [3, 62]];
  s += line(rays.map(([x, y]) => `M0,0L${x},${y}`).join(' '), P.white, 1.2, { op: 0.75 });
  for (const f of [0.22, 0.42, 0.62, 0.82, 1]) {
    let d = '';
    for (let i = 0; i < rays.length - 1; i++) { const a = rays[i], b = rays[i + 1]; d += `M${n(a[0] * f)},${n(a[1] * f)} Q${n((a[0] + b[0]) / 2 * f * 0.84)},${n((a[1] + b[1]) / 2 * f * 0.84)} ${n(b[0] * f)},${n(b[1] * f)} `; }
    s += line(d, P.white, 1, { op: 0.6 });
  }
  // a tiny friendly spider on a thread
  s += line('M30,22V44', P.white, 0.9, { op: 0.7 }) + line('M26,46 l-3,-2 M26,48 l-3.4,1 M34,46 l3,-2 M34,48 l3.4,1', P.outline, 1.1)
    + circle(30, 47, 4, P.bramble, { stroke: P.outline, sw: 1.5 }) + circle(28.6, 46.6, 0.9, P.white) + circle(31.4, 46.6, 0.9, P.white);
  return s;
};
D.ivyCluster = () => {
  const stems = ['M12,0 Q6,18 13,34 T10,66', 'M26,0 Q32,14 26,30 T30,54 T26,76', 'M40,0 Q36,12 41,26 T38,48', 'M52,0 Q58,10 53,22 T55,36'];
  let s = stems.map((d) => line(d, P.outline, 3.8) + line(d, P.mossDeep, 1.9)).join('');
  const L = [[12, 4, 200], [9, 14, -20], [12, 26, 160], [13, 38, -10], [11, 50, 190], [10, 61, 20], [10, 67, 90], [27, 5, -30], [30, 16, 190], [26, 28, 10], [28, 40, 170], [30, 52, 0], [28, 64, 200], [26, 77, 80],
    [39, 4, 210], [37, 15, 0], [41, 27, 200], [40, 38, -10], [38, 49, 95], [53, 3, -20], [56, 13, 190], [53, 24, 10], [55, 37, 85]];
  L.forEach(([x, y, a], i) => { s += leaf(x, y, a, [P.moss, P.mossDark, P.mossDeep][i % 3], 1.15); });
  s += circle(10, 71, 2, P.magentaHi, { stroke: P.outline, sw: 1.2 }) + circle(38, 53, 1.8, P.magentaHi, { stroke: P.outline, sw: 1.2 });
  return s;
};
D.barrel = () => shape('M6,4 H34 Q39,24 34,46 H6 Q1,24 6,4Z', P.wood)
  + fillPath('M27,5.3 H33 Q37.6,24 33,44.7 H27 Q30,24 27,5.3Z', P.woodDark, { op: 0.8 })
  + line('M13,5 Q10,24 13,45 M20,5V45', P.woodDark, 1.5) + line('M9,8 Q6,24 9,41', P.woodHi, 1.5)
  + shape('M4.2,12 H35.8 L36.6,17 H3.4Z', P.iron, { sw: 1.8 }) + shape('M3.4,32 H36.6 L35.8,37 H4.2Z', P.iron, { sw: 1.8 });
D.crate = () => rect(2, 2, 40, 40, P.wood, { rx: 3, stroke: P.outline, sw: O })
  + rect(7.5, 7.5, 29, 29, P.woodDark, { rx: 1.5 }) + line('M8,8 L36,36 M36,8 L8,36', P.outline, 7) + line('M8,8 L36,36 M36,8 L8,36', P.wood, 4)
  + rect(2, 2, 40, 40, 'none', { rx: 3, stroke: P.outline, sw: O }) + rect(7.5, 7.5, 29, 29, 'none', { rx: 1.5, stroke: P.outline, sw: 1.6 })
  + line('M5,4.6H30', P.woodHi, 1.4) + circle(5.4, 38.6, 1, P.woodDeep) + circle(38.6, 5.4, 1, P.woodDeep) + circle(38.6, 38.6, 1, P.woodDeep);
D.pumpkin = () => shape('M19,9 Q17,3 22,1.5 L24,4 Q21.5,5 22,9Z', P.mossDark, { sw: 2 })
  + shape(smooth([[20, 8], [32, 10], [38, 21], [33, 33], [20, 35], [7, 33], [2, 21], [8, 10]]), P.pumpkin)
  + line('M14,10 Q8,21 14,33 M26,10 Q32,21 26,33', P.pumpkinDark, 1.6) + line('M8,15 Q6,20 7,25', P.goldHi, 1.5, { op: 0.8 })
  + fillPath('M11,17 L16,19.5 L11,21.5Z M29,17 L24,19.5 L29,21.5Z', P.flameCore) // happy face, lit from inside
  + fillPath('M10,25 Q20,34 30,25 Q26,27.5 24.4,26 L23,28.4 L20,26.6 L17,28.4 L15.6,26 Q14,27.5 10,25Z', P.flameCore);
D.cauldron = () => {
  let s = line('M10,46 L7,51 M46,46 L49,51', P.outline, 5) + line('M10,46 L7,51 M46,46 L49,51', P.ironDark, 2.2);
  s += shape('M6,16 Q-2,34 12,46 Q28,54 44,46 Q58,34 50,16Z', P.ironDark) + line('M9,22 Q6,34 15,43', P.ironHi, 1.6, { op: 0.8 });
  s += ellipse(28, 16, 24, 6.4, P.iron, { stroke: P.outline, sw: O }) + ellipse(28, 16, 19.5, 4.2, P.moss, { stroke: P.outline, sw: 1.6 });
  s += circle(21, 15.4, 2.6, P.mossHi, { stroke: P.outline, sw: 1.2 }) + circle(33, 16.6, 1.8, P.mossHi, { stroke: P.outline, sw: 1.2 });
  s += circle(18, 6, 2.4, P.mint, { op: 0.8 }) + circle(36, 3.4, 1.7, P.mint, { op: 0.7 }) + circle(28, 9, 1.4, P.mint, { op: 0.7 });
  return s;
};
D.batRoost = () => {
  const bat = (x, s0, eyes) => group(
    shape('M-9,2 Q-13,10 -8,22 Q-3,18 0,24 Q3,18 8,22 Q13,10 9,2Z', P.bramble)   // folded wings
    + shape('M-5,4 L-7.5,-2 L-2,1.5Z', P.bramble, { sw: 1.8 }) + shape('M5,4 L7.5,-2 L2,1.5Z', P.bramble, { sw: 1.8 })
    + circle(0, 20, 5.6, P.brambleHi, { stroke: P.outline, sw: 2 })
    + (eyes ? circle(-2, 20.6, 1.3, P.gold) + circle(2, 20.6, 1.3, P.gold) : line('M-3.4,20.6 q1.4,-1.4 2.6,0 M0.8,20.6 q1.4,-1.4 2.6,0', P.outline, 1.1))
    + line('M-6,6 Q-9,12 -6.5,18', P.brambleHi, 1.2, { op: 0.8 }), { tf: `translate(${x} 5) scale(${s0})` });
  return rect(1.5, 1.5, 61, 5.5, P.woodDark, { rx: 2.5, stroke: P.outline, sw: 2 }) + line('M5,3.4H40', P.woodHi, 1.1, { op: 0.7 })
    + bat(14, 1, false) + bat(34, 1.15, true) + bat(52, 0.9, false);
};
D.mushrooms = () => {
  const m = (x, y, w, h, col) => shape(`M${x - w * 0.16},${y} Q${x - w * 0.22},${y - h * 0.5} ${x - w * 0.1},${y - h * 0.62} H${x + w * 0.1} Q${x + w * 0.22},${y - h * 0.5} ${x + w * 0.16},${y}Z`, P.bone, { sw: 1.8 })
    + shape(`M${x - w / 2},${y - h * 0.58} Q${x - w / 2},${y - h} ${x},${y - h} Q${x + w / 2},${y - h} ${x + w / 2},${y - h * 0.58} Q${x},${y - h * 0.44} ${x - w / 2},${y - h * 0.58}Z`, col, { sw: 2 })
    + circle(x - w * 0.18, y - h * 0.8, w * 0.07, P.white, { op: 0.9 }) + circle(x + w * 0.16, y - h * 0.72, w * 0.05, P.white, { op: 0.9 });
  return m(11, 31, 14, 16, P.mint) + m(30, 31, 12, 13, P.mint) + m(21, 31, 20, 27, P.moss)
    + shape('M2,32 Q6,27 10,31 Q16,27 22,31 Q30,27 38,32Z', P.mossDark, { sw: 1.8 });
};
D.signpost = () => line('M24,62V14', P.outline, 8.4, { cap: 'butt' }) + line('M24,62V14', P.woodDark, 5, { cap: 'butt' })
  + shape('M5,10 H38 L46,18 L38,26 H5Z', P.wood) + line('M8,13H34', P.woodHi, 1.4) + line('M10,18.5H30 M10,22H24', P.woodDeep, 1.6)
  + shape('M43,32 H12 L4,39 L12,46 H43Z', P.wood) + line('M14,35H40', P.woodHi, 1.4) + line('M16,40.5H38', P.woodDeep, 1.6)
  + shape('M14,63 Q18,56 22,61 Q25,56 29,61 Q33,57 35,63Z', P.moss, { sw: 1.8 }) + circle(24, 18, 1.2, P.iron) + circle(24, 39, 1.2, P.iron);
D.chest = () => rect(3, 18, 46, 24, P.wood, { rx: 3, stroke: P.outline, sw: O }) + rect(40, 19.4, 7.6, 21.4, P.woodDark, { op: 0.7 })
  + shape('M3,20 Q3,3 26,3 Q49,3 49,20Z', P.woodHi === P.wood ? P.wood : P.wood) + line('M8,14 Q10,6.5 24,5.6', P.woodHi, 1.6)
  + fillPath('M40,6.6 Q47.6,10 47.6,18.8 H40Z', P.woodDark, { op: 0.7 })
  + rect(1.5, 17.5, 49, 4.6, P.gold, { rx: 2, stroke: P.outline, sw: 1.8 })
  + shape('M9.5,4.5 H15 V42 H9.5Z', P.gold, { sw: 1.6 }).replace('M9.5,4.5 H15 V42 H9.5Z', 'M9.5,7 Q12,5.2 15,4.4 V41.6 H9.5Z')
  + shape('M37,4.4 Q40,5.2 42.5,7 V41.6 H37Z', P.gold, { sw: 1.6 })
  + rect(21.5, 15, 9, 11, P.goldHi, { rx: 2.5, stroke: P.outline, sw: 1.8 }) + circle(26, 19.4, 1.5, P.outline) + line('M26,20V23', P.outline, 1.4)
  + line('M5,39.5H36', P.woodDeep, 1.4, { op: 0.7 });
D.doorway = () => {
  const id = uid('d'), g = uid('dg');
  const frame = 'M4,168 V70 Q4,8 60,4 Q116,8 116,70 V168Z', hole = 'M20,168 V72 Q20,26 60,22 Q100,26 100,72 V168Z';
  let s = shape(frame, P.stoneLight, { sw: 3 });
  // voussoir joints around the arch
  let j = '';
  for (let i = 0; i <= 8; i++) { const a = Math.PI * (1 - i / 8); j += `M${n(60 + Math.cos(a) * 42)},${n(72 - Math.sin(a) * 50)} L${n(60 + Math.cos(a) * 55)},${n(72 - Math.sin(a) * 66)} `; }
  for (let y = 96; y < 168; y += 24) j += `M5,${y}H20 M100,${y}H115 `;
  s += line(j, P.stoneMortar, 1.8) + line('M9,70 Q10,16 58,9', P.stoneHi, 1.8, { op: 0.8 });
  s += clipDef(id, `<path d="${hole}"/>`) + linGrad(g, [[0, P.hallTop], [1, P.wallDark]]);
  s += group(`<rect width="120" height="168" fill="url(#${g})"/>` + softGlow(60, 150, 46, P.flame, 0.35)
    + fillPath('M20,168 V150 H100 V168Z', P.outline, { op: 0.35 }), { clip: id });
  s += `<path d="${hole}" fill="none" stroke="${P.outline}" stroke-width="2.6"/>`;
  s += shape('M52,6 L60,0.5 L68,6 L66,24 H54Z', P.stone, { sw: 2.4 }) + fillPath('M61.5,9 A5,5 0 1 0 64.5,17 A4.2,4.2 0 1 1 61.5,9Z', P.gold);
  return s;
};

/* ---------- catalog ---------- */
// key, name, w, h, originX, originY, group, extras
const DECOR = [
  ['candelabra', 'Candelabra', 40, 72, 0.5, 1, 'light', { glow: { x: 0, y: -52, radius: 70, color: P.flame, flicker: 0.12 } }],
  ['wallTorch', 'Wall torch', 24, 48, 0.5, 0.5, 'light', { glow: { x: 0, y: -14, radius: 64, color: P.flame, flicker: 0.18 } }],
  ['hangingLantern', 'Hanging lantern', 28, 96, 0.5, 0, 'light', { sway: { angle: 4, period: 3.2 }, glow: { x: 0, y: 76, radius: 60, color: P.flameCore, flicker: 0.06 } }],
  ['chandelier', 'Chandelier', 96, 88, 0.5, 0, 'light', { sway: { angle: 2.5, period: 4.5 }, glow: { x: 0, y: 44, radius: 110, color: P.flame, flicker: 0.1 } }],
  ['windowArch', 'Arched window (moonlight)', 96, 168, 0.5, 0.5, 'architecture', { glow: { x: 0, y: -6, radius: 120, color: '#9fd0ff' } }],
  ['roseWindow', 'Rose window', 120, 120, 0.5, 0.5, 'architecture', { glow: { x: 0, y: 0, radius: 100, color: P.magentaHi } }],
  ['doorway', 'Arched doorway', 120, 168, 0.5, 1, 'architecture', {}],
  ['pillar', 'Pillar', 48, 192, 0.5, 1, 'architecture', {}],
  ['brokenColumn', 'Broken column', 56, 80, 0.5, 1, 'architecture', {}],
  ['gargoyle', 'Sleepy gargoyle', 64, 72, 0.5, 1, 'statues', {}],
  ['knightArmor', 'Suit of armour', 48, 96, 0.5, 1, 'statues', {}],
  ['tombstoneRound', 'Tombstone (round)', 40, 48, 0.5, 1, 'graveyard', {}],
  ['tombstoneCross', 'Tombstone (cross)', 36, 56, 0.5, 1, 'graveyard', {}],
  ['ironFence', 'Iron fence', 96, 56, 0.5, 1, 'graveyard', {}],
  ['deadTree', 'Dead tree', 140, 180, 0.5, 1, 'nature', {}],
  ['ivyCluster', 'Ivy cluster', 64, 84, 0.5, 0, 'nature', { sway: { angle: 2, period: 3.8 } }],
  ['mushrooms', 'Glow mushrooms', 40, 34, 0.5, 1, 'nature', { glow: { x: 0, y: -18, radius: 34, color: P.mint } }],
  ['pumpkin', 'Jack-o-lantern', 40, 36, 0.5, 1, 'props', { glow: { x: 0, y: -14, radius: 36, color: P.flame, flicker: 0.1 } }],
  ['cauldron', 'Bubbling cauldron', 56, 52, 0.5, 1, 'props', { glow: { x: 0, y: -40, radius: 40, color: P.mint, flicker: 0.05 } }],
  ['bookshelf', 'Bookshelf', 80, 120, 0.5, 1, 'furniture', {}],
  ['barrel', 'Barrel', 40, 48, 0.5, 1, 'props', {}],
  ['crate', 'Crate', 44, 44, 0.5, 1, 'props', {}],
  ['chest', 'Treasure chest', 52, 44, 0.5, 1, 'props', {}],
  ['signpost', 'Signpost', 48, 64, 0.5, 1, 'props', {}],
  ['banner', 'Moon banner', 40, 104, 0.5, 0, 'cloth', { sway: { angle: 3, period: 3.4 } }],
  ['cobweb', 'Cobweb (corner)', 64, 64, 0, 0, 'creepy', {}],
  ['batRoost', 'Sleeping bats', 64, 44, 0.5, 0, 'creepy', { sway: { angle: 3, period: 2.8 } }],
];

export const decorSvg = (key, w, h) => svgDoc(w, h, D[key]());
export function decorCatalog() {
  return {
    version: 1,
    decor: DECOR.map(([key, name, w, h, originX, originY, grp, extra]) => ({ key, name, image: `assets/decor/${key}.png`, w, h, imageScale: IMAGE_SCALE, originX, originY, group: grp, ...extra })),
  };
}
export async function buildDecor() {
  const cat = decorCatalog();
  for (const d of cat.decor) await writePng(decorSvg(d.key, d.w, d.h), `public/${d.image}`);
  writeJson('content/decor.json', cat);
}
