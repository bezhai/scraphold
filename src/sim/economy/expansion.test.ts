import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commandHandlers';
import { hitDamage, applyEnvironmentalDamage } from '../combat/damage';
import { soldierStat, soldierWeapon } from '../combat/weapons';
import { refreshSoldierStats } from '../combat/soldiers';
import { HUNGER, SOLDIERS } from '../data/combat';
import { BUILDINGS, REMOTE_DISTANCE, TECHS, type TechId } from '../data/economy';
import { calendarSystem } from '../calendar/calendar';
import { weatherSystem } from '../calendar/weather';
import { refreshModifiers } from '../game';
import { createTestGame } from '../testing';
import { CYCLE_TICKS, DAY_TICKS, clockAt } from '../time';
import { addBuilding, enterBuilding, spawnSoldier, spawnSurvivor } from '../world/entities';
import { visionRadius } from '../world/fog';
import { isRemote } from '../world/remote';
import { buildingCost } from './resources';
import { constructionSystem, refreshBuildingStats } from './construction';
import { dailyUpkeep } from './population';
import { buildingYieldPerDay } from './production';
import { techSystem } from './tech';

function fixture() {
  return createTestGame(Array.from({ length: 12 }, (_, y) => y >= 2 && y < 5 ? '..CCC...................................' : '........................................'));
}
function unlock(g: ReturnType<typeof fixture>, ...techs: TechId[]) { g.state.economy.tech.researched.push(...techs); refreshModifiers(g); }
function storm(g: ReturnType<typeof fixture>) {
  g.calendarPlan[0] = 'rustStorm'; g.state.calendar.nights[0]!.type = 'rustStorm';
  g.state.tick = DAY_TICKS; g.state.clock = clockAt(g.state.tick);
}

