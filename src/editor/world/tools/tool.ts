/**
 * What every canvas tool looks like. The canvas turns raw mouse/touch events
 * into `PointerInfo` (already converted to room and tile coordinates) and
 * calls these hooks on whichever tool is active.
 */
import type { Editor } from '../state/editor';
import type { Viewport } from '../render/viewport';

export interface PointerInfo {
  /** Position in the room, logical px. */
  x: number;
  y: number;
  /** Tile under the pointer (can be outside the room!). */
  tx: number;
  ty: number;
  /** Position on the canvas, CSS px. */
  sx: number;
  sy: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl on Windows/Linux, Cmd on Mac. */
  ctrl: boolean;
}

/** Services the canvas offers to tools. */
export interface ToolHost {
  editor: Editor;
  /** The current room viewport. */
  view: Viewport;
  redraw(): void;
  /** Draw a tile in screen space (for brush previews). */
  drawTile(ctx: CanvasRenderingContext2D, id: number, sx: number, sy: number, size: number): void;
  /** Open the game at a position in the current room. */
  playFrom(x: number, y: number): void;
  toast(message: string): void;
}

export interface Tool {
  /** Shown in the status bar while the tool is active. */
  hint(): string;
  /** CSS cursor over the canvas. */
  cursor?(): string;
  onDown?(p: PointerInfo): void;
  /** Pointer moved while the button is held. */
  onDrag?(p: PointerInfo): void;
  onUp?(p: PointerInfo): void;
  /** Pointer moved with no button held. */
  onHover?(p: PointerInfo): void;
  /** The gesture was interrupted (second finger down, Escape...). Put things back. */
  onCancel?(): void;
  /** Finish anything half-done (called when switching tool/room and before saving). */
  flush?(): void;
  /** Draw previews/handles. The context is in CSS px (screen space). */
  draw?(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void;
  /** Return true if the key was used. */
  onKey?(e: KeyboardEvent): boolean;
  /** Called before undo/redo; return true to swallow it (e.g. cancel a floating paste instead). */
  onBeforeHistory?(direction: 'undo' | 'redo'): boolean;
}

/* ---- small drawing helpers shared by tools ---- */

import { TILE_SIZE } from '../../../shared/types';
import type { TileRect } from '../logic/tileOps';

export const ACCENT = '#6ee7ff';

/** Screen rectangle of a rectangle of tiles. */
export function tileRectOnScreen(view: Viewport, r: TileRect): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(view.sx(r.x * TILE_SIZE)),
    y: Math.round(view.sy(r.y * TILE_SIZE)),
    w: Math.round(r.w * TILE_SIZE * view.zoom),
    h: Math.round(r.h * TILE_SIZE * view.zoom),
  };
}

/** A two-tone outline that is visible on both light and dark art. */
export function strokeTileRect(ctx: CanvasRenderingContext2D, view: Viewport, r: TileRect, color = ACCENT, dashed = false): void {
  const s = tileRectOnScreen(view, r);
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w, s.h);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w, s.h);
  ctx.restore();
}

export function inRoom(editor: Editor, tx: number, ty: number): boolean {
  const room = editor.room;
  return !!room && tx >= 0 && ty >= 0 && tx < room.width && ty < room.height;
}
