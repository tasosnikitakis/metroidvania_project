/**
 * THE CANVAS
 * Owns the big drawing area: repaints it when something changed, and turns
 * mouse / trackpad / touch / pen input into tool actions, panning and zooming.
 *
 * Repainting is lazy: anything can call redraw() as often as it likes, and
 * the room is painted at most once per animation frame.
 */
import { TILE_SIZE, VIEW_HEIGHT, VIEW_WIDTH } from '../../../shared/types';
import type { Editor, ToolId } from '../state/editor';
import { EntityTool, DecorTool, pickDecor, pickEntity } from '../tools/objects';
import { PaintTool } from '../tools/paint';
import { SelectTool } from '../tools/select';
import { EyedropperTool, FillTool, PanTool, PlayFromTool, RectTool } from '../tools/shapes';
import type { PointerInfo, Tool, ToolHost } from '../tools/tool';
import { onAssetLoaded } from './assets';
import { MapView } from './mapView';
import { RoomRenderer } from './roomRenderer';
import { TileCache, TileDrawer } from './tiles';
import { Viewport } from './viewport';

export interface CanvasCallbacks {
  playFrom(x: number, y: number): void;
  toast(message: string): void;
  /** Right-click / long-press. clientX/Y are page coordinates for placing the menu. */
  contextMenu(p: PointerInfo, clientX: number, clientY: number): void;
}

type Gesture =
  | { kind: 'tool' }
  | { kind: 'map' }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'pinch'; dist: number; cx: number; cy: number };

export class CanvasView implements ToolHost {
  readonly canvas: HTMLCanvasElement;
  readonly editor: Editor;
  readonly tools: Record<ToolId, Tool>;
  readonly selectTool: SelectTool;
  readonly mapView: MapView;

  private ctx: CanvasRenderingContext2D;
  private drawer: TileDrawer;
  private cache: TileCache;
  private renderer: RoomRenderer;
  private roomViews = new Map<string, Viewport>();
  private mapViewport = new Viewport(0.3, 48);
  private mapFitted = false;
  private dirty = true;
  private dpr = 1;
  private hover: PointerInfo | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private spaceHeld = false;
  private lastRoomId: string | null = null;
  private lastTool: ToolId;
  private wheelMode: 'zoom' | 'pan' = 'zoom';
  private wheelTime = 0;

