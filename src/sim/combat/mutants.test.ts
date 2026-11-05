import { describe, expect, it } from 'vitest';
import { MUTANTS, NEST } from '../data/combat';
import { SURVIVOR } from '../data/economy';
import type { Game } from '../game';
import { stepGame } from '../pipeline';
import type { Building, Entity, Mutant, Nest } from '../state';
import { createTestGame } from '../testing';
import { addBuilding, spawnMutant, spawnSoldier, spawnSurvivor } from '../world/entities';
import { followFlowField } from '../world/movement';

const OPEN = [
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
  '.............CCC..............',
  '.............CCC..............',
  '.............CCC..............',
  '..............................',
  '..............................',
  '..............................',
  '..............................',
];

function run(game: Game, ticks: number, until?: () => boolean): number {
  for (let t = 0; t < ticks; t++) {
    stepGame(game);
    if (until?.()) return t + 1;
  }
  return ticks;
}

function assault(game: Game, type: Mutant['type'], x: number, y: number): Mutant {
  const m = spawnMutant(game, type, x, y, { mode: 'assault' });
  followFlowField(m);
  return m;
}

function core(game: Game): Building {
  return game.state.entities.get(game.state.coreId) as Building;
}

function damaged(e: Entity): boolean {
  return e.hp < e.maxHp;
}

/** Barricades on every tile of the ring `gap` tiles outside the core footprint, except `skip`. */
function ringAroundCore(game: Game, gap: number, skip: (x: number, y: number) => boolean = () => false): Building[] {
  const c = game.state.map.coreTile;
  const out: Building[] = [];
  for (let y = c.y - gap; y <= c.y + 2 + gap; y++) {
    for (let x = c.x - gap; x <= c.x + 2 + gap; x++) {
      const onRing = x === c.x - gap || x === c.x + 2 + gap || y === c.y - gap || y === c.y + 2 + gap;
      if (onRing && !skip(x, y)) out.push(addBuilding(game, 'barricade', x, y, { complete: true }));
    }
  }
  return out;
}

describe('assaulting mutants', () => {
  it('walk to the core and attack it', () => {
    const game = createTestGame(OPEN);
    assault(game, 'wanderer', 1.5, 1.5);
    run(game, 900, () => damaged(core(game)));
    expect(damaged(core(game))).toBe(true);
  });

  it('attack the barricade that blocks them when the core is fully walled in', () => {
    const game = createTestGame(OPEN);
    const ring = ringAroundCore(game, 2);
    for (const b of ring) b.hp = 60; // breakable before dawn sends the wanderer home
    const hitWall = (b: Building) => b.hp < 60;
    assault(game, 'wanderer', 1.5, 6.5);
    run(game, 900, () => ring.some(hitWall));
    const hit = ring.filter(hitWall);
    expect(hit).toHaveLength(1);
    expect(damaged(core(game))).toBe(false);
    run(game, 1500, () => damaged(core(game)));
    expect(game.state.entities.has(hit[0]!.id)).toBe(false);
    expect(damaged(core(game))).toBe(true);
  });

  it('keep pressing into the wall they hit instead of path-finding around it', () => {
    const game = createTestGame(OPEN);
    const ring = ringAroundCore(game, 2);
    const pack = [0, 1, 2, 3].map((k) => assault(game, 'runner', 1.5, 5.5 + k * 0.5));
    run(game, 400);
    expect(ring.some(damaged)).toBe(true);
    // moveUnitTo stamps pathNavVersion; flow following never does.
    for (const m of pack) expect(m.motion.pathNavVersion).toBe(-1);
  });

  it('detour around buildings while an open route exists', () => {
    const game = createTestGame(OPEN);
    const c = game.state.map.coreTile;
    const ring = ringAroundCore(game, 2, (x, y) => x === c.x + 4 && y === c.y + 1);
    assault(game, 'wanderer', 1.5, 6.5);
    run(game, 1500, () => damaged(core(game)));
    expect(damaged(core(game))).toBe(true);
    expect(ring.some(damaged)).toBe(false);
  });

  it('turn on player units they notice, but not ones behind a wall', () => {
    const game = createTestGame(OPEN);
    const v = spawnSurvivor(game, 4.5, 2.5);
    assault(game, 'wanderer', 1.5, 2.5);
    run(game, 200, () => v.hp < SURVIVOR.hp);
    expect(v.hp).toBeLessThan(SURVIVOR.hp);

    const walled = createTestGame(OPEN);
    const ring = ringAroundCore(walled, 2);
    const inside = spawnSurvivor(walled, 13.5, 4.5);
    assault(walled, 'wanderer', 13.5, 0.5);
    run(walled, 600, () => ring.some(damaged));
    expect(ring.some(damaged)).toBe(true);
    expect(inside.hp).toBe(SURVIVOR.hp);
  });

  it('spitters stop at range and aim at the clump', () => {
    const game = createTestGame(OPEN);
    const lone = spawnSurvivor(game, 4.0, 1.5);
    const clump = [spawnSurvivor(game, 1.5, 5.6), spawnSurvivor(game, 2.1, 5.6), spawnSurvivor(game, 1.8, 6.1)];
    for (const s of [lone, ...clump]) s.motion.mass = 1000;
    const sp = assault(game, 'spitter', 1.5, 1.5);
    run(game, 60, () => clump.some((s) => s.hp < SURVIVOR.hp) || lone.hp < SURVIVOR.hp);
    expect(clump.every((s) => s.hp < SURVIVOR.hp)).toBe(true);
    expect(lone.hp).toBe(SURVIVOR.hp);
    expect(Math.hypot(sp.x - 1.5, sp.y - 1.5)).toBeLessThan(0.5);
  });

  it('boomers run for the nearest building and blow up on it', () => {
    const game = createTestGame(OPEN);
    const shack = addBuilding(game, 'shack', 3, 8, { complete: true });
    const boomer = assault(game, 'boomer', 1.5, 2.5);
    run(game, 300, () => !game.state.entities.has(boomer.id));
    expect(game.state.entities.has(boomer.id)).toBe(false);
    expect(damaged(shack)).toBe(true);
    expect(damaged(core(game))).toBe(false);
    expect(game.state.stats.kills.boomer).toBe(0);
  });

  it('the behemoth smashes buildings near its way', () => {
    const game = createTestGame(OPEN);
    const shack = addBuilding(game, 'shack', 6, 9, { complete: true });
    assault(game, 'behemoth', 1.5, 9.5);
    run(game, 600, () => damaged(shack));
    expect(damaged(shack)).toBe(true);
    expect(damaged(core(game))).toBe(false);
  });

  it('keep fighting soldiers that attack them', () => {
    const game = createTestGame(OPEN);
    const s = spawnSoldier(game, 'rifleman', 6.5, 1.5);
    s.order = { type: 'hold' };
    const m = assault(game, 'crawler', 1.5, 1.5);
    run(game, 400, () => s.hp < s.maxHp);
    expect(s.hp).toBeLessThan(s.maxHp);
    expect(m.attack.targetId).toBe(s.id);
  });
});

