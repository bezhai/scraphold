/** Deterministic daily cards, validation, automatic settlement and objective updates. */
import { generateEventDays } from './schedule';
import { OK, reject, type CommandHandler, type CommandResult } from '../commands';
import { INCIDENTS, INCIDENT_IDS, INCIDENT_RULES, type IncidentChoice, type IncidentId } from '../data/incidents';
import { housingCapacity, populationCount } from '../economy/population';
import { canAfford, pay } from '../economy/resources';
import { emit } from '../events';
import { refreshModifiers, type Game } from '../game';
import { tileCenter } from '../map/grid';
import { nextInt, pick, pickWeighted } from '../rng';
import { CYCLE_TICKS, DAY_TICKS, TOTAL_NIGHTS, secondsToTicks } from '../time';
import { incidentChoiceDescription } from './descriptions';
import { applyIncidentEffect, incidentCost, spendableResearchProgress, payResearchProgressCost, stationedWorkers, undiscoveredNests, updateConsequences } from './effects';
import { incidentDirection, targetCandidates, hasGuardSpawnSites } from './sites';
import { activateTarget, updateTargets } from './targets';
function warning(game: Game, day: number): IncidentId | null {
  return game.calendarPlan[day - 1] === 'rustStorm' ? 'stormWarning' : game.calendarPlan[day - 1] === 'surge' ? 'surgeWarning' : null;
}
function initializeNorthernDay(game: Game): void {
  const inc = game.state.incidents;
  if (inc.northernDay) return;
  if (!inc.eventDays.length) inc.eventDays = generateEventDays(game.state.rng.incidents);
  const northernDays = inc.eventDays.filter(day => day >= INCIDENT_RULES.northernFirstDay && day <= INCIDENT_RULES.northernLastDay);
  const counts: Partial<Record<IncidentId, number>> = {};
  const available: number[] = [];
  let previous: IncidentId | null = null;
  for (let day = INCIDENT_RULES.firstDay; day <= INCIDENT_RULES.northernLastDay; day++) {
    if (!inc.eventDays.includes(day)) continue;
    const id = warning(game, day);
    const chosen: IncidentId | null = id && previous !== id && (counts[id] ?? 0) < INCIDENTS[id].maxOccurrences ? id : null;
    if (chosen) counts[chosen] = (counts[chosen] ?? 0) + 1;else if (day >= INCIDENT_RULES.northernFirstDay) available.push(day);
    previous = chosen;
  }
  inc.northernDay = available.length ? pick(game.state.rng.incidents, available) : pick(game.state.rng.incidents, northernDays);
}
export function incidentWeight(game: Game, id: IncidentId): number {
  return INCIDENTS[id].weight * (id === 'refugees' && housingCapacity(game) - populationCount(game.state) <= INCIDENT_RULES.tightHousingSlots ? INCIDENT_RULES.refugeeWeightMultiplier : 1);
}
export function incidentEligible(game: Game, id: IncidentId): boolean {
  const {
    state
  } = game;
  const inc = state.incidents;
  const day = state.clock.day;
  if (day < INCIDENTS[id].earliestDay) return false;
  const history = inc.history.filter(h => h.definitionId === id);
  if (history.length >= INCIDENTS[id].maxOccurrences || inc.history.at(-1)?.definitionId === id) return false;
  if (id === 'northernSignal') return day === inc.northernDay;
  if ((id === 'stormWarning' || id === 'surgeWarning') && warning(game, day) !== id) return false;
  if (id === 'tribe' && !undiscoveredNests(game).length) return false;
  const effect = INCIDENTS[id].choices.flatMap(c => c.effects).find(e => e.kind === 'target');
  return !effect || effect.kind !== 'target' || targetCandidates(game, effect.target).length > 0;
}
export function raiseIncident(game: Game, id: IncidentId): void {
  const {
    state
  } = game;
  const def = INCIDENTS[id];
  const effect = def.choices.flatMap(c => c.effects).find(e => e.kind === 'target');
  const target = effect?.kind === 'target' ? pick(state.rng.incidents, targetCandidates(game, effect.target)) : null;
  const relay = state.map.relaySite;
  const point = target ? tileCenter(state.map, target.tile) : relay ? {
    x: relay.tileX + relay.size / 2,
    y: relay.tileY + relay.size / 2
  } : null;
  const fill = (text: string) => text.replaceAll('{方向}', point ? incidentDirection(game, point) : '北');
  const choices = JSON.parse(JSON.stringify(def.choices)) as IncidentChoice[];
  state.incidents.pending = {
    id: state.incidents.nextId++,
    definitionId: id,
    raisedTick: state.tick,
    deadlineTick: (state.clock.day - 1) * CYCLE_TICKS + DAY_TICKS,
    title: def.title,
    description: fill(def.description),
    target,
    choices: choices.map(c => ({
      ...c,
      feedback: c.feedback === null ? null : fill(c.feedback),
      description: incidentChoiceDescription(game, c)
    }))
  };
  state.incidents.lastIncidentDay = state.clock.day;
  state.incidents.nextIncidentTick = null;
  emit(game, {
    type: 'incidentRaised',
    incidentId: state.incidents.pending.id
  });
}
function validateChoice(game: Game, choice: IncidentChoice): CommandResult {
  if (game.state.economy.resources.research + spendableResearchProgress(game) < choice.researchProgressCost) return reject('insufficientResources');
  if (!canAfford(game.state.economy.resources, incidentCost(game, choice))) return reject('insufficientResources');
  if ([...game.state.entities.values()].filter(e => e.kind === 'soldier' && e.hp > 0).length < choice.minSoldiers) return reject('insufficientSoldiers');
  for (const effect of choice.effects) {
    if (effect.kind === 'revealNests' && !undiscoveredNests(game).length) return reject('noUndiscoveredNests');
    if (effect.kind === 'target' && !pendingTargetAvailable(game)) return reject('incidentTargetUnavailable');
    if (effect.kind === 'isolate' && stationedWorkers(game).length < effect.count) return reject('insufficientWorkers');
    if (effect.kind === 'research' && effect.tech === 'current' && !game.state.economy.tech.current) return reject('noCurrentResearch');
  }
  return OK;
}
function settle(game: Game, choice: IncidentChoice, automatic: boolean): void {
  const inc = game.state.incidents;
  const pending = inc.pending!;
  pay(game.state.economy.resources, incidentCost(game, choice));
  payResearchProgressCost(game, choice.researchProgressCost);
  for (const effect of choice.effects) {
    if (effect.kind === 'target') activateTarget(game, pending);else applyIncidentEffect(game, effect, pending.id);
  }
  inc.history.push({
    id: pending.id,
    definitionId: pending.definitionId,
    raisedTick: pending.raisedTick,
    resolvedTick: game.state.tick,
    choiceId: choice.id,
    automatic
  });
  inc.pending = null;
  emit(game, {
    type: 'incidentResolved',
    incidentId: pending.id,
    choiceId: choice.id,
    automatic,
    feedback: choice.feedback
  });
  refreshModifiers(game);
}
export const resolveIncidentHandler: CommandHandler<'resolveIncident'> = {
  validate(game, cmd) {
    const pending = game.state.incidents.pending;
    if (!pending || pending.id !== cmd.incidentId) return reject('incidentNotPending');
    const choice = pending.choices.find(c => c.id === cmd.choiceId);
    if (!choice) return reject('unknownIncidentChoice');
    if (game.state.tick >= pending.deadlineTick) return reject('incidentExpired');
    return validateChoice(game, choice);
  },
  execute(game, cmd) {
    settle(game, game.state.incidents.pending!.choices.find(c => c.id === cmd.choiceId)!, false);
  }
};
export function incidentSystem(game: Game): void {
  const {
    state
  } = game;
  const inc = state.incidents;
  const {
    day,
    phase
  } = state.clock;
  initializeNorthernDay(game);
  closeObsoleteSplit(game);
  if (inc.pending && state.tick >= inc.pending.deadlineTick) {
    const choice = [...inc.pending.choices].reverse().find(c => validateChoice(game, c).ok);
    if (!choice) throw new Error('Incident has no eligible automatic choice');
    settle(game, choice, true);
  }
  updateConsequences(game);
  if (day < INCIDENT_RULES.firstDay || day > TOTAL_NIGHTS || phase !== 'day' || !inc.eventDays.includes(day) || inc.lastIncidentDay >= day) return;
  if (inc.nextIncidentTick === null) inc.nextIncidentTick = (day - 1) * CYCLE_TICKS + nextInt(state.rng.incidents, secondsToTicks(INCIDENT_RULES.earliestSecond), secondsToTicks(INCIDENT_RULES.latestSecond));
  if (state.tick < inc.nextIncidentTick) return;
  const weather = warning(game, day);
  const forced = day === inc.northernDay ? 'northernSignal' : weather && incidentEligible(game, weather) ? weather : null;
  const pool = forced ? [forced] : INCIDENT_IDS.filter(id => id !== 'northernSignal' && id !== 'stormWarning' && id !== 'surgeWarning' && incidentEligible(game, id));
  if (!pool.length) {
    inc.lastIncidentDay = day;
    inc.nextIncidentTick = null;
    return;
  }
  raiseIncident(game, pickWeighted(state.rng.incidents, pool, id => incidentWeight(game, id)));
}
export function incidentTargetSystem(game: Game): void {
  closeObsoleteSplit(game);
  updateTargets(game);
  const pending = game.state.incidents.pending;
  if (pending) for (const choice of pending.choices) choice.description = incidentChoiceDescription(game, choice);
}
function pendingTargetAvailable(game: Game): boolean {
  const target = game.state.incidents.pending?.target;
  if (!target) return false;
  if (target.kind === 'nestSplit') {
    const nest = game.state.entities.get(target.nestId);
    return nest?.kind === 'nest' && !nest.isHive && nest.hp > 0;
  }
  return hasGuardSpawnSites(game, target);
}
/** A one-option warning whose nest was already destroyed has achieved its objective. */
function closeObsoleteSplit(game: Game): void {
  const pending = game.state.incidents.pending;
  if (pending?.target?.kind !== 'nestSplit' || pendingTargetAvailable(game)) return;
  settle(game, pending.choices[0]!, true);
  updateTargets(game);
}
