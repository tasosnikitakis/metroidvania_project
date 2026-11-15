/** Sidebar shown in World Map mode: the room list and connection warnings. */
import { boxesOverlap } from '../logic/worldmap';
import type { Actions } from '../actions';
import { findConnections } from '../state/connections';
import type { Editor } from '../state/editor';
import { clear, h, iconButton, throttled } from './dom';
import { openMenuBelow } from './menu';

export function buildMapPanel(editor: Editor, actions: Actions): HTMLElement {
  const worldName = h('input', { type: 'text', maxLength: 60, 'aria-label': 'World name' });
  worldName.addEventListener('change', () => editor.renameWorld(worldName.value));
  const list = h('div', { class: 'room-list' });
  const warnings = h('div', { class: 'map-warnings' });
  const root = h('div', { class: 'map-panel' },
    h('label', { class: 'field' }, h('span', { class: 'bar-label' }, 'World name'), worldName),
    h('div', { class: 'map-head' }, h('h4', {}, 'Rooms'), iconButton('plus', 'New room', () => void actions.newRoom(), 'New room')),
    list,
    h('h4', {}, 'Connections'),
    warnings,
  );

  const render = (): void => {
    if (editor.mode !== 'map') return;
    if (document.activeElement !== worldName) worldName.value = editor.world.name;

    clear(list);
    for (const ref of editor.world.rooms) {
      const menuBtn = iconButton('more', 'More…', () => openMenuBelow(menuBtn, [
        { label: 'Edit this room', action: () => editor.openRoom(ref.id) },
        { label: 'Rename…', action: () => void actions.renameRoom(ref.id) },
        { label: 'Resize…', action: () => void actions.resizeRoom(ref.id) },
        { label: 'Duplicate', action: () => actions.duplicateRoom(ref.id) },
        { label: 'Start the game here', action: () => actions.setStartRoom(ref.id), disabled: editor.world.startRoom === ref.id },
        { label: 'Delete room…', action: () => void actions.deleteRoom(ref.id), danger: true },
      ]));
      list.append(h('div', { class: `room-row${ref.id === editor.roomId ? ' active' : ''}` },
        h('button', {
          type: 'button', class: 'room-name', title: 'Click to select, double-click to edit',
          onclick: () => editor.openRoom(ref.id, true),
          ondblclick: () => editor.openRoom(ref.id),
        },
          h('span', {}, `${ref.id === editor.world.startRoom ? '★ ' : ''}${ref.name}${editor.dirtyRooms.has(ref.id) ? ' •' : ''}`),
          h('span', { class: 'muted small' }, `${ref.w} × ${ref.h}`),
        ),
        h('button', { type: 'button', title: 'Edit this room', onclick: () => editor.openRoom(ref.id) }, 'Edit'),
        menuBtn,
      ));
    }
    if (editor.world.rooms.length === 0) list.append(h('p', { class: 'muted small' }, 'No rooms yet.'));

    clear(warnings);
    const refs = editor.world.rooms;
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        if (boxesOverlap(refs[i], refs[j])) warnings.append(h('p', { class: 'warn' }, `⚠ "${refs[i].name}" and "${refs[j].name}" overlap - drag one of them apart.`));
      }
    }
    const connections = findConnections(editor);
    const connected = new Set<string>();
    for (const c of connections) {
      connected.add(c.a.id);
      connected.add(c.b.id);
      const doors = c.report.doorways.reduce((n, s) => n + (s.to - s.from), 0);
      const blocked = c.report.blocked.reduce((n, s) => n + (s.to - s.from), 0);
      const names = `${c.a.name} ↔ ${c.b.name}`;
      if (blocked > 0) {
        warnings.append(h('p', { class: 'warn' }, `⚠ ${names}: ${blocked} tile${blocked === 1 ? '' : 's'} of opening face a solid wall on the other side (red on the map).`));
      }
      if (doors > 0) warnings.append(h('p', { class: 'ok' }, `✓ ${names}: you can walk through (${doors} open tile${doors === 1 ? '' : 's'}).`));
      else if (blocked === 0) warnings.append(h('p', { class: 'muted small' }, `${names}: touching, but walls on both sides - no way through yet.`));
    }
    if (refs.length > 1) {
      for (const ref of refs) {
        if (!connected.has(ref.id)) warnings.append(h('p', { class: 'muted small' }, `"${ref.name}" does not touch any other room.`));
      }
    }
    if (warnings.childElementCount === 0) warnings.append(h('p', { class: 'muted small' }, 'Put two rooms side by side to connect them.'));
  };

  editor.events.on(['rooms', 'ui'], throttled(render));
  render();
  return root;
}
