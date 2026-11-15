/** Small pop-up menus (the "..." room menu and the right-click menu). */
import { h } from './dom';

export interface MenuItem {
  label: string;
  hint?: string;
  action?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** A thin dividing line instead of an item. */
  separator?: boolean;
}

let openMenuEl: HTMLElement | null = null;

export function closeMenu(): void {
  openMenuEl?.remove();
  openMenuEl = null;
}

/** Show a menu at a page position (it is nudged to stay on screen). */
export function openMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (item.separator) {
      menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    menu.append(h('button', {
      class: `menu-item${item.danger ? ' danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      disabled: item.disabled === true,
      onclick: () => {
        closeMenu();
        item.action?.();
      },
    }, h('span', {}, item.label), item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  openMenuEl = menu;
}

/** Open a menu just below a button. */
export function openMenuBelow(anchor: HTMLElement, items: MenuItem[]): void {
  const r = anchor.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, items);
}

// Any click elsewhere, Escape, scrolling or resizing closes the menu.
window.addEventListener('pointerdown', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target as Node)) closeMenu();
}, true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenuEl) {
    closeMenu();
    e.stopPropagation();
  }
}, true);
window.addEventListener('resize', closeMenu);
window.addEventListener('blur', closeMenu);
