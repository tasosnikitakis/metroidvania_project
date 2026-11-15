// Screenshot the Phaser RigView test page:  node tools/art/preview/shot.mjs
// Uses a preview server already running on :5373, or starts one
// (npx vite --config tools/art/preview/vite.config.mjs --port 5373). Output: out/phaser-rigview-*.png
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const here = dirname(fileURLToPath(import.meta.url));
const base = 'http://localhost:5373/';
const up = async () => { try { return (await fetch(base)).ok; } catch { return false; } };
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--config', resolve(here, 'vite.config.mjs'), '--port', '5373', '--strictPort'], { cwd: resolve(here, '../../..'), stdio: 'ignore', detached: true });
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
}
const browser = await playwright.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [t, name] of [[0.3, 'a'], [1.37, 'b'], [2.71, 'c']]) {
    await page.goto(`${base}?freeze=1&t=${t}`, { timeout: 20000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(here, `out/phaser-rigview-${name}.png`) });
    console.log(name, 'events:', JSON.stringify(await page.evaluate('window.__events || []')));
  }
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
} finally {
  await browser.close();
  if (vite) { try { process.kill(-vite.pid); } catch { vite.kill(); } }
}
