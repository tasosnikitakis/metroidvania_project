import { describe, expect, it } from 'vitest';
import {
  blankRoom, repairBackgrounds, repairDecorCatalog, repairProp, repairRoom, repairTileset, repairWorld, syncRefSizes,
  type RepairContext,
} from '../src/editor/world/logic/validate';

const ctx: RepairContext = {
  id: 'room-001',
  tileIds: new Set([1, 2, 3]),
  decorKeys: new Set(['torch']),
  backgrounds: ['castle', 'forest'],
};

describe('repairRoom', () => {
  it('leaves a good room unchanged and reports nothing', () => {
    const room = blankRoom('room-001', 'Hall', 10, 8, 'castle');
    room.layers.main[5] = 2;
    room.decor.push({ id: 'd1', key: 'torch', x: 10, y: 20, layer: 'front', flipX: true });
    room.entities.push({ id: 'e1', type: 'light', x: 5, y: 5, props: { color: '#ffffff', radius: 100, intensity: 0.5, flicker: 0 } });
    const { value, fixes } = repairRoom(JSON.parse(JSON.stringify(room)), ctx);
    expect(fixes).toEqual([]);
    expect(value).toEqual(room);
  });

  it('builds an empty room from nothing', () => {
    const { value, fixes } = repairRoom(undefined, { ...ctx, name: 'Lost', width: 40, height: 20 });
    expect(value.width).toBe(40);
    expect(value.height).toBe(20);
    expect(value.name).toBe('Lost');
    expect(value.layers.main).toHaveLength(800);
    expect(value.background).toBe('castle');
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('fixes wrong layer lengths (pads and truncates)', () => {
    const raw = { ...blankRoom('x', 'X', 10, 8, 'castle'), layers: { back: [1, 2], main: new Array(500).fill(3), front: 'nope' } };
    const { value, fixes } = repairRoom(raw, ctx);
    expect(value.layers.back).toHaveLength(80);
    expect(value.layers.back.slice(0, 3)).toEqual([1, 2, 0]);
    expect(value.layers.main).toHaveLength(80);
    expect(value.layers.front).toHaveLength(80);
    expect(fixes.join('\n')).toMatch(/back/);
    expect(fixes.join('\n')).toMatch(/front/);
    expect(value.id).toBe('room-001'); // id always follows the world map / file name
  });

  it('removes unknown, negative and non-numeric tiles', () => {
    const raw = blankRoom('x', 'X', 10, 8, 'castle') as unknown as { layers: { main: unknown[] } };
    raw.layers.main[0] = 99; raw.layers.main[1] = -1; raw.layers.main[2] = 'a'; raw.layers.main[3] = 1.5; raw.layers.main[4] = 3; raw.layers.main[5] = null;
    const { value, fixes } = repairRoom(raw, ctx);
    expect(value.layers.main.slice(0, 6)).toEqual([0, 0, 0, 0, 3, 0]);
    expect(fixes.some((f) => /5 unknown tiles/.test(f))).toBe(true);
  });

  it('does not judge tiles or decor when the catalogs are unavailable', () => {
    const raw = blankRoom('x', 'X', 10, 8, 'spooky');
    raw.layers.main[0] = 999;
    raw.decor.push({ id: 'd', key: 'mystery', x: 0, y: 0, layer: 'back' });
    const { value } = repairRoom(raw, { ...ctx, tileIds: null, decorKeys: null, backgrounds: [] });
    expect(value.layers.main[0]).toBe(999);
    expect(value.decor).toHaveLength(1);
    expect(value.background).toBe('spooky');
  });

  it('drops unknown decor and entity types, fixes ids, layers and props', () => {
    const raw = {
      ...blankRoom('x', 'X', 10, 8, 'nowhere'),
      decor: [
        { id: 'same', key: 'torch', x: 1, y: 2, layer: 'weird', scale: 'big', alpha: 7 },
        { id: 'same', key: 'torch', x: 'NaN', y: 2, layer: 'far' },
        { id: 'gone', key: 'dragon', x: 0, y: 0, layer: 'back' },
        null,
      ],
      entities: [
        { id: 'p1', type: 'playerStart', x: 99999, y: -5, props: { facing: 'up' } },
        { id: 'p2', type: 'playerStart', x: 10, y: 10, props: {} },
        { id: 'l', type: 'light', x: 10, y: 10, props: { radius: 5000, color: 'red', custom: 'kept', bad: { a: 1 } } },
        { id: 'z', type: 'zombie', x: 0, y: 0, props: {} },
        { type: 'checkpoint', x: 1, y: 1 },
      ],
    };
    const { value, fixes } = repairRoom(raw, ctx);
    expect(value.decor).toHaveLength(2);
    expect(value.decor[0]).toMatchObject({ layer: 'back', scale: 1, alpha: 1 });
    expect(value.decor[1].x).toBe(0);
    expect(new Set(value.decor.map((d) => d.id)).size).toBe(2);
    expect(value.entities.map((e) => e.type)).toEqual(['playerStart', 'light', 'checkpoint']);
    expect(value.entities[0]).toMatchObject({ x: 480, y: 0, props: { facing: 'right' } });
    expect(value.entities[1].props).toMatchObject({ radius: 900, color: '#ffcc88', intensity: 0.6, custom: 'kept' });
    expect(value.entities[1].props).not.toHaveProperty('bad');
    expect(value.entities[2].id).toBeTruthy();
    expect(value.entities[2].props).toEqual({});
    expect(value.background).toBe('castle');
    expect(fixes.join('\n')).toMatch(/decor/);
    expect(fixes.join('\n')).toMatch(/unknown type/);
    expect(fixes.join('\n')).toMatch(/duplicate/);
  });

  it('clamps silly sizes', () => {
    const { value } = repairRoom({ width: 100000, height: -3 }, ctx);
    expect(value.width).toBe(400);
    expect(value.height).toBe(6);
  });

  it('never throws on garbage', () => {
    for (const junk of [null, 5, 'x', [], { layers: 5, decor: 'a', entities: {} }, { layers: { main: [[]] } }]) {
      expect(() => repairRoom(junk, ctx)).not.toThrow();
    }
  });

  it('keeps extra fields other tools added', () => {
    const { value } = repairRoom({ ...blankRoom('x', 'X', 10, 8, 'castle'), music: 'spooky.ogg' }, ctx);
    expect((value as unknown as { music: string }).music).toBe('spooky.ogg');
  });
});

describe('repairProp', () => {
  it('coerces each kind', () => {
    expect(repairProp({ kind: 'number', default: 5, min: 0, max: 10 }, 50)).toBe(10);
    expect(repairProp({ kind: 'number', default: 5 }, 'x')).toBe(5);
    expect(repairProp({ kind: 'boolean', default: true }, 0)).toBe(true);
    expect(repairProp({ kind: 'string', default: 'a' }, 'b')).toBe('b');
    expect(repairProp({ kind: 'color', default: '#000000' }, '#12abEF')).toBe('#12abEF');
    expect(repairProp({ kind: 'color', default: '#000000' }, 'blue')).toBe('#000000');
    expect(repairProp({ kind: 'select', default: 'a', options: ['a', 'b'] }, 'c')).toBe('a');
  });
});

describe('repairWorld', () => {
  it('creates an empty world from nothing', () => {
    const { value } = repairWorld(null);
    expect(value).toMatchObject({ version: 1, startRoom: '', rooms: [] });
    expect(value.name).toBeTruthy();
  });

  it('removes broken and duplicate rooms and fixes the start room', () => {
    const { value, fixes } = repairWorld({
      name: 'W', startRoom: 'nope',
      rooms: [
        { id: 'a', name: 'A', x: 1.4, y: 0, w: 30, h: 17 },
        { id: 'a', name: 'A again', x: 0, y: 0, w: 30, h: 17 },
        { id: '../evil', name: 'E', x: 0, y: 0, w: 1, h: 1 },
        'junk',
        { id: 'b', x: 'q', w: 0 },
      ],
    });
    expect(value.rooms.map((r) => r.id)).toEqual(['a', 'b']);
    expect(value.rooms[0].x).toBe(1);
    expect(value.rooms[1]).toMatchObject({ name: 'b', x: 0, y: 0, w: 8, h: 17 });
    expect(value.startRoom).toBe('a');
    expect(fixes.length).toBeGreaterThan(0);
  });

  it('syncs map entries with the real room sizes', () => {
    const { value } = repairWorld({ rooms: [{ id: 'a', name: 'old', x: 0, y: 0, w: 30, h: 17 }] });
    const rooms = new Map([['a', blankRoom('a', 'New name', 50, 20, '')]]);
    expect(syncRefSizes(value, rooms)).toBe(true);
    expect(value.rooms[0]).toMatchObject({ w: 50, h: 20, name: 'New name' });
    expect(syncRefSizes(value, rooms)).toBe(false);
  });
});

describe('catalog repair', () => {
  it('tileset: drops bad tiles, pads terrains to 16 entries', () => {
    const { value } = repairTileset({
      image: 'a.png', tileSize: 48, imageScale: 2, columns: 4,
      tiles: [{ id: 1, name: 'a', collision: 'solid', group: 'g' }, { id: 1 }, { id: 0 }, { id: 2, collision: 'lava' }, 'x'],
      terrains: [
        { name: 'T', layer: 'main', tiles: [1, 2, 77], fillVariants: [2, 88] },
        { name: 'Empty', tiles: [99] },
        { name: 'Nope' },
      ],
    });
    expect(value.tiles.map((t) => t.id)).toEqual([1, 2]);
    expect(value.tiles[1]).toMatchObject({ collision: 'none', group: 'other' });
    expect(value.terrains).toHaveLength(1);
    expect(value.terrains[0].tiles).toHaveLength(16);
    expect(value.terrains[0].tiles.slice(0, 3)).toEqual([1, 2, 1]);
    expect(value.terrains[0].fillVariants).toEqual([2]);
    expect(repairTileset(null).value.tiles).toEqual([]);
  });

  it('decor and backgrounds tolerate junk', () => {
    expect(repairDecorCatalog(null).decor).toEqual([]);
    expect(repairDecorCatalog({ decor: [{ key: 'a' }, { key: 'a' }, 5] }).decor).toHaveLength(1);
    expect(repairDecorCatalog({ decor: [{ key: 'a' }] }).decor[0]).toMatchObject({ originX: 0.5, originY: 1, w: 48 });
    expect(repairBackgrounds('x').backgrounds).toEqual([]);
    expect(repairBackgrounds({ backgrounds: [{ key: 'c', layers: [{ image: 'a.png' }, 4] }] }).backgrounds[0].layers).toHaveLength(1);
  });
});
