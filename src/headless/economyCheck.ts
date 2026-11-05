/**
 * Economy-only headless check (Task 2): runs two scripted controllers that never fight and prints
 * per-day resource and population curves next to what the data tables predict.
 *
 *   pnpm exec tsx src/headless/economyCheck.ts [--seed S] [--days N]
 *
 * - passive: the scavengers' starting salvage yard gets 3 workers (assigned by the player, so the
 *   survivor AI leaves them there) and one shack is built; nothing else. The yard is the only
 *   workplace, so the other survivors only help build the shack. Day-over-day stockpile changes
 *   must equal the per-day yields computed here from data/economy.ts, and births must follow the
 *   growth threshold.
 * - builder: a fixed build order (greenhouses on fertile soil, shacks, research stations, salvage
 *   yards), research and policies chosen in a fixed order; the survivor AI puts everyone to work.
 *
 * Expectations are computed from the data tables and map terrain only, not from simulation
 * helpers, so they are an independent check of the production and growth rules.
 */
import { applyCommand, checkPlacement, type Building, type Command, type Game, type Survivor } from '../sim';
import { BUILDINGS, GROWTH, ORIGINS, POLICIES, TECHS, type BuildingType, type PolicyId, type TechId } from '../sim/data/economy';
import { forEachFootprintTile, forEachRingTile, terrainAt } from '../sim/map/grid';
import { CYCLE_TICKS, TICKS_PER_SECOND } from '../sim/time';
import { runHeadless, type Controller } from './run';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = arg('seed') ?? 'economy-check';
const days = Number(arg('days') ?? '6');
const CYCLE_SECONDS = CYCLE_TICKS / TICKS_PER_SECOND;

interface DaySnapshot {
  day: number;
  scrap: number;
  food: number;
  fuel: number;
  research: number;
  income: Record<string, number>;
  survivors: number;
  working: number;
  soldiers: number;
  housing: number;
  growth: string;
  buildings: number;
  researched: string;
}

function entities(game: Game) {
  return [...game.state.entities.values()];
}

function buildings(game: Game): Building[] {
  return entities(game).filter((e): e is Building => e.kind === 'building');
}

function snapshot(game: Game): DaySnapshot {
  const { economy } = game.state;
  const survivors = entities(game).filter((e): e is Survivor => e.kind === 'survivor');
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    day: game.state.clock.day,
    scrap: r(economy.resources.scrap),
    food: r(economy.resources.food),
    fuel: r(economy.resources.fuel),
    research: r(economy.resources.research),
    income: Object.fromEntries(Object.entries(economy.incomePerDay).map(([k, v]) => [k, r(v)])),
    survivors: survivors.length,
    working: survivors.filter((s) => s.insideId !== 0).length,
    soldiers: entities(game).filter((e) => e.kind === 'soldier').length,
    housing: economy.housingCap,
    growth: `${r(economy.growth.progress)}/${economy.growth.threshold}`,
    buildings: buildings(game).length,
    researched: economy.tech.researched.join(','),
  };
}

/** Data-table terrain bonus of a footprint (independent of the simulation's implementation). */
function terrainBonus(game: Game, type: BuildingType, tx: number, ty: number): number {
  const map = game.state.map;
  let pct = 0;
  for (const b of BUILDINGS[type].bonuses) {
    let n = 0;
    const each = b.kind === 'adjacentTerrain' ? forEachRingTile : forEachFootprintTile;
    each(map, tx, ty, BUILDINGS[type].size, (i) => {
      if (terrainAt(map, i) === b.terrain) n++;
    });
    pct += (b.kind === 'adjacentTerrain' ? Math.min(n, b.maxTiles) : n) * b.pctPerTile;
  }
  return pct;
}

