/**
 * ANIMATION TAB - THE SIDE PANEL
 * ------------------------------
 * Number boxes for whatever is selected (a bone, some keys, an event), the
 * open animation's length / loop setting, the cross-fade ("mix") times and the
 * "play sequence" tester.
 *
 * Every box edits the same data as dragging on the stage or timeline does, and
 * goes through the same undo history.
 */
import type { BoneChannel, EaseName } from '../../../shared/types';
import { EASE_NAMES, EASINGS, DEFAULT_EASE, mixDuration } from '../../../rig/pose';
import {
  BONE_CHANNELS, closeLoop, countKeys, deleteEvent, deleteKeys, findKey, moveKeys, roundTime, sampleOffset, setDuration,
  setKeyProps, setMixDefault, setMixPair, updateEvent, withAnimation, type TrackRef,
} from '../logic/keyframes';
import type { SequenceStep } from '../logic/posePlayer';
import { toast } from '../../common/nav';
import { button, clear, fitCanvas, h } from '../ui/dom';
import type { AnimModel } from './model';

export interface InspectorHost {
  startSequence(steps: SequenceStep[], repeat: boolean): void;
  stopSequence(): void;
  /** Index of the step now playing, or -1 when the tester is stopped. */
  sequenceIndex(): number;
  exportAnimation(): void;
}

const CHANNEL_UI: Record<BoneChannel, { label: string; unit: string; step: number; help: string }> = {
  rotation: { label: 'Rotation', unit: '°', step: 1, help: 'Degrees added to the rest pose. + turns clockwise on screen.' },
  x: { label: 'Move x', unit: 'px', step: 0.5, help: 'Pixels added along the parent bone\'s x direction.' },
  y: { label: 'Move y', unit: 'px', step: 0.5, help: 'Pixels added along the parent bone\'s y direction.' },
  scaleX: { label: 'Scale x', unit: '×', step: 0.05, help: 'Stretch along the bone. 1 = normal size.' },
  scaleY: { label: 'Scale y', unit: '×', step: 0.05, help: 'Stretch across the bone. 1 = normal size.' },
};

const show = (v: number, digits = 3): string => String(Number(v.toFixed(digits)));

