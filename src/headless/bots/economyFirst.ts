/**
 * Economy first, then military (Task 5): grow the workforce and production with a token army,
 * then from `switchDay` turn the stockpile into a large mixed army from the barracks and the
 * armory (riflemen, snipers against armor, grenadiers against swarms, shield guards against
 * runners), trained to the size of each night's expected threat.
 */
import { preparationThreat, composeArmy, hubOrder, knowsOil, nearCore, needsHousing, threatShares } from './common';
import type { BuildOrder, Context, Strategy } from './strategy';
import { needsWorkplace, type WorkplaceShares } from './workplaces';

export interface EconomyFirstOptions {
  /** First day of the military phase. */
  switchDay: number;
}

export function economyFirst({ switchDay }: EconomyFirstOptions = { switchDay: 6 }): Strategy {
  const military = (ctx: Context) => ctx.day >= switchDay;
  const shares = (ctx: Context): WorkplaceShares =>
    military(ctx) ? { food: 0.42, scrap: 0.3, research: 0.18, fuel: 0.05, support: 0.05 } : { food: 0.45, scrap: 0.3, research: 0.18, support: 0.07 };
  const producers = (ctx: Context) => ctx.count('greenhouse') + ctx.count('salvageYard') + ctx.count('researchStation');
  return {
    name: 'economy',
    research: ['scavengingTools', 'hydroponics', 'armory', 'communityPlan', 'demolitions', 'refinery', 'veteranDoctrine', 'ruinArchives', 'machineGuns', 'reinforcement', 'windReinforcement', 'reserveGranary', 'rapidDeployment', 'expeditionPack'],
    policies: (ctx) => (military(ctx) ? ['martialLaw', 'salvageDrive', 'harvestFestival'] : ['salvageDrive', 'harvestFestival', 'scholarsFirst']),
    build(ctx): BuildOrder | null {
      const want = shares(ctx);
      if (needsHousing(ctx, 2)) return nearCore('shack');
      if (ctx.count('barracks') === 0 && (ctx.day >= 2 || ctx.phase !== 'day')) return nearCore('barracks', 9);
      if (needsWorkplace(ctx, want, 'food')) return nearCore('greenhouse');
      if (needsWorkplace(ctx, want, 'scrap')) return nearCore('salvageYard');
      if (needsWorkplace(ctx, want, 'research')) return nearCore('researchStation');
      if (producers(ctx) >= 3 && needsWorkplace(ctx, want, 'support', 0)) return hubOrder(ctx);
      if (ctx.researched('armory') && ctx.count('armory') === 0 && ctx.day >= switchDay - 1) return nearCore('armory', 9);
      if (military(ctx) && ctx.count('barracks') < 2) return nearCore('barracks', 9);
      if (military(ctx) && ctx.count('watchtower') === 0) return nearCore('watchtower', 6);
      if (needsWorkplace(ctx, want, 'fuel', 0) && knowsOil(ctx)) return { type: 'oilWell', rules: { maxDistance: 20, score: (_x, _y, d) => -d } };
      return null;
    },
    army(ctx) {
      const s = threatShares(ctx.est.mix);
      const power = preparationThreat(ctx) * (military(ctx) ? 0.3 : 0.18);
      const fighters = composeArmy(ctx, power, {
        rifleman: 0.45 + s.swarm * 0.2,
        shieldGuard: 0.1 + s.runners * 0.4,
        sniper: 0.1 + s.armored * 1.4 + s.ranged * 0.8,
        grenadier: 0.15 + s.swarm * 0.35,
      });
      // One scout finds the nests for the late raids; once they start, a lost scout is not replaced.
      return { ...fighters, scout: ctx.day >= 3 && ctx.day <= switchDay + 2 ? 1 : 0 };
    },
    minWorkers: (ctx) => (military(ctx) ? Math.max(6, Math.floor(ctx.population * 0.4)) : Math.max(3, Math.floor(ctx.population * 0.55))),
    workplaces: shares,
    reserve: () => ({}),
    raids: { fromDay: switchDay + 2, homeGuard: 12, powerRatio: 1.6, hive: null },
    scouts: 1,
    promotion: () => null,
  };
}
