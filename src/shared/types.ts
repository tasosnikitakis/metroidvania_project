/**
 * SHARED DATA CONTRACTS
 * ---------------------
 * Every piece of game content is plain JSON living in /content and served by
 * the server at /api/content/<path>. The game runtime, the World Editor and
 * the Game Editor all read/write these exact shapes. Change them here first.
 *
 * Units: all positions/sizes are in LOGICAL pixels unless stated otherwise.
 * One tile = TILE_SIZE logical pixels. The camera shows roughly
 * VIEW_HEIGHT logical pixels vertically regardless of screen resolution.
 */

export const TILE_SIZE = 48;
export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;

/* ------------------------------------------------------------------ */
/* Tileset  (content/tileset.json + public/assets/tiles/tileset.png)   */
/* ------------------------------------------------------------------ */

export type TileCollision = 'none' | 'solid' | 'oneway' | 'hazard';

export interface TileDef {
  /** 1-based index into the tileset image (row-major). 0 always means "empty". */
  id: number;
  name: string;
  collision: TileCollision;
  /** Palette grouping in the editor, e.g. "stone", "wood", "hazards". */
  group: string;
}

/**
 * Auto-tiling terrain. `tiles` has 16 entries indexed by a 4-bit neighbour
 * mask: N=1, E=2, S=4, W=8 (bit set when that neighbour is the same terrain).
 * e.g. tiles[0] = isolated block, tiles[15] = fully surrounded interior.
 */
export interface TerrainDef {
  name: string;
  /** Which room layer this terrain is normally painted on. */
  layer: LayerName;
  tiles: number[];
  /** Optional extra interior variants picked pseudo-randomly for mask 15. */
  fillVariants?: number[];
}

export interface TilesetData {
  version: 1;
  /** URL relative to site root, e.g. "assets/tiles/tileset.png". */
  image: string;
  /** Logical tile size (always TILE_SIZE). */
  tileSize: number;
  /** Pixel density of the image: image tile px = tileSize * imageScale. */
  imageScale: number;
  columns: number;
  tiles: TileDef[];
  terrains: TerrainDef[];
}

/* ------------------------------------------------------------------ */
/* Decor catalog (content/decor.json) - free-placed props & scenery     */
/* ------------------------------------------------------------------ */

export interface DecorDef {
  key: string;
  name: string;
  /** URL relative to site root, e.g. "assets/decor/candelabra.png". */
  image: string;
  /** Logical size in px (image is w*imageScale by h*imageScale). */
  w: number;
  h: number;
  imageScale: number;
  /** Anchor 0..1 (0.5,1 = bottom-centre, the usual for things on the floor). */
  originX: number;
  originY: number;
  group: string;
  /** Optional idle motion applied by the runtime. */
  sway?: { angle: number; period: number };
  /** Optional additive glow drawn at an offset from the anchor. */
  glow?: { x: number; y: number; radius: number; color: string; flicker?: number };
}

export interface DecorCatalog {
  version: 1;
  decor: DecorDef[];
}

/* ------------------------------------------------------------------ */
/* Backgrounds (content/backgrounds.json) - parallax themes             */
/* ------------------------------------------------------------------ */

export interface BackgroundLayer {
  image: string;
  /** Logical size of the image in px. */
  w: number;
  h: number;
  imageScale: number;
  /** 0 = fixed to the screen, 1 = moves with the world. */
  scrollX: number;
  scrollY: number;
  repeatX: boolean;
  /** Vertical placement: offset in logical px from the anchor edge. */
  anchorY: 'top' | 'bottom';
  offsetY: number;
  alpha?: number;
}

export interface BackgroundDef {
  key: string;
  name: string;
  /** CSS colours for a vertical sky gradient behind everything. */
  skyTop: string;
  skyBottom: string;
  /** Back-to-front. */
  layers: BackgroundLayer[];
  /** Colour multiplied over the world for mood, e.g. "#8f8fc0". */
  ambient?: string;
  fog?: { color: string; alpha: number };
}

export interface BackgroundCatalog {
  version: 1;
  backgrounds: BackgroundDef[];
}

/* ------------------------------------------------------------------ */
/* World & rooms (content/world.json, content/rooms/<id>.json)          */
/* ------------------------------------------------------------------ */

export type LayerName = 'back' | 'main' | 'front';
export const LAYER_NAMES: LayerName[] = ['back', 'main', 'front'];

export interface RoomRef {
  id: string;
  name: string;
  /** Position & size on the world map, in tiles. Rooms that touch are connected:
   *  walking off a room edge enters the neighbouring room at the same world position. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldData {
  version: 1;
  name: string;
  startRoom: string;
  rooms: RoomRef[];
}

export interface DecorInstance {
  id: string;
  key: string;
  /** Logical px in room space, position of the decor's anchor. */
  x: number;
  y: number;
  /** 'far' = behind back tiles, 'back' = behind player, 'front' = in front of player. */
  layer: 'far' | 'back' | 'front';
  flipX?: boolean;
  scale?: number;
  rotation?: number;
  alpha?: number;
}

export interface EntityInstance {
  id: string;
  /** Key into ENTITY_TYPES (src/shared/entities.ts). */
  type: string;
  /** Logical px in room space. */
  x: number;
  y: number;
  props: Record<string, number | string | boolean>;
}

export interface RoomData {
  version: 1;
  id: string;
  name: string;
  /** Size in tiles. */
  width: number;
  height: number;
  /** Key into the background catalog. */
  background: string;
  /**
   * Row-major arrays of length width*height holding tile ids (0 = empty).
   * - back:  walls/scenery behind the player (never collides)
   * - main:  gameplay layer, collision comes from each tile's TileDef.collision
   * - front: drawn in front of the player (never collides)
   */
  layers: Record<LayerName, number[]>;
  decor: DecorInstance[];
  entities: EntityInstance[];
}

