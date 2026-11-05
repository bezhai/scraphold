import { describe, expect, it } from 'vitest';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE } from '../../sim';
import { FOG_FADE_MS, createFogLevels, easeFogLevels } from './fogField';

describe('fog levels', () => {
  it('start at their targets: no fade on the first frame of a game', () => {
    const levels = createFogLevels(Uint8Array.from([FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE]));
    expect([...levels.explored]).toEqual([0, 1, 1]);
    expect([...levels.visible]).toEqual([0, 0, 1]);
  });

  it('ease toward a new fog state over FOG_FADE_MS and report the changed tiles', () => {
    const fog = Uint8Array.from([FOG_UNEXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, FOG_VISIBLE]);
    const levels = createFogLevels(fog);
    fog[1] = FOG_VISIBLE;
    fog[2] = FOG_EXPLORED;
    const first = easeFogLevels(levels, fog, 2, FOG_FADE_MS / 2);
    expect(first).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(levels.visible[1]).toBeCloseTo(0.5, 5);
    expect(levels.visible[2]).toBeCloseTo(0.5, 5);
    easeFogLevels(levels, fog, 2, FOG_FADE_MS);
    expect([...levels.explored]).toEqual([0, 1, 1, 1]);
    expect([...levels.visible]).toEqual([0, 1, 0, 1]);
    expect(easeFogLevels(levels, fog, 2, 16)).toBeNull();
  });
});