describe('guards and retreat', () => {
  const NEST_MAP = [
    '..............................',
    '..............................',
    '..NN..........................',
    '..NN..........................',
    '..............................',
    '.............CCC..............',
    '.............CCC..............',
    '.............CCC..............',
    '..............................',
  ];

  it('guards attack intruders near their nest, then walk home', () => {
    const game = createTestGame(NEST_MAP);
    const nest = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    for (const e of game.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    stepGame(game);
    const g = spawnMutant(game, 'wanderer', 3, 5.5, { mode: 'guard', homeNestId: nest.id });
    const v = spawnSurvivor(game, 6.5, 2.5);
    v.motion.mass = 1000;
    run(game, 200, () => v.hp < SURVIVOR.hp);
    expect(v.hp).toBeLessThan(SURVIVOR.hp);
    v.hp = 0;
    run(game, 300);
    expect(Math.hypot(g.x - nest.x, g.y - nest.y)).toBeLessThanOrEqual(NEST.guardRadius);
    expect(g.ai.mode).toBe('guard');
  });

  it('guards ignore units far from their nest', () => {
    const game = createTestGame(NEST_MAP);
    const nest = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    for (const e of game.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    stepGame(game);
    spawnMutant(game, 'runner', 3, 5.0, { mode: 'guard', homeNestId: nest.id });
    const v = spawnSurvivor(game, 3 + NEST.guardRadius + 6, 5.0);
    run(game, 200);
    expect(v.hp).toBe(SURVIVOR.hp);
  });

  it('retreating mutants walk to their nest without attacking anyone', () => {
    const game = createTestGame(NEST_MAP);
    const nest = [...game.state.entities.values()].find((e): e is Nest => e.kind === 'nest')!;
    for (const e of game.state.entities.values()) if (e.kind === 'mutant') e.hp = 0;
    stepGame(game);
    const m = spawnMutant(game, 'wanderer', 16.5, 8.5, { mode: 'retreat', homeNestId: nest.id });
    const v = spawnSurvivor(game, 17.3, 8.5);
    run(game, 40);
    expect(v.hp).toBe(SURVIVOR.hp);
    expect(m.motion.mode).toBe('path');
    expect(Math.hypot(m.x - nest.x, m.y - nest.y)).toBeLessThan(Math.hypot(16.5 - nest.x, 8.5 - nest.y));
    expect(MUTANTS.wanderer.hp).toBe(m.maxHp);
  });
});
