/**
 * ROOM VIEW - everything visible that belongs to one room, built from
 * content and thrown away as a unit when the room changes or reloads.
 */
import Phaser from 'phaser';
import type { ContentBundle } from '../core/content';
import type { ViewRect } from '../fx/view';
import { Atmosphere } from './atmosphere';
import { ParallaxBackground } from './background';
import { DecorLayer } from './decor';
import { RoomEntities } from './entities';
import { buildTilesetTexture, createTileLayers, type TileLayers } from './tiles';

export class RoomView {
  readonly background: ParallaxBackground;
  readonly tiles: TileLayers;
  readonly decor: DecorLayer;
  readonly entities: RoomEntities;
  readonly atmosphere: Atmosphere;
  /** Room size in logical px. */
  readonly widthPx: number;
  readonly heightPx: number;

  constructor(scene: Phaser.Scene, content: ContentBundle) {
    const { room, tileset } = content;
    this.widthPx = room.width * tileset.tileSize;
    this.heightPx = room.height * tileset.tileSize;
    const tilePx = buildTilesetTexture(scene, tileset);
    this.background = new ParallaxBackground(scene, content.background);
    this.tiles = createTileLayers(scene, room, tileset, tilePx);
    this.decor = new DecorLayer(scene, room.decor, content.decor);
    this.entities = new RoomEntities(scene, room.entities);
    this.atmosphere = new Atmosphere(scene, content.background);
  }

  /** Call every rendered frame. */
  update(dt: number, time: number, view: ViewRect): void {
    this.background.update(view, this.heightPx);
    this.decor.update(time);
    this.entities.update(dt, time, view);
    this.atmosphere.update(view);
  }

  destroy(): void {
    this.background.destroy();
    this.tiles.destroy();
    this.decor.destroy();
    this.entities.destroy();
    this.atmosphere.destroy();
  }
}
