import { describe, expect, it } from 'vitest';
import type { RoomData, RoomRef, TerrainDef } from '../src/shared/types';
import { buildTerrainIndex, eraseCells, hash2, paintTerrain, terrainMask, terrainTileFor } from '../src/editor/world/logic/autotile';
import { applyPatch, History, PatchBuilder, type Command } from '../src/editor/world/logic/history';
import { brushCells, extractStamp, flipStamp, floodRegion, linePoints, rectFromCorners, stampTileAt } from '../src/editor/world/logic/tileOps';
import { rleDecode, rleEncode } from '../src/editor/world/logic/rle';
import { resizeRoom } from '../src/editor/world/logic/resize';
import { boxesOverlap, findFreeSpot, inspectEdge, placeNewRoom, sharedEdges } from '../src/editor/world/logic/worldmap';
import { copyName, nextRoomId } from '../src/editor/world/logic/ids';
import { blankRoom } from '../src/editor/world/logic/validate';

/** Terrain A uses tile ids 101..116 (id = 101 + mask); terrain B uses 201..216. */
const terrainA: TerrainDef = { name: 'A', layer: 'main', tiles: Array.from({ length: 16 }, (_, m) => 101 + m) };
const terrainB: TerrainDef = { name: 'B', layer: 'back', tiles: Array.from({ length: 16 }, (_, m) => 201 + m) };
const index = buildTerrainIndex([terrainA, terrainB]);
const maskOf = (id: number): number => (id > 200 ? id - 201 : id - 101);

function grid(w: number, h: number): { layer: number[]; set: (i: number, id: number) => void } {
  const layer = new Array<number>(w * h).fill(0);
  return { layer, set: (i, id) => { layer[i] = id; } };
}

describe('autotile', () => {
  it('builds a tile -> terrain lookup', () => {
    expect(index.tileToTerrain.get(101)).toBe(0);
    expect(index.tileToTerrain.get(216)).toBe(1);
    expect(index.tileToTerrain.get(0)).toBeUndefined();
    expect(index.tileToTerrain.get(5)).toBeUndefined();
  });

  it('a lone block in the middle of the room has mask 0', () => {
    const { layer, set } = grid(5, 5);
    paintTerrain(layer, 5, 5, [12], 0, index, set);
    expect(maskOf(layer[12])).toBe(0);
  });

  it('uses N=1 E=2 S=4 W=8', () => {
    const { layer, set } = grid(5, 5);
    // plus shape around the centre (2,2)
    paintTerrain(layer, 5, 5, [12, 7, 13, 17, 11], 0, index, set);
    expect(maskOf(layer[12])).toBe(15);
    expect(maskOf(layer[7])).toBe(4);   // north arm: only its south neighbour matches
    expect(maskOf(layer[13])).toBe(8);  // east arm: west neighbour
    expect(maskOf(layer[17])).toBe(1);  // south arm: north neighbour
    expect(maskOf(layer[11])).toBe(2);  // west arm: east neighbour
  });

  it('treats outside the room as the same terrain', () => {
    const { layer, set } = grid(3, 3);
    paintTerrain(layer, 3, 3, [0], 0, index, set); // top-left corner
    expect(maskOf(layer[0])).toBe(1 | 8);
    expect(terrainMask(layer, 3, 3, 2, 2, 0, index)).toBe(2 | 4);
  });

  it('re-evaluates neighbours after painting and erasing', () => {
    const { layer, set } = grid(5, 5);
    paintTerrain(layer, 5, 5, [11], 0, index, set);
    expect(maskOf(layer[11])).toBe(0);
    paintTerrain(layer, 5, 5, [12], 0, index, set);
    expect(maskOf(layer[11])).toBe(2);
    expect(maskOf(layer[12])).toBe(8);
    eraseCells(layer, 5, 5, [12], index, set);
    expect(layer[12]).toBe(0);
    expect(maskOf(layer[11])).toBe(0);
  });

  it('different terrains do not connect to each other', () => {
    const { layer, set } = grid(5, 5);
    paintTerrain(layer, 5, 5, [11], 0, index, set);
    paintTerrain(layer, 5, 5, [12], 1, index, set);
    expect(layer[11]).toBe(101);
    expect(layer[12]).toBe(201);
    // painting B over A updates A's old neighbours
    paintTerrain(layer, 5, 5, [13], 0, index, set);
    paintTerrain(layer, 5, 5, [12], 0, index, set);
    expect(maskOf(layer[12])).toBe(2 | 8);
    paintTerrain(layer, 5, 5, [12], 1, index, set);
    expect(layer[11]).toBe(101);
    expect(layer[13]).toBe(101);
  });

  it('leaves non-terrain tiles alone', () => {
    const { layer, set } = grid(5, 5);
    layer[13] = 7;
    paintTerrain(layer, 5, 5, [12], 0, index, set);
    expect(layer[13]).toBe(7);
    expect(maskOf(layer[12])).toBe(0);
  });

  it('picks fill variants deterministically for mask 15', () => {
    const def: TerrainDef = { ...terrainA, fillVariants: [300, 301, 302] };
    const seen = new Set<number>();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const id = terrainTileFor(def, 15, x, y);
      expect(terrainTileFor(def, 15, x, y)).toBe(id);
      expect([116, 300, 301, 302]).toContain(id);
      seen.add(id);
    }
    expect(seen.size).toBe(4);
    expect(terrainTileFor(def, 3, 4, 4)).toBe(104);
    expect(hash2(3, 9)).toBe(hash2(3, 9));
    expect(hash2(3, 9)).not.toBe(hash2(9, 3));
  });

  it('fill variants still count as the terrain', () => {
    const def: TerrainDef = { ...terrainA, fillVariants: [300] };
    const idx = buildTerrainIndex([def]);
    const { layer, set } = grid(6, 6);
    paintTerrain(layer, 6, 6, Array.from({ length: 36 }, (_, i) => i), 0, idx, set);
    expect(layer.every((id) => id === 116 || id === 300)).toBe(true);
    expect(layer).toContain(300);
    eraseCells(layer, 6, 6, [14], idx, set);
    expect(maskOf(layer[13])).toBe(15 & ~2);
  });
});

