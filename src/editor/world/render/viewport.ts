/**
 * The "camera" of the editor: which part of the room (or world map) is on
 * screen and how zoomed in we are.
 *
 *   screen position (CSS px) = (world position - x/y) * zoom
 */
export class Viewport {
  /** World coordinate shown at the top-left corner of the canvas. */
  x = 0;
  y = 0;
  zoom = 1;
  /** Canvas size in CSS pixels (set by the canvas on resize). */
  width = 1;
  height = 1;

  constructor(public minZoom = 0.04, public maxZoom = 8) {}

  sx(worldX: number): number { return (worldX - this.x) * this.zoom; }
  sy(worldY: number): number { return (worldY - this.y) * this.zoom; }
  wx(screenX: number): number { return screenX / this.zoom + this.x; }
  wy(screenY: number): number { return screenY / this.zoom + this.y; }

  /** Zoom by `factor` keeping the world point under (screenX, screenY) where it is. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const wx = this.wx(screenX);
    const wy = this.wy(screenY);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = wx - screenX / this.zoom;
    this.y = wy - screenY / this.zoom;
  }

  panBy(screenDx: number, screenDy: number): void {
    this.x -= screenDx / this.zoom;
    this.y -= screenDy / this.zoom;
  }

  /** Show a whole rectangle of the world, centred, with a little margin. */
  fit(x: number, y: number, w: number, h: number, margin = 40): void {
    const availW = Math.max(50, this.width - margin * 2);
    const availH = Math.max(50, this.height - margin * 2);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.min(availW / Math.max(1, w), availH / Math.max(1, h))));
    this.x = x + w / 2 - this.width / 2 / this.zoom;
    this.y = y + h / 2 - this.height / 2 / this.zoom;
  }
}
