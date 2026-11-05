/**
 * Turns simulation events into event-log lines and jump-to alerts, and decides which lines the
 * HUD shows (logFeed). Effects (shots, explosions) are handled by the renderer; this only covers
 * what the player should read. The dusk radio broadcast is state, not an event (night.broadcast,
 * from the first dusk tick to dawn), so it joins the log as an entry dated at its dusk
 * (withBroadcast).
 */
import { INCIDENT_TARGETS, hiveDamageReduction, type GameEvent, type GameView } from '../../sim';
import { HIVE_SHIELD, MUTANTS, SOLDIERS, type SoldierType } from '../../sim/data/combat';
import { BUILDINGS, RESOURCES, INSPIRATION_BOOST, RESOURCE_NAMES, TECHS, type BuildingType, type RuinReward } from '../../sim/data/economy';
import { tileCenter } from '../../sim/map/grid';
import { CYCLE_TICKS, DAY_TICKS, DUSK_TICKS, TICKS_PER_SECOND, TOTAL_NIGHTS } from '../../sim/time';
import { formatAmounts, formatPercent } from './format';

export type LogTone = 'info' | 'good' | 'warn' | 'danger';

export interface LogLine {
  text: string;
  tone: LogTone;
  /** Where the camera jumps when the line is clicked. */
  at?: { x: number; y: number };
}

export interface Alert {
  x: number;
  y: number;
  tick: number;
  core: boolean;
}

function line(text: string, tone: LogTone, at?: { x: number; y: number }): LogLine {
  return at ? { text, tone, at } : { text, tone };
}

function positionOf(view: GameView, id: number): { x: number; y: number } | undefined {
  const e = view.entities.get(id);
  return e ? { x: e.x, y: e.y } : undefined;
}

function entityName(view: GameView, id: number): string {
  const e = view.entities.get(id);
  if (!e) return '单位';
  if (e.kind === 'building') return BUILDINGS[e.type].name;
  if (e.kind === 'soldier') return SOLDIERS[e.type].name;
  if (e.kind === 'survivor') return '幸存者';
  if (e.kind === 'mutant') return MUTANTS[e.type].name;
  return e.isHive ? '母巢' : '巢穴';
}

function ruinRewardText(reward: RuinReward): string {
  switch (reward.kind) {
    case 'resources':
      return `获得 ${RESOURCES.filter(r => reward.amounts[r] !== undefined).map(r => `${RESOURCE_NAMES[r]} ${reward.amounts[r]}`).join('、')}`;
    case 'resource':
      return `获得 ${RESOURCE_NAMES[reward.resource]} ${reward.amount}`;
    case 'survivors':
      return `${reward.count} 名幸存者加入`;
    case 'reveal':
      return '揭开了周围的地图';
    case 'unit':
      return `一名${SOLDIERS[reward.unit].name}加入`;
  }
}

