import { expect, it } from 'vitest';
import { balanceChecks, type AcceptanceResult } from './balanceAcceptance';
import { CYCLE_TICKS, DAY_TICKS } from '../sim/time';

const sample = (patch: Partial<AcceptanceResult> = {}): AcceptanceResult => ({
  bot: 'doNothing', origin: 'scavengers', difficulty: 'normal', outcome: 'lost', reason: 'coreDestroyed',
  endDay: 3, score: null, ticks: 2 * CYCLE_TICKS, firstSurgeNight: 5, seed: 'sample', edgeAttackNights: [2], nightsStarted: 2, ...patch,
});

it('measures failure against the generated surge start, including the preceding daytime', () => {
  const deadline = 4 * CYCLE_TICKS + DAY_TICKS;
  expect(balanceChecks([sample({ ticks: deadline - 1 })])[0]?.pass).toBe(true);
  expect(balanceChecks([sample({ ticks: deadline })])[0]?.pass).toBe(false);
});

it('does not hide excessive short-game edge exposure behind a twenty-night denominator', () => {
  expect(balanceChecks([sample({ edgeAttackNights: [2, 3], nightsStarted: 3 })]).at(-1)?.pass).toBe(false);
  expect(balanceChecks([sample({ edgeAttackNights: [2], nightsStarted: 3 })]).at(-1)?.pass).toBe(true);
});

it('checks the 55 percent threshold without rounding up and requires hard to be strictly lower', () => {
  const normal = Array.from({ length: 20 }, (_, i) => sample({ bot: 'economy', outcome: i < 11 ? 'won' : 'lost', score: i < 11 ? 1000 : null }));
  expect(balanceChecks(normal).find(check => check.name === 'economy normal wins >=55%')?.pass).toBe(true);
  const hard = normal.map(row => ({ ...row, difficulty: 'hard' as const }));
  expect(balanceChecks([...normal, ...hard]).find(check => check.name === 'economy hard wins < normal')?.pass).toBe(false);
  normal[10]!.outcome = 'lost';
  expect(balanceChecks(normal).find(check => check.name === 'economy normal wins >=55%')?.pass).toBe(false);
});

const diversity = (rows: AcceptanceResult[]) => balanceChecks(rows).find(check =>
  check.name === 'economy: >=2 paired maps where it loses and another strategy wins',
)?.pass;

it('retains the paired win-loss diversity check even when another bot scores higher', () => {
  expect(diversity([
    sample({ bot: 'economy', outcome: 'won', score: 1000 }),
    sample({ bot: 'raider', outcome: 'won', score: 2000 }),
  ])).toBe(false);
});

it('requires two distinct paired map losses with another winner', () => {
  const pair = (seed: string) => [sample({ seed, bot: 'economy' }), sample({ seed, bot: 'raider', outcome: 'won', score: 2000 })];
  expect(diversity(pair('one'))).toBe(false);
  expect(diversity([...pair('one'), ...pair('two')])).toBe(true);
});

const HIVE_DAYS = 'normal hive victory median day 11-16 with >=10 wins';

it('rejects early hive wins, faster hard hive wins, excessive score spread and sub-20-percent hard wins', () => {
  const rows = ['economy', 'raider', 'fortress', 'signal'].flatMap(bot =>
    ['normal', 'hard'].flatMap(difficulty => Array.from({ length: 20 }, (_, i) => sample({
      bot: bot as AcceptanceResult['bot'], difficulty: difficulty as AcceptanceResult['difficulty'],
      seed: `seed-${i}`, outcome: difficulty === 'hard' && i >= 3 ? 'lost' : 'won',
      reason: bot === 'raider' ? 'hiveDestroyed' : bot === 'signal' ? 'signal' : 'survived',
      score: bot === 'raider' ? 4000 : 2000, endDay: bot === 'raider' ? difficulty === 'normal' ? 10 : 8 : 21,
    }))),
  );
  const checks = balanceChecks(rows);
  expect(checks.find(c => c.name === HIVE_DAYS)?.pass).toBe(false);
  expect(checks.find(c => c.name === 'hard raider hive median day >=normal')?.pass).toBe(false);
  expect(checks.find(c => c.name === 'normal victory score median ratio <=1.5')?.pass).toBe(false);
  expect(checks.find(c => c.name === 'fortress hard wins >=20%')?.pass).toBe(false);
});

it('accepts exact median-day, score-ratio and 20-percent boundaries', () => {
  const rows = ['economy', 'raider', 'fortress', 'signal'].flatMap(bot =>
    ['normal', 'hard'].flatMap(difficulty => Array.from({ length: 20 }, (_, i) => sample({
      bot: bot as AcceptanceResult['bot'], difficulty: difficulty as AcceptanceResult['difficulty'],
      seed: `boundary-${i}`, outcome: difficulty === 'hard' && i >= 4 ? 'lost' : 'won',
      reason: bot === 'raider' ? 'hiveDestroyed' : bot === 'signal' ? 'signal' : 'survived',
      score: bot === 'raider' ? 3000 : 2000, endDay: bot === 'raider' ? 16 : 21,
    }))),
  );
  const checks = balanceChecks(rows);
  for (const name of [HIVE_DAYS, 'hard raider hive median day >=normal', 'normal victory score median ratio <=1.5', 'fortress hard wins >=20%']) {
    expect(checks.find(check => check.name === name)?.pass, name).toBe(true);
  }
});

it('wants the normal hive victory median between day 11 and day 16 over at least ten hive wins of any strategy', () => {
  const hiveWins = (days: readonly number[]) => days.map((endDay, i) => sample({
    bot: i % 2 ? 'raider' : 'economy', seed: `hive-${i}`, outcome: 'won', reason: 'hiveDestroyed', endDay,
  }));
  const check = (rows: AcceptanceResult[]) => balanceChecks(rows).find(c => c.name === HIVE_DAYS);
  expect(check(hiveWins(Array(10).fill(11)))?.pass).toBe(true);
  expect(check(hiveWins(Array(10).fill(16)))?.pass).toBe(true);
  expect(check(hiveWins(Array(10).fill(10)))?.pass).toBe(false);
  expect(check(hiveWins(Array(10).fill(17)))?.pass).toBe(false);
  expect(check(hiveWins(Array(9).fill(14)))).toMatchObject({ pass: false, detail: '14 (9 wins)' });
  // Hard games and lost games do not count.
  const rows = [...hiveWins(Array(10).fill(14)), sample({ difficulty: 'hard', outcome: 'won', reason: 'hiveDestroyed', endDay: 9 })];
  expect(check(rows)).toMatchObject({ pass: true, detail: '14 (10 wins)' });
});
