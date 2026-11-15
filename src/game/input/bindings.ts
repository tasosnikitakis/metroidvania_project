/**
 * CONTROL BINDINGS - change keys and buttons here.
 *
 * Keyboard entries are KeyboardEvent.code values (physical key positions, so
 * they work on any keyboard layout): https://www.toptal.com/developers/keycode
 *
 * Gamepad entries are button numbers of the "standard" layout:
 *   0 = A / Cross      1 = B / Circle     2 = X / Square    3 = Y / Triangle
 *   4 = LB             5 = RB             6 = LT            7 = RT
 *   12 = D-pad up      13 = D-pad down    14 = D-pad left   15 = D-pad right
 */
export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'dash' | 'attack';

export const KEYBOARD: Record<Action, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyW', 'ArrowUp'],
  dash: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  attack: ['KeyX', 'KeyJ'],
};

export const GAMEPAD_BUTTONS: Record<Action, number[]> = {
  left: [14],
  right: [15],
  up: [12],
  down: [13],
  jump: [0],
  dash: [5, 1],
  attack: [2],
};

/** Left stick: how far it must be pushed before it counts. */
export const STICK_DEADZONE = 0.3;

/** Keys for tools rather than the hero (handled by the game scene). */
export const DEBUG_KEYS = {
  toggleOverlay: ['F1', 'Backquote'],
  respawn: ['KeyR'],
};

/** Shown in the on-screen hint when the game starts. */
export const CONTROLS_HINT =
  'Move  ← → / A D     Jump  Space / Z     Dash  Shift / C     Attack  X / J     Drop  ↓ + Jump';
