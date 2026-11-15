/**
 * PROPERTIES PANEL (bottom of the right sidebar)
 * Shows a form for whatever is selected:
 *   an entity -> its properties (built automatically from src/shared/entities.ts)
 *   decor     -> layer, flip, scale, rotation, alpha, drawing order
 *   tiles     -> flip / copy / delete buttons
 *   nothing   -> the room's own settings
 *
 * The form is rebuilt only when the selection changes. While you type or drag
 * a slider only the OTHER inputs are refreshed, so the field you are using
 * never loses focus.
 */
import { entityType, type PropSchema } from '../../../shared/entities';
import type { DecorInstance } from '../../../shared/types';
import type { Actions } from '../actions';
import { assetUrl } from '../render/assets';
import type { CanvasView } from '../render/canvasView';
import type { Editor } from '../state/editor';
import { clear, h, iconButton, throttled } from './dom';

/** Something on screen that mirrors a value in the editor. */
interface Binding { refresh(): void }

export function buildProperties(editor: Editor, canvas: CanvasView, actions: Actions): HTMLElement {
  const title = h('h3', {}, 'Properties');
  const body = h('div', { class: 'props-body' });
  const root = h('div', { class: 'props panel' }, title, body);
  let builtKey = '';
  let bindings: Binding[] = [];

  /* ---------- reusable fields ---------- */

  const row = (label: string, ...controls: HTMLElement[]): HTMLElement =>
    h('label', { class: 'prop-row' }, h('span', { class: 'prop-label' }, label), h('span', { class: 'prop-controls' }, ...controls));

  /** Number box, optionally with a slider next to it. */
  const numberField = (
    label: string, get: () => number | undefined, set: (v: number) => void,
    opts: { min?: number; max?: number; step?: number; slider?: boolean } = {},
  ): HTMLElement => {
    const attrs = { min: opts.min, max: opts.max, step: opts.step ?? 1 };
    const box = h('input', { type: 'number', class: 'num', ...attrs });
    const slider = opts.slider ? h('input', { type: 'range', ...attrs }) : null;
    const apply = (raw: string): void => {
      let v = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(v)) return;
      if (opts.min !== undefined) v = Math.max(opts.min, v);
      if (opts.max !== undefined) v = Math.min(opts.max, v);
      set(v);
    };
    box.addEventListener('input', () => apply(box.value));
    box.addEventListener('change', () => { editor.history.breakMerge(); refresh(); });
    slider?.addEventListener('input', () => apply(slider.value));
    slider?.addEventListener('change', () => editor.history.breakMerge());
    const refresh = (): void => {
      const v = get();
      const text = v === undefined ? '' : String(Math.round(v * 1000) / 1000);
      if (document.activeElement !== box) box.value = text;
      if (slider && document.activeElement !== slider && v !== undefined) slider.value = String(v);
    };
    bindings.push({ refresh });
    return row(label, ...(slider ? [slider, box] : [box]));
  };

  const checkField = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
    const box = h('input', { type: 'checkbox' });
    box.addEventListener('change', () => set(box.checked));
    bindings.push({ refresh: () => { box.checked = get(); } });
    return row(label, box);
  };

  const selectField = (label: string, options: Array<[string, string]>, get: () => string, set: (v: string) => void): HTMLElement => {
    const sel = h('select', {}, ...options.map(([value, text]) => h('option', { value }, text)));
    sel.addEventListener('change', () => set(sel.value));
    bindings.push({ refresh: () => { if (document.activeElement !== sel) sel.value = get(); } });
    return row(label, sel);
  };

  const textField = (label: string, get: () => string, set: (v: string) => void): HTMLElement => {
    const box = h('input', { type: 'text', maxLength: 80 });
    box.addEventListener('input', () => set(box.value));
    box.addEventListener('change', () => { editor.history.breakMerge(); refresh(); });
    const refresh = (): void => { if (document.activeElement !== box) box.value = get(); };
    bindings.push({ refresh });
    return row(label, box);
  };

  const colorField = (label: string, get: () => string, set: (v: string) => void): HTMLElement => {
    const box = h('input', { type: 'color' });
    box.addEventListener('input', () => set(box.value));
    box.addEventListener('change', () => editor.history.breakMerge());
    bindings.push({ refresh: () => { if (document.activeElement !== box) box.value = /^#[0-9a-f]{6}$/i.test(get()) ? get() : '#ffffff'; } });
    return row(label, box);
  };

  const buttons = (...items: HTMLElement[]): HTMLElement => h('div', { class: 'prop-buttons' }, ...items);

  /* ---------- forms ---------- */

  const entityForm = (): void => {
    const first = (): ReturnType<Editor['selectedEntities']>[number] | undefined => editor.selectedEntities()[0];
    const all = editor.selectedEntities();
    const e = all[0];
    const def = entityType(e.type);
    const sameType = all.every((o) => o.type === e.type);
    title.textContent = all.length > 1 ? `${all.length} entities` : def?.name ?? 'Entity';
    if (def && all.length === 1) body.append(h('p', { class: 'muted small' }, def.description));

    if (all.length === 1) {
      const move = (axis: 'x' | 'y') => (v: number): void => {
        const room = editor.room;
        const cur = first();
        if (room && cur) editor.setEntities(room.entities.map((o) => (o.id === cur.id ? { ...o, [axis]: v } : o)), 'Move entity', `pos:${cur.id}`);
      };
      body.append(h('div', { class: 'prop-pair' },
        numberField('X', () => first()?.x, move('x')),
        numberField('Y', () => first()?.y, move('y')),
      ));
    }
    if (def && sameType) {
      const ids = all.map((o) => o.id).join(',');
      for (const [key, schema] of Object.entries(def.props) as Array<[string, PropSchema]>) {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const get = (): number | string | boolean | undefined => first()?.props[key];
        const set = (v: number | string | boolean): void => editor.updateSelectedEntityProp(key, v, `prop:${key}:${ids}`);
        if (schema.kind === 'number') {
          body.append(numberField(label, () => (typeof get() === 'number' ? (get() as number) : schema.default), set, {
            min: schema.min, max: schema.max, step: schema.step, slider: schema.min !== undefined && schema.max !== undefined,
          }));
        } else if (schema.kind === 'boolean') {
          body.append(checkField(label, () => get() === true, set));
        } else if (schema.kind === 'select') {
          body.append(selectField(label, schema.options.map((o) => [o, o]), () => String(get() ?? schema.default), set));
        } else if (schema.kind === 'color') {
          body.append(colorField(label, () => String(get() ?? schema.default), set));
        } else {
          body.append(textField(label, () => String(get() ?? ''), set));
        }
      }
      if (Object.keys(def.props).length === 0) body.append(h('p', { class: 'muted small' }, 'Nothing to adjust on this one.'));
    }
    body.append(buttons(
      def?.unique ? h('span', { class: 'muted small' }, 'Only one per room') : iconButton('copy', 'Duplicate (Ctrl+D)', () => actions.duplicate(), 'Duplicate'),
      iconButton('trash', 'Delete (Del)', () => actions.deleteSelected(), 'Delete', 'danger-text'),
    ));
  };

  const decorForm = (): void => {
    const first = (): DecorInstance | undefined => editor.selectedDecor()[0];
    const all = editor.selectedDecor();
    const d = all[0];
    const def = editor.decorDefs.get(d.key);
    const ids = all.map((o) => o.id).join(',');
    title.textContent = all.length > 1 ? `${all.length} decor items` : def?.name ?? 'Decor';
    if (def && all.length === 1) {
      body.append(h('div', { class: 'decor-preview' }, h('img', { src: assetUrl(def.image), alt: '' })));
    }
    const patch = (p: Partial<DecorInstance>, label: string, key: string): void => editor.updateSelectedDecor(p, label, `decor:${key}:${ids}`);

    if (all.length === 1) {
      body.append(h('div', { class: 'prop-pair' },
        numberField('X', () => first()?.x, (v) => patch({ x: v }, 'Move decor', 'x')),
        numberField('Y', () => first()?.y, (v) => patch({ y: v }, 'Move decor', 'y')),
      ));
    }
    body.append(
      selectField('Layer', [['far', 'Far (behind walls)'], ['back', 'Back (behind player)'], ['front', 'Front (before player)']],
        () => first()?.layer ?? 'back', (v) => editor.updateSelectedDecor({ layer: v as DecorInstance['layer'] }, 'Change decor layer')),
      checkField('Flip', () => first()?.flipX === true, (v) => editor.updateSelectedDecor({ flipX: v }, 'Flip decor')),
      numberField('Scale', () => first()?.scale ?? 1, (v) => patch({ scale: v }, 'Scale decor', 'scale'), { min: 0.1, max: 5, step: 0.05, slider: true }),
      numberField('Rotation', () => first()?.rotation ?? 0, (v) => patch({ rotation: v }, 'Rotate decor', 'rot'), { min: -180, max: 180, step: 1, slider: true }),
      numberField('Alpha', () => first()?.alpha ?? 1, (v) => patch({ alpha: v }, 'Fade decor', 'alpha'), { min: 0, max: 1, step: 0.05, slider: true }),
      h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Order'), h('span', { class: 'prop-controls order' },
        iconButton('up', 'Bring forward (draw later, on top)', () => editor.reorderSelectedDecor('forward')),
        iconButton('down', 'Send backward (draw earlier, underneath)', () => editor.reorderSelectedDecor('backward')),
        h('button', { type: 'button', title: 'Bring to the very front of its layer', onclick: () => editor.reorderSelectedDecor('front') }, 'Top'),
        h('button', { type: 'button', title: 'Send to the very back of its layer', onclick: () => editor.reorderSelectedDecor('back') }, 'Bottom'),
      )),
      buttons(
        iconButton('copy', 'Duplicate (Ctrl+D)', () => actions.duplicate(), 'Duplicate'),
        h('button', { type: 'button', title: 'Back to normal size, no rotation, fully visible', onclick: () => editor.updateSelectedDecor({ scale: undefined, rotation: undefined, alpha: undefined, flipX: undefined }, 'Reset decor') }, 'Reset'),
        iconButton('trash', 'Delete (Del)', () => actions.deleteSelected(), 'Delete', 'danger-text'),
      ),
    );
  };

  const tileSelectionForm = (): void => {
    const sel = editor.tileSelection!;
    title.textContent = 'Selected tiles';
    const size = h('p', { class: 'muted small' });
    bindings.push({ refresh: () => {
      const s = editor.tileSelection;
      if (s) size.textContent = `${s.rect.w} × ${s.rect.h} tiles on the ${s.layer} layer${s.floating ? ' · floating: click outside to drop' : ''}`;
    } });
    void sel;
    body.append(size, buttons(
      iconButton('flipH', 'Flip left-right', () => canvas.selectTool.flip('h'), 'Flip'),
      iconButton('flipV', 'Flip top-bottom', () => canvas.selectTool.flip('v'), 'Flip'),
      iconButton('copy', 'Copy (Ctrl+C)', () => actions.copy(), 'Copy'),
      iconButton('trash', 'Delete (Del)', () => actions.deleteSelected(), 'Delete', 'danger-text'),
    ), h('p', { class: 'muted small' }, 'Drag inside the box to move the tiles. Ctrl+V pastes a copy.'));
  };

  const roomForm = (): void => {
    const room = editor.room!;
    const id = room.id;
    title.textContent = 'Room';
    const cur = (): typeof room | undefined => editor.rooms.get(id);
    const size = h('span', { class: 'size-text' });
    const start = h('button', { type: 'button', onclick: () => actions.setStartRoom(id) });
    const counts = h('p', { class: 'muted small' });
    bindings.push({ refresh: () => {
      const r = cur();
      if (!r) return;
      size.textContent = `${r.width} × ${r.height} tiles`;
      const isStart = editor.world.startRoom === id;
      start.textContent = isStart ? '★ The game starts here' : 'Start the game here';
      start.disabled = isStart;
      const hasStart = r.entities.some((e) => e.type === 'playerStart');
      counts.textContent = `${r.decor.length} decor · ${r.entities.length} entities${hasStart ? '' : ' · no Player Start yet (add one from Entities)'}`;
    } });
    body.append(
      textField('Name', () => cur()?.name ?? '', (v) => editor.renameRoom(id, v)),
      h('div', { class: 'prop-row' }, h('span', { class: 'prop-label' }, 'Size'), h('span', { class: 'prop-controls' }, size, h('button', { type: 'button', onclick: () => void actions.resizeRoom(id) }, 'Resize…'))),
    );
    if (editor.backgrounds.length > 0) {
      body.append(selectField('Background', editor.backgrounds.map((b) => [b.key, b.name]), () => cur()?.background ?? '', (v) => editor.setRoomBackground(id, v)));
    }
    body.append(
      buttons(start),
      counts,
      buttons(
        iconButton('copy', 'Make a copy of this room', () => actions.duplicateRoom(id), 'Duplicate'),
        iconButton('trash', 'Delete this room', () => void actions.deleteRoom(id), 'Delete', 'danger-text'),
      ),
    );
  };

  /* ---------- choose & refresh ---------- */

  const render = (): void => {
    const sel = editor.selection;
    const room = editor.room;
    let key = 'none';
    if (editor.mode === 'room' && sel && sel.kind === 'entity' && editor.selectedEntities().length > 0) key = `entity:${sel.ids.join(',')}`;
    else if (editor.mode === 'room' && sel && sel.kind === 'decor' && editor.selectedDecor().length > 0) key = `decor:${sel.ids.join(',')}`;
    else if (editor.mode === 'room' && editor.tileSelection && editor.tool === 'select') key = 'tiles';
    else if (room) key = `room:${room.id}:${editor.backgrounds.length}`;

    if (key !== builtKey) {
      builtKey = key;
      bindings = [];
      clear(body);
      if (key.startsWith('entity:')) entityForm();
      else if (key.startsWith('decor:')) decorForm();
      else if (key === 'tiles') tileSelectionForm();
      else if (key.startsWith('room:')) roomForm();
      else {
        title.textContent = 'Properties';
        body.append(h('p', { class: 'muted small' }, 'Create a room to get started.'));
      }
    }
    for (const b of bindings) b.refresh();
  };

  editor.events.on(['selection', 'rooms', 'ui'], throttled(render));
  render();
  return root;
}
