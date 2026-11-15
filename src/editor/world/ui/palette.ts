/**
 * The palettes in the right sidebar: Terrain / Tiles / Decor / Entities.
 * Each tab's DOM is built once per content load; afterwards only the
 * "which one is chosen" highlight is updated.
 */
import { ENTITY_TYPES } from '../../../shared/entities';
import type { DecorDef, DecorInstance, TileDef } from '../../../shared/types';
import { assetUrl, getImage, onAssetLoaded } from '../render/assets';
import type { Stamp } from '../logic/tileOps';
import type { Editor } from '../state/editor';
import { clear, h, icon, throttled } from './dom';

export type PaletteTab = 'terrain' | 'tiles' | 'decor' | 'entities';
const TAB_LABELS: Record<PaletteTab, string> = { terrain: 'Terrain', tiles: 'Tiles', decor: 'Decor', entities: 'Entities' };
const BRUSH_SIZES = [1, 2, 3, 5];

/** Draw one tile from the tileset image onto a small palette canvas. */
function drawTileTo(ctx: CanvasRenderingContext2D, editor: Editor, id: number, x: number, y: number, size: number): void {
  const ts = editor.tileset;
  const img = getImage(ts.image);
  if (id <= 0) return;
  if (img) {
    const cell = ts.tileSize * ts.imageScale;
    const col = (id - 1) % ts.columns;
    const row = Math.floor((id - 1) / ts.columns);
    ctx.drawImage(img, col * cell, row * cell, cell, cell, x, y, size, size);
  } else {
    ctx.fillStyle = `hsl(${(id * 47) % 360} 35% 45%)`;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  }
}

function hiDpiCanvas(cssW: number, cssH: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { width: Math.round(cssW * dpr), height: Math.round(cssH * dpr), style: { width: `${cssW}px`, height: `${cssH}px` } });
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function brushSizeRow(editor: Editor): { el: HTMLElement; sync: () => void } {
  const buttons = BRUSH_SIZES.map((size) => h('button', {
    type: 'button', class: 'size-btn', title: `Brush ${size} × ${size} tiles`, 'aria-label': `Brush size ${size}`,
    onclick: () => editor.setBrushSize(size),
  }, h('span', { class: 'size-dot', style: { width: `${6 + size * 4}px`, height: `${6 + size * 4}px` } }), String(size)));
  const el = h('div', { class: 'size-row' }, h('span', { class: 'bar-label' }, 'Brush size'), ...buttons);
  return { el, sync: () => buttons.forEach((b, i) => b.classList.toggle('active', editor.brushSize === BRUSH_SIZES[i])) };
}

/* ------------------------------------------------------------------ */

interface TabView { el: HTMLElement; sync(): void; redrawImages?(): void }

function terrainTab(editor: Editor): TabView {
  const sizes = brushSizeRow(editor);
  const grid = h('div', { class: 'terrain-grid' });
  const el = h('div', { class: 'tab-body' }, sizes.el, grid);
  // A 3x3 lump of terrain shows off its corners and edges. Masks: N=1 E=2 S=4 W=8.
  const PREVIEW = [6, 14, 12, 7, 15, 13, 3, 11, 9];
  const cards: Array<{ button: HTMLButtonElement; paint: () => void }> = [];
  editor.tileset.terrains.forEach((t, index) => {
    const { canvas, ctx } = hiDpiCanvas(84, 84);
    const paint = (): void => {
      ctx.clearRect(0, 0, 84, 84);
      PREVIEW.forEach((mask, i) => drawTileTo(ctx, editor, t.tiles[mask], 6 + (i % 3) * 24, 6 + Math.floor(i / 3) * 24, 24));
    };
    const button = h('button', {
      type: 'button', class: 'terrain-card', title: `Paint "${t.name}" (goes on the ${t.layer} layer)`,
      onclick: () => editor.pickTerrain(index),
    }, canvas, h('span', { class: 'card-name' }, prettyName(t.name)), h('span', { class: `layer-tag ${t.layer}` }, t.layer));
    cards.push({ button, paint });
    grid.append(button);
    paint();
  });
  if (cards.length === 0) {
    grid.append(h('p', { class: 'muted empty' }, 'No terrains in the tileset yet. Use the Tiles tab to place single tiles.'));
  } else {
    el.append(h('p', { class: 'muted small tip' }, 'Tip: just drag on the room. Edges and corners sort themselves out.'));
  }
  return {
    el,
    sync: () => {
      sizes.sync();
      cards.forEach((c, i) => c.button.classList.toggle('active', editor.brush.kind === 'terrain' && editor.brush.index === i));
    },
    redrawImages: () => cards.forEach((c) => c.paint()),
  };
}

