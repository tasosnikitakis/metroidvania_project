/**
 * EDITOR BRIDGE - how the World Editor and Game Editor talk to a running game.
 *
 * URL parameters (read once at start):
 *   ?room=<id>        start in that room
 *   &x=<px>&y=<px>    spawn at that position in the room instead of the playerStart
 *   &debug=1          start with the debug overlay on
 *
 * BroadcastChannel 'metroidvania' (any tab/iframe on the same site):
 *   -> { type: 'config', config: GameConfig }   apply new tuning immediately, no reload
 *   -> { type: 'reload' }                       re-fetch content and rebuild the current room
 *   <- { type: 'ready' }                        posted by the game once it is running
 */
import type { GameConfig } from '../../shared/types';

export const CHANNEL_NAME = 'metroidvania';

export interface StartParams {
  room: string | null;
  x: number | null;
  y: number | null;
  debug: boolean;
}

export function readStartParams(search: string = location.search): StartParams {
  const q = new URLSearchParams(search);
  const numberOrNull = (key: string): number | null => {
    const raw = q.get(key);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const debug = q.get('debug');
  return {
    room: q.get('room') || null,
    x: numberOrNull('x'),
    y: numberOrNull('y'),
    debug: debug !== null && debug !== '0' && debug !== 'false',
  };
}

export interface BridgeHandlers {
  onConfig(config: GameConfig): void;
  onReload(): void;
}

export class EditorBridge {
  private channel: BroadcastChannel | null = null;

  constructor(handlers: BridgeHandlers) {
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'config' && msg.config && typeof msg.config === 'object') handlers.onConfig(msg.config as GameConfig);
      else if (msg.type === 'reload') handlers.onReload();
    };
  }

  /** Tell the editors the game is up (also sent again after every reload). */
  postReady(): void {
    this.channel?.postMessage({ type: 'ready' });
  }

  destroy(): void {
    this.channel?.close();
    this.channel = null;
  }
}
