/**
 * GAME SCENE - ties everything together.
 *
 * Each rendered frame (Phaser calls update()):
 *   1. poll input
 *   2. run 0..n fixed simulation steps (player physics + camera target)
 *   3. draw: place the hero and camera at positions INTERPOLATED between the
 *      last two simulation states, then update the purely visual things
 *      (parallax, lights, particles, animation) with real elapsed time.
 *
 * Nothing in step 2 depends on the frame rate, and nothing in step 3 affects
 * gameplay - that separation is what keeps the game smooth and fair on any
 * display.
 */
import Phaser from 'phaser';
import type { GameConfig } from '../../shared/types';
import { CameraRig } from '../camera/cameraRig';
import { DEPTH, FADE_IN_TIME, FADE_OUT_TIME, SIM_HZ } from '../constants';
import {
  collectImageUrls, fetchContent, loadImages, mergeConfig, type ContentBundle,
} from '../core/content';
import { cameraZoomFor } from '../core/display';
import { hideError, hideLoading, showError, showHint, showLoading } from '../core/dom';
import { EditorBridge, readStartParams, type StartParams } from '../core/editorBridge';
import { FixedStepLoop } from '../core/fixedLoop';
import { clamp, lerp } from '../core/math';
import { DebugOverlay } from '../debug/DebugOverlay';
import { DustFx } from '../fx/dust';
import { ensureFxTextures, TEX } from '../fx/textures';
import { makeViewRect, setViewRect, type ViewRect } from '../fx/view';
import { CONTROLS_HINT, DEBUG_KEYS } from '../input/bindings';
import { InputManager } from '../input/InputManager';
import { buildCollisionGrid, type CollisionGrid } from '../physics/grid';
import { overlapsSolid } from '../physics/move';
import { PlayerController, type PlayerEvent } from '../player/controller';
import { HeroView } from '../player/HeroView';
import { loadRigModule, type RigModule } from '../player/rigLoader';
import { CHECKPOINT_H, CHECKPOINT_W } from '../world/entities';
import { RoomView } from '../world/RoomView';
import { findRoomExit, makeOpenOutsideTest, type RoomExit } from '../world/worldMap';

/** What automated tests (and curious people in the browser console) can read. */
export interface GameProbe {
  ready: boolean;
  player: { x: number; y: number; vx: number; vy: number; state: string; onGround: boolean; facing: number };
  room: string;
  fps: number;
}

declare global {
  interface Window {
    __game: GameProbe;
  }
}

interface Spawn {
  x: number;
  y: number;
  facing: 1 | -1;
}

/** Something waiting for the screen to finish fading to black. */
type Pending = { kind: 'respawn' } | { kind: 'room'; exit: RoomExit } | { kind: 'reload' };

export class GameScene extends Phaser.Scene {
  /* --- long-lived systems --- */
  private inputMgr!: InputManager;
  private loop = new FixedStepLoop(SIM_HZ);
  private player = new PlayerController();
  private camRig = new CameraRig();
  private bridge!: EditorBridge;
  private debug!: DebugOverlay;
  private dust!: DustFx;
  private fadeRect!: Phaser.GameObjects.Image;
  private rigModule: RigModule | null = null;
  private startParams: StartParams = readStartParams();

  /* --- per-room / per-content things --- */
  private content!: ContentBundle;
  private config!: GameConfig;
  /** True once the Game Editor has pushed a live config (kept across reloads). */
  private hasLiveConfig = false;
  private grid!: CollisionGrid;
  private roomView: RoomView | null = null;
  private hero: HeroView | null = null;
  private respawnPoint: Spawn = { x: 0, y: 0, facing: 1 };
  private startPoint: Spawn = { x: 0, y: 0, facing: 1 };

  /* --- frame state --- */
  private running = false;
  /** Hero position at the previous simulation step (for interpolation). */
  private prevX = 0;
  private prevY = 0;
  private fadeAlpha = 1;
  private fadeDir: -1 | 0 | 1 = 0;
  private pending: Pending | null = null;
  private busyLoading = false;
  private reloadQueued = false;
  private hitPauseMs = 0;
  private seconds = 0;
  private view: ViewRect = makeViewRect(0, 0, 1280, 720);

