import { describe, expect, it } from 'vitest';
import {
  ARMOR_TYPES,
  DAMAGE_MULTIPLIER,
  DAMAGE_TYPES,
  DIFFICULTIES,
  MUTANTS,
  MUTANT_TYPES,
  NIGHTS,
  PROMOTIONS,
  SOLDIERS,
  SOLDIER_TYPES,
  TOWER_WEAPONS,
} from './combat';
import { BUILDINGS, BUILDING_TYPES, ORIGINS, ORIGIN_IDS, POLICIES, POLICY_IDS, TECHS, TECH_IDS } from './economy';
import { CALENDAR } from './calendar';
import { TOTAL_NIGHTS } from '../time';
import { MAP_GEN, TERRAIN, TERRAIN_LIST } from './map';

describe('map data', () => {
  it('assigns each terrain a unique code equal to its index', () => {
    TERRAIN_LIST.forEach((t, i) => expect(TERRAIN[t].code).toBe(i));
  });
  it('makes water, rock and wall impassable and the rest passable', () => {
    for (const t of TERRAIN_LIST) expect(TERRAIN[t].passable).toBe(!['water', 'rock', 'wall'].includes(t));
  });
  it('uses the v2 map dimensions', () => {
    expect([MAP_GEN.width, MAP_GEN.height]).toEqual([96, 72]);
  });
});

describe('combat data', () => {
  it('has a positive damage multiplier for every damage type x armor type', () => {
    for (const d of DAMAGE_TYPES) for (const a of ARMOR_TYPES) expect(DAMAGE_MULTIPLIER[d][a]).toBeGreaterThan(0);
  });

  it('gives every mutant type at least one soldier type with a strong damage multiplier or splash against it', () => {
    for (const m of MUTANT_TYPES) {
      const armor = MUTANTS[m].armor;
      const counters = SOLDIER_TYPES.filter((s) => {
        const w = SOLDIERS[s].weapon;
        return DAMAGE_MULTIPLIER[w.damageType][armor] >= 1.25 || (w.splashRadius > 0 && armor === 'none');
      });
      expect(counters, m).not.toHaveLength(0);
    }
  });

  it('defines the five base roles plus two fuel units unlocked by tech', () => {
    expect(SOLDIER_TYPES).toHaveLength(7);
    const fuelUnits = SOLDIER_TYPES.filter((s) => (SOLDIERS[s].cost.fuel ?? 0) > 0);
    expect(fuelUnits.sort()).toEqual(['flamethrower', 'pickup']);
    for (const s of fuelUnits) expect(SOLDIERS[s].tech).not.toBeNull();
  });

  it('trains every soldier at an existing military building and references known techs and promotions', () => {
    for (const s of SOLDIER_TYPES) {
      const def = SOLDIERS[s];
      expect(BUILDINGS[def.trainedAt].category, s).toBe('military');
      if (def.tech) expect(TECH_IDS).toContain(def.tech);
      expect(def.promotions).toHaveLength(2);
      for (const p of def.promotions) expect(PROMOTIONS[p], p).toBeDefined();
    }
    const trainedAt = (b: string) => SOLDIER_TYPES.filter((s) => SOLDIERS[s].trainedAt === b).sort();
    expect(trainedAt('barracks')).toEqual(['rifleman', 'scout', 'shieldGuard']);
    expect(trainedAt('armory')).toEqual(['grenadier', 'sniper']);
    expect(trainedAt('workshop')).toEqual(['flamethrower', 'pickup']);
  });

  it('gives the grenadier a minimum range and the sniper the longest range', () => {
    expect(SOLDIERS.grenadier.weapon.minRange).toBeGreaterThan(0);
    const maxRange = Math.max(...SOLDIER_TYPES.map((s) => SOLDIERS[s].weapon.range));
    expect(SOLDIERS.sniper.weapon.range).toBe(maxRange);
  });

  it('covers every night with growing budgets and a final boss', () => {
    expect(NIGHTS).toHaveLength(TOTAL_NIGHTS);
    for (let i = 1; i < NIGHTS.length; i++) expect(NIGHTS[i]!.budget).toBeGreaterThan(NIGHTS[i - 1]!.budget);
    expect(NIGHTS[4]!.boss).not.toBeNull();
    expect(NIGHTS[TOTAL_NIGHTS - 1]!.boss).not.toBeNull();
    expect(NIGHTS[TOTAL_NIGHTS - 1]!.boss!.hpPct).toBeGreaterThan(NIGHTS[4]!.boss!.hpPct);
    NIGHTS.forEach((n, i) => {
      if (i + 1 < CALENDAR.surgeWindows[0][0]) expect(n.boss).toBeNull();
      else expect(n.boss).not.toBeNull();
    });
  });

  it('orders difficulties easy < normal < hard', () => {
    expect(DIFFICULTIES.easy.nightBudgetPct).toBeLessThan(DIFFICULTIES.normal.nightBudgetPct);
    expect(DIFFICULTIES.normal.nightBudgetPct).toBeLessThan(DIFFICULTIES.hard.nightBudgetPct);
    expect(DIFFICULTIES.easy.scoreMultiplier).toBeLessThan(DIFFICULTIES.hard.scoreMultiplier);
  });

  it('only gives weapons to defense buildings', () => {
    for (const b of Object.keys(TOWER_WEAPONS)) expect(BUILDINGS[b as keyof typeof BUILDINGS].category).toBe('defense');
  });
});

