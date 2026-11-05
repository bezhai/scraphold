import { expect, it } from 'vitest';
import { createGame, drainEvents, stepGame } from '../index';
import { planNight, forecastFor } from './night';
import { spawnSoldier } from '../world/entities';
import { CYCLE_TICKS } from '../time';

it.each(Array.from({ length: 20 }, (_, i) => `balance-${i + 1}`))('%s second-night raids have at most two populated directions', seed => {
  const game = createGame({ seed, origin: 'scavengers', difficulty: 'normal' });
  game.calendarPlan[1] = 'raid';
  for (const entity of game.state.entities.values()) if (entity.kind === 'nest') entity.growth.level = 2;
  const plan = planNight(game, 2);
  const groups = plan.groups.filter(group => Object.values(group.mutants).some(count => count > 0));
  expect(new Set(groups.map(group => group.direction)).size).toBeLessThanOrEqual(2);
  expect(forecastFor(plan, false, 'raid').groups.length).toBeLessThanOrEqual(2);
  expect(groups.reduce((sum, group) => sum + Object.values(group.mutants).reduce((a, b) => a + b, 0), 0)).toBeLessThanOrEqual(24);
});

it.each(['balance-1', 'balance-3', 'balance-6'])('%s three starter riflemen can defend the core through night two', seed => {
  const game = createGame({ seed, origin: 'scavengers', difficulty: 'normal' });
  const core = game.state.entities.get(game.state.coreId)!;
  for (let i = 0; i < 3; i++) spawnSoldier(game, 'rifleman', core.x, core.y + 2);
  game.calendarPlan[1] = 'raid';
  while (game.state.tick < 2 * CYCLE_TICKS && game.state.outcome.status === 'playing') {
    stepGame(game);
    drainEvents(game);
  }
  expect(game.state.outcome.status).toBe('playing');
});