  constructor() {
    super('game');
  }

  /* ================================================================== */
  /* start-up                                                            */
  /* ================================================================== */

  create(): void {
    window.__game = {
      ready: false,
      player: { x: 0, y: 0, vx: 0, vy: 0, state: 'idle', onGround: false, facing: 1 },
      room: '',
      fps: 0,
    };

    // Handy in the browser console while developing: __scene.player, __scene.config ...
    if (import.meta.env.DEV) (window as unknown as { __scene: GameScene }).__scene = this;

    ensureFxTextures(this);
    this.inputMgr = new InputManager();
    this.inputMgr.onKey((code) => this.onToolKey(code));
    this.debug = new DebugOverlay(this);
    this.dust = new DustFx(this);
    this.fadeRect = this.add.image(0, 0, TEX.WHITE).setTint(0x07060c).setDepth(DEPTH.FADE);

    this.bridge = new EditorBridge({
      onConfig: (cfg) => this.applyLiveConfig(cfg),
      onReload: () => this.requestReload(),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputMgr.destroy();
      this.bridge.destroy();
    });

    void this.boot();
  }

  /** First load: fetch content, load images, build the starting room. */
  private async boot(): Promise<void> {
    showLoading('Loading…');
    hideError();
    try {
      this.rigModule = await loadRigModule();
      const content = await this.loadRoomContent(this.startParams.room);
      this.buildRoom(content, null);
      if (this.startParams.debug) this.debug.toggle(true);
      this.running = true;
      this.fadeDir = -1;
      this.loop.reset();
      hideLoading();
      showHint(CONTROLS_HINT);
      window.__game.ready = true;
      this.bridge.postReady();
    } catch (err) {
      console.error(err);
      showError('Something went wrong', err instanceof Error ? err.message : String(err), () => void this.boot());
    }
  }

  /** Fetch the JSON for a room and make sure every image it needs is loaded. */
  private async loadRoomContent(roomId: string | null | undefined): Promise<ContentBundle> {
    const content = await fetchContent(roomId);
    await loadImages(this, collectImageUrls(content), () => {
      if (content.rig && this.rigModule) {
        try {
          this.rigModule.preloadRig(this, content.rig);
        } catch (err) {
          console.warn('[hero] preloadRig failed', err);
        }
      }
    });
    return content;
  }

  /* ================================================================== */
  /* building rooms                                                      */
  /* ================================================================== */

  /**
   * Throw away the current room visuals and build `content`.
   * @param spawn where to put the hero; null = use URL x/y, else the playerStart.
   * @param keepMotion keep velocity (walking between rooms)
   */
  private buildRoom(content: ContentBundle, spawn: Spawn | null, keepMotion = false): void {
    const firstBuild = this.roomView === null;
    this.roomView?.destroy();
    this.content = content;
    if (!this.hasLiveConfig) this.config = content.config;

    this.roomView = new RoomView(this, content);
    this.grid = buildCollisionGrid(content.room, content.tileset, makeOpenOutsideTest(content.world, content.roomRef));

    // (Re)create the hero when needed: first time, or after a content reload.
    if (!this.hero) {
      this.hero = new HeroView(this, content.rig, this.rigModule, this.dust, this.config.player.width, this.config.player.height);
    }

    // Where does the hero start in this room?
    this.startPoint = this.findStartPoint(firstBuild);
    const at = spawn ?? this.startPoint;
    this.player.w = this.config.player.width;
    this.player.h = this.config.player.height;
    this.player.teleport(at.x, at.y, at.facing, keepMotion);
    this.respawnPoint = spawn ? { ...at } : { ...this.startPoint };
    this.snapViewToPlayer();
    window.__game.room = content.room.id;
  }

