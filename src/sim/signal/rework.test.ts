import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { hashState, restoreGame, serializeGame } from '../index';
import { applyCommand, validateCommand } from '../commandHandlers';
import { planNight, nightSystem } from '../combat/night';
import { outcomeSystem } from '../combat/outcome';
import { refreshSoldierStats } from '../combat/soldiers';
import { BUILDINGS } from '../data/economy';
import { SOLDIERS } from '../data/combat';
import { SIGNAL, SIGNAL_TEXT } from '../data/signal';
import { constructionSystem } from '../economy/construction';
import { workerSystem } from '../economy/workers';
import { refreshModifiers } from '../game';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS, TICKS_PER_SECOND, clockAt } from '../time';
import { addBuilding, removeEntity, spawnSoldier, spawnSurvivor } from '../world/entities';
import { visionRadius } from '../world/fog';
import { createSignalState } from './model';
import { signalSystem } from './signal';

function fixture(complete = false) {
  const g = createTestGame(Array.from({ length: 12 }, (_, y) => y >= 2 && y < 5 ? '..CCC.........................' : '..............................'));
  const site = { tileX: 22, tileY: 5, size: 3 as const };
  g.state.map.relaySite = site;
  g.state.signal = createSignalState(site);
  g.state.signal.stage = 'repair';
  const b = addBuilding(g, 'signalTower', site.tileX, site.tileY, { complete });
  g.state.signal.buildingId = b.id;
  if (complete) signalSystem(g);
  g.events.length = 0;
  return { g, b };
}
function tick(g: ReturnType<typeof fixture>['g'], at: number) {
  g.state.tick = at;
  g.state.clock = clockAt(at);
  signalSystem(g);
}
function messages(g: ReturnType<typeof fixture>['g']) {
  return g.events.filter(e => e.type === 'signalMessage').map(e => e.text);
}
function pauseCount(g: ReturnType<typeof fixture>['g']) {
  return messages(g).filter(text => text === SIGNAL_TEXT.paused).length;
}
function worker(g: ReturnType<typeof fixture>['g'], b: ReturnType<typeof fixture>['b']) {
  const s = spawnSurvivor(g, b.tileX - .5, b.y);
  applyCommand(g, { type: 'assignWork', buildingId: b.id, unitIds: [s.id] });
  workerSystem(g);
  return s;
}

it.each(['night', 'afterDuskPlan'] as const)('starting broadcast %s leaves live, pending and planned targets unchanged', timing => {
  const { g, b } = fixture(true);
  g.calendarPlan.fill('raid');
  g.state.map.spawnPoints = [{ direction: 'E', tile: 29 }, { direction: 'W', tile: 0 }];
  tick(g, 5 * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS);
  nightSystem(g);
  expect(g.state.night.plan!.groups.filter(group => group.nestId === 0)).toHaveLength(2);
  if (timing === 'night') {
    for (let n = DAY_TICKS; n <= DAY_TICKS + 250; n++) {
      tick(g, 5 * CYCLE_TICKS + n);
      nightSystem(g);
    }
    expect([...g.state.entities.values()].filter(e => e.kind === 'mutant' && e.ai.mode === 'assault').length).toBeGreaterThan(2);
  } else tick(g, g.state.tick + 1);
  const before = structuredClone({ night: g.state.night, mutants: [...g.state.entities.values()].filter(e => e.kind === 'mutant') });
  expect(applyCommand(g, { type: 'startSignalBroadcast' }).ok).toBe(true);
  expect({ night: g.state.night, mutants: [...g.state.entities.values()].filter(e => e.kind === 'mutant') }).toEqual(before);
  tick(g, 6 * CYCLE_TICKS);
  expect(g.state.signal.nightsHeld).toBe(0);
  expect(messages(g).at(-1)).toBe('长明城接线员："锈原，我们收到了。车队正在集结，预计还要 3 天，请坚持住。"');
  const next = planNight(g, 7);
  expect(next.groups.filter(group => group.assaultTargetId === b.id)).toHaveLength(1);
});

it('uses complete first/later dawn templates and skips operator dialogue at rescue', () => {
  const { g } = fixture(true);
  applyCommand(g, { type: 'startSignalBroadcast' });
  tick(g, CYCLE_TICKS);
  expect(messages(g).at(-1)).toBe('长明城接线员："锈原，我们收到了。车队正在集结，预计还要 2 天，请坚持住。"');
  tick(g, 2 * CYCLE_TICKS);
  expect(messages(g).at(-1)).toBe('长明城接线员："车队已经出发，预计还要 1 天。"');
  g.events.length = 0;
  tick(g, 3 * CYCLE_TICKS);
  outcomeSystem(g);
  expect(messages(g)).toEqual([SIGNAL_TEXT.endingTitle, SIGNAL_TEXT.ending]);
});

it('after destruction and a new broadcast, the next dawn uses the first template again', () => {
  const { g, b } = fixture(true);
  applyCommand(g, { type: 'startSignalBroadcast' });
  tick(g, CYCLE_TICKS);
  b.hp = 0;
  signalSystem(g);
  removeEntity(g, b);
  const rebuilt = addBuilding(g, 'signalTower', 22, 5, { complete: true });
  g.state.signal.buildingId = rebuilt.id;
  signalSystem(g);
  applyCommand(g, { type: 'startSignalBroadcast' });
  tick(g, 2 * CYCLE_TICKS);
  expect(messages(g).at(-1)).toBe('长明城接线员："锈原，我们收到了。车队正在集结，预计还要 2 天，请坚持住。"');
});

