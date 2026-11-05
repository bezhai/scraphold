/** End-of-game summary: headline, why it ended, score breakdown (victories only) and stats. */
import { clockAt, type GameView } from '../../sim';
import { MUTANTS, MUTANT_TYPES } from '../../sim/data/combat';
import { RESOURCE_NAMES, RESOURCES, type Resource } from '../../sim/data/economy';
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
  survived: '太阳出来的时候，雾退得比以往任何一天都远。小满在墙上刻下第二十一道痕，然后把刀递给了你。锈原还是锈原，但这里已经是一个家了。',
  hiveDestroyed: '母巢塌下去的那一刻，整片锈原的雾都晃了一下。那天下午，大家第一次在没有炉心的地方摘下了面罩。老顾说，北边应该也能看到这片天。',
  signal: "车队是在正午到的，车头漆着一盏灯。接线员本人跳下车，跟每个人握了手。'我们以为北线已经没有人了。'小满哭了，老顾假装在检查轮胎。你回头看了一眼炉心，它还亮着。",
  coreDestroyed: '炉心熄灭以后，雾在一刻钟里漫过了围墙。有人往北跑，有人留下来。很多年以后，路过的拾荒者会在这片废墟里找到一面刻满痕迹的墙。',
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
