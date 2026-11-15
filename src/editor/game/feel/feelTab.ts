/**
 * TAB 1 - "GAME FEEL"
 * -------------------
 * Left:   a slider for every setting in content/game-config.json (built from
 *         the table in logic/configMeta.ts), grouped and explained.
 * Middle: "what it means" read-outs + the jump-arc graph (logic/physics.ts).
 * Right:  the real game, running live. Every change is sent to it instantly.
 */
import { saveContent } from '../../../shared/api';
import { CONTENT, type GameConfig, type WorldData } from '../../../shared/types';
import { toast } from '../../common/nav';
import {
  DEFAULT_GAME_CONFIG, FIELDS, GROUPS, configsEqual, formatValue, getValue, sanitizeConfig, withValue,
  type ConfigValue, type FieldDef, type NumberMeta,
} from '../logic/configMeta';
import { History } from '../logic/history';
import { deriveStats, toTiles } from '../logic/physics';
import {
  BUILTIN_PRESETS, USER_PRESETS_KEY, applyPreset, makeUserPreset, parseUserPresets, removeUserPreset,
  serializeUserPresets, upsertUserPreset, type Preset,
} from '../logic/presets';
import type { EditorTab, Shell } from '../tabs';
import { askConfirm, askText, button, clear, downloadJson, h, pickJsonFile, toggleButton } from '../ui/dom';
import { ARC_COLORS, drawArcGraph } from './arcGraph';

interface FieldRow {
  def: FieldDef;
  row: HTMLElement;
  slider?: HTMLInputElement;
  number?: HTMLInputElement;
  check?: HTMLInputElement;
  resetSaved: HTMLButtonElement;
  resetDefault: HTMLButtonElement;
}

/** 3.50 -> "3.5", 2100 -> "2100" (trailing zeros are only trimmed after a decimal point). */
const fmt = (v: number, digits = 2): string => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '∞');
const tiles = (px: number): string => `${fmt(toTiles(px), 1)} tiles`;

export class FeelTab implements EditorTab {
  id = 'feel';
  label = '🎮 Game Feel';
  el: HTMLElement;

  private history: History<GameConfig>;
  private rows = new Map<string, FieldRow>();
  private groupBadges = new Map<string, HTMLElement>();
  private statEls = new Map<string, HTMLElement>();
  private graph!: HTMLCanvasElement;
  private frame!: HTMLIFrameElement;
  private roomSelect!: HTMLSelectElement;
  private presetSelect!: HTMLSelectElement;
  private presetInfo!: HTMLElement;
  private deletePresetBtn!: HTMLButtonElement;
  private status!: HTMLElement;
  private userPresets: Preset[] = [];
  private debugOn = false;
  private drawQueued = false;
  private visible = false;
  private gameStarted = false;

  constructor(private shell: Shell, initial: GameConfig, private world: WorldData | null) {
    this.history = new History<GameConfig>(initial);
    try { this.userPresets = parseUserPresets(localStorage.getItem(USER_PRESETS_KEY)); } catch { /* storage blocked */ }

    this.el = h('div', { class: 'tab-page feel-tab' }, this.buildControls(), this.buildInfoPanel(), this.buildGamePanel());

    // The game says "ready" whenever it (re)starts: answer with the current settings,
    // because it has only loaded the SAVED ones from disk.
    shell.link.onReady(() => {
      shell.link.sendConfig(this.config);
      this.status.textContent = '● Game connected';
      this.status.classList.add('ok');
    });
    new ResizeObserver(() => this.queueDraw()).observe(this.graph);
    this.sync();
  }

  get config(): GameConfig { return this.history.present; }

  /* ---------------- EditorTab ---------------- */
  isDirty(): boolean { return !configsEqual(this.history.present, this.history.saved); }
  canUndo(): boolean { return this.history.canUndo; }
  canRedo(): boolean { return this.history.canRedo; }
  undo(): void { if (this.history.undo()) this.changed('Undone'); }
  redo(): void { if (this.history.redo()) this.changed('Redone'); }
  show(): void {
    this.visible = true;
    this.queueDraw();
    // The game is only started once its frame is actually on screen (a hidden frame has no
    // size, which would make the game start tiny). Coming back to this tab, give it a nudge
    // so it re-measures its window.
    if (!this.gameStarted) { this.gameStarted = true; this.frame.src = this.gameUrl(); }
    else requestAnimationFrame(() => { try { this.frame.contentWindow?.dispatchEvent(new Event('resize')); } catch { /* ignore */ } });
  }
  hide(): void { this.visible = false; }
  handleKey(): boolean { return false; }

