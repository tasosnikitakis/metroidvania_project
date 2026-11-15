/**
 * KEYFRAME EDITING  (pure logic, no DOM)
 * --------------------------------------
 * An animation (AnimData, see src/shared/types.ts) is a set of TRACKS. A track
 * is a list of keys - "at this time, this bone's rotation is offset by this
 * much" - and the game smoothly blends between neighbouring keys.
 *
 * IMPORTANT: key values are OFFSETS from the rig's setup (rest) pose:
 *   rotation: degrees ADDED (+ = clockwise on screen)
 *   x / y:    pixels ADDED
 *   scaleX/Y: MULTIPLIED (1 = no change)
 *   slot alpha is the one exception: an absolute 0..1 see-through value.
 *
 * Every function here returns a NEW AnimData / RigData and leaves its input
 * untouched - that is what makes undo trivial (see history.ts).
 * Sampling always goes through src/rig/pose.ts so the editor shows exactly
 * what the game will play.
 */
import type { AnimData, AnimEvent, BoneChannel, EaseName, Keyframe, RigData } from '../../../shared/types';
import { HERO_ANIMS } from '../../../shared/types';
import { CHANNEL_DEFAULTS, sampleTrack } from '../../../rig/pose';

export const BONE_CHANNELS: BoneChannel[] = ['rotation', 'x', 'y', 'scaleX', 'scaleY'];
export type Channel = BoneChannel | 'alpha';

/** Address of one track: a bone channel, or a slot's alpha. */
export interface TrackRef { kind: 'bone' | 'slot'; target: string; channel: Channel }
/** Address of one key: its track plus its time. */
export interface KeyRef extends TrackRef { t: number }

export const FPS = 60;
/** Times are stored to 0.1 ms so two keys are "at the same time" reliably. */
export const roundTime = (t: number): number => Math.round(t * 10000) / 10000;
export const roundValue = (v: number): number => Math.round(v * 1000) / 1000;
export const sameTime = (a: number, b: number): boolean => Math.abs(a - b) < 0.00006;

/** Snap to the nearest 1/60 s frame (or leave free, e.g. while Alt is held). */
export function snapTime(t: number, free = false, fps = FPS): number {
  return roundTime(free ? t : Math.round(t * fps) / fps);
}

export const trackId = (r: TrackRef): string => `${r.kind}:${r.target}:${r.channel}`;
export const keyId = (r: KeyRef): string => `${trackId(r)}@${roundTime(r.t)}`;

/** The neutral value of a channel (what "no key" means). */
export function neutralValue(ref: TrackRef, rig?: RigData): number {
  if (ref.kind === 'slot') return rig?.slots.find((s) => s.name === ref.target)?.alpha ?? 1;
  return CHANNEL_DEFAULTS[ref.channel as BoneChannel];
}

export function getTrack(anim: AnimData, ref: TrackRef): Keyframe[] | undefined {
  if (ref.kind === 'slot') return anim.slots?.[ref.target]?.alpha;
  return anim.bones[ref.target]?.[ref.channel as BoneChannel];
}

/** New animation with one track replaced. An empty/undefined list removes the track. */
export function withTrack(anim: AnimData, ref: TrackRef, keys: Keyframe[] | undefined): AnimData {
  const next: AnimData = { ...anim };
  const empty = !keys || keys.length === 0;
  if (ref.kind === 'slot') {
    const slots = { ...(anim.slots ?? {}) };
    if (empty) delete slots[ref.target]; else slots[ref.target] = { alpha: keys };
    if (Object.keys(slots).length) next.slots = slots; else delete next.slots;
    return next;
  }
  const bones = { ...anim.bones };
  const track = { ...(bones[ref.target] ?? {}) };
  if (empty) delete track[ref.channel as BoneChannel]; else track[ref.channel as BoneChannel] = keys;
  if (Object.keys(track).length) bones[ref.target] = track; else delete bones[ref.target];
  next.bones = bones;
  return next;
}

/** Every track that has at least one key. */
export function listTracks(anim: AnimData): TrackRef[] {
  const out: TrackRef[] = [];
  for (const [bone, tr] of Object.entries(anim.bones)) {
    for (const ch of BONE_CHANNELS) if (tr[ch]?.length) out.push({ kind: 'bone', target: bone, channel: ch });
  }
  for (const [slot, tr] of Object.entries(anim.slots ?? {})) if (tr.alpha?.length) out.push({ kind: 'slot', target: slot, channel: 'alpha' });
  return out;
}

