import { describe, expect, it } from 'vitest';
import { stepGame } from './pipeline';
import { deployArmy, releaseHorde } from './scenarios';
import { createGame } from './world/setup';

function coreOf(game: ReturnType<typeof createGame>) {
  return game.state.entities.get(game.state.coreId)!;
}

describe('debug scenarios', () => {
  it('deploys an idle mixed army around the core, one soldier per free tile', () => {
    const game = createGame({ seed: 'scenario', origin: 'militia', difficulty: 'normal' });
    const army = deployArmy(game, 40);
    expect(army).toHaveLength(40);
    expect(new Set(army.map((s) => `${Math.floor(s.x)},${Math.floor(s.y)}`)).size).toBe(40);
    expect(new Set(army.map((s) => s.type)).size).toBeGreaterThanOrEqual(5);
    const core = coreOf(game);
    for (const s of army) expect(Math.hypot(s.x - core.x, s.y - core.y)).toBeLessThanOrEqual(9.01);
  });

  it('releases a horde on a far ring that marches on the core', () => {
    const game = createGame({ seed: 'scenario', origin: 'militia', difficulty: 'normal' });
    const horde = releaseHorde(game, 120, { hpPct: 2, damagePct: -0.5 });
    expect(horde).toHaveLength(120);
    const core = coreOf(game);
    const meanDistance = () => horde.reduce((sum, m) => sum + Math.hypot(m.x - core.x, m.y - core.y), 0) / horde.length;
    const before = meanDistance();
    expect(before).toBeGreaterThan(12);
    expect(horde.every((m) => m.ai.mode === 'assault' && m.hp === m.maxHp && m.ai.damagePct === -0.5)).toBe(true);
    for (let t = 0; t < 60; t++) stepGame(game);
    expect(meanDistance()).toBeLessThan(before - 1);
  });
});
