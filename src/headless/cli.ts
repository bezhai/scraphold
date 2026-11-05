/**
 * pnpm sim [--seed S] [--days N] [--origin scavengers|militia|scholars] [--difficulty easy|normal|hard] [--json]
 */
import { DIFFICULTY_IDS, type Difficulty } from '../sim/data/combat';
import { ORIGIN_IDS, type OriginId } from '../sim/data/economy';
import { BOT_NAMES, createController, type BotName } from './bots';
import { runHeadless } from './run';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = arg('seed') ?? new Date().toISOString().slice(0, 10);
const days = Number(arg('days') ?? '3');
const origin = (arg('origin') ?? 'scavengers') as OriginId;
const difficulty = (arg('difficulty') ?? 'normal') as Difficulty;
if (!ORIGIN_IDS.includes(origin)) throw new Error(`--origin must be one of ${ORIGIN_IDS.join(', ')}`);
if (!DIFFICULTY_IDS.includes(difficulty)) throw new Error(`--difficulty must be one of ${DIFFICULTY_IDS.join(', ')}`);
if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a positive integer');

const bot = (arg('bot') ?? 'doNothing') as BotName;
if (!BOT_NAMES.includes(bot)) throw new Error(`--bot must be one of ${BOT_NAMES.join(', ')}`);
const started = performance.now();
const summary = runHeadless({ seed, origin, difficulty, days, controller: createController(bot) });
const ms = performance.now() - started;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...summary, elapsedMs: Math.round(ms) }, null, 2));
} else {
  const s = summary;
  console.log(`seed=${s.seed} origin=${s.origin} difficulty=${s.difficulty}`);
  console.log(`ticks=${s.ticks} day=${s.clock.day} phase=${s.clock.phase} outcome=${s.outcome} score=${s.score ?? '-'}`);
  console.log(`resources ${JSON.stringify(s.resources)}`);
  console.log(`survivors=${s.units.survivors} (working ${s.units.survivorsWorking}) soldiers=${JSON.stringify(s.units.soldiers)} mutants=${JSON.stringify(s.units.mutants)}`);
  console.log(`buildings ${JSON.stringify(s.buildings)}`);
  console.log(`nests total=${s.nests.total} discovered=${s.nests.discovered} hive=${s.nests.hive} levels=${JSON.stringify(s.nests.levels)}`);
  console.log(`explored tiles=${s.exploredTiles} kills=${JSON.stringify(s.stats.kills)}`);
  console.log(`events ${JSON.stringify(s.events)}`);
  console.log(`hash=${s.hash} elapsed=${ms.toFixed(0)}ms (${((s.ticks / ms) * 1000).toFixed(0)} ticks/s)`);
}
