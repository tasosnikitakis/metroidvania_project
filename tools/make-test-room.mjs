#!/usr/bin/env node
/**
 * Generates the FUNCTIONAL TEST ROOM (content/rooms/room-001.json) and
 * content/world.json. Run with:   node tools/make-test-room.mjs
 *
 * The room is a left-to-right obstacle course that exercises every hero
 * mechanic. Edit the "LAYOUT" section below and re-run, or open the result
 * in the World Editor. Tiles are picked from content/tileset.json using the
 * terrain auto-tile table (TerrainDef.tiles indexed by N=1,E=2,S=4,W=8).
 *
 * NOTE: re-running overwrites room-001.json - don't run it once the room has
 * been hand-decorated in the editor.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');
const readJson = (rel, fallback) => {
  const file = join(CONTENT, rel);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
};

/* ------------------------------------------------------------------ */
/* Tileset lookup (with a tiny built-in fallback if the art isn't there) */
/* ------------------------------------------------------------------ */
const tileset = readJson('tileset.json', {
  tileSize: 48,
  tiles: [
    { id: 1, name: 'solid', collision: 'solid' },
    { id: 2, name: 'plank-middle', collision: 'oneway' },
    { id: 3, name: 'spikes-floor', collision: 'hazard' },
  ],
  terrains: [{ name: 'solid', layer: 'main', tiles: Array(16).fill(1) }],
});
const TS = tileset.tileSize ?? 48;
const byName = new Map(tileset.tiles.map((t) => [t.name, t.id]));
/** First tile id matching one of the names, else the first tile with that collision type, else 0. */
function tile(names, collision) {
  for (const n of names) if (byName.has(n)) return byName.get(n);
  return tileset.tiles.find((t) => t.collision === collision)?.id ?? 0;
}
const stone = tileset.terrains.find((t) => t.layer === 'main') ?? tileset.terrains[0];
const wall = tileset.terrains.find((t) => t.layer === 'back');
const T = {
  plankL: tile(['plank-left', 'plank-middle'], 'oneway'),
  plankM: tile(['plank-middle'], 'oneway'),
  plankR: tile(['plank-right', 'plank-middle'], 'oneway'),
  ledgeL: tile(['ledge-left', 'plank-left'], 'oneway'),
  ledgeM: tile(['ledge-middle', 'plank-middle'], 'oneway'),
  ledgeR: tile(['ledge-right', 'plank-right'], 'oneway'),
  spikesFloor: tile(['spikes-floor'], 'hazard'),
  spikesCeil: tile(['spikes-ceiling', 'spikes-floor'], 'hazard'),
  brambles: tile(['brambles', 'spikes-floor'], 'hazard'),
  grass: byName.get('grass-tuft') ?? 0,
  flower: byName.get('grass-flower') ?? 0,
  ivy: byName.get('ivy-hanging') ?? 0,
  ivyEnd: byName.get('ivy-end') ?? 0,
  windowTop: byName.get('window-top') ?? 0,
  windowMid: byName.get('window-middle') ?? 0,
  windowBot: byName.get('window-bottom') ?? 0,
  bannerTop: byName.get('banner-top') ?? 0,
  bannerMid: byName.get('banner-middle') ?? 0,
  bannerBot: byName.get('banner-bottom') ?? 0,
  chain: byName.get('chain') ?? 0,
  chainEnd: byName.get('chain-end') ?? 0,
  cobwebL: byName.get('cobweb-left') ?? 0,
  cobwebR: byName.get('cobweb-right') ?? 0,
};

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                       */
/* ------------------------------------------------------------------ */
const W = 110;
const H = 34;
const GROUND = 28; // row of the main floor's top surface
const solid = new Uint8Array(W * H); // 1 = stone terrain
const backWall = new Uint8Array(W * H); // 1 = back-wall terrain
const mainExtra = new Int32Array(W * H); // one-ways & hazards (tile ids)
const backExtra = new Int32Array(W * H);
const frontExtra = new Int32Array(W * H);
const at = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