describe('history', () => {
  const counterCmd = (state: { n: number }, by: number, mergeKey?: string): Command => {
    const cmd = {
      label: `add ${by}`, by, mergeKey,
      undo() { state.n -= this.by; },
      redo() { state.n += this.by; },
      merge(newer: Command) { this.by += (newer as typeof cmd).by; return true; },
    };
    state.n += by;
    return cmd;
  };

  it('undoes and redoes in order', () => {
    const s = { n: 0 };
    const h = new History();
    h.push(counterCmd(s, 1));
    h.push(counterCmd(s, 10));
    expect(s.n).toBe(11);
    expect(h.undoLabel).toBe('add 10');
    h.undo();
    expect(s.n).toBe(1);
    h.undo();
    expect(s.n).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
    h.redo(); h.redo();
    expect(s.n).toBe(11);
    expect(h.canRedo).toBe(false);
  });

  it('a new action clears the redo list', () => {
    const s = { n: 0 };
    const h = new History();
    h.push(counterCmd(s, 1));
    h.undo();
    h.push(counterCmd(s, 5));
    expect(h.canRedo).toBe(false);
    expect(s.n).toBe(5);
  });

  it('forgets the oldest steps beyond the limit', () => {
    const s = { n: 0 };
    const h = new History(3);
    for (let i = 0; i < 10; i++) h.push(counterCmd(s, 1));
    expect(h.size).toBe(3);
    while (h.canUndo) h.undo();
    expect(s.n).toBe(7);
  });

  it('merges quick commands with the same key into one step', () => {
    const s = { n: 0 };
    let now = 1000;
    const h = new History(100, 500, () => now);
    h.push(counterCmd(s, 1, 'slider'));
    now += 100; h.push(counterCmd(s, 1, 'slider'));
    now += 100; h.push(counterCmd(s, 1, 'slider'));
    expect(h.size).toBe(1);
    now += 5000; h.push(counterCmd(s, 1, 'slider')); // too late -> new step
    expect(h.size).toBe(2);
    now += 10; h.push(counterCmd(s, 1, 'other'));
    expect(h.size).toBe(3);
    h.undo(); h.undo();
    expect(s.n).toBe(3);
    h.undo();
    expect(s.n).toBe(0);
  });

  it('breakMerge separates steps', () => {
    const s = { n: 0 };
    const h = new History(100, 500, () => 0);
    h.push(counterCmd(s, 1, 'k'));
    h.breakMerge();
    h.push(counterCmd(s, 1, 'k'));
    expect(h.size).toBe(2);
  });
});

