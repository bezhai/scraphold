/**
 * The fixed-step tick: an ordered list of systems. Owner: main session (wiring).
 * Each system lives in its owner's file; tasks change behavior inside their systems and ask the
 * main session to change this order.
 */
import { incidentSystem, incidentTargetSystem } from './incidents/incidents';
import { signalSystem } from './signal/signal';
import { calendarSystem } from './calendar/calendar';
import { weatherSystem } from './calendar/weather';
import { combatSystem } from './combat/attacks';
import { mutantAiSystem } from './combat/mutants';
import { nestSystem } from './combat/nests';
import { nightSystem } from './combat/night';
import { outcomeSystem } from './combat/outcome';
import { soldierSystem } from './combat/soldiers';
import { constructionSystem } from './economy/construction';
import { explorationSystem } from './economy/exploration';
import { populationSystem } from './economy/population';
import { productionSystem } from './economy/production';
import { survivorAiSystem } from './economy/survivorAi';
import { techSystem } from './economy/tech';
import { workerSystem } from './economy/workers';
import { refreshModifiers, type Game } from './game';
import { ensureNav } from './nav/navGrid';
import { cleanupSystem } from './world/cleanup';
import { clockSystem } from './world/clock';
import { controlSystem } from './world/control';
import { fogSystem } from './world/fog';
import { movementSystem } from './world/movement';
import { rebuildSpatialIndex } from './world/spatial';

export type System = (game: Game) => void;

export interface PipelineStage {
  name: string;
  owner: 'task1' | 'task2' | 'task3';
  run: System;
}

const spatialSystem: System = (game) => rebuildSpatialIndex(game.spatial, game.state);

export const PIPELINE: readonly PipelineStage[] = [
  /** state.clock for this tick; phaseChanged events. */
  { name: 'clock', owner: 'task1', run: clockSystem },
  { name: 'calendar', owner: 'task2', run: calendarSystem },
  { name: 'incidents', owner: 'task2', run: incidentSystem },
  { name: 'modifiers', owner: 'task1', run: refreshModifiers },
  { name: 'nav', owner: 'task1', run: (game) => void ensureNav(game) },
  { name: 'spatial', owner: 'task1', run: spatialSystem },
  /** Dusk forecast, night spawning, dawn retreat. */
  { name: 'night', owner: 'task3', run: nightSystem },
  { name: 'nests', owner: 'task3', run: nestSystem },
  { name: 'mutantAi', owner: 'task3', run: mutantAiSystem },
  { name: 'soldiers', owner: 'task3', run: soldierSystem },
  /** Units whose player order has ended return to automatic control. */
  { name: 'control', owner: 'task2', run: controlSystem },
  /** Jobs, repairs and storm shelter for survivors under automatic control. */
  { name: 'survivorAi', owner: 'task2', run: survivorAiSystem },
  /** Survivors walking to work/repair, entering buildings. */
  { name: 'workers', owner: 'task2', run: workerSystem },
  { name: 'weather', owner: 'task2', run: weatherSystem },
  { name: 'movement', owner: 'task1', run: movementSystem },
  { name: 'spatialAfterMove', owner: 'task1', run: spatialSystem },
  { name: 'fog', owner: 'task1', run: fogSystem },
  /** Ruin rewards. */
  { name: 'exploration', owner: 'task2', run: explorationSystem },
  /** Attacks, damage, kills, veterancy, towers. */
  { name: 'combat', owner: 'task3', run: combatSystem },
  /** Build progress, training queues. */
  { name: 'construction', owner: 'task2', run: constructionSystem },
  { name: 'production', owner: 'task2', run: productionSystem },
  /** Housing, growth, upkeep, hunger. */
  { name: 'population', owner: 'task2', run: populationSystem },
  /** Research, inspirations. */
  { name: 'tech', owner: 'task2', run: techSystem },
  { name: 'signal', owner: 'task2', run: signalSystem },
  { name: 'incidentTargets', owner: 'task2', run: incidentTargetSystem },
  /** Victory, defeat, score. */
  { name: 'outcome', owner: 'task3', run: outcomeSystem },
  /** Removes entities with hp <= 0. */
  { name: 'cleanup', owner: 'task1', run: cleanupSystem },
];

/** Advances the game by one fixed tick (1/20 s). No-op once the game is over. */
export function stepGame(game: Game): void {
  if (game.state.outcome.status !== 'playing') return;
  for (const stage of PIPELINE) stage.run(game);
  game.state.tick++;
}