/** Best legal site within 11 tiles of the core with a free tile ring: highest terrain bonus, then nearest. */
function bestSite(game: Game, type: BuildingType): { x: number; y: number } | null {
  const core = game.state.map.coreTile;
  const size = BUILDINGS[type].size;
  const others = buildings(game);
  let best: { x: number; y: number; score: number } | null = null;
  for (let ty = core.y - 11; ty <= core.y + 11; ty++) {
    for (let tx = core.x - 11; tx <= core.x + 11; tx++) {
      if (!checkPlacement(game, type, tx, ty).ok) continue;
      const crowded = others.some((b) => tx - 1 < b.tileX + b.size && b.tileX < tx + size + 1 && ty - 1 < b.tileY + b.size && b.tileY < ty + size + 1);
      if (crowded) continue;
      const dx = tx + size / 2 - (core.x + 1.5);
      const dy = ty + size / 2 - (core.y + 1.5);
      const score = terrainBonus(game, type, tx, ty) * 100 - Math.sqrt(dx * dx + dy * dy);
      if (!best || score > best.score) best = { x: tx, y: ty, score };
    }
  }
  return best;
}

function idleSurvivors(game: Game): Survivor[] {
  return entities(game).filter((e): e is Survivor => e.kind === 'survivor' && e.insideId === 0 && e.task.type === 'idle');
}

function recorder(days: DaySnapshot[], inner: Controller): Controller {
  return (game, events) => {
    // Before the first tick of a new day: state.clock is still the night of the day that ended.
    if (game.state.tick % CYCLE_TICKS === 0 && game.state.tick > 0) days.push(snapshot(game));
    return inner(game, events);
  };
}

// ---------------------------------------------------------------------------------------------
// passive

function passiveController(): Controller {
  return (game) => {
    if (game.state.tick !== 0) return [];
    const yard = buildings(game).find((b) => b.type === 'salvageYard')!;
    const ids = idleSurvivors(game)
      .slice(0, 3)
      .map((s) => s.id);
    const shack = bestSite(game, 'shack')!;
    return [
      { type: 'assignWork', unitIds: ids, buildingId: yard.id },
      { type: 'placeBuilding', building: 'shack', tileX: shack.x, tileY: shack.y },
    ];
  };
}

// ---------------------------------------------------------------------------------------------
// builder

const BUILD_ORDER: readonly BuildingType[] = [
  'greenhouse',
  'shack',
  'researchStation',
  'greenhouse',
  'shack',
  'salvageYard',
  'shack',
  'greenhouse',
  'researchStation',
  'shack',
  'salvageYard',
  'shack',
  'greenhouse',
  'shack',
];
const RESEARCH_ORDER: readonly TechId[] = ['scavengingTools', 'hydroponics', 'communityPlan', 'refinery', 'ruinArchives', 'lookoutNetwork', 'civicCenter'];
const POLICY_ORDER: readonly PolicyId[] = ['harvestFestival', 'salvageDrive', 'scholarsFirst'];

function builderController(): Controller {
  let next = 0;
  return (game) => {
    if (game.state.tick % 10 !== 0) return [];
    const cmds: Command[] = [];
    const { economy } = game.state;
    if (economy.tech.current === null) {
      const tech = RESEARCH_ORDER.find((t) => !economy.tech.researched.includes(t) && TECHS[t].requires.every((r) => economy.tech.researched.includes(r)));
      if (tech) cmds.push({ type: 'setResearch', tech });
    }
    if (game.state.clock.phase !== 'night') {
      const wanted = POLICY_ORDER.filter((p) => POLICIES[p].tech === null || economy.tech.researched.includes(POLICIES[p].tech!)).slice(0, 2);
      wanted.forEach((policy, slot) => {
        if (economy.policies.slots[slot] !== policy && !economy.policies.slots.includes(policy)) cmds.push({ type: 'setPolicy', slot, policy });
      });
    }
    const siteOpen = buildings(game).some((b) => b.construction !== null);
    const type = BUILD_ORDER[next];
    if (!siteOpen && type) {
      const site = bestSite(game, type);
      if (site) {
        const cmd: Command = { type: 'placeBuilding', building: type, tileX: site.x, tileY: site.y };
        if (applyCommand(game, cmd).ok) next++;
      }
    }
    return cmds;
  };
}

// ---------------------------------------------------------------------------------------------
// report