  private findStartPoint(useUrlPosition: boolean): Spawn {
    const { room, tileset } = this.content;
    const start = this.roomView!.entities.playerStart;
    if (useUrlPosition && this.startParams.x !== null && this.startParams.y !== null) {
      return { x: this.startParams.x, y: this.startParams.y, facing: start?.facing ?? 1 };
    }
    if (start) return start;
    // No playerStart entity: stand on the first solid ground we can find near the left.
    const ts = tileset.tileSize;
    for (let tx = 2; tx < room.width; tx++) {
      for (let ty = 2; ty < room.height; ty++) {
        const x = (tx + 0.5) * ts;
        const y = ty * ts;
        if (overlapsSolid(this.grid, x, y + 4, 8, 4) && !overlapsSolid(this.grid, x, y, this.config.player.width, this.config.player.height)) {
          return { x, y, facing: 1 };
        }
      }
    }
    return { x: (room.width * ts) / 2, y: (room.height * ts) / 2, facing: 1 };
  }

  /** After any teleport: no interpolation from the old spot, camera jumps too. */
  private snapViewToPlayer(): void {
    const p = this.player;
    this.prevX = p.x;
    this.prevY = p.y;
    this.camRig.snapTo(p.x, p.y - p.h * 0.55, p.facing, this.config.camera);
    this.loop.reset();
    this.inputMgr.clearLatches();
  }

  /* ================================================================== */
  /* editor hooks                                                        */
  /* ================================================================== */

  /** Game Editor pushed new tuning: takes effect on the very next step. */
  private applyLiveConfig(incoming: GameConfig): void {
    this.config = mergeConfig(incoming, this.config ?? undefined);
    this.hasLiveConfig = true;
  }

  /** World Editor saved something: rebuild the room in place. */
  private requestReload(): void {
    if (!this.running || this.busyLoading || this.pending) {
      this.reloadQueued = true;
      return;
    }
    this.pending = { kind: 'reload' };
    this.fadeDir = 1;
  }

  private async doReload(): Promise<void> {
    this.busyLoading = true;
    try {
      const keep: Spawn = { x: this.player.x, y: this.player.y, facing: this.player.facing };
      const content = await this.loadRoomContent(this.content.room.id);
      // The rig may have changed too, so rebuild the hero.
      this.hero?.destroy();
      this.hero = null;
      this.buildRoom(content, null);
      // Put the hero back where they were, if that spot still makes sense.
      const p = this.player;
      const roomW = this.roomView!.widthPx;
      const roomH = this.roomView!.heightPx;
      const inside = keep.x > 0 && keep.x < roomW && keep.y > 0 && keep.y <= roomH;
      if (inside) {
        let y = keep.y;
        // If a wall was painted over the hero, lift them up to the first free spot.
        let tries = 0;
        while (overlapsSolid(this.grid, keep.x, y, p.w, p.h) && tries++ < 200) y -= 8;
        if (tries <= 200) {
          p.teleport(keep.x, y, keep.facing);
          this.snapViewToPlayer();
        }
      }
      this.bridge.postReady();
    } catch (err) {
      // Keep playing the old version of the room; the editor probably saved half-way.
      console.warn('[reload] failed, keeping the current room', err);
    }
    this.busyLoading = false;
    this.pending = null;
    this.fadeDir = -1;
  }

  private onToolKey(code: string): void {
    if (DEBUG_KEYS.toggleOverlay.includes(code)) this.debug.toggle();
    else if (DEBUG_KEYS.respawn.includes(code) && this.running && !this.pending) {
      this.respawnPoint = { ...this.startPoint };
      this.pending = { kind: 'respawn' };
      this.fadeDir = 1;
    }
  }

  /**
   * Freeze the simulation for a few milliseconds - the classic "hit stop"
   * that makes impacts feel heavy. Ready for combat code to call.
   */
  hitPause(ms: number = this.config.feel.hitPauseMs): void {
    this.hitPauseMs = Math.max(this.hitPauseMs, ms);
  }

  /* ================================================================== */
  /* simulation (fixed 120 Hz)                                           */
  /* ================================================================== */