  async save(): Promise<boolean> {
    const snapshot = this.history.present;
    try {
      await saveContent(CONTENT.gameConfig, snapshot);
      this.history.markSaved(snapshot);
      this.sync();
      toast('Game feel saved ✔');
      return true;
    } catch (err) {
      console.error(err);
      toast('Could not save the settings. Try "Export" to keep a copy.', 3500);
      return false;
    }
  }

  /* ---------------- changing values ---------------- */

  /** Apply a new settings object: remember it for undo, send it to the game, update the screen. */
  private commit(next: GameConfig, mergeKey: string | null = null): void {
    this.history.set(next, mergeKey);
    this.changed();
  }

  private changed(message?: string): void {
    this.shell.link.sendConfig(this.config);
    this.sync();
    if (message) toast(message, 900);
  }

  private setField(path: string, value: ConfigValue, merge: boolean): void {
    const next = withValue(this.config, path, value);
    if (getValue(next, path) === getValue(this.config, path)) { this.syncRow(this.rows.get(path)!); return; }
    this.commit(next, merge ? path : null);
  }

  /* ---------------- left: the sliders ---------------- */

  private buildControls(): HTMLElement {
    const list = h('div', { class: 'feel-groups' });
    for (const group of GROUPS) {
      const fields = FIELDS.filter((f) => f.meta.group === group.id);
      if (fields.length === 0) continue;
      const badge = h('span', { class: 'badge', title: 'Settings in this group that differ from the saved game' });
      this.groupBadges.set(group.id, badge);
      const body = h('div', { class: 'group-body' }, ...fields.map((f) => this.buildRow(f)));
      const details = h('details', { class: 'group', open: group.id !== 'body' && group.id !== 'camera' && group.id !== 'feel' && group.id !== 'attack' },
        h('summary', { title: group.blurb },
          h('span', { class: 'group-icon' }, group.icon), h('span', { class: 'group-title' }, group.title),
          h('span', { class: 'group-blurb muted' }, group.blurb), badge),
        body);
      details.dataset.group = group.id;
      list.appendChild(details);
    }
    return h('section', { class: 'panel feel-controls' }, this.buildPresetBar(), list);
  }

  private buildRow(def: FieldDef): HTMLElement {
    const meta = def.meta;
    const id = `f-${def.path.replace('.', '-')}`;
    const resetSaved = button('↩', 'Back to the saved value', () => this.setField(def.path, getValue(this.history.saved, def.path), false), 'mini');
    const resetDefault = button('⟲', 'Back to the factory value', () => this.setField(def.path, getValue(DEFAULT_GAME_CONFIG, def.path), false), 'mini');
    const row: FieldRow = { def, row: h('div', { class: 'field', 'data-path': def.path }), resetSaved, resetDefault };
    const label = h('label', { class: 'field-label', for: id, title: meta.help }, meta.label);
    const help = h('div', { class: 'field-help muted' }, meta.help);
    const resets = h('span', { class: 'field-resets' }, resetSaved, resetDefault);

    if (meta.kind === 'boolean') {
      const check = h('input', { type: 'checkbox', id, class: 'switch', onchange: () => this.setField(def.path, check.checked, false) });
      row.check = check;
      row.row.append(h('div', { class: 'field-top' }, label, h('span', { class: 'spacer' }), check, resets), help);
    } else {
      const slider = h('input', {
        type: 'range', id, min: meta.min, max: meta.max, step: meta.step, 'aria-label': meta.label,
        oninput: () => this.setField(def.path, Number(slider.value), true),
        // One undo step per drag (or per run of arrow-key presses): a new step starts
        // when the slider is grabbed again or the focus moves away.
        onpointerdown: () => this.history.seal(),
        onblur: () => this.history.seal(),
      });
      const number = h('input', {
        type: 'number', class: 'field-number', min: Math.min(meta.min, 0), max: meta.hardMax ?? meta.max * 4, step: meta.step,
        title: `${meta.label}: slider goes from ${meta.min} to ${meta.max}. Type here to go beyond.`, 'aria-label': `${meta.label} (number)`,
        oninput: () => { if (number.value !== '' && Number.isFinite(Number(number.value))) this.setField(def.path, Number(number.value), true); },
        onchange: () => { this.history.seal(); this.syncRow(row, true); },
        onblur: () => { this.history.seal(); this.syncRow(row, true); },
      });
      row.slider = slider; row.number = number;
      row.row.append(
        h('div', { class: 'field-top' }, label, h('span', { class: 'spacer' }), number, h('span', { class: 'field-unit muted' }, meta.unit), resets),
        slider, help);
    }
    this.rows.set(def.path, row);
    return row.row;
  }

