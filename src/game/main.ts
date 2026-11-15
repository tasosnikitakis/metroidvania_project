/**
 * GAME ENTRY POINT (loaded by index.html)
 * Creates the Phaser game with settings chosen for smooth, crisp rendering:
 *  - canvas in real device pixels (see core/display.ts)
 *  - no pixel rounding: the art is hi-res vector-style, so sub-pixel
 *    movement with linear filtering is what looks smoothest
 *  - Phaser's own delta smoothing is off: our fixed-step loop
 *    (core/fixedLoop.ts) handles timing precisely.
 */
import Phaser from 'phaser';
import { canvasSizeFor, installAutoResize } from './core/display';
import { showError, showLoading } from './core/dom';
import { GameScene } from './scenes/GameScene';

function start(): void {
  const parent = document.getElementById('game') ?? document.body;
  showLoading('Loading…');
  const size = canvasSizeFor(parent);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0a12',
    banner: false,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.NONE, // we size the canvas ourselves (device pixels)
      width: size.width,
      height: size.height,
      zoom: 1 / size.dpr,
    },
    render: {
      antialias: true,
      roundPixels: false,
      powerPreference: 'high-performance',
    },
    fps: { smoothStep: false },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false }, // see input/InputManager.ts
    audio: { noAudio: true }, // no sound yet
    scene: [GameScene],
  });

  installAutoResize(game, parent);
}

try {
  start();
} catch (err) {
  console.error(err);
  showError('The game could not start', err instanceof Error ? err.message : String(err));
}
