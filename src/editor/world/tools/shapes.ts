/**
 * Rectangle (R), Flood fill (F), Eyedropper (I), Pan and "Play from here" tools.
 */
import { TILE_SIZE } from '../../../shared/types';
import { floodRegion, rectCells, rectFromCorners, type TileRect } from '../logic/tileOps';
import { brushLabel, eyedrop, fillCells } from './paintOps';
import { ACCENT, inRoom, strokeTileRect, type PointerInfo, type Tool, type ToolHost } from './tool';

export class RectTool implements Tool {
  private start: { x: number; y: number } | null = null;
  private rect: TileRect | null = null;
  private erase = false;

  constructor(private host: ToolHost) {}

  hint(): string { return 'Drag a rectangle to fill it with the current terrain/tiles · Ctrl/Cmd+drag: erase a rectangle · Alt+click: pick'; }
  cursor(): string { return 'crosshair'; }

  onDown(p: PointerInfo): void {
    if (p.alt) { eyedrop(this.host.editor, p.tx, p.ty); return; }
    if (!this.host.editor.room) return;
    this.start = { x: p.tx, y: p.ty };
    this.erase = p.ctrl;
    this.rect = rectFromCorners(p.tx, p.ty, p.tx, p.ty);
    this.host.redraw();
  }

  onDrag(p: PointerInfo): void {
    if (!this.start) return;
    this.rect = rectFromCorners(this.start.x, this.start.y, p.tx, p.ty);
    this.erase = this.erase || p.ctrl;
    this.host.redraw();
  }

  onUp(): void {
    const ed = this.host.editor;
    const room = ed.room;
    if (this.start && this.rect && room) {
      const stroke = ed.beginStroke();
      if (stroke) {
        const cells = rectCells(this.rect, room.width, room.height);
        fillCells(ed, stroke, room, cells, this.rect.x, this.rect.y, this.erase);
        stroke.commit(this.erase ? 'Erase rectangle' : 'Fill rectangle');
      }
    }
    this.onCancel();
  }

  onCancel(): void {
    this.start = null;
    this.rect = null;
    this.host.redraw();
  }

  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    if (this.rect) {
      strokeTileRect(ctx, this.host.view, this.rect, this.erase ? '#ff6b81' : ACCENT);
      const s = this.host.view;
      ctx.save();
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(`${this.rect.w} × ${this.rect.h}`, s.sx(this.rect.x * TILE_SIZE) + 4, s.sy(this.rect.y * TILE_SIZE) - 6);
      ctx.restore();
    } else if (hover) {
      strokeTileRect(ctx, this.host.view, { x: hover.tx, y: hover.ty, w: 1, h: 1 });
    }
  }
}

export class FillTool implements Tool {
  constructor(private host: ToolHost) {}

  hint(): string { return 'Click to flood-fill an area with the current terrain/tiles · Ctrl/Cmd+click: erase the area · Alt+click: pick'; }
  cursor(): string { return 'crosshair'; }

  onDown(p: PointerInfo): void {
    const ed = this.host.editor;
    if (p.alt) { eyedrop(ed, p.tx, p.ty); return; }
    const room = ed.room;
    if (!room || !inRoom(ed, p.tx, p.ty)) return;
    const stroke = ed.beginStroke();
    if (!stroke) return;
    // "Same kind" = the same terrain (any of its 16 shapes), or exactly the same tile.
    const kindOf = (id: number): number | string => {
      const t = ed.terrainIndex.tileToTerrain.get(id);
      return t === undefined ? id : `terrain${t}`;
    };
    const cells = floodRegion(stroke.tiles, room.width, room.height, p.tx, p.ty, kindOf);
    fillCells(ed, stroke, room, cells, p.tx, p.ty, p.ctrl);
    if (!stroke.commit(p.ctrl ? 'Erase area' : `Fill (${brushLabel(ed, false).toLowerCase()})`)) {
      this.host.toast('Nothing to fill here');
    }
  }

  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    if (hover) strokeTileRect(ctx, this.host.view, { x: hover.tx, y: hover.ty, w: 1, h: 1 });
  }
}

export class EyedropperTool implements Tool {
  constructor(private host: ToolHost) {}
  hint(): string { return 'Click a tile to paint with it (tip: Alt+click does this from any paint tool)'; }
  cursor(): string { return 'copy'; }
  onDown(p: PointerInfo): void {
    if (!eyedrop(this.host.editor, p.tx, p.ty)) this.host.toast('Nothing to pick up here');
  }
  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    if (hover) strokeTileRect(ctx, this.host.view, { x: hover.tx, y: hover.ty, w: 1, h: 1 }, '#ffd27a');
  }
}

/** The hand tool does nothing itself: the canvas pans whenever it is active. */
export class PanTool implements Tool {
  hint(): string { return 'Drag to move around · tip: hold Space with any tool, or drag with the middle mouse button'; }
  cursor(): string { return 'grab'; }
}

export class PlayFromTool implements Tool {
  constructor(private host: ToolHost) {}
  hint(): string { return 'Click anywhere in the room to start the game from that spot'; }
  cursor(): string { return 'pointer'; }
  onDown(p: PointerInfo): void {
    if (this.host.editor.room) this.host.playFrom(p.x, p.y);
  }
  draw(ctx: CanvasRenderingContext2D, hover: PointerInfo | null): void {
    if (!hover) return;
    ctx.save();
    ctx.fillStyle = '#7be0a0';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hover.sx - 7, hover.sy - 26);
    ctx.lineTo(hover.sx + 11, hover.sy - 16);
    ctx.lineTo(hover.sx - 7, hover.sy - 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }
}
