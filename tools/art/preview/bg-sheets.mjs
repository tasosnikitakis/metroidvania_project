// bg-<key>.png: each parallax theme composited at two camera positions (to check the seam + parallax),
// using the same placement rule as the game (bottom/top anchored, offsetY into the screen).
import { readFileSync } from 'node:fs';
import { abs, svgDoc, writePng } from '../lib.mjs';
export async function build() {
  const cat = JSON.parse(readFileSync(abs('content/backgrounds.json'), 'utf8'));
  const VW = 1280, VH = 720;
  for (const bg of cat.backgrounds) {
    let body = '';
    [0, 5200].forEach((camX, row) => {
      let s = `<defs><linearGradient id="sky${row}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg.skyTop}"/><stop offset="1" stop-color="${bg.skyBottom}"/></linearGradient></defs><rect width="${VW}" height="${VH}" fill="url(#sky${row})"/>`;
      for (const l of bg.layers) {
        const href = `data:image/png;base64,${readFileSync(abs('public/' + l.image)).toString('base64')}`;
        const y = l.anchorY === 'top' ? l.offsetY : VH - l.offsetY - l.h;
        let x = -((camX * l.scrollX) % l.w);
        for (; x < VW; x += l.w) s += `<image href="${href}" x="${x}" y="${y}" width="${l.w}" height="${l.h}" opacity="${l.alpha ?? 1}"/>`;
      }
      if (bg.fog) s += `<rect width="${VW}" height="${VH}" fill="${bg.fog.color}" opacity="${bg.fog.alpha}"/>`;
      body += `<svg x="0" y="${row * (VH + 8)}" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">${s}</svg>`;
    });
    await writePng(svgDoc(VW, VH * 2 + 8, body, 1), `tools/art/preview/out/bg-${bg.key}.png`);
  }
}
