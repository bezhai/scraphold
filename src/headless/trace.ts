/**
 * One bot game with a line per dawn and dusk (Task 5), for watching what a bot does.
 *
 *   pnpm trace --bot economy [--seed S] [--origin O] [--difficulty D]
 */
import { MUTANT_TYPES } from '../sim/data/combat';
import { ORIGIN_IDS, type OriginId } from '../sim/data/economy';
import type { Difficulty } from '../sim/data/combat';
import { GAME_END_TICK, TOTAL_NIGHTS } from '../sim/time';
import { BOT_NAMES, createController, type BotName } from './bots';
import { runHeadless, type Controller } from './run';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const bot = arg('bot', 'economy') as BotName;
const origin = arg('origin', 'scavengers') as OriginId;
if (!BOT_NAMES.includes(bot)) throw new Error(`--bot must be one of ${BOT_NAMES.join(', ')}`);
if (!ORIGIN_IDS.includes(origin)) throw new Error(`--origin must be one of ${ORIGIN_IDS.join(', ')}`);

const inner = createController(bot);
const r = (n: number) => Math.round(n);
const traced: Controller = (game, events) => {
  const { clock, economy, stats } = game.state;
  if (clock.phaseTick === 0 && clock.phase !== 'day' && game.state.tick > 0) {
    const soldiers: Record<string, number> = {};
    const buildings: Record<string, number> = {};
    let survivors = 0;
    let working = 0;
    for (const e of game.state.entities.values()) {
      if (e.kind === 'soldier') soldiers[e.type] = (soldiers[e.type] ?? 0) + 1;
      else if (e.kind === 'building' && e.type !== 'core') buildings[e.type] = (buildings[e.type] ?? 0) + 1;
      else if (e.kind === 'survivor') {
        survivors++;
        if (e.insideId !== 0) working++;
      }
    }
    const core = game.state.entities.get(game.state.coreId);
    const res = economy.resources;
    const forecast = game.state.night.forecast?.groups.map((g) => `${g.direction}:${g.size}${g.counts ? JSON.stringify(g.counts) : ''}`).join(' ') ?? '';
    console.log(
      `d${clock.day} ${clock.phase.padEnd(5)} core=${r(core?.hp ?? 0)} res=${r(res.scrap)}/${r(res.food)}/${r(res.fuel)}/${r(res.research)} ` +
        `surv=${survivors}(${working}w) sold=${JSON.stringify(soldiers)} bld=${JSON.stringify(buildings)} tech=${economy.tech.researched.join(',')}`,
    );
    if (clock.phase === 'dusk') console.log(`    forecast ${forecast}`);
    if (clock.phase === 'dusk') {
      const kills = MUTANT_TYPES.map((m) => `${m}:${stats.kills[m]}`).join(' ');
      console.log(`    kills ${kills} towerKills=${stats.towerKills} lost soldiers=${stats.soldiersLost} buildings=${stats.buildingsLost} nests=${stats.nestsDestroyed}`);
    }
  }
  return inner(game, events);
};

const summary = runHeadless({
  seed: arg('seed', 'trace-1'),
  origin,
  difficulty: arg('difficulty', 'normal') as Difficulty,
  days: TOTAL_NIGHTS,
  controller: traced,
});
console.log(`outcome=${summary.outcome} day=${summary.clock.day} ticks=${summary.ticks}/${GAME_END_TICK + 1} score=${summary.score ?? '-'}`);
console.log(`rejected ${JSON.stringify(summary.commands.rejected)} accepted=${summary.commands.accepted}`);
console.log(`resources ${JSON.stringify(summary.resources)} soldiers ${JSON.stringify(summary.units.soldiers)} buildings ${JSON.stringify(summary.buildings)}`);
console.log(`nests ${JSON.stringify(summary.nests)} stats lost: soldiers=${summary.stats.soldiersLost} survivors=${summary.stats.survivorsLost} buildings=${summary.stats.buildingsLost}`);
