import { readFileSync } from 'node:fs';
import { planNight, nightSystem } from '../combat/night';
import { mutantAiSystem } from '../combat/mutants';
import { combatSystem } from '../combat/attacks';
import { movementSystem } from '../world/movement';
import { rebuildSpatialIndex } from '../world/spatial';
import { removeEntity } from '../world/entities';
import { hashState, serializeGame, restoreGame, stepGame } from '../index';
import { SIGNAL_TEXT } from '../data/signal';
import { techSystem } from '../economy/tech';
import { TECHS } from '../data/economy';
import { describe, expect, it } from 'vitest';
import { applyCommand, validateCommand } from '../commandHandlers';
import { constructionSystem } from '../economy/construction';
import { refreshModifiers } from '../game';
import { createTestGame } from '../testing';
import { addNest, spawnMutant, spawnSurvivor } from '../world/entities';
import { workerSystem } from '../economy/workers';
import { signalSystem } from './signal';
import { createSignalState } from './model';
import { SIGNAL } from '../data/signal';
import { clockAt, CYCLE_TICKS } from '../time';
import { outcomeSystem, scoreFor } from '../combat/outcome';
import type { Building } from '../state';

function fixture() {
  const g = createTestGame(Array.from({ length: 12 }, (_, y) => y >= 2 && y < 5 ? '..CCC.........................' : '..............................'));
  g.state.map.relaySite = { tileX: 22, tileY: 5, size: 3 };
  g.state.signal = createSignalState(g.state.map.relaySite);
  g.state.economy.resources = { scrap: 10000, fuel: 10000, food: 10000, research: 0 };
  return g;
}
function decoded() {
  const g = fixture();
  spawnSurvivor(g, 21.5, 6.5);
  g.state.economy.tech.researched.push('oldFrequency'); refreshModifiers(g); signalSystem(g);
  return g;
}
function tower() {
  const g = decoded();
  expect(applyCommand(g, { type: 'placeBuilding', building: 'signalTower', tileX: 22, tileY: 5 })).toEqual({ ok: true });
  return { g, b: g.state.entities.get(g.state.signal.buildingId) as Building };
}

