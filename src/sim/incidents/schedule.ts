import { INCIDENT_RULES } from '../data/incidents';
import { nextInt, shuffle, type Rng } from '../rng';
import { TOTAL_NIGHTS } from '../time';

/** Randomized bounded search guarantees the quota and both streak limits, without retry caps. */
export function generateEventDays(rng: Rng): number[] {
  const rules = INCIDENT_RULES;
  const total = nextInt(rng, rules.minEvents, rules.maxEvents);
  const days: number[] = [];
  function fill(day: number, on: number, off: number): boolean {
    if (days.length > total || days.length + TOTAL_NIGHTS - day + 1 < total) return false;
    if (day > TOTAL_NIGHTS) return days.length === total;
    for (const event of shuffle(rng, [true, false])) {
      if (event ? on >= rules.maxEventStreak : off >= rules.maxEmptyStreak) continue;
      if (event) days.push(day);
      if (fill(day + 1, event ? on + 1 : 0, event ? 0 : off + 1)) return true;
      if (event) days.pop();
    }
    return false;
  }
  if (!fill(rules.firstDay, 0, rules.firstDay - 1)) throw new Error('No valid incident schedule');
  return days;
}
