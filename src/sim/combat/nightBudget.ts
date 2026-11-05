/** Base edge-attack budget; incidents adjust planned edge groups separately. */
import type { NightType } from '../data/calendar';
import { DIFFICULTIES, NIGHTS, type Difficulty } from '../data/combat';

export function edgeNightBudget(night: number, difficulty: Difficulty, type: NightType | null): number {
  if (type === null || type === 'calm' || type === 'rustStorm') return 0;
  const def = NIGHTS[night - 1];
  const diff = DIFFICULTIES[difficulty];
  return def ? def.budget * diff.nightBudgetPct * (type === 'surge' ? diff.surgeBudgetMultiplier : 1) : 0;
}
