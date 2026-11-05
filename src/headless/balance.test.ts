/**
 * Balance smoke check (Task 5): a few bot games on one seed guard the properties the full run
 * (`pnpm balance`) measures over many seeds. After retuning data or bots, rerun the full balance;
 * if this seed stops fitting, pick another one where every strategy wins in balance/latest.json.
 * V2: the first boss follows the generated surge calendar. Keep the seed and check preparation
 * against that actual night; full multi-seed tuning belongs to v2 Task 6.
 */
import { describe, expect, it } from 'vitest';
import type { Difficulty, SoldierType } from '../sim/data/combat';
import { createGame } from '../sim';
import { ORIGIN_IDS, type OriginId } from '../sim/data/economy';
import { createController, type BotName } from './bots';
import { runHeadless } from './run';

const SEED = 'balance-6';
const FIRST_BOSS_NIGHT = createGame({ seed: SEED, origin: 'militia', difficulty: 'normal' }).calendarPlan.indexOf('surge') + 1;

function play(bot: BotName, origin: OriginId, days: number, difficulty: Difficulty = 'normal') {
  const controller = createController(bot);
  const unmarkedNestAttacks: number[] = [];
  const result = runHeadless({ seed: SEED, origin, difficulty, days, controller: (game, events) => {
    const commands = controller(game, events);
    for (const command of commands) if (command.type === 'attackTarget' && game.state.entities.get(command.targetId)?.kind === 'nest' &&
      !game.state.incidents.targets.some(t => t.kind === 'nestSplit' && t.nestId === command.targetId)) unmarkedNestAttacks.push(command.targetId);
    return commands;
  } });
  return { ...result, unmarkedNestAttacks };
}

const trained = (s: ReturnType<typeof play>, ...types: SoldierType[]) => types.reduce((n, t) => n + s.stats.soldiersTrained[t], 0);

describe('balance smoke check', () => {
  it.each(ORIGIN_IDS)('a base left alone falls before the first boss night (%s)', (origin) => {
    const s = play('doNothing', origin, FIRST_BOSS_NIGHT - 1);
    expect(s.outcome).toBe('lost');
    expect(s.clock.day).toBeLessThan(FIRST_BOSS_NIGHT);
  });

  it('economy first survives the first surge night with an armory army and no towers', { timeout: 30_000 }, () => {
    const s = play('economy', 'scholars', FIRST_BOSS_NIGHT);
    expect(s.outcome).toBe('playing');
    expect(s.buildings.armory ?? 0).toBeGreaterThanOrEqual(1);
    expect(trained(s, 'sniper', 'grenadier')).toBeGreaterThanOrEqual(3);
    expect(s.buildings.machineGunTower ?? 0).toBe(0);
  });

  it('the nest raider survives the first surge night and has destroyed nests', { timeout: 30_000 }, () => {
    const s = play('raider', 'militia', FIRST_BOSS_NIGHT);
    expect(s.outcome).toBe('playing');
    expect(s.stats.nestsDestroyed).toBeGreaterThanOrEqual(2);
    expect(trained(s, 'pickup', 'flamethrower')).toBeGreaterThanOrEqual(1);
    expect(s.buildings.machineGunTower ?? 0).toBe(0);
  });

  it('the fortress survives the first surge night behind barricades and towers, with a small barracks army', { timeout: 30_000 }, () => {
    const s = play('fortress', 'scavengers', FIRST_BOSS_NIGHT);
    expect(s.outcome).toBe('playing');
    expect(s.buildings.machineGunTower ?? 0).toBeGreaterThanOrEqual(2);
    expect(s.buildings.barricade ?? 0).toBeGreaterThanOrEqual(20);
    expect(trained(s, 'sniper', 'grenadier', 'flamethrower', 'pickup')).toBe(0);
    // Incidental combat can kill nests; only split-warning missions may order a targeted raid.
    expect(s.unmarkedNestAttacks).toEqual([]);
  });
});
