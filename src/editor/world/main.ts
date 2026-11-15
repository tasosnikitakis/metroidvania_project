/**
 * WORLD EDITOR - entry point
 * --------------------------
 * Builds the page, loads the content and wires the pieces together:
 *
 *   state/    the Editor object: content, selection, undo history, saving
 *   logic/    pure functions (auto-tiling, flood fill, resize, validation...) - unit tested
 *   render/   the canvas: room drawing, world map, pan & zoom, input
 *   tools/    one file per kind of canvas tool
 *   ui/       top bar, palettes, properties panel, dialogs
 *   actions.ts / shortcuts.ts   what buttons and keys do
 */
import '../common/theme.css';
import './world.css';
import { toast } from '../common/nav';
import { Actions } from './actions';
import { CanvasView } from './render/canvasView';
import { installShortcuts } from './shortcuts';
import { Editor } from './state/editor';
import { clearDraft, loadAll, readDraft, restoreDraft, writeDraft } from './state/persistence';
import { eyedrop } from './tools/paintOps';
import type { PointerInfo } from './tools/tool';
import { buildBanners } from './ui/banners';
import { choiceDialog } from './ui/dialogs';
import { h } from './ui/dom';
import { buildMapPanel } from './ui/mapPanel';
import { openMenu, type MenuItem } from './ui/menu';
import { buildPalette } from './ui/palette';
import { buildProperties } from './ui/properties';
import { buildStatusBar, buildToolRail } from './ui/toolrail';
import { buildTopbar, buildViewbar } from './ui/topbar';

const DRAFT_INTERVAL_MS = 4000;