  private simStep = (dt: number): void => {
    const p = this.player;
    this.prevX = p.x;
    this.prevY = p.y;

    if (!this.pending) {
      p.step(this.inputMgr.consume(), this.config.player, this.grid, dt);
      this.handlePlayerEvents();
      this.checkCheckpoints();
      this.checkRoomEdges();
    }

    this.camRig.step(p.x, p.y - p.h * 0.55, p.facing, this.config.camera, dt);
  };

  private handlePlayerEvents(): void {
    const p = this.player;
    if (p.events.length === 0) return;
    for (const e of p.events) {
      this.hero?.handleEvent(e, p, this.config);
      this.onPlayerEvent(e);
    }
    p.events.length = 0;
  }

  private onPlayerEvent(e: PlayerEvent): void {
    const cfg = this.config;
    switch (e.type) {
      case 'land': {
        // Thump the camera on hard landings, scaled by how fast we hit.
        const impact = clamp(e.speed / Math.max(cfg.player.maxFallSpeed, 1), 0, 1);
        if (impact > 0.5) this.camRig.shake(cfg.camera.landShake * impact * impact);
        break;
      }
      case 'attack':
        // For future enemies/breakables: listen with scene.events.on('player-attack', ...)
        // and test against player.getAttackHitbox() while the swing is live.
        this.events.emit('player-attack', { dir: e.dir, player: this.player });
        break;
      case 'hazard':
        this.camRig.shake(cfg.camera.landShake * 1.2);
        this.pending = { kind: 'respawn' };
        this.fadeDir = 1;
        break;
    }
  }

  private checkCheckpoints(): void {
    const p = this.player;
    const entities = this.roomView!.entities;
    for (const cp of entities.checkpoints) {
      if (cp.active) continue;
      const overlapX = Math.abs(p.x - cp.x) < (p.w + CHECKPOINT_W) / 2;
      const overlapY = p.y > cp.y - CHECKPOINT_H && p.y - p.h < cp.y;
      if (overlapX && overlapY) {
        entities.activate(cp);
        this.respawnPoint = { x: cp.x, y: cp.y, facing: p.facing };
      }
    }
  }

  /** Walked off the room? Enter the neighbour, or respawn if we fell into the void. */
  private checkRoomEdges(): void {
    if (this.pending) return;
    const p = this.player;
    const ts = this.grid.tileSize;
    const exit = findRoomExit(this.content.world, this.content.roomRef, p.x, p.y, p.h, ts);
    if (exit) {
      this.pending = { kind: 'room', exit };
      this.fadeDir = 1;
    } else if (p.y - p.h > this.roomView!.heightPx + 96) {
      // Fell out of the bottom with no room below: same as touching a hazard.
      this.pending = { kind: 'respawn' };
      this.fadeDir = 1;
    }
  }

  /* ================================================================== */
  /* things that happen while the screen is black                        */
  /* ================================================================== */

  private runPending(): void {
    const pending = this.pending;
    if (!pending || this.busyLoading) return;
    if (pending.kind === 'respawn') {
      this.player.teleport(this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.facing);
      this.player.events.length = 0;
      this.snapViewToPlayer();
      this.pending = null;
      this.fadeDir = -1;
    } else if (pending.kind === 'room') {
      void this.enterRoom(pending.exit);
    } else {
      void this.doReload();
    }
  }

  private async enterRoom(exit: RoomExit): Promise<void> {
    this.busyLoading = true;
    try {
      const content = await this.loadRoomContent(exit.room.id);
      const p = this.player;
      // Entering from below: make sure there is enough upward speed to clear the lip.
      if (p.vy < 0) p.vy = Math.min(p.vy, -420);
      this.buildRoom(content, { x: exit.x, y: exit.y, facing: p.facing }, true);
    } catch (err) {
      console.warn(`[rooms] could not enter "${exit.room.id}" - staying here.`, err);
      // Step back inside so we do not immediately try again.
      this.player.teleport(this.respawnPoint.x, this.respawnPoint.y, this.respawnPoint.facing);
      this.snapViewToPlayer();
    }
    this.busyLoading = false;
    this.pending = null;
    this.fadeDir = -1;
  }

