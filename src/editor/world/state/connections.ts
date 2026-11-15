/** Which rooms touch, and whether their doorways line up. Used by the world map and its side panel. */
import type { RoomRef } from '../../../shared/types';
import { inspectEdge, sharedEdges, type EdgeReport, type SharedEdge } from '../logic/worldmap';
import type { Editor } from './editor';

export interface Connection { a: RoomRef; b: RoomRef; edge: SharedEdge; report: EdgeReport }

export function findConnections(editor: Editor, refs: RoomRef[] = editor.world.rooms): Connection[] {
  const out: Connection[] = [];
  for (const edge of sharedEdges(refs)) {
    const a = refs.find((r) => r.id === edge.a);
    const b = refs.find((r) => r.id === edge.b);
    const roomA = editor.rooms.get(edge.a);
    const roomB = editor.rooms.get(edge.b);
    if (!a || !b || !roomA || !roomB) continue;
    out.push({ a, b, edge, report: inspectEdge(edge, a, roomA, b, roomB, editor.isSolid) });
  }
  return out;
}
