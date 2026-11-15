// `npm run art` - regenerates ALL art (PNG) and art-related content JSON deterministically.
// Usage: node tools/art/build.mjs [tiles|hero|decor|bg|preview ...]   (no args = everything)
import { resetUid } from './lib.mjs';
const want = process.argv.slice(2);
const on = (k) => want.length === 0 || want.includes(k);
const steps = [
  ['tiles', async () => (await import('./tiles.mjs')).buildTileset()],
  ['hero', async () => (await import('./hero.mjs')).buildHero()],
  ['decor', async () => (await import('./decor.mjs')).buildDecor()],
  ['bg', async () => (await import('./backgrounds.mjs')).buildBackgrounds()],
  ['preview', async () => (await import('./preview/sheets.mjs')).buildPreviews(want.filter((w) => w !== 'preview'))],
];
for (const [name, fn] of steps) {
  if (!on(name)) continue;
  resetUid();
  const t = Date.now();
  try { await fn(); console.log(`art: ${name} ok (${Date.now() - t} ms)`); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && want.length === 0) console.log(`art: ${name} skipped (${e.message})`); else throw e; }
}
