/**
 * DEBUG OVERLAY (F1 or `)
 * Draws what the physics "sees": collision tiles, the hero's box, the attack
 * hitbox and checkpoints, plus a text read-out of state / speed / frame info.
 */
import Phaser from 'phaser';
import { DEPTH } from '../constants';
import { setDebugText } from '../core/dom';
import type { ViewRect } from '../fx/view';
import { CELL_HAZARD, CELL_ONEWAY, CELL_SOLID, type CollisionGrid } from '../physics/grid';
import type { PlayerController } from '../player/controller';
import { CHECKPOINT_H, CHECKPOINT_W, type Checkpoint } from '../world/entities';

export interface DebugInfo {
  room: string;
  fps: number;
  frameMs: number;
  simHz: number;
  stepsThisFrame: number;
  alpha: number;
  zoom: number;
  canvasW: number;
  canvasH: number;
  anim: string;
  usingRig: boolean;
}

export class DebugOverlay {
  enabled = false;
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.DEBUG).setVisible(false);
  }

  toggle(force?: boolean): void {
    this.enabled = force ?? !this.enabled;
    this.gfx.setVisible(this.enabled);
    if (!this.enabled) {
      this.gfx.clear();
      setDebugText(null);
    }
  }

  /**
   * @param px,py interpolated hero position (what is drawn); the controller holds the exact sim position.
   */
  draw(
    grid: CollisionGrid, p: PlayerController, px: number, py: number, checkpoints: Checkpoint[],
    view: ViewRect, info: DebugInfo,
  ): void {
    if (!this.enabled) return;
    const g = this.gfx;
    const ts = grid.tileSize;
    g.clear();

    // Collision tiles in view.
    const x0 = Math.max(0, Math.floor(view.left / ts));
    const x1 = Math.min(grid.width - 1, Math.floor(view.right / ts));
    const y0 = Math.max(0, Math.floor(view.top / ts));
    const y1 = Math.min(grid.height - 1, Math.floor(view.bottom / ts));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = grid.cells[ty * grid.width + tx];
        if (c === CELL_SOLID) {
          g.fillStyle(0x40a0ff, 0.16).fillRect(tx * ts, ty * ts, ts, ts);
          g.lineStyle(1, 0x40a0ff, 0.5).strokeRect(tx * ts + 0.5, ty * ts + 0.5, ts - 1, ts - 1);
        } else if (c === CELL_ONEWAY) {
          g.fillStyle(0xffe060, 0.75).fillRect(tx * ts, ty * ts, ts, 4);
        } else if (c === CELL_HAZARD) {
          g.fillStyle(0xff3060, 0.3).fillRect(tx * ts, ty * ts, ts, ts);
          g.lineStyle(1, 0xff3060, 0.8).strokeRect(tx * ts + 0.5, ty * ts + 0.5, ts - 1, ts - 1);
        }
      }
    }

    // Room outline.
    g.lineStyle(2, 0xffffff, 0.35).strokeRect(0, 0, grid.width * ts, grid.height * ts);

    // Checkpoint trigger areas.
    for (const cp of checkpoints) {
      g.lineStyle(1, cp.active ? 0x7dffc0 : 0x8090c0, 0.8);
      g.strokeRect(cp.x - CHECKPOINT_W / 2, cp.y - CHECKPOINT_H, CHECKPOINT_W, CHECKPOINT_H);
    }

    // Hero collision box (at the drawn, interpolated position) + feet marker.
    g.lineStyle(1.5, p.onGround ? 0x60ff80 : 0xffffff, 0.95).strokeRect(px - p.w / 2, py - p.h, p.w, p.h);
    g.fillStyle(0xffffff, 1).fillRect(px - 1.5, py - 1.5, 3, 3);
    if (p.wallDir !== 0) g.fillStyle(0xffa040, 0.9).fillRect(px + p.wallDir * (p.w / 2) - 1.5, py - p.h, 3, p.h);

    // Attack hitbox.
    const hit = p.getAttackHitbox();
    if (hit) {
      const ox = px - p.x;
      const oy = py - p.y;
      g.fillStyle(0xff5050, 0.3).fillRect(hit.x + ox, hit.y + oy, hit.w, hit.h);
      g.lineStyle(1.5, 0xff5050, 1).strokeRect(hit.x + ox, hit.y + oy, hit.w, hit.h);
    }

    setDebugText(
      [
        `room   ${info.room}`,
        `state  ${p.attacking ? 'attack+' : ''}${p.state}   anim ${info.anim}${info.usingRig ? '' : ' (placeholder hero)'}`,
        `pos    ${p.x.toFixed(1)}, ${p.y.toFixed(1)}   tile ${Math.floor(p.x / ts)}, ${Math.floor((p.y - 1) / ts)}`,
        `vel    ${p.vx.toFixed(0)}, ${p.vy.toFixed(0)}   ground ${p.onGround ? 'Y' : 'n'}  wall ${p.wallDir}`,
        `air    jumps ${p.airJumpsLeft}  dashes ${p.airDashesLeft}`,
        `fps    ${info.fps.toFixed(0)}  (${info.frameMs.toFixed(1)} ms)`,
        `sim    ${info.simHz} Hz  steps ${info.stepsThisFrame}  alpha ${info.alpha.toFixed(2)}`,
        `view   ${info.canvasW}x${info.canvasH} px  zoom ${info.zoom.toFixed(3)}`,
        `F1/\` overlay   R respawn`,
      ].join('\n'),
    );
  }

  destroy(): void {
    this.gfx.destroy();
    setDebugText(null);
  }
}
