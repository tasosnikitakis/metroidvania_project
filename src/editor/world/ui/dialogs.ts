/**
 * Pop-up dialogs: confirm, new room, resize room, rename, help.
 * Each returns a Promise that resolves when the dialog closes
 * (null = cancelled), so callers can simply `await` the answer.
 */
import type { AnchorPos } from '../logic/resize';
import { DEFAULT_ROOM_H, DEFAULT_ROOM_W, ROOM_MAX_H, ROOM_MAX_W, ROOM_MIN_H, ROOM_MIN_W } from '../logic/validate';
import type { NewRoomOptions } from '../state/editor';
import { h } from './dom';

interface ModalButton<T> { label: string; value: () => T | null; primary?: boolean; danger?: boolean }

/** True while a dialog is open (keyboard shortcuts are paused). */
export function dialogOpen(): boolean {
  return document.querySelector('.modal-backdrop') !== null;
}

function modal<T>(title: string, body: HTMLElement, buttons: Array<ModalButton<T>>, cancelLabel: string | null = 'Cancel'): Promise<T | null> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const close = (value: T | null): void => {
      backdrop.remove();
      window.removeEventListener('keydown', onKey, true);
      previousFocus?.focus?.();
      resolve(value);
    };
    const primary = buttons.find((b) => b.primary) ?? buttons[0];
    const submit = (b: ModalButton<T>): void => {
      const v = b.value();
      if (v !== null) close(v); // null = the form is not valid yet, stay open
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement) && primary) {
        e.preventDefault();
        e.stopPropagation();
        submit(primary);
      } else {
        e.stopPropagation(); // keep editor shortcuts quiet while typing in a dialog
      }
    };
    const box = h('div', { class: 'modal panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', {}, title),
      body,
      h('div', { class: 'modal-buttons' },
        cancelLabel ? h('button', { type: 'button', onclick: () => close(null) }, cancelLabel) : null,
        ...buttons.map((b) => h('button', { type: 'button', class: b.danger ? 'danger' : b.primary ? 'primary' : '', onclick: () => submit(b) }, b.label)),
      ),
    );
    const backdrop = h('div', { class: 'modal-backdrop', onpointerdown: (e: Event) => { if (e.target === backdrop) close(null); } }, box);
    document.body.append(backdrop);
    window.addEventListener('keydown', onKey, true);
    const first = box.querySelector<HTMLElement>('input, select, textarea') ?? box.querySelector<HTMLElement>('button.primary, button.danger');
    first?.focus();
    if (first instanceof HTMLInputElement && first.type === 'text') first.select();
  });
}

export async function confirmDialog(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  const result = await modal<boolean>(title, h('p', { class: 'modal-text' }, message), [{ label: okLabel, value: () => true, primary: !danger, danger }]);
  return result === true;
}

/** Two clear choices and no "Cancel". Closing the dialog any other way counts as the safe choice. */
export async function choiceDialog(title: string, message: string, safeLabel: string, dangerLabel: string): Promise<'safe' | 'danger'> {
  const result = await modal<'safe' | 'danger'>(title, h('p', { class: 'modal-text' }, message), [
    { label: dangerLabel, value: () => 'danger', danger: true },
    { label: safeLabel, value: () => 'safe', primary: true },
  ], null);
  return result ?? 'safe';
}

/** A message with a single OK button. `lines` are shown as a list. */
export async function infoDialog(title: string, intro: string, lines: string[] = []): Promise<void> {
  const body = h('div', {},
    h('p', { class: 'modal-text' }, intro),
    lines.length > 0 ? h('ul', { class: 'modal-list' }, ...lines.map((l) => h('li', {}, l))) : null,
  );
  await modal<boolean>(title, body, [{ label: 'OK', value: () => true, primary: true }], null);
}

