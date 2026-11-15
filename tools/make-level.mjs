#!/usr/bin/env node
/**
 * THE LAMPLIGHTER'S CLIMB  -  the prototype level, written as a script.
 * =====================================================================
 * Run with:   node tools/make-level.mjs
 *
 * This script is now the SOURCE of content/rooms/room-001.json (it also
 * updates that room's size in content/world.json). The older
 * tools/make-test-room.mjs still exists as a simpler example, but running it
 * would overwrite this level with the plain test room - so don't :)
 *
 * NOTE: re-running overwrites room-001.json. If you hand-edit the room in the
 * World Editor and want to keep the changes, don't run this again (or port
 * your changes back into the script).
 *
 * HOW TO READ IT
 * --------------
 *  1. "Toolbox"   - small helpers: fill() stone, carve() holes, plank(),
 *                   backWall(), decor(), light(), particles()...
 *  2. "The level" - five named sections, left to right. Each one first builds
 *                   the GAMEPLAY (what you can stand on / get hurt by) and
 *                   then DRESSES it (walls behind, props, lights).
 *  3. "Finishing" - automatic touches (grass, ivy, shadows), auto-tiling and
 *                   writing the files.
 *
 * Everything is measured in TILES: x = column (0 = left), y = row (0 = top,
 * so a BIGGER y is LOWER on screen). One tile is 48 px and the hero is about
 * 1.4 tiles tall. The screen shows roughly 27 x 15 tiles.
 *
 * WHAT THE HERO CAN DO (default content/game-config.json, measured with the
 * real physics code - keep required jumps well inside these):
 *   single jump ......... up 3 tiles, or across a 5-tile gap     (we use <= 3)
 *   + double jump ....... up 5 tiles, or across ~10 tiles
 *   jump + dash ......... across ~10 tiles
 *   jump + double + dash  across ~14 tiles (12 when also climbing 4)
 *   wall jump ........... about 3 tiles up per kick; shafts are 4 tiles wide
 *
 * The script is deterministic: the same script always writes the same file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');
const readJson = (rel) => JSON.parse(readFileSync(join(CONTENT, rel), 'utf8'));

/* ====================================================================== */
/* 1. TOOLBOX                                                               */
/* ====================================================================== */

const tileset = readJson('tileset.json');
const catalog = readJson('decor.json');
const TS = tileset.tileSize; // 48

/** Look a tile id up by its name in content/tileset.json (fails loudly on typos). */
const tileNames = new Map(tileset.tiles.map((t) => [t.name, t.id]));
function tileId(name) {
  if (!tileNames.has(name)) throw new Error(`tileset.json has no tile named "${name}"`);
  return tileNames.get(name);
}
const stone = tileset.terrains.find((t) => t.name === 'castle-stone'); // main layer, solid
const wall = tileset.terrains.find((t) => t.name === 'castle-wall'); // back layer, scenery

const T = {
  plankL: tileId('plank-left'), plankM: tileId('plank-middle'), plankR: tileId('plank-right'),
  ledgeL: tileId('ledge-left'), ledgeM: tileId('ledge-middle'), ledgeR: tileId('ledge-right'),
  spikes: tileId('spikes-floor'), brambles: tileId('brambles'),
  pillarTop: tileId('pillar-top'), pillarMid: tileId('pillar-middle'), pillarBase: tileId('pillar-base'),
  blockMoon: tileId('block-moon'), blockRune: tileId('block-rune'), blockPlain: tileId('block-plain'),
  chain: tileId('chain'), chainEnd: tileId('chain-end'),
  grass: tileId('grass-tuft'), flower: tileId('grass-flower'),
  ivy: tileId('ivy-hanging'), ivyEnd: tileId('ivy-end'),
  rimBottom: tileId('rim-bottom'), rimTop: tileId('rim-top'),
};

/* ---- the canvas ---------------------------------------------------------- */
const W = 150; // room width in tiles
const H = 46; // room height in tiles
const GROUND = 42; // row of the graveyard / great-hall floor surface

const solid = new Uint8Array(W * H); // 1 = castle stone (auto-tiled later)
const backWall = new Uint8Array(W * H); // 1 = castle wall behind the hero (auto-tiled later)
const mainExtra = new Int32Array(W * H); // planks, hazards, ornament blocks (tile ids)
const frontExtra = new Int32Array(W * H); // tiles drawn IN FRONT of the hero
const noAuto = new Uint8Array(W * H); // 1 = keep automatic grass/ivy/shadow away from here
const at = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
function rect(grid, x0, y0, x1, y1, v) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) grid[at(x, y)] = v;
}

