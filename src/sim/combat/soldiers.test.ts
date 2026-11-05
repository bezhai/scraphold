import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commandHandlers';
import { HUNGER, MUTANTS, SOLDIERS } from '../data/combat';
import { drainEvents } from '../events';
import type { Game } from '../game';
import { refreshModifiers } from '../game';
import { stepGame } from '../pipeline';
import type { Mutant, Nest, Soldier } from '../state';
import { FOG_VISIBLE } from '../state';
import { createTestGame } from '../testing';
import { spawnMutant, spawnSoldier, spawnSurvivor } from '../world/entities';
import { soldierSystem } from './soldiers';
import { veteranThreshold } from './damage';

const ROWS = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '...........................CCC',
  '...........................CCC',
  '...........................CCC',
];

/** A mutant that stands still and never attacks: retreating with no nest on the map. */
function dummy(game: Game, type: Mutant['type'], x: number, y: number): Mutant {
  return spawnMutant(game, type, x, y, { mode: 'retreat' });
}

function run(game: Game, ticks: number, each?: () => boolean | void): number {
  for (let t = 0; t < ticks; t++) {
    stepGame(game);
    if (each?.()) return t + 1;
  }
  return ticks;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function gapBetweenUnits(a: { x: number; y: number; radius: number }, b: { x: number; y: number; radius: number }): number {
  return dist(a, b) - a.radius - b.radius;
}

describe('soldier orders', () => {
  it('attack-move engages enemies met on the way, then continues and idles at the destination', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 3.5);
    const m = dummy(game, 'wanderer', 12.5, 1.5);
    expect(applyCommand(game, { type: 'attackMove', unitIds: [s.id], x: 22.5, y: 3.5 }).ok).toBe(true);
    let stoppedAt = -1;
    run(game, 400, () => {
      if (stoppedAt < 0 && s.motion.mode === 'stand') stoppedAt = s.x;
      return s.order.type === 'idle';
    });
    expect(stoppedAt).toBeGreaterThan(1.5);
    expect(stoppedAt).toBeLessThan(12.5);
    expect(game.state.entities.has(m.id)).toBe(false);
    expect(game.state.stats.kills.wanderer).toBe(1);
    expect(s.order).toEqual({ type: 'idle' });
    expect(dist(s, { x: 22.5, y: 3.5 })).toBeLessThan(0.5);
  });

  it('forced move never engages, even when attacked on the way', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 3.5);
    const m = spawnMutant(game, 'wanderer', 9.5, 4.2, { mode: 'assault' });
    m.attack.targetId = s.id;
    expect(applyCommand(game, { type: 'move', unitIds: [s.id], x: 22.5, y: 3.5 }).ok).toBe(true);
    run(game, 400, () => s.order.type === 'idle');
    expect(s.order).toEqual({ type: 'idle' });
    expect(dist(s, { x: 22.5, y: 3.5 })).toBeLessThan(0.5);
    expect(m.hp).toBe(MUTANTS.wanderer.hp);
    expect(game.state.stats.kills.wanderer).toBe(0);
  });

  it('focus fire ignores nearer enemies, chases the target, and idles once it dies', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 3.5);
    const near = dummy(game, 'wanderer', 4.5, 3.5);
    const far = dummy(game, 'wanderer', 16.5, 3.5);
    game.state.fog.fill(FOG_VISIBLE);
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [s.id], targetId: far.id }).ok).toBe(true);
    run(game, 600, () => !game.state.entities.has(far.id));
    expect(game.state.entities.has(far.id)).toBe(false);
    expect(near.hp).toBe(MUTANTS.wanderer.hp);
    stepGame(game);
    expect(s.order).toEqual({ type: 'idle' });
  });

  it('focus fire on a discovered nest walks up to it and damages it', () => {
    const game = createTestGame([...ROWS.slice(0, 6), '......................NN......', '......................NN......', ...ROWS.slice(8)]);
    const nest = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    nest.discovered = true;
    const s = spawnSoldier(game, 'shieldGuard', 1.5, 3.5);
    for (const e of game.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    expect(applyCommand(game, { type: 'attackTarget', unitIds: [s.id], targetId: nest.id }).ok).toBe(true);
    run(game, 500, () => nest.hp < nest.maxHp);
    expect(nest.hp).toBeLessThan(nest.maxHp);
  });

  it('hold never moves, but fires at whatever comes into range', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 3.5);
    applyCommand(game, { type: 'hold', unitIds: [s.id] });
    const out = dummy(game, 'wanderer', 1.5 + 0.62 + SOLDIERS.rifleman.weapon.range + 0.3, 3.5);
    run(game, 60);
    expect(dist(s, { x: 1.5, y: 3.5 })).toBeLessThan(0.05);
    expect(out.hp).toBe(MUTANTS.wanderer.hp);
    const inRange = dummy(game, 'wanderer', 6.0, 3.5);
    run(game, 30);
    expect(inRange.hp).toBeLessThan(MUTANTS.wanderer.hp);
    expect(dist(s, { x: 1.5, y: 3.5 })).toBeLessThan(0.05);
  });

  it('idle soldiers engage enemies close to their spot and walk back afterwards', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'shieldGuard', 5.5, 3.5);
    run(game, 5);
    const m = dummy(game, 'runner', 7.8, 3.5);
    let maxAway = 0;
    run(game, 200, () => {
      maxAway = Math.max(maxAway, dist(s, { x: 5.5, y: 3.5 }));
      return !game.state.entities.has(m.id);
    });
    expect(game.state.entities.has(m.id)).toBe(false);
    expect(maxAway).toBeGreaterThan(1);
    run(game, 120);
    expect(dist(s, { x: 5.5, y: 3.5 })).toBeLessThan(0.3);
    expect(s.order).toEqual({ type: 'idle' });
  });

  it('idle soldiers walk back when the enemy they chase is killed by someone else', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'shieldGuard', 5.5, 3.5);
    run(game, 5);
    const m = dummy(game, 'runner', 8.3, 3.5);
    run(game, 100, () => s.motion.mode === 'path' && dist(s, { x: 5.5, y: 3.5 }) > 0.5);
    expect(s.motion.mode).toBe('path');
    m.hp = 0;
    run(game, 120);
    expect(dist(s, { x: 5.5, y: 3.5 })).toBeLessThan(0.3);
  });

  it('idle soldiers do not chase enemies far from their spot', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'shieldGuard', 5.5, 3.5);
    const m = dummy(game, 'runner', 12.5, 3.5);
    run(game, 100);
    expect(dist(s, { x: 5.5, y: 3.5 })).toBeLessThan(0.3);
    expect(m.hp).toBe(MUTANTS.runner.hp);
  });

  it('idle soldiers answer a mutant hitting the core within their leash, even beyond their acquire radius', () => {
    const game = createTestGame(ROWS);
    const coreId = game.state.coreId;
    // The boss smashes buildings first and ignores the guard; the core's west edge is x = 27.
    const boss = spawnMutant(game, 'behemoth', 26.1, 9.5, { mode: 'assault' });
    const s = spawnSoldier(game, 'shieldGuard', 21.5, 9.5);
    // Gap 4.6 - 0.34 - 0.8 = 3.46: beyond the acquire radius (0.45 + 2.5), inside vision (6) and the leash.
    run(game, 8);
    expect(boss.attack.targetId).toBe(coreId);
    run(game, 12);
    expect(s.attack.targetId).toBe(boss.id);
    run(game, 40);
    expect(gapBetweenUnits(s, boss)).toBeLessThan(1);
  });

  it('idle riflemen answer a visible mutant attacking a survivor beyond their acquire radius', () => {
    const game = createTestGame(ROWS);
    const survivor = spawnSurvivor(game, 18.5, 3.5);
    const m = spawnMutant(game, 'wanderer', 17.7, 3.5, { mode: 'assault' });
    // Gap 8.2 - 0.3 - 0.32 = 7.58: beyond the rifleman's acquire radius (vision 7), inside its leash (5 + 6.5).
    const s = spawnSoldier(game, 'rifleman', 9.5, 3.5);
    run(game, 8);
    expect(m.attack.targetId).toBe(survivor.id);
    run(game, 12);
    expect(s.attack.targetId).toBe(m.id);
  });

  it('idle soldiers keep their spot while another soldier fights beyond their acquire radius', () => {
    const game = createTestGame(ROWS);
    const front = spawnSoldier(game, 'shieldGuard', 18.5, 3.5);
    const m = spawnMutant(game, 'wanderer', 19.2, 3.5, { mode: 'assault' });
    const s = spawnSoldier(game, 'rifleman', 9.5, 3.5);
    run(game, 20);
    expect(m.attack.targetId).toBe(front.id);
    expect(s.attack.targetId).toBe(0);
    expect(dist(s, { x: 9.5, y: 3.5 })).toBeLessThan(0.3);
  });

  it('idle soldiers leave a mutant hitting the core alone when it is beyond their leash', () => {
    const game = createTestGame(ROWS);
    const boss = spawnMutant(game, 'behemoth', 26.1, 9.5, { mode: 'assault' });
    // A scout sees 11 tiles but only chases within 5 + 4 of its spot: gap 11 - 0.34 - 0.8 = 9.86.
    const s = spawnSoldier(game, 'scout', 15.1, 9.5);
    run(game, 40);
    expect(s.attack.targetId).toBe(0);
    expect(dist(s, { x: 15.1, y: 9.5 })).toBeLessThan(0.3);
    expect(boss.attack.targetId).toBe(game.state.coreId);
  });

  it('a stop while walking back makes the current spot the new guard spot', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'shieldGuard', 5.5, 3.5);
    run(game, 5);
    applyCommand(game, { type: 'move', unitIds: [s.id], x: 12.5, y: 3.5 });
    run(game, 400, () => s.order.type === 'idle');
    applyCommand(game, { type: 'stop', unitIds: [s.id] });
    run(game, 60);
    expect(dist(s, { x: 12.5, y: 3.5 })).toBeLessThan(0.3);
  });

  it('picks the target its weapon hurts most: snipers shoot crawlers before wanderers', () => {
    const game = createTestGame(ROWS);
    const sniper = spawnSoldier(game, 'sniper', 1.5, 3.5);
    const wanderer = dummy(game, 'wanderer', 4.5, 3.5);
    const crawler = dummy(game, 'crawler', 9.5, 3.5);
    applyCommand(game, { type: 'hold', unitIds: [sniper.id] });
    run(game, 2);
    expect(crawler.hp).toBeLessThan(MUTANTS.crawler.hp);
    expect(wanderer.hp).toBe(MUTANTS.wanderer.hp);
  });

  it('finishes a wounded enemy before starting on a fresh one of the same kind', () => {
    const game = createTestGame(ROWS);
    const rifleman = spawnSoldier(game, 'rifleman', 1.5, 3.5);
    const fresh = dummy(game, 'wanderer', 4.5, 3.5);
    const wounded = dummy(game, 'wanderer', 6.5, 3.5);
    wounded.hp = 5;
    applyCommand(game, { type: 'hold', unitIds: [rifleman.id] });
    run(game, 2);
    expect(wounded.hp).toBe(0);
    expect(fresh.hp).toBe(MUTANTS.wanderer.hp);
  });
});

