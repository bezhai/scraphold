/**
 * Headless game runner for scripts and bots (Task 5). Uses only the public simulation API.
 * Owner: Task 1 (runner), bots live in their own files and pass a controller.
 */
import {
  applyCommand,
  createGame,
  drainEvents,
  hashState,
  stepGame,
  type ClockState,
  type Command,
  type Game,
  type GameEvent,
  type GameOptions,
  type RejectReason,
} from '../sim';
import { CYCLE_TICKS, GAME_END_TICK, TOTAL_NIGHTS } from '../sim/time';

/** Called before every tick with the events of the previous tick; returns commands to apply now. */
export type Controller = (game: Game, events: readonly GameEvent[]) => readonly Command[];

export interface RunOptions extends GameOptions {
  /** Number of full day + night cycles to simulate (stops earlier if the game ends). */
  days: number;
  controller?: Controller;
}

export interface RunSummary {
  seed: string;
  origin: string;
  difficulty: string;
  ticks: number;
  clock: ClockState;
  outcome: Game['state']['outcome']['status'];
  reason: Game['state']['outcome']['reason'];
  score: number | null;
  resources: Record<string, number>;
  units: { survivors: number; survivorsWorking: number; soldiers: Record<string, number>; mutants: Record<string, number> };
  buildings: Record<string, number>;
  nests: { total: number; discovered: number; hive: boolean; levels: number[] };
  exploredTiles: number;
  stats: Game['state']['stats'];
  events: Record<string, number>;
  commands: { accepted: number; rejected: Partial<Record<RejectReason, number>> };
  hash: string;
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function summarize(game: Game, events: Record<string, number>, commands: RunSummary['commands']): RunSummary {
  const { state } = game;
  const soldiers: Record<string, number> = {};
  const mutants: Record<string, number> = {};
  const buildings: Record<string, number> = {};
  let survivors = 0;
  let working = 0;
  const levels: number[] = [];
  let discovered = 0;
  let hive = false;
  for (const e of state.entities.values()) {
    if (e.kind === 'survivor') {
      survivors++;
      if (e.insideId !== 0) working++;
    } else if (e.kind === 'soldier') bump(soldiers, e.type);
    else if (e.kind === 'mutant') bump(mutants, e.type);
    else if (e.kind === 'building') bump(buildings, e.type);
    else {
      if (e.isHive) hive = true;
      else levels.push(e.growth.level);
      if (e.discovered) discovered++;
    }
  }
  let explored = 0;
  for (const f of state.fog) if (f > 0) explored++;
  return {
    seed: state.options.seed,
    origin: state.options.origin,
    difficulty: state.options.difficulty,
    ticks: state.tick,
    clock: { ...state.clock },
    outcome: state.outcome.status,
    reason: state.outcome.reason,
    score: state.outcome.score?.total ?? null,
    resources: Object.fromEntries(Object.entries(state.economy.resources).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    units: { survivors, survivorsWorking: working, soldiers, mutants },
    buildings,
    nests: { total: levels.length + (hive ? 1 : 0), discovered, hive, levels },
    exploredTiles: explored,
    stats: structuredClone(state.stats),
    events,
    commands,
    hash: hashState(game),
  };
}

export function runHeadless(opts: RunOptions): RunSummary {
  const game = createGame({ seed: opts.seed, origin: opts.origin, difficulty: opts.difficulty });
  const endTick = opts.days >= TOTAL_NIGHTS ? GAME_END_TICK + 1 : opts.days * CYCLE_TICKS;
  const eventCounts: Record<string, number> = {};
  const commands: RunSummary['commands'] = { accepted: 0, rejected: {} };
  let last: GameEvent[] = [];
  while (game.state.tick < endTick && game.state.outcome.status === 'playing') {
    for (const cmd of opts.controller?.(game, last) ?? []) {
      const r = applyCommand(game, cmd);
      if (r.ok) commands.accepted++;
      else commands.rejected[r.reason] = (commands.rejected[r.reason] ?? 0) + 1;
    }
    stepGame(game);
    last = drainEvents(game);
    for (const e of last) bump(eventCounts, e.type);
  }
  return summarize(game, eventCounts, commands);
}