  /* ---------------- presets, import / export ---------------- */

  private buildPresetBar(): HTMLElement {
    this.presetSelect = h('select', { class: 'preset-select', title: 'Ready-made feels to try', onchange: () => this.syncPresetInfo() });
    this.presetInfo = h('div', { class: 'preset-info muted' });
    this.deletePresetBtn = button('🗑', 'Delete this preset of mine', () => void this.deletePreset(), 'mini');
    this.fillPresets();
    return h('div', { class: 'preset-bar' },
      h('div', { class: 'preset-row' },
        h('span', { class: 'bar-label' }, 'Presets'), this.presetSelect,
        button('Try it', 'Apply this preset (you can undo)', () => this.applySelectedPreset(), 'primary'),
        this.deletePresetBtn),
      this.presetInfo,
      h('div', { class: 'preset-row' },
        button('★ Save as my preset…', 'Remember the current settings under a name (on this computer)', () => void this.saveUserPreset()),
        h('span', { class: 'spacer' }),
        button('⬇ Export', 'Download the settings as a JSON file', () => downloadJson('game-config.json', this.config)),
        button('⬆ Import', 'Load settings from a JSON file', () => void this.importConfig())));
  }

  private allPresets(): Preset[] { return [...BUILTIN_PRESETS, ...this.userPresets]; }

  private fillPresets(select?: string): void {
    const keep = select ?? this.presetSelect.value;
    clear(this.presetSelect);
    const builtIn = h('optgroup', { label: 'Built-in' }, ...BUILTIN_PRESETS.map((p) => h('option', { value: p.name }, p.name)));
    this.presetSelect.append(builtIn);
    if (this.userPresets.length) this.presetSelect.append(h('optgroup', { label: 'My presets' }, ...this.userPresets.map((p) => h('option', { value: p.name }, `★ ${p.name}`))));
    if (this.allPresets().some((p) => p.name === keep)) this.presetSelect.value = keep;
    this.syncPresetInfo();
  }

  private selectedPreset(): Preset | undefined { return this.allPresets().find((p) => p.name === this.presetSelect.value); }

  private syncPresetInfo(): void {
    const p = this.selectedPreset();
    this.presetInfo.textContent = p?.description ?? '';
    this.deletePresetBtn.hidden = !p || p.builtIn;
  }

  private applySelectedPreset(): void {
    const p = this.selectedPreset();
    if (!p) return;
    this.commit(applyPreset(this.config, p));
    toast(`Trying "${p.name}" - press Undo to go back`, 2200);
  }

  private storeUserPresets(): void {
    try { localStorage.setItem(USER_PRESETS_KEY, serializeUserPresets(this.userPresets)); } catch { toast('Could not store presets in this browser.'); }
  }

  private async saveUserPreset(): Promise<void> {
    const name = await askText('Save as my preset', 'Give this feel a name:', 'My feel', (v) => (v.trim() ? null : 'Please type a name.'));
    if (!name) return;
    this.userPresets = upsertUserPreset(this.userPresets, makeUserPreset(name, this.config));
    this.storeUserPresets();
    const stored = this.userPresets.find((p) => p.name === name || p.name === `${name} (mine)`);
    this.fillPresets(stored?.name);
    toast(`Preset "${stored?.name ?? name}" saved on this computer`);
  }

  private async deletePreset(): Promise<void> {
    const p = this.selectedPreset();
    if (!p || p.builtIn) return;
    if (!(await askConfirm('Delete preset', `Delete your preset "${p.name}"?`, 'Delete', true))) return;
    this.userPresets = removeUserPreset(this.userPresets, p.name);
    this.storeUserPresets();
    this.fillPresets();
  }