describe('economy data', () => {
  it('restricts the oil well to oil tiles and gives every production building worker slots', () => {
    expect(BUILDINGS.oilWell.allowedTerrain).toEqual(['oil']);
    for (const b of BUILDING_TYPES) {
      const def = BUILDINGS[b];
      if (def.production) expect(def.workerSlots, b).toBeGreaterThan(0);
      if (def.tech) expect(TECH_IDS).toContain(def.tech);
    }
    expect(Object.keys(BUILDINGS.core.baseYieldPerSecond).length).toBeGreaterThan(0);
    expect(BUILDINGS.shack.housing).toBeGreaterThan(0);
  });

  it('has 25 techs in three lines, with acyclic known prerequisites', () => {
    expect(TECH_IDS).toHaveLength(25);
    for (const line of ['survival', 'military', 'fortification'] as const) {
      expect(TECH_IDS.filter((t) => TECHS[t].line === line)).toHaveLength({ survival: 10, military: 8, fortification: 7 }[line]);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (t: (typeof TECH_IDS)[number]): void => {
      if (done.has(t)) return;
      expect(visiting.has(t), `cycle at ${t}`).toBe(false);
      visiting.add(t);
      for (const r of TECHS[t].requires) {
        expect(TECH_IDS).toContain(r);
        visit(r);
      }
      visiting.delete(t);
      done.add(t);
    };
    TECH_IDS.forEach(visit);
    for (const t of TECH_IDS) expect(TECHS[t].inspiration).toBeDefined();
  });

  it('has 14 policies, some available at the start and the rest unlocked by known techs', () => {
    expect(POLICY_IDS).toHaveLength(14);
    expect(POLICY_IDS.filter((p) => POLICIES[p].tech === null).length).toBeGreaterThanOrEqual(3);
    for (const p of POLICY_IDS) if (POLICIES[p].tech) expect(TECH_IDS).toContain(POLICIES[p].tech);
  });

  it('has three origins matching the spec', () => {
    expect([...ORIGIN_IDS].sort()).toEqual(['militia', 'scavengers', 'scholars']);
    expect(ORIGINS.scavengers.start.buildings).toContain('salvageYard');
    expect(ORIGINS.militia.start.buildings).toContain('barracks');
    expect(ORIGINS.militia.start.soldiers.some((s) => s.type === 'rifleman' && s.count > 0)).toBe(true);
    expect(ORIGINS.scholars.start.revealRuins).toBe(true);
  });

  it('lets a tech add the third policy slot', () => {
    const slotTechs = TECH_IDS.filter((t) =>
      TECHS[t].effects.some((e) => e.kind === 'global' && e.stat === 'policySlots' && e.value > 0),
    );
    expect(slotTechs).toHaveLength(1);
    expect(TECHS[slotTechs[0]!].line).toBe('fortification');
  });
});
