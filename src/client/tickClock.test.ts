import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_FRAME, advanceTicks, nextSpeed, ticksPerSecondAt } from './tickClock';

describe('ticksPerSecondAt', () => {
  it('maps 1x/2x/3x to 20/40/60 ticks per second', () => {
    expect([1, 2, 3].map((s) => ticksPerSecondAt(s as 1 | 2 | 3))).toEqual([20, 40, 60]);
  });
});

describe('advanceTicks', () => {
  it('accumulates frame time into whole ticks and keeps the fraction as alpha', () => {
    // 1x: 20 ticks/s, 75 ms => 1.5 ticks
    const r = advanceTicks(0, 75, 1, false);
    expect(r.steps).toBe(1);
    expect(r.carry).toBeCloseTo(0.5);
    expect(r.alpha).toBeCloseTo(0.5);
    const r2 = advanceTicks(r.carry, 25, 1, false);
    expect(r2.steps).toBe(1);
    expect(r2.carry).toBeCloseTo(0);
  });

  it('runs proportionally more ticks at higher speed', () => {
    expect(advanceTicks(0, 100, 3, false).steps).toBe(6);
  });

  it('does not step while paused and freezes alpha', () => {
    const r = advanceTicks(0.4, 500, 2, true);
    expect(r).toEqual({ steps: 0, carry: 0.4, alpha: 0.4 });
  });

  it('caps the steps of a long frame and drops the backlog', () => {
    const r = advanceTicks(0, 5000, 3, false);
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.carry).toBeLessThan(1);
  });
});

describe('nextSpeed', () => {
  it('steps up and down within 1..3', () => {
    expect(nextSpeed(1, 1)).toBe(2);
    expect(nextSpeed(3, 1)).toBe(3);
    expect(nextSpeed(2, -1)).toBe(1);
    expect(nextSpeed(1, -1)).toBe(1);
  });
});
