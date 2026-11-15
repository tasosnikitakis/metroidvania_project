/**
 * HiDPI DISPLAY
 * -------------
 * The canvas is sized in REAL device pixels (CSS size x devicePixelRatio) and
 * shown at 1/dpr CSS scale, so a 4K or "retina" screen gets a genuinely
 * sharp image instead of a blurry upscaled one. The scene then picks a camera
 * zoom so the same amount of world is visible on every screen.
 */
import Phaser from 'phaser';
import { VIEW_HEIGHT } from '../../shared/types';
import { MAX_DEVICE_PIXEL_RATIO, MIN_VIEW_WIDTH } from '../constants';

export function devicePixelRatio(): number {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
}

/** Canvas size in device pixels for the given container element. */
export function canvasSizeFor(parent: HTMLElement): { width: number; height: number; dpr: number } {
  const dpr = devicePixelRatio();
  const cssW = Math.max(parent.clientWidth || window.innerWidth, 64);
  const cssH = Math.max(parent.clientHeight || window.innerHeight, 64);
  return { width: Math.round(cssW * dpr), height: Math.round(cssH * dpr), dpr };
}

/** Keep the canvas matched to its container and the screen's pixel ratio. */
export function installAutoResize(game: Phaser.Game, parent: HTMLElement): void {
  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;
  const apply = () => {
    const { width, height, dpr } = canvasSizeFor(parent);
    if (width === lastW && height === lastH && dpr === lastDpr) return;
    lastW = width;
    lastH = height;
    lastDpr = dpr;
    game.scale.setZoom(1 / dpr); // CSS size = canvas size / dpr
    game.scale.resize(width, height);
  };
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(apply).observe(parent);
  // Dragging the window to a screen with a different pixel ratio does not
  // always fire "resize", so also poll cheaply.
  window.setInterval(apply, 1000);
  apply();
}

/**
 * Camera zoom (device px per logical px) so that VIEW_HEIGHT logical px fit
 * vertically - or, on narrow/portrait screens, at least MIN_VIEW_WIDTH fit across.
 */
export function cameraZoomFor(canvasW: number, canvasH: number, configZoom: number): number {
  const byHeight = canvasH / VIEW_HEIGHT;
  const byWidth = canvasW / MIN_VIEW_WIDTH;
  return Math.max(0.05, Math.min(byHeight, byWidth) * Math.max(configZoom, 0.1));
}