describe('technology and policy effects', () => {
  it('uses one inclusive center-distance boundary for expedition and outpost effects', () => {
    const g = fixture(); const c = g.state.entities.get(g.state.coreId)!;
    expect(isRemote(g.state, { x: c.x + REMOTE_DISTANCE - .001, y: c.y })).toBe(false);
    expect(isRemote(g.state, { x: c.x + REMOTE_DISTANCE, y: c.y })).toBe(true);
    expect(isRemote(g.state, { x: c.x, y: c.y + REMOTE_DISTANCE })).toBe(true);
  });
  it('relay power lowers costs and accelerates only the staffed tower', () => {
    const g = fixture(); const b = addBuilding(g, 'signalTower', 24, 5, { complete: false });
    const u = spawnSurvivor(g, 23, 5); enterBuilding(g, u, b);
    constructionSystem(g); const before = b.construction!.progress;
    unlock(g, 'relayPower'); constructionSystem(g);
    expect(b.construction!.progress - before).toBeCloseTo(before * 1.3);
    expect(buildingCost(g.modifiers, 'signalTower')).toEqual({ scrap: 300, fuel: 60 });
    expect(buildingCost(g.modifiers, 'shack')).toEqual(BUILDINGS.shack.cost);
  });
  it('fog filtration reduces outdoor storm injury and restores daylight vision, leaving dense fog intact', () => {
    const g = fixture(); const u = spawnSurvivor(g, 10, 5); storm(g);
    const hp = u.hp; weatherSystem(g); const base = hp - u.hp;
    unlock(g, 'fogFiltration'); const next = u.hp; weatherSystem(g);
    expect(next - u.hp).toBeCloseTo(base * .25);
    g.state.tick = CYCLE_TICKS; g.state.clock = clockAt(g.state.tick); calendarSystem(g);
    expect(visionRadius(g, u)).toBe(u.vision);
    g.state.clock.phase = 'night'; g.state.calendar.nights[1]!.type = 'denseFog';
    expect(visionRadius(g, u)).toBeLessThan(u.vision);
  });
  it('reserve granary reduces upkeep and halves both hunger penalties', () => {
    const g = fixture(); const s = spawnSoldier(g, 'rifleman', 7, 5); const base = dailyUpkeep(g);
    unlock(g, 'reserveGranary'); expect(dailyUpkeep(g)).toBeCloseTo(base * .8);
    g.state.economy.upkeep.hungry = true;
    expect(soldierStat(g, s, 'damagePct')).toBe(HUNGER.damagePct * .5);
    expect(soldierStat(g, s, 'speedPct')).toBe(HUNGER.speedPct * .5);
  });
  it('night vision increases soldier vision on ordinary and dense-fog nights only', () => {
    const g = fixture(); const s = spawnSoldier(g, 'rifleman', 7, 5); unlock(g, 'nightVision');
    refreshSoldierStats(g, s); expect(s.vision).toBe(SOLDIERS.rifleman.vision);
    g.state.clock.phase = 'night'; refreshSoldierStats(g, s); expect(s.vision).toBe(SOLDIERS.rifleman.vision + 4);
    const clear = visionRadius(g, s); g.state.calendar.nights[0]!.type = 'denseFog';
    expect(visionRadius(g, s)).toBeCloseTo(clear * .65);
  });
  it('rapid deployment speeds soldiers and freshly trained rally travel, ending on new orders', () => {
    const g = fixture(); unlock(g, 'rapidDeployment'); const b = addBuilding(g, 'barracks', 6, 5, { complete: true });
    b.rally = { x: 17, y: 6 }; b.trainQueue.push({ unit: 'rifleman', progress: 0, total: 1, paid: {} });
    constructionSystem(g); const s = [...g.state.entities.values()].find(e => e.kind === 'soldier')!;
    if (s.kind !== 'soldier') throw new Error('missing soldier');
    refreshSoldierStats(g, s); expect(s.motion.speed).toBeCloseTo(SOLDIERS.rifleman.speed * 1.5);
    applyCommand(g, { type: 'stop', unitIds: [s.id] }); refreshSoldierStats(g, s);
    expect(s.motion.speed).toBeCloseTo(SOLDIERS.rifleman.speed * 1.15);
  });
  it('expedition pack boosts remote HP/damage without healing by crossing the boundary', () => {
    const g = fixture(); unlock(g, 'expeditionPack'); const s = spawnSoldier(g, 'rifleman', 7, 5); s.hp /= 2;
    const base = soldierWeapon(g, s).damage; s.x = 25; refreshSoldierStats(g, s);
    expect(s.maxHp).toBeCloseTo(SOLDIERS.rifleman.hp * 1.25); expect(s.hp / s.maxHp).toBeCloseTo(.5);
    expect(soldierWeapon(g, s).damage).toBeCloseTo(base * 1.25);
    s.x = 7; refreshSoldierStats(g, s); expect(s.hp).toBeCloseTo(SOLDIERS.rifleman.hp / 2);
  });
  it('outpost works boosts only remote building HP and construction speed', () => {
    const g = fixture(); const near = addBuilding(g, 'shack', 7, 5, { complete: false }); const far = addBuilding(g, 'shack', 25, 5, { complete: false });
    unlock(g, 'outpostWorks'); constructionSystem(g);
    expect(near.maxHp).toBe(BUILDINGS.shack.hp); expect(far.maxHp).toBeCloseTo(near.maxHp * 1.4);
    expect(far.construction!.progress).toBeCloseTo(near.construction!.progress * 1.3);
  });
  it('wind reinforcement and storm readiness reduce corrosion; production tradeoff applies only in storms', () => {
    const g = fixture(); const b = addBuilding(g, 'greenhouse', 8, 5, { complete: true });
    enterBuilding(g, spawnSurvivor(g, 7, 5), b); storm(g);
    const hp = b.hp; weatherSystem(g); const damage = hp - b.hp; const food = buildingYieldPerDay(g, b).food;
    unlock(g, 'windReinforcement'); const hp2 = b.hp; weatherSystem(g); expect(hp2 - b.hp).toBeCloseTo(damage * .35);
    g.state.economy.policies.slots[0] = 'stormReadiness'; refreshModifiers(g);
    const hp3 = b.hp; weatherSystem(g); expect(hp3 - b.hp).toBeCloseTo(damage * .15);
    expect(buildingYieldPerDay(g, b).food).toBeCloseTo(food * .9);
    g.state.clock.phase = 'day'; expect(buildingYieldPerDay(g, b).food).toBeCloseTo(food);
  });
  it('expedition supplies halves only remote upkeep after other upkeep reductions', () => {
    const g = fixture(); const a = spawnSoldier(g, 'rifleman', 7, 5); const b = spawnSoldier(g, 'rifleman', 25, 5);
    unlock(g, 'expeditionPack', 'reserveGranary'); g.state.economy.policies.slots[0] = 'expeditionSupplies'; refreshModifiers(g);
    expect(dailyUpkeep(g)).toBeCloseTo(SOLDIERS.rifleman.upkeepFoodPerDay * 1.5 * .8);
    a.x = b.x; expect(dailyUpkeep(g)).toBeCloseTo(SOLDIERS.rifleman.upkeepFoodPerDay * .8);
  });
  it('full broadcast protects construction and broadcast from weapons and weather, but not a ready tower', () => {
    const g = fixture(); const b = addBuilding(g, 'signalTower', 24, 5, { complete: false }); refreshBuildingStats(g, b);
    const base = hitDamage(g, b, 100, 'normal'); unlock(g, 'relayPower'); g.state.economy.policies.slots[0] = 'fullBroadcast'; refreshModifiers(g);
    expect(hitDamage(g, b, 100, 'normal')).toBeCloseTo(base * .65);
    const hp = b.hp; applyEnvironmentalDamage(g, b, 10); expect(hp - b.hp).toBeCloseTo(6.5);
    b.construction = null; g.state.signal.stage = 'ready'; expect(hitDamage(g, b, 100, 'normal')).toBe(base);
    g.state.signal.stage = 'broadcast'; expect(hitDamage(g, b, 100, 'normal')).toBeCloseTo(base * .65);
  });
  it.each(['oldFrequency','relayPower','signalAmplification','fogFiltration','reserveGranary','nightVision','rapidDeployment','expeditionPack','windReinforcement','outpostWorks'] as const)('%s has a reachable inspiration that applies exactly once', tech => {
    const g = fixture(); const c = TECHS[tech].inspiration;
    switch (c.kind) {
      case 'exploreRuins': g.state.stats.ruinsExplored = c.count; break;
      case 'ownBuildings': for(let i = 0; i < c.count; i++) addBuilding(g,c.building,8+i*3,5,{complete:true}); break;
      case 'researchTechs': g.state.economy.tech.researched = ['scavengingTools','hydroponics','armory','demolitions','communityPlan','refinery','ruinArchives','machineGuns']; break;
      case 'nightsWithoutBuildingLoss': g.state.stats.nightsWithoutBuildingLoss = c.count; break;
      case 'killMutants': g.state.stats.kills.wanderer = c.count; break;
      case 'trainSoldiers': g.state.stats.soldiersTrained.rifleman = c.count; break;
      case 'destroyNests': g.state.stats.nestsDestroyed = c.count; break;
      case 'repairHp': g.state.stats.hpRepaired = c.amount; break;
      default: throw new Error('new inspiration requires a scenario');
    }
    techSystem(g); expect(g.state.economy.tech.inspired).toContain(tech);
    const progress = g.state.economy.tech.progress[tech]; expect(progress).toBe(TECHS[tech].cost / 2);
    techSystem(g); expect(g.state.economy.tech.progress[tech]).toBe(progress);
  });
});
