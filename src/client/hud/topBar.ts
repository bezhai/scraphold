/**
 * Top bar readouts derived from the game view: resources with per-minute income/expense,
 * population (survivors and idle ones, soldiers, people vs housing) with their hover cards, daily
 * food balance and the growth meter.
 * The simulation projects income and expense per day; the bar shows them per game minute
 * (perDayToPerMinute).
 */
import { perDayToPerMinute, populationCount, type Game, type GameView } from '../../sim';
import { RESOURCE_NAMES, RESOURCES, type Resource } from '../../sim/data/economy';

export interface ResourceReadout {
  resource: Resource;
  name: string;
  amount: number;
  incomePerMinute: number;
  expensePerMinute: number;
  perMinute: number;
}

export function resourceReadouts(view: GameView): ResourceReadout[] {
  const eco = view.economy;
  return RESOURCES.map((r) => {
    const income = perDayToPerMinute(eco.incomePerDay[r]);
    const expense = perDayToPerMinute(eco.expensePerDay[r]);
    return { resource: r, name: RESOURCE_NAMES[r], amount: Math.floor(eco.resources[r]), incomePerMinute: income, expensePerMinute: expense, perMinute: income - expense };
  });
}

export function foodBalance(view: GameView): { perDay: number; hungry: boolean } {
  const eco = view.economy;
  return { perDay: eco.incomePerDay.food - eco.expensePerDay.food, hungry: eco.upkeep.hungry };
}

export interface PopulationReadout {
  survivors: number;
  working: number;
  repairing: number;
  idle: number;
  soldiers: number;
  /** Recruits in training queues: they already left the survivor pool. */
  training: number;
  /** Everyone counted against housing (simulation's populationCount). */
  people: number;
  housingCap: number;
}

export function populationReadout(state: Game['state']): PopulationReadout {
  let survivors = 0;
  let working = 0;
  let repairing = 0;
  let soldiers = 0;
  let training = 0;
  for (const e of state.entities.values()) {
    if (e.kind === 'building') training += e.trainQueue.length;
    if (e.hp <= 0) continue;
    if (e.kind === 'soldier') soldiers++;
    else if (e.kind === 'survivor') {
      survivors++;
      if (e.task.type === 'work') working++;
      else if (e.task.type === 'repair') repairing++;
    }
  }
  return {
    survivors,
    working,
    repairing,
    idle: survivors - working - repairing,
    soldiers,
    training,
    people: populationCount(state),
    housingCap: state.economy.housingCap,
  };
}

/** Hover card of the survivors readout. */
export function survivorsTip(pop: PopulationReadout): string {
  return `幸存者 ${pop.survivors} 人，其中 ${pop.idle} 人空闲（没派去工作）。训练一名士兵要占用一名空闲幸存者，派幸存者进建筑工作才有产出。按 G 选中所有空闲幸存者。`;
}

/** Hover card of the population / housing readout: people is the simulation's populationCount; housing only caps natural growth. */
export function populationTip(pop: PopulationReadout): string {
  return `人口 / 住房：幸存者、士兵和正在训练的士兵合计 ${pop.people} 人，住房上限 ${pop.housingCap}。人口到上限后不再自然增长，建棚屋可以提高上限。`;
}

export function growthReadout(view: GameView): number {
  const { progress, threshold } = view.economy.growth;
  return threshold > 0 ? Math.min(1, Math.max(0, progress / threshold)) : 0;
}
