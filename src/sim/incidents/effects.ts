import { recruitSurvivors } from '../economy/recruitment';
/** Incident consequences reuse the economy, research, entity and modifier subsystems. */
import { applyEnvironmentalDamage, checkVeterancy, veteranThreshold } from '../combat/damage';
import { repriceIncidentNight } from '../combat/night';
import { RESOURCES, TECHS, type ResourceAmounts } from '../data/economy';
import type { IncidentChoice, IncidentEffect } from '../data/incidents';
import { pointBeside } from '../economy/buildings';
import { idleTask } from '../economy/model';
import { gain } from '../economy/resources';
import { onsiteWorkers } from '../economy/workers';
import type { Game } from '../game';
import type { Point } from '../state';
import { CYCLE_TICKS, DAY_TICKS, TOTAL_NIGHTS } from '../time';
import { enterBuilding, exitBuilding, spawnSoldier } from '../world/entities';
import { revealCircle } from '../world/fog';
export function stationedWorkers(game: Game) {
  return [...game.state.entities.values()].flatMap(e => e.kind === 'building' ? onsiteWorkers(game, e) : []).sort((a, b) => a.id - b.id);
}
export function incidentCost(game: Game, choice: IncidentChoice): ResourceAmounts {
  const cost = {
    ...choice.cost
  };
  for (const r of RESOURCES) if (choice.costPct[r]) cost[r] = (cost[r] ?? 0) + Math.floor(game.state.economy.resources[r] * choice.costPct[r]!);
  return cost;
}
export function undiscoveredNests(game: Game) {
  const core = game.state.entities.get(game.state.coreId)!;
  const distance = (p: Point) => (p.x - core.x) * (p.x - core.x) + (p.y - core.y) * (p.y - core.y);
  return [...game.state.entities.values()].filter(e => e.kind === 'nest' && e.hp > 0 && !e.discovered).sort((a, b) => distance(a) - distance(b) || a.id - b.id);
}
export function applyIncidentEffect(game: Game, effect: Exclude<IncidentEffect, {
  kind: 'target';
}>, incidentId: number, at?: Point): void {
  const {
    state
  } = game;
  const {
    incidents,
    economy,
    tick
  } = state;
  const day = state.clock.day;
  const dawn = (day - 1) * CYCLE_TICKS;
  const night = dawn + DAY_TICKS;
  const core = state.entities.get(state.coreId)!;
  const point = at ?? (core.kind === 'building' ? pointBeside(game, core) : core);
  switch (effect.kind) {
    case 'resources':
      for (const r of RESOURCES) gain(economy.resources, state.stats, r, effect.amounts[r] ?? 0);
      return;
    case 'survivors':
      recruitSurvivors(game, point, effect.count, 'incident');
      return;
    case 'soldiers':
      for (let i = 0; i < effect.count; i++) {
        const s = spawnSoldier(game, effect.unit, point.x, point.y);
        if (effect.veteran) {
          s.veterancy.kills = veteranThreshold(game, s);
          checkVeterancy(game, s);
        }
      }
      return;
    case 'modifier':
      incidents.modifiers.push({
        incidentId,
        effects: effect.effects.map(e => ({
          ...e
        })),
        startsTick: effect.duration === 'tonight' ? night : tick,
        expiresTick: effect.duration === 'permanent' ? null : effect.duration === 'today' ? night : effect.duration === 'tonight' ? dawn + CYCLE_TICKS : tick + effect.duration * CYCLE_TICKS
      });
      return;
    case 'isolate':
      if (core.kind !== 'building') return;
      for (const s of stationedWorkers(game).slice(0, effect.count)) {
        enterBuilding(game, s, core);
        s.task = idleTask();
        incidents.isolatedSurvivors.push({
          unitId: s.id,
          expiresTick: tick + effect.days * CYCLE_TICKS
        });
      }
      return;
    case 'casualties':
      for (let i = 0; i < effect.nights; i++) incidents.casualties.push({
        incidentId,
        night: day + i,
        count: effect.count
      });
      return;
    case 'nightBudget':
      {
        const target = incidentAttackNight(game);
        incidents.nightBudgetAdjustments.push({
          night: target,
          budgetPct: effect.budgetPct
        });
        if (state.night.plan?.night === target) repriceIncidentNight(game, state.night.plan);
        return;
      }
    case 'research':
      {
        const tech = effect.tech === 'current' ? economy.tech.current : effect.tech;
        if (!tech) return;
        if (economy.tech.researched.includes(tech)) gain(economy.resources, state.stats, 'research', effect.fallbackResearch);else economy.tech.progress[tech] = Math.min(TECHS[tech].cost, economy.tech.progress[tech] + TECHS[tech].cost * effect.fraction);
        return;
      }
    case 'relayReveal':
      {
        if (state.signal.discovered) gain(economy.resources, state.stats, 'research', effect.discoveredResearch);else {
          const site = state.map.relaySite;
          if (site) revealCircle(game, site.tileX + site.size / 2, site.tileY + site.size / 2, effect.radius);
        }
        return;
      }
    case 'revealNests':
      for (const nest of undiscoveredNests(game).slice(0, effect.count)) revealCircle(game, nest.x, nest.y, nest.radius);
      return;
  }
}
export function updateConsequences(game: Game): void {
  const {
    state
  } = game;
  const inc = state.incidents;
  inc.modifiers = inc.modifiers.filter(m => m.expiresTick === null || m.expiresTick > state.tick);
  inc.isolatedSurvivors = inc.isolatedSurvivors.filter(record => {
    const s = state.entities.get(record.unitId);
    if (!s || s.kind !== 'survivor' || s.hp <= 0) return false;
    if (record.expiresTick > state.tick) return true;
    exitBuilding(game, s);
    s.task = idleTask();
    return false;
  });
  if (state.clock.phase === 'night') {
    for (const record of inc.casualties.filter(c => c.night <= state.clock.day)) {
      const survivors = [...state.entities.values()].filter(e => e.kind === 'survivor' && e.hp > 0).sort((a, b) => a.id - b.id);
      for (const s of survivors.slice(0, record.count)) applyEnvironmentalDamage(game, s, s.hp);
    }
    inc.casualties = inc.casualties.filter(c => c.night > state.clock.day);
  }
}
/** The concrete night used by both the card text and settlement. */
export function incidentAttackNight(game: Game): number {
  let night = game.state.clock.day;
  while (night <= TOTAL_NIGHTS && ['calm', 'rustStorm'].includes(game.calendarPlan[night - 1]!)) night++;
  return night;
}
/** Only the currently selected unfinished research can fund medicine. */
export function spendableResearchProgress(game: Game): number {
  const tech = game.state.economy.tech;
  return tech.current && !tech.researched.includes(tech.current) ? tech.progress[tech.current] : 0;
}
export function payResearchProgressCost(game: Game, amount: number): void {
  const {
    resources,
    tech
  } = game.state.economy;
  const bank = Math.min(resources.research, amount);
  resources.research -= bank;
  if (tech.current) tech.progress[tech.current] -= amount - bank;
}