export function findKey(anim: AnimData, ref: KeyRef): Keyframe | undefined {
  return getTrack(anim, ref)?.find((k) => sameTime(k.t, ref.t));
}

/** Sorted, de-duplicated times of every key in the animation (for frame-stepping and onion skins). */
export function keyTimes(anim: AnimData): number[] {
  const set = new Set<number>();
  for (const ref of listTracks(anim)) for (const k of getTrack(anim, ref)!) set.add(roundTime(k.t));
  return [...set].sort((a, b) => a - b);
}

/** The current value of a channel at time t (an offset; uses the game's own sampler). */
export function sampleOffset(anim: AnimData, ref: TrackRef, t: number, rig?: RigData): number {
  return sampleTrack(getTrack(anim, ref), t, anim.duration, anim.loop, neutralValue(ref, rig));
}

const sortKeys = (keys: Keyframe[]): Keyframe[] => keys.sort((a, b) => a.t - b.t);
const makeKey = (t: number, v: number, ease?: EaseName): Keyframe => (ease ? { t, v, ease } : { t, v });

/**
 * Put a key at time t (replacing one already there). When replacing and no
 * ease is given, the old key's ease is kept.
 */
export function setKey(anim: AnimData, ref: TrackRef, t: number, v: number, ease?: EaseName): AnimData {
  const time = roundTime(Math.min(Math.max(t, 0), anim.duration));
  const old = getTrack(anim, ref) ?? [];
  const existing = old.find((k) => sameTime(k.t, time));
  const keys = old.filter((k) => k !== existing);
  keys.push(makeKey(time, roundValue(v), ease ?? existing?.ease));
  return withTrack(anim, ref, sortKeys(keys));
}

export function deleteKeys(anim: AnimData, refs: KeyRef[]): AnimData {
  let next = anim;
  for (const [, group] of groupByTrack(refs)) {
    const keys = (getTrack(next, group[0]) ?? []).filter((k) => !group.some((r) => sameTime(r.t, k.t)));
    next = withTrack(next, group[0], keys);
  }
  return next;
}

function groupByTrack(refs: KeyRef[]): Map<string, KeyRef[]> {
  const map = new Map<string, KeyRef[]>();
  for (const r of refs) { const id = trackId(r); (map.get(id) ?? map.set(id, []).get(id)!).push(r); }
  return map;
}

/**
 * Slide the given keys by `dt` seconds. The whole group stops at the ends of
 * the animation (so keys keep their spacing), and a moved key that lands on
 * a key that was not moved replaces it. Returns the new addresses of the moved keys.
 */
export function moveKeys(anim: AnimData, refs: KeyRef[], dt: number): { anim: AnimData; refs: KeyRef[] } {
  if (refs.length === 0) return { anim, refs };
  let lo = Infinity, hi = -Infinity;
  for (const r of refs) { lo = Math.min(lo, r.t); hi = Math.max(hi, r.t); }
  const shift = Math.min(Math.max(dt, -lo), Math.max(0, anim.duration - hi));
  if (Math.abs(shift) < 1e-9) return { anim, refs };
  let next = anim;
  const moved: KeyRef[] = [];
  for (const [, group] of groupByTrack(refs)) {
    const all = getTrack(next, group[0]) ?? [];
    const picked = all.filter((k) => group.some((r) => sameTime(r.t, k.t)));
    const shifted = picked.map((k) => ({ ...k, t: roundTime(k.t + shift) }));
    const stay = all.filter((k) => !picked.includes(k) && !shifted.some((s) => sameTime(s.t, k.t)));
    next = withTrack(next, group[0], sortKeys([...stay, ...shifted]));
    for (const s of shifted) moved.push({ kind: group[0].kind, target: group[0].target, channel: group[0].channel, t: s.t });
  }
  return { anim: next, refs: moved };
}

