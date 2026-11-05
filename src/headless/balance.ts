/**
 * Balance runs (V2 Task 6): every bot plays N seeds x origins x difficulties in parallel worker
 * processes; prints a table per difficulty, a win-rate table per origin and the spec's balance
 * targets with PASS/FAIL, and saves every game result as JSON.
 *
 *   pnpm balance [--seeds 20] [--bots doNothing,economy,raider,fortress,signal] [--origins all]
 *                [--difficulties normal,hard] [--jobs N] [--out balance/latest.json] [--prefix balance]
 */
import { balanceChecks } from './balanceAcceptance';
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFICULTY_IDS, SOLDIER_TYPES, type Difficulty } from '../sim/data/combat';
import { TOTAL_NIGHTS } from '../sim/time';
import { ORIGIN_IDS, RESOURCES, type OriginId } from '../sim/data/economy';
import { lossesBetween, playBalanceGame, type BalanceJob, type BalanceResult } from './balanceGame';
import { BOT_NAMES, type BotName } from './bots';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function list<T extends string>(name: string, all: readonly T[], fallback: readonly T[]): T[] {
  const raw = arg(name);
  if (!raw) return [...fallback];
  if (raw === 'all') return [...all];
  const items = raw.split(',') as T[];
  for (const x of items) if (!all.includes(x)) throw new Error(`--${name}: unknown ${x}; expected ${all.join(', ')}`);
  return items;
}

// ---------------------------------------------------------------------------------------------
// Worker pool: each worker plays the jobs the parent sends and replies with the results.