it('never announces an empty site during initial worker travel', () => {
  const { g, b } = fixture();
  const s = spawnSurvivor(g, 1, 1);
  applyCommand(g, { type: 'assignWork', buildingId: b.id, unitIds: [s.id] });
  tick(g, 1);
  tick(g, 60 * TICKS_PER_SECOND);
  expect(pauseCount(g)).toBe(0);
});

it('waits for continuous absence, rearms after return, but announces at most once per day', () => {
  const { g, b } = fixture();
  worker(g, b);
  tick(g, 1);
  applyCommand(g, { type: 'unassignWork', buildingId: b.id, count: 1 });
  tick(g, 2);
  tick(g, 2 + 14 * TICKS_PER_SECOND);
  expect(pauseCount(g)).toBe(0);
  tick(g, 2 + 15 * TICKS_PER_SECOND);
  expect(pauseCount(g)).toBe(1);
  worker(g, b);
  tick(g, 400);
  applyCommand(g, { type: 'unassignWork', buildingId: b.id, count: 1 });
  tick(g, 401);
  tick(g, 1000);
  expect(pauseCount(g)).toBe(1);
  worker(g, b);
  tick(g, CYCLE_TICKS);
  applyCommand(g, { type: 'unassignWork', buildingId: b.id, count: 1 });
  tick(g, CYCLE_TICKS + 1);
  tick(g, CYCLE_TICKS + 301);
  expect(pauseCount(g)).toBe(2);
});

it('completion releases onsite workers and refuses new assignments, including workers still travelling', () => {
  const { g, b } = fixture();
  const s = worker(g, b);
  const travelling = spawnSurvivor(g, 1, 1);
  applyCommand(g, { type: 'assignWork', buildingId: b.id, unitIds: [travelling.id] });
  b.construction!.progress = b.construction!.total - 1;
  constructionSystem(g);
  expect(b.construction).toBeNull();
  expect(b.workers).toEqual([]);
  expect(s.insideId).toBe(0);
  expect(s.task).toEqual({ type: 'idle' });
  expect(validateCommand(g, { type: 'assignWork', buildingId: b.id, unitIds: [s.id] })).toEqual({ ok: false, reason: 'signalTowerComplete' });
  workerSystem(g);
  expect(travelling.task).toEqual({ type: 'idle' });
});

it.each([false, true])('max HP changes preserve health fraction consistently (expedition researched: %s)', expedition => {
  const { g } = fixture();
  const s = spawnSoldier(g, 'shieldGuard', 7, 3);
  if (expedition) g.state.economy.tech.researched.push('expeditionPack');
  refreshModifiers(g);
  s.hp = SOLDIERS.shieldGuard.hp / 2;
  s.veterancy.promotion = 'ironWall';
  refreshSoldierStats(g, s);
  expect(s.hp / s.maxHp).toBeCloseTo(.5);
  s.veterancy.promotion = null;
  refreshSoldierStats(g, s);
  expect(s.hp).toBeCloseTo(SOLDIERS.shieldGuard.hp / 2);
});

it('post-storm vision immunity reads aggregated modifiers, not technology definitions', () => {
  const { g } = fixture();
  const s = spawnSurvivor(g, 7, 3);
  g.state.calendar.reducedVisionUntilTick = 1000;
  expect(visionRadius(g, s)).toBeCloseTo(s.vision * .8);
  g.modifiers.global.postStormVisionImmunity = 1;
  expect(visionRadius(g, s)).toBe(s.vision);
  g.modifiers.global.postStormVisionImmunity = 0;
  g.state.economy.tech.researched.push('fogFiltration');
  expect(visionRadius(g, s)).toBeCloseTo(s.vision * .8);
  refreshModifiers(g);
  expect(visionRadius(g, s)).toBe(s.vision);
});

it('signal workload and workstation capacity derive from the same data', () => {
  expect(BUILDINGS.signalTower.workerSlots).toBe(SIGNAL.workerSlots);
  expect(BUILDINGS.signalTower.buildSeconds).toBe(SIGNAL.repairDays * CYCLE_TICKS / TICKS_PER_SECOND * SIGNAL.workerSlots);
});

it('a destroyed ordinary construction site cannot heal itself or finish', () => {
  const { g } = fixture();
  const b = addBuilding(g, 'shack', 8, 5, { complete: false });
  b.construction!.progress = b.construction!.total - 1;
  b.hp = 0;
  constructionSystem(g);
  expect(b.hp).toBe(0);
  expect(b.construction).not.toBeNull();
  expect(b.construction!.progress).toBe(b.construction!.total - 1);
});

it('data uses surrounding TypeScript style, leading file comments and the building helper in enum order', () => {
  const economy = readFileSync(new URL('../data/economy.ts', import.meta.url), 'utf8');
  const signal = readFileSync(new URL('../data/signal.ts', import.meta.url), 'utf8');
  const production = readFileSync(new URL('../economy/production.ts', import.meta.url), 'utf8');
  expect([economy, production].every(source => source.startsWith('/**'))).toBe(true);
  expect([economy, signal].some(source => /^\s*"\w+":/m.test(source))).toBe(false);
  expect(economy).toContain('signalTower: building({');
  expect(Object.keys(BUILDINGS)[0]).toBe('core');
});


it('saving during an unstaffed interval preserves the warning timer and same-day suppression', () => {
  const { g } = fixture();
  tick(g, 1);
  tick(g, 101);
  const restored = restoreGame(serializeGame(g))!;
  g.events.length = 0;
  tick(g, 301);
  tick(restored, 301);
  expect(pauseCount(g)).toBe(1);
  expect(pauseCount(restored)).toBe(1);
  expect(hashState(restored)).toBe(hashState(g));
  const warned = restoreGame(serializeGame(g))!;
  tick(warned, 601);
  expect(pauseCount(warned)).toBe(0);
});