/** Change the value and/or ease of several keys at once. `ease: null` resets to the default ease. */
export function setKeyProps(anim: AnimData, refs: KeyRef[], props: { v?: number; ease?: EaseName | null }): AnimData {
  let next = anim;
  for (const [, group] of groupByTrack(refs)) {
    const keys = (getTrack(next, group[0]) ?? []).map((k) => {
      if (!group.some((r) => sameTime(r.t, k.t))) return k;
      const ease = props.ease === undefined ? k.ease : props.ease ?? undefined;
      return makeKey(k.t, props.v === undefined ? k.v : roundValue(props.v), ease);
    });
    next = withTrack(next, group[0], keys);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Copy / paste                                                         */
/* ------------------------------------------------------------------ */

/** Keys on the clipboard, with times measured from the earliest copied key. */
export interface KeyClip { span: number; keys: Array<TrackRef & { dt: number; v: number; ease?: EaseName }> }

export function copyKeys(anim: AnimData, refs: KeyRef[]): KeyClip {
  const found = refs.map((r) => ({ r, k: findKey(anim, r) })).filter((x) => x.k) as Array<{ r: KeyRef; k: Keyframe }>;
  const t0 = Math.min(...found.map((x) => x.k.t));
  const keys = found.map(({ r, k }) => ({ kind: r.kind, target: r.target, channel: r.channel, dt: roundTime(k.t - t0), v: k.v, ...(k.ease ? { ease: k.ease } : {}) }));
  return { span: keys.length ? Math.max(...keys.map((k) => k.dt)) : 0, keys };
}

/**
 * Paste copied keys starting at `at`. Keys that would fall past the end are
 * skipped. With `mirrorTime` the keys go in backwards (last becomes first) -
 * handy for turning "wind up" into "follow through".
 */
export function pasteKeys(anim: AnimData, clip: KeyClip, at: number, mirrorTime = false): { anim: AnimData; refs: KeyRef[] } {
  let next = anim;
  const refs: KeyRef[] = [];
  let keys = clip.keys;
  if (mirrorTime) {
    // Reverse each track in time. An ease belongs to the stretch AFTER a key, so
    // once reversed each key takes the ease of the key that used to come before it.
    const byTrack = new Map<string, typeof clip.keys>();
    for (const k of clip.keys) { const id = trackId(k); (byTrack.get(id) ?? byTrack.set(id, []).get(id)!).push(k); }
    keys = [];
    for (const list of byTrack.values()) {
      const sorted = [...list].sort((a, b) => a.dt - b.dt);
      sorted.forEach((k, i) => {
        const ease = i > 0 ? sorted[i - 1].ease : undefined;
        keys.push({ kind: k.kind, target: k.target, channel: k.channel, dt: roundTime(clip.span - k.dt), v: k.v, ...(ease ? { ease } : {}) });
      });
    }
  }
  for (const k of keys) {
    const t = roundTime(at + k.dt);
    if (t > anim.duration + 0.00006) continue;
    next = setKey(next, k, t, k.v, k.ease);
    if (!k.ease) next = setKeyProps(next, [{ ...k, t }], { ease: null });
    refs.push({ kind: k.kind, target: k.target, channel: k.channel, t: Math.min(t, anim.duration) });
  }
  return { anim: next, refs };
}

/* ------------------------------------------------------------------ */
/* Whole-pose helpers                                                   */
/* ------------------------------------------------------------------ */

/** A snapshot of every animated value at one moment (offsets, like keys). */
export interface PoseClip { values: Array<TrackRef & { v: number }> }

/** Copy the pose at time t: every channel that has a track, sampled at t. */
export function copyPoseAt(anim: AnimData, t: number, rig?: RigData): PoseClip {
  return { values: listTracks(anim).map((ref) => ({ ...ref, v: roundValue(sampleOffset(anim, ref, t, rig)) })) };
}

/** Key the copied pose at time t. Channels without a track are only keyed if the value is not neutral. */
export function pastePoseAt(anim: AnimData, clip: PoseClip, t: number, rig?: RigData): { anim: AnimData; refs: KeyRef[] } {
  let next = anim;
  const refs: KeyRef[] = [];
  for (const val of clip.values) {
    const ref: TrackRef = { kind: val.kind, target: val.target, channel: val.channel };
    if (rig && !trackExistsInRig(rig, ref)) continue;
    if (!getTrack(next, ref) && Math.abs(val.v - neutralValue(ref, rig)) < 1e-6) continue;
    next = setKey(next, ref, t, val.v);
    refs.push({ ...ref, t: roundTime(Math.min(Math.max(t, 0), anim.duration)) });
  }
  return { anim: next, refs };
}

function trackExistsInRig(rig: RigData, ref: TrackRef): boolean {
  return ref.kind === 'bone' ? rig.bones.some((b) => b.name === ref.target) : rig.slots.some((s) => s.name === ref.target);
}

/**
 * "Key all bones here": freeze the current pose into keys at time t.
 * Every existing track gets a key, and every bone gets at least a rotation key.
 */
export function keyAllBones(rig: RigData, anim: AnimData, t: number): { anim: AnimData; refs: KeyRef[] } {
  const want = new Map<string, TrackRef>();
  for (const ref of listTracks(anim)) want.set(trackId(ref), ref);
  for (const b of rig.bones) {
    const ref: TrackRef = { kind: 'bone', target: b.name, channel: 'rotation' };
    if (!want.has(trackId(ref))) want.set(trackId(ref), ref);
  }
  let next = anim;
  const refs: KeyRef[] = [];
  for (const ref of want.values()) {
    next = setKey(next, ref, t, sampleOffset(anim, ref, t, rig));
    refs.push({ ...ref, t: roundTime(t) });
  }
  return { anim: next, refs };
}

/**
 * Loop helper: copy each track's first key (when it sits at time 0) to the very
 * end, so the last frame matches the first and the loop has no visible jump.
 */
export function closeLoop(anim: AnimData): { anim: AnimData; count: number } {
  let next = anim, count = 0;
  for (const ref of listTracks(anim)) {
    const keys = getTrack(anim, ref)!;
    const first = keys[0], last = keys[keys.length - 1];
    if (!sameTime(first.t, 0) || keys.length < 2) continue;
    if (sameTime(last.t, anim.duration) && Math.abs(last.v - first.v) < 1e-9) continue;
    next = setKey(next, ref, anim.duration, first.v);
    count++;
  }
  return { anim: next, count };
}

/** Change the length. `stretch` squeezes/stretches all keys to fit; otherwise keys past the new end are removed. */
export function setDuration(anim: AnimData, duration: number, stretch: boolean): AnimData {
  const d = roundTime(Math.max(duration, 1 / FPS));
  const k = anim.duration > 0 ? d / anim.duration : 1;
  let next: AnimData = { ...anim, duration: d };
  for (const ref of listTracks(anim)) {
    const keys = getTrack(anim, ref)!;
    const out: Keyframe[] = [];
    for (const key of keys) {
      const t = stretch ? roundTime(key.t * k) : key.t;
      if (t > d + 0.00006) continue;
      if (out.length && sameTime(out[out.length - 1].t, t)) out.pop();
      out.push({ ...key, t: Math.min(t, d) });
    }
    next = withTrack(next, ref, out);
  }
  if (anim.events) {
    next.events = anim.events
      .map((e) => ({ ...e, t: stretch ? roundTime(e.t * k) : e.t }))
      .filter((e) => e.t <= d + 0.00006);
    if (next.events.length === 0) delete next.events;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Events (named moments such as "step" or "hit")                       */
/* ------------------------------------------------------------------ */

function withEvents(anim: AnimData, events: AnimEvent[]): AnimData {
  const next: AnimData = { ...anim };
  if (events.length) next.events = events; else delete next.events;
  return next;
}
/** Events sorted by time. The returned index tells you where the new/moved event ended up. */
export function addEvent(anim: AnimData, t: number, name: string): { anim: AnimData; index: number } {
  const ev: AnimEvent = { t: roundTime(Math.min(Math.max(t, 0), anim.duration)), name: name.trim() || 'event' };
  const events = [...(anim.events ?? []), ev].sort((a, b) => a.t - b.t);
  return { anim: withEvents(anim, events), index: events.indexOf(ev) };
}
export function updateEvent(anim: AnimData, index: number, patch: Partial<AnimEvent>): { anim: AnimData; index: number } {
  const old = anim.events?.[index];
  if (!old) return { anim, index };
  const ev: AnimEvent = { t: roundTime(Math.min(Math.max(patch.t ?? old.t, 0), anim.duration)), name: (patch.name ?? old.name).trim() || old.name };
  const events = (anim.events ?? []).map((e, i) => (i === index ? ev : e)).sort((a, b) => a.t - b.t);
  return { anim: withEvents(anim, events), index: events.indexOf(ev) };
}
export function deleteEvent(anim: AnimData, index: number): AnimData {
  return withEvents(anim, (anim.events ?? []).filter((_, i) => i !== index));
}

/* ------------------------------------------------------------------ */
/* Animation management                                                 */
/* ------------------------------------------------------------------ */

/** The game looks these up by name, so they must not be renamed or deleted. */
export const isProtectedAnim = (name: string): boolean => (HERO_ANIMS as readonly string[]).includes(name);

/** Returns an error message, or null when the name is fine. */
export function checkAnimName(rig: RigData, name: string, ignore?: string): string | null {
  const n = name.trim();
  if (!n) return 'Please type a name.';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(n)) return 'Use letters and numbers only, starting with a letter (no spaces).';
  if (n !== ignore && rig.animations[n]) return `There is already an animation called "${n}".`;
  return null;
}

export function blankAnimation(duration = 0.5, loop = true): AnimData {
  return { duration, loop, bones: {} };
}

export function cloneAnimation(anim: AnimData): AnimData {
  return JSON.parse(JSON.stringify(anim)) as AnimData;
}

export function withAnimation(rig: RigData, name: string, anim: AnimData): RigData {
  return { ...rig, animations: { ...rig.animations, [name]: anim } };
}

export function deleteAnimation(rig: RigData, name: string): RigData {
  if (isProtectedAnim(name)) throw new Error(`"${name}" is used by the game and cannot be deleted.`);
  const animations = { ...rig.animations };
  delete animations[name];
  const pairs: Record<string, number> = {};
  for (const [k, v] of Object.entries(rig.mix.pairs ?? {})) if (!k.split('>').includes(name)) pairs[k] = v;
  return { ...rig, animations, mix: { default: rig.mix.default, pairs } };
}

/** Rename, keeping list order and carrying the cross-fade pairs across. */
export function renameAnimation(rig: RigData, from: string, to: string): RigData {
  if (isProtectedAnim(from)) throw new Error(`"${from}" is used by the game and cannot be renamed.`);
  const err = checkAnimName(rig, to, from);
  if (err) throw new Error(err);
  const animations: Record<string, AnimData> = {};
  for (const [k, v] of Object.entries(rig.animations)) animations[k === from ? to : k] = v;
  const pairs: Record<string, number> = {};
  for (const [k, v] of Object.entries(rig.mix.pairs ?? {})) {
    pairs[k.split('>').map((n) => (n === from ? to : n)).join('>')] = v;
  }
  return { ...rig, animations, mix: { default: rig.mix.default, pairs } };
}

/** A free name such as "run2", "run3"... */
export function uniqueAnimName(rig: RigData, base: string): string {
  const stem = base.replace(/\d+$/, '') || 'anim';
  if (!rig.animations[base]) return base;
  for (let i = 2; ; i++) if (!rig.animations[`${stem}${i}`]) return `${stem}${i}`;
}

/* ------------------------------------------------------------------ */
/* Cross-fade ("mix") times                                             */
/* ------------------------------------------------------------------ */

export function setMixDefault(rig: RigData, seconds: number): RigData {
  return { ...rig, mix: { ...rig.mix, default: roundValue(Math.max(0, seconds)) } };
}
/** `seconds: null` removes the special case so the pair uses the default again. */
export function setMixPair(rig: RigData, from: string, to: string, seconds: number | null): RigData {
  const pairs = { ...(rig.mix.pairs ?? {}) };
  if (seconds === null) delete pairs[`${from}>${to}`]; else pairs[`${from}>${to}`] = roundValue(Math.max(0, seconds));
  return { ...rig, mix: { default: rig.mix.default, pairs } };
}

/** Total number of keys (shown in the animation list). */
export function countKeys(anim: AnimData): number {
  let n = 0;
  for (const ref of listTracks(anim)) n += getTrack(anim, ref)!.length;
  return n;
}
