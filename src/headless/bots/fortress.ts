/**
 * Fortification (Task 5): a research station to reach machine guns early, machine-gun towers
 * close around the core (each one reaches the core, so all of them fire at whatever attacks it),
 * a watchtower for exact forecasts, then a square ring of barricades around the core with a
 * three-tile gate in the middle of each side. Mutants detour to the gates and come in on the
 * lanes; boomers spend themselves on barricades, which the survivor AI repairs by day. A small
 * garrison of shield guards and riflemen, left to the soldier AI, holds the base until the towers
 * are up; fuel workplaces grow with the towers. The fortification line adds tower damage,
 * building hp, cheaper repairs and the third policy slot.
 *
 * Ring tiles that cannot take a barricade (wreckage, oil, ruins) stay open; impassable terrain is
 * part of the wall already. Production goes anywhere except the ring, the gates' lanes to the
 * core and the tower spots.
 */
import { validateCommand, nightType, type Game } from '../../sim';
import { BUILDINGS, type BuildingType } from '../../sim/data/economy';
import { DIRECTION_VECTORS } from '../../sim/data/map';
import { inBounds, terrainAt } from '../../sim/map/grid';
import { preparationThreat, composeArmy, knowsOil, needsHousing, threatShares } from './common';
import { findSite, type Site, type SiteRules } from './sites';
import type { BuildOrder, Context, Strategy } from './strategy';
import { needsWorkplace, type WorkplaceShares } from './workplaces';
import { coreOf } from './view';

export interface FortressOptions {
  /** Tiles between the core footprint and the barricade ring. */
  ringGap: number;
}

interface Layout {
  /** Ring tiles that take a barricade, in no particular order. */
  ring: { tileX: number; tileY: number }[];
  /** Tower spots around the core. */
  towers: { tileX: number; tileY: number }[];
  /** Tiles kept free of other buildings: ring, gates, lanes to the core, tower spots. */
  reserved: Set<number>;
}

function layoutFor(game: Game, gap: number): Layout {
  const { map } = game.state;
  const core = coreOf(game);
  const x0 = core.tileX - gap - 1;
  const y0 = core.tileY - gap - 1;
  const side = core.size + 2 * (gap + 1);
  const x1 = x0 + side - 1;
  const y1 = y0 + side - 1;
  const mid = Math.floor(side / 2);
  const reserved = new Set<number>();
  const keep = (x: number, y: number) => {
    if (inBounds(map, x, y)) reserved.add(y * map.width + x);
  };
  const ring: Layout['ring'] = [];
  for (let k = 0; k < side; k++) {
    for (const [x, y, along] of [
      [x0 + k, y0, k],
      [x0 + k, y1, k],
      [x0, y0 + k, k],
      [x1, y0 + k, k],
    ] as const) {
      if (!inBounds(map, x, y)) continue;
      keep(x, y);
      if (Math.abs(along - mid) <= 1) continue;
      if (BUILDINGS.barricade.allowedTerrain.includes(terrainAt(map, y * map.width + x))) ring.push({ tileX: x, tileY: y });
    }
  }
  // Lanes from each gate to the core, three tiles wide, reaching a little outside the ring.
  for (let d = -3; d <= side + 2; d++) {
    for (let w = -1; w <= 1; w++) {
      keep(x0 + mid + w, y0 + d);
      keep(x0 + d, y0 + mid + w);
    }
  }
  // Tower spots two tiles off the core footprint, beside the lanes: every tower reaches the core.
  const s = core.size;
  const towers: Layout['towers'] = (
    [
      [-2, -2],
      [s + 1, s + 1],
      [s + 1, -2],
      [-2, s + 1],
      [-1, -2],
      [s, s + 1],
      [s + 1, -1],
      [-2, s],
    ] as const
  ).map(([dx, dy]) => ({ tileX: core.tileX + dx, tileY: core.tileY + dy }));
  for (const t of towers) keep(t.tileX, t.tileY);
  return { ring, towers, reserved };
}

function placeable(game: Game, type: BuildingType, site: Site): boolean {
  return validateCommand(game, { type: 'placeBuilding', building: type, tileX: site.tileX, tileY: site.tileY }).ok;
}

function footprintFree(game: Game, layout: Layout, type: BuildingType, tx: number, ty: number): boolean {
  const { width } = game.state.map;
  const size = BUILDINGS[type].size;
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (layout.reserved.has(y * width + x)) return false;
  return true;
}