describe('relay project', () => {
  it('latches arrival before research, then decodes without a command', () => {
    const g = fixture(); const u = spawnSurvivor(g, 21.5, 6.5);
    signalSystem(g); expect(g.state.signal.stage).toBe('decoding'); expect(g.state.signal.visited).toBe(true);
    u.x = 1; u.y = 1;
    g.state.economy.tech.researched.push('oldFrequency'); refreshModifiers(g); signalSystem(g);
    expect(g.state.signal.stage).toBe('repair');
  });
  it('requires research and the fixed site', () => {
    const g = fixture();
    expect(validateCommand(g, { type: 'placeBuilding', building: 'signalTower', tileX: 22, tileY: 5 })).toEqual({ ok: false, reason: 'signalNotDecoded' });
    const d = decoded(); expect(d.state.signal.stage).toBe('repair');
    expect(validateCommand(d, { type: 'placeBuilding', building: 'signalTower', tileX: 15, tileY: 5 })).toEqual({ ok: false, reason: 'wrongRelaySite' });
    d.state.economy.resources.scrap = 0;
    expect(validateCommand(d, { type: 'placeBuilding', building: 'signalTower', tileX: 22, tileY: 5 })).toEqual({ ok: false, reason: 'insufficientResources' });
  });
  it('only physically present assigned workers build, with a cap', () => {
    const { g, b } = tower();
    const helper = spawnSurvivor(g, 21.5, 6.5);
    applyCommand(g, { type: 'repair', unitIds: [helper.id], buildingId: b.id });
    workerSystem(g); constructionSystem(g); expect(b.construction!.progress).toBe(0);
    signalSystem(g); signalSystem(g);
    expect(g.events.filter(e => e.type === 'signalMessage' && e.text.includes('工地没人'))).toHaveLength(0);
    const workers = Array.from({ length: 4 }, () => spawnSurvivor(g, 21.5, 6.5));
    expect(applyCommand(g, { type: 'assignWork', unitIds: [workers[0]!.id], buildingId: b.id }).ok).toBe(true);
    constructionSystem(g); expect(b.construction!.progress).toBe(0);
    workerSystem(g); constructionSystem(g); const one = b.construction!.progress;
    applyCommand(g, { type: 'assignWork', unitIds: workers.slice(1).map(s => s.id), buildingId: b.id }); workerSystem(g);
    constructionSystem(g); expect(b.workers).toHaveLength(3); expect(b.construction!.progress - one).toBeCloseTo(one * 3);
  });
  it('requires explicit broadcast, awards full nights once, including storms, and wins', () => {
    const { g, b } = tower();
    expect(validateCommand(g, { type: 'startSignalBroadcast' }).ok).toBe(false);
    b.construction = null; signalSystem(g); expect(g.state.signal.stage).toBe('ready');
    expect(applyCommand(g, { type: 'startSignalBroadcast' }).ok).toBe(true);
    g.calendarPlan[0] = 'rustStorm'; g.state.calendar.nights[0]!.type = 'rustStorm';
    for (let i = 1; i <= SIGNAL.broadcastNights; i++) {
      g.state.tick = i * CYCLE_TICKS; g.state.clock = clockAt(g.state.tick);
      signalSystem(g); signalSystem(g); expect(g.state.signal.nightsHeld).toBe(i);
    }
    outcomeSystem(g); expect(g.state.outcome.reason).toBe('signal');
  });
  it('retains a data-defined construction share on destruction and clears broadcast progress', () => {
    const { g, b } = tower(); b.construction = null; signalSystem(g);
    applyCommand(g, { type: 'startSignalBroadcast' }); g.state.signal.nightsHeld = 1; b.hp = 0; signalSystem(g);
    expect(g.state.signal.stage).toBe('repair'); expect(g.state.signal.nightsHeld).toBe(0);
    expect(g.state.signal.retainedProgress).toBe(SIGNAL.retainProgress);
  });
  it('distinguishes three victory scores and rewards early signal rescue', () => {
    const g = fixture(); g.state.tick = 10 * CYCLE_TICKS;
    const survived = scoreFor(g, 'survived'); const signal = scoreFor(g, 'signal'); const hive = scoreFor(g, 'hiveDestroyed');
    expect(signal.earlyDays).toBe(hive.earlyDays); expect(signal.earlyDays).toBeGreaterThan(0);
    expect(new Set([survived.total, signal.total, hive.total]).size).toBe(3);
  });
});