/** Deterministic "random" number 0..1 from any number (same input = same output). */
const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/* ---- gameplay tiles ------------------------------------------------------ */
/** Solid stone rectangle (inclusive tile coordinates). */
const fill = (x0, y0, x1, y1) => rect(solid, x0, y0, x1, y1, 1);
/** Remove stone (make a hole, a doorway, a pit...). */
const carve = (x0, y0, x1, y1) => rect(solid, x0, y0, x1, y1, 0);
/** A one-way platform: jump up through it, stand on it, Down+Jump to drop. kind: 'plank' (wood) or 'ledge' (mossy stone). */
function plank(x0, x1, y, kind = 'plank') {
  for (let x = x0; x <= x1; x++) {
    const left = x === x0, right = x === x1;
    mainExtra[at(x, y)] = kind === 'ledge'
      ? (left ? T.ledgeL : right ? T.ledgeR : T.ledgeM)
      : (left ? T.plankL : right ? T.plankR : T.plankM);
  }
}
/** A row of hazard tiles (touching them sends the hero back to the last checkpoint). */
function hazard(x0, x1, y, id) {
  for (let x = x0; x <= x1; x++) { mainExtra[at(x, y)] = id; solid[at(x, y)] = 0; }
  rect(noAuto, x0 - 1, y - 2, x1 + 1, y, 1); // never hide a hazard behind grass or ivy
}
/** A single solid ornament block (moon / rune / plain). */
const block = (x, y, id) => { mainExtra[at(x, y)] = id; solid[at(x, y)] = 0; };

/* ---- scenery tiles ------------------------------------------------------- */
/** Castle wall BEHIND the hero (no collision). Makes a place feel indoors. */
const backFill = (x0, y0, x1, y1) => rect(backWall, x0, y0, x1, y1, 1);
/**
 * A crumbling piece of back wall for outdoor ruins: like backFill, but the top
 * edge goes up and down and bites are taken out of the sides, so it looks organic.
 */
function ruin(x0, y0, x1, y1, seed = 1) {
  for (let x = x0; x <= x1; x++) {
    // Smooth-ish skyline: a slow wave plus a little noise, never more than 3 tiles lower.
    const wave = Math.sin((x + seed * 3.7) * 0.9) * 1.2 + rnd(x * 1.7 + seed * 11) * 1.6;
    const top = y0 + Math.max(0, Math.round(wave + 0.6));
    for (let y = top; y <= y1; y++) {
      const edge = x === x0 || x === x1;
      if (edge && rnd(x * 5.3 + y * 9.1 + seed) < 0.45) continue; // bite out of the side
      if (inside(x, y)) backWall[at(x, y)] = 1;
    }
  }
}
/** A full-height stone column drawn IN FRONT of the hero (pure decoration, no collision). */
function frontPillar(x, yTop, yBase) {
  for (let y = yTop; y <= yBase; y++) {
    frontExtra[at(x, y)] = y === yTop ? T.pillarTop : y === yBase ? T.pillarBase : T.pillarMid;
  }
}
/** A chain hanging in the foreground from (x, y) for `length` tiles, ending in a ring. */
function frontChain(x, y, length) {
  for (let i = 0; i < length; i++) frontExtra[at(x, y + i)] = i === length - 1 ? T.chainEnd : T.chain;
}

/* ---- decor (free-placed pictures from content/decor.json) --------------- */
const decorList = [];
const px = (tiles) => Math.round(tiles * TS);
/**
 * Place a decor picture. (tx, ty) is where its ANCHOR goes, in tiles - for
 * things standing on the floor that is the bottom-centre, so `ty` is simply
 * the floor row; hanging things anchor at their top.
 * options: layer 'far' (behind walls) | 'back' (default, behind hero) | 'front',
 *          flipX, scale, rotation (degrees), alpha.
 */
function decor(key, tx, ty, options = {}) {
  if (!catalog.decor.some((d) => d.key === key)) throw new Error(`decor.json has no decor "${key}"`);
  const { layer = 'back', ...rest } = options;
  decorList.push({ id: `d${decorList.length + 1}`, key, x: px(tx), y: px(ty), layer, ...rest });
}

/* ---- entities ------------------------------------------------------------ */
const entities = [];
function entity(type, tx, ty, props = {}) {
  entities.push({ id: `e${entities.length + 1}`, type, x: px(tx), y: px(ty), props });
}
/** A soft glow. Colours used below: */
const WARM = '#ffb46a'; // candles, torches
const GOLD = '#ffe2a0'; // lanterns
const MOON = '#9fc4ff'; // moonlight
const ROSE = '#ff86b8'; // stained glass
const TEAL = '#7df2c8'; // magic / mushrooms
const RED = '#ff5a4a'; // danger
const light = (tx, ty, color, radius, intensity = 0.5, flicker = 0.12) =>
  entity('light', tx, ty, { color, radius, intensity, flicker });
/** Drifting motes; (tx, ty) is the CENTRE of an area w x h tiles. kind: dust | embers | fireflies | leaves. */
const particles = (tx, ty, kind, w, h) => entity('particles', tx, ty, { kind, width: px(w), height: px(h) });
/** Respawn point; (tx, ty) = where the feet go (ty = the floor row). */
const checkpoint = (tx, ty) => entity('checkpoint', tx, ty);

