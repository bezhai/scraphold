import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGame, applyCommand, validateCommand, hashState, serializeGame, restoreGame, stepGame, drainEvents, isRemote, checkPlacement } from '../index';
import { INCIDENTS, INCIDENT_IDS, INCIDENT_TARGETS, type IncidentId, type IncidentTargetKind } from '../data/incidents';
import { BUILDINGS, RESOURCES, TECHS } from '../data/economy';
import { RUIN_FRAGMENTS } from '../data/fragments';
import { incidentSystem, incidentEligible, incidentWeight, raiseIncident, incidentTargetSystem } from './incidents';
import { incidentDirection } from './sites';
import { incidentChoiceDescription } from './descriptions';
import { clockAt, CYCLE_TICKS, DAY_TICKS } from '../time';
import { addBuilding, enterBuilding, spawnSoldier, spawnSurvivor, removeEntity } from '../world/entities';
import { tileCenter } from '../map/grid';
import { explorationSystem } from '../economy/exploration';
import { rebuildSpatialIndex } from '../world/spatial';
import { modifiersFor, refreshModifiers } from '../game';
import { productionSystem } from '../economy/production';
import { refreshBuildingStats } from '../economy/construction';
import { hitDamage } from '../combat/damage';
import { nightSystem } from '../combat/night';
import { TERRAIN } from '../data/map';
import { WEATHER } from '../data/calendar';
import { weatherSystem } from '../calendar/weather';
const make = () => createGame({
  seed: 'incident-effects',
  origin: 'scavengers',
  difficulty: 'normal'
});
const clock = (g: ReturnType<typeof make>, tick: number) => {
  g.state.tick = tick;
  g.state.clock = clockAt(tick);
  refreshModifiers(g);
};
function choose(g: ReturnType<typeof make>, id: IncidentId, choiceId: string) {
  raiseIncident(g, id);
  const p = g.state.incidents.pending!;
  const result = applyCommand(g, {
    type: 'resolveIncident',
    incidentId: p.id,
    choiceId
  });
  expect(result).toEqual({
    ok: true
  });
  return p;
}
function prepare() {
  const g = make();
  clock(g, CYCLE_TICKS + 200);
  for (const r of RESOURCES) g.state.economy.resources[r] = 1000;
  const b = addBuilding(g, 'salvageYard', 2, 2, {
    complete: true
  });
  for (let i = 0; i < 2; i++) {
    const s = spawnSurvivor(g, 1, 1);
    enterBuilding(g, s, b);
  }
  for (let i = 0; i < 8; i++) spawnSoldier(g, 'rifleman', 1, 1);
  g.state.economy.tech.current = 'oldFrequency';
  return g;
}
const count = (g: ReturnType<typeof make>, kind: string) => [...g.state.entities.values()].filter(e => e.kind === kind && e.hp > 0).length;
describe('incident choices and exact source text', () => {
  const narrative = readFileSync('docs/narrative.md', 'utf8');
  it('matches every narrative event and ordered choice exactly within its own section', () => {
    const section = narrative.split('## 白天事件\n')[1]!.split('### 触发规则')[0]!;
    const blocks = section.split(/(?=^### \d+\.)/m).slice(1);
    expect(blocks).toHaveLength(INCIDENT_IDS.length);
    blocks.forEach((block, index) => {
      const def = INCIDENTS[INCIDENT_IDS[index]!];
      const title = block.match(/^### \d+\. ([^（\n]+)/)![1]!.trim();
      const description = block.match(/^- \*\*正文\*\*："(.*)"$/m)![1]!;
      const choices = [...block.matchAll(/^  - "([^"]+)"：(.*)$/gm)].map(m => ({
        label: m[1],
        feedback: m[2]!.match(/(?<!完成)(?<!超时)反馈："([^"]*)"/)?.[1] ?? null
      }));
      expect({
        title: def.title,
        description: def.description,
        choices: def.choices.map(c => ({
          label: c.label,
          feedback: c.feedback
        }))
      }).toEqual({
        title,
        description,
        choices
      });
      const effect = def.choices.flatMap(c => c.effects).find(e => e.kind === 'target');
      if (effect?.kind === 'target') {
        const target = INCIDENT_TARGETS[effect.target];
        expect({
          complete: target.completeText,
          expire: target.expireText
        }).toEqual({
          complete: block.match(/完成反馈："([^"]*)"/)![1],
          expire: block.match(/超时反馈："([^"]*)"/)![1]
        });
      }
    });
    const fragments = narrative.split('## 遗迹残页\n')[1]!.split('## 信号塔')[0]!;
    expect(RUIN_FRAGMENTS).toEqual([...fragments.matchAll(/^\d+\. (.*)$/gm)].map(m => m[1]));
    expect(RUIN_FRAGMENTS).toHaveLength(14);
  });
  const cases: [IncidentId, string, Record<string, number>][] = [['caravan', 'fuel', {
    scrap: -60,
    fuel: 25
  }], ['caravan', 'research', {
    food: -50,
    research: 40
  }], ['caravan', 'decline', {}], ['refugees', 'all', {
    food: -40,
    survivors: 4
  }], ['refugees', 'workers', {
    survivors: 2
  }], ['refugees', 'decline', {
    scrap: 20
  }], ['rescue', 'rescue', {
    targets: 1
  }], ['rescue', 'decline', {}], ['raiders', 'pay', {
    scrap: -300
  }], ['raiders', 'intimidate', {}], ['raiders', 'refuse', {
    budgets: 1
  }], ['mechanic', 'repair', {
    repair: -.3
  }], ['mechanic', 'towers', {
    tower: -.25
  }], ['mechanic', 'notes', {
    research: 40
  }], ['spores', 'isolate', {
    isolated: 2
  }], ['spores', 'medicine', {
    research: -40
  }], ['spores', 'ignore', {
    casualties: 2
  }], ['nestSplit', 'mark', {
    targets: 1
  }], ['veteran', 'recruit', {
    soldiers: 1
  }], ['veteran', 'inspiration', {
    food: -20,
    progress: TECHS.oldFrequency.cost * .25
  }], ['overheat', 'fuel', {
    fuel: -30
  }], ['overheat', 'power', {
    coreFactor: -.5,
    vision: -4
  }], ['overheat', 'workers', {
    isolated: 2
  }], ['northernSignal', 'numbers', {
    progress: TECHS.oldFrequency.cost * .5
  }], ['northernSignal', 'source', {
    fog: 1
  }], ['tribe', 'intel', {
    food: -40,
    nests: 2
  }], ['tribe', 'decline', {}], ['stormWarning', 'reinforce', {
    scrap: -50,
    modifiers: 1
  }], ['stormWarning', 'ignore', {}], ['surgeWarning', 'training', {
    training: .5
  }], ['surgeWarning', 'walls', {
    modifiers: 1
  }]];
  function metrics(g: ReturnType<typeof make>) {
    return {
      ...g.state.economy.resources,
      survivors: count(g, 'survivor'),
      soldiers: count(g, 'soldier'),
      targets: g.state.incidents.targets.length,
      budgets: g.state.incidents.nightBudgetAdjustments.length,
      repair: g.modifiers.global.repairCostPct,
      tower: g.modifiers.building.machineGunTower.buildCostPct,
      isolated: g.state.incidents.isolatedSurvivors.length,
      casualties: g.state.incidents.casualties.length,
      progress: g.state.economy.tech.progress.oldFrequency,
      coreFactor: g.modifiers.factor.coreYield,
      vision: g.modifiers.building.core.visionAdd,
      nests: [...g.state.entities.values()].filter(e => e.kind === 'nest' && e.discovered).length,
      modifiers: g.state.incidents.modifiers.length,
      training: g.modifiers.global.trainSpeedPct
    };
  }
  it.each(cases)('%s / %s settles the intended effects', (id, choice, expected) => {
    const g = prepare();
    const before = metrics(g);
    const p = choose(g, id, choice);
    const after = metrics(g);
    for (const [key, value] of Object.entries(expected)) if (key === 'fog') {
      const site = g.state.map.relaySite!;
      expect(g.state.fog[site.tileY * g.state.map.width + site.tileX]).toBeGreaterThan(0);
    } else expect(after[key as keyof typeof after] - before[key as keyof typeof before], key).toBeCloseTo(value);
    for (const r of RESOURCES) expect(after[r] - before[r], r).toBeCloseTo(expected[r] ?? 0);
    const chosen = p.choices.find(c => c.id === choice)!;
    expect(g.events).toContainEqual({
      type: 'incidentResolved',
      incidentId: p.id,
      choiceId: choice,
      automatic: false,
      feedback: chosen.feedback
    });
    expect(chosen.description).toBe(incidentChoiceDescription(g, chosen));
    if (id === 'veteran' && choice === 'recruit') {
      const s = [...g.state.entities.values()].filter(e => e.kind === 'soldier').at(-1)!;
      expect(s.kind === 'soldier' && s.veterancy.pending).toBe(true);
    }
  });
  it('covers every declared choice', () => expect(cases.map(([id, c]) => `${id}/${c}`).sort()).toEqual(INCIDENT_IDS.flatMap(id => INCIDENTS[id].choices.map(c => `${id}/${c.id}`)).sort()));
  it('checks resource costs using the command contract without mutation', () => {
    for (const id of INCIDENT_IDS) for (const choice of INCIDENTS[id].choices) for (const resource of RESOURCES.filter(r => (choice.cost[r] ?? 0) > 0)) {
      const g = prepare();
      raiseIncident(g, id);
      g.state.economy.resources[resource] = 0;
      const before = hashState(g);
      expect(validateCommand(g, {
        type: 'resolveIncident',
        incidentId: g.state.incidents.pending!.id,
        choiceId: choice.id
      })).toEqual({
        ok: false,
        reason: 'insufficientResources'
      });
      expect(hashState(g)).toBe(before);
    }
  });
  it.each([['raiders', 'intimidate', 'insufficientSoldiers'], ['spores', 'isolate', 'insufficientWorkers'], ['overheat', 'workers', 'insufficientWorkers'], ['veteran', 'inspiration', 'noCurrentResearch']] as const)('rejects %s / %s with a specific reason', (id, choiceId, reason) => {
    const g = make();
    raiseIncident(g, id);
    expect(validateCommand(g, {
      type: 'resolveIncident',
      incidentId: g.state.incidents.pending!.id,
      choiceId
    })).toEqual({
      ok: false,
      reason
    });
  });
  it('auto settles the last eligible choice at night, including both fallback cases', () => {
    for (const [id, expected] of [['overheat', 'power'], ['veteran', 'recruit'], ['raiders', 'refuse']] as const) {
      const g = make();
      clock(g, CYCLE_TICKS + 200);
      raiseIncident(g, id);
      clock(g, CYCLE_TICKS + DAY_TICKS - 1);
      incidentSystem(g);
      expect(g.state.incidents.pending).not.toBeNull();
      clock(g, CYCLE_TICKS + DAY_TICKS);
      incidentSystem(g);
      expect(g.state.incidents.history.at(-1)).toMatchObject({
        choiceId: expected,
        automatic: true
      });
      expect(g.events.some(e => e.type === 'incidentResolved' && e.automatic)).toBe(true);
    }
  });
  it('uses fallback research for the northern signal when already researched or discovered', () => {
    const g = prepare();
    g.state.economy.tech.researched.push('oldFrequency');
    refreshModifiers(g);
    choose(g, 'northernSignal', 'numbers');
    expect(g.state.economy.resources.research).toBe(1040);
    g.state.signal.discovered = true;
    choose(g, 'northernSignal', 'source');
    expect(g.state.economy.resources.research).toBe(1070);
  });
  it('keeps isolation for exactly one cycle and forbids early release', () => {
    const g = prepare();
    choose(g, 'spores', 'isolate');
    const ids = g.state.incidents.isolatedSurvivors.map(s => s.unitId);
    expect(validateCommand(g, {
      type: 'unassignWork',
      buildingId: g.state.coreId,
      count: 2
    })).toEqual({
      ok: false,
      reason: 'workersIsolated'
    });
    clock(g, g.state.tick + CYCLE_TICKS - 1);
    incidentSystem(g);
    expect(g.state.incidents.isolatedSurvivors).toHaveLength(2);
    clock(g, g.state.tick + 1);
    incidentSystem(g);
    expect(g.state.incidents.isolatedSurvivors).toHaveLength(0);
    for (const id of ids) expect(g.state.entities.get(id)).toMatchObject({
      insideId: 0,
      task: {
        type: 'idle'
      }
    });
  });
  it('loses the lowest-id living survivor once on each of two nights', () => {
    const g = prepare();
    const ids = [...g.state.entities.values()].filter(e => e.kind === 'survivor').map(e => e.id).sort((a, b) => a - b);
    choose(g, 'spores', 'ignore');
    for (let i = 0; i < 3; i++) {
      clock(g, (i + 1) * CYCLE_TICKS + DAY_TICKS);
      incidentSystem(g);
      incidentSystem(g);
      expect(g.state.stats.survivorsLost).toBe(Math.min(i + 1, 2));
    }
    expect(g.state.entities.get(ids[0]!)!.hp).toBe(0);
    expect(g.state.entities.get(ids[1]!)!.hp).toBe(0);
  });
  it('applies and expires timed effects through the modifier table', () => {
    const g = prepare();
    for (const e of [...g.state.entities.values()]) if (e.kind === 'building' && e.id !== g.state.coreId) removeEntity(g, e);
    choose(g, 'overheat', 'power');
    const core = g.state.entities.get(g.state.coreId)!;
    if (core.kind !== 'building') throw 0;
    refreshBuildingStats(g, core);
    expect(core.vision).toBe(BUILDINGS.core.vision - 4);
    productionSystem(g);
    const before = g.state.economy.resources.scrap;
    productionSystem(g);
    const reduced = g.state.economy.resources.scrap - before;
    clock(g, g.state.tick + 2 * CYCLE_TICKS);
    incidentSystem(g);
    refreshModifiers(g);
    productionSystem(g);
    const after = g.state.economy.resources.scrap;
    productionSystem(g);
    expect(g.state.economy.resources.scrap - after).toBeCloseTo(reduced * 2);
    refreshBuildingStats(g, core);
    expect(core.vision).toBe(BUILDINGS.core.vision);
    choose(g, 'surgeWarning', 'training');
    expect(g.modifiers.global.trainSpeedPct).toBe(.5);
    clock(g, (g.state.clock.day - 1) * CYCLE_TICKS + DAY_TICKS);
    expect(modifiersFor(g.state).global.trainSpeedPct).toBe(0);
  });
  it('halves storm corrosion and reduces night weapon damage multiplicatively', () => {
    const g = prepare();
    choose(g, 'stormWarning', 'reinforce');
    choose(g, 'surgeWarning', 'walls');
    const core = g.state.entities.get(g.state.coreId)!;
    clock(g, CYCLE_TICKS + DAY_TICKS);
    g.state.calendar.nights[1]!.type = 'rustStorm';
    const hp = core.hp;
    weatherSystem(g);
    expect(hp - core.hp).toBeCloseTo(core.maxHp * WEATHER.buildingDamagePerSecond / 20 * WEATHER.coreDamageMultiplier * .5 * .8);
    const damage = hitDamage(g, core, 100, 'normal');
    clock(g, 2 * CYCLE_TICKS);
    expect(hitDamage(g, core, 100, 'normal')).toBeCloseTo(damage / .8);
  });
  it('defers raiders to an edge-attack night and updates an already published plan', () => {
    const g = prepare();
    g.calendarPlan[1] = 'calm';
    g.calendarPlan[2] = 'rustStorm';
    g.calendarPlan[3] = 'raid';
    choose(g, 'raiders', 'refuse');
    expect(g.state.incidents.nightBudgetAdjustments).toEqual([{
      night: 4,
      budgetPct: .3
    }]);
    clock(g, 3 * CYCLE_TICKS + 900);
    nightSystem(g);
    const plan = g.state.night.plan!;
    const directions = plan.groups.map(x => [x.direction, x.nestId, x.boss]);
    choose(g, 'raiders', 'refuse');
    expect(g.state.night.plan!.groups.map(x => [x.direction, x.nestId, x.boss])).toEqual(directions);
    expect(plan.groups.some(x => x.nestId === 0)).toBe(true);
    expect(g.state.night.forecast?.night).toBe(4);
  });
});
describe('incident draws and objectives', () => {
  it('weights refugees more heavily under tight housing and excludes ineligible content', () => {
    const g = make();
    clock(g, CYCLE_TICKS);
    incidentSystem(g);
    const base = INCIDENTS.refugees.weight;
    while (count(g, 'survivor') + count(g, 'soldier') < 100) spawnSurvivor(g, 1, 1);
    expect(incidentWeight(g, 'refugees')).toBe(base * 3);
    for (let i = 0; i < 30; i++) addBuilding(g, 'shack', i, 0, {
      complete: true
    });
    expect(incidentWeight(g, 'refugees')).toBe(base);
    for (const e of [...g.state.entities.values()]) if (e.kind === 'nest') removeEntity(g, e);
    for (const r of g.state.map.ruins) r.explored = true;
    for (const id of ['nestSplit', 'tribe'] as const) expect(incidentEligible(g, id)).toBe(false);
  });
  it.each(Array.from({
    length: 40
  }, (_, i) => i))('seed %i keeps scheduled quotas, weather constraints, northern reservation, caps and RNG replay', seed => {
    const g = createGame({
      seed: `draw-${seed}`,
      origin: 'scavengers',
      difficulty: 'normal'
    });
    incidentSystem(g);
    const cards: IncidentId[] = [];
    for (const day of g.state.incidents.eventDays) {
      clock(g, (day - 1) * CYCLE_TICKS);
      incidentSystem(g);
      const time = g.state.incidents.nextIncidentTick!;
      expect(time - (day - 1) * CYCLE_TICKS).toBeGreaterThanOrEqual(100);
      expect(time - (day - 1) * CYCLE_TICKS).toBeLessThanOrEqual(300);
      clock(g, time);
      const restored = restoreGame(serializeGame(g))!;
      incidentSystem(g);
      incidentSystem(restored);
      expect(hashState(restored)).toBe(hashState(g));
      const p = g.state.incidents.pending!;
      cards.push(p.definitionId);
      if (p.definitionId === 'stormWarning') expect(g.calendarPlan[day - 1]).toBe('rustStorm');
      if (p.definitionId === 'surgeWarning') expect(g.calendarPlan[day - 1]).toBe('surge');
      clock(g, (day - 1) * CYCLE_TICKS + DAY_TICKS);
      incidentSystem(g);
      incidentTargetSystem(g);
    }
    expect(cards).toHaveLength(g.state.incidents.eventDays.length);
    for (const id of INCIDENT_IDS) expect(cards.filter(x => x === id).length).toBeLessThanOrEqual(INCIDENTS[id].maxOccurrences);
    cards.forEach((id, i) => expect(id).not.toBe(cards[i - 1]));
    expect(cards.filter(x => x === 'northernSignal')).toHaveLength(1);
    expect(g.state.incidents.eventDays[cards.indexOf('northernSignal')]).toBeGreaterThanOrEqual(3);
    expect(g.state.incidents.eventDays[cards.indexOf('northernSignal')]).toBeLessThanOrEqual(6);
  });
  it('fills every compass direction and fixes target positions when the card appears', () => {
    const g = make();
    const core = g.state.entities.get(g.state.coreId)!;
    const dirs = [[0, -10, '北'], [10, -10, '东北'], [10, 0, '东'], [10, 10, '东南'], [0, 10, '南'], [-10, 10, '西南'], [-10, 0, '西'], [-10, -10, '西北']] as const;
    for (const [dx, dy, d] of dirs) expect(incidentDirection(g, {
      x: core.x + dx,
      y: core.y + dy
    })).toBe(d);
    for (const id of ['rescue'] as const) {
      raiseIncident(g, id);
      const p = g.state.incidents.pending!;
      const point = tileCenter(g.state.map, p.target!.tile);
      expect(p.description).toContain(`${incidentDirection(g, point)}边`);
      expect(p.description).not.toContain('{方向}');
      if (id === 'rescue') expect(isRemote(g.state, point)).toBe(true);
    }
    raiseIncident(g, 'northernSignal');
    expect(g.state.incidents.pending!.choices[1]!.feedback).not.toContain('{方向}');
  });
  const targetChoices = {
    rescue: 'rescue',
    nestSplit: 'mark'
  };
  it.each(['rescue', 'nestSplit'] as IncidentTargetKind[])('completes %s and emits its exact feedback', kind => {
    const g = prepare();
    choose(g, kind, targetChoices[kind]);
    const t = g.state.incidents.targets[0]!;
    const p = tileCenter(g.state.map, t.tile);
    const survivors = count(g, 'survivor');
    const fuel = g.state.economy.resources.fuel;
    if (kind === 'nestSplit') {
      const nest = g.state.entities.get(t.nestId)!;
      expect(nest.kind === 'nest' && nest.discovered).toBe(true);
      nest.hp = 0;
    } else {
      spawnSoldier(g, 'rifleman', p.x, p.y);
      rebuildSpatialIndex(g.spatial, g.state);
    }
    incidentTargetSystem(g);
    expect(t.status).toBe('completed');
    expect(g.events).toContainEqual({
      type: 'incidentTargetResolved',
      targetId: t.id,
      status: 'completed',
      text: INCIDENT_TARGETS[kind].completeText
    });
    if (kind === 'rescue') {
      expect(count(g, 'survivor') - survivors).toBe(3);
      expect(g.state.economy.resources.fuel - fuel).toBe(30);
    }
    for (const id of t.guardIds) expect(g.state.entities.has(id)).toBe(false);
  });
  it.each(['rescue', 'nestSplit'] as IncidentTargetKind[])('expires %s at its exact deadline', kind => {
    const g = prepare();
    choose(g, kind, targetChoices[kind]);
    const t = g.state.incidents.targets[0]!;
    const nests = count(g, 'nest');
    clock(g, t.expiresTick);
    incidentTargetSystem(g);
    expect(t.status).toBe('expired');
    expect(g.events).toContainEqual({
      type: 'incidentTargetResolved',
      targetId: t.id,
      status: 'expired',
      text: INCIDENT_TARGETS[kind].expireText
    });
    if (kind === 'nestSplit') {
      expect(count(g, 'nest')).toBe(nests + 1);
      const child = [...g.state.entities.values()].filter(e => e.kind === 'nest').at(-1)!;
      expect(child.kind === 'nest' && child.growth.level).toBe(1);
      expect(child.x).toBe(t.splitTile % g.state.map.width + 1);
    }
    for (const id of t.guardIds) expect(g.state.entities.has(id)).toBe(false);
  });
  it('requires a soldier for rescue and protects split land', () => {
    const g = prepare();
    choose(g, 'rescue', 'rescue');
    const t = g.state.incidents.targets[0]!;
    const p = tileCenter(g.state.map, t.tile);
    spawnSurvivor(g, p.x, p.y);
    incidentTargetSystem(g);
    expect(t.status).toBe('active');
    raiseIncident(g, 'nestSplit');
    const tile = g.state.incidents.pending!.target!.splitTile;
    expect(checkPlacement(g, 'barricade', tile % g.state.map.width, Math.floor(tile / g.state.map.width))).toEqual({
      ok: false,
      reason: 'incidentReserved'
    });
  });
  it('emits fourteen ordered fragments and stops, then resets for a new game', () => {
    const g = make();
    g.state.map.ruins = [];
    for (let i = 0; i < 16; i++) {
      const tile = i + g.state.map.width;
      g.state.map.terrain[tile] = TERRAIN.ruin.code;
      g.state.map.ruins.push({
        kind: 'ordinary',
        id: i + 1,
        tile,
        explored: false,
        reward: {
          kind: 'resource',
          resource: 'scrap',
          amount: 1
        }
      });
      const p = tileCenter(g.state.map, tile);
      spawnSoldier(g, 'rifleman', p.x, p.y);
    }
    rebuildSpatialIndex(g.spatial, g.state);
    explorationSystem(g);
    expect(g.events.filter(e => e.type === 'ruinFragment').map(e => e.text)).toEqual(RUIN_FRAGMENTS);
    expect(g.state.incidents.fragmentIndex).toBe(14);
    expect(make().state.incidents.fragmentIndex).toBe(0);
  });
  it('round trips pending cards, active goals, isolation, fragments, modifiers and future replay', () => {
    const g = prepare();
    choose(g, 'rescue', 'rescue');
    choose(g, 'overheat', 'workers');
    choose(g, 'mechanic', 'repair');
    g.state.incidents.fragmentIndex = 5;
    raiseIncident(g, 'caravan');
    const restored = restoreGame(serializeGame(g))!;
    expect(restored.state.incidents).toEqual(g.state.incidents);
    drainEvents(g);
    for (let i = 0; i < 2300; i++) {
      stepGame(g);
      stepGame(restored);
      expect(drainEvents(restored)).toEqual(drainEvents(g));
    }
    expect(hashState(restored)).toBe(hashState(g));
    const old = JSON.parse(serializeGame(g));
    old.version = 7;
    expect(restoreGame(JSON.stringify(old))).toBeNull();
  });
});