async function runPool(jobs: BalanceJob[], workers: number): Promise<BalanceResult[]> {
  const results: BalanceResult[] = [];
  const queue = [...jobs];
  const self = fileURLToPath(import.meta.url);
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, () => {
      const child = fork(self, ['--worker'], { execArgv: ['--import', 'tsx'] });
      return new Promise<void>((resolve, reject) => {
        const next = () => {
          const job = queue.shift();
          if (!job) {
            child.kill();
            resolve();
            return;
          }
          child.send(job);
        };
        child.on('message', (r: BalanceResult) => {
          results.push(r);
          const progress = arg('progress');
          if (progress) appendFileSync(progress, JSON.stringify(r) + '\n');
          done++;
          if (done % 20 === 0 || done === jobs.length) process.stderr.write(`  ${done}/${jobs.length} games\n`);
          next();
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0 && code !== null && queue.length > 0) reject(new Error(`worker exited with ${code}`));
        });
        next();
      });
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------------------------
// Tables

const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`);
const avg = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '-');

function pad(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((c, k) => c.padEnd(widths[k] ?? 8)).join(' ');
}

function table(header: readonly string[], rows: readonly string[][]): string {
  const widths = header.map((h, k) => Math.max(h.length, ...rows.map((r) => (r[k] ?? '').length)));
  return [pad(header, widths), pad(widths.map((w) => '-'.repeat(w)), widths), ...rows.map((r) => pad(r, widths))].join('\n');
}

/** Average of a count record over games, as "type:avg" for the largest entries. */
function averageMix(records: readonly Partial<Record<string, number>>[], keys: readonly string[], top = 4): string {
  const sums = keys.map((k) => ({ k, v: avg(records.map((r) => r[k] ?? 0)) })).filter((x) => x.v >= 0.05);
  sums.sort((a, b) => b.v - a.v);
  return sums
    .slice(0, top)
    .map((x) => `${x.k}:${fmt(x.v)}`)
    .join(' ');
}

const LATE_FROM = 6;
const LATE_TO = TOTAL_NIGHTS;

function botRow(rs: readonly BalanceResult[]): string[] {
  const wins = rs.filter((r) => r.outcome === 'won');
  const losses = rs.filter((r) => r.outcome === 'lost');
  const hive = rs.filter((r) => r.hiveDestroyed).length;
  const late = rs.filter((r) => r.endDay > LATE_FROM || (r.endDay === LATE_FROM && r.endPhase === 'night'));
  const lateHurt = late.filter((r) => lossesBetween(r, LATE_FROM, LATE_TO) > 0).length;
  const unspent = RESOURCES.map((res) => `${res[0]}${Math.round(avg(rs.map((r) => r.resources[res])))}`).join('/');
  return [
    `${rs.length}`,
    pct(wins.length, rs.length),
    hive > 0 ? `${hive}` : '-',
    losses.length > 0 ? fmt(avg(losses.map((r) => r.endDay))) : '-',
    losses.length > 0 ? `core x${losses.length}` : '-',
    averageMix(rs.map((r) => r.army), SOLDIER_TYPES),
    averageMix(
      rs.map((r) => r.buildings),
      ['machineGunTower', 'barricade', 'watchtower', 'barracks', 'armory', 'workshop', 'oilWell', 'greenhouse', 'salvageYard', 'researchStation', 'shack'],
      4,
    ),
    fmt(avg(rs.map((r) => r.nestsDestroyed))),
    unspent,
    late.length > 0 ? `${fmt(avg(late.map((r) => lossesBetween(r, LATE_FROM, LATE_TO))))} (${pct(lateHurt, late.length)})` : '-',
    fmt(avg(rs.map((r) => r.minutes))),
  ];
}

const HEADER = ['bot', 'games', 'win', 'hive', 'lossNight', 'cause', 'final army (avg)', 'key buildings (avg)', 'nests', 'unspent s/f/f/r', `loss n${LATE_FROM}-${LATE_TO} (hurt)`, 'min'];

function printTables(results: readonly BalanceResult[], bots: readonly BotName[], difficulties: readonly Difficulty[]): void {
  for (const d of difficulties) {
    console.log(`\n## ${d}`);
    const rows = bots.map((b) => [b, ...botRow(results.filter((r) => r.bot === b && r.difficulty === d))]);
    console.log(table(HEADER, rows));
    const origins = ORIGIN_IDS.filter((o) => results.some((r) => r.origin === o && r.difficulty === d));
    if (origins.length > 1) {
      console.log(`\nwin rate by origin (${d})`);
      const orows = bots.map((b) => [
        b,
        ...origins.map((o) => {
          const rs = results.filter((r) => r.bot === b && r.difficulty === d && r.origin === o);
          return `${pct(rs.filter((r) => r.outcome === 'won').length, rs.length)} (${rs.length})`;
        }),
      ]);
      console.log(table(['bot', ...origins], orows));
    }
  }
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const seeds = Number(arg('seeds') ?? '20');
  const prefix = arg('prefix') ?? 'balance';
  const bots = list('bots', BOT_NAMES, BOT_NAMES);
  const origins = list<OriginId>('origins', ORIGIN_IDS, ORIGIN_IDS);
  const difficulties = list<Difficulty>('difficulties', DIFFICULTY_IDS, ['normal', 'hard']);
  const workers = Number(arg('jobs') ?? String(Math.max(1, availableParallelism() - 2)));
  const out = arg('out') ?? 'balance/latest.json';
  const jobs: BalanceJob[] = [];
  for (const difficulty of difficulties)
    for (const bot of bots)
      for (const origin of origins) for (let i = 1; i <= seeds; i++) jobs.push({ bot, origin, difficulty, seed: `${prefix}-${i}` });

  const progress = arg('progress');
  if (progress) writeFileSync(progress, '');
  const started = performance.now();
  console.log(`${jobs.length} games: ${seeds} seeds x ${origins.length} origins x ${bots.length} bots x ${difficulties.length} difficulties, ${workers} workers`);
  const results = await runPool(jobs, workers);
  const key = (r: BalanceJob) => `${r.difficulty}|${r.bot}|${r.origin}|${r.seed}`;
  results.sort((a, b) => key(a).localeCompare(key(b), 'en', { numeric: true }));
  printTables(results, bots, difficulties);
  const verdicts = balanceChecks(results);
  console.log('\n## targets');
  for (const c of verdicts) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  [${c.detail}]`);
  const seconds = (performance.now() - started) / 1000;
  console.log(`\n${jobs.length} games in ${seconds.toFixed(0)} s (avg ${fmt(avg(results.map((r) => r.wallMs)) / 1000)} s per game per worker)`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ seeds, prefix, bots, origins, difficulties, checks: verdicts, results }, null, 1));
  console.log(`saved ${out}`);
}

if (process.argv.includes('--worker')) {
  process.on('message', (job: BalanceJob) => {
    process.send?.(playBalanceGame(job));
  });
} else {
  await main();
}
