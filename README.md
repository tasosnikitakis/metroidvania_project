# Metroidvania Prototype

A gothic-fantasy cartoon metroidvania, built to be designed by a family. This
is the **prototype stage**: one level, the hero (Wick, a small lamplighter),
the environment, and two editors for shaping the game.

![Opening screen](docs/screenshots/01-graveyard-gate.png)

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open:

| Page | URL |
|---|---|
| The game | http://localhost:5173/ |
| World Editor | http://localhost:5173/editor/world.html |
| Game Editor | http://localhost:5173/editor/game.html |

### Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | Arrows or A / D | Stick or D-pad |
| Jump (hold for higher, press again in the air for a double jump) | Space, Z or W / Up | A |
| Dash | Shift or C | RB or B |
| Attack | X or J | X |
| Drop through a wooden platform | Down + Jump | Down + A |
| Respawn at start | R | |
| Debug overlay | F1 or ` | |

Slide down a wall by pushing into it; jump while sliding to wall-jump.
Bindings live in `src/game/input/bindings.ts`.

## The editors

### World Editor — build rooms

- Pick a terrain and drag to paint; edges and corners pick themselves.
- Tools: **B** terrain, **T** tiles, **E** eraser, **R** box, **F** fill,
  **I** pick, **M** select, **D** decor, **N** entity, **P** play from here.
- **1 / 2 / 3** choose the back / main / front layer. **G** grid,
  **H** collision overlay, **C** shows what the player's camera sees.
- **Tab** opens the world map: drag rooms next to each other to connect them.
- **Ctrl+S** saves. **Play ▶** saves and opens the game in that room; a game
  tab that is already open reloads itself after each save.
- Undo is **Ctrl+Z**; unsaved work is kept as a draft and offered back if the
  page closes.

### Game Editor — tune the feel and the animation

- **Game Feel** tab: sliders for every movement value (run speed, jump height,
  dash, wall jump, camera, squash and stretch). The game on the right changes
  instantly. Read-outs show jump height and distance in tiles. Presets let you
  try a whole feel at once.
- **Animation** tab: pick an animation, click a body part and drag to pose it.
  This writes a keyframe at the playhead. The timeline moves, copies and
  deletes keys. **To game** previews the edit on the running hero.

Saving animations writes `content/rigs/hero.rig.json`. Running `npm run art`
regenerates that file from `tools/art/hero-anims.mjs` and **overwrites editor
edits**, so export a backup first if you use both.

## How it is put together

| Folder | What lives there |
|---|---|
| `content/` | Everything the game loads, as JSON: rooms, world map, tuning, tileset, decor, backgrounds, hero rig |
| `src/shared/` | The data formats (`types.ts`) and entity list (`entities.ts`) shared by game and editors |
| `src/game/` | The game: physics, player, camera, world rendering, effects |
| `src/rig/` | Skeletal animation: pose maths and the Phaser view |
| `src/editor/` | The two editors |
| `server/` | Small server: serves the game and reads/writes `content/` |
| `tools/art/` | Scripts that draw all the art; `palette.mjs` holds the colours |
| `tools/make-level.mjs` | The script that built the prototype level, as a worked example |
| `public/assets/` | Generated images |

**Stack:** TypeScript, Phaser 4 (WebGL), Vite, Fastify.

**Why it is smooth:** the game simulates at a fixed 120 steps per second and
draws in-between positions, so motion is even on any display refresh rate.
The hero is a skeleton of separate parts moved by keyframes rather than a
strip of drawn frames, so animation is interpolated every frame and blends
between moves.

### Changing the art

```bash
npm run art
```

regenerates every image. Change colours in `tools/art/palette.mjs`; each tile,
prop and hero part is one small drawing function in `tools/art/`. Add new
tiles at the end of `tiles.mjs` so existing rooms keep their tile numbers.

### Adding a new kind of entity

Add it to `src/shared/entities.ts` and it appears in the World Editor's palette
with a property form. Give it behaviour in `src/game/world/entities.ts`.

### Checks

```bash
npm run typecheck
```

```bash
npm test
```

## Deploying to Railway

The repo includes `railway.json` (build with `npm run build`, start with
`npm start`, health check at `/api/health`).

1. Create a Railway project from this GitHub repository.
2. Generate a public domain for the service.
3. Optional, to edit levels on the live site:
   - Set `EDITOR_TOKEN` to a password. The editors ask for it before saving.
     Without it the live editors are read-only (Export / Import still works).
   - Attach a volume (for example at `/data`) and set `CONTENT_DIR=/data/content`.
     Without a volume, edits made on the live site are lost on the next deploy.
     On first start the volume is filled from the repo's `content/` folder;
     files already on the volume are never overwritten.

The simplest workflow is to edit locally, commit `content/`, and let Railway
redeploy.

## Not in the prototype yet

Sound, enemies, touch controls, saving progress, and more than one room
(room-to-room transitions are implemented and waiting for a second room).
