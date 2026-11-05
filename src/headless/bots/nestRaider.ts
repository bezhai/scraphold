/**
 * Early nest clearing (Task 5): barracks on day 1, two motorbike scouts to find the nests, then a
 * strike force of riflemen and shield guards that destroys discovered nests by day, cheapest
 * first, for their fuel, research and survivors, and so that they stop sending groups at night.
 * Grenadiers answer armored and ranged mutants (explosives also break nests); the military line
 * leads to armed pickups (fast, armored, made for clearing nests); with enough power late in the
 * game the strike force goes for the hive and an early victory.
 */
import { guardStrength, hiveAssaultPower } from './army';
import { preparationThreat, composeArmy, knowsOil, nearCore, needsHousing, threatShares } from './common';
import type { BuildOrder, Context, Strategy } from './strategy';
import { needsWorkplace, type WorkforceShares } from './workforce';

export function nestRaider(): Strategy {
  const shares = (ctx: Context): WorkforceShares =>
    ctx.researched('fuelPower') ? { food: 0.42, scrap: 0.3, research: 0.1, fuel: 0.18 } : { food: 0.45, scrap: 0.35, research: 0.12, fuel: 0.08 };
  return {
    name: 'raider',
    research: ['armory', 'fuelPower', 'armoredPickup', 'rapidDeployment', 'expeditionPack', 'scavengingTools', 'refinery', 'hydroponics', 'demolitions', 'veteranDoctrine', 'communityPlan', 'reserveGranary', 'nightVision'],
    policies: (ctx: Context) => (ctx.day >= 2 ? ['martialLaw', 'salvageDrive'] : ['salvageDrive', 'martialLaw']),
    build(ctx): BuildOrder | null {
      const want = shares(ctx);
      if (ctx.count('barracks') === 0) return nearCore('barracks', 8);
      if (needsHousing(ctx, 2)) return nearCore('shack');
      if (needsWorkplace(ctx, want, 'food')) return nearCore('greenhouse');
      if (needsWorkplace(ctx, want, 'scrap')) return nearCore('salvageYard');
      if (ctx.researched('fuelPower') && ctx.count('workshop') === 0) return nearCore('workshop', 8);
      if (needsWorkplace(ctx, want, 'fuel', 0) && knowsOil(ctx)) return { type: 'oilWell', rules: { maxDistance: 22, score: (_x, _y, d) => -d } };
      if (needsWorkplace(ctx, want, 'research')) return nearCore('researchStation');
      if (ctx.researched('armory') && ctx.count('armory') === 0 && ctx.day >= 4) return nearCore('armory', 9);
      return null;
    },
    army(ctx) {
      const s = threatShares(ctx.est.mix);
      const hive = ctx.snap.discoveredNests.find(n => n.isHive);
      const expedition = hive && ctx.researched('expeditionPack') ? Math.max(guardStrength(hive), hiveAssaultPower(hive)) * 1.4 : 0;
      const power = Math.max(3 + preparationThreat(ctx) * 0.35, expedition);
      const fighters = composeArmy(ctx, power, {
        rifleman: 0.5,
        shieldGuard: 0.2 + s.runners * 0.3,
        pickup: 0.6,
        grenadier: s.armored * 1.2 + s.ranged * 0.6,
        flamethrower: ctx.researched('armoredPickup') ? 0.1 + s.swarm * 0.2 : 0,
      });
      return { ...fighters, scout: 2 };
    },
    minWorkers: (ctx) => Math.max(4, Math.floor(ctx.population * 0.35)),
    workforce: shares,
    reserve: () => ({}),
    repairs: { crew: 1, below: 0.6 },
    defense: { rallyDistance: 3, engageRadius: 10 },
    raids: { fromDay: 2, homeGuard: 3, powerRatio: 1.0, hive: { fromDay: 8, minPower: 0, homeGuard: 8 } },
    scouts: 2,
    promotion: () => null,
  };
}
