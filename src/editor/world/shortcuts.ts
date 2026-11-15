/**
 * KEYBOARD SHORTCUTS
 * One place that maps keys to actions. Shortcuts are ignored while you are
 * typing in a text box or a dialog is open (except Ctrl+S, which always saves).
 */
import type { Actions } from './actions';
import type { CanvasView } from './render/canvasView';
import type { Editor, ToolId } from './state/editor';
import { dialogOpen } from './ui/dialogs';
import { LAYER_NAMES } from '../../shared/types';

const TOOL_KEYS: Record<string, ToolId> = {
  b: 'terrain', t: 'tile', e: 'eraser', r: 'rect', f: 'fill', i: 'eyedropper',
  m: 'select', d: 'decor', n: 'entity', p: 'play',
};
const BRUSH_SIZES = [1, 2, 3, 5];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'color'].includes(target.type);
  return target.isContentEditable;
}

export function installShortcuts(editor: Editor, canvas: CanvasView, actions: Actions): void {
  window.addEventListener('keydown', (e) => {
    if (dialogOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const typing = isTyping(e.target);

    // Saving works from anywhere, even inside a text box.
    if (mod && key === 's') {
      e.preventDefault();
      if (e.target instanceof HTMLElement) e.target.blur(); // commits a half-typed field first
      void actions.save();
      return;
    }
    if (typing) {
      const el = e.target as HTMLElement;
      const numeric = el instanceof HTMLInputElement && el.type === 'number';
      if (key === 'Escape' || (key === 'Enter' && el instanceof HTMLInputElement)) {
        el.blur(); // done typing: give the keyboard back to the editor
      } else if (numeric && mod && (key === 'z' || key === 'y')) {
        // In a number box Ctrl+Z should undo the edit in the room, not fiddle with the digits.
        e.preventDefault();
        el.blur();
        if (key === 'y' || e.shiftKey) editor.redo(); else editor.undo();
      }
      return;
    }

    const used = (): void => { e.preventDefault(); };

    /* ---- with Ctrl / Cmd ---- */
    if (mod) {
      if (key === 'z') { used(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
      if (key === 'y') { used(); editor.redo(); return; }
      if (key === 'Enter') { used(); void actions.play(); return; }
      if (editor.mode === 'map') return;
      if (key === 'c') { used(); actions.copy(); return; }
      if (key === 'x') { used(); actions.cut(); return; }
      if (key === 'v') { used(); actions.paste(); return; }
      if (key === 'd') { used(); actions.duplicate(); return; }
      if (key === 'a') { used(); editor.setTool('select'); canvas.selectTool.selectAll(); return; }
      return;
    }
    if (e.altKey) return;

    /* ---- work in both modes ---- */
    if (key === 'Tab') { used(); actions.toggleMap(); return; }
    if (key === '+' || key === '=') { used(); canvas.zoomBy(1.25); return; }
    if (key === '-' || key === '_') { used(); canvas.zoomBy(1 / 1.25); return; }
    if (key === '0') { used(); canvas.fit(); return; }
    if (key === '?' || key === 'F1') { used(); actions.help(); return; }
    if (key === ' ') {
      used(); // also stops Space from "clicking" whichever button was used last
      if (!e.repeat) canvas.setSpaceHeld(true);
      return;
    }

    if (editor.mode === 'map') {
      if (key === 'Enter' && editor.roomId) { used(); editor.openRoom(editor.roomId); }
      if (key === 'Escape') { used(); if (!canvas.cancelDrag()) actions.toggleMap(); }
      return;
    }

    /* ---- room mode ---- */
    if (key === 'Escape') {
      used();
      if (canvas.cancelDrag()) return;
      canvas.activeTool.onKey?.(e);
      return;
    }
    // Arrow keys, Enter...: the active tool gets first go.
    if (canvas.activeTool.onKey?.(e)) { used(); return; }

    if (key === 'Delete' || key === 'Backspace') { used(); actions.deleteSelected(); return; }
    if (TOOL_KEYS[key]) { used(); editor.setTool(TOOL_KEYS[key]); return; }
    if (key === '1' || key === '2' || key === '3') { used(); editor.setActiveLayer(LAYER_NAMES[Number(key) - 1]); return; }
    if (key === 'g') { used(); editor.toggleView('grid'); return; }
    if (key === 'h') { used(); editor.toggleView('collision'); return; }
    if (key === 'c') { used(); editor.toggleView('cameraFrame'); return; }
    if (key === '[' || key === ']') {
      used();
      const i = BRUSH_SIZES.indexOf(editor.brushSize);
      const next = BRUSH_SIZES[Math.min(BRUSH_SIZES.length - 1, Math.max(0, i + (key === ']' ? 1 : -1)))];
      editor.setBrushSize(next);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') canvas.setSpaceHeld(false);
  });
  // If the window loses focus while Space is down we would never see the key-up.
  window.addEventListener('blur', () => canvas.setSpaceHeld(false));
}
