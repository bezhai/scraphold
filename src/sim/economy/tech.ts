/**
 * Research: research points into the current tech, completion, inspiration conditions
 * (data/economy.ts Inspiration, evaluated from state.stats) that add INSPIRATION_BOOST of the cost.
 * Owner: Task 2.
 *
 * The research resource is a bank: every tick whatever is banked flows into the current tech, up
 * to what it still needs, so research gathered with nothing selected is not lost. Progress is kept
 * per tech when switching. An inspiration fires once per tech, whether or not it is selected, and
 * progress never exceeds the cost; any tech whose progress reaches its cost is completed.
 */
import { SIGNAL_TEXT } from '../data/signal';
import { signalMessage } from '../signal/signal';
import { OK, reject, type CommandHandler } from '../commands';
import { MUTANT_TYPES, SOLDIER_TYPES } from '../data/combat';
import { INSPIRATION_BOOST, TECHS, TECH_IDS, type TechId } from '../data/economy';
import { emit } from '../events';
import { refreshModifiers, type Game } from '../game';
import type { GameState } from '../state';
import { populationCount } from './population';

/** How far the inspiration condition of `tech` is: met when value >= target (UI shows value / target). */
export function inspirationProgress(state: GameState, tech: TechId): { value: number; target: number } {
  const c = TECHS[tech].inspiration;
  const { stats } = state;
  switch (c.kind) {
    case 'killMutants':
      return { value: c.mutant === 'any' ? MUTANT_TYPES.reduce((n, m) => n + stats.kills[m], 0) : stats.kills[c.mutant], target: c.count };
    case 'exploreRuins':
      return { value: stats.ruinsExplored, target: c.count };
    case 'discoverTerrain':
      return { value: stats.exploredTerrain[c.terrain], target: c.count };
    case 'nightsWithoutBuildingLoss':
      return { value: stats.nightsWithoutBuildingLoss, target: c.count };
    case 'ownBuildings': {
      let n = 0;
      for (const e of state.entities.values()) if (e.kind === 'building' && e.type === c.building && e.construction === null) n++;
      return { value: n, target: c.count };
    }
    case 'population':
      return { value: populationCount(state), target: c.count };
    case 'trainSoldiers':
      return { value: SOLDIER_TYPES.reduce((n, s) => n + stats.soldiersTrained[s], 0), target: c.count };
    case 'destroyNests':
      return { value: stats.nestsDestroyed, target: c.count };
    case 'promoteVeterans':
      return { value: stats.promotions, target: c.count };
    case 'repairHp':
      return { value: stats.hpRepaired, target: c.amount };
    case 'researchTechs':
      return { value: state.economy.tech.researched.length, target: c.count };
  }
}

function inspire(game: Game): void {
  const { tech } = game.state.economy;
  for (const t of TECH_IDS) {
    if (tech.inspired.includes(t) || tech.researched.includes(t)) continue;
    const { value, target } = inspirationProgress(game.state, t);
    if (value < target) continue;
    tech.inspired.push(t);
    tech.progress[t] = Math.min(TECHS[t].cost, tech.progress[t] + TECHS[t].cost * INSPIRATION_BOOST);
    emit(game, { type: 'inspiration', tech: t });
  }
}

function research(game: Game): void {
  const { tech, resources } = game.state.economy;
  if (tech.current === null) return;
  const spend = Math.min(Math.max(0, resources.research), TECHS[tech.current].cost - tech.progress[tech.current]);
  tech.progress[tech.current] += spend;
  resources.research -= spend;
}

function prerequisitesMet(researched: readonly TechId[], t: TechId): boolean {
  return TECHS[t].requires.every((r) => researched.includes(r));
}

function complete(game: Game): void {
  const { tech } = game.state.economy;
  let changed = false;
  for (const t of TECH_IDS) {
    if (tech.researched.includes(t) || tech.progress[t] < TECHS[t].cost || !prerequisitesMet(tech.researched, t)) continue;
    tech.researched.push(t);
    if (tech.current === t) tech.current = null;
    emit(game, { type: 'researchCompleted', tech: t });
    changed = true;
  }
  if (changed) refreshModifiers(game);
}

export function techSystem(game: Game): void {
  inspire(game);
  research(game);
  complete(game);
}

export const setResearchHandler: CommandHandler<'setResearch'> = {
  validate(game, cmd) {
    if (cmd.tech === null) return OK;
    const { researched } = game.state.economy.tech;
    if (researched.includes(cmd.tech)) return reject('alreadyResearched');
    return prerequisitesMet(researched, cmd.tech) ? OK : reject('prerequisitesMissing');
  },
  execute(game, cmd) {
    game.state.economy.tech.current = cmd.tech;
    if (cmd.tech === 'oldFrequency' && !game.state.signal.researchAnnounced) {
      game.state.signal.researchAnnounced = true; signalMessage(game, SIGNAL_TEXT.research);
    }
  },
};
