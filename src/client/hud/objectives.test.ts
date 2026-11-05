import { describe, expect, it } from 'vitest';
import { clockAt, createGame, type Game } from '../../sim';
import { HIVE_SHIELD } from '../../sim/data/combat';
import { addBuilding, removeEntity, spawnSurvivor } from '../../sim/world/entities';
import { CYCLE_TICKS } from '../../sim/time';
import { buildTestWorld } from '../testWorld';
import { findHive, objectivesModel } from './objectives';

const statusOf = (game: Game, id: 'survive' | 'hive' | 'signal') => objectivesModel(game).find((r) => r.id === id)?.status;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const UNFOUND = `母巢还没有找到。地图上每剩一个巢穴，母巢受到的伤害降低 ${pct(HIVE_SHIELD.reductionPerNest)}。`;

/** Leaves exactly `n` ordinary nests on the map. */
function keepOrdinaryNests(game: Game, n: number): void {
  const ordinary = [...game.state.entities.values()].filter((e) => e.kind === 'nest' && !e.isHive);
  for (const e of ordinary.slice(n)) removeEntity(game, e);
}

describe('objectivesModel', () => {
  it('lists the three victory routes with their tags and titles; day 1 state', () => {
    const game = createGame({ seed: 'test-obj-1', origin: 'scholars', difficulty: 'normal' });
    expect(objectivesModel(game)).toEqual([
      { id: 'survive', tag: '坚守', title: '撑过二十夜', status: '守到第 21 天天亮。现在是第 1 天。' },
      { id: 'hive', tag: '清巢', title: '摧毁母巢', status: UNFOUND },
      { id: 'signal', tag: '求援', title: '信号塔', status: '找到 K-7 中继站，并研究"旧频段破译"。' },
    ]);
    game.state.clock = clockAt(6 * CYCLE_TICKS + 10);
    expect(statusOf(game, 'survive')).toBe('守到第 21 天天亮。现在是第 7 天。');
  });

  it('a discovered hive shows its health and the shield from the ordinary nests left; a destroyed one says so', () => {
    const game = createGame({ seed: 'test-obj-2', origin: 'militia', difficulty: 'normal' });
    const hive = findHive(game.state);
    expect(hive?.isHive).toBe(true);
    const h = game.state.entities.get(hive!.id)!;
    if (h.kind !== 'nest') throw new Error('not a nest');
    expect(statusOf(game, 'hive')).toBe(UNFOUND);
    h.discovered = true;
    h.hp = h.maxHp * 0.734;
    keepOrdinaryNests(game, 3);
    expect(statusOf(game, 'hive')).toBe(`母巢生命 74%。还剩 3 个巢穴，母巢受到的伤害降低 ${pct(3 * HIVE_SHIELD.reductionPerNest)}。`);
    keepOrdinaryNests(game, 0);
    expect(statusOf(game, 'hive')).toBe('母巢生命 74%。巢穴已全部摧毁，母巢不再减伤。');
    h.hp = 0;
    game.state.stats.hiveDestroyed = true;
    expect(statusOf(game, 'hive')).toBe('母巢已经摧毁。');
  });

  it('the shield in the hive line stops at the cap however many nests are left', () => {
    const game = createGame({ seed: 'test-obj-2', origin: 'militia', difficulty: 'normal' });
    const h = game.state.entities.get(findHive(game.state)!.id)!;
    if (h.kind !== 'nest') throw new Error('not a nest');
    h.discovered = true;
    const nests = [...game.state.entities.values()].filter((e) => e.kind === 'nest' && !e.isHive).length;
    expect(nests * HIVE_SHIELD.reductionPerNest).toBeGreaterThanOrEqual(HIVE_SHIELD.maxReduction - 1e-9);
    expect(statusOf(game, 'hive')).toBe(`母巢生命 100%。还剩 ${nests} 个巢穴，母巢受到的伤害降低 ${pct(HIVE_SHIELD.maxReduction)}。`);
  });

  it('a map without a hive is not mistaken for a destroyed one', () => {
    const { game } = buildTestWorld();
    expect(findHive(game.state)).toBeNull();
    expect(statusOf(game, 'hive')).toBe(UNFOUND);
  });

  it('while the tower is built: progress and the workers actually on site (not the ones still walking there)', () => {
    const { game } = buildTestWorld();
    game.state.signal.stage = 'repair';
    expect(statusOf(game, 'signal')).toBe('在 K-7 中继站原址建造信号塔。');

    const tower = addBuilding(game, 'signalTower', 18, 0, { complete: false });
    game.state.signal.buildingId = tower.id;
    tower.construction!.progress = tower.construction!.total * 0.456;
    const inside = spawnSurvivor(game, tower.x, tower.y);
    inside.insideId = tower.id;
    inside.task = { type: 'work', buildingId: tower.id };
    const walking = spawnSurvivor(game, 1.5, 11.5);
    walking.task = { type: 'work', buildingId: tower.id };
    tower.workers.push(inside.id, walking.id);
    expect(statusOf(game, 'signal')).toBe('修建进度 45%，在岗工人 1/3。');
  });

  it('a finished tower can broadcast; while broadcasting it counts the nights held', () => {
    const { game } = buildTestWorld();
    game.state.signal.stage = 'ready';
    expect(statusOf(game, 'signal')).toBe('塔已经建好，随时可以开始广播。');
    game.state.signal.stage = 'broadcast';
    game.state.signal.nightsHeld = 2;
    game.state.signal.nightsRequired = 3;
    expect(statusOf(game, 'signal')).toBe('已守住 2/3 晚。');
  });
});