export async function promptDialog(title: string, label: string, initial: string, okLabel = 'OK'): Promise<string | null> {
  const input = h('input', { type: 'text', value: initial, maxLength: 60 });
  const body = h('label', { class: 'field' }, h('span', {}, label), input);
  return modal<string>(title, body, [{ label: okLabel, primary: true, value: () => (input.value.trim() ? input.value.trim() : null) }]);
}

function numberInput(value: number, min: number, max: number): HTMLInputElement {
  return h('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: '1', inputMode: 'numeric' });
}

function readSize(wInput: HTMLInputElement, hInput: HTMLInputElement): { width: number; height: number } | null {
  const width = Math.round(Number(wInput.value));
  const height = Math.round(Number(hInput.value));
  const okW = Number.isFinite(width) && width >= ROOM_MIN_W && width <= ROOM_MAX_W;
  const okH = Number.isFinite(height) && height >= ROOM_MIN_H && height <= ROOM_MAX_H;
  wInput.classList.toggle('invalid', !okW);
  hInput.classList.toggle('invalid', !okH);
  return okW && okH ? { width, height } : null;
}

const SIZE_PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: 'One screen', w: 27, h: 15 },
  { label: 'Small', w: DEFAULT_ROOM_W, h: DEFAULT_ROOM_H },
  { label: 'Long hall', w: 80, h: 17 },
  { label: 'Tall tower', w: 30, h: 50 },
  { label: 'Big cave', w: 100, h: 50 },
];

export function newRoomDialog(defaultName: string, backgrounds: Array<{ key: string; name: string }>, first: boolean): Promise<NewRoomOptions | null> {
  const name = h('input', { type: 'text', value: defaultName, maxLength: 60 });
  const w = numberInput(DEFAULT_ROOM_W, ROOM_MIN_W, ROOM_MAX_W);
  const hh = numberInput(DEFAULT_ROOM_H, ROOM_MIN_H, ROOM_MAX_H);
  const bg = h('select', {}, ...backgrounds.map((b) => h('option', { value: b.key }, b.name)));
  const floor = h('input', { type: 'checkbox', checked: true });
  const start = h('input', { type: 'checkbox', checked: true });
  const presets = h('div', { class: 'chip-row' }, ...SIZE_PRESETS.map((p) => h('button', {
    type: 'button', class: 'chip', title: `${p.w} × ${p.h} tiles`,
    onclick: () => { w.value = String(p.w); hh.value = String(p.h); },
  }, p.label)));
  const body = h('div', { class: 'form' },
    first ? h('p', { class: 'modal-text' }, 'Welcome! Let\'s make the first room of your world. You can change everything later.') : null,
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('div', { class: 'field' }, h('span', {}, 'Size'), presets),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Width (tiles)'), w),
      h('label', { class: 'field' }, h('span', {}, 'Height (tiles)'), hh),
    ),
    h('p', { class: 'muted small' }, 'One game screen is about 27 × 15 tiles.'),
    backgrounds.length > 0 ? h('label', { class: 'field' }, h('span', {}, 'Background'), bg) : null,
    h('label', { class: 'check' }, floor, h('span', {}, 'Start with a floor')),
    h('label', { class: 'check' }, start, h('span', {}, 'Add a Player Start so I can press Play right away')),
  );
  return modal<NewRoomOptions>(first ? 'Create your first room' : 'New room', body, [{
    label: 'Create room', primary: true,
    value: () => {
      const size = readSize(w, hh);
      if (!size) return null;
      return { name: name.value, ...size, background: bg.value || '', addFloor: floor.checked, addPlayerStart: start.checked };
    },
  }], first ? null : 'Cancel');
}

export interface ResizeAnswer { width: number; height: number; anchorX: AnchorPos; anchorY: AnchorPos }

