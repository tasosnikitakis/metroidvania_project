/**
 * TILE LAYERS
 * -----------
 * Draws a room's back / main / front tile grids using Phaser's tilemap.
 *
 * Seam-free trick ("extrusion"): when the camera sits at a fractional
 * position, the GPU blends each tile's edge pixels with whatever is next to
 * it in the tileset image - normally the neighbouring tile - which shows up
 * as thin flickering lines. At load time we therefore copy the tileset into a
 * new texture where every tile gets a 2px border that repeats its own edge
 * pixels. Blending at the edge then only ever picks up the tile's own colour.
 */
import Phaser from 'phaser';
import type { LayerName, RoomData, TilesetData } from '../../shared/types';
import { DEPTH } from '../constants';

const EXTRUDE = 2;
const EXTRUDED_KEY = 'tileset-extruded';

const LAYER_DEPTH: Record<LayerName, number> = {
  back: DEPTH.TILES_BACK,
  main: DEPTH.TILES_MAIN,
  front: DEPTH.TILES_FRONT,
};

/** Build (or rebuild) the extruded tileset texture. Returns the tile size in image pixels. */
export function buildTilesetTexture(scene: Phaser.Scene, tileset: TilesetData): number {
  const tilePx = Math.round(tileset.tileSize * (tileset.imageScale || 1));
  const columns = Math.max(1, tileset.columns);
  const maxId = tileset.tiles.reduce((m, t) => Math.max(m, t.id), 0);

  let source: CanvasImageSource;
  let rows: number;
  if (scene.textures.exists(tileset.image)) {
    const img = scene.textures.get(tileset.image).getSourceImage() as HTMLImageElement;
    source = img;
    rows = Math.max(1, Math.floor(img.height / tilePx), Math.ceil(maxId / columns));
  } else {
    // No tileset image yet: draw simple colour-coded tiles so the game is still playable.
    rows = Math.max(1, Math.ceil(maxId / columns));
    source = makePlaceholderTiles(tileset, tilePx, columns, rows);
  }

  const cell = tilePx + EXTRUDE * 2;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const sx = col * tilePx;
      const sy = row * tilePx;
      const dx = col * cell + EXTRUDE;
      const dy = row * cell + EXTRUDE;
      const E = EXTRUDE;
      const T = tilePx;
      // Edges first (1px strips stretched outward), then corners, then the tile itself.
      ctx.drawImage(source, sx, sy, T, 1, dx, dy - E, T, E);
      ctx.drawImage(source, sx, sy + T - 1, T, 1, dx, dy + T, T, E);
      ctx.drawImage(source, sx, sy, 1, T, dx - E, dy, E, T);
      ctx.drawImage(source, sx + T - 1, sy, 1, T, dx + T, dy, E, T);
      ctx.drawImage(source, sx, sy, 1, 1, dx - E, dy - E, E, E);
      ctx.drawImage(source, sx + T - 1, sy, 1, 1, dx + T, dy - E, E, E);
      ctx.drawImage(source, sx, sy + T - 1, 1, 1, dx - E, dy + T, E, E);
      ctx.drawImage(source, sx + T - 1, sy + T - 1, 1, 1, dx + T, dy + T, E, E);
      ctx.drawImage(source, sx, sy, T, T, dx, dy, T, T);
    }
  }
  if (scene.textures.exists(EXTRUDED_KEY)) scene.textures.remove(EXTRUDED_KEY);
  scene.textures.addCanvas(EXTRUDED_KEY, canvas);
  return tilePx;
}

function makePlaceholderTiles(tileset: TilesetData, tilePx: number, columns: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = columns * tilePx;
  canvas.height = rows * tilePx;
  const ctx = canvas.getContext('2d')!;
  const colors = { solid: '#4a4466', oneway: '#8a6a3c', hazard: '#b03a5a', none: '#2c2940' } as const;
  for (const t of tileset.tiles) {
    const col = (t.id - 1) % columns;
    const row = Math.floor((t.id - 1) / columns);
    const x = col * tilePx;
    const y = row * tilePx;
    ctx.fillStyle = colors[t.collision] ?? colors.none;
    if (t.collision === 'oneway') ctx.fillRect(x, y, tilePx, tilePx * 0.3);
    else if (t.collision === 'hazard') {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(x + (i * tilePx) / 3, y + tilePx);
        ctx.lineTo(x + ((i + 0.5) * tilePx) / 3, y + tilePx * 0.3);
        ctx.lineTo(x + ((i + 1) * tilePx) / 3, y + tilePx);
      }
      ctx.fill();
    } else ctx.fillRect(x, y, tilePx, tilePx);
  }
  return canvas;
}

export interface TileLayers {
  destroy(): void;
}

/** Create the three tile layers for a room. Call buildTilesetTexture() first. */
export function createTileLayers(scene: Phaser.Scene, room: RoomData, tileset: TilesetData, tilePx: number): TileLayers {
  const map = scene.make.tilemap({ tileWidth: tilePx, tileHeight: tilePx, width: room.width, height: room.height });
  const set = map.addTilesetImage('tiles', EXTRUDED_KEY, tilePx, tilePx, EXTRUDE, EXTRUDE * 2, 1);
  const layers: Phaser.Tilemaps.TilemapLayer[] = [];
  if (set) {
    const maxIndex = set.total; // ids beyond the image are ignored instead of crashing
    for (const name of ['back', 'main', 'front'] as LayerName[]) {
      const data = room.layers[name];
      if (!data || !data.some((id) => id > 0)) continue; // nothing painted on this layer
      const layer = map.createBlankLayer(name, set, 0, 0, room.width, room.height);
      if (!layer) continue;
      // Our ids: 0 = empty, 1 = first tile. Phaser: -1 = empty, firstgid(1) = first tile.
      const grid: number[][] = [];
      for (let y = 0; y < room.height; y++) {
        const row: number[] = new Array(room.width);
        for (let x = 0; x < room.width; x++) {
          const id = data[y * room.width + x] ?? 0;
          row[x] = id > 0 && id <= maxIndex ? id : -1;
        }
        grid.push(row);
      }
      layer.putTilesAt(grid, 0, 0, false);
      // The image is drawn at imageScale x resolution; shrink to logical size.
      layer.setScale(tileset.tileSize / tilePx);
      layer.setDepth(LAYER_DEPTH[name]);
      layer.setCullPadding(2, 2);
      layers.push(layer);
    }
  }
  return {
    destroy() {
      for (const l of layers) l.destroy();
      map.destroy();
    },
  };
}
