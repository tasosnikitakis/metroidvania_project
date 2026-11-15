/**
 * Small textures drawn in code at start-up (soft glows, dust dots, the
 * vignette...). Generating them means the effects work even with zero art
 * files, and they stay perfectly smooth at any resolution.
 */
import Phaser from 'phaser';

export const TEX = {
  GLOW: 'fx-glow',
  DOT: 'fx-dot',
  LEAF: 'fx-leaf',
  VIGNETTE: 'fx-vignette',
  FADE_DOWN: 'fx-fade-down',
  WHITE: 'fx-white',
} as const;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')!];
}

function add(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}

/** Create every generated texture once. Safe to call again. */
export function ensureFxTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX.GLOW)) return;

  // Soft radial glow: bright core fading smoothly to nothing (used additively for lights).
  {
    const s = 256;
    const [c, ctx] = makeCanvas(s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    // Many stops approximating a smooth (1 - r²)² falloff: no visible rings.
    for (let i = 0; i <= 16; i++) {
      const r = i / 16;
      const a = Math.pow(1 - r * r, 2);
      g.addColorStop(r, `rgba(255,255,255,${a.toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    add(scene, TEX.GLOW, c);
  }

  // Soft-edged dot for dust and motes.
  {
    const s = 64;
    const [c, ctx] = makeCanvas(s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    add(scene, TEX.DOT, c);
  }

  // A little leaf shape.
  {
    const [c, ctx] = makeCanvas(48, 24);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(2, 12);
    ctx.quadraticCurveTo(24, -6, 46, 12);
    ctx.quadraticCurveTo(24, 30, 2, 12);
    ctx.fill();
    add(scene, TEX.LEAF, c);
  }

  // Vignette: clear in the middle, dark toward the corners.
  {
    const s = 512;
    const [c, ctx] = makeCanvas(s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.72);
    for (let i = 0; i <= 12; i++) {
      const r = i / 12;
      g.addColorStop(r, `rgba(0,0,0,${(r * r * (3 - 2 * r)).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    add(scene, TEX.VIGNETTE, c);
  }

  // White strip that fades in toward the bottom (tinted for fog).
  {
    const [c, ctx] = makeCanvas(8, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    for (let i = 0; i <= 8; i++) {
      const r = i / 8;
      g.addColorStop(r, `rgba(255,255,255,${(r * r).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
    add(scene, TEX.FADE_DOWN, c);
  }

  // Plain white square (tinted + stretched for flat colour overlays).
  {
    const [c, ctx] = makeCanvas(8, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 8, 8);
    add(scene, TEX.WHITE, c);
  }
}

/** Vertical two-colour gradient texture for the sky. Returns its key. */
export function ensureSkyTexture(scene: Phaser.Scene, top: string, bottom: string): string {
  const key = `sky-${top}-${bottom}`;
  if (scene.textures.exists(key)) return key;
  const [c, ctx] = makeCanvas(8, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  try {
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
  } catch {
    g.addColorStop(0, '#141226');
    g.addColorStop(1, '#2a2440');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 512);
  scene.textures.addCanvas(key, c);
  return key;
}
