import { describe, expect, it } from 'vitest';
import { particleSide } from './effectSprites';

describe('particleSide', () => {
  it('rounds small particles to whole pixels', () => {
    expect(particleSide(5.4)).toBe(5);
    expect(particleSide(5.6)).toBe(6);
    expect(particleSide(0.2)).toBe(1);
  });

  it('rounds bigger particles more coarsely, so a growing puff reuses a few sprites', () => {
    expect(particleSide(20.9) % 2).toBe(0);
    expect(particleSide(101) % 4).toBe(0);
    for (const d of [3, 17, 30, 47, 49, 80, 150]) expect(Math.abs(particleSide(d) - d)).toBeLessThanOrEqual(2);
  });
});
