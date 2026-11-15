/**
 * INPUT
 * -----
 * Collects keyboard + gamepad state and hands it to the fixed-step
 * simulation one step at a time.
 *
 * The important trick: a button PRESS is "latched". Keyboard events arrive
 * between frames, and a quick tap can go down and up again before the next
 * simulation step runs. So a press sets a latch that stays set until a
 * simulation step actually consumes it - a tap can never be lost, even on
 * frames that run zero steps (e.g. 144 Hz display, 120 Hz simulation).
 */
import type { StepInput } from '../player/controller';
import { GAMEPAD_BUTTONS, KEYBOARD, STICK_DEADZONE, type Action } from './bindings';

const ACTIONS = Object.keys(KEYBOARD) as Action[];

export class InputManager {
  /** Keys currently held (KeyboardEvent.code). */
  private keysDown = new Set<string>();
  /** Actions pressed since the last consumed step. */
  private latched = new Set<Action>();
  /** Gamepad button state from the previous poll, to detect new presses. */
  private padHeld = new Set<Action>();
  private padMoveX = 0;
  private padMoveY = 0;
  /** Which horizontal key was pressed most recently (so left+right = newest wins). */
  private lastHorizontal: 'left' | 'right' = 'right';
  private frame: StepInput = {
    moveX: 0, moveY: 0, jumpHeld: false, jumpPressed: false, dashPressed: false, attackPressed: false,
  };
  private extraKeyHandlers: Array<(code: string) => void> = [];

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Listen for non-gameplay keys (debug toggle etc.). */
  onKey(handler: (code: string) => void): void {
    this.extraKeyHandlers.push(handler);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Don't steal typing from form fields (when embedded next to editor UI).
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    let used = false;
    for (const action of ACTIONS) {
      if (KEYBOARD[action].includes(e.code)) {
        used = true;
        if (!e.repeat) {
          this.latched.add(action);
          if (action === 'left' || action === 'right') this.lastHorizontal = action;
        }
      }
    }
    if (used) {
      this.keysDown.add(e.code);
      if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault(); // stop the page scrolling
    } else if (!e.repeat) {
      for (const h of this.extraKeyHandlers) h(e.code);
      if (e.code === 'F1') e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private onBlur = (): void => {
    this.keysDown.clear();
    this.latched.clear();
  };

  private keyHeld(action: Action): boolean {
    for (const code of KEYBOARD[action]) if (this.keysDown.has(code)) return true;
    return false;
  }

  private held(action: Action): boolean {
    return this.keyHeld(action) || this.padHeld.has(action);
  }

  /** Call once per rendered frame: reads the gamepad (it has no events, it must be polled). */
  poll(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const now = new Set<Action>();
    let mx = 0;
    let my = 0;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      for (const action of ACTIONS) {
        for (const index of GAMEPAD_BUTTONS[action]) {
          if (pad.buttons[index]?.pressed) now.add(action);
        }
      }
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > Math.abs(mx)) mx = ax;
      if (Math.abs(ay) > Math.abs(my)) my = ay;
    }
    for (const action of now) if (!this.padHeld.has(action)) this.latched.add(action);
    this.padHeld = now;
    this.padMoveX = Math.abs(mx) > STICK_DEADZONE ? mx : 0;
    this.padMoveY = Math.abs(my) > STICK_DEADZONE ? my : 0;
  }

  /** Call once per SIMULATION step. Returns the input for that step and clears the press latches. */
  consume(): StepInput {
    let moveX = 0;
    const left = this.held('left');
    const right = this.held('right');
    if (left && right) moveX = this.lastHorizontal === 'left' ? -1 : 1;
    else if (left) moveX = -1;
    else if (right) moveX = 1;
    else if (this.padMoveX !== 0) {
      // Analog stick: full speed past 80% tilt, gentle walk below.
      moveX = Math.sign(this.padMoveX) * Math.min(1, Math.abs(this.padMoveX) / 0.8);
    }

    let moveY = 0;
    if (this.held('down')) moveY = 1;
    else if (this.held('up')) moveY = -1;
    else moveY = this.padMoveY;

    // One object is reused for every step so the game creates no garbage here.
    const out = this.frame;
    out.moveX = moveX;
    out.moveY = moveY;
    out.jumpHeld = this.held('jump') || this.latched.has('jump');
    out.jumpPressed = this.latched.has('jump');
    out.dashPressed = this.latched.has('dash');
    out.attackPressed = this.latched.has('attack');
    this.latched.clear();
    return out;
  }

  /** Throw away pending presses (after loading / fades). */
  clearLatches(): void {
    this.latched.clear();
  }
}
