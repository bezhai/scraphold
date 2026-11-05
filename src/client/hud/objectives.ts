/**
 * The victory objectives card (O): one line of status per route — hold out to the last dawn,
 * destroy the hive, or call 长明城 with the signal tower. Progress comes from simulation state and
 * read-out functions (onsiteWorkerCount, workerSlots); incident goals are not listed here, they
 * live on the map and in the event log.
 */
import { RELAY, TOTAL_NIGHTS, onsiteWorkerCount, workerSlots, type Game, type GameView } from '../../sim';
import { TECHS } from '../../sim/data/economy';
import { isNestKnown, type NestView } from '../view';

export type ObjectiveRouteId = 'survive' | 'hive' | 'signal';

export interface ObjectiveRoute {
  id: ObjectiveRouteId;
  tag: string;
  title: string;
  status: string;
}

/** The hive while it stands (null once it is gone, or on maps without one). */
export function findHive(view: GameView): NestView | null {
  for (const e of view.entities.values()) if (e.kind === 'nest' && e.isHive && e.hp > 0) return e;
  return null;
}

function hiveStatus(view: GameView): string {
  if (view.stats.hiveDestroyed) return '母巢已经摧毁。';
  const hive = findHive(view);
  if (!hive || !isNestKnown(view, hive)) return '母巢藏在远处的雾里，还没找到。';
  return `母巢生命 ${Math.ceil((hive.hp / hive.maxHp) * 100)}%。`;
}

function signalStatus(game: Game): string {
  const signal = game.state.signal;
  switch (signal.stage) {
    case 'decoding':
      return `找到 ${RELAY.name}，并研究"${TECHS.oldFrequency.name}"。`;
    case 'repair': {
      const tower = game.state.entities.get(signal.buildingId);
      if (!tower || tower.kind !== 'building') return `在 ${RELAY.name}原址建造信号塔。`;
      const done = tower.construction ? tower.construction.progress / tower.construction.total : 1;
      return `修建进度 ${Math.floor(done * 100)}%，在岗工人 ${onsiteWorkerCount(game, tower)}/${workerSlots(game.modifiers, tower)}。`;
    }
    case 'ready':
      return '塔已经建好，随时可以开始广播。';
    case 'broadcast':
      return `已守住 ${signal.nightsHeld}/${signal.nightsRequired} 晚。`;
  }
}

export function objectivesModel(game: Game): ObjectiveRoute[] {
  const view = game.state;
  return [
    { id: 'survive', tag: '坚守', title: '撑过二十夜', status: `守到第 ${TOTAL_NIGHTS + 1} 天天亮。现在是第 ${view.clock.day} 天。` },
    { id: 'hive', tag: '清巢', title: '摧毁母巢', status: hiveStatus(view) },
    { id: 'signal', tag: '求援', title: '信号塔', status: signalStatus(game) },
  ];
}
