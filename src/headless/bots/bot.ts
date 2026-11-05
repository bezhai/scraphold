import { chooseIncident, pursueIncident } from './incidents';
/**
 * A strategy as a runHeadless controller (Task 5). The bot decides every DECISION_TICKS ticks
 * (half a second), in a fixed order: promotions, research, policies, soldiers (roles, scouts,
 * raids, defense), construction and training, then the named survivor jobs (repairs, ruin visits,
 * staffing, moving workers between workplaces). Whichever of construction and training goes
 * first gets the resources: training at night or when the army is well short of the strategy's
 * wish, construction otherwise. Training reserves its recruits before survivors are handed out.
 */
import { applyCommand, serializeGame, restoreGame, nightType } from '../../sim';
import type { Controller } from '../run';
import { assignRoles, choosePromotions, defend, raid, scout } from './army';
import { armyBehind, choosePolicies, chooseResearch, construct, releaseResearchers, repair, train, visitRuins } from './base';
import { estimateThreat, recordSightings } from './intel';
import { createMemory, makeContext, type Context, type Strategy } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';
import { adjustToStock, rebalance, staff, shelterWorkers } from './workforce';

export const DECISION_TICKS = 10;

/** How far from the core (tiles) survivors walk to explore known ruins. */
const RUIN_REACH = 30;

export function createBot(strategy: Strategy, project?: (ctx: Context) => void): Controller {
  const memory = createMemory();
  return (game) => {
    if (game.state.tick % DECISION_TICKS !== 0) return [];
    const choice = chooseIncident(game, strategy.name);
    if (choice) {
      // Plan subsequent commands against the exact post-choice state, without mutating the caller.
      const preview = restoreGame(serializeGame(game));
      if (!preview || !applyCommand(preview, choice).ok) throw new Error('Incident preview failed');
      game = preview;
    }
    const snap = snapshot(game);
    recordSightings(game, snap, memory.sightings);
    const turn = new Turn(game, snap, new Set([memory.ruinVisitor]));
    const finish = () => choice ? [choice, ...turn.commands()] : turn.commands();
    const ctx = makeContext(game, snap, turn, memory, estimateThreat(game, snap, memory.sightings));
    choosePromotions(ctx, strategy);
    chooseResearch(ctx, strategy);
    if (releaseResearchers(ctx)) return finish();
    choosePolicies(ctx, strategy);
    assignRoles(ctx, strategy);
    pursueIncident(ctx);
    scout(ctx);
    raid(ctx, strategy);
    defend(ctx, strategy);
    project?.(ctx);
    if (ctx.phase !== 'day' && nightType(game.state) === 'rustStorm') {
      construct(ctx, strategy);
      shelterWorkers(ctx);
      return finish();
    }
    if (armyBehind(ctx, strategy) || ctx.phase === 'night') {
      train(ctx, strategy);
      construct(ctx, strategy);
    } else {
      construct(ctx, strategy);
      train(ctx, strategy);
    }
    if (ctx.phase !== 'night') repair(ctx, strategy.repairs.crew, strategy.repairs.below);
    visitRuins(ctx, RUIN_REACH);
    const shares = adjustToStock(ctx, strategy.workforce(ctx));
    staff(ctx, shares);
    rebalance(ctx, shares);
    return finish();
  };
}

/** The baseline: never issues a command. */
export const doNothing: Controller = () => [];
