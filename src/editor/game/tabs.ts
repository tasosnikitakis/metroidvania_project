/**
 * What the two tabs ("Game Feel" and "Animation") have in common, so the
 * top bar can offer one Undo / Redo / Save for whichever tab is showing.
 */
import type { GameConfig } from '../../shared/types';
import type { GameLink } from './bridge';

export interface EditorTab {
  id: string;
  label: string;
  el: HTMLElement;
  /** True when there are changes that are not saved to the game files yet. */
  isDirty(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  /** Write to the server. Resolves true on success. */
  save(): Promise<boolean>;
  show(): void;
  hide(): void;
  /** Keyboard shortcut handling; return true if the key was used. */
  handleKey(e: KeyboardEvent): boolean;
}

/** Things the tabs need from the page around them. */
export interface Shell {
  /** False on a read-only server (no password yet): saving is replaced by export. */
  isWritable(): boolean;
  /** Something changed - update the top bar (dirty dots, undo/redo buttons). */
  refresh(): void;
  link: GameLink;
  /** Save every tab that has unsaved changes (same as the Save button / Ctrl+S). */
  saveAll(): void;
  /** The settings as they are right now in the Game Feel tab (for the hero's collision box overlay). */
  currentConfig(): GameConfig;
}