export function logLineForEvent(view: GameView, event: GameEvent): LogLine | null {
  switch (event.type) {
    case 'phaseChanged':
      if (event.phase === 'night') return line(`第 ${event.day} 夜开始`, 'danger');
      if (event.phase === 'dusk') return line('黄昏：夜晚即将来临。把士兵摆到来袭方向，空闲的幸存者派进建筑', 'warn');
      return line(event.day === 1 ? '第 1 天' : `第 ${event.day} 天 · 天亮了`, 'info');
    case 'forecastReady': {
      // Dense fog hides the directions and a storm night has no attack: nothing to look at.
      const forecast = view.night.forecast;
      return forecast && forecast.directionsKnown && forecast.groups.length > 0 ? line('侦察报告：今夜的进攻方向见右上角，红色箭头指向来袭方向', 'warn') : null;
    }
    case 'underAttack':
      return event.core
        ? line('炉心遭到攻击！', 'danger', { x: event.x, y: event.y })
        : line(`${entityName(view, event.entityId)} 遭到攻击`, 'warn', { x: event.x, y: event.y });
    case 'died': {
      if (event.faction !== 'player') return null;
      const at = { x: event.x, y: event.y };
      if (event.kind === 'survivor') return line('一名幸存者遇难', 'danger', at);
      if (event.kind === 'soldier') return line(`${SOLDIERS[event.subtype as SoldierType].name} 阵亡`, 'danger', at);
      if (event.kind === 'building') return line(`${BUILDINGS[event.subtype as BuildingType].name} 被摧毁`, 'danger', at);
      return null;
    }
    case 'signalMessage':
      return line(event.text, 'info');
    case 'buildingPlaced':
      return null;
    case 'buildingCompleted':
      return line(`${BUILDINGS[event.building].name} 建造完成`, 'good', positionOf(view, event.buildingId));
    case 'unitTrained':
      return line(`${SOLDIERS[event.unit].name} 训练完成`, 'good', positionOf(view, event.unitId) ?? positionOf(view, event.buildingId));
    case 'survivorJoined':
      return event.source === 'growth' ? line('食物充足，一名新的幸存者诞生了', 'good', positionOf(view, event.unitId)) : null;
    case 'researchCompleted':
      return line(`研究完成：${TECHS[event.tech].name}`, 'good');
    case 'inspiration':
      return line(`灵感：${TECHS[event.tech].name} 研究进度 +${Math.round(INSPIRATION_BOOST * 100)}%`, 'good');
    case 'ruinExplored':
      return line(event.feedback ?? `探索遗迹：${ruinRewardText(event.reward)}`, 'good', tileCenter(view.map, event.tile));
    case 'hunger':
      return event.hungry ? line('食物不足：士兵今夜挨饿，战斗力下降', 'danger') : line('口粮充足，士兵吃饱了', 'good');
    case 'nestDiscovered':
      return line(
        event.isHive ? `发现了母巢。地图上每剩一个巢穴，母巢受到的伤害降低 ${formatPercent(HIVE_SHIELD.reductionPerNest)}。` : '发现了一个怪物巢穴',
        'warn',
        positionOf(view, event.nestId),
      );
    case 'nestLevelUp':
      return line(`巢穴成长到 ${event.level} 级`, 'warn', positionOf(view, event.nestId));
    case 'nestDestroyed': {
      if (event.isHive) return line('母巢被摧毁！', 'good');
      // The hive shield after this nest (count taken when it fell), then the reward.
      const shield = event.nestsLeft > 0
        ? `摧毁了一个巢穴，还剩 ${event.nestsLeft} 个，母巢减伤 ${formatPercent(hiveDamageReduction(event.nestsLeft))}。`
        : '巢穴已全部摧毁，母巢不再减伤。';
      const parts = [formatAmounts(event.reward)].filter((s) => s.length > 0).map((s) => `获得 ${s}`);
      if (event.survivors > 0) parts.push(`${event.survivors} 名幸存者加入`);
      return line(parts.length > 0 ? `${shield}${parts.join('，')}。` : shield, 'good');
    }
    case 'promotionReady':
      return line('有士兵升为老兵，可以选择强化', 'good', positionOf(view, event.unitId));
    case 'gameOver':
      if (event.status === 'lost') return line('炉心被摧毁，据点失守', 'danger');
      return line(event.reason === 'hiveDestroyed' ? '母巢被摧毁，获得胜利！' : event.reason === 'signal' ? '长明城的车队抵达，救援成功！' : `撑过了第 ${TOTAL_NIGHTS} 夜，据点守住了！`, 'good');
    case 'incidentResolved': {
      if (event.feedback) return line(event.feedback, 'info');
      // Target options have no feedback of their own: say where the objective is and how long it lasts.
      const target = view.incidents.targets.find((t) => t.incidentId === event.incidentId && t.status === 'active');
      return target ? line(`${target.title}：目标点已经标在地图上，${INCIDENT_TARGETS[target.kind].days} 天内到达`, 'warn', tileCenter(view.map, target.tile)) : null;
    }
    case 'incidentTargetResolved': return line(event.text, event.status === 'completed' ? 'good' : 'danger');
    case 'ruinFragment': return line(event.text, 'info');
    case 'incidentRaised': return null;
    case 'shot':
    case 'explosion':
      return null;
  }
}

/** Collapsed log: at most this many lines, each fully visible for FEED_HOLD_TICKS, then fading out over FEED_FADE_TICKS. */
export const FEED_LINES = 4;
export const FEED_HOLD_TICKS = 15 * TICKS_PER_SECOND;
export const FEED_FADE_TICKS = 5 * TICKS_PER_SECOND;
/** Expanded log: the last this many lines, none faded. */
export const HISTORY_LINES = 12;

export interface FeedLine<T> {
  entry: T;
  /** 0..1 */
  opacity: number;
}

/**
 * Lines to show, oldest first. Age is counted in game ticks, so a paused game keeps its lines
 * and nothing fades while the player reads.
 */
export function logFeed<T extends { tick: number }>(entries: readonly T[], nowTick: number, expanded: boolean): FeedLine<T>[] {
  if (expanded) return entries.slice(-HISTORY_LINES).map((entry) => ({ entry, opacity: 1 }));
  const lines: FeedLine<T>[] = [];
  for (const entry of entries.slice(-FEED_LINES)) {
    const fade = nowTick - entry.tick - FEED_HOLD_TICKS;
    if (fade >= FEED_FADE_TICKS) continue;
    lines.push({ entry, opacity: fade <= 0 ? 1 : 1 - fade / FEED_FADE_TICKS });
  }
  return lines;
}

/** Same shape as the session's log entries; a broadcast has no place to jump to. */
export interface BroadcastEntry {
  id: number;
  tick: number;
  text: string;
  tone: LogTone;
  at?: { x: number; y: number };
}

/** The dusk radio broadcast as a log entry, dated at the first tick of its dusk; ids are negative so they never meet the session's. */
export function broadcastEntry(view: GameView): BroadcastEntry | null {
  const b = view.night.broadcast;
  if (!b) return null;
  return { id: -b.night, tick: (b.night - 1) * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS, text: b.text, tone: 'info' };
}

/**
 * The log with the current broadcast right after the dusk line. The session stamps lines with the
 * tick at which it read the events, and a frame can run several ticks, so the dusk line may carry
 * a slightly later tick than the broadcast: the broadcast follows the first line stamped at or
 * after its dusk (the dusk line itself, which the same tick produced).
 */
export function withBroadcast<T extends { tick: number }>(entries: readonly T[], view: GameView): readonly (T | BroadcastEntry)[] {
  const b = broadcastEntry(view);
  if (!b) return entries;
  const dusk = entries.findIndex((e) => e.tick >= b.tick);
  return dusk < 0 ? [...entries, b] : [...entries.slice(0, dusk + 1), b, ...entries.slice(dusk + 1)];
}

export function alertFromEvent(event: GameEvent, tick: number): Alert | null {
  if (event.type !== 'underAttack') return null;
  return { x: event.x, y: event.y, tick, core: event.core };
}
