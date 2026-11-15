/**
 * LIVE LINK TO THE RUNNING GAME
 * -----------------------------
 * The editor and the game (in the preview frame, or in another browser tab)
 * talk over a BroadcastChannel called "metroidvania" - see
 * src/game/core/editorBridge.ts for the game's side of the conversation.
 *
 *   editor -> game   { type: 'config', config }   new settings, applied instantly
 *   editor -> game   { type: 'rig', rig }         new hero animations, hot-swapped
 *   game -> editor   { type: 'ready' }            "I just (re)started" - we answer by
 *                                                  sending the current settings again
 */
import type { GameConfig, RigData } from '../../shared/types';

export const CHANNEL_NAME = 'metroidvania';

export class GameLink {
  private channel: BroadcastChannel | null = null;
  private readyHandlers: Array<() => void> = [];
  /** How many times a game has said "ready" (shown in the UI as a heartbeat). */
  readyCount = 0;

  constructor() {
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string } | null;
      if (msg && typeof msg === 'object' && msg.type === 'ready') {
        this.readyCount++;
        for (const cb of this.readyHandlers) cb();
      }
    };
  }

  onReady(cb: () => void): void { this.readyHandlers.push(cb); }

  sendConfig(config: GameConfig): void {
    this.channel?.postMessage({ type: 'config', config });
  }

  sendRig(rig: RigData): void {
    this.channel?.postMessage({ type: 'rig', rig });
  }
}
