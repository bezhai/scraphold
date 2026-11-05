/**
 * Fixed-step simulation clock. One tick = 1/20 s. A day is 60 s (the last 15 s are dusk), a night 50 s.
 * Night N follows day N; surviving night 20 means reaching the dawn of day 21 (GAME_END_TICK).
 * All durations in data tables are written in seconds and converted with secondsToTicks.
 */

export const TICKS_PER_SECOND = 20;
export const DAY_SECONDS = 60;
export const DUSK_SECONDS = 15;
export const NIGHT_SECONDS = 50;
export const TOTAL_NIGHTS = 20;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** Converts a per-second rate (resources/s, tiles/s) into a per-tick amount. */
export function perSecondToPerTick(perSecond: number): number {
  return perSecond / TICKS_PER_SECOND;
}

export const DAY_TICKS = secondsToTicks(DAY_SECONDS);
export const DUSK_TICKS = secondsToTicks(DUSK_SECONDS);
export const NIGHT_TICKS = secondsToTicks(NIGHT_SECONDS);
export const CYCLE_TICKS = DAY_TICKS + NIGHT_TICKS;
/** First tick of day 21: the 20th night is over. */
export const GAME_END_TICK = TOTAL_NIGHTS * CYCLE_TICKS;

export type Phase = 'day' | 'dusk' | 'night';

export interface ClockState {
  /** 1-based day number; during the night phase this is also the night number. */
  day: number;
  phase: Phase;
  /** Ticks elapsed since the current phase began (0 on the first tick of a phase). */
  phaseTick: number;
  /** Total length of the current phase in ticks. */
  phaseTicks: number;
}

export function clockAt(tick: number): ClockState {
  const day = Math.floor(tick / CYCLE_TICKS) + 1;
  const inCycle = tick - (day - 1) * CYCLE_TICKS;
  const duskStart = DAY_TICKS - DUSK_TICKS;
  if (inCycle < duskStart) return { day, phase: 'day', phaseTick: inCycle, phaseTicks: duskStart };
  if (inCycle < DAY_TICKS) return { day, phase: 'dusk', phaseTick: inCycle - duskStart, phaseTicks: DUSK_TICKS };
  return { day, phase: 'night', phaseTick: inCycle - DAY_TICKS, phaseTicks: NIGHT_TICKS };
}

/** Daytime includes dusk: policies may only be changed while this is true. */
export function isDaytime(phase: Phase): boolean {
  return phase !== 'night';
}