/* ------------------------------------------------------------------ */
/* Game config (content/game-config.json) - tunable mechanics           */
/* ------------------------------------------------------------------ */

export interface PlayerConfig {
  /** Collision box in logical px (feet at the entity position, centred on x). */
  width: number;
  height: number;

  runSpeed: number;          // px/s
  groundAccel: number;       // px/s^2
  groundDecel: number;
  airAccel: number;
  airDecel: number;
  turnBoost: number;         // multiplier on accel when reversing direction

  jumpHeight: number;        // px, full hold
  jumpTimeToApex: number;    // s  (gravity & jump velocity are derived from these two)
  fallGravityMult: number;   // heavier gravity when falling
  jumpCutMult: number;       // velocity multiplier when jump released early
  apexHangThreshold: number; // |vy| below this near the apex...
  apexHangGravityMult: number; // ...uses this gravity multiplier (floaty apex)
  maxFallSpeed: number;
  coyoteTime: number;        // s
  jumpBuffer: number;        // s

  airJumps: number;          // 1 = double jump
  airJumpHeight: number;

  wallSlideEnabled: boolean;
  wallSlideSpeed: number;
  wallJumpEnabled: boolean;
  wallJumpSpeedX: number;
  wallJumpHeight: number;
  wallJumpLockTime: number;  // s of reduced air control after a wall jump

  dashEnabled: boolean;
  dashSpeed: number;
  dashTime: number;
  dashCooldown: number;
  airDashes: number;

  attackEnabled: boolean;
  attackTime: number;
  attackCooldown: number;
}

export interface CameraConfig {
  lerpX: number;
  lerpY: number;
  lookAhead: number;      // px the camera leads in the facing direction
  lookAheadLerp: number;
  deadzoneW: number;
  deadzoneH: number;
  zoom: number;           // 1 = VIEW_HEIGHT logical px visible vertically
  landShake: number;
}

export interface FeelConfig {
  squashStretch: number;  // 0..1 strength of jump/land squash & stretch
  dustParticles: boolean;
  afterImages: boolean;   // dash trail
  hitPauseMs: number;
}

export interface GameConfig {
  version: 1;
  player: PlayerConfig;
  camera: CameraConfig;
  feel: FeelConfig;
}

/* ------------------------------------------------------------------ */
/* Skeletal rig (content/rigs/<name>.rig.json) - cut-out animation      */
/* ------------------------------------------------------------------ */

export type EaseName =
  | 'linear' | 'step'
  | 'sineIn' | 'sineOut' | 'sineInOut'
  | 'quadIn' | 'quadOut' | 'quadInOut'
  | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'backOut' | 'elasticOut';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Setup pose, relative to the parent bone. Rotation in degrees, +clockwise on screen (y down). */
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Visual length, used only by editors to draw the bone. */
  length?: number;
}

/** A slot is one image attached to a bone. Array order = draw order (first = furthest back). */
export interface SlotDef {
  name: string;
  bone: string;
  /** Image URL relative to site root, e.g. "assets/hero/head.png". */
  image: string;
  /** Logical size (image pixels = size * imageScale). */
  w: number;
  h: number;
  imageScale: number;
  /** Offset of the image's origin point from the bone, in bone space. */
  x: number;
  y: number;
  rotation: number;
  /** Origin within the image, 0..1. */
  originX: number;
  originY: number;
  alpha?: number;
  /** Additive blending for glows. */
  additive?: boolean;
}

/** `v` is an OFFSET from the setup pose (rotation: added degrees; x/y: added px; scale: multiplied). */
export interface Keyframe {
  t: number;       // seconds
  v: number;
  ease?: EaseName; // easing used from THIS key to the next. Default 'sineInOut'.
}

export type BoneChannel = 'rotation' | 'x' | 'y' | 'scaleX' | 'scaleY';
export type BoneTrack = Partial<Record<BoneChannel, Keyframe[]>>;
/** Slot alpha track: v is an absolute alpha 0..1. */
export interface SlotTrack { alpha?: Keyframe[] }

export interface AnimEvent { t: number; name: string }

export interface AnimData {
  duration: number;
  loop: boolean;
  bones: Record<string, BoneTrack>;
  slots?: Record<string, SlotTrack>;
  events?: AnimEvent[];
}

export interface RigData {
  version: 1;
  name: string;
  /** Rig origin is at the character's feet, centre. Character faces RIGHT in the setup pose. */
  bones: BoneDef[];
  slots: SlotDef[];
  animations: Record<string, AnimData>;
  /** Default cross-fade seconds between animations, with optional per-pair overrides "from>to". */
  mix: { default: number; pairs?: Record<string, number> };
}

/** Animation names the game runtime expects the hero rig to provide. */
export const HERO_ANIMS = [
  'idle', 'run', 'jump', 'fall', 'land', 'doubleJump',
  'wallSlide', 'dash', 'attack', 'turn',
] as const;
export type HeroAnim = (typeof HERO_ANIMS)[number];

/* ------------------------------------------------------------------ */
/* Content paths                                                        */
/* ------------------------------------------------------------------ */

export const CONTENT = {
  world: 'world.json',
  room: (id: string) => `rooms/${id}.json`,
  tileset: 'tileset.json',
  decor: 'decor.json',
  backgrounds: 'backgrounds.json',
  gameConfig: 'game-config.json',
  rig: (name: string) => `rigs/${name}.rig.json`,
} as const;