/* ---- little "prefabs": a prop together with its light -------------------- */
function candelabra(tx, ty, options) { decor('candelabra', tx, ty, options); light(tx, ty - 1.1, WARM, 210, 0.2, 0.18); }
function torch(tx, ty, options) { decor('wallTorch', tx, ty, options); light(tx, ty - 0.3, WARM, 190, 0.2, 0.25); }
function lantern(tx, ty, options) { decor('hangingLantern', tx, ty, options); light(tx, ty + 1.5 * (options?.scale ?? 1), GOLD, 200, 0.16, 0.08); }
function chandelier(tx, ty, options) { decor('chandelier', tx, ty, options); light(tx, ty + 1.0, WARM, 320, 0.22, 0.12); }
/** A tall moonlit window; the picture brings its own glow, we add a faint pool of light on the floor below. */
function moonWindow(tx, ty, options) { decor('windowArch', tx, ty, { alpha: 0.85, ...options }); light(tx, ty + 2.6, MOON, 230, 0.13, 0); }
/**
 * Dress a big blank stone face (a tower side, the wall under a floor...) with
 * things drawn OVER the stone: 'window', 'banner', 'torch', 'ivy' or 'gargoyle'.
 * Only use it where the hero can never stand (inside solid stone), because
 * the front layer would hide them.
 */
function facade(kind, tx, ty, options = {}) {
  const o = { layer: 'front', ...options };
  if (kind === 'window') decor('windowArch', tx, ty, { alpha: 0.8, scale: 0.9, ...o });
  else if (kind === 'banner') decor('banner', tx, ty, o);
  else if (kind === 'torch') { decor('wallTorch', tx, ty, o); light(tx, ty - 0.3, WARM, 170, 0.18, 0.25); }
  else if (kind === 'ivy') decor('ivyCluster', tx, ty, o);
  else if (kind === 'gargoyle') decor('gargoyle', tx, ty, o);
}
/**
 * An arched doorway in a wall: carves the opening out of the stone, puts wall
 * behind it and stretches the "doorway" picture to fill the hole exactly.
 * (x0..x1 = columns of the opening, floorY = floor row, height in tiles.)
 */
function archway(x0, x1, floorY, height) {
  carve(x0, floorY - height, x1, floorY - 1);
  backFill(x0, floorY - height, x1, floorY - 1);
  const widthTiles = x1 - x0 + 1;
  decor('doorway', (x0 + x1 + 1) / 2, floorY, { scale: (widthTiles * TS) / 120 });
  rect(noAuto, x0, floorY - height, x1, floorY - 1, 1);
}

/* ====================================================================== */
/* 2. THE LEVEL                                                             */
/*    Route: graveyard -> castle hall -> wall-jump shaft -> gallery &       */
/*    library -> rooftops -> the tower top with the treasure.               */
/* ====================================================================== */

/* ---------------------------------------------------------------------- */
/* SECTION 1 - THE GRAVEYARD GATE            columns 0-26, outdoors         */
/* Teaches: nothing! A safe, pretty place to run, jump and try the buttons. */
/* ---------------------------------------------------------------------- */
{
  fill(0, GROUND, 31, H - 1); // the ground
  fill(0, 37, 0, GROUND - 1); // a broken bit of old wall at the far left...
  fill(1, 39, 1, GROUND - 1); // ...stepping down
  fill(11, 41, 19, 41); // a gentle hill
  fill(13, 40, 17, 40);
  plank(21, 23, 38, 'ledge'); // a mossy floating stone to hop onto (double jump, or from the hill)

  entity('playerStart', 5.5, GROUND, { facing: 'right' });

  // -- dressing --
  ruin(20, 37, 26, GROUND - 1, 3); // crumbling outer wall leading up to the gate
  decor('deadTree', 8.6, GROUND, { scale: 1.35 });
  lantern(10.55, 38.1, { scale: 0.9 }); // the lamplighter's first lantern, hung in the tree
  decor('deadTree', 24.6, GROUND, { layer: 'far', flipX: true, scale: 0.95, alpha: 0.9 });
  decor('signpost', 7.2, GROUND);
  decor('tombstoneCross', 3.1, GROUND, { scale: 1.1 });
  decor('tombstoneRound', 4.0, GROUND, { flipX: true, rotation: -4 });
  decor('tombstoneRound', 12.2, 41, { rotation: 5 });
  decor('tombstoneCross', 14.3, 40, { scale: 1.2 });
  decor('tombstoneRound', 16.4, 40, { scale: 1.15, flipX: true });
  decor('tombstoneCross', 18.6, 41, { rotation: -6, scale: 0.95 });
  decor('pumpkin', 10.1, GROUND);
  decor('mushrooms', 20.4, GROUND);
  decor('mushrooms', 1.6, 39, { scale: 0.8, flipX: true });
  decor('ironFence', 21.5, GROUND);
  decor('ironFence', 23.5, GROUND);
  decor('ironFence', 25.5, GROUND);
  decor('ironFence', 1.2, GROUND, { layer: 'front' });
  decor('ivyCluster', 22.3, 38.25, { layer: 'back', scale: 0.8 }); // roots under the floating stone
  decor('brokenColumn', 25.6, GROUND, { layer: 'back', scale: 0.9, flipX: true });

  light(10.1, 41.4, WARM, 130, 0.22, 0.2); // pumpkin
  light(20.4, 41.5, TEAL, 130, 0.2, 0.05); // mushrooms
  light(15, 38.5, MOON, 420, 0.22, 0); // moonlight pooling on the hill
  light(22, 36.5, MOON, 300, 0.25, 0);
  light(5.5, 40.5, MOON, 300, 0.18, 0); // a little lift where the hero starts
  particles(13, 38.5, 'fireflies', 24, 6);
  particles(20, 35, 'leaves', 16, 10);
}

