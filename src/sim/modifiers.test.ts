import { describe, expect, it } from 'vitest';
import { createEconomyState } from './economy/model';
import { computeModifiers } from './modifiers';

function sources(over: Partial<Parameters<typeof computeModifiers>[0]> = {}) {
  const economy = createEconomyState();
  return { origin: 'scholars' as const, researched: economy.tech.researched, policySlots: economy.policies.slots, ...over };
}

describe('computeModifiers', () => {
  it('starts from the origin effects only', () => {
    const m = computeModifiers(sources({ origin: 'scavengers' }));
    expect(m.global.scrapYieldPct).toBeCloseTo(0.25);
    expect(m.global.researchYieldPct).toBe(0);
    expect(m.global.policySlots).toBe(0);
  });

  it('adds researched tech effects and folds "all" unit/building effects into every type', () => {
    const m = computeModifiers(sources({ researched: ['veteranDoctrine', 'reinforcement'] }));
    expect(m.global.veterancyKillsPct).toBeCloseTo(-0.3);
    expect(m.unit.rifleman.hpPct).toBeCloseTo(0.1);
    expect(m.unit.pickup.hpPct).toBeCloseTo(0.1);
    expect(m.building.barricade.hpPct).toBeCloseTo(0.25);
    expect(m.global.repairCostPct).toBeCloseTo(-0.3);
  });

  it('sums effects from slotted policies and ignores empty slots', () => {
    const m = computeModifiers(sources({ origin: 'scavengers', policySlots: ['salvageDrive', null, 'martialLaw'] }));
    expect(m.global.scrapYieldPct).toBeCloseTo(0.25 + 0.2 - 0.1);
    expect(m.global.trainSpeedPct).toBeCloseTo(0.4);
  });

  it('derives unlocked buildings, units and policies from the tech field of their defs', () => {
    const base = computeModifiers(sources());
    expect(base.unlockedBuildings.has('barracks')).toBe(true);
    expect(base.unlockedBuildings.has('armory')).toBe(false);
    expect(base.unlockedUnits.has('rifleman')).toBe(true);
    expect(base.unlockedUnits.has('sniper')).toBe(false);
    expect(base.unlockedPolicies.has('salvageDrive')).toBe(true);
    expect(base.unlockedPolicies.has('veteranCorps')).toBe(false);
    const later = computeModifiers(sources({ researched: ['armory', 'civicCenter'] }));
    expect(later.unlockedBuildings.has('armory')).toBe(true);
    expect(later.unlockedUnits.has('sniper')).toBe(true);
    expect(later.unlockedPolicies.has('engineeringCorps')).toBe(true);
    expect(later.global.policySlots).toBe(1);
  });
});
