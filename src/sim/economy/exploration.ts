import { SPECIAL_RUINS } from '../data/ruins';
import { RESOURCES } from '../data/economy';
import { recruitSurvivors } from './recruitment';
/**
 * Ruin exploration: a unit reaching an unexplored ruin grants its reward once (resources,
 * survivors, a free unit, or world/fog.ts revealCircle). Owner: Task 2.
 *
 * "Reaching" means a player soldier or survivor on the map within RUIN_EXPLORE_RADIUS (edge
 * distance) of the ruin tile center. ruinRewardPct scales resource amounts and survivor counts;
 * reveal radii and free units are not scaled. Free units do not consume survivors and do not
 * count as trained.
 */
import { RUIN_FRAGMENTS } from '../data/fragments';
import { RUIN_EXPLORE_RADIUS, type RuinReward } from '../data/economy';
import { emit } from '../events';
import type { Game } from '../game';
import { tileCenter } from '../map/grid';
import type { Ruin } from '../state';
import { spawnSoldier } from '../world/entities';
import { revealCircle } from '../world/fog';
import { findNearest } from '../world/spatial';
import { gain, scaleAmounts } from './resources';

/** The reward as granted right now, after ruinRewardPct. */
export function scaledRuinReward(game: Game, reward: RuinReward): RuinReward {
  const factor = Math.max(0, 1 + game.modifiers.global.ruinRewardPct);
  switch (reward.kind) {
    case 'resources':
      return { ...reward, amounts: scaleAmounts(reward.amounts, game.modifiers.global.ruinRewardPct) };
    case 'resource':
      return { ...reward, amount: Math.round(reward.amount * factor) };
    case 'survivors':
      return { ...reward, count: Math.round(reward.count * factor) };
    default:
      return reward;
  }
}

function grant(game: Game, ruin: Ruin, reward: RuinReward): void {
  const { state } = game;
  const at = tileCenter(state.map, ruin.tile);
  switch (reward.kind) {
    case 'resources':
      for (const resource of RESOURCES) gain(state.economy.resources, state.stats, resource, reward.amounts[resource] ?? 0);
      return;
    case 'resource':
      gain(state.economy.resources, state.stats, reward.resource, reward.amount);
      return;
    case 'survivors':
      recruitSurvivors(game, at, reward.count, 'ruin');
      return;
    case 'reveal':
      revealCircle(game, at.x, at.y, reward.radius);
      return;
    case 'unit':
      spawnSoldier(game, reward.unit, at.x, at.y);
      return;
  }
}

export function explorationSystem(game: Game): void {
  const { state } = game;
  for (const ruin of state.map.ruins) {
    if (ruin.explored) continue;
    const at = tileCenter(state.map, ruin.tile);
    const visitor = findNearest(game.spatial, at.x, at.y, RUIN_EXPLORE_RADIUS, (e) => e.kind === 'survivor' || e.kind === 'soldier');
    if (!visitor) continue;
    const reward = scaledRuinReward(game, ruin.reward);
    ruin.explored = true;
    state.stats.ruinsExplored++;
    grant(game, ruin, reward);
    emit(game, { type: 'ruinExplored', ruinId: ruin.id, tile: ruin.tile, reward, feedback: ruin.kind === 'ordinary' ? null : SPECIAL_RUINS[ruin.kind].feedback });
    const fragment = RUIN_FRAGMENTS[state.incidents.fragmentIndex];
    if (fragment !== undefined) { state.incidents.fragmentIndex++; emit(game, { type: 'ruinFragment', index: state.incidents.fragmentIndex, text: fragment }); }
  }
}