  constructor(parent: HTMLElement, editor: Editor, private callbacks: CanvasCallbacks) {
    this.editor = editor;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'room-canvas';
    this.canvas.tabIndex = -1;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    const collisionColor = (id: number): string | null => {
      const c = editor.collisionOf(id);
      return c === 'solid' ? '#6b6588' : c === 'hazard' ? '#b8475a' : c === 'oneway' ? '#a08a52' : null;
    };
    this.drawer = new TileDrawer(() => editor.tileset, collisionColor);
    this.cache = new TileCache(this.drawer);
    this.renderer = new RoomRenderer(editor, this.drawer, this.cache);
    this.mapView = new MapView(editor, this.drawer, { redraw: () => this.redraw(), toast: callbacks.toast });

    this.selectTool = new SelectTool(this, (p) => this.pickObject(p));
    this.tools = {
      terrain: new PaintTool(this, false),
      tile: new PaintTool(this, false),
      eraser: new PaintTool(this, true),
      rect: new RectTool(this),
      fill: new FillTool(this),
      eyedropper: new EyedropperTool(this),
      select: this.selectTool,
      decor: new DecorTool(this),
      entity: new EntityTool(this),
      pan: new PanTool(),
      play: new PlayFromTool(this),
    };
    this.lastTool = editor.tool;

    // Keep caches in step with tile edits.
    editor.onTiles = (roomId, layer, index) => {
      this.cache.notify(roomId, layer, index);
      this.mapView.notify(roomId);
      this.dirty = true;
    };
    editor.onBeforeHistory = (direction) => {
      if (this.gesture?.kind === 'tool') return true; // not in the middle of a drag
      return this.activeTool.onBeforeHistory?.(direction) ?? false;
    };
    editor.events.on('render', () => this.redraw());
    editor.events.on(['ui', 'rooms'], () => this.onStateChange());
    onAssetLoaded(() => {
      // Pictures arrive after the first paint: rebuild anything drawn without them.
      this.cache.clear();
      this.mapView.clearThumbs();
      this.redraw();
    });

    new ResizeObserver(() => this.redraw()).observe(this.canvas);
    this.bindInput();
    const loop = (): void => {
      if (this.dirty) {
        this.dirty = false;
        this.paint();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ================================================================ */
  /* ToolHost                                                          */
  /* ================================================================ */

  /** The viewport of the current room (each room remembers its own pan/zoom). */
  get view(): Viewport {
    const id = this.editor.roomId ?? '';
    let v = this.roomViews.get(id);
    if (!v) {
      v = new Viewport();
      this.syncSize(v);
      this.roomViews.set(id, v);
      this.fitRoom(v);
    }
    return v;
  }

  redraw(): void { this.dirty = true; }

  drawTile(ctx: CanvasRenderingContext2D, id: number, sx: number, sy: number, size: number): void {
    ctx.imageSmoothingEnabled = size < this.drawer.cellPx;
    this.drawer.draw(ctx, id, Math.round(sx), Math.round(sy), Math.ceil(size));
  }

  playFrom(x: number, y: number): void { this.callbacks.playFrom(x, y); }
  toast(message: string): void { this.callbacks.toast(message); }

  /* ================================================================ */
  /* View helpers                                                      */
  /* ================================================================ */

  get activeTool(): Tool { return this.tools[this.editor.tool]; }

  private get currentView(): Viewport {
    return this.editor.mode === 'map' ? this.mapViewport : this.view;
  }

  private syncSize(v: Viewport): void {
    v.width = Math.max(1, this.canvas.clientWidth);
    v.height = Math.max(1, this.canvas.clientHeight);
  }

  private fitRoom(v: Viewport): void {
    const room = this.editor.room;
    if (room) v.fit(0, 0, room.width * TILE_SIZE, room.height * TILE_SIZE, 36);
  }

  /** Fit the room (or the whole map) into the window. */
  fit(): void {
    if (this.editor.mode === 'map') {
      this.syncSize(this.mapViewport);
      const b = this.mapView.bounds();
      this.mapViewport.fit(b.x, b.y, b.w, b.h, 60);
    } else {
      this.syncSize(this.view);
      this.fitRoom(this.view);
    }
    this.afterViewChange();
  }

  /** Zoom in/out around the centre of the canvas (keyboard + buttons). */
  zoomBy(factor: number): void {
    const v = this.currentView;
    this.syncSize(v);
    v.zoomAt(v.width / 2, v.height / 2, factor);
    this.afterViewChange();
  }

  /** Zoom of the room view as a percentage (100% = one logical px per screen px). */
  zoomPercent(): number {
    return this.editor.mode === 'map'
      ? Math.round((this.mapViewport.zoom / TILE_SIZE) * 100)
      : Math.round(this.view.zoom * 100);
  }

  /** Room position (logical px) at the centre of the canvas - used for "paste in the middle". */
  viewCentre(): { x: number; y: number } {
    const v = this.view;
    return { x: v.wx(v.width / 2), y: v.wy(v.height / 2) };
  }

  hoverInfo(): PointerInfo | null { return this.hover; }

  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
    this.updateCursor();
  }

  /** Let tools finish half-done work (floating tile selections) - call before saving. */
  flushTools(): void {
    for (const t of Object.values(this.tools)) t.flush?.();
  }

  private afterViewChange(): void {
    this.redraw();
    this.editor.events.emit('cursor'); // the status bar shows the zoom
  }

  private onStateChange(): void {
    const ed = this.editor;
    if (ed.tool !== this.lastTool) {
      this.tools[this.lastTool].flush?.();
      this.lastTool = ed.tool;
    }
    if (ed.roomId !== this.lastRoomId) {
      for (const t of Object.values(this.tools)) t.flush?.();
      this.lastRoomId = ed.roomId;
    }
    if (ed.mode === 'map' && !this.mapFitted && this.canvas.clientWidth > 0) {
      this.mapFitted = true;
      this.syncSize(this.mapViewport);
      const b = this.mapView.bounds();
      this.mapViewport.fit(b.x, b.y, b.w, b.h, 60);
    }
    this.updateCursor();
    this.redraw();
  }

  /** Forget a room's remembered pan/zoom (after a resize the old view makes no sense). */
  forgetView(roomId: string): void {
    this.roomViews.delete(roomId);
    this.redraw();
  }

  private updateCursor(): void {
    let cursor = 'default';
    if (this.gesture?.kind === 'pan') cursor = 'grabbing';
    else if (this.spaceHeld) cursor = 'grab';
    else if (this.editor.mode === 'map') cursor = this.mapView.cursor();
    else cursor = this.activeTool.cursor?.() ?? 'default';
    this.canvas.style.cursor = cursor;
  }

  /** Used by the Select tool: a plain click on an object selects it and switches to its tool. */
  private pickObject(p: PointerInfo): boolean {
    const ed = this.editor;
    const room = ed.room;
    if (!room) return false;
    const entity = pickEntity(this, room, p);
    if (entity) {
      ed.armEntity(null);
      ed.select({ kind: 'entity', ids: [entity.id] });
      return true;
    }
    const decor = pickDecor(this, room, p);
    if (decor) {
      ed.armDecor(null);
      ed.select({ kind: 'decor', ids: [decor.id] });
      return true;
    }
    return false;
  }

  /** What is under a point - used by the right-click menu. */
  objectAt(p: PointerInfo): { kind: 'decor' | 'entity'; id: string } | null {
    const room = this.editor.room;
    if (!room) return null;
    const entity = pickEntity(this, room, p);
    if (entity) return { kind: 'entity', id: entity.id };
    const decor = pickDecor(this, room, p);
    return decor ? { kind: 'decor', id: decor.id } : null;
  }

  /* ================================================================ */
  /* Input                                                             */
  /* ================================================================ */

  private info(e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const v = this.currentView;
    const x = v.wx(sx);
    const y = v.wy(sy);
    return {
      x, y, sx, sy,
      tx: Math.floor(x / TILE_SIZE), ty: Math.floor(y / TILE_SIZE),
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
    };
  }

  private bindInput(): void {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      // Clicking the canvas takes keyboard focus away from text boxes so shortcuts work again.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const map = this.editor.mode === 'map';
      const p = this.info(e);
      this.hover = p;

      if (e.pointerType === 'touch' && this.pointers.size === 2) {
        // Second finger: stop drawing, start pinch-zoom / two-finger pan.
        this.cancelGesture();
        const [a, b] = [...this.pointers.values()];
        this.gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      if (this.pointers.size > 1 || this.gesture) return;

      if (e.button === 1 || (e.button === 0 && (this.spaceHeld || (!map && this.editor.tool === 'pan')))) {
        e.preventDefault();
        this.gesture = { kind: 'pan', x: e.clientX, y: e.clientY };
      } else if (e.button === 0) {
        if (map) {
          this.gesture = { kind: 'map' };
          this.mapView.onDown(p.x, p.y);
        } else {
          this.gesture = { kind: 'tool' };
          this.activeTool.onDown?.(p);
        }
      }
      this.updateCursor();
      this.redraw();
    });

    c.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      const v = this.currentView;

      if (g?.kind === 'pinch') {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rect = c.getBoundingClientRect();
        v.panBy(cx - g.cx, cy - g.cy);
        if (g.dist > 0) v.zoomAt(cx - rect.left, cy - rect.top, dist / g.dist);
        g.dist = dist;
        g.cx = cx;
        g.cy = cy;
        this.afterViewChange();
        return;
      }
      if (g?.kind === 'pan') {
        v.panBy(e.clientX - g.x, e.clientY - g.y);
        g.x = e.clientX;
        g.y = e.clientY;
        this.redraw();
        return;
      }

      const p = this.info(e);
      this.hover = p;
      if (this.editor.mode === 'map') {
        if (g?.kind === 'map') this.mapView.onDrag(p.x, p.y);
        else this.mapView.onHover(p.x, p.y);
        this.editor.setCursor({ tx: Math.floor(p.x), ty: Math.floor(p.y), x: p.x, y: p.y });
        this.updateCursor();
        return;
      }
      this.editor.setCursor({ tx: p.tx, ty: p.ty, x: p.x, y: p.y });
      if (g?.kind === 'tool') this.activeTool.onDrag?.(p);
      else this.activeTool.onHover?.(p);
      this.redraw();
    });

