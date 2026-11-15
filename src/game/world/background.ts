/**
 * PARALLAX BACKGROUND
 * -------------------
 * A sky gradient plus image layers that scroll slower than the world, which
 * is what gives the scene depth.
 *
 * How a layer is placed (all in logical px):
 *  - scrollX / scrollY: 0 = glued to the screen, 1 = moves exactly with the room.
 *  - Horizontally the layer starts lined up with the room's left edge and
 *    slides by cameraLeft * scrollX. With repeatX it tiles forever.
 *  - Vertically it hangs from the screen's top or bottom edge (`anchorY`),
 *    pushed INTO the screen by `offsetY`. As the camera moves away from that
 *    edge of the room, the layer slides off by distance * scrollY.
 *    (So with scrollY = 1 a bottom-anchored layer sits on the room's floor line.)
 *
 * We position everything by hand each frame from the exact (interpolated)
 * camera position instead of using Phaser scroll factors: it keeps the maths
 * in one obvious place and is independent of zoom.
 */
import Phaser from 'phaser';
import type { BackgroundDef, BackgroundLayer } from '../../shared/types';
import { DEPTH } from '../constants';
import { ensureSkyTexture } from '../fx/textures';
import type { ViewRect } from '../fx/view';

interface LayerView {
  def: BackgroundLayer;
  images: Phaser.GameObjects.Image[];
}

export class ParallaxBackground {
  private sky: Phaser.GameObjects.Image;
  private layers: LayerView[] = [];

  constructor(private scene: Phaser.Scene, def: BackgroundDef) {
    this.sky = scene.add.image(0, 0, ensureSkyTexture(scene, def.skyTop, def.skyBottom)).setDepth(DEPTH.SKY);
    def.layers.forEach((layer, i) => {
      if (!scene.textures.exists(layer.image) || !(layer.w > 0) || !(layer.h > 0)) return;
      this.layers.push({ def: layer, images: [this.makeImage(layer, i)] });
    });
  }

  private makeImage(layer: BackgroundLayer, index: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(0, 0, layer.image).setOrigin(0, 0);
    img.setDisplaySize(layer.w, layer.h).setAlpha(layer.alpha ?? 1).setDepth(DEPTH.PARALLAX + index);
    return img;
  }

  /** Call every rendered frame with the visible world rectangle and the room size. */
  update(view: ViewRect, roomH: number): void {
    // Sky always exactly covers the screen (1px bleed hides rounding at the edges).
    this.sky.setPosition(view.cx, view.cy).setDisplaySize(view.w + 2, view.h + 2);

    for (const lv of this.layers) {
      const d = lv.def;
      // Vertical placement.
      let y: number;
      if (d.anchorY === 'top') y = view.top + d.offsetY + (0 - view.top) * d.scrollY;
      else y = view.bottom - d.offsetY - d.h + (roomH - view.bottom) * d.scrollY;

      // Horizontal placement: where the layer's x=0 sits in world space right now.
      const originX = view.left * (1 - d.scrollX);

      if (!d.repeatX) {
        lv.images[0].setPosition(originX, y);
        continue;
      }
      // Tile across the screen: enough copies to cover it, starting just left of the view.
      const needed = Math.ceil(view.w / d.w) + 1;
      while (lv.images.length < needed) {
        const depthIndex = lv.images[0].depth - DEPTH.PARALLAX;
        lv.images.push(this.makeImage(d, depthIndex));
      }
      const first = Math.floor((view.left - originX) / d.w);
      for (let i = 0; i < lv.images.length; i++) {
        const img = lv.images[i];
        img.setVisible(i < needed);
        if (i < needed) img.setPosition(originX + (first + i) * d.w, y);
      }
    }
  }

  destroy(): void {
    this.sky.destroy();
    for (const lv of this.layers) for (const img of lv.images) img.destroy();
    this.layers.length = 0;
  }
}