  private async importConfig(): Promise<void> {
    const raw = await pickJsonFile();
    if (!raw || typeof raw !== 'object' || !('player' in raw)) { toast('That file does not look like a game-config.json'); return; }
    this.commit(sanitizeConfig(raw, this.config));
    toast('Settings imported - press Undo to go back');
  }

  /* ---------------- middle: read-outs + graph ---------------- */

  private buildInfoPanel(): HTMLElement {
    const stat = (id: string, label: string, title: string) => {
      const value = h('span', { class: 'stat-value', 'data-stat': id }, '-');
      this.statEls.set(id, value);
      return h('div', { class: 'stat', title }, h('span', { class: 'stat-label' }, label), value);
    };
    this.graph = h('canvas', { class: 'arc-graph', title: 'Jump arcs while running at full speed. Each square is one tile.' });
    const legend = (color: string, text: string) => h('span', { class: 'legend-item' }, h('i', { style: { background: color } }), text);
    return h('section', { class: 'panel feel-info' },
      h('div', { class: 'info-col' },
        h('h3', null, 'What it means'),
        h('div', { class: 'stats' },
          stat('fullJump', 'Full jump', 'How high the hero\'s feet get when the jump button is held.'),
          stat('tapJump', 'Tap jump', 'How high a very quick tap of the button goes.'),
          stat('airTime', 'Time in the air', 'From take-off to landing on flat ground (full jump). In brackets: time to reach the top.'),
          stat('jumpDistance', 'Jump distance', 'The widest gap a full jump can cross at run speed.'),
          stat('doubleJump', 'With double jump', 'Highest: second jump at the very top. Farthest: second jump at the last moment.'),
          stat('dash', 'Dash distance', 'How far one dash carries the hero.'),
          stat('run', 'Run', 'Time to reach top speed from standing, and to stop again.'),
          stat('gravity', 'Gravity (up / down)', 'Worked out from jump height and time: gravity = 2 × height ÷ time². Rising / falling.'),
          stat('jumpSpeed', 'Launch speed', 'How fast the hero leaves the ground.'))),
      h('div', { class: 'info-col' },
        h('h3', null, 'Jump arcs ',
          h('span', { class: 'legend' }, legend(ARC_COLORS.tap, 'tap'), legend(ARC_COLORS.full, 'full'), legend(ARC_COLORS.double, 'double'))),
        h('div', { class: 'arc-holder' }, this.graph)));
  }

