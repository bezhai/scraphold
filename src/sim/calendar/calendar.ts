/** Seeded full-calendar generation and publication. V2 Task 2. */
import { CALENDAR, type NightType } from '../data/calendar';
import { DIFFICULTIES, type Difficulty } from '../data/combat';
import type { Game } from '../game';
import { nextInt, pickWeighted, type Rng } from '../rng';
import type { GameView } from '../index';
import { DAY_TICKS, TOTAL_NIGHTS } from '../time';

/** Generates all nights from the given stream, independently of map and combat randomness. */
export function generateCalendar(rng: Rng, difficulty: Difficulty): NightType[] {
  const schedules: number[][] = [];
  const visit = (days: number[]): void => {
    const range = CALENDAR.surgeWindows[days.length];
    if (!range) { schedules.push(days); return; }
    for (let day = range[0]; day <= range[1]; day++) {
      const gap = day - (days[days.length - 1] ?? day - 5);
      if (gap >= CALENDAR.minSurgeGap && gap <= CALENDAR.maxSurgeGap) visit([...days, day]);
    }
  };
  visit([]);
  const surges = schedules[nextInt(rng, 0, schedules.length - 1)]!;
  const config = DIFFICULTIES[difficulty];
  const remaining = {
    calm: config.calmNights - 1,
    rustStorm: config.stormNights,
    denseFog: config.denseFogNights,
    raid: TOTAL_NIGHTS - surges.length - config.calmNights - config.stormNights - config.denseFogNights,
  };
  const nights: NightType[] = ['calm'];
  // Backtracking guarantees the adjacency constraint without a bounded random-retry failure.
  const fill = (night: number, calmRun: number, edgeNights: number): boolean => {
    if (night > TOTAL_NIGHTS) return true;
    if (surges.includes(night)) {
      if ((edgeNights + 1) / night > CALENDAR.maxEdgeNightShare) return false;
      nights[night - 1] = 'surge'; return fill(night + 1, 0, edgeNights + 1);
    }
    const choices = (Object.keys(remaining) as (keyof typeof remaining)[]).filter((type) => remaining[type] > 0 && (type !== 'calm' || calmRun < 2) && ((type === 'calm' || type === 'rustStorm') || (edgeNights + 1) / night <= CALENDAR.maxEdgeNightShare));
    while (choices.length > 0) {
      const type = pickWeighted(rng, choices, (t) => remaining[t]);
      choices.splice(choices.indexOf(type), 1);
      remaining[type]--;
      nights[night - 1] = type;
      if (fill(night + 1, type === 'calm' ? calmRun + 1 : 0, edgeNights + Number(type === 'raid' || type === 'denseFog'))) return true;
      remaining[type]++;
    }
    return false;
  };
  if (!fill(2, 1, 0)) throw new Error('calendar: infeasible difficulty configuration');
  return nights;
}

/** Only published types are readable through state (including direct game.state reads). */
export function nightType(state: Pick<GameView, 'calendar' | 'clock'>, night = state.clock.day): NightType | null {
  return state.calendar.nights[night - 1]?.type ?? null;
}

export function calendarSystem(game: Game): void {
  const { calendar, clock, tick } = game.state;
  const through = Math.min(TOTAL_NIGHTS, clock.day + CALENDAR.previewNights);
  for (let night = calendar.revealedThroughNight + 1; night <= through; night++) calendar.nights[night - 1]!.type = game.calendarPlan[night - 1]!;
  calendar.revealedThroughNight = Math.max(calendar.revealedThroughNight, through);
  if (clock.phase === 'day' && clock.phaseTick === 0 && clock.day > 1 && game.calendarPlan[clock.day - 2] === 'rustStorm') {
    calendar.reducedVisionUntilTick = tick + DAY_TICKS;
  }
}
