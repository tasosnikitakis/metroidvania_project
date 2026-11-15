/**
 * CONTENT LOADING
 * ---------------
 * Everything the game shows comes from JSON served at /api/content/...
 * (see src/shared/types.ts for the shapes). This module fetches it, fills in
 * sensible fallbacks for optional files, and loads the images it refers to.
 */
import Phaser from 'phaser';
import { loadContent } from '../../shared/api';
import {
  CONTENT, TILE_SIZE,
  type BackgroundCatalog, type BackgroundDef, type DecorCatalog, type GameConfig, type RigData,
  type RoomData, type RoomRef, type TilesetData, type WorldData,
} from '../../shared/types';
import { findRoomRef } from '../world/worldMap';

/** Used when game-config.json is missing, and to fill in any missing fields. */
export const DEFAULT_CONFIG: GameConfig = {
  version: 1,
  player: {
    width: 30, height: 66,
    runSpeed: 330, groundAccel: 3200, groundDecel: 3800, airAccel: 2400, airDecel: 1500, turnBoost: 1.8,
    jumpHeight: 168, jumpTimeToApex: 0.4, fallGravityMult: 1.55, jumpCutMult: 0.45,
    apexHangThreshold: 70, apexHangGravityMult: 0.55, maxFallSpeed: 980, coyoteTime: 0.1, jumpBuffer: 0.12,
    airJumps: 1, airJumpHeight: 120,
    wallSlideEnabled: true, wallSlideSpeed: 130, wallJumpEnabled: true, wallJumpSpeedX: 340,
    wallJumpHeight: 140, wallJumpLockTime: 0.17,
    dashEnabled: true, dashSpeed: 820, dashTime: 0.17, dashCooldown: 0.28, airDashes: 1,
    attackEnabled: true, attackTime: 0.32, attackCooldown: 0.08,
  },
  camera: {
    lerpX: 0.12, lerpY: 0.1, lookAhead: 90, lookAheadLerp: 0.04,
    deadzoneW: 40, deadzoneH: 90, zoom: 1, landShake: 5,
  },
  feel: { squashStretch: 0.6, dustParticles: true, afterImages: true, hitPauseMs: 60 },
};

/**
 * Copy `incoming` over the defaults, section by section, ignoring values of
 * the wrong type. A half-edited config from the Game Editor can therefore
 * never crash the game.
 */
export function mergeConfig(incoming: unknown, base: GameConfig = DEFAULT_CONFIG): GameConfig {
  const out: GameConfig = {
    version: 1,
    player: { ...base.player },
    camera: { ...base.camera },
    feel: { ...base.feel },
  };
  if (!incoming || typeof incoming !== 'object') return out;
  for (const section of ['player', 'camera', 'feel'] as const) {
    const src = (incoming as Record<string, unknown>)[section];
    if (!src || typeof src !== 'object') continue;
    const dst = out[section] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(src)) {
      if (!(key in dst)) continue;
      if (typeof value !== typeof dst[key]) continue;
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      dst[key] = value;
    }
  }
  return out;
}

/** Everything needed to run one room. */
export interface ContentBundle {
  world: WorldData;
  room: RoomData;
  /** The room's entry on the world map (undefined if world.json does not list it). */
  roomRef: RoomRef | undefined;
  tileset: TilesetData;
  decor: DecorCatalog;
  backgrounds: BackgroundCatalog;
  background: BackgroundDef;
  config: GameConfig;
  rig: RigData | null;
}

const FALLBACK_BACKGROUND: BackgroundDef = {
  key: '__fallback', name: 'Fallback', skyTop: '#141226', skyBottom: '#2a2440', layers: [],
};

async function optional<T>(path: string, fallback: T): Promise<T> {
  try {
    return await loadContent<T>(path);
  } catch (err) {
    console.warn(`[content] optional file ${path} not available - using a fallback.`, err);
    return fallback;
  }
}

/**
 * Fetch all JSON for a room. world.json, the room file and tileset.json are
 * required (a missing one throws and the game shows an error screen); the
 * rest fall back gracefully so the game runs while art is still being made.
 */
export async function fetchContent(requestedRoom?: string | null): Promise<ContentBundle> {
  const [world, tileset, decor, backgrounds, rawConfig, rig] = await Promise.all([
    loadContent<WorldData>(CONTENT.world),
    loadContent<TilesetData>(CONTENT.tileset),
    optional<DecorCatalog>(CONTENT.decor, { version: 1, decor: [] }),
    optional<BackgroundCatalog>(CONTENT.backgrounds, { version: 1, backgrounds: [] }),
    optional<unknown>(CONTENT.gameConfig, null),
    optional<RigData | null>(CONTENT.rig('hero'), null),
  ]);
  const roomId = requestedRoom || world.startRoom || world.rooms[0]?.id;
  if (!roomId) throw new Error('world.json has no rooms.');
  const room = await loadContent<RoomData>(CONTENT.room(roomId));
  validateRoom(room);
  if (!tileset.tileSize) tileset.tileSize = TILE_SIZE;
  const background =
    backgrounds.backgrounds.find((b) => b.key === room.background) ?? backgrounds.backgrounds[0] ?? FALLBACK_BACKGROUND;
  return {
    world, room, roomRef: findRoomRef(world, roomId), tileset, decor, backgrounds, background,
    config: mergeConfig(rawConfig), rig,
  };
}

function validateRoom(room: RoomData): void {
  const n = room.width * room.height;
  if (!(n > 0)) throw new Error(`Room "${room.id}" has no size.`);
  room.layers ??= { back: [], main: [], front: [] };
  for (const name of ['back', 'main', 'front'] as const) room.layers[name] ??= [];
  room.decor ??= [];
  room.entities ??= [];
}

/** Site-root-relative asset path -> URL that works wherever the game is hosted. */
export function assetUrl(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}

/** Image URLs a room needs (texture key === the URL string from the JSON). */
export function collectImageUrls(c: ContentBundle): string[] {
  const urls = new Set<string>();
  urls.add(c.tileset.image);
  for (const layer of c.background.layers) urls.add(layer.image);
  const usedDecor = new Set(c.room.decor.map((d) => d.key));
  for (const def of c.decor.decor) if (usedDecor.has(def.key)) urls.add(def.image);
  return [...urls];
}

const errorListenerInstalled = new WeakSet<Phaser.Scene>();

/**
 * Load any images that are not in Phaser's texture cache yet.
 * Texture key === the path exactly as written in the JSON.
 * A missing image is not fatal - Phaser logs it and the caller checks
 * `scene.textures.exists(key)` before using it.
 */
export function loadImages(scene: Phaser.Scene, paths: string[], extraQueue?: () => void): Promise<void> {
  return new Promise((resolve) => {
    for (const path of paths) {
      if (path && !scene.textures.exists(path)) scene.load.image(path, assetUrl(path));
    }
    extraQueue?.();
    if (scene.load.list.size === 0 && !scene.load.isLoading()) {
      resolve();
      return;
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    if (!errorListenerInstalled.has(scene)) {
      errorListenerInstalled.add(scene);
      scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: { key: string }) => {
        console.warn(`[content] could not load image "${file.key}"`);
      });
    }
    scene.load.start();
  });
}
