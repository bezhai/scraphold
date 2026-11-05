import { describe, expect, it } from 'vitest';
import { CYCLE_TICKS, GAME_END_TICK, TICKS_PER_SECOND, TOTAL_NIGHTS, clockAt, secondsToTicks } from './time';

describe('clockAt', () => {
  it('starts on day 1 in the day phase', () => {
    expect(clockAt(0)).toMatchObject({ day: 1, phase: 'day', phaseTick: 0 });
  });

  it('enters dusk for the last 15 seconds of the day and night after 60 seconds', () => {
    expect(clockAt(secondsToTicks(45) - 1).phase).toBe('day');
    expect(clockAt(secondsToTicks(45))).toMatchObject({ day: 1, phase: 'dusk', phaseTick: 0 });
    expect(clockAt(secondsToTicks(60) - 1).phase).toBe('dusk');
    expect(clockAt(secondsToTicks(60))).toMatchObject({ day: 1, phase: 'night', phaseTick: 0 });
  });

  it('starts day 2 after a 50 second night', () => {
    expect(clockAt(secondsToTicks(110) - 1)).toMatchObject({ day: 1, phase: 'night' });
    expect(clockAt(secondsToTicks(110))).toMatchObject({ day: 2, phase: 'day', phaseTick: 0 });
    expect(CYCLE_TICKS).toBe(secondsToTicks(110));
  });

  it('ends the last night at the following dawn, taking about 37 minutes at 1x', () => {
    expect(GAME_END_TICK).toBe(TOTAL_NIGHTS * CYCLE_TICKS);
    expect(clockAt(GAME_END_TICK)).toMatchObject({ day: TOTAL_NIGHTS + 1, phase: 'day', phaseTick: 0 });
    const minutes = GAME_END_TICK / TICKS_PER_SECOND / 60;
    expect(minutes).toBeGreaterThanOrEqual(36);
    expect(minutes).toBeLessThanOrEqual(37);
  });

  it('reports remaining ticks of the current phase', () => {
    const c = clockAt(secondsToTicks(70));
    expect(c.phaseTicks - c.phaseTick).toBe(secondsToTicks(40));
  });
});
