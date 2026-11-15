/**
 * ATMOSPHERE - cheap full-screen mood layers:
 *  - ambient: the background's `ambient` colour multiplied over the scene
 *    (lights are drawn AFTER it, so they glow through the gloom),
 *  - fog: a soft band of the fog colour rising from the bottom of the screen,
 *    once behind the level (hazy distance) and faintly in front,
 *  - vignette: gently darkened screen corners.
 * Each is a single stretched image - no shaders, so it costs almost nothing.
 */
import Phaser from 'phaser';
import type { BackgroundDef } from '../../shared/types';
import { DEPTH } from '../constants';
import { parseColor } from '../core/math';
import { TEX } from '../fx/textures';
import type { ViewRect } from '../fx/view';

const VIGNETTE_STRENGTH = 0.42;

export class Atmosphere {
  private ambient: Phaser.GameObjects.Image | null = null;
  private fogBack: Phaser.GameObjects.Image | null = null;
  private fogFront: Phaser.GameObjects.Image | null = null;
  private vignette: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, bg: BackgroundDef) {
    if (bg.ambient) {
      const color = parseColor(bg.ambient);
      if (color !== 0xffffff) {
        this.ambient = scene.add.image(0, 0, TEX.WHITE).setTint(color).setDepth(DEPTH.AMBIENT);
        this.ambient.setBlendMode(Phaser.BlendModes.MULTIPLY);
      }
    }
    if (bg.fog && bg.fog.alpha > 0) {
      const color = parseColor(bg.fog.color, 0x8888aa);
      this.fogBack = scene.add.image(0, 0, TEX.FADE_DOWN).setTint(color).setAlpha(bg.fog.alpha).setDepth(DEPTH.FOG_BACK);
      this.fogFront = scene.add.image(0, 0, TEX.FADE_DOWN).setTint(color).setAlpha(bg.fog.alpha * 0.3).setDepth(DEPTH.FOG_FRONT);
    }
    this.vignette = scene.add.image(0, 0, TEX.VIGNETTE).setAlpha(VIGNETTE_STRENGTH).setDepth(DEPTH.VIGNETTE);
  }

  /** Stretch every layer over the visible area. Call every rendered frame. */
  update(view: ViewRect): void {
    const w = view.w + 4;
    const h = view.h + 4;
    this.ambient?.setPosition(view.cx, view.cy).setDisplaySize(w, h);
    this.vignette.setPosition(view.cx, view.cy).setDisplaySize(w, h);
    this.fogBack?.setPosition(view.cx, view.cy).setDisplaySize(w, h);
    // The front fog only covers the lower 45% of the screen.
    this.fogFront?.setPosition(view.cx, view.bottom - h * 0.225 + 2).setDisplaySize(w, h * 0.45);
  }

  destroy(): void {
    this.ambient?.destroy();
    this.fogBack?.destroy();
    this.fogFront?.destroy();
    this.vignette.destroy();
  }
}
