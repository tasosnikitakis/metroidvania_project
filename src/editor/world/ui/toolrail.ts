/** The column of tool buttons on the left, and the status bar at the bottom. */
import type { CanvasView } from '../render/canvasView';
import type { Editor, ToolId } from '../state/editor';
import { h, icon, throttled } from './dom';

export const TOOL_INFO: Array<{ id: ToolId; icon: string; label: string; key: string; title: string; gapBefore?: boolean }> = [
  { id: 'terrain', icon: 'terrain', label: 'Terrain', key: 'B', title: 'Terrain brush: paint walls and floors that shape themselves' },
  { id: 'tile', icon: 'tile', label: 'Tiles', key: 'T', title: 'Tile brush: place exact tiles from the Tiles palette' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E', title: 'Eraser: rub tiles out' },
  { id: 'rect', icon: 'rect', label: 'Box', key: 'R', title: 'Rectangle: drag a box to fill it' },
  { id: 'fill', icon: 'fill', label: 'Fill', key: 'F', title: 'Flood fill: fill a whole closed area' },
  { id: 'eyedropper', icon: 'eyedropper', label: 'Pick', key: 'I', title: 'Eyedropper: click a tile to paint with it' },
  { id: 'select', icon: 'select', label: 'Select', key: 'M', title: 'Select tiles to move, copy or delete' },
  { id: 'decor', icon: 'decor', label: 'Decor', key: 'D', title: 'Decor: place and arrange scenery', gapBefore: true },
  { id: 'entity', icon: 'entity', label: 'Entity', key: 'N', title: 'Entities: player start, lights, checkpoints…' },
  { id: 'pan', icon: 'pan', label: 'Move', key: 'Space', title: 'Hand: drag to move around the room', gapBefore: true },
  { id: 'play', icon: 'play', label: 'Play here', key: 'P', title: 'Play from here: click a spot to start the game there' },
];

export function buildToolRail(editor: Editor): HTMLElement {
  const rail = h('div', { class: 'toolrail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
  const buttons = new Map<ToolId, HTMLButtonElement>();
  for (const t of TOOL_INFO) {
    const b = h('button', {
      type: 'button', class: `tool-btn${t.gapBefore ? ' gap' : ''}`, title: `${t.title} (${t.key})`,
      onclick: () => editor.setTool(t.id),
    }, icon(t.icon, 24), h('span', { class: 'tool-label' }, t.label), h('kbd', {}, t.key === 'Space' ? '␣' : t.key));
    buttons.set(t.id, b);
    rail.append(b);
  }
  const sync = (): void => {
    for (const [id, b] of buttons) {
      b.classList.toggle('active', editor.tool === id && editor.mode === 'room');
      b.disabled = editor.mode === 'map' || (id === 'terrain' && editor.tileset.terrains.length === 0);
    }
  };
  editor.events.on(['ui', 'palette'], throttled(sync));
  sync();
  return rail;
}

export function buildStatusBar(editor: Editor, canvas: CanvasView): HTMLElement {
  const coords = h('span', { class: 'status-coords' });
  const layer = h('span', { class: 'status-layer' });
  const zoom = h('span', { class: 'status-zoom' });
  const hint = h('span', { class: 'status-hint' });
  const bar = h('div', { class: 'statusbar' }, coords, zoom, layer, hint);
  const sync = (): void => {
    const c = editor.cursor;
    const room = editor.room;
    if (editor.mode === 'map') {
      coords.textContent = c ? `Map ${c.tx}, ${c.ty}` : 'Map';
      layer.textContent = `${editor.world.rooms.length} room${editor.world.rooms.length === 1 ? '' : 's'}`;
      hint.textContent = 'Drag rooms to arrange · green = doorway, red = a gap facing a wall · double-click to edit · Tab: back to the room';
    } else {
      const inside = c && room && c.tx >= 0 && c.ty >= 0 && c.tx < room.width && c.ty < room.height;
      coords.textContent = c ? `Tile ${c.tx}, ${c.ty}${inside ? '' : ' (outside)'} · ${Math.round(c.x)}, ${Math.round(c.y)} px` : room ? `${room.width} × ${room.height} tiles` : '';
      layer.textContent = `Layer: ${editor.activeLayer}${editor.layerVisible[editor.activeLayer] ? '' : ' (hidden)'}`;
      hint.textContent = canvas.activeTool.hint();
    }
    zoom.textContent = `Zoom ${canvas.zoomPercent()}%`;
  };
  editor.events.on(['cursor', 'ui', 'rooms', 'selection', 'palette'], throttled(sync));
  sync();
  return bar;
}
