/**
 * JUMP-ARC GRAPH
 * A side-on picture of three jumps while running at full speed:
 *   tap (quick press), full (button held) and double jump (second jump at the top).
 * The grid squares are game tiles (48 px), so "can the hero clear a 3-tile wall?"
 * can be read straight off the picture.
 */
import { TILE_SIZE, type PlayerConfig } from '../../../shared/types';
import { jumpArcs, type JumpArc } from '../logic/physics';
import { fitCanvas } from '../ui/dom';

export const ARC_COLORS = { tap: '#6ee7ff', full: '#b58cff', double: '#ffc46b' };

export function drawArcGraph(canvas: HTMLCanvasElement, cfg: PlayerConfig): void {
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (cssW < 10 || cssH < 10) return;
  const ctx = fitCanvas(canvas, cssW, cssH);
  const arcs = jumpArcs(cfg);
  const list: Array<[JumpArc, string]> = [[arcs.tap, ARC_COLORS.tap], [arcs.full, ARC_COLORS.full]];
  if (arcs.double) list.unshift([arcs.double, ARC_COLORS.double]);

  // World extents (px) -> whole tiles, with a little air above the highest arc.
  let maxX = 0, maxH = cfg.height;
  for (const [arc] of list) { maxX = Math.max(maxX, arc.distance); maxH = Math.max(maxH, arc.apexHeight); }
  const tilesX = Math.max(4, Math.ceil(maxX / TILE_SIZE + 0.6));
  const tilesY = Math.max(3, Math.ceil(maxH / TILE_SIZE + 0.4));
  const padL = 26, padB = 20, padT = 6, padR = 8;
  const scale = Math.min((cssW - padL - padR) / (tilesX * TILE_SIZE), (cssH - padT - padB) / (tilesY * TILE_SIZE));
  const groundY = cssH - padB;
  const X = (px: number) => padL + cfg.width * 0.5 * scale + px * scale;
  const Y = (h: number) => groundY - h * scale;

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#100e17';
  ctx.fillRect(0, 0, cssW, cssH);

  // tile grid
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#9a93b5';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  const colsVisible = Math.ceil((cssW - padL) / (TILE_SIZE * scale));
  const rowsVisible = Math.ceil((groundY - padT) / (TILE_SIZE * scale));
  const labelEvery = TILE_SIZE * scale < 14 ? 2 : 1;
  for (let r = 0; r <= rowsVisible; r++) {
    const y = Math.round(Y(r * TILE_SIZE)) + 0.5;
    ctx.strokeStyle = r === 0 ? '#6a6388' : '#2a2638';
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW, y); ctx.stroke();
    if (r > 0 && r % labelEvery === 0 && y > 8) ctx.fillText(String(r), padL - 5, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c <= colsVisible; c++) {
    const x = Math.round(padL + c * TILE_SIZE * scale) + 0.5;
    ctx.strokeStyle = '#2a2638';
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, groundY); ctx.stroke();
    if (c > 0 && c % labelEvery === 0) ctx.fillText(String(c), x, groundY + 5);
  }
  ctx.save();
  ctx.translate(9, (groundY + padT) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('tiles', 0, -5);
  ctx.restore();

  // ground
  ctx.fillStyle = '#2b2740';
  ctx.fillRect(padL, groundY, cssW - padL, 2);

  // the hero's collision box at the take-off spot, for scale
  ctx.fillStyle = 'rgba(232, 228, 245, 0.16)';
  ctx.strokeStyle = 'rgba(232, 228, 245, 0.5)';
  ctx.fillRect(X(0) - cfg.width * 0.5 * scale, Y(cfg.height), cfg.width * scale, cfg.height * scale);
  ctx.strokeRect(X(0) - cfg.width * 0.5 * scale + 0.5, Y(cfg.height) + 0.5, cfg.width * scale, cfg.height * scale);

  // arcs (feet position)
  ctx.lineJoin = 'round';
  for (const [arc, color] of list) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const stride = Math.max(1, Math.floor(arc.points.length / 240));
    arc.points.forEach((p, i) => {
      if (i % stride !== 0 && i !== arc.points.length - 1) return;
      if (i === 0) ctx.moveTo(X(p.x), Y(p.h)); else ctx.lineTo(X(p.x), Y(p.h));
    });
    ctx.stroke();
    // landing dot
    const end = arc.points[arc.points.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(X(end.x), Y(0), 3.5, 0, Math.PI * 2); ctx.fill();
    // little star where each mid-air jump happens
    for (const t of arc.airJumpTimes) {
      const p = arc.points.find((q) => q.t >= t) ?? end;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.h), 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#100e17'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
}
