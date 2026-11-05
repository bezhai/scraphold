/** Calendar state. Generation and publication implemented by calendar.ts; weather rules by weather.ts. */
import { CALENDAR, type NightType } from '../data/calendar';
import { generateCalendar } from './calendar';
import type { Difficulty } from '../data/combat';
import type { Rng } from '../rng';
import { TOTAL_NIGHTS } from '../time';

export interface CalendarNight {
  /** 1-based night number; stored at nights[night - 1]. */
  night: number;
  /** null for unrevealed nights; it does not mean a calm night. */
  type: NightType | null;
}

export interface CalendarState {
  nights: CalendarNight[];
  /** RNG checkpoint: derived full calendar is rebuilt from this on load. Never consumed. */
  generationRng: Rng;
  /** Highest published night, inclusive; starts at tonight plus the preview window. */
  revealedThroughNight: number;
  /** Post-storm sight penalty ends at this tick (exclusive), -1 when inactive. */
  reducedVisionUntilTick: number;
}

export function createCalendarState(rng: Rng, difficulty: Difficulty): CalendarState {
  const generationRng = { ...rng };
  const plan = generateCalendar(rng, difficulty);
  const through = 1 + CALENDAR.previewNights;
  return {
    nights: Array.from({ length: TOTAL_NIGHTS }, (_, i) => ({ night: i + 1, type: i < through ? plan[i]! : null })),
    generationRng,
    revealedThroughNight: through,
    reducedVisionUntilTick: -1,
  };
}