async function start(): Promise<void> {
  const app = document.getElementById('app')!;
  app.classList.add('world-editor');

  const editor = new Editor();
  const canvasHolder = h('div', { class: 'canvas-holder' });
  // `actions` needs the canvas and the canvas needs `actions` for its callbacks, hence the late binding.
  let actions!: Actions;
  const canvas = new CanvasView(canvasHolder, editor, {
    playFrom: (x, y) => void actions.play(x, y),
    toast: (m) => toast(m, 2600),
    contextMenu: (p, cx, cy) => showContextMenu(p, cx, cy),
  });
  actions = new Actions(editor, canvas);

  /* ---------------- layout ---------------- */
  const banners = buildBanners(editor, actions);
  const palette = buildPalette(editor);
  const mapPanel = buildMapPanel(editor, actions);
  const sidebar = h('aside', { class: 'sidebar' }, palette, mapPanel, buildProperties(editor, canvas, actions));
  const loading = h('div', { class: 'loading' }, 'Loading your world…');
  canvasHolder.append(loading);
  app.append(
    buildTopbar(editor, actions),
    buildViewbar(editor, canvas),
    banners.el,
    h('div', { class: 'workspace' }, buildToolRail(editor), canvasHolder, sidebar),
    buildStatusBar(editor, canvas),
  );
  const syncMode = (): void => {
    palette.hidden = editor.mode === 'map';
    mapPanel.hidden = editor.mode !== 'map';
  };
  editor.events.on('ui', syncMode);
  syncMode();

  // After clicking a button with the mouse, give the keyboard back to the editor
  // (otherwise Space/Enter would press that button again instead of panning).
  app.addEventListener('click', (e) => {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    if (button && e.detail > 0) button.blur();
  });

  /* ---------------- right-click menu ---------------- */
  function showContextMenu(p: PointerInfo, clientX: number, clientY: number): void {
    const room = editor.room;
    if (!room) return;
    const items: MenuItem[] = [];
    const hit = canvas.objectAt(p);
    const sel = editor.tileSelection;
    const inTileSel = editor.tool === 'select' && sel !== null &&
      p.tx >= sel.rect.x && p.ty >= sel.rect.y && p.tx < sel.rect.x + sel.rect.w && p.ty < sel.rect.y + sel.rect.h;

    if (inTileSel) {
      items.push(
        { label: 'Copy tiles', hint: 'Ctrl+C', action: () => actions.copy() },
        { label: 'Cut tiles', hint: 'Ctrl+X', action: () => actions.cut() },
        { label: 'Flip left-right', action: () => canvas.selectTool.flip('h') },
        { label: 'Flip top-bottom', action: () => canvas.selectTool.flip('v') },
        { label: 'Delete tiles', hint: 'Del', action: () => actions.deleteSelected(), danger: true },
      );
    } else if (hit) {
      // Right-clicking an object selects it first, so the menu clearly applies to it.
      if (!(editor.selection?.kind === hit.kind && editor.selection.ids.includes(hit.id))) {
        if (hit.kind === 'decor') editor.armDecor(null); else editor.armEntity(null);
        editor.select({ kind: hit.kind, ids: [hit.id] });
      } else if (hit.kind === 'decor') editor.armDecor(null); else editor.armEntity(null);
      items.push(
        { label: 'Duplicate', hint: 'Ctrl+D', action: () => actions.duplicate() },
        { label: 'Copy', hint: 'Ctrl+C', action: () => actions.copy() },
      );
      if (hit.kind === 'decor') {
        items.push(
          { label: 'Flip', action: () => editor.updateSelectedDecor({ flipX: !editor.selectedDecor()[0]?.flipX }, 'Flip decor') },
          { label: 'Bring to front', action: () => editor.reorderSelectedDecor('front') },
          { label: 'Send to back', action: () => editor.reorderSelectedDecor('back') },
        );
      }
      items.push({ label: 'Delete', hint: 'Del', action: () => actions.deleteSelected(), danger: true });
    } else {
      const i = p.ty * room.width + p.tx;
      const inside = p.tx >= 0 && p.ty >= 0 && p.tx < room.width && p.ty < room.height;
      const hasTile = inside && (room.layers.back[i] > 0 || room.layers.main[i] > 0 || room.layers.front[i] > 0);
      items.push({ label: 'Paint with this tile', hint: 'Alt+click', action: () => { eyedrop(editor, p.tx, p.ty); }, disabled: !hasTile });
    }
    items.push(
      { label: 'Paste here', hint: 'Ctrl+V', action: () => actions.paste({ x: p.x, y: p.y }), disabled: editor.clipboard === null },
      { separator: true, label: '' },
      { label: '▶  Play from here', action: () => void actions.play(p.x, p.y) },
    );
    openMenu(clientX, clientY, items);
  }

  installShortcuts(editor, canvas, actions);

  /* ---------------- load ---------------- */
  const report = await loadAll(editor);
  loading.remove();
  canvas.fit();
  banners.showNotices(report.notices);

  // Offer to bring back work that was not saved last time (crash, closed tab...).
  const draft = readDraft();
  if (draft) {
    const when = new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const choice = await choiceDialog(
      'Unsaved work found',
      `The editor kept a safety copy of work that was never saved (${when}, ${draft.roomCount} changed room${draft.roomCount === 1 ? '' : 's'}). Do you want it back?`,
      'Restore my work', 'Throw it away',
    );
    const discard = choice === 'danger';
    if (discard) {
      clearDraft();
    } else if (restoreDraft(editor)) {
      toast('Unsaved work restored - press Save to keep it', 3500);
      canvas.fit();
    }
  }

  if (editor.world.rooms.length === 0) void actions.newRoom(true);

  /* ---------------- safety nets ---------------- */
  let draftCounter = editor.changeCounter;
  const saveDraft = (): void => {
    if (editor.changeCounter === draftCounter) return;
    // Tiles being moved are "in the air" (cut out of the layer) - wait until they are put down.
    if (editor.tileSelection?.floating) return;
    draftCounter = editor.changeCounter;
    if (editor.dirty) writeDraft(editor);
  };
  setInterval(saveDraft, DRAFT_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraft(); });
  window.addEventListener('pagehide', saveDraft);
  window.addEventListener('beforeunload', (e) => {
    saveDraft();
    if (editor.dirty) {
      e.preventDefault();
      e.returnValue = ''; // makes the browser ask "Leave site? Changes may not be saved"
    }
  });

  // Handy for poking around in the browser console (and used by automated checks).
  (window as unknown as { worldEditor: unknown }).worldEditor = { editor, canvas, actions };
}

void start();
