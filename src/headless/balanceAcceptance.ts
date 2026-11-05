import { STRATEGY_BOTS } from './bots';
import type { BalanceResult } from './balanceGame';
import { CYCLE_TICKS, DAY_TICKS } from '../sim/time';

export interface Check { name: string; pass: boolean; detail: string }
export type AcceptanceResult = Pick<BalanceResult,
  'bot' | 'origin' | 'difficulty' | 'outcome' | 'reason' | 'score' | 'ticks' |
  'endDay' | 'firstSurgeNight' | 'seed' | 'edgeAttackNights' | 'nightsStarted'>;
const rate = (rows: readonly AcceptanceResult[]) => rows.filter(r => r.outcome === 'won').length / rows.length;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[mid]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2 : NaN;
}

/** V2 acceptance; edge exposure uses nights actually started, including a terminal partial night. */
export function balanceChecks(results: readonly AcceptanceResult[]): Check[] {
  const checks: Check[] = [];
  const normal = results.filter(r => r.difficulty === 'normal');
  const idle = normal.filter(r => r.bot === 'doNothing');
  if (idle.length) {
    const before = idle.filter(r => r.outcome === 'lost' && r.ticks < (r.firstSurgeNight - 1) * CYCLE_TICKS + DAY_TICKS).length;
    checks.push({ name: 'doNothing loses before first surge >=95%', pass: before / idle.length >= .95, detail: `${before}/${idle.length}` });
  }
  for (const bot of STRATEGY_BOTS) {
    const rows = normal.filter(r => r.bot === bot);
    if (!rows.length) continue;
    checks.push({
      name: `${bot} normal wins >=55%`, pass: rate(rows) >= .55,
      detail: `${rows.filter(r => r.outcome === 'won').length}/${rows.length} (${percent(rate(rows))})`,
    });
    const hard = results.filter(r => r.difficulty === 'hard' && r.bot === bot);
    if (hard.length) checks.push({
      name: `${bot} hard wins < normal`, pass: rate(hard) < rate(rows),
      detail: `${percent(rate(hard))} < ${percent(rate(rows))}`,
    });
    if (hard.length) checks.push({ name: `${bot} hard wins >=20%`, pass: rate(hard) >= .2, detail: `${percent(rate(hard))}` });
    const betterElsewhere = rows.filter(r => normal.some(o =>
      o.bot !== 'doNothing' && o.bot !== bot && o.seed === r.seed && o.origin === r.origin && (o.score ?? -1) > (r.score ?? -1),
    )).length;
    checks.push({
      name: `${bot} does not dominate every paired map`, pass: betterElsewhere > 0,
      detail: `outscored on ${betterElsewhere}/${rows.length} seed-origin pairs`,
    });
    const lossesWithOtherWin = rows.filter(r => r.outcome !== 'won' && normal.some(o =>
      o.bot !== bot && o.seed === r.seed && o.origin === r.origin && o.outcome === 'won',
    )).length;
    checks.push({
      name: `${bot}: >=2 paired maps where it loses and another strategy wins`, pass: lossesWithOtherWin >= 2,
      detail: `${lossesWithOtherWin}/${rows.length}`,
    });
  }
  if (STRATEGY_BOTS.every(b => normal.some(r => r.bot === b))) {
    for (const reason of ['survived', 'hiveDestroyed', 'signal']) {
      const rows = normal.filter(r => r.reason === reason);
      checks.push({ name: `victory route ${reason} occurs`, pass: rows.length > 0, detail: `${rows.length}` });
    }
    const hive = normal.filter(r => r.bot === 'raider' && r.reason === 'hiveDestroyed').length;
    checks.push({ name: 'raider achieves hive victory', pass: hive > 0, detail: `${hive}` });
    const signal = normal.filter(r => r.reason === 'signal');
    const dedicated = signal.filter(r => r.bot === 'signal').length;
    checks.push({
      name: 'signal victories mainly belong to signal strategy', pass: signal.length > 0 && dedicated / signal.length > .5,
      detail: `${dedicated}/${signal.length}`,
    });
  }
  const allHiveNormal = normal.filter(r => r.outcome === 'won' && r.reason === 'hiveDestroyed');
  const hiveNormal = allHiveNormal.filter(r => r.bot === 'raider');
  const hiveHard = results.filter(r => r.difficulty === 'hard' && r.bot === 'raider' && r.outcome === 'won' && r.reason === 'hiveDestroyed');
  if (normal.some(r => r.bot === 'raider')) {
    const n = median(hiveNormal.map(r => r.endDay));
    const h = median(hiveHard.map(r => r.endDay));
    const early = allHiveNormal.filter(r => r.endDay <= 11).length;
    checks.push({ name: 'normal hive wins on or before day 11 <=10%', pass: allHiveNormal.length > 0 && early / allHiveNormal.length <= .1, detail: `${early}/${allHiveNormal.length}` });
    checks.push({ name: 'normal raider hive median day >=13', pass: n >= 13, detail: `${n} (${hiveNormal.length} wins)` });
    if (results.some(r => r.difficulty === 'hard' && r.bot === 'raider')) checks.push({ name: 'hard raider hive median day >=normal', pass: h >= n, detail: `${h} >= ${n} (${hiveHard.length} wins)` });
  }
  if (STRATEGY_BOTS.every(b => normal.some(r => r.bot === b))) {
    const medians = ['survived', 'hiveDestroyed', 'signal'].map(reason => median(normal.filter(r => r.outcome === 'won' && r.reason === reason).map(r => r.score!)));
    const ratio = Math.max(...medians) / Math.min(...medians);
    checks.push({ name: 'normal victory score median ratio <=1.5', pass: ratio <= 1.5, detail: `${medians.join('/')} => ${ratio.toFixed(3)}` });
  }
  const max = Math.max(0, ...results.map(r => r.edgeAttackNights.length / Math.max(1, r.nightsStarted)));
  checks.push({
    name: 'actual edge-attack nights <=65% of nights actually started in every game', pass: max <= .65,
    detail: `maximum ${percent(max)}`,
  });
  return checks;
}
