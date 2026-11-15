/** The rectangle of the world currently visible on screen, in logical px. */
export interface ViewRect {
  /** Centre. */
  cx: number;
  cy: number;
  /** Size. */
  w: number;
  h: number;
  /** Edges. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function makeViewRect(cx: number, cy: number, w: number, h: number): ViewRect {
  return { cx, cy, w, h, left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

/** Update an existing ViewRect in place (avoids creating garbage every frame). */
export function setViewRect(v: ViewRect, cx: number, cy: number, w: number, h: number): void {
  v.cx = cx;
  v.cy = cy;
  v.w = w;
  v.h = h;
  v.left = cx - w / 2;
  v.top = cy - h / 2;
  v.right = cx + w / 2;
  v.bottom = cy + h / 2;
}
