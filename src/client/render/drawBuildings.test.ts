import { describe, expect, it } from 'vitest';
import { BUILDING_TYPES } from '../../sim/data/economy';
import { buildingShadowHeight, damageStage } from './drawBuildings';

describe('damageStage', () => {
  it('is intact above two thirds, then cracked, smoking and burning', () => {
    expect(damageStage(1)).toBe(0);
    expect(damageStage(0.7)).toBe(0);
    expect(damageStage(0.6)).toBe(1);
    expect(damageStage(0.3)).toBe(2);
    expect(damageStage(0.1)).toBe(3);
  });
});

describe('buildingShadowHeight', () => {
  it('gives every building a shadow, the watchtower the longest', () => {
    for (const t of BUILDING_TYPES) expect(buildingShadowHeight(t)).toBeGreaterThan(0);
    const tallest = Math.max(...BUILDING_TYPES.map(buildingShadowHeight));
    expect(buildingShadowHeight('watchtower')).toBe(tallest);
    expect(buildingShadowHeight('barricade')).toBeLessThan(buildingShadowHeight('core'));
  });
});
