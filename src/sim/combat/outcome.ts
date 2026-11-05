/**
 * Victory and defeat: core destroyed -> lost; dawn of day 21 (time.ts GAME_END_TICK) or hive
 * destroyed -> won; score from data/combat.ts SCORE (victories only). Sets state.outcome and
 * emits gameOver; stepGame stops advancing once status is not 'playing'. Owner: Task 3.
 *
 * A destroyed core loses even if the hive falls in the same tick. Score parts: the victory, full
 * day cycles left when the hive falls early, the hive bonus, destroyed nests, living survivors and
 * lost buildings; the sum times the difficulty multiplier, rounded and floored at 0.
 */
import { SIGNAL_TEXT } from '../data/signal';
import { signalMessage } from '../signal/signal';
import { DIFFICULTIES, SCORE } from '../data/combat';
import { emit } from '../events';
import type { Game } from '../game';
import { CYCLE_TICKS, GAME_END_TICK, TOTAL_NIGHTS } from '../time';
import type { Outcome, ScoreBreakdown, VictoryMethod } from './model';

export function scoreFor(game: Game, reason: VictoryMethod): ScoreBreakdown {
  const { state } = game;
  const stats = state.stats;
  let survivors = 0;
  for (const e of state.entities.values()) if (e.kind === 'survivor' && e.hp > 0) survivors++;
  const parts = {
    victory: SCORE.victory + (reason === 'signal' ? SCORE.signalBonus : 0),
    earlyDays: reason !== 'survived' ? SCORE.perDayEarly * Math.floor(Math.max(0, GAME_END_TICK - state.tick) / CYCLE_TICKS) : 0,
    hive: reason === 'hiveDestroyed' ? SCORE.hiveBonus : 0,
    nests: SCORE.perNestDestroyed * stats.nestsDestroyed,
    survivors: SCORE.perSurvivorAlive * survivors,
    buildingsLost: SCORE.perBuildingLost * stats.buildingsLost,
  };
  const multiplier = DIFFICULTIES[state.options.difficulty].scoreMultiplier;
  const sum = parts.victory + parts.earlyDays + parts.hive + parts.nests + parts.survivors + parts.buildingsLost;
  return { ...parts, multiplier, total: Math.max(0, Math.round(sum * multiplier)) };
}

function end(game: Game, status: 'won' | 'lost', reason: NonNullable<Outcome['reason']>): void {
  const score = status === 'won' && reason !== 'coreDestroyed' ? scoreFor(game, reason) : null;
  game.state.outcome = { status, reason, endTick: game.state.tick, score };
  emit(game, { type: 'gameOver', status, reason });
}

export function outcomeSystem(game: Game): void {
  const { state } = game;
  if (state.outcome.status !== 'playing') return;
  const core = state.entities.get(state.coreId);
  if (!core || core.hp <= 0) end(game, 'lost', 'coreDestroyed');
  else if (state.stats.hiveDestroyed) end(game, 'won', 'hiveDestroyed');
  else if (state.signal.stage === 'broadcast' && state.signal.nightsHeld >= state.signal.nightsRequired) {
    end(game, 'won', 'signal'); signalMessage(game, SIGNAL_TEXT.endingTitle); signalMessage(game, SIGNAL_TEXT.ending);
  }
  else if (state.clock.day > TOTAL_NIGHTS) end(game, 'won', 'survived');
}
