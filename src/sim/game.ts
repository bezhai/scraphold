/**
 * The Game container: canonical state plus derived caches and the event outbox.
 * Owner: Task 1 / main session.
 */
import { generateCalendar } from './calendar/calendar';
import type { NightType } from './data/calendar';
import { createCalendarState } from './calendar/model';
import { createIncidentState } from './incidents/model';
import { createSignalState } from './signal/model';
import { createNightState, createOutcome } from './combat/model';
import { createEconomyState } from './economy/model';
import type { GameEvent } from './events';
import { computeModifiers, type Modifiers } from './modifiers';
import { createNavGrid, type NavGrid } from './nav/navGrid';
import { createRngStreams } from './rng';
import { createStats, type GameOptions, type GameState, type MapState } from './state';
import { clockAt } from './time';
import { createSpatialIndex, type SpatialIndex } from './world/spatial';

export interface Game {
  /** Canonical, hashed state. The client must treat it as read-only. */
  readonly state: GameState;
  /** Derived from calendar.generationRng; never exposed in GameView. */
  readonly calendarPlan: NightType[];
  /** Derived: blocked tiles, structure ids, flow field. Use ensureNav(game) to read it fresh. */
  readonly nav: NavGrid;
  /** Derived: rebuilt by the pipeline each tick. */
  readonly spatial: SpatialIndex;
  /** Derived: refreshed at the start of every tick and after every accepted command. */
  modifiers: Modifiers;
  /** Outbox of events since the last drainEvents call. */
  readonly events: GameEvent[];
}

export function createEmptyState(options: GameOptions, map: MapState): GameState {
  const rng = createRngStreams(options.seed);
  return {
    options: { ...options },
    tick: 0,
    clock: clockAt(0),
    rng,
    nextId: 1,
    navVersion: 0,
    map,
    fog: new Uint8Array(map.width * map.height),
    entities: new Map(),
    coreId: 0,
    economy: createEconomyState(),
    night: createNightState(),
    calendar: createCalendarState(rng.calendar, options.difficulty),
    incidents: createIncidentState(),
    signal: createSignalState(map.relaySite),
    stats: createStats(),
    outcome: createOutcome(),
  };
}

export function modifiersFor(state: GameState): Modifiers {
  return computeModifiers({
    origin: state.options.origin,
    researched: state.economy.tech.researched,
    policySlots: state.economy.policies.slots,
  }, state.incidents.modifiers.filter(m => m.startsTick <= state.tick && (m.expiresTick === null || m.expiresTick > state.tick)).flatMap(m => m.effects));
}

/** A game with an empty world on the given map (no entities yet). */
export function assembleGame(options: GameOptions, map: MapState): Game {
  const state = createEmptyState(options, map);
  return gameFromState(state);
}

/** Reconstruct derived caches without starting a new world or consuming randomness. */
export function gameFromState(state: GameState): Game {
  const { map } = state;
  return {
    state,
    calendarPlan: generateCalendar({ ...state.calendar.generationRng }, state.options.difficulty),
    nav: createNavGrid(map.width, map.height),
    spatial: createSpatialIndex(map.width, map.height),
    modifiers: modifiersFor(state),
    events: [],
  };
}

export function refreshModifiers(game: Game): void {
  game.modifiers = modifiersFor(game.state);
}