describe('veterancy', () => {
  it('offers the promotion as soon as a tech lowers the threshold below the kills already made', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'rifleman', 1.5, 1.5);
    s.veterancy.kills = SOLDIERS.rifleman.veteranKills - 1;
    soldierSystem(game);
    expect(s.veterancy.pending).toBe(false);
    game.state.economy.tech.researched.push('veteranDoctrine');
    refreshModifiers(game);
    soldierSystem(game);
    expect(s.veterancy.pending).toBe(true);
    expect(drainEvents(game)).toContainEqual({ type: 'promotionReady', unitId: s.id });
  });

  it('rounds the lowered threshold to the nearest kill, at least one', () => {
    const game = createTestGame(ROWS);
    const guard = spawnSoldier(game, 'shieldGuard', 1.5, 1.5);
    expect(veteranThreshold(game, guard)).toBe(SOLDIERS.shieldGuard.veteranKills);
    game.state.economy.tech.researched.push('veteranDoctrine');
    refreshModifiers(game);
    // 12 x (1 - 0.3) = 8.4
    expect(veteranThreshold(game, guard)).toBe(8);
    game.modifiers.global.veterancyKillsPct = -1;
    expect(veteranThreshold(game, guard)).toBe(1);
  });
});

describe('soldier stats', () => {
  it('keeps max hp, speed and vision in line with techs, promotions and hunger', () => {
    const game = createTestGame(ROWS);
    const s = spawnSoldier(game, 'scout', 1.5, 1.5) as Soldier;
    s.hp -= 30;
    game.state.economy.tech.researched.push('veteranDoctrine');
    refreshModifiers(game);
    soldierSystem(game);
    expect(s.maxHp).toBeCloseTo(SOLDIERS.scout.hp * 1.1);
    expect(s.hp).toBeCloseTo(s.maxHp * (SOLDIERS.scout.hp - 30) / SOLDIERS.scout.hp);
    s.veterancy.promotion = 'outrider';
    game.state.economy.upkeep.hungry = true;
    soldierSystem(game);
    expect(s.motion.speed).toBeCloseTo(SOLDIERS.scout.speed * (1 + 0.2 + HUNGER.speedPct));
    expect(s.vision).toBe(SOLDIERS.scout.vision + 2);
    game.state.economy.tech.researched.length = 0;
    refreshModifiers(game);
    soldierSystem(game);
    expect(s.maxHp).toBeCloseTo(SOLDIERS.scout.hp);
    expect(s.hp).toBeLessThanOrEqual(s.maxHp);
  });
});
