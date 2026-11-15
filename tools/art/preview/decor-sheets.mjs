// decor-sheet.png: every prop on a wall/floor backdrop with its name, anchor (red dot) and glow radius.
import { readFileSync } from 'node:fs';
import { abs, svgDoc, writePng } from '../lib.mjs';
import { P } from '../palette.mjs';
export async function build() {
  const cat = JSON.parse(readFileSync(abs('content/decor.json'), 'utf8'));
  const W = 1000; let x = 16, y = 16, rowH = 0, body = '';
  for (const d of cat.decor) {
    if (x + d.w + 16 > W) { x = 16; y += rowH + 30; rowH = 0; }
    const img = `data:image/png;base64,${readFileSync(abs('public/' + d.image)).toString('base64')}`;
    const ax = x + d.originX * d.w, ay = y + d.originY * d.h;
    if (d.glow) body += `<circle cx="${ax + d.glow.x}" cy="${ay + d.glow.y}" r="${d.glow.radius}" fill="${d.glow.color}" opacity="0.13"/>`;
    body += `<image href="${img}" x="${x}" y="${y}" width="${d.w}" height="${d.h}"/><circle cx="${ax}" cy="${ay}" r="1.6" fill="#f33"/>`;
    body += `<text x="${x}" y="${y + d.h + 11}" font-size="8" fill="#fff" font-family="sans-serif">${d.key}${d.sway ? ' ~' : ''}</text>`;
    x += d.w + 22; rowH = Math.max(rowH, d.h);
  }
  const H = y + rowH + 30;
  await writePng(svgDoc(W, H, `<rect width="${W}" height="${H}" fill="${P.wall}"/>` + body, 1.6), 'tools/art/preview/out/decor-sheet.png');
}
