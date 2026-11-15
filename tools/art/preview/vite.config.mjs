// Stand-alone preview server for the art (does not touch the game's vite.config.ts).
//   npx vite --config tools/art/preview/vite.config.mjs --port 5373
// then open http://localhost:5373/  (RigView test: cycles every hero animation in real Phaser)
import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
export default defineConfig({
  root: resolve(here, 'page'),
  publicDir: resolve(repo, 'public'),
  cacheDir: resolve(repo, 'node_modules/.vite-art-preview'),
  server: { port: 5373, strictPort: false, fs: { allow: [repo] } },
});
