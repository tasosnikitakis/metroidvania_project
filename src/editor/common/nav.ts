/** Shared top navigation bar used by both editors. Returns the bar so editors can append their own buttons. */
export function createTopbar(current: 'world' | 'game', title: string): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `
    <span class="title">${title}</span>
    <a href="/editor/world.html" class="${current === 'world' ? 'current' : ''}">World Editor</a>
    <a href="/editor/game.html" class="${current === 'game' ? 'current' : ''}">Game Editor</a>
    <a href="/" target="_blank">Play ↗</a>
    <span class="spacer"></span>`;
  return bar;
}

export function toast(message: string, ms = 1800): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
