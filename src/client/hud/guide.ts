/**
 * Opening checklist for players who have not read anything: the handful of things to do in the
 * first days, each ticked off from the game state as it happens, except looking at the fog
 * calendar, which the client notices itself (GuideProgress: the player hovered it). Shown on days
 * 1 to 3 until every step is done (the player can also close it).
 */
import type { GameView } from '../../sim';
import { SOLDIER_TYPES } from '../../sim/data/combat';
import { BUILDINGS, BUILDING_TYPES, TECHS } from '../../sim/data/economy';

export type GuideStepId = 'produce' | 'barracks' | 'train' | 'forecast' | 'survive' | 'calendar' | 'incident' | 'relay';

export interface GuideStep {
  id: GuideStepId;
  text: string;
  done: boolean;
}

/** What the player did that the game state does not record. */
export interface GuideProgress {
  calendarSeen: boolean;
}

export interface GuideModel {
  steps: GuideStep[];
  /** The first step not done yet. */
  next: GuideStepId | null;
  doneCount: number;
}

const LAST_GUIDE_DAY = 3;

const PRODUCERS = BUILDING_TYPES.filter((t) => BUILDINGS[t].production !== null);

/** Placed a production building: one under construction now, or one completed earlier (start buildings do not count). */
function placedProducer(view: GameView): boolean {
  if (PRODUCERS.some((t) => view.stats.buildingsBuilt[t] > 0)) return true;
  for (const e of view.entities.values()) if (e.kind === 'building' && e.construction !== null && BUILDINGS[e.type].production) return true;
  return false;
}

function hasBarracks(view: GameView): boolean {
  for (const e of view.entities.values()) if (e.kind === 'building' && e.type === 'barracks') return true;
  return false;
}

function startedTraining(view: GameView): boolean {
  if (SOLDIER_TYPES.some((t) => view.stats.soldiersTrained[t] > 0)) return true;
  for (const e of view.entities.values()) if (e.kind === 'building' && e.trainQueue.length > 0) return true;
  return false;
}

export function firstDayGuide(view: GameView, progress: GuideProgress): GuideModel | null {
  const { day, phase } = view.clock;
  if (day > LAST_GUIDE_DAY) return null;
  const nightFell = day > 1 || phase === 'night';
  const steps: GuideStep[] = [
    { id: 'produce', text: '造一座生产建筑：温室放沃土（绿色地块），拆解站挨着残骸。放置时看「产出加成」', done: placedProducer(view) },
    { id: 'barracks', text: '造一座兵营（B）', done: hasBarracks(view) },
    { id: 'train', text: '选中兵营训练士兵。每训练一名士兵，从自动管理的幸存者里调走一人', done: startedTraining(view) },
    { id: 'calendar', text: '顶栏的日历显示今晚和之后 3 晚是什么夜，悬停看每种夜的说明。', done: progress.calendarSeen },
    { id: 'forecast', text: '黄昏看右上角的侦察报告，有夜袭时红色箭头会指出怪物从哪边来，自动管理的士兵会移过去。想自己布置：选中士兵，右键地面，再按 H 原地坚守', done: nightFell },
    { id: 'survive', text: '守住第 1 夜', done: day > 1 },
    { id: 'incident', text: '事件卡弹出时游戏会停住。天黑前没处理，会按最后一个选项结算。', done: view.incidents.history.length > 0 || (day >= 3 && view.incidents.pending === null) },
    { id: 'relay', text: `派斥候探索迷雾，找到中继站；研究"${TECHS.oldFrequency.name}"以后就能在那里修信号塔。`, done: view.signal.discovered || view.economy.tech.researched.includes('oldFrequency') },
  ];
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  return { steps, next: next.id, doneCount: steps.filter((s) => s.done).length };
}
