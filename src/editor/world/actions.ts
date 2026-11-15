/**
 * ACTIONS
 * Everything the user can "do" from a button, menu or keyboard shortcut lives
 * here in one place, so the top bar, the right-click menu and the shortcuts
 * all behave identically.
 */
import { toast } from '../common/nav';
import { TILE_SIZE } from '../../shared/types';
import type { CanvasView } from './render/canvasView';
import type { Editor } from './state/editor';
import { downloadText, exportBundle, importJson, refreshWritable, saveAll } from './state/persistence';
import { confirmDialog, helpDialog, infoDialog, newRoomDialog, promptDialog, resizeDialog } from './ui/dialogs';

const GAME_WINDOW = 'metroidvania-game';

export class Actions {
  private saving = false;

  constructor(private editor: Editor, private canvas: CanvasView) {}

  /* ---------------- saving & playing ---------------- */

  /** Save everything that changed. Returns true when the server has the latest version. */
  async save(quiet = false): Promise<boolean> {
    const ed = this.editor;
    this.canvas.flushTools();
    if (!ed.writable) {
      toast('Read-only: enter the editor password, or use Export to keep your work', 3500);
      return false;
    }
    if (this.saving) return false;
    if (!ed.dirty && [...ed.rooms.keys()].every((id) => ed.serverRoomIds.has(id))) {
      if (!quiet) toast('Everything is already saved');
      return true;
    }
    this.saving = true;
    ed.events.emit('ui');
    try {
      await saveAll(ed);
      if (!quiet) toast('Saved ✓');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\b403\b/.test(message)) {
        await refreshWritable(ed);
        toast('The server refused to save (read-only). Your work is still here - use Export.', 4500);
      } else {
        toast('Could not save - is the server running? Your work is kept as a draft.', 4500);
      }
      console.error('[world editor] save failed', err);
      return false;
    } finally {
      this.saving = false;
      ed.events.emit('ui');
    }
  }

  get isSaving(): boolean { return this.saving; }

  /** Save, then open the game in the current room (optionally at a position in logical px). */
  async play(x?: number, y?: number): Promise<void> {
    const ed = this.editor;
    const room = ed.room;
    if (!room) { toast('Create a room first'); return; }
    let url = `/?room=${encodeURIComponent(room.id)}`;
    if (x !== undefined && y !== undefined) {
      const px = Math.round(Math.min(room.width * TILE_SIZE, Math.max(0, x)));
      const py = Math.round(Math.min(room.height * TILE_SIZE, Math.max(0, y)));
      url += `&x=${px}&y=${py}`;
    }
    // Open the tab right away (browsers block pop-ups that open after waiting), then point it at the game once saved.
    const win = window.open('', GAME_WINDOW);
    const saved = await this.save(true);
    if (!saved && ed.dirty) toast('Playing the last SAVED version (your newest changes could not be saved)', 4000);
    if (win) {
      win.location.href = url;
      win.focus();
    } else {
      toast('The browser blocked the game window - allow pop-ups for this page', 4000);
    }
  }

  /* ---------------- clipboard-ish ---------------- */

  /** True when the tile selection (not an object) is what Copy/Delete should act on. */
  private tilesTargeted(): boolean {
    return this.editor.tool === 'select' && this.editor.tileSelection !== null;
  }

  copy(): void {
    const ok = this.tilesTargeted() ? this.canvas.selectTool.copy() : this.editor.copySelection();
    toast(ok ? 'Copied' : 'Select something first');
  }

  cut(): void {
    if (this.tilesTargeted()) {
      if (this.canvas.selectTool.cut()) toast('Cut');
    } else if (this.editor.copySelection()) {
      this.editor.deleteSelection();
      toast('Cut');
    }
  }

  /** Paste at the mouse position, or in the middle of the view. */
  paste(at?: { x: number; y: number }): void {
    const ed = this.editor;
    const clip = ed.clipboard;
    if (!clip || !ed.room) { toast('Nothing to paste yet'); return; }
    const hover = this.canvas.hoverInfo();
    const pos = at ?? (hover ? { x: hover.x, y: hover.y } : this.canvas.viewCentre());
    if (clip.kind === 'tiles') {
      ed.setTool('select');
      const tx = Math.floor(pos.x / TILE_SIZE - clip.stamp.w / 2 + 0.5);
      const ty = Math.floor(pos.y / TILE_SIZE - clip.stamp.h / 2 + 0.5);
      this.canvas.selectTool.paste(tx, ty);
    } else {
      ed.pasteObjects(pos.x, pos.y);
    }
  }

  duplicate(): void {
    if (this.tilesTargeted()) this.canvas.selectTool.duplicate();
    else this.editor.duplicateSelection();
  }

  deleteSelected(): void {
    if (this.tilesTargeted()) this.canvas.selectTool.deleteSelection();
    else this.editor.deleteSelection();
  }

  /* ---------------- rooms ---------------- */

  async newRoom(first = false): Promise<void> {
    const ed = this.editor;
    const opts = await newRoomDialog(`Room ${ed.world.rooms.length + 1}`, ed.backgrounds, first);
    if (!opts) return;
    ed.createRoom(opts);
    this.canvas.fit();
    toast(`Created "${opts.name.trim() || 'room'}" - paint away!`);
  }

  async renameRoom(id = this.editor.roomId): Promise<void> {
    const room = id ? this.editor.rooms.get(id) : null;
    if (!room) return;
    const name = await promptDialog('Rename room', 'Room name', room.name, 'Rename');
    if (name) this.editor.renameRoom(room.id, name);
  }

  async resizeRoom(id = this.editor.roomId): Promise<void> {
    const room = id ? this.editor.rooms.get(id) : null;
    if (!room) return;
    const answer = await resizeDialog(room.name, room.width, room.height);
    if (!answer) return;
    this.canvas.flushTools();
    const note = this.editor.resizeRoomTo(room.id, answer.width, answer.height, answer.anchorX, answer.anchorY);
    this.canvas.forgetView(room.id);
    toast(note || `Room is now ${answer.width} × ${answer.height}`, note ? 4500 : 1800);
  }

  duplicateRoom(id = this.editor.roomId): void {
    if (!id) return;
    const copy = this.editor.duplicateRoom(id);
    if (copy) {
      this.editor.openRoom(copy, this.editor.mode === 'map');
      toast('Room duplicated');
    }
  }

  async deleteRoom(id = this.editor.roomId): Promise<void> {
    const room = id ? this.editor.rooms.get(id) : null;
    if (!room) return;
    const ok = await confirmDialog('Delete room?', `"${room.name}" and everything in it will be removed. (You can still Undo until you close the editor.)`, 'Delete room', true);
    if (!ok) return;
    this.canvas.flushTools();
    this.editor.deleteRoom(room.id);
    toast(`Deleted "${room.name}" - Ctrl+Z brings it back`);
    if (this.editor.world.rooms.length === 0) void this.newRoom(true);
  }

  setStartRoom(id = this.editor.roomId): void {
    if (id) {
      this.editor.setStartRoom(id);
      toast('The game now starts in this room');
    }
  }

  toggleMap(): void {
    this.canvas.flushTools();
    this.editor.setMode(this.editor.mode === 'map' ? 'room' : 'map');
  }

  /* ---------------- files ---------------- */

  exportJson(): void {
    this.canvas.flushTools();
    const name = this.editor.world.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'world';
    downloadText(`${name}-export.json`, exportBundle(this.editor));
    toast('Exported - keep that file safe!');
  }

  importJson(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const wholeWorld = /"metroidvania-world-export"/.test(text.slice(0, 400));
      if (wholeWorld && this.editor.world.rooms.length > 0) {
        const ok = await confirmDialog('Replace the whole world?', 'Importing this file replaces ALL rooms currently in the editor. Nothing changes on the server until you press Save.', 'Replace', true);
        if (!ok) return;
      }
      try {
        this.canvas.flushTools();
        toast(importJson(this.editor, text), 3500);
        this.canvas.fit();
      } catch (err) {
        await infoDialog('Could not import', err instanceof Error ? err.message : String(err));
      }
    };
    input.click();
  }

  help(): void { void helpDialog(); }
}
