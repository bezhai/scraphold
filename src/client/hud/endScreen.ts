/** End-of-game summary: headline, why it ended, score breakdown (victories only) and stats. */
import { clockAt, type GameView } from '../../sim';
import { MUTANTS, MUTANT_TYPES } from '../../sim/data/combat';
import { RESOURCE_NAMES, RESOURCES, type Resource } from '../../sim/data/economy';
import { SIGNAL_TEXT } from '../../sim/data/signal';
import { TOTAL_NIGHTS } from '../../sim/time';
import type { BestScore } from '../storage/bestScores';

export interface EndSummary {
  won: boolean;
  headline: string;
  reason: string;
  epilogue: string;
  day: number;
  scoreRows: [string, number][];
  multiplier: number | null;
  total: number | null;
  stats: [string, string][];
  /** Total gathered over the game, per resource. */
  gathered: { resource: Resource; name: string; amount: number }[];
  killDetail: string;
}

const EPILOGUES = {
  survived: '据点撑过了二十个夜晚，拓荒队在锈原留了下来。',
  hiveDestroyed: '母巢被摧毁，锈原上的巢穴失去了孢子来源。',
  signal: SIGNAL_TEXT.ending,
  coreDestroyed: '炉心被摧毁，据点失守。',
} as const;

function sum(record: Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((a, b) => a + b, 0);
}

export function endSummary(view: GameView): EndSummary {
  const o = view.outcome;
  const clock = o.endTick >= 0 ? clockAt(o.endTick) : view.clock;
  const won = o.status === 'won';
  const headline = won
    ? o.reason === 'hiveDestroyed'
      ? '雾散了'
      : o.reason === 'signal'
        ? '长明城的车队'
        : '第二十一个早晨'
    : '炉心熄灭';

  const reason =
    o.reason === 'survived'
      ? `守到了第 ${TOTAL_NIGHTS + 1} 天`
      : o.reason === 'hiveDestroyed'
        ? `第 ${clock.day} 天摧毁了母巢`
        : o.reason === 'signal'
          ? `第 ${clock.day} 天，长明城的车队到了`
          : `炉心在第 ${clock.day} 天熄灭`;

  const epilogue =
    o.reason === 'hiveDestroyed'
      ? EPILOGUES.hiveDestroyed
      : o.reason === 'signal'
        ? EPILOGUES.signal
        : o.reason === 'survived'
          ? EPILOGUES.survived
          : EPILOGUES.coreDestroyed;

  const s = o.score;
  const st = view.stats;
  return {
    won,
    headline,
    reason,
    epilogue,
    day: clock.day,
    scoreRows: s
      ? [
          ['胜利', s.victory],
          ['提前获胜', s.earlyDays],
          ['摧毁母巢', s.hive],
          ['摧毁巢穴', s.nests],
          ['存活幸存者', s.survivors],
          ['损失建筑', s.buildingsLost],
        ]
      : [],
    multiplier: s ? s.multiplier : null,
    total: s ? s.total : null,
    stats: [
      ['击杀怪物', String(sum(st.kills))],
      ['训练士兵', String(sum(st.soldiersTrained))],
      ['阵亡士兵', String(st.soldiersLost)],
      ['遇难幸存者', String(st.survivorsLost)],
      ['建成建筑', String(sum(st.buildingsBuilt))],
      ['损失建筑', String(st.buildingsLost)],
      ['摧毁巢穴', String(st.nestsDestroyed)],
      ['探索遗迹', String(st.ruinsExplored)],
      ['熬过夜晚', String(st.nightsSurvived)],
    ],
    gathered: RESOURCES.map((r) => ({ resource: r, name: RESOURCE_NAMES[r], amount: Math.round(st.resourcesGathered[r]) })),
    killDetail: MUTANT_TYPES.filter((t) => st.kills[t] > 0)
      .map((t) => `${MUTANTS[t].name} ${st.kills[t]}`)
      .join('、'),
  };
}

export function bestScoreEntry(view: GameView, at: Date): BestScore | null {
  const o = view.outcome;
  if (o.status !== 'won' || !o.score) return null;
  return { score: o.score.total, seed: view.options.seed, origin: view.options.origin, day: endSummary(view).day, at: at.toISOString() };
}
