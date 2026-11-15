/**
 * ANIMATION TAB - THE DATA BEHIND THE SCREEN
 * ------------------------------------------
 * One object that every part of the Animation tab (stage, timeline, side
 * panels) reads from and reports to. It holds:
 *   - the rig being edited, wrapped in an undo history
 *   - which animation is open, where the playhead is, what is selected
 * and it tells listeners what kind of thing changed so they redraw only what
 * they need to.
 */
import type { AnimData, RigData } from '../../../shared/types';
import { History } from '../logic/history';
import {
  copyKeys, deleteKeys, findKey, getTrack, keyId, keyTimes, pasteKeys, roundTime, sameTime, setKey, snapTime, withAnimation,
  BONE_CHANNELS, type KeyClip, type KeyRef, type PoseClip, type TrackRef,
} from '../logic/keyframes';

/** doc = the rig data changed; selection = bone/keys/animation picked; time = playhead moved; view = display options. */
export type ChangeKind = 'doc' | 'selection' | 'time' | 'view';
export type Tool = 'rotate' | 'move' | 'scale';

export class AnimModel {
  history: History<RigData>;
  animName: string;
  /** Playhead, seconds from the start of the open animation. */
  time = 0;
  playing = false;
  /** Preview option: keep repeating even if the animation is not a looping one. */
  loopPreview = true;
  speed = 1;
  tool: Tool = 'rotate';
  selectedBone: string | null = null;
  selectedKeys: KeyRef[] = [];
  /** Index into anim.events, or null. */
  selectedEvent: number | null = null;
  /** Bones whose channel rows are open in the timeline. */
  expanded = new Set<string>();
  keyClip: KeyClip | null = null;
  poseClip: PoseClip | null = null;
  private listeners: Array<(kind: ChangeKind) => void> = [];

  constructor(rig: RigData) {
    this.history = new History<RigData>(rig);
    this.animName = rig.animations.idle ? 'idle' : Object.keys(rig.animations)[0] ?? '';
  }

  get rig(): RigData { return this.history.present; }
  get anim(): AnimData | undefined { return this.rig.animations[this.animName]; }
  get duration(): number { return this.anim?.duration ?? 0; }

  onChange(cb: (kind: ChangeKind) => void): void { this.listeners.push(cb); }
  emit(kind: ChangeKind): void { for (const cb of this.listeners) cb(kind); }

  /* ---------------- editing (all go through the undo history) ---------------- */

  /** Replace the whole rig (animation list changes, mix times...). */
  setRig(rig: RigData, mergeKey: string | null = null): void {
    this.history.set(rig, mergeKey);
    this.afterDocChange();
  }

  /** Replace the open animation. Same mergeKey = same undo step (used while dragging). */
  setAnim(anim: AnimData, mergeKey: string | null = null): void {
    if (!this.anim || anim === this.anim) return;
    this.history.set(withAnimation(this.rig, this.animName, anim), mergeKey);
    this.afterDocChange();
  }

  /** Finish a drag: the next edit starts a new undo step. */
  seal(): void { this.history.seal(); }

  undo(): boolean { if (!this.history.undo()) return false; this.afterDocChange(); return true; }
  redo(): boolean { if (!this.history.redo()) return false; this.afterDocChange(); return true; }

  /** Make sure selection / playhead still point at things that exist. */
  private afterDocChange(): void {
    if (!this.rig.animations[this.animName]) this.animName = Object.keys(this.rig.animations)[0] ?? '';
    const anim = this.anim;
    this.selectedKeys = anim ? this.selectedKeys.filter((r) => findKey(anim, r)) : [];
    if (this.selectedEvent !== null && !(anim?.events?.[this.selectedEvent])) this.selectedEvent = null;
    if (this.time > this.duration) this.time = this.duration;
    this.emit('doc');
  }

  /* ---------------- selection & playhead ---------------- */

  openAnimation(name: string): void {
    if (!this.rig.animations[name] || name === this.animName) return;
    this.animName = name;
    this.time = 0;
    this.selectedKeys = [];
    this.selectedEvent = null;
    this.emit('selection');
  }

  selectBone(name: string | null): void {
    if (name === this.selectedBone) return;
    this.selectedBone = name;
    this.emit('selection');
  }

  selectKeys(keys: KeyRef[], bone?: string | null): void {
    const seen = new Set<string>();
    this.selectedKeys = keys.filter((k) => { const id = keyId(k); if (seen.has(id)) return false; seen.add(id); return true; });
    this.selectedEvent = null;
    if (bone !== undefined) this.selectedBone = bone;
    this.emit('selection');
  }

  isKeySelected(ref: KeyRef): boolean {
    return this.selectedKeys.some((k) => k.kind === ref.kind && k.target === ref.target && k.channel === ref.channel && sameTime(k.t, ref.t));
  }

  selectEvent(index: number | null): void {
    this.selectedEvent = index;
    if (index !== null) this.selectedKeys = [];
    this.emit('selection');
  }

  setTime(t: number): void {
    const clamped = Math.min(Math.max(t, 0), this.duration);
    if (clamped === this.time) return;
    this.time = clamped;
    this.emit('time');
  }

  /** Move the playhead by whole frames (1/60 s). */
  stepFrames(n: number): void {
    this.playing = false;
    this.setTime(snapTime(this.time + n / 60));
    this.emit('view');
  }

  /** Jump to the previous / next time that has any key. */
  stepKey(dir: 1 | -1): void {
    if (!this.anim) return;
    const times = keyTimes(this.anim);
    const next = dir > 0 ? times.find((t) => t > this.time + 0.0001) : [...times].reverse().find((t) => t < this.time - 0.0001);
    this.playing = false;
    if (next !== undefined) this.setTime(next);
    this.emit('view');
  }

  /* ---------------- key helpers used by several panels ---------------- */

  /** All keys a bone has at time t (what one diamond on a bone's summary row stands for). */
  boneKeysAt(bone: string, t: number): KeyRef[] {
    const anim = this.anim;
    if (!anim) return [];
    const out: KeyRef[] = [];
    for (const channel of BONE_CHANNELS) {
      const ref: TrackRef = { kind: 'bone', target: bone, channel };
      const k = getTrack(anim, ref)?.find((key) => sameTime(key.t, t));
      if (k) out.push({ ...ref, t: k.t });
    }
    return out;
  }

  /** Set a key at the playhead. */
  keyAtPlayhead(ref: TrackRef, value: number, mergeKey: string | null = null): void {
    if (!this.anim) return;
    const t = roundTime(this.time);
    this.setAnim(setKey(this.anim, ref, t, value), mergeKey);
  }

  deleteSelectedKeys(): number {
    if (!this.anim || this.selectedKeys.length === 0) return 0;
    const n = this.selectedKeys.length;
    const keys = this.selectedKeys;
    this.selectedKeys = [];
    this.setAnim(deleteKeys(this.anim, keys));
    return n;
  }

  copySelectedKeys(): number {
    if (!this.anim || this.selectedKeys.length === 0) return 0;
    this.keyClip = copyKeys(this.anim, this.selectedKeys);
    return this.keyClip.keys.length;
  }

  /** Paste the copied keys at the playhead. Returns how many were pasted. */
  pasteKeysAtPlayhead(mirrorTime = false): number {
    if (!this.anim || !this.keyClip) return 0;
    const res = pasteKeys(this.anim, this.keyClip, roundTime(this.time), mirrorTime);
    this.selectedKeys = res.refs;
    this.selectedEvent = null;
    this.setAnim(res.anim);
    this.emit('selection');
    return res.refs.length;
  }
}
