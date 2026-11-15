/** Tiny helpers for building the UI without a framework. */

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/**
 * Create an element:  h('button', { class: 'primary', onclick: save, title: 'Save' }, 'Save')
 * - `class`, `title`, `type`, ... are set as attributes
 * - names starting with "on" are event handlers
 * - `dataset: {a: 1}` sets data-a
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) el.dataset[k] = String(v);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else if (key in el && key !== 'list' && typeof value !== 'string') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Run `fn` at most once per animation frame however often the returned
 * function is called. Panels use this so ten state changes = one rebuild.
 */
export function throttled(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

/* ---- icons: simple line drawings (24x24), so they look the same on every computer ---- */

const ICONS: Record<string, string> = {
  terrain: '<path d="M3 17c3-6 5-6 7-2s4 3 5-1 4-5 6 1v4H3z" fill="currentColor" fill-opacity=".25"/><path d="M3 17c3-6 5-6 7-2s4 3 5-1 4-5 6 1"/><path d="M14 4l3 3-6 6-3 1 1-3z"/>',
  tile: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1" fill="currentColor" fill-opacity=".3"/><rect x="4" y="13" width="7" height="7" rx="1" fill="currentColor" fill-opacity=".3"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  eraser: '<path d="M8 19h11"/><path d="M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8l-2.5-2.5a1.4 1.4 0 0 1 0-2z"/><path d="M10 10l5 5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" fill-opacity=".25"/>',
  fill: '<path d="M11 4l8 8-6 6a2 2 0 0 1-2.8 0L5 12.8a2 2 0 0 1 0-2.8z" fill="currentColor" fill-opacity=".2"/><path d="M5.5 11h12"/><path d="M20 15c1 1.6 1.5 2.5 1.5 3.3a1.5 1.5 0 0 1-3 0c0-.8.5-1.700 1.500-3.300z" fill="currentColor"/>',
  eyedropper: '<path d="M14 6l4 4"/><path d="M12.5 7.5l4 4-7 7H6v-3.500z"/><path d="M15 5a2.100 2.100 0 0 1 3-.2l1.200 1.200a2.100 2.100 0 0 1-.2 3"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
  decor: '<path d="M12 3c2 2.500 3 4 3 5.500a3 3 0 0 1-6 0C9 7 10 5.500 12 3z" fill="currentColor" fill-opacity=".3"/><path d="M12 11.500V17"/><path d="M8 21h8l-1-4H9z"/>',
  entity: '<path d="M12 3l2.600 5.600 6 .700-4.500 4.100 1.300 6-5.400-3.100-5.400 3.100 1.300-6L3.400 9.300l6-.700z" fill="currentColor" fill-opacity=".25"/>',
  pan: '<path d="M8 12V6.500a1.500 1.500 0 0 1 3 0V11m0-5.500V5a1.500 1.500 0 0 1 3 0v6m0-4.500a1.500 1.500 0 0 1 3 0V12m0-2.500a1.500 1.500 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.500a6 6 0 0 1-4.700-2.300L4.500 14.500a1.600 1.600 0 0 1 2.400-2.100L8 13.500"/>',
  play: '<path d="M7 4.500v15l12-7.500z" fill="currentColor" fill-opacity=".3"/>',
  undo: '<path d="M8 5L4 9l4 4"/><path d="M4 9h10a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M16 5l4 4-4 4"/><path d="M20 9H10a5 5 0 0 0 0 10h3"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="7"/>',
  map: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M6.500 7.200C4 9 2.500 12 2.500 12S6 18.500 12 18.500c1.600 0 3-.400 4.300-1M10 5.700c.600-.100 1.300-.200 2-.200 6 0 9.500 6.500 9.500 6.500s-.800 1.500-2.300 3.100"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 1-1 1.700"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  more: '<circle cx="5" cy="12" r="1.600" fill="currentColor"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/><circle cx="19" cy="12" r="1.600" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pointer: '<path d="M6 3l12 9-5.500 1L15 19l-2.500 1-2.500-6L6 17z" fill="currentColor" fill-opacity=".25"/>',
  flipH: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5z"/><path d="M15 7l5 10h-5z" fill="currentColor" fill-opacity=".35"/>',
  flipV: '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M7 9l10-5v5z"/><path d="M7 15l10 5v-5z" fill="currentColor" fill-opacity=".35"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="1"/><path d="M5 16V5a1 1 0 0 1 1-1h9"/>',
  up: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v13M6 13l6 6 6-6"/>',
};

export function icon(name: string, size = 20): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return span;
}

/** A button with an icon and optional text. */
export function iconButton(name: string, title: string, onclick: () => void, label?: string, extraClass = ''): HTMLButtonElement {
  return h('button', { class: `icon-btn ${extraClass}`.trim(), title, onclick, type: 'button', 'aria-label': title }, icon(name), label ? h('span', {}, label) : null);
}
