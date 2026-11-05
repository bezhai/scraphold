import { describe, expect, it } from 'vitest';
import { SETTLE_FRAMES, drawDiameter, nearestStep, spriteKey, spriteScale, zoomStep } from './unitSprites';

describe('zoomStep', () => {
  it('rounds the scale to nearby steps so small zoom changes reuse sprites', () => {
    expect(zoomStep(30)).toBe(zoomStep(30.4));
    for (const z of [12, 20, 30, 44, 64, 80, 160]) expect(Math.abs(zoomStep(z) / z - 1)).toBeLessThan(0.05);
    expect(zoomStep(40)).toBeGreaterThan(zoomStep(30));
  });
});

describe('spriteScale', () => {
  it('uses the shared zoom steps while the zoom is moving', () => {
    expect(spriteScale(44.3, 0)).toBe(zoomStep(44.3));
    expect(spriteScale(44.3, SETTLE_FRAMES - 1)).toBe(zoomStep(44.3));
  });

  it('paints at the exact scale once the zoom holds still, so sprites copy 1:1', () => {
    expect(spriteScale(44, SETTLE_FRAMES)).toBe(44);
    expect(spriteScale(37.123, SETTLE_FRAMES + 50)).toBe(37.12);
  });
});

describe('spriteKey', () => {
  it('differs by subject, facing and frame (each key holds that sprite at every scale)', () => {
    const base = spriteKey({ kind: 'soldier', type: 'rifleman' }, 3, 'idle');
    expect(spriteKey({ kind: 'soldier', type: 'rifleman' }, 3, 'idle')).toBe(base);
    for (const other of [
      spriteKey({ kind: 'soldier', type: 'sniper' }, 3, 'idle'),
      spriteKey({ kind: 'mutant', type: 'runner' }, 3, 'idle'),
      spriteKey({ kind: 'survivor' }, 3, 'idle'),
      spriteKey({ kind: 'soldier', type: 'rifleman' }, 4, 'idle'),
      spriteKey({ kind: 'soldier', type: 'rifleman' }, 3, 'stepA'),
    ])
      expect(other).not.toBe(base);
  });
});

describe('nearestStep', () => {
  it('picks the cached zoom step closest in scale, or null when none is cached', () => {
    expect(nearestStep([], 44)).toBeNull();
    expect(nearestStep([20, 40, 80], 44)).toBe(40);
    expect(nearestStep([20, 40, 80], 70)).toBe(80);
  });
});

describe('drawDiameter', () => {
  it('follows the art direction sizes: soldiers ~0.7 tiles, mutants graded by bulk', () => {
    expect(drawDiameter({ kind: 'soldier', type: 'rifleman' })).toBeCloseTo(0.7, 1);
    const m = (type: 'runner' | 'wanderer' | 'spitter' | 'boomer' | 'crawler' | 'behemoth') => drawDiameter({ kind: 'mutant', type });
    expect(m('runner')).toBeCloseTo(0.6, 1);
    expect(m('wanderer')).toBeCloseTo(0.7, 1);
    expect(m('spitter')).toBeCloseTo(0.8, 1);
    expect(m('boomer')).toBeCloseTo(0.9, 1);
    expect(m('crawler')).toBeCloseTo(1.1, 1);
    expect(m('behemoth')).toBeCloseTo(2, 1);
  });
});