export function fortress({ ringGap }: FortressOptions = { ringGap: 3 }): Strategy {
  let layout: Layout | null = null;
  const layoutOf = (game: Game) => (layout ??= layoutFor(game, ringGap));

  const away = (game: Game, type: BuildingType, rules: Omit<SiteRules, 'accept'>): BuildOrder => ({
    type,
    rules: { ...rules, accept: (tx, ty) => footprintFree(game, layoutOf(game), type, tx, ty) },
  });
  const production = (ctx: Context, type: BuildingType) => away(ctx.game, type, { maxDistance: 11, touching: (t) => t === 'dispatchHub', score: (_x, _y, distance) => -distance });
  const close = (ctx: Context, type: BuildingType, maxDistance: number) => away(ctx.game, type, { maxDistance, score: (_x, _y, d) => -d });

  /** Where the forecast attacks came from, weighted by threat; kept through the day, north before the first forecast. */
  let heading: { x: number; y: number } = DIRECTION_VECTORS.N;
  const facing = (ctx: Context) => {
    let x = 0;
    let y = 0;
    for (const d of ctx.est.directions) {
      x += DIRECTION_VECTORS[d.direction].x * d.weight;
      y += DIRECTION_VECTORS[d.direction].y * d.weight;
    }
    if (x * x + y * y > 1e-12) heading = { x, y };
    return heading;
  };

  /** The next free ring tile, the side facing the heaviest forecast direction first. */
  const nextBarricade = (ctx: Context): BuildOrder | null => {
    const { game } = ctx;
    const core = ctx.core;
    const dir = facing(ctx);
    const occupied = new Set<number>();
    for (const b of ctx.snap.buildings) occupied.add(b.tileY * game.state.map.width + b.tileX);
    const free = layoutOf(game).ring.filter((t) => !occupied.has(t.tileY * game.state.map.width + t.tileX));
    free.sort((a, b) => {
      const da = (a.tileX + 0.5 - core.x) * dir.x + (a.tileY + 0.5 - core.y) * dir.y;
      const db = (b.tileX + 0.5 - core.x) * dir.x + (b.tileY + 0.5 - core.y) * dir.y;
      return db - da || a.tileY - b.tileY || a.tileX - b.tileX;
    });
    const site = free.slice(0, 12).find((t) => placeable(game, 'barricade', t));
    return site ? { type: 'barricade', site } : null;
  };

  /** Expand by one tower every two days, up to twelve, while maintaining a fuel supply. */
  const wantsTower = (ctx: Context) =>
    ctx.researched('machineGuns') && ctx.count('machineGunTower') < Math.min(12, 2 + Math.floor(ctx.day / 2)) && (ctx.count('oilWell') > 0 || ctx.game.state.economy.resources.fuel >= 20);

  const nextTower = (ctx: Context): BuildOrder | null => {
    const site = layoutOf(ctx.game).towers.find((t) => placeable(ctx.game, 'machineGunTower', t));
    const candidate = site ?? findSite(ctx.game, 'machineGunTower', { maxDistance: 9, score: (_x, _y, d) => -d });
    return candidate ? { type: 'machineGunTower', site: candidate } : null;
  };

  const surgeSoon = (ctx: Context) => [0, 1, 2].some(offset => nightType(ctx.game.state, ctx.day + offset) === 'surge');
  const prepareFuel = (ctx: Context) => surgeSoon(ctx) && ctx.count('machineGunTower') >= 2 && ctx.game.state.calendar.nights.slice(0, ctx.day - 1).some(night => night.type === 'surge');
  const fuelTarget = (ctx: Context) => prepareFuel(ctx) ? 60 + ctx.count('machineGunTower') * 5 : 20 + ctx.count('machineGunTower') * 5;

  /** Fuel workplaces grow with the towers they keep firing. */
  const shares = (ctx: Context): WorkplaceShares => {
    const towers = ctx.count('machineGunTower');
    const fuelLow = ctx.game.state.economy.resources.fuel < fuelTarget(ctx);
    return { food: 0.44, scrap: 0.4, research: 0.12, fuel: prepareFuel(ctx) && fuelLow ? 0.25 : Math.min(0.18, 0.04 + towers * 0.012) * (fuelLow ? 1.5 : 1) };
  };
  return {
    name: 'fortress',
    research: ['machineGuns', 'reinforcement', 'windReinforcement', 'scavengingTools', 'hydroponics', 'refinery', 'armory', 'demolitions', 'lookoutNetwork', 'steelLine', 'civicCenter', 'reserveGranary', 'nightVision', 'fogFiltration'],
    policies(ctx) {
      if (nightType(ctx.game.state) === 'rustStorm') return ['stormReadiness', 'rapidRepair', 'salvageDrive'];
      if (ctx.day < 2) return ['salvageDrive', 'scholarsFirst'];
      return prepareFuel(ctx) && ctx.game.state.economy.resources.fuel < fuelTarget(ctx)
        ? ['curfew', 'fuelRationing', 'salvageDrive', 'rapidRepair']
        : ['curfew', 'salvageDrive', 'rapidRepair', 'fuelRationing'];
    },
    build(ctx): BuildOrder | null {
      const want = shares(ctx);
      const towers = ctx.count('machineGunTower');
      if (needsHousing(ctx, 2)) return production(ctx, 'shack');
      if (needsWorkplace(ctx, want, 'food')) return production(ctx, 'greenhouse');
      if (needsWorkplace(ctx, want, 'scrap')) return production(ctx, 'salvageYard');
      if (ctx.count('barracks') === 0) return close(ctx, 'barracks', 8);
      if (prepareFuel(ctx) && ctx.game.state.economy.resources.fuel < fuelTarget(ctx) && ctx.count('oilWell') === 0 && knowsOil(ctx)) {
        const site = findSite(ctx.game, 'oilWell', { maxDistance: 16, score: (_x, _y, d) => -d });
        if (site) return { type: 'oilWell', site };
      }
      if (ctx.researchPending && ctx.count('researchStation') === 0) return production(ctx, 'researchStation');
      if (ctx.day >= 8 && ctx.researched('armory') && ctx.count('armory') === 0) return close(ctx, 'armory', 14);
      if (ctx.researched('machineGuns')) {
        const exposedOil = ctx.snap.buildings.find(oil => {
          if (oil.type !== 'oilWell') return false;
          const fromCore = Math.hypot(oil.x - ctx.core.x, oil.y - ctx.core.y);
          if (fromCore <= 7) return false;
          const protection = ctx.snap.buildings.filter(tower => tower.type === 'machineGunTower' && Math.hypot(tower.x - oil.x, tower.y - oil.y) <= 5).length;
          return protection < 1;
        });
        if (exposedOil) {
          const site = findSite(ctx.game, 'machineGunTower', {
            maxDistance: 25,
            accept: (x, y) => Math.hypot(x + .5 - exposedOil.x, y + .5 - exposedOil.y) <= 4,
            score: (x, y) => -Math.hypot(x + .5 - exposedOil.x, y + .5 - exposedOil.y),
          });
          if (site) return { type: 'machineGunTower', site };
        }
      }
      if (ctx.count('oilWell') < 2 && (needsWorkplace(ctx, want, 'fuel', 0) || ctx.count('oilWell') === 0) && knowsOil(ctx)) {
        return { type: 'oilWell', rules: { maxDistance: 22, score: (_x, _y, d) => -d } };
      }
      if (wantsTower(ctx)) {
        const t = nextTower(ctx);
        if (t) return t;
      }
      if (ctx.count('watchtower') === 0 && (towers >= 2 || !ctx.researched('machineGuns'))) return close(ctx, 'watchtower', 6);
      if (towers >= 2 && ctx.count('barricade') < ctx.day * 8) {
        const b = nextBarricade(ctx);
        if (b) return b;
      }
      if (needsWorkplace(ctx, want, 'research')) return production(ctx, 'researchStation');
      return null;
    },
    army(ctx) {
      const s = threatShares(ctx.est.mix);
      const towers = ctx.done('machineGunTower');
      const poweredTowers = ctx.game.state.economy.resources.fuel >= 20 ? towers : 0;
      const power = Math.max(6, preparationThreat(ctx) * 0.25 - poweredTowers * 0.8);
      const fighters = composeArmy(ctx, power, {
        shieldGuard: 0.3 + s.runners * 0.3,
        rifleman: 0.3,
        sniper: 0.2 + s.armored * 1.2 + s.ranged * 0.6,
        grenadier: 0.25 + s.swarm * 0.3,
      });
      // One scout looks for oil (tower fuel) and ruins, then joins the garrison.
      return { ...fighters, scout: ctx.day >= 2 && ctx.count('oilWell') === 0 ? 1 : 0 };
    },
    // Preserve enough workers to replace losses and keep the defenses supplied.
    minWorkers: (ctx) => Math.max(5, Math.floor(ctx.population * 0.45)),
    workplaces: shares,
    reserve: (ctx) => (wantsTower(ctx) ? BUILDINGS.machineGunTower.cost : {}),
    raids: null,
    scouts: 1,
    promotion: () => null,
  };
}
