import { describe, expect, it } from 'vitest';
import { createPositionHistory, interpolatedPosition, recordPositions } from './interpolation';

const unit = (id: number, x: number, y: number) => ({ id, kind: 'soldier' as const, x, y });

describe('position history', () => {
  it('interpolates between the recorded (previous) and current position', () => {
    const h = createPositionHistory();
    const u = unit(1, 0, 0);
    recordPositions(h, [u]);
    u.x = 0.8;
    u.y = 0.4;
    expect(interpolatedPosition(h, u, 0.25)).toEqual({ x: 0.2, y: 0.1 });
    expect(interpolatedPosition(h, u, 1)).toEqual({ x: 0.8, y: 0.4 });
  });

  it('uses the current position for entities without history', () => {
    const h = createPositionHistory();
    expect(interpolatedPosition(h, unit(7, 3, 4), 0.5)).toEqual({ x: 3, y: 4 });
  });

  it('snaps instead of gliding after a teleport (e.g. leaving a building)', () => {
    const h = createPositionHistory();
    const u = unit(1, 0, 0);
    recordPositions(h, [u]);
    u.x = 10;
    expect(interpolatedPosition(h, u, 0.5)).toEqual({ x: 10, y: 0 });
  });

  it('forgets entities that are no longer recorded', () => {
    const h = createPositionHistory();
    recordPositions(h, [unit(1, 0, 0), unit(2, 0, 0)]);
    recordPositions(h, [unit(2, 0, 0)]);
    expect(h.size()).toBe(1);
  });
});