/* ---------------------------------------------------------------------- */
/* SECTION 2 - CASTLE GATE & GREAT HALL      columns 27-64, indoors         */
/* Teaches: steps, a safe gap, one-way planks, and the first spikes (with a */
/* checkpoint right before them).                                           */
/* ---------------------------------------------------------------------- */
{
  // The gate tower. You walk THROUGH it, so the whole ground floor (5 wide, 4 tall) is open;
  // two foreground columns and the big arch picture make it read as a gatehouse.
  fill(27, 24, 31, GROUND - 5);
  fill(27, 23, 27, 23); fill(29, 23, 29, 23); fill(31, 23, 31, 23); // battlements on top
  archway(28, 30, GROUND, 4);
  backFill(27, 38, 31, GROUND - 1);
  frontPillar(27, 38, 41);
  frontPillar(31, 38, 41);

  // Hall shell: floor, ceiling (its top is also a roof you can walk on - see the secret).
  fill(32, GROUND, 66, H - 1);
  fill(32, 30, 66, 31);
  backFill(32, 32, 64, GROUND - 1);

  checkpoint(33.5, GROUND);

  // Steps up to a low terrace.
  block(38, 41, T.blockPlain);
  fill(39, 40, 43, 41);
  // ...a gap you can simply walk through if you miss (3 wide)...
  fill(47, 40, 50, 41);
  checkpoint(48.5, 40);
  // ...then the spike trench, crossed on two wooden planks.
  hazard(52, 58, GROUND, T.spikes);
  plank(52, 54, 39);
  plank(56, 58, 38);
  // Solid ground again; a rune block makes a handy step back up if you want to retry the planks.
  block(60, 41, T.blockRune);
  checkpoint(62.5, GROUND);

  // -- dressing --
    frontPillar(64, 32, 41);
  frontChain(45, 32, 3);
  moonWindow(36, 36.6);
  moonWindow(45, 36.2);
  moonWindow(55, 35.6);
  decor('pillar', 40.5, 40, { scale: 1 }); // short columns standing on the terraces
  decor('pillar', 49.5, 40);
  decor('gargoyle', 40.5, 36, { scale: 0.8 });
  decor('gargoyle', 49.5, 36, { scale: 0.8, flipX: true });
  decor('banner', 33.6, 32);
  decor('banner', 41.8, 32, { scale: 0.9 });
  decor('banner', 51.5, 32);
  decor('banner', 60.5, 32, { scale: 0.9 });
  chandelier(38.2, 32);
  chandelier(47.5, 32, { scale: 1.1 });
  chandelier(58.8, 32);
  candelabra(34.7, GROUND);
  decor('knightArmor', 35.9, GROUND);
  candelabra(42.6, 40, { flipX: true });
  candelabra(47.5, 40);
  decor('knightArmor', 61.3, GROUND, { flipX: true });
  decor('barrel', 63.4, GROUND);
  decor('crate', 64.3, GROUND, { scale: 0.9 });
  torch(59.5, 39.2);
  decor('cobweb', 33, 32, { alpha: 0.85 });
  decor('cobweb', 65, 32, { flipX: true, alpha: 0.85 });

  light(55, 41.6, RED, 230, 0.2, 0.3); // a warning glow over the spikes
  particles(55, 41, 'embers', 7, 3);
  particles(48, 37, 'dust', 30, 9);
  // Outside, above the gate: a banner and two torches (front layer = drawn over the stone).
  decor('banner', 29.5, 33.2, { layer: 'front', scale: 1.1 });
  torch(27.6, 36.4, { layer: 'front' });
  torch(31.4, 36.4, { layer: 'front' });
}

