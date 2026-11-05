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
  expect(checks.find(c => c.name === 'normal raider hive median day >=13')?.pass).toBe(false);
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
      score: bot === 'raider' ? 3000 : 2000, endDay: bot === 'raider' ? 13 : 21,
    }))),
  );
  const checks = balanceChecks(rows);
  for (const name of ['normal raider hive median day >=13', 'hard raider hive median day >=normal', 'normal victory score median ratio <=1.5', 'fortress hard wins >=20%']) {
    expect(checks.find(check => check.name === name)?.pass, name).toBe(true);
  }
});

it('counts day eleven as an early hive win and accepts at most ten percent', () => {
  const rows = Array.from({ length: 10 }, (_, i) => sample({
    bot: 'raider', outcome: 'won', reason: 'hiveDestroyed', endDay: i === 0 ? 11 : 14,
  }));
  const early = () => balanceChecks(rows).find(check => check.name === 'normal hive wins on or before day 11 <=10%');
  expect(early()?.pass).toBe(true);
  rows[1]!.endDay = 10;
  expect(early()?.pass).toBe(false);
  rows[1]!.endDay = 14;
  rows.push(sample({ bot: 'economy', outcome: 'won', reason: 'hiveDestroyed', endDay: 10 }));
  expect(early()?.detail).toBe('2/11');
  expect(early()?.pass).toBe(false);
});