function rect(grid, x0, y0, x1, y1, v) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) grid[at(x, y)] = v;
}
const fill = (x0, y0, x1, y1) => rect(solid, x0, y0, x1, y1, 1);
const carve = (x0, y0, x1, y1) => rect(solid, x0, y0, x1, y1, 0);
function oneway(x0, x1, y, kind = 'plank') {
  for (let x = x0; x <= x1; x++) {
    const left = x === x0, right = x === x1;
    mainExtra[at(x, y)] = kind === 'ledge'
      ? (left ? T.ledgeL : right ? T.ledgeR : T.ledgeM)
      : (left ? T.plankL : right ? T.plankR : T.plankM);
  }
}
const hazard = (x0, x1, y, id) => { for (let x = x0; x <= x1; x++) mainExtra[at(x, y)] = id; };

const entities = [];
let nextId = 1;
const px = (tiles) => Math.round(tiles * TS);
function entity(type, tx, ty, props = {}) {
  entities.push({ id: `e${nextId++}`, type, x: px(tx), y: px(ty), props });
}
const light = (tx, ty, color, radius, intensity = 0.6, flicker = 0.15) => entity('light', tx, ty, { color, radius, intensity, flicker });
const particles = (tx, ty, kind, wTiles, hTiles) => entity('particles', tx, ty, { kind, width: px(wTiles), height: px(hTiles) });

/* ================================================================== */
/* LAYOUT  (x = column 0..109, y = row 0..33, y grows downward)         */
/* ================================================================== */

// Shell: ceiling, floor, end walls.
fill(0, 0, W - 1, 1);
fill(0, GROUND, W - 1, H - 1);
fill(0, 0, 1, H - 1);
fill(W - 2, 0, W - 1, H - 1);

// --- A. Start: flat run (x 2-17) with one-way platforms overhead ------
entity('playerStart', 5.5, GROUND, { facing: 'right' });
oneway(7, 10, 24);
oneway(11, 14, 21, 'ledge');
oneway(7, 9, 18);
entity('checkpoint', 15.5, GROUND);

// --- B. Gaps (x 18-30) -------------------------------------------------
carve(18, GROUND, 20, 30); // 3 wide, safe pit you can hop out of
carve(24, GROUND, 27, 30); // 4 wide, brambles at the bottom
hazard(24, 27, 30, T.brambles);

// --- C. Stairs up to a plateau (x 32-50) ---------------------------------
fill(32, 26, 35, GROUND);
fill(36, 24, 39, GROUND);
fill(40, 22, 43, GROUND);
fill(44, 20, 50, GROUND);
// one-way platforms stacked above the plateau (jump up through, down+jump to drop)
oneway(45, 47, 17);
oneway(47, 49, 14, 'ledge');
oneway(44, 46, 11);
entity('checkpoint', 52.5, GROUND);

// --- D. Wall-jump shaft (x 54-60) ----------------------------------------
fill(54, 2, 55, 23);          // left wall: walk in underneath it (rows 24-27 are open)
fill(59, 12, 60, GROUND);     // right wall: climb the shaft and hop out over its top
// landing zone after the shaft, with a one-way half way down
oneway(62, 64, 20);
entity('checkpoint', 65.5, GROUND);

// --- E. Dash tunnel (x 68-82): low ceiling + a 5-tile spike gap ----------
fill(68, 2, 82, 24);          // ceiling mass: only 3 tiles of headroom
carve(72, GROUND, 76, 31);
hazard(72, 76, 31, T.spikesFloor);
entity('checkpoint', 84.5, GROUND);

// --- F. Hazard strip (x 87-92) under a spiked overhang -------------------
hazard(87, 92, GROUND, T.spikesFloor);
carve(87, GROUND, 92, GROUND); // spikes replace the floor's top row
fill(87, 18, 92, 19);
hazard(87, 92, 20, T.spikesCeil);

// --- G. Finale: one-way stairs up to a high ledge (x 94-107) -------------
oneway(95, 97, 25);
oneway(98, 100, 22, 'ledge');
oneway(101, 103, 19);
fill(104, 16, 107, GROUND);

