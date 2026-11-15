/**
 * Decor geometry: where a decor picture ends up on screen given its anchor
 * (originX/Y), scale, rotation and flip. Used for drawing, clicking and outlines.
 *
 * The picture's rectangle hangs off the anchor point:
 *   left = -originX * w,  top = -originY * h     (before scale & rotation)
 * Flipping mirrors the picture INSIDE that rectangle (the same as the game does).
 */
import type { DecorDef, DecorInstance } from '../../../shared/types';

const RAD = Math.PI / 180;

export function decorScale(inst: DecorInstance): number {
  return inst.scale ?? 1;
}

/** Convert a room position into the decor's own un-rotated, un-scaled space (anchor = 0,0). */
function toLocal(inst: DecorInstance, x: number, y: number): { lx: number; ly: number } {
  const a = -(inst.rotation ?? 0) * RAD;
  const dx = x - inst.x;
  const dy = y - inst.y;
  const s = decorScale(inst) || 1;
  return { lx: (dx * Math.cos(a) - dy * Math.sin(a)) / s, ly: (dx * Math.sin(a) + dy * Math.cos(a)) / s };
}

/** Is the room position (x,y) inside this decor's picture? `pad` grows the target for tiny pictures. */
export function decorHit(def: DecorDef, inst: DecorInstance, x: number, y: number, pad = 0): boolean {
  const { lx, ly } = toLocal(inst, x, y);
  const left = -def.originX * def.w;
  const top = -def.originY * def.h;
  return lx >= left - pad && lx <= left + def.w + pad && ly >= top - pad && ly <= top + def.h + pad;
}

/** The four corners of the picture in room space (for selection outlines). */
export function decorCorners(def: DecorDef, inst: DecorInstance): Array<{ x: number; y: number }> {
  const a = (inst.rotation ?? 0) * RAD;
  const s = decorScale(inst);
  const left = -def.originX * def.w;
  const top = -def.originY * def.h;
  const pts = [[left, top], [left + def.w, top], [left + def.w, top + def.h], [left, top + def.h]];
  return pts.map(([lx, ly]) => ({
    x: inst.x + (lx * Math.cos(a) - ly * Math.sin(a)) * s,
    y: inst.y + (lx * Math.sin(a) + ly * Math.cos(a)) * s,
  }));
}

/** Rough radius around the anchor that surely contains the picture (for skipping off-screen decor). */
export function decorReach(def: DecorDef, inst: DecorInstance): number {
  return Math.hypot(def.w, def.h) * Math.abs(decorScale(inst));
}

/**
 * Draw a decor item. The context must already be in ROOM space
 * (1 unit = 1 logical px). `img` may be null while loading -> a placeholder box is drawn.
 */
export function drawDecor(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, def: DecorDef, inst: DecorInstance, alphaMul = 1): void {
  const left = -def.originX * def.w;
  const top = -def.originY * def.h;
  ctx.save();
  ctx.translate(inst.x, inst.y);
  if (inst.rotation) ctx.rotate(inst.rotation * RAD);
  const s = decorScale(inst);
  if (s !== 1) ctx.scale(s, s);
  ctx.globalAlpha *= (inst.alpha ?? 1) * alphaMul;
  if (inst.flipX) {
    const cx = left + def.w / 2;
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }
  if (img) {
    ctx.drawImage(img, left, top, def.w, def.h);
  } else {
    ctx.fillStyle = 'rgba(181,140,255,0.18)';
    ctx.strokeStyle = 'rgba(181,140,255,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(left, top, def.w, def.h);
    ctx.strokeRect(left, top, def.w, def.h);
  }
  ctx.restore();
}
