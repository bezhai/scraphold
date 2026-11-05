import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, SCORE } from '../data/combat';
import { drainEvents } from '../events';
import { stepGame } from '../pipeline';
import type { Nest } from '../state';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, GAME_END_TICK, TOTAL_NIGHTS, clockAt } from '../time';
import { spawnSoldier } from '../world/entities';
import { applyHit } from './damage';
import { scoreFor } from './outcome';

const ROWS = ['..........', '.CCC...HHH', '.CCC...HHH', '.CCC...HHH', '..........'];

function at(tick: number) {
  const game = createTestGame(ROWS, { survivors: 3 });
  game.state.tick = tick;
  game.state.clock = clockAt(tick);
  return game;
}

describe('outcome', () => {
  it('loses when the core is destroyed and stops the game', () => {
    const game = at(500);
    game.state.entities.get(game.state.coreId)!.hp = 0;
    stepGame(game);
    expect(game.state.outcome).toEqual({ status: 'lost', reason: 'coreDestroyed', endTick: 500, score: null });
    expect(drainEvents(game)).toContainEqual({ type: 'gameOver', status: 'lost', reason: 'coreDestroyed' });
    stepGame(game);
    expect(game.state.tick).toBe(501);
  });

  it('wins at once when the hive is destroyed, scoring the days left', () => {
    const game = at(3 * CYCLE_TICKS + 100);
    const hive = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest' && e.isHive)!;
    applyHit(game, spawnSoldier(game, 'sniper', 5.5, 2.5), hive, 1e7, 'pierce');
    stepGame(game);
    const o = game.state.outcome;
    expect(o).toMatchObject({ status: 'won', reason: 'hiveDestroyed', endTick: 3 * CYCLE_TICKS + 100 });
    expect(o.score!.earlyDays).toBe(SCORE.perDayEarly * (TOTAL_NIGHTS - 4));
    expect(o.score!.hive).toBe(SCORE.hiveBonus);
    expect(drainEvents(game)).toContainEqual({ type: 'gameOver', status: 'won', reason: 'hiveDestroyed' });
  });

  it('wins at the dawn after the final night', () => {
    const game = at(GAME_END_TICK - 1);
    stepGame(game);
    expect(game.state.outcome.status).toBe('playing');
    stepGame(game);
    expect(game.state.outcome).toMatchObject({ status: 'won', reason: 'survived', endTick: GAME_END_TICK });
    expect(game.state.outcome.score!.earlyDays).toBe(0);
  });

  it('scores victories from difficulty, nests, survivors and lost buildings', () => {
    const game = createTestGame(ROWS, { survivors: 4, difficulty: 'hard' });
    game.state.stats.nestsDestroyed = 2;
    game.state.stats.buildingsLost = 3;
    game.state.stats.hiveDestroyed = true;
    game.state.tick = GAME_END_TICK - CYCLE_TICKS - 10;
    const s = scoreFor(game, 'hiveDestroyed');
    const sum = SCORE.victory + SCORE.perDayEarly + SCORE.hiveBonus + 2 * SCORE.perNestDestroyed + 4 * SCORE.perSurvivorAlive + 3 * SCORE.perBuildingLost;
    expect(s).toEqual({
      victory: SCORE.victory,
      earlyDays: SCORE.perDayEarly,
      hive: SCORE.hiveBonus,
      nests: 2 * SCORE.perNestDestroyed,
      survivors: 4 * SCORE.perSurvivorAlive,
      buildingsLost: 3 * SCORE.perBuildingLost,
      multiplier: DIFFICULTIES.hard.scoreMultiplier,
      total: Math.round(sum * DIFFICULTIES.hard.scoreMultiplier),
    });
  });

  it('never scores below zero', () => {
    const game = createTestGame(ROWS);
    game.state.stats.buildingsLost = 1000;
    game.state.tick = GAME_END_TICK;
    expect(scoreFor(game, 'survived').total).toBe(0);
  });
});
