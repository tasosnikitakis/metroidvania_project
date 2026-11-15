/** Top bar (rooms, map, undo/redo, save, play) and the view bar under it (layers, toggles, zoom). */
import { createTopbar } from '../../common/nav';
import { LAYER_NAMES, type LayerName } from '../../../shared/types';
import type { Actions } from '../actions';
import type { CanvasView } from '../render/canvasView';
import type { Editor } from '../state/editor';
import { clear, h, icon, iconButton, throttled } from './dom';
import { openMenuBelow } from './menu';

export function buildTopbar(editor: Editor, actions: Actions): HTMLElement {
  const bar = createTopbar('world', 'World Editor');
  bar.classList.add('we-topbar');

  const roomSelect = h('select', { class: 'room-select', title: 'Choose the room to edit', 'aria-label': 'Room', onchange: () => editor.openRoom(roomSelect.value, editor.mode === 'map') });
  const roomMenu = iconButton('more', 'Room & file menu', () => {
    const has = editor.room !== null;
    openMenuBelow(roomMenu, [
      { label: 'New room…', action: () => void actions.newRoom() },
      { label: 'Rename…', action: () => void actions.renameRoom(), disabled: !has },
      { label: 'Resize…', action: () => void actions.resizeRoom(), disabled: !has },
      { label: 'Duplicate', action: () => actions.duplicateRoom(), disabled: !has },
      { label: 'Start the game here', action: () => actions.setStartRoom(), disabled: !has || editor.world.startRoom === editor.roomId },
      { label: 'Delete room…', action: () => void actions.deleteRoom(), disabled: !has, danger: true },
      { separator: true, label: '' },
      { label: 'Export JSON (backup)', action: () => actions.exportJson() },
      { label: 'Import JSON…', action: () => actions.importJson() },
    ]);
  });
  const newRoom = iconButton('plus', 'New room', () => void actions.newRoom());
  const mapBtn = iconButton('map', 'World map: arrange and connect rooms (Tab)', () => actions.toggleMap(), 'Map');
  const undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', () => editor.undo());
  const redoBtn = iconButton('redo', 'Redo (Ctrl+Shift+Z)', () => editor.redo());
  const saveBtn = iconButton('save', 'Save (Ctrl+S)', () => void actions.save(), 'Save', 'save-btn');
  const playBtn = iconButton('play', 'Save and play this room (Ctrl+Enter)', () => void actions.play(), 'Play', 'primary play-btn');
  const helpBtn = iconButton('help', 'Help & shortcuts (?)', () => actions.help());

  bar.append(
    h('div', { class: 'bar-group' }, roomSelect, newRoom, roomMenu),
    mapBtn,
    h('div', { class: 'bar-group' }, undoBtn, redoBtn),
    saveBtn, playBtn, helpBtn,
  );

  const syncRooms = (): void => {
    clear(roomSelect);
    for (const ref of editor.world.rooms) {
      const star = ref.id === editor.world.startRoom ? '★ ' : '';
      const dot = editor.dirtyRooms.has(ref.id) ? ' •' : '';
      roomSelect.append(h('option', { value: ref.id }, `${star}${ref.name}${dot}`));
    }
    if (editor.roomId) roomSelect.value = editor.roomId;
    roomSelect.disabled = editor.world.rooms.length === 0;
  };
  const sync = (): void => {
    syncRooms();
    undoBtn.disabled = !editor.history.canUndo;
    redoBtn.disabled = !editor.history.canRedo;
    undoBtn.title = editor.history.undoLabel ? `Undo: ${editor.history.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
    redoBtn.title = editor.history.redoLabel ? `Redo: ${editor.history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';
    mapBtn.classList.toggle('active', editor.mode === 'map');
    saveBtn.classList.toggle('dirty', editor.dirty);
    saveBtn.disabled = actions.isSaving;
    saveBtn.title = !editor.writable ? 'Read-only - use Export in the ⋯ menu' : editor.dirty ? 'Save your changes (Ctrl+S)' : 'Everything is saved';
    saveBtn.lastElementChild!.textContent = actions.isSaving ? 'Saving…' : editor.dirty ? 'Save •' : 'Saved';
    document.title = `${editor.dirty ? '• ' : ''}${editor.room?.name ?? 'World Editor'} - World Editor`;
  };
  editor.events.on(['ui', 'rooms'], throttled(sync));
  sync();
  return bar;
}

export function buildViewbar(editor: Editor, canvas: CanvasView): HTMLElement {
  const bar = h('div', { class: 'viewbar' });

  const layerLabels: Record<LayerName, string> = { back: 'Back', main: 'Main', front: 'Front' };
  const layerTips: Record<LayerName, string> = {
    back: 'Back layer: walls and scenery behind the player (1)',
    main: 'Main layer: floors and walls the player touches (2)',
    front: 'Front layer: drawn in front of the player (3)',
  };
  const layerGroup = h('div', { class: 'layer-group', role: 'group', 'aria-label': 'Layers' }, h('span', { class: 'bar-label' }, 'Layer'));
  const layerButtons = new Map<LayerName, { pick: HTMLButtonElement; eye: HTMLButtonElement }>();
  for (const layer of LAYER_NAMES) {
    const pick = h('button', { type: 'button', class: 'layer-pick', title: layerTips[layer], onclick: () => editor.setActiveLayer(layer) }, layerLabels[layer]);
    const eye = h('button', { type: 'button', class: 'layer-eye', title: `Show / hide the ${layer} layer`, 'aria-label': `Show or hide ${layer} layer`, onclick: () => editor.toggleLayerVisible(layer) });
    layerButtons.set(layer, { pick, eye });
    layerGroup.append(h('div', { class: 'layer-chip' }, pick, eye));
  }

  type ViewKey = keyof Editor['view'];
  const toggles: Array<[ViewKey, string, string]> = [
    ['dim', 'Dim others', 'Fade the layers you are not painting on'],
    ['grid', 'Grid', 'Show the tile grid (G)'],
    ['collision', 'Collision', 'Tint solid, one-way and hazard tiles (H)'],
    ['cameraFrame', 'Camera', 'Show how much the player sees around the cursor (C)'],
    ['decor', 'Decor', 'Show / hide decor'],
    ['entities', 'Entities', 'Show / hide entity markers'],
    ['background', 'Sky', 'Show / hide the background preview'],
  ];
  const toggleButtons = toggles.map(([key, label, title]) => {
    const b = h('button', { type: 'button', class: 'toggle', title, onclick: () => editor.toggleView(key) }, label);
    return [key, b] as const;
  });

  const zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: 'Fit the room to the window (0)', onclick: () => canvas.fit() }, '100%');
  const zoomGroup = h('div', { class: 'bar-group' },
    h('button', { type: 'button', class: 'zoom-btn', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => canvas.zoomBy(1 / 1.25) }, '−'),
    zoomLabel,
    h('button', { type: 'button', class: 'zoom-btn', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => canvas.zoomBy(1.25) }, '+'),
    iconButton('fit', 'Fit the room to the window (0)', () => canvas.fit()),
  );

  const roomOnly = h('div', { class: 'viewbar-room' }, layerGroup, h('div', { class: 'toggle-group' }, ...toggleButtons.map(([, b]) => b)));
  const mapHint = h('div', { class: 'viewbar-map muted' }, 'World map - drag rooms to arrange them. Rooms that touch are connected. Double-click a room to edit it.');
  bar.append(roomOnly, mapHint, h('span', { class: 'spacer' }), zoomGroup);

  const sync = (): void => {
    for (const [layer, { pick, eye }] of layerButtons) {
      pick.classList.toggle('active', editor.activeLayer === layer);
      eye.classList.toggle('off', !editor.layerVisible[layer]);
      clear(eye);
      eye.append(icon(editor.layerVisible[layer] ? 'eye' : 'eyeOff', 16));
    }
    for (const [key, b] of toggleButtons) b.classList.toggle('active', editor.view[key]);
    roomOnly.hidden = editor.mode === 'map';
    mapHint.hidden = editor.mode !== 'map';
  };
  editor.events.on(['ui'], throttled(sync));
  editor.events.on(['cursor', 'render'], throttled(() => { zoomLabel.textContent = `${canvas.zoomPercent()}%`; }));
  sync();
  return bar;
}
