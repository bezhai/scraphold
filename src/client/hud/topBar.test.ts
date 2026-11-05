import { describe, expect, it } from 'vitest';
import { populationCount } from '../../sim';
import { buildTestWorld } from '../testWorld';
import { foodBalance, growthReadout, populationReadout, populationTip, resourceReadouts, survivorsTip } from './topBar';

describe('resourceReadouts', () => {
  it('shows each resource with floored amount and per-minute income, expense and net', () => {
    const { game } = buildTestWorld();
    const eco = game.state.economy;
    eco.resources.scrap = 160.7;
    eco.incomePerDay.scrap = 220; // a day is one 110 s day/night cycle
    eco.expensePerDay.scrap = 0;
    eco.incomePerDay.food = 110;
    eco.expensePerDay.food = 165;
    const [scrap, food] = resourceReadouts(game.state);
    expect(scrap).toMatchObject({ resource: 'scrap', name: '废料', amount: 160, incomePerMinute: 120, expensePerMinute: 0, perMinute: 120 });
    expect(food).toMatchObject({ resource: 'food', name: '食物', perMinute: -30 });
    expect(resourceReadouts(game.state).map((r) => r.resource)).toEqual(['scrap', 'food', 'fuel', 'research']);
  });
});

describe('foodBalance', () => {
  it('is daily food income minus expense, with the hunger flag', () => {
    const { game } = buildTestWorld();
    game.state.economy.incomePerDay.food = 40;
    game.state.economy.expensePerDay.food = 52;
    game.state.economy.upkeep.hungry = true;
    expect(foodBalance(game.state)).toEqual({ perDay: -12, hungry: true });
  });
});

describe('populationReadout', () => {
  it('counts survivors by task (waiting for orders counts as idle), soldiers, recruits in training, and housing', () => {
    const w = buildTestWorld();
    w.survivor1.insideId = w.greenhouse.id;
    w.survivor1.task = { type: 'work', buildingId: w.greenhouse.id };
    w.survivor2.task = { type: 'wait' };
    w.game.state.economy.housingCap = 10;
    (w.barracks.trainQueue as { unit: 'rifleman'; progress: number; total: number }[]).push({ unit: 'rifleman', progress: 0, total: 200 });
    expect(populationReadout(w.game.state)).toEqual({
      survivors: 2,
      working: 1,
      repairing: 0,
      idle: 1,
      soldiers: 3,
      training: 1,
      people: populationCount(w.game.state),
      housingCap: 10,
    });
    expect(populationCount(w.game.state)).toBe(6);
  });
});

describe('growthReadout', () => {
  it('is the growth meter fraction (0 when no threshold yet)', () => {
    const { game } = buildTestWorld();
    expect(growthReadout(game.state)).toBe(0);
    game.state.economy.growth = { progress: 15, threshold: 60 };
    expect(growthReadout(game.state)).toBeCloseTo(0.25);
  });
});

describe('population hover cards', () => {
  const pop = { survivors: 7, working: 3, repairing: 1, idle: 3, soldiers: 4, training: 1, people: 12, housingCap: 14 };

  it('survivors: how many are idle or waiting for orders, whom training takes, what G selects', () => {
    expect(survivorsTip(pop)).toBe('幸存者 7 人，其中 3 人空闲或等待命令。每训练一名士兵，从自动管理的幸存者里调走一人。按 G 选中空闲或等待命令的幸存者。');
  });

  it('population / housing: who counts (populationCount) and that housing only caps natural growth', () => {
    expect(populationTip(pop)).toBe('人口 / 住房：幸存者、士兵和正在训练的士兵合计 12 人，住房上限 14。人口到上限后不再自然增长，建棚屋可以提高上限。');
  });
});
