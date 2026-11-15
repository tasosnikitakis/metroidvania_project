/**
 * ENTITIES - the things placed with the World Editor's entity tool:
 * lights, checkpoints and ambient particle areas. (playerStart is read by
 * the game scene directly.)
 */
import Phaser from 'phaser';
import type { EntityInstance } from '../../shared/types';
import { defaultProps } from '../../shared/entities';
import { DEPTH } from '../constants';
import { flickerNoise, hash01, parseColor } from '../core/math';
import { AmbientParticleArea } from '../fx/ambientParticles';
import { TEX } from '../fx/textures';
import type { ViewRect } from '../fx/view';

/** Read an entity's props with the registry defaults filled in. */
function propsOf(e: EntityInstance): Record<string, number | string | boolean> {
  return { ...defaultProps(e.type), ...(e.props ?? {}) };
}
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

interface LightView {
  img: Phaser.GameObjects.Image;
  intensity: number;
  size: number;
  flicker: number;
  seed: number;
}

export interface Checkpoint {
  id: string;
  /** Feet position where the hero respawns. */
  x: number;
  y: number;
  active: boolean;
  glow: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Graphics;
}

/** Size of the area around a checkpoint that activates it. */
export const CHECKPOINT_W = 56;
export const CHECKPOINT_H = 110;

export class RoomEntities {
  private lights: LightView[] = [];
  private areas: AmbientParticleArea[] = [];
  readonly checkpoints: Checkpoint[] = [];
  /** The room's playerStart entity, if any. */
  readonly playerStart: { x: number; y: number; facing: 1 | -1 } | null = null;

  constructor(scene: Phaser.Scene, entities: EntityInstance[]) {
    entities.forEach((e, index) => {
      const p = propsOf(e);
      const seed = hash01(index * 5.3 + e.x * 0.011 + e.y * 0.017);
      switch (e.type) {
        case 'playerStart':
          (this as { playerStart: RoomEntities['playerStart'] }).playerStart = {
            x: e.x, y: e.y, facing: p.facing === 'left' ? -1 : 1,
          };
          break;

        case 'light': {
          const radius = num(p.radius, 220);
          const img = scene.add.image(e.x, e.y, TEX.GLOW).setBlendMode(Phaser.BlendModes.ADD);
          img.setTint(parseColor(String(p.color), 0xffcc88)).setDepth(DEPTH.LIGHTS);
          img.setDisplaySize(radius * 2, radius * 2);
          const intensity = num(p.intensity, 0.6);
          img.setAlpha(intensity);
          this.lights.push({ img, intensity, size: radius * 2, flicker: num(p.flicker, 0), seed });
          break;
        }

        case 'checkpoint': {
          // A small standing rune-stone with a glow that brightens once touched.
          const marker = scene.add.graphics().setDepth(DEPTH.ENTITIES);
          const glow = scene.add.image(e.x, e.y - 40, TEX.GLOW).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.LIGHTS);
          const cp: Checkpoint = { id: e.id, x: e.x, y: e.y, active: false, glow, marker };
          this.checkpoints.push(cp);
          this.drawCheckpoint(cp);
          break;
        }

        case 'particles':
          this.areas.push(
            new AmbientParticleArea(scene, String(p.kind), e.x, e.y, num(p.width, 480), num(p.height, 240), seed + index),
          );
          break;

        default:
          // Unknown entity types are ignored so newer content never breaks an older build.
          break;
      }
    });
  }

  private drawCheckpoint(cp: Checkpoint): void {
    const g = cp.marker;
    const lit = cp.active;
    g.clear();
    // stone
    g.fillStyle(0x4a4568, 1);
    g.fillRoundedRect(cp.x - 9, cp.y - 46, 18, 46, { tl: 9, tr: 9, bl: 2, br: 2 });
    g.fillStyle(0x6d6792, 1);
    g.fillRoundedRect(cp.x - 6, cp.y - 43, 7, 40, { tl: 6, tr: 2, bl: 1, br: 1 });
    // rune
    g.fillStyle(lit ? 0xc8ffe0 : 0x9aa4d0, 1);
    g.fillCircle(cp.x, cp.y - 32, 3.2);
    g.fillRect(cp.x - 1, cp.y - 27, 2, 12);
    cp.glow.setTint(lit ? 0x7dffc0 : 0x6070b0);
    cp.glow.setDisplaySize(lit ? 150 : 90, lit ? 150 : 90);
  }

  /** Mark one checkpoint as the active respawn point (and un-light the others). */
  activate(cp: Checkpoint): void {
    for (const other of this.checkpoints) {
      const shouldBeActive = other === cp;
      if (other.active !== shouldBeActive) {
        other.active = shouldBeActive;
        this.drawCheckpoint(other);
      }
    }
  }

  /** Call every rendered frame. `time` in seconds. */
  update(dt: number, time: number, view: ViewRect): void {
    for (const l of this.lights) {
      if (l.flicker > 0) {
        const n = flickerNoise(time, l.seed);
        l.img.setAlpha(l.intensity * (1 - l.flicker * n));
        const s = l.size * (1 - l.flicker * 0.12 * n);
        l.img.setDisplaySize(s, s);
      }
    }
    for (const cp of this.checkpoints) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + cp.x * 0.01);
      cp.glow.setAlpha(cp.active ? 0.24 + 0.1 * pulse : 0.12 + 0.05 * pulse);
    }
    for (const a of this.areas) a.update(dt, time, view);
  }

  destroy(): void {
    for (const l of this.lights) l.img.destroy();
    for (const cp of this.checkpoints) {
      cp.glow.destroy();
      cp.marker.destroy();
    }
    for (const a of this.areas) a.destroy();
    this.lights.length = 0;
    this.checkpoints.length = 0;
    this.areas.length = 0;
  }
}