describe('signal integration and boundaries', () => {
  it('copies narrative dialogue without editorial changes', () => {
    const narrative = readFileSync(new URL('../../../docs/narrative.md', import.meta.url), 'utf8');
    for (const text of Object.values(SIGNAL_TEXT)) expect(narrative).toContain(text);
    expect(narrative).toContain('长明城："车队预计 N 天后到达。"');
  });
  it('decodes on the tick research finishes after an earlier visit', () => {
    const g = fixture(); const u = spawnSurvivor(g, 21.5, 6.5); signalSystem(g); u.x = 1;
    g.state.economy.tech.researched.push('refinery', 'ruinArchives');
    applyCommand(g, { type: 'setResearch', tech: 'oldFrequency' });
    g.state.economy.resources.research = TECHS.oldFrequency.cost;
    techSystem(g); signalSystem(g); expect(g.state.signal.stage).toBe('repair');
  });
  it('amplification removes exactly one broadcast night', () => {
    const { g } = tower(); g.state.economy.tech.researched.push('signalAmplification'); refreshModifiers(g); signalSystem(g);
    expect(g.state.signal.nightsRequired).toBe(SIGNAL.broadcastNights - 1);
  });
  it('does not credit partial starting nights, or dead towers at dawn', () => {
    const { g, b } = tower(); b.construction = null; signalSystem(g);
    g.state.tick = CYCLE_TICKS - 1; g.state.clock = clockAt(g.state.tick); applyCommand(g, { type: 'startSignalBroadcast' });
    g.state.tick = CYCLE_TICKS; g.state.clock = clockAt(g.state.tick); signalSystem(g); expect(g.state.signal.nightsHeld).toBe(0);
    g.state.tick = CYCLE_TICKS * 2; g.state.clock = clockAt(g.state.tick); b.hp = 0; signalSystem(g);
    expect(g.state.signal.nightsHeld).toBe(0); expect(g.state.signal.stage).toBe('repair');
  });
  it('retains half the actual progress on destruction, pays again, but cancellation retains nothing', () => {
    const { g, b } = tower(); b.construction!.progress = b.construction!.total * .4; b.hp = 0;
    signalSystem(g); removeEntity(g, b); expect(g.state.signal.retainedProgress).toBeCloseTo(.2);
    applyCommand(g, { type: 'placeBuilding', building: 'signalTower', tileX: 22, tileY: 5 });
    const replacement = g.state.entities.get(g.state.signal.buildingId) as Building;
    expect(replacement.construction!.progress / replacement.construction!.total).toBeCloseTo(.2);
    applyCommand(g, { type: 'cancelConstruction', buildingId: replacement.id });
    expect(g.state.signal.retainedProgress).toBe(0); expect(g.state.signal.buildingId).toBe(0);
  });
  it.each(['raid', 'denseFog', 'surge', 'calm'] as const)('%s night assigns one real group to the broadcasting tower', type => {
    const { g, b } = tower(); b.construction = null; signalSystem(g); applyCommand(g, { type: 'startSignalBroadcast' });
    g.calendarPlan[5] = type; g.state.map.spawnPoints = [{ direction: 'E', tile: 29 }, { direction: 'W', tile: 0 }];
    const nest = addNest(g, 12, 8, false); nest.growth.level = 3;
    const plan = planNight(g, 6);
    expect(plan.groups.filter(group => group.assaultTargetId === b.id)).toHaveLength(1);
    if (type === 'calm') expect(plan.groups[0]!.nestId).toBe(nest.id);
    g.state.night.plan = plan;
    g.state.tick = CYCLE_TICKS * 5 + 1200; g.state.clock = clockAt(g.state.tick); nightSystem(g);
    expect([...g.state.entities.values()].some(e => e.kind === 'mutant' && e.ai.assaultTargetId === b.id)).toBe(true);
  });
  it('directed mutants actually walk toward and damage the tower, falling back to core after removal', () => {
    const { g, b } = tower(); b.construction = null; b.hp = b.maxHp; signalSystem(g);
    const m = spawnMutant(g, 'wanderer', 17.5, 6.5, { mode: 'assault', assaultTargetId: b.id });
    // Remove the explorer so the objective can be isolated from nearby unit aggro.
    for (const e of [...g.state.entities.values()]) if (e.kind === 'survivor') removeEntity(g,e);
    const hp = b.hp;
    for(let i=0;i<180;i++) { rebuildSpatialIndex(g.spatial,g.state); mutantAiSystem(g); movementSystem(g); rebuildSpatialIndex(g.spatial,g.state); combatSystem(g); g.state.tick++; }
    expect(m.x).toBeGreaterThan(20); expect(b.hp).toBeLessThan(hp);
    removeEntity(g,b); mutantAiSystem(g); expect(m.motion.mode).toBe('flow');
  });
  it('restores staffed construction and broadcast with identical hashes and messages', () => {
    const { g, b } = tower(); const u = spawnSurvivor(g,21.5,6.5);
    applyCommand(g,{type:'assignWork',unitIds:[u.id],buildingId:b.id}); workerSystem(g);
    const restored = restoreGame(serializeGame(g))!; expect(restored).not.toBeNull();
    for(let i=0;i<100;i++) { stepGame(g); stepGame(restored); }
    expect(hashState(restored)).toBe(hashState(g));
    b.construction = null; signalSystem(g); applyCommand(g,{type:'startSignalBroadcast'});
    const broadcasting = restoreGame(serializeGame(g))!;
    for(let i=0;i<100;i++) { stepGame(g); stepGame(broadcasting); }
    expect(hashState(broadcasting)).toBe(hashState(g));
  });
});
