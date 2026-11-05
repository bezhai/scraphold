import { expect, it } from 'vitest';
import { edgeNightBudget, nestNightThreat } from '../index';
import { DIFFICULTIES, NIGHTS } from '../data/combat';

it('exposes shared budgets and returns zero for quiet or undisclosed nights', () => {
  expect(typeof nestNightThreat).toBe('function');
  for (const type of [null, 'calm', 'rustStorm'] as const) expect(edgeNightBudget(5, 'hard', type)).toBe(0);
  expect(edgeNightBudget(5, 'normal', 'raid')).toBe(NIGHTS[4]!.budget);
  expect(edgeNightBudget(5, 'normal', 'denseFog')).toBe(edgeNightBudget(5, 'normal', 'raid'));
  expect(edgeNightBudget(5, 'hard', 'surge')).toBeCloseTo(NIGHTS[4]!.budget * DIFFICULTIES.hard.nightBudgetPct * DIFFICULTIES.hard.surgeBudgetMultiplier);
});