// --- Back wall panels (never collide) -------------------------------------
if (wall) {
  rect(backWall, 30, 6, 66, GROUND - 1, 1);
  rect(backWall, 83, 12, 107, GROUND - 1, 1);
  rect(backWall, 2, 20, 8, GROUND - 1, 1);
}
function column(grid, x, y0, ids) { ids.forEach((id, i) => { if (id && inside(x, y0 + i)) grid[at(x, y0 + i)] = id; }); }
for (const x of [34, 47, 63]) column(backExtra, x, 8, [T.windowTop, T.windowMid, T.windowMid, T.windowBot]);
for (const x of [38, 51, 86, 96]) column(backExtra, x, 13, [T.bannerTop, T.bannerMid, T.bannerBot]);
for (const x of [5, 22, 66, 94]) column(backExtra, x, 2, [T.chain, T.chain, T.chain, T.chainEnd]);
backExtra[at(2, 2)] = T.cobwebL;
backExtra[at(W - 3, 2)] = T.cobwebR;

// --- Front details: grass on some floor tops, ivy under some ceilings ------
const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
for (let x = 2; x < W - 2; x++) {
  for (let y = 3; y < H; y++) {
    const floorTop = solid[at(x, y)] && !solid[at(x, y - 1)] && !mainExtra[at(x, y - 1)];
    if (floorTop && rnd(x * 3.3 + y) < 0.22) frontExtra[at(x, y - 1)] = rnd(x + y * 7.7) < 0.3 ? T.flower : T.grass;
    const ceilingBottom = solid[at(x, y - 1)] && !solid[at(x, y)] && !mainExtra[at(x, y)] && y < 26;
    if (ceilingBottom && T.ivy && rnd(x * 9.1 + y * 2.2) < 0.1 && !solid[at(x, y + 1)]) {
      frontExtra[at(x, y)] = T.ivy;
      frontExtra[at(x, y + 1)] = T.ivyEnd || T.ivy;
    }
  }
}

// --- Lights & ambience ---------------------------------------------------
light(5.5, 24.5, '#ffcc88', 260, 0.55, 0.2);
light(15.5, 25.5, '#9fd8ff', 200, 0.4, 0.05);
light(29, 24, '#ffcc88', 240, 0.5, 0.2);
light(47, 16, '#c9a0ff', 300, 0.45, 0.1);
light(57, 20, '#ffb060', 260, 0.55, 0.25);
light(57, 9, '#9fd8ff', 320, 0.4, 0.05);
light(66, 25, '#ffcc88', 220, 0.5, 0.2);
light(74.5, 30, '#ff5a4a', 220, 0.45, 0.3);
light(84.5, 25, '#ffcc88', 220, 0.5, 0.2);
light(89.5, 26.5, '#ff5a4a', 260, 0.35, 0.3);
light(105.5, 13, '#d8ff9a', 320, 0.45, 0.1);
particles(10, 22, 'dust', 16, 10);
particles(24, 14, 'leaves', 20, 22);
particles(47, 13, 'fireflies', 12, 12);
particles(57, 17, 'dust', 4, 20);
particles(74.5, 28.5, 'embers', 8, 5);
particles(89.5, 24, 'embers', 8, 7);
particles(101, 17, 'fireflies', 14, 16);

/* ================================================================== */
/* Auto-tiling                                                          */
/* ================================================================== */
function autotile(grid, terrain, alsoSame) {
  const out = new Int32Array(W * H);
  const same = (x, y) => !inside(x, y) || grid[at(x, y)] === 1 || (alsoSame && alsoSame[at(x, y)] === 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grid[at(x, y)]) continue;
      const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
      let id = terrain.tiles[mask];
      const variants = terrain.fillVariants ?? [];
      if (mask === 15 && variants.length && rnd(x * 12.9898 + y * 78.233) < 0.1) {
        id = variants[Math.floor(rnd(x * 5.1 + y * 3.7) * variants.length) % variants.length];
      }
      out[at(x, y)] = id;
    }
  }
  return out;
}

