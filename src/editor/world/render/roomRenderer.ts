/**
 * Draws one room exactly in the game's layer order:
 *
 *   background -> far decor -> BACK tiles -> back decor -> MAIN tiles
 *   -> entity markers -> front decor -> FRONT tiles
 *
 * then editor-only overlays (collision tint, grid, room outline).
 * Only what is on screen is drawn.
 */
import {
  TILE_SIZE,
  type DecorInstance, type EntityInstance, type LayerName, type RoomData,
} from '../../../shared/types';
import { entityType } from '../../../shared/entities';
import type { Editor } from '../state/editor';
import { getImage } from './assets';
import { decorReach, drawDecor } from './decorGeom';
import { CACHE_PX_PER_TILE, type TileCache, type TileDrawer } from './tiles';
import type { Viewport } from './viewport';

const COLLISION_COLORS: Record<string, string> = {
  solid: 'rgba(80,160,255,0.38)',
  oneway: 'rgba(255,214,90,0.55)',
  hazard: 'rgba(255,70,90,0.5)',
};

export interface RoomRenderOptions {
  /** Fade the tile layers that are not being edited. */
  dimInactive: boolean;
}

export class RoomRenderer {
  constructor(private editor: Editor, private drawer: TileDrawer, private cache: TileCache) {}