/* ---------------------------------------------------------------------- */
/* SECTION 3 - THE SHAFT                     columns 65-72                  */
/* Teaches: wall jumping. The walls are 4 tiles apart; every kick gains     */
/* about 3 tiles. A mossy one-way ledge half way up is a safe floor with a  */
/* checkpoint, so a slip never costs the whole climb.                       */
/* ---------------------------------------------------------------------- */
const SHAFT_TOP = 23; // floor row at the top of the shaft = lower gallery floor
{
  fill(65, 20, 66, GROUND - 1); // left wall (its top, row 20, is the take-off for the secret)
  archway(65, 66, GROUND, 3); // door from the hall
  fill(67, GROUND, 70, H - 1); // shaft floor
  fill(71, SHAFT_TOP, 81, H - 1); // right wall = the big block under the gallery
  backFill(67, 21, 70, GROUND - 1); // the wall behind stops where the shaft opens to the sky

  plank(67, 70, 33, 'ledge'); // the rest ledge
  checkpoint(68.5, 33);

  // -- dressing --
  torch(68.5, 39.6);
  lantern(69.5, 33.3, { scale: 0.85 }); // hangs under the rest ledge
  torch(69.5, 30.2);
  torch(68.5, 26.4);
  decor('cobweb', 67, 34, { alpha: 0.8, scale: 0.9 });
  decor('cobweb', 71, 34, { flipX: true, alpha: 0.8, scale: 0.8 });
  decor('batRoost', 68.2, 33.3, { scale: 0.8 });
  particles(69, 32, 'dust', 4, 18);
  light(69, 23.5, MOON, 320, 0.3, 0); // moonlight at the top pulls you upward
  lantern(71.6, 19.9, { layer: 'far', scale: 0.01, alpha: 0 }); // (invisible helper: just adds the golden light below)
}

/* ---------------------------------------------------------------------- */
/* THE SECRET - THE OLD BELFRY               columns 51-64, on the hall roof*/
/* From the top of the shaft's left wall, a brave jump + double jump + dash */
/* to the LEFT reaches a ruined belfry with a second treasure. Missing it   */
/* just drops you on the hall roof; planks lead back up.                    */
/* ---------------------------------------------------------------------- */
{
  fill(51, 16, 55, 25); // the belfry: a tower on four-tile legs (floor = row 16)...
  backFill(52, 26, 54, 29); // ...so you can walk underneath it along the roof (no dead ends!)
  decor('pillar', 51.5, 30);
  decor('pillar', 55.5, 30);
  fill(51, 11, 51, 15); // back wall of the alcove
  fill(51, 10, 54, 11); // its little roof
  backFill(52, 12, 54, 15);
  // The way back up after a miss: two planks, then a double jump onto the shaft wall.
  plank(60, 62, 27);
  plank(62, 64, 24);

  // -- dressing --
  decor('chest', 53.4, 16);
  decor('cauldron', 52.2, 16, { scale: 0.85 });
  light(52.2, 15.2, TEAL, 150, 0.22, 0.08);
  lantern(54.6, 12, { scale: 0.8 });
  decor('ivyCluster', 55.5, 16.1, { layer: 'front', scale: 0.9 });
  decor('ivyCluster', 51.4, 11.9, { scale: 0.7 });
  decor('gargoyle', 52.5, 10, { scale: 0.85 });
  decor('mushrooms', 57.5, 30, { scale: 0.9 });
  light(57.5, 29.5, TEAL, 110, 0.2, 0.05);
  decor('brokenColumn', 46.5, 30, { flipX: true });
  decor('pumpkin', 44.6, 30, { scale: 0.9 });
  light(44.6, 29.5, WARM, 110, 0.2, 0.2);
  fill(34, 29, 34, 29); fill(36, 29, 36, 29); fill(38, 29, 38, 29); // old battlements along the roof
  ruin(56, 24, 61, 29, 8); // broken wall between belfry and shaft
  lantern(65.5, 16.2, { layer: 'far', scale: 0.01, alpha: 0 }); // (invisible helper: glow marking the take-off)
  light(58, 20, MOON, 420, 0.22, 0);
  particles(57, 22, 'fireflies', 14, 12);
}