describe('tile patches', () => {
  it('records only cells that changed, with before/after', () => {
    const layer = [0, 0, 5, 0];
    const changed: number[] = [];
    const b = new PatchBuilder(layer, (i) => changed.push(i));
    b.set(0, 3);
    b.set(0, 4);  // same cell twice: original stays 0
    b.set(1, 9);
    b.set(1, 0);  // back to the original -> dropped
    b.set(2, 5);  // no change at all
    expect(b.changed).toBe(true);
    const patch = b.finish();
    expect(patch).toEqual({ idx: [0], before: [0], after: [4] });
    expect(changed).toEqual([0, 0, 1, 1]);
    applyPatch(layer, patch, 'undo');
    expect(layer).toEqual([0, 0, 5, 0]);
    applyPatch(layer, patch, 'redo');
    expect(layer).toEqual([4, 0, 5, 0]);
  });

  it('revert puts everything back', () => {
    const layer = [1, 2, 3];
    const b = new PatchBuilder(layer);
    b.set(0, 9); b.set(2, 9);
    b.revert();
    expect(layer).toEqual([1, 2, 3]);
    expect(b.finish().idx).toEqual([]);
  });

  it('a whole terrain stroke undoes as one patch', () => {
    const layer = new Array<number>(25).fill(0);
    const b = new PatchBuilder(layer);
    const set = (i: number, id: number): void => b.set(i, id);
    paintTerrain(layer, 5, 5, [11], 0, index, set);
    paintTerrain(layer, 5, 5, [12], 0, index, set);
    paintTerrain(layer, 5, 5, [13], 0, index, set);
    const patch = b.finish();
    expect(patch.idx).toEqual([11, 12, 13]);
    const after = [...layer];
    applyPatch(layer, patch, 'undo');
    expect(layer.every((v) => v === 0)).toBe(true);
    applyPatch(layer, patch, 'redo');
    expect(layer).toEqual(after);
  });
});

