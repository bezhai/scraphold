import { describe, expect, it } from 'vitest';
import { createTestGame } from '../../sim/testing';
import type { RuinKind } from '../../sim';
import { POOL_LEVEL, paintRuin, terrainFields, waterGlintSpots } from './terrainLayer';

const ROWS = [
  '..................',
  '.ffff.........~~~.',
  '.ffff.........~~~.',
  '.ffff.........~~~.',
  '.ffff....CCC......',
  '.........CCC......',
  '.........CCC....oo',
  '................oo',
];

describe('terrainFields', () => {
  const view = createTestGame(ROWS).state;
  const f = terrainFields(view);
  const at = (field: Float32Array, x: number, y: number) => field[y * view.map.width + x] as number;

  it('is 1 deep inside a region, 0 far away, and in between at its border (soft transitions)', () => {
    expect(at(f.soil, 2, 2)).toBeCloseTo(1, 5);
    expect(at(f.soil, 12, 6)).toBe(0);
    const border = at(f.soil, 4, 2);
    expect(border).toBeGreaterThan(0.3);
    expect(border).toBeLessThan(1);
    expect(at(f.soil, 5, 2)).toBeGreaterThan(0);
    expect(at(f.soil, 5, 2)).toBeLessThan(0.5);
  });

  it('keeps each terrain class in its own field', () => {
    expect(at(f.water, 15, 2)).toBeGreaterThan(0.5);
    expect(at(f.water, 2, 2)).toBe(0);
    expect(at(f.oil, 17, 7)).toBeGreaterThan(0.3);
    expect(at(f.scrap, 2, 2)).toBe(0);
  });
});

describe('terrainFields: pools', () => {
  const LONE = ['..........', '...o......', '..........', '.....~.CCC', '.......CCC', '.......CCC'];
  const view = createTestGame(LONE).state;
  const f = terrainFields(view);
  const at = (field: Float32Array, x: number, y: number) => field[y * view.map.width + x] as number;

  it('a lone oil or water tile still reaches pool level at its center (a puddle, not a faint smudge)', () => {
    expect(at(f.oil, 3, 1)).toBeGreaterThan(POOL_LEVEL + 0.1);
    expect(at(f.water, 5, 3)).toBeGreaterThan(POOL_LEVEL + 0.1);
  });

  it('stays below pool level on the neighbouring tiles, so the puddle keeps to its tile', () => {
    for (const [x, y] of [[2, 1], [4, 1], [3, 0], [3, 2], [2, 2]] as const) expect(at(f.oil, x, y)).toBeLessThan(POOL_LEVEL - 0.1);
    expect(at(f.oil, 2, 1)).toBeGreaterThan(0);
  });
});

describe('waterGlintSpots', () => {
  it('puts animated glints only on water, deterministically', () => {
    const view = createTestGame(ROWS).state;
    const spots = waterGlintSpots(view);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      const tile = Math.floor(s.y) * view.map.width + Math.floor(s.x);
      expect(view.map.terrain[tile]).toBe(4);
    }
    expect(waterGlintSpots(view)).toEqual(spots);
  });
});

describe('special ruins', () => {
  const RUINS = ['..........', '.r..r..r..', '..........', '.......CCC', '.......CCC', '.......CCC'];
  const W = RUINS[0]!.length;

  function mapWithKinds() {
    const game = createTestGame(RUINS);
    const kinds: RuinKind[] = ['ordinary', 'supplyPod', 'warehouse'];
    game.state.map.ruins.forEach((r, i) => (r.kind = kinds[i] as RuinKind));
    return game.state;
  }

  it('leaves a supply pod on open sand, while other ruins keep their old paving', () => {
    const f = terrainFields(mapWithKinds());
    expect(f.paving[1 * W + 4]).toBe(0);
    expect(f.paving[1 * W + 1]).toBeGreaterThan(0.2);
    expect(f.paving[1 * W + 7]).toBeGreaterThan(0.2);
  });

  /** Records every drawing call and style change made on a stand-in 2D context. */
  function recordPaint(kind: RuinKind): { log: string[]; strokes: string[] } {
    const log: string[] = [];
    const strokes: string[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get(t, key: string) {
        if (key in t) return t[key];
        return (...args: unknown[]) => {
          log.push(`${key}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : String(a))).join(',')})`);
          if (key === 'stroke') strokes.push(String(t.strokeStyle));
          return key === 'createLinearGradient' || key === 'createRadialGradient' ? { addColorStop() {} } : undefined;
        };
      },
      set(t, key: string, value) {
        t[key] = value;
        log.push(`${key}=${String(value)}`);
        return true;
      },
    });
    paintRuin(ctx as unknown as CanvasRenderingContext2D, kind, 4, 1, 7);
    return { log, strokes };
  }

  it('paints each kind of ruin with its own drawing', () => {
    const ordinary = recordPaint('ordinary').log.join(';');
    const pod = recordPaint('supplyPod').log.join(';');
    const warehouse = recordPaint('warehouse').log.join(';');
    expect(pod).not.toBe(ordinary);
    expect(warehouse).not.toBe(ordinary);
    expect(warehouse).not.toBe(pod);
    expect(pod.length).toBeGreaterThan(ordinary.length / 2);
    expect(warehouse.length).toBeGreaterThan(ordinary.length / 2);
  });

  it('outlines the special ruins with the shared dark outline', () => {
    for (const kind of ['supplyPod', 'warehouse'] as const) {
      const { strokes } = recordPaint(kind);
      expect(strokes.length).toBeGreaterThan(3);
      expect(strokes.some((s) => s.includes('26,21,16') || s === '#1a1510')).toBe(true);
    }
  });
});