function prettyName(name: string): string {
  const s = name.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How a tile group is laid out in the palette: a grid of tile ids (0 = empty cell). */
interface GroupLayout { name: string; cols: number; rows: number; cells: number[] }

export function layoutGroup(name: string, tiles: TileDef[], atlasColumns: number, maxCols = 7): GroupLayout {
  const ids = tiles.map((t) => t.id).sort((a, b) => a - b);
  const colOf = (id: number): number => (id - 1) % atlasColumns;
  const rowOf = (id: number): number => Math.floor((id - 1) / atlasColumns);
  const c0 = Math.min(...ids.map(colOf));
  const c1 = Math.max(...ids.map(colOf));
  const r0 = Math.min(...ids.map(rowOf));
  const r1 = Math.max(...ids.map(rowOf));
  const cols = c1 - c0 + 1;
  const rows = r1 - r0 + 1;
  // Keep the tileset's own arrangement when it fits (so multi-tile pictures stay together)...
  if (cols <= maxCols + 1 && cols * rows <= ids.length * 2) {
    const cells = new Array<number>(cols * rows).fill(0);
    for (const id of ids) cells[(rowOf(id) - r0) * cols + (colOf(id) - c0)] = id;
    return { name, cols, rows, cells };
  }
  // ...otherwise just pack the tiles in order.
  const packedCols = Math.min(maxCols, ids.length);
  const packedRows = Math.ceil(ids.length / packedCols);
  const cells = new Array<number>(packedCols * packedRows).fill(0);
  ids.forEach((id, i) => { cells[i] = id; });
  return { name, cols: packedCols, rows: packedRows, cells };
}

function tilesTab(editor: Editor): TabView {
  const sizes = brushSizeRow(editor);
  const el = h('div', { class: 'tab-body' }, sizes.el);
  const groups = new Map<string, TileDef[]>();
  for (const t of editor.tileset.tiles) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group)!.push(t);
  }
  const painters: Array<() => void> = [];
  const info = h('div', { class: 'tile-info muted small' }, 'Click a tile, or drag across several to make a stamp.');

  for (const [name, tiles] of groups) {
    const layout = layoutGroup(name, tiles, editor.tileset.columns);
    const cell = Math.min(40, Math.floor(288 / layout.cols));
    const { canvas, ctx } = hiDpiCanvas(layout.cols * cell, layout.rows * cell);
    canvas.classList.add('tile-canvas');
    let dragFrom: { x: number; y: number } | null = null;
    let dragTo: { x: number; y: number } | null = null;

    const paint = (): void => {
      ctx.clearRect(0, 0, layout.cols * cell, layout.rows * cell);
      const chosen = editor.brush.kind === 'tiles' ? new Set(editor.brush.stamp.ids.filter((i) => i > 0)) : new Set<number>();
      layout.cells.forEach((id, i) => {
        const x = (i % layout.cols) * cell;
        const y = Math.floor(i / layout.cols) * cell;
        if (id <= 0) return;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        drawTileTo(ctx, editor, id, x + 2, y + 2, cell - 4);
        if (chosen.has(id) && !dragFrom) {
          ctx.strokeStyle = '#6ee7ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
        }
      });
      if (dragFrom && dragTo) {
        const x0 = Math.min(dragFrom.x, dragTo.x);
        const y0 = Math.min(dragFrom.y, dragTo.y);
        const w = Math.abs(dragTo.x - dragFrom.x) + 1;
        const hh = Math.abs(dragTo.y - dragFrom.y) + 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 * cell + 1, y0 * cell + 1, w * cell - 2, hh * cell - 2);
      }
    };
    const cellAt = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.min(layout.cols - 1, Math.max(0, Math.floor((e.clientX - r.left) / cell))),
        y: Math.min(layout.rows - 1, Math.max(0, Math.floor((e.clientY - r.top) / cell))),
      };
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragFrom = dragTo = cellAt(e);
      paint();
    });
    canvas.addEventListener('pointermove', (e) => {
      const c = cellAt(e);
      if (dragFrom) {
        dragTo = c;
        paint();
      }
      const def = editor.tileDefs.get(layout.cells[c.y * layout.cols + c.x]);
      info.textContent = def ? `${prettyName(def.name)} · ${def.collision === 'none' ? 'no collision' : def.collision}` : 'Click a tile, or drag across several to make a stamp.';
    });
    const finish = (): void => {
      if (!dragFrom || !dragTo) return;
      const x0 = Math.min(dragFrom.x, dragTo.x);
      const y0 = Math.min(dragFrom.y, dragTo.y);
      const w = Math.abs(dragTo.x - dragFrom.x) + 1;
      const hh = Math.abs(dragTo.y - dragFrom.y) + 1;
      const ids: number[] = [];
      for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + w; x++) ids.push(layout.cells[y * layout.cols + x]);
      dragFrom = dragTo = null;
      const stamp: Stamp = { w, h: hh, ids };
      if (ids.some((i) => i > 0)) editor.pickTiles(stamp);
      paint();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => { dragFrom = dragTo = null; paint(); });
    painters.push(paint);
    el.append(h('div', { class: 'palette-group' }, h('h4', {}, prettyName(name)), canvas));
    paint();
  }
  if (groups.size === 0) el.append(h('p', { class: 'muted empty' }, 'No tiles yet - the tileset (content/tileset.json) has not been made.'));
  else el.append(info);
  return { el, sync: () => { sizes.sync(); painters.forEach((p) => p()); }, redrawImages: () => painters.forEach((p) => p()) };
}

