/**
 * UNDO / REDO  (pure logic, no DOM)
 * ---------------------------------
 * The Game Editor uses the simplest possible kind of undo: every edit makes a
 * brand-new copy of the thing being edited (settings, or the hero's
 * animations) and we keep the old copies in a list. Undo = step back to the
 * previous copy. Nothing is ever changed in place, so undo can never get
 * confused.
 *
 * Dragging a slider makes hundreds of tiny edits; they are folded into ONE
 * undo step by giving them the same `mergeKey`. Call `seal()` when the drag
 * ends so the next drag starts a new step.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  /** The copy that is currently saved on disk (for the "unsaved changes" dot). */
  private savedState: T;

  constructor(private current: T, public limit = 300) {
    this.savedState = current;
  }

  get present(): T { return this.current; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get saved(): T { return this.savedState; }
  /** True when the present copy is not the one on disk. */
  get dirty(): boolean { return this.current !== this.savedState; }

  /** Record a new state. Same non-null `mergeKey` as the previous call = same undo step. */
  set(next: T, mergeKey: string | null = null): void {
    if (next === this.current) return;
    const merge = mergeKey !== null && mergeKey === this.lastKey && this.past.length > 0;
    if (!merge) {
      this.past.push(this.current);
      if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    }
    this.current = next;
    this.future.length = 0;
    this.lastKey = mergeKey;
  }

  /** End the current merge group (pointer released, field blurred...). */
  seal(): void { this.lastKey = null; }

  undo(): T | null {
    if (this.past.length === 0) return null;
    this.future.push(this.current);
    this.current = this.past.pop() as T;
    this.lastKey = null;
    return this.current;
  }

  redo(): T | null {
    if (this.future.length === 0) return null;
    this.past.push(this.current);
    this.current = this.future.pop() as T;
    this.lastKey = null;
    return this.current;
  }

  /** Call after a successful save. */
  markSaved(state: T = this.current): void { this.savedState = state; this.lastKey = null; }

  /** Start again from a freshly loaded document (forgets all undo steps). */
  reset(state: T, saved: T = state): void {
    this.past.length = 0; this.future.length = 0;
    this.current = state; this.savedState = saved; this.lastKey = null;
  }
}