describe('tile ops', () => {
  it('draws straight and diagonal lines without gaps', () => {
    expect(linePoints(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(linePoints(2, 2, 0, 0)).toEqual([[2, 2], [1, 1], [0, 0]]);
    expect(linePoints(1, 1, 1, 1)).toEqual([[1, 1]]);
    const pts = linePoints(0, 0, 7, 3);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([7, 3]);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(1);
    }
  });

  it('brush sizes cover the right cells and clip at the room edge', () => {
    expect(brushCells(2, 2, 1, 5, 5)).toEqual([12]);
    expect(brushCells(2, 2, 2, 5, 5)).toEqual([12, 13, 17, 18]);
    expect(brushCells(2, 2, 3, 5, 5)).toHaveLength(9);
    expect(brushCells(2, 2, 5, 5, 5)).toHaveLength(25);
    expect(brushCells(0, 0, 3, 5, 5)).toEqual([0, 1, 5, 6]);
    expect(brushCells(-5, -5, 3, 5, 5)).toEqual([]);
  });

  it('rectFromCorners works in any drag direction', () => {
    expect(rectFromCorners(3, 4, 1, 2)).toEqual({ x: 1, y: 2, w: 3, h: 3 });
  });

  it('flood fill stays inside walls', () => {
    // 5x5 with a closed box of 1s; inside is the single cell 12
    const W = 5;
    const layer = [
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 0, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
    ];
    expect(floodRegion(layer, W, 5, 2, 2)).toEqual([12]);
    expect(floodRegion(layer, W, 5, 0, 0).sort((a, b) => a - b)).toHaveLength(16);
    expect(floodRegion(layer, W, 5, 1, 1)).toHaveLength(8);
    expect(floodRegion(layer, W, 5, 9, 9)).toEqual([]);
  });

  it('flood fill does not wrap around row ends', () => {
    const layer = [
      1, 0, 0,
      0, 0, 1,
    ];
    // (0,0)=1 and (2,1)=1 are not connected even though indices 0 and 5 are "ends"
    expect(floodRegion(layer, 3, 2, 0, 0)).toEqual([0]);
  });

  it('flood fill can group by kind (terrain membership)', () => {
    const layer = [101, 105, 0, 116];
    const kind = (id: number): number | string => { const t = index.tileToTerrain.get(id); return t === undefined ? id : `t${t}`; };
    expect(floodRegion(layer, 4, 1, 0, 0, kind).sort()).toEqual([0, 1]);
  });

  it('flood fill handles a big empty room', () => {
    const layer = new Array<number>(300 * 100).fill(0);
    expect(floodRegion(layer, 300, 100, 150, 50)).toHaveLength(30000);
  });

  it('extracts and flips stamps', () => {
    const layer = [1, 2, 3, 4, 5, 6];
    const s = extractStamp(layer, 3, 2, { x: 1, y: 0, w: 2, h: 2 });
    expect(s).toEqual({ w: 2, h: 2, ids: [2, 3, 5, 6] });
    expect(flipStamp(s, 'h').ids).toEqual([3, 2, 6, 5]);
    expect(flipStamp(s, 'v').ids).toEqual([5, 6, 2, 3]);
    expect(extractStamp(layer, 3, 2, { x: 2, y: 1, w: 2, h: 2 }).ids).toEqual([6, 0, 0, 0]);
  });

  it('tiles a stamp like wallpaper', () => {
    const s = { w: 2, h: 1, ids: [7, 8] };
    expect([0, 1, 2, 3].map((x) => stampTileAt(s, 1, 0, x, 0))).toEqual([8, 7, 8, 7]);
    expect(stampTileAt(s, 0, 0, -1, -3)).toBe(8);
  });
});

describe('rle', () => {
  it('round-trips', () => {
    const data = [0, 0, 0, 5, 5, 1, 0, 0];
    expect(rleEncode(data)).toEqual([3, 0, 2, 5, 1, 1, 2, 0]);
    expect(rleDecode(rleEncode(data))).toEqual(data);
    expect(rleDecode(rleEncode([]))).toEqual([]);
  });
});

describe('room resize', () => {
  const make = (): RoomData => {
    const r = blankRoom('r', 'R', 10, 8, 'bg');
    r.layers.main[0] = 1;                 // top-left
    r.layers.main[8 * 10 - 1] = 2;        // bottom-right
    r.layers.back[3 * 10 + 4] = 3;
    r.decor.push({ id: 'd1', key: 'k', x: 48, y: 96, layer: 'back' });
    r.entities.push({ id: 'e1', type: 'playerStart', x: 400, y: 300, props: {} });
    return r;
  };

  it('grows from the top-left anchor without moving content', () => {
    const { room, shiftX, shiftY } = resizeRoom(make(), 14, 12, 0, 0);
    expect([shiftX, shiftY]).toEqual([0, 0]);
    expect(room.layers.main).toHaveLength(14 * 12);
    expect(room.layers.main[0]).toBe(1);
    expect(room.layers.main[7 * 14 + 9]).toBe(2);
    expect(room.layers.back[3 * 14 + 4]).toBe(3);
    expect(room.decor[0]).toMatchObject({ x: 48, y: 96 });
  });

  it('grows from the bottom-right anchor and shifts content and objects', () => {
    const { room, shiftX, shiftY } = resizeRoom(make(), 14, 12, 1, 1);
    expect([shiftX, shiftY]).toEqual([4, 4]);
    expect(room.layers.main[4 * 14 + 4]).toBe(1);
    expect(room.layers.main[14 * 12 - 1]).toBe(2);
    expect(room.decor[0]).toMatchObject({ x: 48 + 4 * 48, y: 96 + 4 * 48 });
    expect(room.entities[0]).toMatchObject({ x: 400 + 192, y: 300 + 192 });
  });

  it('crops when shrinking, keeps entities inside and drops far-away decor', () => {
    const r = make();
    r.decor.push({ id: 'd2', key: 'k', x: 9 * 48, y: 7 * 48, layer: 'front' });
    const { room, droppedDecor } = resizeRoom(r, 8, 6, 0, 0);
    expect(room.layers.main[0]).toBe(1);
    expect(room.layers.main).not.toContain(2);
    expect(room.layers.main).toHaveLength(48);
    expect(room.entities[0]).toMatchObject({ x: 384, y: 288 });
    expect(droppedDecor).toBe(0); // d2 is within the 2-tile margin
    const tiny = resizeRoom(r, 8, 6, 1, 1); // everything shifts left/up by 2 tiles
    expect(tiny.room.layers.main).toContain(2);
    expect(tiny.room.layers.main).not.toContain(1);
  });

  it('centre anchor splits the growth', () => {
    const { shiftX, shiftY } = resizeRoom(make(), 14, 10, 0.5, 0.5);
    expect([shiftX, shiftY]).toEqual([2, 1]);
  });

  it('does not modify the original room', () => {
    const r = make();
    const copy = JSON.stringify(r);
    resizeRoom(r, 20, 20, 0.5, 0.5);
    expect(JSON.stringify(r)).toBe(copy);
  });
});

describe('world map', () => {
  const ref = (id: string, x: number, y: number, w: number, h: number): RoomRef => ({ id, name: id, x, y, w, h });

  it('detects overlap but not touching', () => {
    expect(boxesOverlap(ref('a', 0, 0, 10, 10), ref('b', 10, 0, 10, 10))).toBe(false);
    expect(boxesOverlap(ref('a', 0, 0, 10, 10), ref('b', 9, 9, 10, 10))).toBe(true);
  });

  it('finds shared edges between touching rooms', () => {
    const refs = [ref('a', 0, 0, 10, 10), ref('b', 10, 4, 10, 10), ref('c', 0, 10, 6, 5), ref('far', 50, 50, 5, 5)];
    const edges = sharedEdges(refs);
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual({ a: 'a', b: 'b', orientation: 'vertical', pos: 10, from: 4, to: 10 });
    expect(edges).toContainEqual({ a: 'a', b: 'c', orientation: 'horizontal', pos: 10, from: 0, to: 6 });
  });

  it('rooms that only touch at a corner are not connected', () => {
    expect(sharedEdges([ref('a', 0, 0, 10, 10), ref('b', 10, 10, 10, 10)])).toEqual([]);
  });

  it('reports doorways and openings that face a wall', () => {
    const aRef = ref('a', 0, 0, 8, 6);
    const bRef = ref('b', 8, 2, 8, 6);
    const a = blankRoom('a', 'a', 8, 6, '');
    const b = blankRoom('b', 'b', 8, 6, '');
    // a's right column: solid except rows 3,4 (world rows 3,4)
    for (let y = 0; y < 6; y++) if (y !== 3 && y !== 4) a.layers.main[y * 8 + 7] = 1;
    // b's left column: solid except local row 2 (world row 4)
    for (let y = 0; y < 6; y++) if (y !== 2) b.layers.main[y * 8] = 1;
    const [edge] = sharedEdges([aRef, bRef]);
    expect(edge).toMatchObject({ from: 2, to: 6 });
    const report = inspectEdge(edge, aRef, a, bRef, b, (id) => id === 1);
    expect(report.doorways).toEqual([{ from: 4, to: 5 }]);
    expect(report.blocked).toEqual([{ from: 3, to: 4 }]);
  });

  it('finds free spots', () => {
    const refs = [ref('a', 0, 0, 10, 10)];
    expect(findFreeSpot(refs, 5, 5, 20, 20)).toEqual({ x: 20, y: 20 });
    const spot = findFreeSpot(refs, 5, 5, 3, 3);
    expect(boxesOverlap({ ...spot, w: 5, h: 5 }, refs[0])).toBe(false);
    expect(findFreeSpot(refs, 5, 5, 0, 0, 'a')).toEqual({ x: 0, y: 0 }); // ignores itself
    expect(placeNewRoom(refs, 10, 10, refs[0])).toEqual({ x: 10, y: 0 });
    expect(placeNewRoom([], 10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('ids', () => {
  it('picks the first unused room number', () => {
    expect(nextRoomId([])).toBe('room-001');
    expect(nextRoomId(['room-001', 'room-003'])).toBe('room-002');
  });
  it('names copies', () => {
    expect(copyName('Hall', ['Hall'])).toBe('Hall copy');
    expect(copyName('Hall copy', ['Hall', 'Hall copy'])).toBe('Hall copy 2');
  });
});
