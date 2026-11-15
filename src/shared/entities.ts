/**
 * Entity type registry. The World Editor builds its entity palette and
 * property forms from this; the runtime spawns behaviour by `type`.
 */

export type PropSchema =
  | { kind: 'number'; default: number; min?: number; max?: number; step?: number }
  | { kind: 'boolean'; default: boolean }
  | { kind: 'string'; default: string }
  | { kind: 'color'; default: string }
  | { kind: 'select'; default: string; options: string[] };

export interface EntityTypeDef {
  type: string;
  name: string;
  description: string;
  /** Editor marker colour and glyph. */
  color: string;
  glyph: string;
  /** Only one allowed per room (e.g. player start). */
  unique?: boolean;
  props: Record<string, PropSchema>;
}

export const ENTITY_TYPES: EntityTypeDef[] = [
  {
    type: 'playerStart',
    name: 'Player Start',
    description: 'Where the hero appears when the game starts in this room (feet position).',
    color: '#6ee7ff',
    glyph: '★',
    unique: true,
    props: { facing: { kind: 'select', default: 'right', options: ['left', 'right'] } },
  },
  {
    type: 'light',
    name: 'Light',
    description: 'A soft glowing light (candles, moonbeams, magic).',
    color: '#ffd27a',
    glyph: '✦',
    props: {
      color: { kind: 'color', default: '#ffcc88' },
      radius: { kind: 'number', default: 220, min: 40, max: 900, step: 10 },
      intensity: { kind: 'number', default: 0.6, min: 0, max: 1, step: 0.05 },
      flicker: { kind: 'number', default: 0.15, min: 0, max: 1, step: 0.05 },
    },
  },
  {
    type: 'checkpoint',
    name: 'Checkpoint',
    description: 'Touching it sets the respawn point (used after falling on hazards).',
    color: '#9dff9d',
    glyph: '⚑',
    props: {},
  },
  {
    type: 'particles',
    name: 'Ambient Particles',
    description: 'Drifting motes in an area: dust, embers, fireflies or falling leaves.',
    color: '#c9a0ff',
    glyph: '∴',
    props: {
      kind: { kind: 'select', default: 'dust', options: ['dust', 'embers', 'fireflies', 'leaves'] },
      width: { kind: 'number', default: 480, min: 48, max: 4000, step: 48 },
      height: { kind: 'number', default: 240, min: 48, max: 4000, step: 48 },
    },
  },
];

export function entityType(type: string): EntityTypeDef | undefined {
  return ENTITY_TYPES.find((e) => e.type === type);
}

export function defaultProps(type: string): Record<string, number | string | boolean> {
  const def = entityType(type);
  const out: Record<string, number | string | boolean> = {};
  if (def) for (const [k, s] of Object.entries(def.props)) out[k] = s.default;
  return out;
}