const main = autotile(solid, stone);
for (let i = 0; i < main.length; i++) if (!main[i] && mainExtra[i]) main[i] = mainExtra[i];
const back = wall ? autotile(backWall, wall, solid) : new Int32Array(W * H);
for (let i = 0; i < back.length; i++) {
  if (solid[i]) back[i] = 0; // hidden behind stone anyway
  if (backExtra[i] && !solid[i]) back[i] = backExtra[i];
}
const front = frontExtra;

/* ================================================================== */
/* Decor (only if the art catalog exists) + background                   */
/* ================================================================== */
const catalog = readJson('decor.json', { decor: [] });
const decor = [];
function place(keyPattern, tx, ty, layer = 'back', extra = {}) {
  const def = catalog.decor.find((d) => keyPattern.test(d.key));
  if (!def) return;
  decor.push({ id: `d${decor.length + 1}`, key: def.key, x: px(tx), y: px(ty), layer, ...extra });
}
// (pattern, tile x, tile y of the anchor, layer, extras) - the first catalog key matching the pattern is used.
place(/candelabra/i, 3.5, GROUND);
place(/signpost/i, 9, GROUND);
place(/wallTorch|torch/i, 5.5, 24);
place(/barrel/i, 13, GROUND);
place(/crate/i, 14, GROUND, 'back', { scale: 0.9 });
place(/hangingLantern|lantern/i, 12.5, 2);
place(/tombstoneRound|tomb/i, 22, GROUND);
place(/tombstoneCross|cross/i, 29.5, GROUND);
place(/deadTree|tree/i, 22.5, GROUND, 'far');
place(/mushrooms/i, 19.5, 31);
place(/ironFence|fence/i, 30.5, GROUND, 'front');
place(/gargoyle|statue/i, 49, 20, 'back', { flipX: true });
place(/pillar/i, 37.5, 24);
place(/banner/i, 42, 8);
place(/windowArch|window/i, 47, 10, 'far');
place(/knightArmor|armor/i, 52, GROUND);
place(/chandelier/i, 57.5, 2);
place(/wallTorch|torch/i, 57.5, 20);
place(/candelabra/i, 66.5, GROUND);
place(/cobweb/i, 61, 2, 'front');
place(/batRoost|bat/i, 64, 2);
place(/pumpkin/i, 70, GROUND);
place(/candelabra/i, 85.5, GROUND);
place(/brokenColumn|column/i, 94, GROUND);
place(/hangingLantern|lantern/i, 99, 2);
place(/roseWindow|window/i, 99, 10, 'far');
place(/ivyCluster|ivy/i, 105.5, 2, 'front');
place(/chest/i, 106, 16);
place(/cauldron/i, 104.8, 16);

const backgrounds = readJson('backgrounds.json', { backgrounds: [] });
// Prefer an outdoor/night theme for this mostly open room, else whatever comes first.
const background =
  (backgrounds.backgrounds.find((b) => /exterior|night|outside/i.test(b.key)) ?? backgrounds.backgrounds[0])?.key ?? 'default';

/* ================================================================== */
/* Write files                                                          */
/* ================================================================== */
const room = {
  version: 1,
  id: 'room-001',
  name: 'Test Hall',
  width: W,
  height: H,
  background,
  layers: { back: Array.from(back), main: Array.from(main), front: Array.from(front) },
  decor,
  entities,
};
const world = {
  version: 1,
  name: 'Gothic Prototype',
  startRoom: 'room-001',
  rooms: [{ id: 'room-001', name: 'Test Hall', x: 0, y: 0, w: W, h: H }],
};

mkdirSync(join(CONTENT, 'rooms'), { recursive: true });
writeFileSync(join(CONTENT, 'rooms', 'room-001.json'), JSON.stringify(room) + '\n');
const worldFile = join(CONTENT, 'world.json');
if (!existsSync(worldFile) || process.argv.includes('--world')) {
  writeFileSync(worldFile, JSON.stringify(world, null, 2) + '\n');
}
console.log(`room-001: ${W}x${H} tiles, ${entities.length} entities, ${decor.length} decor, background "${background}"`);
