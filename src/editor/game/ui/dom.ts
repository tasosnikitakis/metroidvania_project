/**
 * Tiny DOM helpers shared by both tabs of the Game Editor (no framework).
 */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/**
 * Create an element:  h('button', { class: 'primary', title: 'Save', onclick: save }, 'Save')
 * - keys starting with "on" are event listeners
 * - `class`, `title`, `for`, `data-*`, `aria-*` etc. become attributes
 * - other keys (value, checked, disabled, textContent...) are set as properties
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      else if (key === 'class') el.className = String(value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key in el && !key.includes('-') && key !== 'list' && key !== 'for' && key !== 'role' && key !== 'title') (el as unknown as Props)[key] = value;
      else el.setAttribute(key === 'htmlFor' ? 'for' : key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A button with a tooltip. `label` may include an emoji icon. */
export function button(label: string, title: string, onClick: (ev: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, title, 'aria-label': title, onclick: onClick }, label);
}

/** A press-in/press-out toggle button. Read `.pressed`; call `.set(v)` to change it from code. */
export interface ToggleButton extends HTMLButtonElement { set(v: boolean): void; pressed: boolean }
export function toggleButton(label: string, title: string, initial: boolean, onChange: (v: boolean) => void): ToggleButton {
  const b = button(label, title, () => { b.set(!b.pressed); onChange(b.pressed); }, 'toggle') as ToggleButton;
  b.set = (v: boolean) => { b.pressed = v; b.classList.toggle('active', v); b.setAttribute('aria-pressed', String(v)); };
  b.set(initial);
  return b;
}

/* ------------------------------------------------------------------ */
/* Friendly dialogs (instead of the browser's grey prompt boxes)        */
/* ------------------------------------------------------------------ */

function openModal(title: string, body: HTMLElement, buttons: HTMLElement[]): { close(): void; root: HTMLElement } {
  const box = h('div', { class: 'modal-box panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h3', null, title), h('div', { class: 'modal-body' }, body), h('div', { class: 'modal-buttons' }, ...buttons));
  const root = h('div', { class: 'modal-backdrop' }, box);
  document.body.appendChild(root);
  return { root, close: () => root.remove() };
}

/** Ask for a line of text. Resolves to null when cancelled. `validate` returns an error message or null. */
export function askText(title: string, message: string, initial: string, validate?: (v: string) => string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, class: 'modal-input', spellcheck: false });
    const error = h('div', { class: 'modal-error' });
    const done = (v: string | null) => { modal.close(); resolve(v); };
    const ok = () => {
      const msg = validate ? validate(input.value) : null;
      if (msg) { error.textContent = msg; input.focus(); return; }
      done(input.value.trim());
    };
    const body = h('div', null, h('p', null, message), input, error);
    const modal = openModal(title, body, [button('Cancel', 'Cancel', () => done(null)), button('OK', 'OK', ok, 'primary')]);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok(); else if (e.key === 'Escape') done(null);
    });
    input.focus(); input.select();
  });
}

/** Ask a yes/no question. */
export function askConfirm(title: string, message: string, yesLabel = 'Yes', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => { modal.close(); window.removeEventListener('keydown', onKey, true); resolve(v); };
    const yes = button(yesLabel, yesLabel, () => done(true), danger ? 'danger' : 'primary');
    const modal = openModal(title, h('p', null, message), [button('Cancel', 'Cancel', () => done(false)), yes]);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true);
    };
    window.addEventListener('keydown', onKey, true);
    yes.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Files                                                                */
/* ------------------------------------------------------------------ */

/** Download `data` as a pretty-printed .json file. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Let the user pick a .json file and parse it. Resolves to null if they cancel or the file is not JSON. */
export function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try { resolve(JSON.parse(await file.text())); } catch { resolve(null); }
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.appendChild(input);
    input.click();
  });
}

/** True when the keyboard focus is in a text box (so shortcuts like Delete must not fire). */
export function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type !== 'range' && type !== 'checkbox' && type !== 'button';
}

/** Size a canvas to its CSS box x devicePixelRatio. Returns the 2D context scaled so you draw in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr)), hh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Read a CSS colour variable from the theme (so canvases match the page). */
export function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
