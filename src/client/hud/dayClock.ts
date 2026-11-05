/**
 * Day/night clock and the dusk forecast for the HUD.
 */
import type { GameView, Phase } from '../../sim';
import { MUTANTS, MUTANT_TYPES } from '../../sim/data/combat';
import { DIRECTION_NAMES, type Direction } from '../../sim/data/map';
import { TICKS_PER_SECOND, TOTAL_NIGHTS } from '../../sim/time';

export const PHASE_NAMES: Record<Phase, string> = { day: '白天', dusk: '黄昏', night: '夜晚' };
const SIZE_NAMES = { small: '小股', medium: '成群', large: '大群' } as const;

export interface ForecastGroupView {
  direction: Direction;
  directionName: string;
  sizeName: string;
  /** "游荡者 ×6、疾行者 ×2" when the forecast is precise. */
  detail: string | null;
  /** null = unknown (imprecise forecast). */
  boss: boolean | null;
}

export interface ForecastView {
  night: number;
  directionsKnown: boolean;
  precise: boolean;
  groups: ForecastGroupView[];
}

export interface DayClockModel {
  day: number;
  totalNights: number;
  phase: Phase;
  phaseName: string;
  secondsLeft: number;
  phaseProgress: number;
  nextLabel: string;
  forecast: ForecastView | null;
}

function nextLabel(phase: Phase, day: number): string {
  if (phase === 'day') return '黄昏';
  if (phase === 'dusk') return '入夜';
  return day >= TOTAL_NIGHTS ? '胜利' : '天亮';
}

export function forecastView(view: GameView): ForecastView | null {
  const f = view.night.forecast;
  const { day, phase } = view.clock;
  if (!f || phase === 'day' || f.night !== day) return null;
  return {
    night: f.night,
    directionsKnown: f.directionsKnown,
    precise: f.precise,
    groups: f.groups.map((g) => {
      const counts = g.counts;
      const detail = counts
        ? MUTANT_TYPES.filter((t) => (counts[t] ?? 0) > 0)
            .map((t) => `${MUTANTS[t].name} ×${counts[t]}`)
            .join('、')
        : null;
      return { direction: g.direction, directionName: DIRECTION_NAMES[g.direction], sizeName: SIZE_NAMES[g.size], detail, boss: g.boss };
    }),
  };
}

export function dayClockModel(view: GameView): DayClockModel {
  const c = view.clock;
  return {
    day: c.day,
    totalNights: TOTAL_NIGHTS,
    phase: c.phase,
    phaseName: PHASE_NAMES[c.phase],
    secondsLeft: Math.ceil((c.phaseTicks - c.phaseTick) / TICKS_PER_SECOND),
    phaseProgress: c.phaseTicks > 0 ? c.phaseTick / c.phaseTicks : 0,
    nextLabel: nextLabel(c.phase, c.day),
    forecast: forecastView(view),
  };
}
