/**
 * UNDO / REDO (pure logic, no DOM)
 * --------------------------------
 * Two small pieces:
 *
 * 1. `History` - a list of commands. Each command knows how to undo and redo
 *    itself. Ctrl+Z walks backwards through the list, Ctrl+Y forwards.
 *
 * 2. `TilePatch` / `PatchBuilder` - a compact record of a brush stroke: only
 *    the cells that actually changed, with their old and new tile ids. A
 *    stroke over 50 tiles stores ~150 numbers, never a copy of the layer.
 */

export interface Command {
  /** Shown in tooltips: "Undo Paint terrain". */
  label: string;
  undo(): void;
  redo(): void;
  /**
   * Commands with the same mergeKey made shortly after each other are folded
   * into one undo step (e.g. dragging a slider). `merge` must absorb `newer`.
   */
  mergeKey?: string;
  merge?(newer: Command): boolean;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private lastPushTime = 0;
  /** False right after undo/redo/breakMerge: the next push always starts a new step. */
  private mergeOpen = false;

  constructor(
    /** Oldest steps are forgotten beyond this many. */
    public limit = 500,
    /** Milliseconds within which same-key commands merge. */
    public mergeWindow = 1200,
    private now: () => number = () => Date.now(),
  ) {}

  /** Record a command that has ALREADY been applied. */
  push(cmd: Command): void {
    const top = this.undoStack[this.undoStack.length - 1];
    const t = this.now();
    const canMerge =
      top !== undefined && cmd.mergeKey !== undefined && top.mergeKey === cmd.mergeKey &&
      this.mergeOpen && this.redoStack.length === 0 && t - this.lastPushTime <= this.mergeWindow && top.merge !== undefined;
    this.lastPushTime = t;
    this.mergeOpen = true;
    this.redoStack.length = 0;
    if (canMerge && top!.merge!(cmd)) return;
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
  }

  undo(): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    this.mergeOpen = false; // never merge into a command after undoing
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.redo();
    this.undoStack.push(cmd);
    this.mergeOpen = false;
    return cmd;
  }

  /** Stop the next push from merging with the previous one (call when a drag ends). */
  breakMerge(): void { this.mergeOpen = false; }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }
  get size(): number { return this.undoStack.length; }
}

/* ------------------------------------------------------------------ */
/* Tile patches                                                         */
/* ------------------------------------------------------------------ */

/** The changed cells of one layer: parallel arrays of index / old id / new id. */
export interface TilePatch {
  idx: number[];
  before: number[];
  after: number[];
}

/**
 * Wraps a layer array while a stroke is in progress. Call `set` as often as
 * you like; the builder remembers the ORIGINAL value of each touched cell.
 */
export class PatchBuilder {
  private original = new Map<number, number>();

  constructor(private layer: number[], private onChange?: (index: number) => void) {}

  get(index: number): number { return this.layer[index]; }

  set(index: number, id: number): void {
    const cur = this.layer[index];
    if (cur === id) return;
    if (!this.original.has(index)) this.original.set(index, cur);
    this.layer[index] = id;
    this.onChange?.(index);
  }

  /** True if any cell currently differs from its original value. */
  get changed(): boolean {
    for (const [i, before] of this.original) if (this.layer[i] !== before) return true;
    return false;
  }

  /** Finish the stroke. Cells that ended up back at their old value are dropped. */
  finish(): TilePatch {
    const idx = [...this.original.keys()].filter((i) => this.layer[i] !== this.original.get(i)).sort((a, b) => a - b);
    return { idx, before: idx.map((i) => this.original.get(i)!), after: idx.map((i) => this.layer[i]) };
  }

  /** Abandon the stroke: put every touched cell back. */
  revert(): void {
    for (const [i, before] of this.original) {
      if (this.layer[i] !== before) {
        this.layer[i] = before;
        this.onChange?.(i);
      }
    }
    this.original.clear();
  }
}

export function applyPatch(layer: number[], patch: TilePatch, direction: 'undo' | 'redo'): void {
  const values = direction === 'undo' ? patch.before : patch.after;
  for (let k = 0; k < patch.idx.length; k++) layer[patch.idx[k]] = values[k];
}
