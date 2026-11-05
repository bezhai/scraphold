import { describe, it, expect } from 'vitest';
import { createGame, applyCommand, validateCommand, hashState, type Game } from '../index';
import { INCIDENTS, INCIDENT_IDS } from '../data/incidents';
import { incidentSystem, incidentTargetSystem, incidentEligible, raiseIncident } from './incidents';
import { targetCandidates } from './sites';
import { clockAt, CYCLE_TICKS } from '../time';
import { addBuilding, removeEntity } from '../world/entities';
import { applyEnvironmentalDamage } from '../combat/damage';
const make = (seed = 'rework') => createGame({
  seed,
  origin: 'scavengers',
  difficulty: 'normal'
});
function at(g: Game, day: number, tick = 200) {
  g.state.tick = (day - 1) * CYCLE_TICKS + tick;
  g.state.clock = clockAt(g.state.tick);
}
function command(g: Game, choiceId: string) {
  return {
    type: 'resolveIncident' as const,
    incidentId: g.state.incidents.pending!.id,
    choiceId
  };
}
describe('task 3 review regressions', () => {
  it.each([[10, 35, 0, 5], [50, 30, 10, 30], [0, 40, 0, 0]])('medicine spends bank %i then current progress %i', (bank, progress, leftBank, leftProgress) => {
    const g = make();
    g.state.economy.tech.current = 'oldFrequency';
    g.state.economy.resources.research = bank!;
    g.state.economy.tech.progress.oldFrequency = progress!;
    raiseIncident(g, 'spores');
    expect(applyCommand(g, command(g, 'medicine'))).toEqual({
      ok: true
    });
    expect(g.state.economy.resources.research).toBe(leftBank);
    expect(g.state.economy.tech.progress.oldFrequency).toBe(leftProgress);
  });
  it('medicine cannot spend other or completed research, and validation is pure', () => {
    const g = make();
    g.state.economy.resources.research = 10;
    g.state.economy.tech.progress.oldFrequency = 100;
    raiseIncident(g, 'spores');
    const before = hashState(g);
    expect(validateCommand(g, command(g, 'medicine'))).toEqual({
      ok: false,
      reason: 'insufficientResources'
    });
    expect(hashState(g)).toBe(before);
    g.state.economy.tech.current = 'oldFrequency';
    g.state.economy.tech.progress.oldFrequency = 29;
    expect(validateCommand(g, command(g, 'medicine')).ok).toBe(false);
    g.state.economy.tech.progress.oldFrequency = 100;
    g.state.economy.tech.researched.push('oldFrequency');
    expect(validateCommand(g, command(g, 'medicine')).ok).toBe(false);
  });
  it('overheat starts on day five', () => {
    const g = make();
    for (let d = 2; d < 5; d++) {
      at(g, d);
      expect(incidentEligible(g, 'overheat')).toBe(false);
    }
    at(g, 5);
    expect(incidentEligible(g, 'overheat')).toBe(true);
  });
  it('the hive never splits, even when it is the only remaining nest', () => {
    const g = make();
    expect(targetCandidates(g, 'nestSplit').every(t => {
      const e = g.state.entities.get(t.nestId);
      return e?.kind === 'nest' && !e.isHive;
    })).toBe(true);
    for (const e of [...g.state.entities.values()]) if (e.kind === 'nest' && !e.isHive) removeEntity(g, e);
    expect(incidentEligible(g, 'nestSplit')).toBe(false);
  });
  it('does not charge for stale nest intelligence', () => {
    const g = make();
    raiseIncident(g, 'tribe');
    for (const e of g.state.entities.values()) if (e.kind === 'nest') e.discovered = true;
    const food = g.state.economy.resources.food;
    expect(applyCommand(g, command(g, 'intel'))).toEqual({
      ok: false,
      reason: 'noUndiscoveredNests'
    });
    expect(g.state.economy.resources.food).toBe(food);
  });
  it('closes an obsolete one-choice split warning as completed without spawning another nest', () => {
    const g = make();
    raiseIncident(g, 'nestSplit');
    const target = g.state.incidents.pending!.target!;
    removeEntity(g, g.state.entities.get(target.nestId)!);
    expect(validateCommand(g, command(g, 'mark'))).toEqual({
      ok: false,
      reason: 'incidentTargetUnavailable'
    });
    incidentTargetSystem(g);
    expect(g.state.incidents.pending).toBeNull();
    expect(g.state.incidents.targets.at(-1)?.status).toBe('completed');
  });
  it('reserves northern signal even when weather occupies every day in its window', () => {
    const g = make();
    g.calendarPlan.splice(0, 6, 'calm', 'raid', 'rustStorm', 'surge', 'rustStorm', 'surge');
    expect(() => incidentSystem(g)).not.toThrow();
    const day = g.state.incidents.northernDay;
    expect(day).toBeGreaterThanOrEqual(3);
    expect(day).toBeLessThanOrEqual(6);
    at(g, day, 400);
    incidentSystem(g);
    expect(g.state.incidents.pending?.definitionId).toBe('northernSignal');
  });
  it('skips a day when all incident definitions are exhausted', () => {
    const g = make();
    incidentSystem(g);
    for (const id of INCIDENT_IDS) for (let i = 0; i < INCIDENTS[id].maxOccurrences; i++) g.state.incidents.history.push({
      id: i,
      definitionId: id,
      raisedTick: 0,
      resolvedTick: 1,
      choiceId: 'unused',
      automatic: false
    });
    const day = g.state.incidents.eventDays.find(d => d > 6)!;
    at(g, day, 400);
    expect(() => incidentSystem(g)).not.toThrow();
    expect(g.state.incidents.pending).toBeNull();
    expect(g.state.incidents.lastIncidentDay).toBe(day);
    const rng = g.state.rng.incidents.s;
    incidentSystem(g);
    expect(g.state.rng.incidents.s).toBe(rng);
  });
  it('incident survivors are spread like ruin survivors and credited once each', () => {
    const g = make();
    const before = new Set(g.state.entities.keys());
    const count = g.state.stats.survivorsRecruited;
    g.state.economy.resources.food = 100;
    raiseIncident(g, 'refugees');
    applyCommand(g, command(g, 'all'));
    const recruits = [...g.state.entities.values()].filter(e => !before.has(e.id));
    expect(new Set(recruits.map(e => `${e.x},${e.y}`)).size).toBe(4);
    expect(g.state.stats.survivorsRecruited - count).toBe(4);
    expect(g.events.filter(e => e.type === 'survivorJoined' && e.source === 'incident')).toHaveLength(4);
  });
  it('losing barricades does not penalize building-loss score or lossless nights', () => {
    const g = make();
    const wall = addBuilding(g, 'barricade', 1, 1, {
      complete: true
    });
    applyEnvironmentalDamage(g, wall, wall.hp);
    expect(g.state.stats.buildingsLost).toBe(0);
    expect(g.state.stats.buildingsLostTonight).toBe(0);
    const shack = addBuilding(g, 'shack', 5, 1, {
      complete: true
    });
    applyEnvironmentalDamage(g, shack, shack.hp);
    expect(g.state.stats.buildingsLost).toBe(1);
    expect(g.state.stats.buildingsLostTonight).toBe(1);
  });
});
