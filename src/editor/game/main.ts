/**
 * GAME EDITOR - entry point (editor/game.html)
 * --------------------------------------------
 * Two tabs share one top bar:
 *   🎮 Game Feel  - sliders for content/game-config.json with the live game beside them
 *   🦴 Animation  - viewer + keyframe editor for content/rigs/hero.rig.json
 *
 * This file only does the plumbing: load the content, build the top bar
 * (tabs, Undo / Redo / Save), keyboard shortcuts, the read-only banner and the
 * "you have unsaved changes" warning. The interesting parts live in
 * ./feel, ./anim (screens) and ./logic (pure, unit-tested maths).
 */
import '../common/theme.css';
import './game-editor.css';
import { listContent, loadContent, setEditorToken } from '../../shared/api';
import { CONTENT, type GameConfig, type RigData, type WorldData } from '../../shared/types';
import { createTopbar, toast } from '../common/nav';
import { AnimTab } from './anim/animTab';
import { GameLink } from './bridge';
import { FeelTab } from './feel/feelTab';
import { DEFAULT_GAME_CONFIG, sanitizeConfig } from './logic/configMeta';
import type { EditorTab, Shell } from './tabs';
import { button, h, typingInField } from './ui/dom';

const TAB_KEY = 'gameEditor.tab';

/** Load a content file, or return null if it does not exist (yet). */
async function optional<T>(path: string): Promise<T | null> {
  try { return await loadContent<T>(path); } catch { return null; }
}

/** Shown in place of the Animation tab when hero.rig.json is missing. */
function missingRigTab(): EditorTab {
  return {
    id: 'anim', label: '🦴 Animation',
    el: h('div', { class: 'tab-page empty-tab' },
      h('div', { class: 'panel empty-box' },
        h('h3', null, 'No hero rig yet'),
        h('p', null, 'content/rigs/hero.rig.json was not found. Run ', h('code', null, 'npm run art'), ' to generate the hero, then reload this page.'))),
    isDirty: () => false, canUndo: () => false, canRedo: () => false,
    undo() {}, redo() {}, save: async () => true, show() {}, hide() {}, handleKey: () => false,
  };
}