/* ---------------------------------------------------------------------- */
/* SECTION 4 - GALLERY & LIBRARY             columns 71-109, indoors        */
/* Teaches: the double jump (a ledge 4 tiles up - one jump is not enough),  */
/* then the dash (a bramble trench in a low crawlway: hop, then dash).   */
/* ---------------------------------------------------------------------- */
const UPPER = 19; // floor row of the upper gallery / library / first rooftop
{
  // Gallery front wall with its door, and the lower gallery behind it.
  fill(73, 13, 74, SHAFT_TOP - 1);
  archway(73, 74, SHAFT_TOP, 3);
  fill(73, 13, 83, 14); // ceiling
  backFill(75, 15, 83, SHAFT_TOP - 1);
  checkpoint(75.7, SHAFT_TOP);

  // The double-jump ledge: the floor steps up 4 tiles.
  fill(82, UPPER, 109, H - 1);
  checkpoint(83.5, UPPER);

  // The bramble crawl: a passage only 2 tiles high with 4 tiles of brambles in the floor.
  // The ceiling is too low for a real jump, so the ONLY way across is a little hop + DASH
  // (checked with the real physics: no combination of jumps alone makes it).
  fill(84, 13, 94, 16); // low ceiling
  backFill(84, 17, 94, UPPER - 1);
  hazard(87, 90, UPPER, T.brambles);

  // The library: a tall room again.
  fill(93, 9, 94, 12);
  fill(95, 9, 109, 10); // ceiling
  fill(108, 11, 109, UPPER - 1); // far wall...
  archway(108, 109, UPPER, 3); // ...with the door to the rooftops
  backFill(95, 11, 107, UPPER - 1);
  plank(99, 102, 16); // a reading balcony (just for fun)
  checkpoint(105.5, UPPER);

  // -- dressing: lower gallery --
  decor('bookshelf', 77.2, SHAFT_TOP, { scale: 0.95 });
  decor('bookshelf', 80.7, SHAFT_TOP, { flipX: true });
  moonWindow(78.9, 18.6);
  chandelier(78.9, 15, { scale: 0.9 });
  candelabra(79, SHAFT_TOP);
  decor('banner', 82.8, 15, { scale: 0.85 });
  candelabra(82.4, UPPER, { scale: 0.9 }); // a light on the high ledge says "come up here"
  decor('cobweb', 75, 15, { alpha: 0.8 });
  particles(79, 19, 'dust', 8, 8);
  // -- dressing: bramble crawl --
  // (no torches here: a glow at head height would wash out the hero - soft lights instead)
  light(85.2, 17.8, WARM, 150, 0.14, 0.2);
  light(92.8, 17.8, WARM, 150, 0.14, 0.2);
  light(88.5, 18.8, RED, 200, 0.2, 0.3);
  particles(88.5, 18, 'embers', 5, 2);
  // -- dressing: library --
  decor('roseWindow', 100.5, 13.1, { scale: 1.25, alpha: 0.8 });
  light(100.5, 17, ROSE, 260, 0.14, 0.04); // rosy light spilling on the floor
  decor('bookshelf', 96.2, UPPER, { scale: 1.1 });
  decor('bookshelf', 98, UPPER, { flipX: true });
  decor('bookshelf', 103.2, UPPER);
  decor('bookshelf', 105, UPPER, { scale: 1.1, flipX: true });
  chandelier(97, 11);
  chandelier(104.2, 11);
  candelabra(100.6, 16, { scale: 0.9 });
  decor('knightArmor', 106.9, UPPER, { flipX: true });
  decor('barrel', 95.5, UPPER, { scale: 0.9 });
  decor('banner', 95.6, 11, { scale: 0.9 });
  decor('banner', 107.3, 11, { scale: 0.9 });
  decor('cobweb', 95, 11, { alpha: 0.8 });
  decor('cobweb', 108, 11, { flipX: true, alpha: 0.8 });
  frontPillar(95, 11, 18);
  particles(101, 14.5, 'dust', 12, 8);
  // Outside the gallery door (top of the shaft).
  torch(73.5, 18.6, { layer: 'front' });
  decor('ivyCluster', 73.6, 13.1, { layer: 'front', flipX: true });
}