  private queueDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      if (this.visible) drawArcGraph(this.graph, this.config.player);
    });
  }

  private syncStats(): void {
    const p = this.config.player;
    const s = deriveStats(p);
    const set = (id: string, text: string) => { this.statEls.get(id)!.textContent = text; };
    set('fullJump', `${tiles(s.fullJumpHeight)} (${fmt(s.fullJumpHeight, 0)} px)`);
    set('tapJump', `${tiles(s.tapJumpHeight)} (${fmt(s.tapJumpHeight, 0)} px)`);
    set('airTime', `${fmt(s.airTime)} s (${fmt(s.timeToApex)} s up)`);
    set('jumpDistance', `${tiles(s.jumpDistance)} (${fmt(s.jumpDistance, 0)} px)`);
    set('doubleJump', Math.floor(p.airJumps) > 0 ? `${tiles(s.doubleJumpHeight)} high · ${tiles(s.doubleJumpDistance)} far` : 'no air jumps');
    set('dash', p.dashEnabled ? `${tiles(s.dashDistance)} (${fmt(s.dashDistance, 0)} px)` : 'dash is off');
    set('run', `${fmt(s.timeToTopSpeed)} s to top speed · ${fmt(s.stopTime)} s to stop`);
    set('gravity', `${fmt(s.gravity, 0)} / ${fmt(s.fallGravity, 0)} px/s²`);
    set('jumpSpeed', `${fmt(s.jumpSpeed, 0)} px/s`);
  }

  /* ---------------- right: the live game ---------------- */

  private gameUrl(): string {
    const room = this.roomSelect.value;
    const q = new URLSearchParams();
    if (room) q.set('room', room);
    if (this.debugOn) q.set('debug', '1');
    const qs = q.toString();
    return `/${qs ? '?' + qs : ''}`;
  }

  private reloadGame(): void {
    this.gameStarted = true;
    this.status.textContent = '○ Starting the game…';
    this.status.classList.remove('ok');
    this.frame.src = this.gameUrl();
  }

  private focusGame(): void {
    this.frame.focus();
    try { this.frame.contentWindow?.focus(); } catch { /* cross-origin never happens here */ }
  }

  private buildGamePanel(): HTMLElement {
    const rooms = this.world?.rooms ?? [];
    this.roomSelect = h('select', { class: 'room-select', title: 'Which room to test in', onchange: () => this.reloadGame() },
      ...(rooms.length ? rooms.map((r) => h('option', { value: r.id }, r.name || r.id)) : [h('option', { value: '' }, 'Start room')]));
    if (this.world && rooms.some((r) => r.id === this.world!.startRoom)) this.roomSelect.value = this.world.startRoom;
    this.status = h('span', { class: 'game-status muted', role: 'status' }, '○ Starting the game…');
    this.frame = h('iframe', { class: 'game-frame', title: 'Live game preview', allow: 'gamepad; fullscreen', tabindex: 0 });
    // While you are playing, the keyboard belongs to the game - but Ctrl+S should still save
    // the editor (and not open the browser's "save web page" box).
    this.frame.addEventListener('load', () => {
      try {
        this.frame.contentWindow?.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.shell.saveAll(); }
        }, true);
      } catch { /* not reachable: ignore */ }
    });
    const debugBtn = toggleButton('🐞 Debug', 'Show the collision boxes and numbers inside the game (restarts it)', false, (v) => { this.debugOn = v; this.reloadGame(); });
    return h('section', { class: 'panel feel-game' },
      h('div', { class: 'game-bar' },
        h('span', { class: 'bar-label' }, 'Room'), this.roomSelect,
        button('🎯 Play here', 'Click, then use the keyboard to play (arrows / WASD, Space to jump)', () => this.focusGame(), 'primary'),
        button('↻ Restart', 'Start the game again from the beginning of the room', () => this.reloadGame()),
        debugBtn,
        button('↗ Pop out', 'Open the game in its own tab - it still updates live', () => window.open(this.gameUrl(), '_blank')),
        h('span', { class: 'spacer' }), this.status),
      h('div', { class: 'game-holder' }, this.frame),
      h('div', { class: 'game-hint muted' }, 'Changes on the left reach the game straight away - no need to save first. Save when you like how it feels.'));
  }

  /* ---------------- keeping the screen in step with the data ---------------- */

  private syncRow(r: FieldRow, force = false): void {
    const v = getValue(this.config, r.def.path);
    const saved = getValue(this.history.saved, r.def.path);
    const def = getValue(DEFAULT_GAME_CONFIG, r.def.path);
    if (r.check) r.check.checked = Boolean(v);
    if (r.slider && Number(r.slider.value) !== v) r.slider.value = String(v);
    // Do not fight the user while they are typing in the number box.
    if (r.number && (force || document.activeElement !== r.number) && r.number.value !== String(v)) r.number.value = String(v);
    r.row.classList.toggle('changed', v !== saved);
    r.row.classList.toggle('beyond', r.def.meta.kind === 'number' && ((v as number) > (r.def.meta as NumberMeta).max || (v as number) < (r.def.meta as NumberMeta).min));
    r.resetSaved.disabled = v === saved;
    r.resetSaved.title = v === saved ? 'Same as the saved value' : `Back to the saved value (${formatValue(r.def.meta, saved)})`;
    r.resetDefault.disabled = v === def;
    r.resetDefault.title = v === def ? 'Same as the factory value' : `Back to the factory value (${formatValue(r.def.meta, def)})`;
  }

  private sync(): void {
    const changedPerGroup = new Map<string, number>();
    for (const r of this.rows.values()) {
      this.syncRow(r);
      if (r.row.classList.contains('changed')) changedPerGroup.set(r.def.meta.group, (changedPerGroup.get(r.def.meta.group) ?? 0) + 1);
    }
    for (const [group, badge] of this.groupBadges) {
      const n = changedPerGroup.get(group) ?? 0;
      badge.textContent = n ? `${n} changed` : '';
      badge.hidden = n === 0;
    }
    this.syncStats();
    this.queueDraw();
    this.shell.refresh();
  }
}