  draw(ctx: CanvasRenderingContext2D, room: RoomData, view: Viewport, dpr: number, opts: RoomRenderOptions): void {
    const ed = this.editor;
    const s = view.zoom * dpr; // device pixels per logical pixel
    const roomW = room.width * TILE_SIZE;
    const roomH = room.height * TILE_SIZE;

    // Visible part of the room, in tiles and in logical px.
    const wx0 = view.x;
    const wy0 = view.y;
    const wx1 = view.x + view.width / view.zoom;
    const wy1 = view.y + view.height / view.zoom;
    const tx0 = Math.max(0, Math.floor(wx0 / TILE_SIZE));
    const ty0 = Math.max(0, Math.floor(wy0 / TILE_SIZE));
    const tx1 = Math.min(room.width, Math.ceil(wx1 / TILE_SIZE));
    const ty1 = Math.min(room.height, Math.ceil(wy1 / TILE_SIZE));

    // Device-pixel position of a tile column / row edge. Rounding here (and using
    // the difference of two rounded edges as the size) avoids hairline gaps between tiles.
    const px = (tx: number): number => Math.round((tx * TILE_SIZE - view.x) * s);
    const py = (ty: number): number => Math.round((ty * TILE_SIZE - view.y) * s);
    const worldSpace = (): void => ctx.setTransform(s, 0, 0, s, -view.x * s, -view.y * s);
    const deviceSpace = (): void => ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* ---------- background ---------- */
    deviceSpace();
    const rx = px(0);
    const ry = py(0);
    const rw = px(room.width) - rx;
    const rh = py(room.height) - ry;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    const bg = ed.background(room.background);
    if (ed.view.background && bg) {
      const grad = ctx.createLinearGradient(0, ry, 0, ry + rh);
      grad.addColorStop(0, bg.skyTop);
      grad.addColorStop(1, bg.skyBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(rx, ry, rw, rh);
      worldSpace();
      ctx.imageSmoothingEnabled = true;
      for (const layer of bg.layers) {
        const img = getImage(layer.image);
        if (!img) continue;
        // Rough static preview: the game scrolls these with parallax, here they just sit in the room.
        const y = layer.anchorY === 'top' ? layer.offsetY : roomH - layer.h - layer.offsetY;
        ctx.globalAlpha = layer.alpha ?? 1;
        if (layer.repeatX) {
          const first = Math.max(0, Math.floor(wx0 / layer.w));
          const last = Math.min(Math.ceil(roomW / layer.w), Math.ceil(wx1 / layer.w));
          for (let i = first; i < last; i++) ctx.drawImage(img, i * layer.w, y, layer.w + 0.5, layer.h);
        } else {
          ctx.drawImage(img, (roomW - layer.w) / 2, y, layer.w, layer.h);
        }
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#221d33';
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();

    /* ---------- layers ---------- */
    const dimTiles = (layer: LayerName): number => (opts.dimInactive && layer !== ed.activeLayer ? 0.3 : 1);

    const drawTiles = (layer: LayerName): void => {
      if (!ed.layerVisible[layer] || tx1 <= tx0 || ty1 <= ty0) return;
      const tiles = room.layers[layer];
      deviceSpace();
      ctx.globalAlpha = dimTiles(layer);
      const tilePx = TILE_SIZE * s;
      if (tilePx < CACHE_PX_PER_TILE) {
        // Far zoom: one pre-drawn picture per layer.
        const c = this.cache.get(room, layer);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(
          c.canvas, tx0 * c.ppt, ty0 * c.ppt, (tx1 - tx0) * c.ppt, (ty1 - ty0) * c.ppt,
          px(tx0), py(ty0), px(tx1) - px(tx0), py(ty1) - py(ty0),
        );
      } else {
        // Crisp pixels when magnified beyond the art's own resolution, smooth when shrunk.
        const smooth = tilePx < this.drawer.cellPx;
        ctx.imageSmoothingEnabled = smooth;
        ctx.imageSmoothingQuality = 'medium';
        const inset = smooth ? 0.5 : 0;
        for (let ty = ty0; ty < ty1; ty++) {
          const y0 = py(ty);
          const h = py(ty + 1) - y0;
          const row = ty * room.width;
          for (let tx = tx0; tx < tx1; tx++) {
            const id = tiles[row + tx];
            if (id > 0) {
              const x0 = px(tx);
              this.drawer.draw(ctx, id, x0, y0, Math.max(h, px(tx + 1) - x0), inset);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const drawDecorLayer = (layer: DecorInstance['layer']): void => {
      if (!ed.view.decor) return;
      worldSpace();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const d of room.decor) {
        if (d.layer !== layer) continue;
        const def = ed.decorDefs.get(d.key);
        if (!def) { this.drawMissingDecor(ctx, d); continue; }
        const reach = decorReach(def, d);
        if (d.x + reach < wx0 || d.x - reach > wx1 || d.y + reach < wy0 || d.y - reach > wy1) continue;
        drawDecor(ctx, getImage(def.image), def, d);
      }
    };

    drawDecorLayer('far');
    drawTiles('back');
    drawDecorLayer('back');
    drawTiles('main');
    if (ed.view.entities) {
      worldSpace();
      for (const e of room.entities) this.drawEntity(ctx, e, view.zoom, ed.selection?.kind === 'entity' && ed.selection.ids.includes(e.id));
    }
    drawDecorLayer('front');
    drawTiles('front');

    /* ---------- editor overlays ---------- */
    deviceSpace();
    if (ed.view.collision && ed.layerVisible.main) {
      const tiles = room.layers.main;
      for (let ty = ty0; ty < ty1; ty++) {
        const y0 = py(ty);
        const h = py(ty + 1) - y0;
        for (let tx = tx0; tx < tx1; tx++) {
          const id = tiles[ty * room.width + tx];
          if (id === 0) continue;
          const kind = ed.collisionOf(id);
          if (kind === 'none') continue;
          const x0 = px(tx);
          const w = px(tx + 1) - x0;
          ctx.fillStyle = COLLISION_COLORS[kind];
          if (kind === 'oneway') ctx.fillRect(x0, y0, w, Math.max(2, h * 0.3)); // only the top surface is solid
          else ctx.fillRect(x0, y0, w, h);
        }
      }
    }

    if (ed.view.grid && TILE_SIZE * s >= 7 * dpr) {
      ctx.beginPath();
      for (let tx = tx0; tx <= tx1; tx++) {
        const x = px(tx) + 0.5;
        ctx.moveTo(x, py(ty0));
        ctx.lineTo(x, py(ty1));
      }
      for (let ty = ty0; ty <= ty1; ty++) {
        const y = py(ty) + 0.5;
        ctx.moveTo(px(tx0), y);
        ctx.lineTo(px(tx1), y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.11)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Room outline.
    ctx.strokeStyle = 'rgba(181,140,255,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
    ctx.strokeRect(rx - 1, ry - 1, rw + 2, rh + 2);
  }

  private drawMissingDecor(ctx: CanvasRenderingContext2D, d: DecorInstance): void {
    ctx.save();
    ctx.strokeStyle = '#ff6b81';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(d.x - 20, d.y - 40, 40, 40);
    ctx.fillStyle = '#ff6b81';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', d.x, d.y - 12);
    ctx.restore();
  }

  /** A round marker with the entity's glyph. Context is in room space. */
  private drawEntity(ctx: CanvasRenderingContext2D, e: EntityInstance, zoom: number, selected: boolean): void {
    const def = entityType(e.type);
    const color = def?.color ?? '#ff6b81';
    // Markers never get smaller than ~11 screen px so they stay clickable when zoomed out.
    const r = Math.max(15, 11 / zoom);
    ctx.save();

    if (e.type === 'playerStart') {
      // Ghost of the hero's body standing on the point (position = feet).
      const w = 30;
      const h = 60;
      ctx.fillStyle = 'rgba(110,231,255,0.16)';
      ctx.strokeStyle = 'rgba(110,231,255,0.7)';
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.roundRect(e.x - w / 2, e.y - h, w, h, 8);
      ctx.fill();
      ctx.stroke();
      const dir = e.props.facing === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(e.x + dir * (w / 2 + 4), e.y - h * 0.6 - 7);
      ctx.lineTo(e.x + dir * (w / 2 + 16), e.y - h * 0.6);
      ctx.lineTo(e.x + dir * (w / 2 + 4), e.y - h * 0.6 + 7);
      ctx.closePath();
      ctx.fillStyle = 'rgba(110,231,255,0.8)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,18,28,0.82)';
    ctx.fill();
    ctx.lineWidth = (selected ? 3.5 : 2) / Math.min(1, zoom * 1.4);
    ctx.strokeStyle = selected ? '#ffffff' : color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `${r * 1.15}px system-ui, "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def?.glyph ?? '?', e.x, e.y + r * 0.06);
    ctx.restore();
  }
}