function selectModeButton(label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: 'mode-btn', title: 'Stop placing: click things in the room to select and move them (Esc)', onclick }, icon('pointer', 18), h('span', {}, label));
}

function decorTab(editor: Editor): TabView {
  const el = h('div', { class: 'tab-body' });
  const selectBtn = selectModeButton('Select & move', () => editor.armDecor(null));
  const layerNames: Array<[DecorInstance['layer'], string, string]> = [
    ['far', 'Far', 'Far: behind the back walls'],
    ['back', 'Back', 'Back: behind the player (the usual choice)'],
    ['front', 'Front', 'Front: in front of the player'],
  ];
  const layerButtons = layerNames.map(([layer, label, title]) => h('button', {
    type: 'button', class: 'seg-btn', title,
    onclick: () => { editor.decorLayer = layer; editor.events.emit('palette'); },
  }, label));
  const filter = h('input', { type: 'text', class: 'filter', placeholder: 'Search decor…', 'aria-label': 'Search decor' });
  el.append(
    selectBtn,
    h('div', { class: 'seg-row' }, h('span', { class: 'bar-label' }, 'Place on'), h('div', { class: 'seg' }, ...layerButtons)),
    filter,
  );

  const groups = new Map<string, DecorDef[]>();
  for (const d of editor.decorDefs.values()) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d);
  }
  const cards: Array<{ def: DecorDef; button: HTMLButtonElement; group: HTMLElement }> = [];
  for (const [name, defs] of groups) {
    const grid = h('div', { class: 'decor-grid' });
    const group = h('div', { class: 'palette-group' }, h('h4', {}, prettyName(name)), grid);
    for (const def of defs) {
      const button = h('button', {
        type: 'button', class: 'decor-card', title: `${def.name} - click, then click in the room to place it`,
        onclick: () => editor.armDecor(editor.decorArmed === def.key ? null : def.key),
      }, h('img', { src: assetUrl(def.image), alt: '', loading: 'lazy', draggable: 'false' }), h('span', { class: 'card-name' }, def.name));
      cards.push({ def, button, group });
      grid.append(button);
    }
    el.append(group);
  }
  if (cards.length === 0) el.append(h('p', { class: 'muted empty' }, 'No decor yet - the decor catalog (content/decor.json) has not been made.'));

  const applyFilter = (): void => {
    const q = filter.value.trim().toLowerCase();
    const visibleGroups = new Set<HTMLElement>();
    for (const c of cards) {
      const show = q === '' || c.def.name.toLowerCase().includes(q) || c.def.key.toLowerCase().includes(q) || c.def.group.toLowerCase().includes(q);
      c.button.hidden = !show;
      if (show) visibleGroups.add(c.group);
    }
    for (const c of cards) c.group.hidden = !visibleGroups.has(c.group);
  };
  filter.addEventListener('input', applyFilter);

  return {
    el,
    sync: () => {
      selectBtn.classList.toggle('active', editor.decorArmed === null && editor.tool === 'decor');
      layerButtons.forEach((b, i) => b.classList.toggle('active', editor.decorLayer === layerNames[i][0]));
      for (const c of cards) c.button.classList.toggle('active', editor.decorArmed === c.def.key && editor.tool === 'decor');
    },
  };
}

