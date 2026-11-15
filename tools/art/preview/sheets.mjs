// Preview sheets: look at tools/art/preview/out/*.png after `npm run art`.
import sharp from 'sharp';
import { readFileSync, existsSync } from 'node:fs';
import { abs, rng, svgDoc, writePng } from '../lib.mjs';
import { P } from '../palette.mjs';

const OUT = 'tools/art/preview/out/';
const b64 = (rel) => `data:image/png;base64,${readFileSync(abs(rel)).toString('base64')}`;

async function tilesPreview() {
  const ts = JSON.parse(readFileSync(abs('content/tileset.json'), 'utf8'));
  const meta = await sharp(abs('public/' + ts.image)).metadata();
  const W = meta.width / 2, H = meta.height / 2;
  // sheet on a checker background so transparency is visible
  let body = `<rect width="${W}" height="${H}" fill="#2b2550"/>`;
  for (let y = 0; y < H / 48; y++) for (let x = 0; x < W / 48; x++) if ((x + y) % 2) body += `<rect x="${x * 48}" y="${y * 48}" width="48" height="48" fill="#352e60"/>`;
  body += `<image href="${b64('public/' + ts.image)}" width="${W}" height="${H}"/>`;
  await writePng(svgDoc(W, H, body, 2), OUT + 'tileset-sheet.png');

  // auto-tile test: blobs assembled using the mask table
  const cols = 22, rows = 12;
  const tileImg = (id, x, y) => {
    const i = id - 1, sx = (i % ts.columns) * 48, sy = Math.floor(i / ts.columns) * 48;
    return `<svg x="${x * 48}" y="${y * 48}" width="48" height="48" viewBox="${sx} ${sy} 48 48"><image href="${sheet}" width="${W}" height="${H}"/></svg>`;
  };
  const sheet = b64('public/' + ts.image);
  const byName = Object.fromEntries(ts.tiles.map((t) => [t.name, t.id]));
  const mk = (fn) => { const g = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.push(fn(x, y) ? 1 : 0); return g; };
  const wall = mk((x, y) => (x >= 1 && x <= 13 && y >= 1 && y <= 9 && !(x === 1 && y === 1) && !(x > 10 && y < 3)) || (x >= 16 && x <= 20 && y >= 2 && y <= 6 && !(x === 18 && y === 4)) || (x === 15 && y === 9));
  const stone = mk((x, y) => y >= 10 || (x >= 3 && x <= 6 && y >= 7) || (x === 9 && y >= 5 && y <= 6) || (x >= 12 && x <= 13 && y === 7) || (x === 16 && y >= 6) || (x >= 18 && y >= 8) || (x === 0) || (x === 11 && y === 3) || (x >= 19 && y === 0));
  const at = (g, x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 1 : g[y * cols + x]);
  const rnd = rng(7);
  let b2 = `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.skyTop}"/><stop offset="1" stop-color="${P.skyBottom}"/></linearGradient></defs><rect width="${cols * 48}" height="${rows * 48}" fill="url(#sk)"/>`;
  if (existsSync(abs('content/backgrounds.json'))) {
    const bg = JSON.parse(readFileSync(abs('content/backgrounds.json'), 'utf8')).backgrounds[0];
    for (const l of bg.layers) { const y = l.anchorY === 'top' ? 0 : rows * 48 - l.h; b2 += `<image href="${b64('public/' + l.image)}" x="${-l.scrollX * 300}" y="${y}" width="${l.w}" height="${l.h}" opacity="${l.alpha ?? 1}"/>`; }
  }
  const front = [];
  const decorAt = (cat, key, x, y) => { const d = cat.decor.find((q) => q.key === key); if (!d) return ''; return (d.glow ? `<circle cx="${x + d.glow.x}" cy="${y + d.glow.y}" r="${d.glow.radius}" fill="url(#dg-${key})"/><defs><radialGradient id="dg-${key}"><stop offset="0" stop-color="${d.glow.color}" stop-opacity="0.4"/><stop offset="1" stop-color="${d.glow.color}" stop-opacity="0"/></radialGradient></defs>` : '') + `<image href="${b64('public/' + d.image)}" x="${x - d.originX * d.w}" y="${y - d.originY * d.h}" width="${d.w}" height="${d.h}"/>`; };
  for (const [g, terr] of [[wall, ts.terrains[1]], [stone, ts.terrains[0]]]) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!g[y * cols + x]) continue;
      const m = at(g, x, y - 1) | (at(g, x + 1, y) << 1) | (at(g, x, y + 1) << 2) | (at(g, x - 1, y) << 3);
      let id = terr.tiles[m];
      if (m === 15 && rnd() < 0.3) id = terr.fillVariants[Math.floor(rnd() * terr.fillVariants.length)];
      b2 += tileImg(id, x, y);
    }
  }
  const put = (name, x, y) => { b2 += tileImg(byName[name], x, y); };
  put('plank-left', 7, 5); put('plank-middle', 8, 5); put('plank-right', 9, 4); put('plank-left', 9, 4); put('plank-right', 8, 5);
  put('plank-left', 12, 4); put('plank-middle', 13, 4); put('plank-middle', 14, 4); put('plank-right', 15, 4);
  put('ledge-left', 12, 6); put('ledge-middle', 13, 6); put('ledge-right', 14, 6);
  put('spikes-floor', 7, 9); put('spikes-floor', 8, 9); put('brambles', 10, 9); put('brambles', 11, 9); put('spikes-ceiling', 19, 1); put('spikes-ceiling', 20, 1);
  put('pillar-top', 14, 7); put('pillar-middle', 14, 8); put('pillar-base', 14, 9); put('block-moon', 17, 9); put('block-rune', 2, 9); put('block-plain', 1, 9);
  put('window-top', 5, 2); put('window-middle', 5, 3); put('window-bottom', 5, 4);
  put('banner-top', 8, 1); put('banner-middle', 8, 2); put('banner-bottom', 8, 3);
  put('chain', 3, 1); put('chain', 3, 2); put('chain-end', 3, 3); put('cobweb-left', 1, 2); put('cobweb-right', 10, 1);
  put('grass-tuft', 10, 9); put('grass-flower', 12, 9); put('grass-tuft', 4, 6); put('grass-flower', 19, 7); put('ivy-hanging', 16, 7); put('ivy-end', 16, 8); put('ivy-end', 20, 1);
  if (existsSync(abs('content/decor.json'))) {
    const cat = JSON.parse(readFileSync(abs('content/decor.json'), 'utf8'));
    b2 += decorAt(cat, 'candelabra', 270, 480) + decorAt(cat, 'knightArmor', 440, 480) + decorAt(cat, 'chest', 918, 480) + decorAt(cat, 'hangingLantern', 600, 96) + decorAt(cat, 'pumpkin', 1010, 528) + decorAt(cat, 'mushrooms', 1040, 480);
  }
  if (existsSync(abs('content/rigs/hero.rig.json'))) {
    const { rigSvg } = await import('./hero-sheets.mjs');
    const { sampleAnimation } = await import('../../../src/rig/pose.ts');
    const rig = JSON.parse(readFileSync(abs('content/rigs/hero.rig.json'), 'utf8'));
    b2 += `<g transform="translate(350 480)">${rigSvg(rig, sampleAnimation(rig, rig.animations.run, 0.06))}</g>`;
    b2 += `<g transform="translate(940 336)">${rigSvg(rig, sampleAnimation(rig, rig.animations.idle, 0.4))}</g>`;
    b2 += `<g transform="translate(760 300) scale(-1 1)">${rigSvg(rig, sampleAnimation(rig, rig.animations.jump, 0.1))}</g>`;
  }
  for (let x = 0; x < cols; x++) { put('rim-bottom', x, rows - 1); }
  put('rim-top', 1, 0); put('rim-top', 2, 0); put('rim-top', 3, 0);
  // render at 1.5x (non-integer) to reveal seams
  await writePng(svgDoc(cols * 48, rows * 48, b2, 1.5), OUT + 'autotile-test.png');
}

export async function buildPreviews(only = []) {
  const on = (k) => only.length === 0 || only.includes(k);
  if (on('tiles') && existsSync(abs('content/tileset.json'))) await tilesPreview();
  for (const [k, f] of [['hero', './hero-sheets.mjs'], ['decor', './decor-sheets.mjs'], ['bg', './bg-sheets.mjs']]) {
    if (!on(k) || !existsSync(new URL(f, import.meta.url))) continue;
    await (await import(f)).build();
  }
}