/** Put a value in a box unless the user is typing in it right now. */
function setIdle(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

export class Inspector {
  readonly el: HTMLElement;
  private boneTitle = h('div', { class: 'insp-title' });
  private boneSetup = h('div', { class: 'insp-readonly muted' });
  private boneBody = h('div', { class: 'insp-grid' });
  private channelInputs = new Map<BoneChannel, { input: HTMLInputElement; key: HTMLButtonElement }>();
  private slotHolder = h('div', { class: 'insp-slots' });
  private slotInputs: Array<{ slot: string; input: HTMLInputElement; key: HTMLButtonElement }> = [];
  private slotsFor: string | null = '';

  private keyTitle = h('div', { class: 'insp-title' });
  private keyTime!: HTMLInputElement;
  private keyValue!: HTMLInputElement;
  private keyEase!: HTMLSelectElement;
  private easeCanvas = h('canvas', { class: 'ease-preview', title: 'How the value travels from this key to the next' });
  private keyFields = h('div', { class: 'insp-grid' });
  private eventFields = h('div', { class: 'insp-grid' });
  private eventName!: HTMLInputElement;
  private eventTime!: HTMLInputElement;

  private durInput!: HTMLInputElement;
  private durFrames = h('span', { class: 'muted' });
  private stretchCheck!: HTMLInputElement;
  private loopCheck!: HTMLInputElement;
  private animInfo = h('div', { class: 'muted insp-note' });

  private mixDefault!: HTMLInputElement;
  private mixTable = h('div', { class: 'mix-table' });
  private mixSignature = '';
  private mixInputs: Array<{ from: string; to: string; input: HTMLInputElement }> = [];

  private seqSteps: string[] = [];
  private seqChips = h('div', { class: 'seq-chips' });
  private seqAdd!: HTMLSelectElement;
  private seqHold!: HTMLInputElement;
  private seqRepeat!: HTMLInputElement;
  private seqPlay!: HTMLButtonElement;
  private seqInfo = h('div', { class: 'muted insp-note' });
  private seqShownIndex = -2;

  constructor(private model: AnimModel, private host: InspectorHost) {
    this.seqSteps = ['run', 'jump', 'fall', 'land', 'idle'].filter((n) => model.rig.animations[n]);
    this.el = h('aside', { class: 'anim-right' },
      this.section('Selected bone', true, this.buildBone()),
      this.section('Selected key', true, this.buildKey()),
      this.section('This animation', true, this.buildAnim()),
      this.section('Blending between animations', false, this.buildMix()),
      this.section('Play a sequence', true, this.buildSequence()));
    this.sync();
  }

  private section(title: string, open: boolean, body: HTMLElement): HTMLElement {
    return h('details', { class: 'panel insp-section', open }, h('summary', null, title), body);
  }

  /** A number box that edits live while typing (one undo step per visit to the box). */
  private num(step: number, title: string, onValue: (v: number) => void, min?: number): HTMLInputElement {
    const input = h('input', { type: 'number', step, title, min, class: 'insp-num' });
    input.addEventListener('input', () => { if (input.value !== '' && Number.isFinite(Number(input.value))) onValue(Number(input.value)); });
    const done = () => { this.model.seal(); this.sync(); };
    input.addEventListener('change', done);
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return input;
  }

  /* ---------------- selected bone ---------------- */

  private buildBone(): HTMLElement {
    for (const channel of BONE_CHANNELS) {
      const ui = CHANNEL_UI[channel];
      const ref = (): TrackRef | null => (this.model.selectedBone ? { kind: 'bone', target: this.model.selectedBone, channel } : null);
      const input = this.num(ui.step, ui.help, (v) => { const r = ref(); if (r) this.model.keyAtPlayhead(r, v, `insp-${channel}`); });
      const key = button('◇', 'Add or remove a key here for this channel', () => { const r = ref(); if (r) this.toggleKey(r); }, 'mini keydot');
      this.channelInputs.set(channel, { input, key });
      this.boneBody.append(h('label', { title: ui.help }, ui.label), input, h('span', { class: 'muted' }, ui.unit), key);
    }
    return h('div', null, this.boneTitle, this.boneSetup,
      h('div', { class: 'insp-sub muted' }, 'Change from the rest pose, at the playhead:'),
      this.boneBody, this.slotHolder);
  }

  /** Key exists at the playhead -> remove it; otherwise add one holding the current value. */
  private toggleKey(ref: TrackRef): void {
    const { model } = this;
    const anim = model.anim;
    if (!anim) return;
    const t = roundTime(model.time);
    if (findKey(anim, { ...ref, t })) model.setAnim(deleteKeys(anim, [{ ...ref, t }]));
    else model.keyAtPlayhead(ref, sampleOffset(anim, ref, t, model.rig));
  }

  private syncBone(): void {
    const { model } = this;
    const anim = model.anim;
    const bone = model.rig.bones.find((b) => b.name === model.selectedBone);
    this.boneBody.classList.toggle('disabled', !bone || !anim);
    if (!bone || !anim) {
      this.boneTitle.textContent = 'Nothing selected';
      this.boneSetup.textContent = 'Click a body part on the stage, or a name in the Bones list.';
      for (const { input, key } of this.channelInputs.values()) { input.disabled = true; key.disabled = true; setIdle(input, ''); }
      clear(this.slotHolder); this.slotInputs = []; this.slotsFor = null;
      return;
    }
    this.boneTitle.textContent = `🦴 ${bone.name}${bone.parent ? `  (child of ${bone.parent})` : ''}`;
    this.boneSetup.textContent = `Rest pose (read-only): x ${bone.x}, y ${bone.y}, rotation ${bone.rotation}°, scale ${bone.scaleX}×${bone.scaleY}${bone.length !== undefined ? `, length ${bone.length}` : ''}`;
    const t = roundTime(model.time);
    for (const [channel, { input, key }] of this.channelInputs) {
      const ref: TrackRef = { kind: 'bone', target: bone.name, channel };
      input.disabled = false; key.disabled = false;
      setIdle(input, show(sampleOffset(anim, ref, t, model.rig)));
      const has = !!findKey(anim, { ...ref, t });
      key.textContent = has ? '◆' : '◇';
      key.classList.toggle('on', has);
      key.title = has ? 'There is a key here. Click to remove it.' : 'No key here. Click to add one.';
    }
    // slots (images) attached to this bone: see-through value can be keyed
    if (this.slotsFor !== bone.name) {
      this.slotsFor = bone.name;
      clear(this.slotHolder); this.slotInputs = [];
      const slots = model.rig.slots.filter((s) => s.bone === bone.name);
      if (slots.length) this.slotHolder.append(h('div', { class: 'insp-sub muted' }, 'Pictures on this bone (0 = invisible, 1 = solid):'));
      const grid = h('div', { class: 'insp-grid' });
      for (const s of slots) {
        const ref: TrackRef = { kind: 'slot', target: s.name, channel: 'alpha' };
        const input = this.num(0.05, `See-through value of "${s.name}" (${s.image}). Setup value: ${s.alpha ?? 1}`, (v) => model.keyAtPlayhead(ref, Math.min(1, Math.max(0, v)), `insp-slot-${s.name}`), 0);
        input.max = '1';
        const key = button('◇', 'Add or remove a key here', () => this.toggleKey(ref), 'mini keydot');
        this.slotInputs.push({ slot: s.name, input, key });
        grid.append(h('label', { title: s.image }, s.name), input, h('span', { class: 'muted' }, 'α'), key);
      }
      if (slots.length) this.slotHolder.append(grid);
    }
    for (const { slot, input, key } of this.slotInputs) {
      const ref: TrackRef = { kind: 'slot', target: slot, channel: 'alpha' };
      setIdle(input, show(sampleOffset(anim, ref, t, model.rig)));
      const has = !!findKey(anim, { ...ref, t });
      key.textContent = has ? '◆' : '◇';
      key.classList.toggle('on', has);
    }
  }

  /* ---------------- selected key(s) / event ---------------- */

  private buildKey(): HTMLElement {
    const { model } = this;
    this.keyTime = this.num(1 / 60, 'When this key happens (seconds). Keys selected at different times cannot be typed here - drag them on the timeline.', (v) => {
      const anim = model.anim;
      if (!anim || model.selectedKeys.length === 0) return;
      const res = moveKeys(anim, model.selectedKeys, v - model.selectedKeys[0].t);
      model.selectedKeys = res.refs;
      model.setAnim(res.anim, 'insp-key-time');
    }, 0);
    this.keyValue = this.num(0.5, 'The key\'s value (an offset from the rest pose).', (v) => {
      if (model.anim) model.setAnim(setKeyProps(model.anim, model.selectedKeys, { v }), 'insp-key-value');
    });
    this.keyEase = h('select', { title: 'How the movement travels from this key to the next one', onchange: () => {
      const v = this.keyEase.value;
      if (!model.anim || v === '') return;
      model.setAnim(setKeyProps(model.anim, model.selectedKeys, { ease: v === DEFAULT_EASE ? null : (v as EaseName) }));
    } },
      h('option', { value: '', hidden: true }, '(mixed)'),
      ...EASE_NAMES.map((n) => h('option', { value: n }, n === DEFAULT_EASE ? `${n} (normal)` : n)));
    this.keyFields.append(
      h('label', null, 'Time'), this.keyTime, h('span', { class: 'muted' }, 's'), h('span'),
      h('label', null, 'Value'), this.keyValue, h('span'), h('span'),
      h('label', null, 'Ease'), this.keyEase, h('span'), h('span'));
    this.keyFields.classList.add('wide-second');

    this.eventName = h('input', { type: 'text', class: 'insp-text', title: 'Event name the game listens for', spellcheck: false });
    this.eventName.addEventListener('change', () => {
      if (model.anim && model.selectedEvent !== null && this.eventName.value.trim()) model.setAnim(updateEvent(model.anim, model.selectedEvent, { name: this.eventName.value }).anim);
    });
    this.eventName.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.eventName.blur(); });
    this.eventTime = this.num(1 / 60, 'When the event fires (seconds)', (v) => {
      if (!model.anim || model.selectedEvent === null) return;
      const res = updateEvent(model.anim, model.selectedEvent, { t: v });
      model.selectedEvent = res.index;
      model.setAnim(res.anim, 'insp-event-time');
    }, 0);
    this.eventFields.append(
      h('label', null, 'Name'), this.eventName, h('span'), h('span'),
      h('label', null, 'Time'), this.eventTime, h('span', { class: 'muted' }, 's'),
      button('🗑', 'Delete this event', () => { if (model.anim && model.selectedEvent !== null) { const i = model.selectedEvent; model.selectedEvent = null; model.setAnim(deleteEvent(model.anim, i)); } }, 'mini'));
    this.eventFields.classList.add('wide-second');
    return h('div', null, this.keyTitle, this.keyFields, this.easeCanvas, this.eventFields);
  }

  private syncKey(): void {
    const { model } = this;
    const anim = model.anim;
    const keys = anim ? model.selectedKeys.map((r) => ({ r, k: findKey(anim, r) })).filter((x) => x.k) : [];
    const ev = model.selectedEvent !== null ? anim?.events?.[model.selectedEvent] : undefined;
    this.eventFields.hidden = !ev;
    this.keyFields.hidden = keys.length === 0;
    this.easeCanvas.hidden = keys.length === 0;
    if (ev) {
      this.keyTitle.textContent = '⚑ Event';
      setIdle(this.eventName, ev.name);
      setIdle(this.eventTime, show(ev.t, 4));
      return;
    }
    if (keys.length === 0) {
      this.keyTitle.textContent = 'No key selected';
      this.keyTitle.title = 'Click a diamond on the timeline.';
      return;
    }
    const first = keys[0];
    const sameT = keys.every((x) => Math.abs(x.k!.t - first.k!.t) < 0.0001);
    const sameV = keys.every((x) => x.k!.v === first.k!.v);
    const eases = new Set(keys.map((x) => x.k!.ease ?? DEFAULT_EASE));
    this.keyTitle.textContent = keys.length === 1
      ? `◆ ${first.r.target} · ${first.r.channel === 'alpha' ? 'see-through' : first.r.channel}`
      : `◆ ${keys.length} keys selected`;
    this.keyTime.disabled = !sameT;
    setIdle(this.keyTime, sameT ? show(first.k!.t, 4) : '');
    this.keyTime.placeholder = sameT ? '' : 'mixed';
    setIdle(this.keyValue, sameV ? show(first.k!.v) : '');
    this.keyValue.placeholder = sameV ? '' : 'mixed';
    const ease = eases.size === 1 ? [...eases][0] : '';
    setIdle(this.keyEase, ease);
    this.drawEase(ease === '' ? null : (ease as EaseName));
  }

  private drawEase(name: EaseName | null): void {
    const c = this.easeCanvas;
    const w = c.clientWidth || 200, hh = 64;
    const ctx = fitCanvas(c, w, hh);
    ctx.clearRect(0, 0, w, hh);
    ctx.fillStyle = '#100e17';
    ctx.fillRect(0, 0, w, hh);
    const x0 = 10, x1 = w - 10, y0 = hh - 14, y1 = 18; // room above for overshoot (backOut / elasticOut)
    ctx.strokeStyle = '#353048';
    ctx.strokeRect(x0 + 0.5, y1 + 0.5, x1 - x0, y0 - y1);
    if (!name) return;
    ctx.strokeStyle = '#b58cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * EASINGS[name](t);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#9a93b5';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('this key', x0, hh - 3);
    ctx.textAlign = 'right';
    ctx.fillText('next key', x1, hh - 3);
    ctx.textAlign = 'left';
  }

  /* ---------------- this animation ---------------- */

  private buildAnim(): HTMLElement {
    const { model } = this;
    this.stretchCheck = h('input', { type: 'checkbox', id: 'insp-stretch', checked: true });
    this.durInput = this.num(0.05, 'How long the animation lasts, in seconds', (v) => {
      if (model.anim && v > 0) model.setAnim(setDuration(model.anim, v, this.stretchCheck.checked), 'insp-duration');
    }, 0.02);
    this.loopCheck = h('input', { type: 'checkbox', id: 'insp-loop', class: 'switch', onchange: () => {
      if (model.anim) model.setAnim({ ...model.anim, loop: this.loopCheck.checked });
    } });
    return h('div', null,
      h('div', { class: 'insp-grid' },
        h('label', { for: 'insp-dur' }, 'Length'), this.durInput, h('span', { class: 'muted' }, 's'), h('span'),
        h('label', { for: 'insp-loop', title: 'Looping animations (idle, run...) repeat forever. Others (jump, land...) play once and hold.' }, 'Loops'), this.loopCheck, h('span'), h('span')),
      h('label', { class: 'insp-check', title: 'On: changing the length squeezes or stretches all keys to fit. Off: keys stay put and any past the new end are removed.' },
        this.stretchCheck, ' Stretch keys when the length changes'),
      h('div', { class: 'insp-buttons' },
        button('∞ Close the loop', 'Copy each track\'s first key to the very end, so the last frame matches the first (no jump when it repeats)', () => {
          if (!model.anim) return;
          const res = closeLoop(model.anim);
          if (res.count === 0) { toast('The loop is already closed'); return; }
          model.setAnim(res.anim);
          toast(`Added ${res.count} end key${res.count === 1 ? '' : 's'}`);
        }),
        button('⬇ Export animation as JSON', 'Download just this animation as a file', () => this.host.exportAnimation())),
      this.animInfo);
  }

  private syncAnim(): void {
    const anim = this.model.anim;
    if (!anim) return;
    setIdle(this.durInput, show(anim.duration, 4));
    this.loopCheck.checked = anim.loop;
    this.animInfo.textContent = `${Math.round(anim.duration * 60)} frames · ${countKeys(anim)} keys on ${Object.keys(anim.bones).length} bones`;
  }

  /* ---------------- cross-fades ---------------- */

  private buildMix(): HTMLElement {
    const { model } = this;
    this.mixDefault = this.num(0.01, 'Blend time used for any pair without its own number', (v) => model.setRig(setMixDefault(model.rig, v), 'insp-mix-default'), 0);
    return h('div', null,
      h('div', { class: 'insp-note muted' }, 'When the game switches animation it blends from one to the other over this many seconds. Empty box = use the normal time.'),
      h('div', { class: 'insp-grid' }, h('label', { title: 'Blend time used when a pair has no number of its own' }, 'Usual'), this.mixDefault, h('span', { class: 'muted' }, 's'), h('span')),
      this.mixTable);
  }

  private syncMix(): void {
    const { model } = this;
    const cur = model.animName;
    const names = Object.keys(model.rig.animations);
    setIdle(this.mixDefault, show(model.rig.mix.default));
    const signature = `${cur}|${names.join(',')}`;
    if (signature !== this.mixSignature) {
      this.mixSignature = signature;
      clear(this.mixTable);
      this.mixInputs = [];
      this.mixTable.append(h('span', { class: 'muted' }, 'other'), h('span', { class: 'muted', title: `Blend time when switching from the other animation INTO "${cur}"` }, `→ ${cur}`), h('span', { class: 'muted', title: `Blend time when switching from "${cur}" to the other animation` }, `${cur} →`));
      for (const other of names) {
        if (other === cur) continue;
        const make = (from: string, to: string) => {
          const input = h('input', { type: 'number', step: 0.01, min: 0, class: 'insp-num', title: `${from} → ${to}` });
          input.addEventListener('input', () => {
            const v = input.value === '' ? null : Number(input.value);
            if (v !== null && !Number.isFinite(v)) return;
            model.setRig(setMixPair(model.rig, from, to, v), `insp-mix-${from}>${to}`);
          });
          const done = () => model.seal();
          input.addEventListener('change', done); input.addEventListener('blur', done);
          this.mixInputs.push({ from, to, input });
          return input;
        };
        this.mixTable.append(h('span', { class: 'mix-name' }, other), make(other, cur), make(cur, other));
      }
    }
    const pairs = model.rig.mix.pairs ?? {};
    for (const { from, to, input } of this.mixInputs) {
      const v = pairs[`${from}>${to}`];
      setIdle(input, v === undefined ? '' : show(v));
      input.placeholder = show(model.rig.mix.default);
    }
  }

  /* ---------------- sequence tester ---------------- */

  private buildSequence(): HTMLElement {
    this.seqAdd = h('select', { title: 'Animation to add to the end of the sequence' });
    this.seqHold = h('input', { type: 'number', class: 'insp-num', step: 0.1, min: 0.1, value: '0.8', title: 'How long looping animations (run, idle, fall...) play before moving on' });
    this.seqRepeat = h('input', { type: 'checkbox', checked: true });
    this.seqPlay = button('▶ Play sequence', 'Play these animations one after another with the game\'s real blending', () => {
      if (this.host.sequenceIndex() >= 0) this.host.stopSequence();
      else this.host.startSequence(this.sequence(), this.seqRepeat.checked);
    }, 'primary');
    return h('div', null,
      h('div', { class: 'insp-note muted' }, 'Check how animations flow into each other, exactly as in the game.'),
      this.seqChips,
      h('div', { class: 'insp-row' }, this.seqAdd,
        button('+ Add', 'Add to the end of the sequence', () => { if (this.seqAdd.value) { this.seqSteps.push(this.seqAdd.value); this.renderChips(); } }),
        button('Clear', 'Empty the sequence', () => { this.seqSteps = []; this.renderChips(); })),
      h('div', { class: 'insp-row' }, h('label', null, 'Loops play for'), this.seqHold, h('span', { class: 'muted' }, 's'),
        h('label', { class: 'insp-check', title: 'Start again from the first step when the sequence ends' }, this.seqRepeat, ' repeat')),
      h('div', { class: 'insp-buttons' }, this.seqPlay),
      this.seqInfo);
  }

  private sequence(): SequenceStep[] {
    const hold = Math.max(0.1, Number(this.seqHold.value) || 0.8);
    return this.seqSteps.filter((n) => this.model.rig.animations[n]).map((anim) => ({ anim, hold: this.model.rig.animations[anim].loop ? hold : 0 }));
  }

  private renderChips(): void {
    clear(this.seqChips);
    const active = this.host.sequenceIndex();
    const valid = this.seqSteps.filter((n) => this.model.rig.animations[n]);
    valid.forEach((name, i) => {
      if (i > 0) this.seqChips.append(h('span', { class: 'seq-arrow muted', title: `blend ${show(mixDuration(this.model.rig, valid[i - 1], name))} s` }, '→'));
      this.seqChips.append(h('span', { class: `seq-chip${i === active ? ' active' : ''}` }, name,
        button('×', 'Remove this step', () => { this.seqSteps.splice(this.nthIndex(i), 1); this.renderChips(); }, 'chip-x')));
    });
    if (valid.length === 0) this.seqChips.append(h('span', { class: 'muted' }, 'Add some animations below.'));
  }

  /** Position in seqSteps of the i-th step that still exists (they differ only if an animation was deleted). */
  private nthIndex(i: number): number {
    let count = -1;
    for (let k = 0; k < this.seqSteps.length; k++) {
      if (this.model.rig.animations[this.seqSteps[k]]) count++;
      if (count === i) return k;
    }
    return this.seqSteps.length;
  }

  /** Called every frame while the tester runs (cheap: only touches the DOM when the step changes). */
  syncSequence(force = false): void {
    const i = this.host.sequenceIndex();
    if (!force && i === this.seqShownIndex) return;
    this.seqShownIndex = i;
    this.seqPlay.textContent = i >= 0 ? '■ Stop' : '▶ Play sequence';
    this.seqPlay.classList.toggle('danger', i >= 0);
    this.renderChips();
    const steps = this.sequence();
    if (i >= 0 && steps.length > 1) {
      const from = steps[(i - 1 + steps.length) % steps.length].anim, to = steps[i].anim;
      this.seqInfo.textContent = `Now: ${to}  (blend from ${from}: ${show(mixDuration(this.model.rig, from, to))} s)`;
    } else this.seqInfo.textContent = '';
  }

  /* ---------------- everything ---------------- */

  /** Refresh all the boxes from the data. Only values the playhead affects when `timeOnly`. */
  sync(timeOnly = false): void {
    this.syncBone();
    if (timeOnly) return;
    this.syncKey();
    this.syncAnim();
    this.syncMix();
    const names = Object.keys(this.model.rig.animations);
    if (this.seqAdd.options.length !== names.length || names.some((n, i) => this.seqAdd.options[i].value !== n)) {
      const keep = this.seqAdd.value;
      clear(this.seqAdd);
      this.seqAdd.append(...names.map((n) => h('option', { value: n }, n)));
      if (names.includes(keep)) this.seqAdd.value = keep;
    }
    this.syncSequence(true);
  }
}
