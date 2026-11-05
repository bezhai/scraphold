/**
 * Command dispatch table: wires every command type to its handler. Owner: main session.
 */
import { startSignalBroadcastHandler } from './signal/signal';
import { choosePromotionHandler } from './combat/attacks';
import { resolveIncidentHandler } from './incidents/incidents';
import { reject, type Command, type CommandHandler, type CommandResult, type CommandType } from './commands';
import { cancelConstructionHandler, cancelTrainingHandler, demolishHandler, placeBuildingHandler, trainHandler } from './economy/construction';
import { setPolicyHandler } from './economy/policies';
import { setResearchHandler } from './economy/tech';
import { assignWorkHandler, repairHandler, unassignWorkHandler } from './economy/workers';
import { refreshModifiers, type Game } from './game';
import { attackMoveHandler, attackTargetHandler, holdHandler, moveHandler, setRallyHandler, stopHandler } from './world/orders';

const HANDLERS: { [T in CommandType]: CommandHandler<T> } = {
  resolveIncident: resolveIncidentHandler,
  startSignalBroadcast: startSignalBroadcastHandler,
  move: moveHandler,
  attackMove: attackMoveHandler,
  attackTarget: attackTargetHandler,
  stop: stopHandler,
  hold: holdHandler,
  setRally: setRallyHandler,
  assignWork: assignWorkHandler,
  unassignWork: unassignWorkHandler,
  repair: repairHandler,
  placeBuilding: placeBuildingHandler,
  cancelConstruction: cancelConstructionHandler,
  demolish: demolishHandler,
  train: trainHandler,
  cancelTraining: cancelTrainingHandler,
  setResearch: setResearchHandler,
  setPolicy: setPolicyHandler,
  choosePromotion: choosePromotionHandler,
};

function handlerFor(cmd: Command): CommandHandler<CommandType> {
  return HANDLERS[cmd.type] as unknown as CommandHandler<CommandType>;
}

/** Checks a command without changing anything (UI availability, placement preview). */
export function validateCommand(game: Game, cmd: Command): CommandResult {
  if (game.state.outcome.status !== 'playing') return reject('gameOver');
  return handlerFor(cmd).validate(game, cmd as never);
}

/** Validates and applies a command immediately (also while paused). */
export function applyCommand(game: Game, cmd: Command): CommandResult {
  const result = validateCommand(game, cmd);
  if (!result.ok) return result;
  handlerFor(cmd).execute(game, cmd as never);
  refreshModifiers(game);
  return result;
}