  /* ================================================================== */
  /* per-frame                                                           */
  /* ================================================================== */

  update(_time: number, deltaMs: number): void {
    const dt = clamp(deltaMs / 1000, 0, 0.1);
    this.seconds += dt;

    // Fade to/from black. The fade image is kept over the screen even before the first room exists.
    if (this.fadeDir > 0) {
      this.fadeAlpha = Math.min(1, this.fadeAlpha + dt / FADE_OUT_TIME);
      if (this.fadeAlpha >= 1) {
        this.fadeDir = 0;
        this.runPending();
      }
    } else if (this.fadeDir < 0) {
      this.fadeAlpha = Math.max(0, this.fadeAlpha - dt / FADE_IN_TIME);
      if (this.fadeAlpha <= 0) this.fadeDir = 0;
    }

    if (!this.running || !this.roomView || !this.hero) {
      this.placeFade();
      return;
    }
    if (this.reloadQueued && !this.pending && !this.busyLoading) {
      this.reloadQueued = false;
      this.requestReload();
    }

    /* 1. input */
    this.inputMgr.poll();

    /* 2. simulate */
    if (this.hitPauseMs > 0) {
      this.hitPauseMs -= deltaMs;
      this.loop.lastSteps = 0;
    } else {
      this.loop.advance(dt, this.simStep);
    }

    /* 3. draw */
    const p = this.player;
    const alpha = this.loop.alpha;
    const px = lerp(this.prevX, p.x, alpha);
    const py = lerp(this.prevY, p.y, alpha);

    // Camera: zoom so the same amount of world shows on every screen, then
    // centre on the interpolated camera-rig position.
    const cam = this.cameras.main;
    const canvasW = this.scale.width;
    const canvasH = this.scale.height;
    const zoom = cameraZoomFor(canvasW, canvasH, this.config.camera.zoom);
    const viewW = canvasW / zoom;
    const viewH = canvasH / zoom;
    const c = this.camRig.getView(alpha, viewW, viewH, this.roomView.widthPx, this.roomView.heightPx);
    cam.setZoom(zoom);
    cam.centerOn(c.x, c.y);
    setViewRect(this.view, c.x, c.y, viewW, viewH);

    this.roomView.update(dt, this.seconds, this.view);
    this.hero.update(p, px, py, this.config, dt);
    this.dust.update(dt);
    this.placeFade();

    if (this.debug.enabled) {
      this.debug.draw(this.grid, p, px, py, this.roomView.entities.checkpoints, this.view, {
        room: this.content.room.id,
        fps: this.game.loop.actualFps,
        frameMs: deltaMs,
        simHz: SIM_HZ,
        stepsThisFrame: this.loop.lastSteps,
        alpha,
        zoom,
        canvasW,
        canvasH,
        anim: this.hero.view.current,
        usingRig: this.hero.usingRig,
      });
    }

    // Keep the test/console probe fresh.
    const probe = window.__game.player;
    probe.x = p.x;
    probe.y = p.y;
    probe.vx = p.vx;
    probe.vy = p.vy;
    probe.state = p.attacking && !p.dashing ? 'attack' : p.state;
    probe.onGround = p.onGround;
    probe.facing = p.facing;
    window.__game.fps = this.game.loop.actualFps;
  }

  /** Stretch the black fade image over whatever the camera currently shows. */
  private placeFade(): void {
    const cam = this.cameras.main;
    const zoom = cam.zoom || 1;
    const w = this.scale.width / zoom;
    const h = this.scale.height / zoom;
    this.fadeRect
      .setVisible(this.fadeAlpha > 0.001)
      .setAlpha(this.fadeAlpha)
      .setPosition(cam.scrollX + this.scale.width / 2, cam.scrollY + this.scale.height / 2)
      .setDisplaySize(w + 8, h + 8);
  }
}
