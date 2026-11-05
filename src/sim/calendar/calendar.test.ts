import { describe, expect, it } from 'vitest';
import { generateCalendar, calendarSystem } from './calendar';
import { CALENDAR, NIGHT_TYPES } from '../data/calendar';
import { DIFFICULTY_IDS } from '../data/combat';
import { makeRng } from '../rng';
import { createGame, viewState, hashState, serializeGame, restoreGame } from '../index';
import { CYCLE_TICKS, TOTAL_NIGHTS, clockAt } from '../time';

for (const difficulty of DIFFICULTY_IDS) {
  describe(`calendar ${difficulty}`, () => {
    it.each(Array.from({ length: 100 }, (_, i) => i))('satisfies all constraints for seed %i', (seed) => {
      const nights = generateCalendar(makeRng(seed), difficulty);
      expect(nights).toHaveLength(TOTAL_NIGHTS);
      expect(nights[0]).toBe('calm');
      expect(nights[TOTAL_NIGHTS - 1]).toBe('surge');
      const surges = nights.flatMap((type, i) => type === 'surge' ? [i + 1] : []);
      expect(surges).toHaveLength(CALENDAR.surgeWindows.length);
      surges.forEach((night, i) => {
        expect(night).toBeGreaterThanOrEqual(CALENDAR.surgeWindows[i]![0]);
        expect(night).toBeLessThanOrEqual(CALENDAR.surgeWindows[i]![1]);
        if (i > 0) expect(night - surges[i - 1]!).toBeGreaterThanOrEqual(4);
        if (i > 0) expect(night - surges[i - 1]!).toBeLessThanOrEqual(6);
      });
      let calmRun = 0;
      for (const type of nights) {
        expect(NIGHT_TYPES).toContain(type);
        calmRun = type === 'calm' ? calmRun + 1 : 0;
        expect(calmRun).toBeLessThanOrEqual(2);
      }
      for (let count = 1; count <= nights.length; count++) {
        const attacks = nights.slice(0, count).filter(n => n !== 'calm' && n !== 'rustStorm').length;
        expect(attacks / count).toBeLessThanOrEqual(0.65);
      }
      expect(nights.filter((n) => n === 'calm' || n === 'rustStorm').length).toBeGreaterThanOrEqual(5);
      expect(nights).toEqual(generateCalendar(makeRng(seed), difficulty));
    });
  });
}

it('publishes tonight plus three nights, hides all later types, and restores the same plan', () => {
  const game = createGame({ seed: 'calendar-public', origin: 'militia', difficulty: 'normal' });
  const publicCalendar = viewState(game).calendar;
  expect(publicCalendar.revealedThroughNight).toBe(4);
  expect(publicCalendar.nights.slice(0, 4).every((n) => n.type !== null)).toBe(true);
  expect(publicCalendar.nights.slice(4).every((n) => n.type === null)).toBe(true);
  const original = hashState(game);
  const restored = restoreGame(serializeGame(game))!;
  expect(hashState(restored)).toBe(original);
  expect(restored.calendarPlan).toEqual(game.calendarPlan);
  for (const g of [game, restored]) {
    g.state.tick = CYCLE_TICKS * 2;
    g.state.clock = clockAt(g.state.tick);
    calendarSystem(g);
  }
  expect(hashState(restored)).toBe(hashState(game));
  expect(game.state.calendar.revealedThroughNight).toBe(6);
  expect(game.state.calendar.nights.slice(6).every((n) => n.type === null)).toBe(true);
});

it('reduces calm nights with difficulty without losing the quiet-night minimum', () => {
  const calm = DIFFICULTY_IDS.map((difficulty) => generateCalendar(makeRng(55), difficulty).filter((n) => n === 'calm').length);
  expect(calm[0]).toBeGreaterThan(calm[1]!);
  expect(calm[1]).toBeGreaterThan(calm[2]!);
});
