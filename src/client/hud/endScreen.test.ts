import { describe, expect, it } from 'vitest';
import { GAME_END_TICK, TOTAL_NIGHTS } from '../../sim/time';
import { buildTestWorld } from '../testWorld';
import { bestScoreEntry, endSummary } from './endScreen';

function finish(status: 'won' | 'lost', reason: 'survived' | 'hiveDestroyed' | 'signal' | 'coreDestroyed', endTick: number) {
  const { game } = buildTestWorld();
  game.state.outcome = { status, reason, endTick, score: null };
  return game;
}

describe('endSummary', () => {
  it('a survived victory shows the score breakdown and narrative title', () => {
    const game = finish('won', 'survived', GAME_END_TICK);
    game.state.outcome.score = { victory: 1000, earlyDays: 0, hive: 0, nests: 300, survivors: 160, buildingsLost: -50, multiplier: 1, total: 1410 };
    const s = endSummary(game.state);
    expect(s).toMatchObject({ won: true, headline: '第二十一个早晨', reason: '守到了第 21 天', day: TOTAL_NIGHTS + 1, total: 1410 });
    expect(s.epilogue).toBe('据点撑过了二十个夜晚，拓荒队在锈原留了下来。');
    expect(s.scoreRows).toEqual([
      ['胜利', 1000],
      ['提前获胜', 0],
      ['摧毁母巢', 0],
      ['摧毁巢穴', 300],
      ['存活幸存者', 160],
      ['损失建筑', -50],
    ]);
    expect(s.multiplier).toBe(1);
  });

  it('a hive victory names the day; a signal victory shows convoy; a defeat has no score', () => {
    const hive = endSummary(finish('won', 'hiveDestroyed', 2200 * 6 + 100).state);
    expect(hive).toMatchObject({ headline: '雾散了', reason: '第 7 天摧毁了母巢' });
    expect(hive.epilogue).toBe('母巢被摧毁，锈原上的巢穴失去了孢子来源。');

    const signal = endSummary(finish('won', 'signal', 2200 * 8 + 100).state);
    expect(signal).toMatchObject({ headline: '长明城的车队', reason: '第 9 天，长明城的车队到了' });
    expect(signal.epilogue).toBe('长明城的车队到了，拓荒队跟着车队去了长明城。');

    const lost = endSummary(finish('lost', 'coreDestroyed', 2200 * 2 + 1500).state);
    expect(lost).toMatchObject({ won: false, headline: '炉心熄灭', reason: '炉心在第 3 天熄灭', total: null, scoreRows: [] });
    expect(lost.epilogue).toBe('炉心被摧毁，据点失守。');
  });

  it('summarizes the stats', () => {
    const game = finish('lost', 'coreDestroyed', 3000);
    game.state.stats.kills.wanderer = 12;
    game.state.stats.kills.runner = 4;
    game.state.stats.soldiersTrained.rifleman = 3;
    const s = endSummary(game.state);
    expect(s.stats).toContainEqual(['击杀怪物', '16']);
    expect(s.stats).toContainEqual(['训练士兵', '3']);
    expect(s.killDetail).toBe('游荡者 12、疾行者 4');
  });

  it('lists what was gathered per resource, rounded, for the resource icons', () => {
    const game = finish('lost', 'coreDestroyed', 3000);
    Object.assign(game.state.stats.resourcesGathered, { scrap: 103.4, food: 92, fuel: 0, research: 30.6 });
    const s = endSummary(game.state);
    expect(s.gathered).toEqual([
      { resource: 'scrap', name: '废料', amount: 103 },
      { resource: 'food', name: '食物', amount: 92 },
      { resource: 'fuel', name: '燃料', amount: 0 },
      { resource: 'research', name: '科研', amount: 31 },
    ]);
    expect(s.stats.map(([k]) => k)).not.toContain('累计收集');
  });
});

describe('bestScoreEntry', () => {
  it('only victories with a score make an entry', () => {
    const won = finish('won', 'survived', GAME_END_TICK);
    won.state.outcome.score = { victory: 1000, earlyDays: 0, hive: 0, nests: 0, survivors: 0, buildingsLost: 0, multiplier: 1, total: 1000 };
    const at = new Date('2026-10-30T12:00:00Z');
    expect(bestScoreEntry(won.state, at)).toEqual({ score: 1000, seed: 'test', origin: 'scavengers', day: TOTAL_NIGHTS + 1, at: at.toISOString() });
    expect(bestScoreEntry(finish('lost', 'coreDestroyed', 3000).state, at)).toBeNull();
  });
});