/* ---------------------------------------------------------------------- */
/* SECTION 5 - THE ROOFTOPS & THE TOWER      columns 110-149, outdoors      */
/* Combines everything: JUMP to the stone arch, DASH across the wide gap,   */
/* WALL-JUMP up the bell tower. A miss lands you on a safe lower roof with  */
/* a plank back to the start, so nobody is punished for trying.             */
/* ---------------------------------------------------------------------- */
const LOW_ROOF = 24;
const TOWER_TOP = 8;
{
  fill(110, UPPER, 113, H - 1); // balcony outside the library
  fill(110, LOW_ROOF, 149, H - 1); // the safe lower roof under everything
  plank(114, 115, 21); // the way back up from the lower roof

  // 1) JUMP: a stone arch (its roof is the platform; you can walk underneath it on the lower roof).
  fill(117, 18, 119, 19);
  // 2) DASH: seven tiles of thin air to the tower's doorstep.
  fill(127, 18, 135, H - 1);
  checkpoint(128.5, 18);
  // 3) WALL JUMP: up the inside of the bell tower.
  fill(130, 4, 131, 17);
  archway(130, 131, 18, 3);
  fill(136, TOWER_TOP, 149, H - 1); // the great tower; its flat top is the goal
  fill(147, 5, 149, 7); // parapet at the far end
  fill(147, 4, 147, 4); fill(149, 4, 149, 4);
  checkpoint(138.5, TOWER_TOP);

  // -- dressing --
  backFill(132, 9, 135, 17);
  ruin(132, 4, 135, 9, 4);
  ruin(116, 19, 120, LOW_ROOF - 1, 6); // wall behind the arch
  decor('pillar', 117.5, LOW_ROOF);
  decor('pillar', 119.5, LOW_ROOF);
  ruin(110, 20, 114, LOW_ROOF - 1, 2);
  decor('gargoyle', 113.2, UPPER, { flipX: true });
  lantern(118.5, 20, { scale: 0.85 });
  decor('ivyCluster', 117.4, 20, { scale: 0.8 });
  decor('ivyCluster', 127.5, 18.1, { layer: 'front', scale: 0.9 });
  decor('brokenColumn', 122.2, LOW_ROOF);
  decor('pumpkin', 124.5, LOW_ROOF, { flipX: true });
  light(124.5, 23.5, WARM, 110, 0.2, 0.2);
  decor('crate', 111.2, LOW_ROOF - 5, { scale: 0.9 });
  torch(129.5, 16.2, { layer: 'front' }); // by the tower door
  torch(133.5, 15.5);
  torch(134.5, 11.5);
  decor('cobweb', 132, 12, { alpha: 0.7, scale: 0.8 });
  particles(133.5, 12, 'dust', 4, 10);
  light(122, 17, MOON, 460, 0.22, 0);
  particles(121, 17, 'leaves', 22, 12);

  // The tower top: treasure, warm light, and the moon.
  decor('chest', 143.5, TOWER_TOP, { scale: 1.2 });
  light(143.5, 7.2, GOLD, 200, 0.16, 0.1);
  candelabra(145.6, TOWER_TOP, { flipX: true });
  decor('gargoyle', 147.5, 4, { flipX: true });
  decor('banner', 146.5, 5.4, { layer: 'front', scale: 0.9 });
  decor('pumpkin', 139.8, TOWER_TOP, { scale: 0.9 });
  light(139.8, 7.5, WARM, 100, 0.2, 0.2);
  decor('ivyCluster', 136.6, 8.1, { layer: 'front', scale: 0.8, flipX: true });
  light(142, 5, MOON, 520, 0.16, 0);
  particles(142.5, 5.5, 'embers', 12, 6);
  particles(140, 4, 'leaves', 18, 8);
  particles(142, 6, 'fireflies', 12, 5);
}

/* ---------------------------------------------------------------------- */
/* FACADES - windows, banners and ivy on the big blank stone faces, so the  */
/* castle looks lived-in from every screen. Pure decoration.                */
/* ---------------------------------------------------------------------- */
{
  // The block right of the shaft (under the lower gallery).
  facade('window', 75, 28.5); facade('window', 79, 28.5);
  facade('banner', 77, 25.2, { scale: 0.9 });
  facade('window', 75, 36.5, { flipX: true }); facade('window', 79, 36.5);
  facade('torch', 77, 36.4);
  facade('ivy', 73.2, 24.1, { scale: 0.9 }); facade('ivy', 80.3, 24.1, { flipX: true });
  // Under the upper gallery and the library.
  facade('window', 85, 24.2); facade('banner', 89, 21.6); facade('window', 93, 24.2);
  facade('torch', 97, 23.6); facade('window', 100.5, 24.2, { scale: 1 }); facade('torch', 104, 23.6);
  facade('banner', 96.6, 20.4, { scale: 0.85 }); facade('banner', 104.4, 20.4, { scale: 0.85 });
  facade('ivy', 83, 20.1, { scale: 0.9 }); facade('ivy', 107, 20.1, { flipX: true });
  facade('window', 111.5, 23.5, { scale: 0.8 });
  // The gate tower and hall roof, seen from the graveyard and from the secret.
  facade('window', 29.5, 28, { scale: 0.8 });
  // The bell tower and the great tower.
  facade('window', 139, 13); facade('banner', 142, 10); facade('window', 145, 13);
  facade('torch', 142, 14.5);
  facade('window', 139, 20, { flipX: true }); facade('window', 145, 20);
  facade('ivy', 137, 9.1); facade('ivy', 146.2, 9.1, { flipX: true, scale: 0.9 });
  facade('window', 129, 21.5, { scale: 0.8 }); facade('window', 133.5, 21.5, { scale: 0.8 });
  // The secret belfry.
  facade('window', 53, 21, { scale: 0.8 }); facade('ivy', 51.5, 17.1, { scale: 0.8 });
}

/* ====================================================================== */
/* 3. FINISHING                                                             */
/* ====================================================================== */

