/**
 * Tile drawing + a small cache for far-zoomed-out views.
 *
 * Zoomed in, tiles are drawn straight from the tileset image (only the ones
 * on screen). Zoomed far out, a 300x100 room would mean ~90,000 little draws
 * per frame, so each layer is pre-drawn once into a small off-screen canvas
 * ("cache") and that single picture is drawn instead. Painting updates just
 * the changed cells of the cache.
 */
import type { LayerName, RoomData, TilesetData } from '../../../shared/types';
import { hash2 } from '../logic/autotile';
import { getImage } from './assets';

/** Below this many device pixels per tile the cache is used. Also the cache's resolution. */
export const CACHE_PX_PER_TILE = 16;
const MAX_CACHE_SIDE = 4096;

export class TileDrawer {
  constructor(private tileset: () => TilesetData, private collisionColor: (id: number) => string | null) {}

  get image(): HTMLImageElement | null {
    return getImage(this.tileset().image);
  }

  /** Native pixel size of one tile in the tileset image. */
  get cellPx(): number {
    const ts = this.tileset();
    return ts.tileSize * ts.imageScale;
  }

  /**
   * Smaller copies of the tileset (half size, quarter size, ...). Shrinking a
   * detailed tile a lot in one go makes it shimmer; picking the copy closest to
   * the size we need keeps bricks looking like bricks when zoomed out.
   */
  private mips: CanvasImageSource[] = [];
  private mipsFor: HTMLImageElement | null = null;

  private levels(img: HTMLImageElement): CanvasImageSource[] {
    if (this.mipsFor !== img) {
      this.mipsFor = img;
      this.mips = [img];
      let cell = this.cellPx;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      let prev: CanvasImageSource = img;
      // Halve while tile edges still land on whole pixels (so tiles never smear into each other).
      while (cell % 2 === 0 && cell >= 8 && w % 2 === 0 && h % 2 === 0) {
        cell /= 2; w /= 2; h /= 2;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d')!;
        cx.imageSmoothingEnabled = true;
        cx.drawImage(prev, 0, 0, w, h);
        this.mips.push(c);
        prev = c;
      }
    }
    return this.mips;
  }

  /**
   * Draw one tile at (dx,dy) with the given size, in whatever space the context is in.
   * `inset` trims the source by a fraction of a pixel to stop neighbouring atlas tiles bleeding in when smoothing.
   */
  draw(ctx: CanvasRenderingContext2D, id: number, dx: number, dy: number, size: number, inset = 0): void {
    if (id <= 0) return;
    const img = this.image;
    const ts = this.tileset();
    if (img) {
      const full = this.cellPx;
      const col = (id - 1) % ts.columns;
      const row = Math.floor((id - 1) / ts.columns);
      if ((row + 1) * full <= img.naturalHeight + 0.5) {
        const levels = this.levels(img);
        let level = 0;
        while (level + 1 < levels.length && full / 2 ** (level + 1) >= size) level++;
        const cell = full / 2 ** level;
        ctx.drawImage(levels[level], col * cell + inset, row * cell + inset, cell - inset * 2, cell - inset * 2, dx, dy, size, size);
        return;
      }
    }
    // No picture (yet): a flat colour per tile id so the room is still readable.
    ctx.fillStyle = this.collisionColor(id) ?? `hsl(${hash2(id, 7) % 360} 35% 45%)`;
    ctx.fillRect(dx, dy, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(dx, dy + size * 0.85, size, size * 0.15);
  }
}

interface LayerCache { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; ppt: number; width: number; height: number; layer: number[] }

export class TileCache {
  private caches = new Map<string, LayerCache>();

  constructor(private drawer: TileDrawer) {}

  private key(roomId: string, layer: LayerName): string { return `${roomId}:${layer}`; }

  /** Get (building if needed) the cached picture of one layer. */
  get(room: RoomData, layer: LayerName): LayerCache {
    const key = this.key(room.id, layer);
    let c = this.caches.get(key);
    const tiles = room.layers[layer];
    if (c && (c.layer !== tiles || c.width !== room.width || c.height !== room.height)) c = undefined;
    if (!c) {
      const ppt = Math.max(2, Math.min(CACHE_PX_PER_TILE, Math.floor(MAX_CACHE_SIDE / Math.max(room.width, room.height))));
      const canvas = document.createElement('canvas');
      canvas.width = room.width * ppt;
      canvas.height = room.height * ppt;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      c = { canvas, ctx, ppt, width: room.width, height: room.height, layer: tiles };
      for (let y = 0; y < room.height; y++) {
        for (let x = 0; x < room.width; x++) {
          const id = tiles[y * room.width + x];
          if (id > 0) this.drawer.draw(ctx, id, x * ppt, y * ppt, ppt, 0.5);
        }
      }
      this.caches.set(key, c);
    }
    return c;
  }

  /** A tile changed (index) or a whole layer / room changed (null). */
  notify(roomId: string, layer: LayerName | null, index: number | null): void {
    if (layer === null) {
      for (const key of [...this.caches.keys()]) if (key.startsWith(`${roomId}:`)) this.caches.delete(key);
      return;
    }
    const key = this.key(roomId, layer);
    const c = this.caches.get(key);
    if (!c) return;
    if (index === null) { this.caches.delete(key); return; }
    const x = index % c.width;
    const y = (index - x) / c.width;
    c.ctx.clearRect(x * c.ppt, y * c.ppt, c.ppt, c.ppt);
    const id = c.layer[index];
    if (id > 0) this.drawer.draw(c.ctx, id, x * c.ppt, y * c.ppt, c.ppt, 0.5);
  }

  /** Forget everything (e.g. the tileset image just finished loading). */
  clear(): void {
    this.caches.clear();
  }
}