function printTable(title: string, rows: DaySnapshot[]): void {
  console.log(`\n== ${title} (seed=${seed}) — stockpiles at the end of each day (dawn of the next) ==`);
  console.log('day  scrap   food   fuel  research | income/day scrap food fuel research | surv work sold housing growth        bldg researched');
  for (const s of rows) {
    const i = s.income;
    console.log(
      [
        String(s.day).padStart(3),
        String(s.scrap).padStart(6),
        String(s.food).padStart(6),
        String(s.fuel).padStart(6),
        String(s.research).padStart(8),
        '|',
        String(i.scrap).padStart(16),
        String(i.food).padStart(5),
        String(i.fuel).padStart(5),
        String(i.research).padStart(8),
        '|',
        String(s.survivors).padStart(4),
        String(s.working).padStart(4),
        String(s.soldiers).padStart(4),
        String(s.housing).padStart(7),
        s.growth.padStart(12),
        String(s.buildings).padStart(5),
        s.researched,
      ].join(' '),
    );
  }
}

function passiveExpectations(game: Game, rows: DaySnapshot[]): void {
  const yard = buildings(game).find((b) => b.type === 'salvageYard')!;
  const scrapPct = ORIGINS.scavengers.effects.reduce((p, e) => (e.kind === 'global' && e.stat === 'scrapYieldPct' ? p + e.value : p), 0);
  const yardPerDay = 3 * BUILDINGS.salvageYard.production!.perWorkerPerSecond * (1 + terrainBonus(game, 'salvageYard', yard.tileX, yard.tileY)) * (1 + scrapPct) * CYCLE_SECONDS;
  const core = BUILDINGS.core.baseYieldPerSecond;
  const expected = {
    scrap: ((core.scrap ?? 0) * CYCLE_SECONDS + yardPerDay),
    food: (core.food ?? 0) * CYCLE_SECONDS,
    research: (core.research ?? 0) * CYCLE_SECONDS,
  };
  console.log('\nexpected per-day gain from data tables:', Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, Math.round(v * 10) / 10])));
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1]!;
    const b = rows[k]!;
    const delta = (x: number, y: number) => Math.round((y - x) * 10) / 10;
    console.log(`  end of day ${a.day} -> end of day ${b.day}: scrap +${delta(a.scrap, b.scrap)}  food +${delta(a.food, b.food)}  research +${delta(a.research, b.research)}`);
  }
  const pop = 6;
  const threshold = GROWTH.baseThreshold + GROWTH.thresholdPerPerson * pop;
  console.log(`  growth: ${expected.food.toFixed(1)} food/day surplus fills a ${threshold}-point meter -> first birth after ${(threshold / expected.food).toFixed(2)} days`);
}

function main(): void {
  const passiveRows: DaySnapshot[] = [];
  let passiveGame: Game | null = null;
  const passive = passiveController();
  const passiveSummary = runHeadless({
    seed,
    origin: 'scavengers',
    difficulty: 'normal',
    days,
    controller: recorder(passiveRows, (game, events) => {
      passiveGame = game;
      return passive(game, events);
    }),
  });
  printTable('passive: 3 workers in the starting salvage yard, one shack', passiveRows);
  if (passiveGame) passiveExpectations(passiveGame, passiveRows);
  console.log(`  births=${passiveSummary.stats.survivorsBorn} survivors=${passiveSummary.units.survivors} outcome=${passiveSummary.outcome}`);

  const builderRows: DaySnapshot[] = [];
  const builderSummary = runHeadless({ seed, origin: 'scavengers', difficulty: 'normal', days, controller: recorder(builderRows, builderController()) });
  printTable('builder: fixed build order, the survivor AI staffs', builderRows);
  console.log(
    `  births=${builderSummary.stats.survivorsBorn} survivors=${builderSummary.units.survivors} working=${builderSummary.units.survivorsWorking} buildings=${JSON.stringify(builderSummary.buildings)}`,
  );
  console.log(`  gathered=${JSON.stringify(Object.fromEntries(Object.entries(builderSummary.stats.resourcesGathered).map(([k, v]) => [k, Math.round(v)])))}`);
  console.log(`  rejected commands=${JSON.stringify(builderSummary.commands.rejected)} outcome=${builderSummary.outcome}`);
}

main();