/* ---- automatic nature: grass on outdoor ground, ivy & shadows under ceilings ---- */
const isSolid = (x, y) => inside(x, y) && (solid[at(x, y)] === 1);
const isFree = (x, y) => inside(x, y) && !solid[at(x, y)] && !mainExtra[at(x, y)] && !frontExtra[at(x, y)] && !noAuto[at(x, y)];
for (let x = 0; x < W; x++) {
  for (let y = 1; y < H - 1; y++) {
    // Grass / flowers on top of stone - but never on the very edge of a platform
    // (edges must stay easy to read) and more sparsely indoors.
    const walkable = isSolid(x, y) && isFree(x, y - 1) && !isSolid(x, y - 2);
    if (walkable && isSolid(x - 1, y) && isSolid(x + 1, y)) {
      const indoors = backWall[at(x, y - 1)] === 1;
      if (rnd(x * 3.3 + y * 1.7) < (indoors ? 0.07 : 0.3)) {
        frontExtra[at(x, y - 1)] = rnd(x * 7.7 + y) < 0.25 ? T.flower : T.grass;
      }
    }
    // Under a ceiling: sometimes a dark jagged shadow, outdoors sometimes hanging ivy.
    const underCeiling = isSolid(x, y - 1) && isFree(x, y) && isFree(x, y + 1) && isFree(x, y + 2);
    if (underCeiling) {
      const indoors = backWall[at(x, y)] === 1;
      const r = rnd(x * 9.1 + y * 2.3);
      if (indoors && r < 0.3) frontExtra[at(x, y)] = T.rimTop;
      else if (!indoors && r < 0.4) { frontExtra[at(x, y)] = T.ivy; frontExtra[at(x, y + 1)] = T.ivyEnd; }
    }
  }
}
// A dark ragged rim along the very bottom of the level (only seen in the graveyard and hall).
for (let x = 0; x < W; x++) frontExtra[at(x, H - 1)] = T.rimBottom;

// Hazards sit in a trench one tile deep; indoors, put wall behind them so the sky does not peek through.
for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
  const isHazard = mainExtra[at(x, y)] === T.spikes || mainExtra[at(x, y)] === T.brambles;
  if (isHazard && backWall[at(x, y - 1)]) backWall[at(x, y)] = 1;
}

/* ---- auto-tiling: pick the right edge/corner piece for every stone & wall tile ---- */
function autotile(grid, terrain, alsoSame, variantChance) {
  const out = new Int32Array(W * H);
  const same = (x, y) => !inside(x, y) || grid[at(x, y)] === 1 || (alsoSame && alsoSame[at(x, y)] === 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grid[at(x, y)]) continue;
      // 4-bit neighbour mask: N=1, E=2, S=4, W=8 (bit set when that neighbour is the same terrain).
      const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
      let id = terrain.tiles[mask];
      const variants = terrain.fillVariants ?? [];
      if (mask === 15 && variants.length && rnd(x * 12.9898 + y * 78.233) < variantChance) {
        id = variants[Math.floor(rnd(x * 5.1 + y * 3.7) * variants.length) % variants.length];
      }
      out[at(x, y)] = id;
    }
  }
  return out;
}
const main = autotile(solid, stone, null, 0.06);
for (let i = 0; i < main.length; i++) if (mainExtra[i]) main[i] = mainExtra[i];
// Back wall also "connects" to solid stone, so walls meet floors and ceilings without a seam.
const back = autotile(backWall, wall, solid, 0.14);
for (let i = 0; i < back.length; i++) if (solid[i]) back[i] = 0; // hidden behind stone anyway

/* ---- sanity checks (catch mistakes before the game does) ---- */
const startCount = entities.filter((e) => e.type === 'playerStart').length;
if (startCount !== 1) throw new Error(`expected exactly 1 playerStart, found ${startCount}`);
for (const e of entities) {
  if (e.type !== 'checkpoint' && e.type !== 'playerStart') continue;
  const tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS);
  const standsOn = main[at(tx, ty)];
  const def = tileset.tiles.find((t) => t.id === standsOn);
  if (!def || (def.collision !== 'solid' && def.collision !== 'oneway')) {
    throw new Error(`${e.type} at tile (${tx}, ${ty}) is not standing on anything`);
  }
}

/* ---- write the files ---- */
const ROOM_ID = 'room-001';
const ROOM_NAME = "The Lamplighter's Climb";
const room = {
  version: 1,
  id: ROOM_ID,
  name: ROOM_NAME,
  width: W,
  height: H,
  background: 'castle-exterior-night',
  layers: { back: Array.from(back), main: Array.from(main), front: Array.from(frontExtra) },
  decor: decorList,
  entities,
};
mkdirSync(join(CONTENT, 'rooms'), { recursive: true });
writeFileSync(join(CONTENT, 'rooms', `${ROOM_ID}.json`), JSON.stringify(room) + '\n');

// Keep the world map in step: only this room's name and size are touched.
const world = readJson('world.json');
const ref = world.rooms.find((r) => r.id === ROOM_ID);
if (ref) { ref.name = ROOM_NAME; ref.w = W; ref.h = H; }
else world.rooms.push({ id: ROOM_ID, name: ROOM_NAME, x: 0, y: 0, w: W, h: H });
writeFileSync(join(CONTENT, 'world.json'), JSON.stringify(world, null, 2) + '\n');

console.log(`${ROOM_ID} "${ROOM_NAME}": ${W}x${H} tiles, ${entities.length} entities, ${decorList.length} decor`);