export function resizeDialog(roomName: string, width: number, height: number): Promise<ResizeAnswer | null> {
  const w = numberInput(width, ROOM_MIN_W, ROOM_MAX_W);
  const hh = numberInput(height, ROOM_MIN_H, ROOM_MAX_H);
  let anchorX: AnchorPos = 0;
  let anchorY: AnchorPos = 1; // keep the floor where it is by default
  const grid = h('div', { class: 'anchor-grid', role: 'group', 'aria-label': 'Which part stays in place' });
  const names = ['top', 'middle', 'bottom'];
  const namesX = ['left', 'centre', 'right'];
  const paint = (): void => {
    grid.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.ax) === anchorX && Number(b.dataset.ay) === anchorY);
    });
  };
  for (const ay of [0, 0.5, 1] as AnchorPos[]) {
    for (const ax of [0, 0.5, 1] as AnchorPos[]) {
      grid.append(h('button', {
        type: 'button', dataset: { ax, ay }, title: `Keep the ${names[ay * 2]} ${namesX[ax * 2]} in place`,
        onclick: () => { anchorX = ax; anchorY = ay; paint(); },
      }));
    }
  }
  paint();
  const body = h('div', { class: 'form' },
    h('p', { class: 'modal-text' }, `"${roomName}" is ${width} × ${height} tiles now.`),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Width (tiles)'), w),
      h('label', { class: 'field' }, h('span', {}, 'Height (tiles)'), hh),
    ),
    h('div', { class: 'field' },
      h('span', {}, 'Keep this part where it is'),
      h('div', { class: 'anchor-wrap' }, grid, h('p', { class: 'muted small' }, 'New space is added (or tiles are cut off) on the other sides. Anything you painted that still fits is kept. You can always Undo.')),
    ),
  );
  return modal<ResizeAnswer>('Resize room', body, [{
    label: 'Resize', primary: true,
    value: () => {
      const size = readSize(w, hh);
      return size ? { ...size, anchorX, anchorY } : null;
    },
  }]);
}

const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
  ['Tools', [
    ['B', 'Terrain brush'], ['T', 'Tile brush'], ['E', 'Eraser'], ['R', 'Rectangle fill'], ['F', 'Flood fill'],
    ['I', 'Eyedropper (or Alt+click)'], ['M', 'Select tiles'], ['D', 'Decor'], ['N', 'Entities'], ['P', 'Play from here'],
    ['[  ]', 'Smaller / bigger brush'], ['Shift+drag', 'Straight line'], ['Ctrl+drag', 'Erase (rectangle & fill)'],
  ]],
  ['Editing', [
    ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'], ['Ctrl+C / X / V', 'Copy / cut / paste'], ['Ctrl+D', 'Duplicate'],
    ['Delete', 'Delete selection'], ['Arrows', 'Nudge selection'], ['Alt', 'Free placement (no snapping)'], ['Esc', 'Cancel / deselect'],
    ['Ctrl+A', 'Select all tiles on the layer'],
  ]],
  ['View', [
    ['1  2  3', 'Back / main / front layer'], ['G', 'Grid'], ['H', 'Collision overlay'], ['C', 'Camera frame'],
    ['+  −', 'Zoom'], ['0', 'Fit room to window'], ['Space+drag', 'Pan (also middle mouse / two fingers)'], ['Tab', 'World map'],
  ]],
  ['File', [['Ctrl+S', 'Save'], ['Ctrl+Enter', 'Save and play'], ['?', 'This help']]],
];

export async function helpDialog(): Promise<void> {
  const body = h('div', { class: 'help' },
    h('p', { class: 'modal-text' }, 'Paint with the Terrain brush, drop in some decor, then press Play ▶ to run around in your room. Everything can be undone. On a Mac use Cmd instead of Ctrl.'),
    h('div', { class: 'help-cols' }, ...SHORTCUTS.map(([title, rows]) => h('div', { class: 'help-group' },
      h('h3', {}, title),
      ...rows.map(([key, what]) => h('div', { class: 'help-row' }, h('kbd', {}, key), h('span', {}, what))),
    ))),
  );
  await modal<boolean>('How to use the World Editor', body, [{ label: 'Got it', value: () => true, primary: true }], null);
}