async function start(): Promise<void> {
  const app = document.getElementById('app')!;
  app.classList.add('game-editor');
  app.append(h('div', { class: 'loading' }, 'Loading the Game Editor…'));

  const [info, world, rawConfig, rig] = await Promise.all([
    listContent().catch(() => ({ files: [] as string[], writable: false })),
    optional<WorldData>(CONTENT.world),
    optional<unknown>(CONTENT.gameConfig),
    optional<RigData>(CONTENT.rig('hero')),
  ]);
  let writable = info.writable;
  // A missing or half-written config file is fine: gaps are filled with factory values.
  const config: GameConfig = sanitizeConfig(rawConfig, DEFAULT_GAME_CONFIG);

  /* ---------------- top bar ---------------- */
  const bar = createTopbar('game', 'Game Editor');
  const tabButtons = h('div', { class: 'tab-buttons', role: 'tablist' });
  bar.querySelector('.spacer')!.before(tabButtons);
  const undoBtn = button('↶ Undo', 'Undo (Ctrl+Z)', () => active.undo());
  const redoBtn = button('↷ Redo', 'Redo (Ctrl+Y)', () => active.redo());
  const saveBtn = button('💾 Save', 'Save to the game files (Ctrl+S)', () => void saveAll(), 'save-btn');
  bar.append(undoBtn, redoBtn, saveBtn);

  /* ---------------- read-only banner ---------------- */
  const password = h('input', { type: 'password', placeholder: 'Editor password', 'aria-label': 'Editor password', autocomplete: 'off' });
  const unlock = async () => {
    setEditorToken(password.value);
    const again = await listContent().catch(() => ({ files: [], writable: false }));
    writable = again.writable;
    if (writable) { toast('Unlocked - you can save now ✔'); password.value = ''; } else toast('That password did not work', 2500);
    refresh();
  };
  password.addEventListener('keydown', (e) => { if (e.key === 'Enter') void unlock(); });
  const readOnly = h('div', { class: 'banner readonly', role: 'status', hidden: true },
    h('span', null, h('strong', null, 'Read-only. '), 'You can try everything, but saving needs the editor password. Without it, use the Export buttons to download your work as JSON (and Import to load it back).'),
    password, button('Unlock', 'Check the password', () => void unlock(), 'primary'));

  /* ---------------- tabs ---------------- */
  const link = new GameLink();
  let feel: FeelTab | null = null;
  const refresh = (): void => {
    if (!active) return;
    undoBtn.disabled = !active.canUndo();
    redoBtn.disabled = !active.canRedo();
    const dirty = tabs.some((t) => t.isDirty());
    saveBtn.classList.toggle('dirty', dirty);
    saveBtn.textContent = !writable ? '🔒 Read-only' : dirty ? '💾 Save •' : '💾 Saved';
    saveBtn.disabled = !writable;
    saveBtn.title = !writable ? 'This server is read-only - see the banner' : dirty ? 'Save your changes to the game files (Ctrl+S)' : 'Everything is saved';
    readOnly.hidden = writable;
    for (const t of tabs) {
      const b = tabButtons.querySelector<HTMLElement>(`[data-tab="${t.id}"]`);
      b?.classList.toggle('unsaved', t.isDirty());
      if (b) b.title = t.isDirty() ? 'This tab has unsaved changes' : '';
    }
    document.title = `${dirty ? '• ' : ''}Game Editor`;
  };
  const shell: Shell = {
    isWritable: () => writable,
    refresh,
    link,
    saveAll: () => void saveAll(),
    currentConfig: () => feel?.config ?? config,
  };
  const tabs: EditorTab[] = [];
  let active!: EditorTab;
  feel = new FeelTab(shell, config, world);
  tabs.push(feel, rig ? new AnimTab(shell, rig) : missingRigTab());

  const pages = h('div', { class: 'tab-pages' }, ...tabs.map((t) => t.el));
  const showTab = (id: string): void => {
    const next = tabs.find((t) => t.id === id) ?? tabs[0];
    if (active && active !== next) active.hide();
    active = next;
    for (const t of tabs) t.el.hidden = t !== next;
    for (const b of Array.from(tabButtons.children)) {
      const on = (b as HTMLElement).dataset.tab === next.id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    next.show();
    try { localStorage.setItem(TAB_KEY, next.id); } catch { /* ignore */ }
    refresh();
  };
  for (const t of tabs) {
    tabButtons.append(h('button', { type: 'button', role: 'tab', class: 'tab-btn', 'data-tab': t.id, onclick: () => showTab(t.id) }, t.label, h('i', { class: 'dot', 'aria-hidden': 'true' })));
  }

  app.replaceChildren(bar, readOnly, pages);
  // Handy in the browser console and for automated tests: __editor.tabs[0] (feel), __editor.tabs[1] (animation).
  (window as unknown as { __editor: unknown }).__editor = { tabs, link };
  let startTab = location.hash.replace('#', '');
  if (!startTab) { try { startTab = localStorage.getItem(TAB_KEY) ?? ''; } catch { /* ignore */ } }
  showTab(startTab || 'feel');

  /* ---------------- saving ---------------- */
  let saving = false;
  async function saveAll(): Promise<void> {
    if (saving) return;
    if (!writable) { toast('Read-only: type the editor password, or use Export', 2600); return; }
    const dirty = tabs.filter((t) => t.isDirty());
    if (dirty.length === 0) { toast('Nothing to save - all up to date'); return; }
    saving = true;
    try { for (const t of dirty) await t.save(); } finally { saving = false; refresh(); }
  }

  /* ---------------- keyboard ---------------- */
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop')) return; // a dialog is open
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); void saveAll(); return; }
    const typing = typingInField(e.target);
    // In a text box, Ctrl+Z belongs to the text box.
    if (mod && key === 'z' && !(typing && (e.target as HTMLInputElement).type === 'text')) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (e.shiftKey) active.redo(); else active.undo();
      return;
    }
    if (mod && key === 'y') { e.preventDefault(); active.redo(); return; }
    if (typing) return;
    if (active.handleKey(e)) e.preventDefault();
  });

  window.addEventListener('beforeunload', (e) => {
    if (tabs.some((t) => t.isDirty())) { e.preventDefault(); e.returnValue = ''; }
  });
}

start().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.replaceChildren(h('div', { class: 'loading' }, `The Game Editor could not start: ${err instanceof Error ? err.message : String(err)}`));
});
