/**
 * Image loading. Ask for an image by its site-relative URL (as written in the
 * content JSON, e.g. "assets/decor/torch.png"); you get null until it has
 * loaded, and `onAssetLoaded` fires so the canvas can repaint.
 */
type Entry = { img: HTMLImageElement; state: 'loading' | 'ready' | 'failed' };

const cache = new Map<string, Entry>();
const listeners: Array<(url: string) => void> = [];

export function onAssetLoaded(fn: (url: string) => void): void {
  listeners.push(fn);
}

export function assetUrl(url: string): string {
  return /^(https?:|data:|\/)/.test(url) ? url : `/${url}`;
}

export function getImage(url: string): HTMLImageElement | null {
  if (!url) return null;
  let entry = cache.get(url);
  if (!entry) {
    const img = new Image();
    const created: Entry = { img, state: 'loading' };
    entry = created;
    cache.set(url, created);
    img.onload = () => {
      created.state = 'ready';
      for (const fn of listeners) fn(url);
    };
    img.onerror = () => {
      created.state = 'failed';
    };
    img.src = assetUrl(url);
  }
  return entry.state === 'ready' ? entry.img : null;
}

export function imageFailed(url: string): boolean {
  return cache.get(url)?.state === 'failed';
}