function entitiesTab(editor: Editor): TabView {
  const el = h('div', { class: 'tab-body' });
  const selectBtn = selectModeButton('Select & move', () => editor.armEntity(null));
  el.append(selectBtn);
  const cards = ENTITY_TYPES.map((def) => {
    const button = h('button', {
      type: 'button', class: 'entity-card', title: `${def.name} - click, then click in the room to place it`,
      onclick: () => editor.armEntity(editor.entityArmed === def.type ? null : def.type),
    },
      h('span', { class: 'entity-glyph', style: { color: def.color, borderColor: def.color } }, def.glyph),
      h('span', { class: 'entity-text' },
        h('span', { class: 'card-name' }, def.name, def.unique ? h('span', { class: 'badge' }, 'one per room') : null),
        h('span', { class: 'muted small' }, def.description),
      ),
    );
    el.append(button);
    return { def, button };
  });
  return {
    el,
    sync: () => {
      selectBtn.classList.toggle('active', editor.entityArmed === null && editor.tool === 'entity');
      for (const c of cards) c.button.classList.toggle('active', editor.entityArmed === c.def.type && editor.tool === 'entity');
    },
  };
}

/* ------------------------------------------------------------------ */

export function buildPalette(editor: Editor): HTMLElement {
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'palette-body' });
  const root = h('div', { class: 'palette' }, tabBar, body);

  let active: PaletteTab = 'terrain';
  let views: Partial<Record<PaletteTab, TabView>> = {};
  let builtFor: unknown = null; // the tileset object the tabs were built from

  const tabButtons = (Object.keys(TAB_LABELS) as PaletteTab[]).map((tab) => {
    const b = h('button', {
      type: 'button', class: 'tab', role: 'tab',
      onclick: () => {
        // Choosing a tab also chooses the matching tool, so one click gets you painting.
        if (tab === 'terrain') editor.setTool('terrain');
        else if (tab === 'tiles') editor.setTool('tile');
        else if (tab === 'decor') editor.setTool('decor');
        else editor.setTool('entity');
        show(tab);
      },
    }, TAB_LABELS[tab]);
    tabBar.append(b);
    return [tab, b] as const;
  });

  const build = (tab: PaletteTab): TabView => {
    if (tab === 'terrain') return terrainTab(editor);
    if (tab === 'tiles') return tilesTab(editor);
    if (tab === 'decor') return decorTab(editor);
    return entitiesTab(editor);
  };

  const show = (tab: PaletteTab): void => {
    active = tab;
    if (!views[tab]) views[tab] = build(tab);
    const view = views[tab]!;
    if (body.firstChild !== view.el) {
      clear(body);
      body.append(view.el);
    }
    view.sync();
    for (const [t, b] of tabButtons) {
      b.classList.toggle('active', t === active);
      b.setAttribute('aria-selected', String(t === active));
    }
  };

  const sync = (): void => {
    if (builtFor !== editor.tileset) {
      // New content was loaded: throw the old tabs away.
      builtFor = editor.tileset;
      views = {};
    }
    // Follow the tool: picking the Decor tool shows the Decor palette, and so on.
    let want = active;
    if (editor.tool === 'decor') want = 'decor';
    else if (editor.tool === 'entity') want = 'entities';
    else if (editor.tool === 'terrain') want = 'terrain';
    else if (editor.tool === 'tile') want = 'tiles';
    else if ((editor.tool === 'rect' || editor.tool === 'fill') && (active === 'decor' || active === 'entities')) {
      want = editor.brush.kind === 'terrain' ? 'terrain' : 'tiles';
    }
    show(want);
  };

  editor.events.on(['palette'], throttled(sync));
  onAssetLoaded(() => {
    views.terrain?.redrawImages?.();
    views.tiles?.redrawImages?.();
  });
  sync();
  return root;
}
