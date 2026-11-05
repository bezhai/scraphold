/**
 * A strategy as a runHeadless controller (Task 5, v3 Task 4). The bot decides every
 * DECISION_TICKS ticks (half a second), in a fixed order: the pending incident, promotions,
 * research, policies, soldier roles, incident missions, scouts, raids, the strategy's own project
 * (the signal tower), then construction and training and ruin visits. Whichever of construction
 * and training goes first gets the resources: training at night or when the army is well short of
 * the strategy's wish, construction otherwise. In a rust storm's dusk and night it only builds.
 *
 * Everything else is left to the built-in AI, as for a player who gives no orders: survivors under
 * automatic control are staffed, sent to repair and sheltered by the survivor AI, and soldiers
 * the bot has no errand for (the garrison) defend the base under the soldier AI. The bot's own
 * orders (raids, scouting, incident missions, the tower escort, ruin visits) put the units under
 * player control; when an errand ends the bot hands its units back with stop, or the order's end
 * does (sim world/control.ts).
 */
import { applyCommand, serializeGame, restoreGame, nightType } from '../../sim';
import type { Controller } from '../run';
import { assignRoles, choosePromotions, raid, scout } from './army';
import { armyBehind, choosePolicies, chooseResearch, construct, train, visitRuins } from './base';
import { chooseIncident, pursueIncident } from './incidents';
import { estimateThreat, recordSightings } from './intel';
import { createMemory, makeContext, type Context, type Strategy } from './strategy';
import { Turn } from './turn';
import { snapshot } from './view';

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
    choosePolicies(ctx, strategy);
    assignRoles(ctx, strategy);
    pursueIncident(ctx);
    scout(ctx);
    raid(ctx, strategy);
    project?.(ctx);
    if (ctx.phase !== 'day' && nightType(game.state) === 'rustStorm') {
      construct(ctx, strategy);
      return finish();
    }
    if (armyBehind(ctx, strategy) || ctx.phase === 'night') {
      train(ctx, strategy);
      construct(ctx, strategy);
    } else {
      construct(ctx, strategy);
      train(ctx, strategy);
    }
    visitRuins(ctx, RUIN_REACH);
    return finish();
  };
}

/** The baseline: never issues a command. */
export const doNothing: Controller = () => [];
