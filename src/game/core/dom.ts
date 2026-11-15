/**
 * Small HTML overlays on top of the game canvas: loading screen, error
 * message, the fading controls hint and the debug read-out. Plain DOM text is
 * always razor sharp and trivially easy to restyle.
 */

const STYLE = `
.mv-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 14px; background: #0b0a12; color: #cfc8e6; z-index: 20;
  font: 16px/1.5 Georgia, 'Times New Roman', serif; letter-spacing: 0.06em; text-align: center;
  transition: opacity 0.45s ease; padding: 24px; }
.mv-overlay.mv-hidden { opacity: 0; pointer-events: none; }
.mv-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid #3a3358; border-top-color: #b9a6ff;
  animation: mv-spin 0.9s linear infinite; }
@keyframes mv-spin { to { transform: rotate(360deg); } }
.mv-error h1 { font-size: 22px; margin: 0; color: #ffb3c1; font-weight: normal; }
.mv-error p { margin: 0; max-width: 560px; color: #a9a2c4; }
.mv-error code { color: #ffd9a0; font-size: 13px; word-break: break-word; }
.mv-error button { font: inherit; color: #1a1626; background: #b9a6ff; border: 0; border-radius: 6px;
  padding: 8px 18px; cursor: pointer; }
.mv-hint { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 10;
  color: #e6e0f5; background: rgba(14, 12, 24, 0.55); border: 1px solid rgba(190, 170, 255, 0.18);
  border-radius: 18px; padding: 7px 18px; font: 13px/1.5 Georgia, serif; letter-spacing: 0.04em;
  white-space: pre-wrap; text-align: center; pointer-events: none; opacity: 0; transition: opacity 1.2s ease;
  width: max-content; max-width: 92vw; box-sizing: border-box; }
.mv-hint.mv-show { opacity: 0.92; }
.mv-debug { position: fixed; left: 8px; top: 8px; z-index: 15; color: #b8ffcf; background: rgba(0, 0, 0, 0.55);
  font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; padding: 6px 9px; border-radius: 4px;
  white-space: pre; pointer-events: none; display: none; }
`;

let styleInstalled = false;
function installStyle(): void {
  if (styleInstalled) return;
  styleInstalled = true;
  const el = document.createElement('style');
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function make(className: string, html = ''): HTMLDivElement {
  installStyle();
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

let loadingEl: HTMLDivElement | null = null;

export function showLoading(text = 'Loading…'): void {
  if (!loadingEl) loadingEl = make('mv-overlay', `<div class="mv-spinner"></div><div class="mv-loading-text"></div>`);
  loadingEl.querySelector('.mv-loading-text')!.textContent = text;
  loadingEl.classList.remove('mv-hidden');
}

export function hideLoading(): void {
  loadingEl?.classList.add('mv-hidden');
}

let errorEl: HTMLDivElement | null = null;

/** Friendly full-screen error with a retry button. */
export function showError(title: string, detail: string, onRetry?: () => void): void {
  hideLoading();
  errorEl?.remove();
  errorEl = make(
    'mv-overlay mv-error',
    `<h1>${escapeHtml(title)}</h1>
     <p>The game could not load its content. Is the server running (<code>npm run dev</code>)?</p>
     <p><code>${escapeHtml(detail)}</code></p>
     <button type="button">Try again</button>`,
  );
  errorEl.querySelector('button')!.addEventListener('click', () => {
    errorEl?.remove();
    errorEl = null;
    if (onRetry) onRetry();
    else location.reload();
  });
}

export function hideError(): void {
  errorEl?.remove();
  errorEl = null;
}

/** Show the controls hint, then fade it away. */
export function showHint(text: string, seconds = 7): void {
  const el = make('mv-hint');
  el.textContent = text;
  requestAnimationFrame(() => el.classList.add('mv-show'));
  window.setTimeout(() => el.classList.remove('mv-show'), seconds * 1000);
  window.setTimeout(() => el.remove(), seconds * 1000 + 1500);
}

let debugEl: HTMLDivElement | null = null;

export function setDebugText(text: string | null): void {
  if (!debugEl) debugEl = make('mv-debug');
  if (text === null) {
    debugEl.style.display = 'none';
  } else {
    debugEl.style.display = 'block';
    if (debugEl.textContent !== text) debugEl.textContent = text;
  }
}