    const end = (e: PointerEvent, cancelled: boolean): void => {
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (!g) return;
      if (g.kind === 'pinch') {
        if (this.pointers.size < 2) this.gesture = null;
        return;
      }
      this.gesture = null;
      if (g.kind === 'tool') {
        if (cancelled) this.activeTool.onCancel?.();
        else this.activeTool.onUp?.(this.info(e));
      } else if (g.kind === 'map') {
        if (cancelled) this.mapView.onCancel();
        else this.mapView.onUp();
      }
      if (e.pointerType === 'touch') this.hover = null; // no hovering finger
      this.updateCursor();
      this.redraw();
    };
    c.addEventListener('pointerup', (e) => end(e, false));
    c.addEventListener('pointercancel', (e) => end(e, true));

    c.addEventListener('pointerleave', () => {
      if (this.gesture) return;
      this.hover = null;
      this.editor.setCursor(null);
      this.redraw();
    });

    c.addEventListener('dblclick', (e) => {
      if (this.editor.mode !== 'map') return;
      const p = this.info(e);
      this.mapView.onDoubleClick(p.x, p.y);
    });

    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.editor.mode === 'map' || this.gesture) return;
      this.callbacks.contextMenu(this.info(e), e.clientX, e.clientY);
    });

    // Middle-click would otherwise start the browser's auto-scroll.
    c.addEventListener('auxclick', (e) => e.preventDefault());

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = this.currentView;
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      /*
       * Mouse wheel  -> zoom.   Trackpad two-finger scroll -> pan.   Trackpad pinch -> zoom.
       * Browsers report all three as "wheel", so we guess: pinch sets ctrlKey; a mouse
       * wheel moves in big vertical steps; a trackpad sends many small (often diagonal) ones.
       * The guess is kept for the rest of a scroll burst so it cannot flip half-way.
       */
      let mode: 'zoom' | 'pan';
      if (e.ctrlKey || e.metaKey) mode = 'zoom';
      else if (e.timeStamp - this.wheelTime < 200) mode = this.wheelMode;
      else mode = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 48) ? 'zoom' : 'pan';
      if (!(e.ctrlKey || e.metaKey)) {
        this.wheelMode = mode;
        this.wheelTime = e.timeStamp;
      }
      if (mode === 'zoom') {
        const lines = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        const k = e.ctrlKey && Math.abs(e.deltaY) < 30 ? 0.012 : 0.0018; // pinch deltas are tiny
        v.zoomAt(sx, sy, Math.exp(-lines * k));
      } else {
        v.panBy(-e.deltaX, -e.deltaY);
      }
      this.hover = this.info(e);
      this.afterViewChange();
    }, { passive: false });
  }

  private cancelGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (g?.kind === 'tool') this.activeTool.onCancel?.();
    if (g?.kind === 'map') this.mapView.onCancel();
    this.hover = null;
    this.redraw();
  }

  /** Escape pressed: stop a drag in progress. Returns true if there was one. */
  cancelDrag(): boolean {
    if (!this.gesture || this.gesture.kind === 'pan' || this.gesture.kind === 'pinch') return false;
    this.cancelGesture();
    return true;
  }

  /* ================================================================ */
  /* Painting                                                          */
  /* ================================================================ */

  private paint(): void {
    const c = this.canvas;
    const ctx = this.ctx;
    const ed = this.editor;
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(c.clientHeight * this.dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#100e17';
    ctx.fillRect(0, 0, w, h);

    if (ed.mode === 'map') {
      this.syncSize(this.mapViewport);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.mapView.draw(ctx, this.mapViewport);
      return;
    }

    const room = ed.room;
    if (!room) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#9a93b5';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No room yet - create one to start building!', c.clientWidth / 2, c.clientHeight / 2);
      ctx.textAlign = 'left';
      return;
    }

    const v = this.view;
    this.syncSize(v);
    const tileTool = ['terrain', 'tile', 'eraser', 'rect', 'fill', 'eyedropper', 'select'].includes(ed.tool);
    this.renderer.draw(ctx, room, v, this.dpr, { dimInactive: ed.view.dim && tileTool });

    // Overlays in CSS pixels.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    const hover = this.gesture?.kind === 'pan' || this.spaceHeld ? null : this.hover;
    this.activeTool.draw?.(ctx, hover);

    if (ed.view.cameraFrame && this.hover) {
      // What the player would see if the camera were centred here (it never leaves the room).
      const roomW = room.width * TILE_SIZE;
      const roomH = room.height * TILE_SIZE;
      const fw = Math.min(VIEW_WIDTH, roomW);
      const fh = Math.min(VIEW_HEIGHT, roomH);
      const fx = Math.min(roomW - fw, Math.max(0, this.hover.x - fw / 2));
      const fy = Math.min(roomH - fh, Math.max(0, this.hover.y - fh / 2));
      ctx.save();
      ctx.setLineDash([10, 6]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeRect(v.sx(fx), v.sy(fy), fw * v.zoom, fh * v.zoom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffd27a';
      ctx.strokeRect(v.sx(fx), v.sy(fy), fw * v.zoom, fh * v.zoom);
      ctx.setLineDash([]);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = '#ffd27a';
      ctx.fillText('What the player sees', v.sx(fx) + 6, v.sy(fy) + 14);
      ctx.restore();
    }
  }
}
