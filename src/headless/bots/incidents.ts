/** Select affordable outcomes while preserving a viable rescue squad and home guard. */
import { handBack, powerOf, raidPowerOf, raidTargets } from './army';
import { distance } from './view';
import { CYCLE_TICKS, DAY_TICKS, TICKS_PER_SECOND } from '../../sim/time';
import { validateCommand, type Command, type Game, type Soldier } from '../../sim';
import { tileCenter } from '../../sim/map/grid';
import type { Context, StrategyName } from './strategy';
function rescueCrew(soldiers: readonly Soldier[]): Soldier[] {
  const fighters = soldiers.filter(s => s.type !== 'scout').sort((a,b) => b.motion.speed-a.motion.speed || b.hp/b.maxHp-a.hp/a.maxHp || a.id-b.id);
  return fighters.slice(0, Math.min(3, Math.max(0, fighters.length - 3)));
}
export function chooseIncident(game: Game, strategy: StrategyName): Command | null {
  const p = game.state.incidents.pending;
  if (!p) return null;
  const soldiers = [...game.state.entities.values()].filter((e): e is Soldier => e.kind === 'soldier' && e.hp > 0);
  const canRescue = rescueCrew(soldiers).length === 3 && powerOf(rescueCrew(soldiers)) >= 2.7;
  const preferred: Record<string, string> = {
    caravan: 'decline',
    refugees: 'workers',
    rescue: canRescue ? 'rescue' : 'decline',
    raiders: soldiers.length >= 8 ? 'intimidate' : game.state.economy.resources.scrap >= 500 ? 'pay' : 'refuse',
    mechanic: strategy === 'fortress' ? 'towers' : 'repair',
    spores: 'medicine',
    nestSplit: 'mark',
    veteran: 'recruit',
    overheat: game.state.economy.resources.fuel >= 50 ? 'fuel' : 'power',
    northernSignal: strategy === 'signal' && !game.state.signal.discovered ? 'source' : 'numbers',
    tribe: 'intel',
    stormWarning: 'reinforce',
    surgeWarning: 'walls'
  };
  const choices = [...p.choices].sort((a, b) => Number(b.id === preferred[p.definitionId]) - Number(a.id === preferred[p.definitionId]));
  for (const choice of choices) {
    const cmd: Command = {
      type: 'resolveIncident',
      incidentId: p.id,
      choiceId: choice.id
    };
    if (validateCommand(game, cmd).ok) return cmd;
  }
  return null;
}
/** Missions keep a home guard and use the same power gate as ordinary nest raids. */
const INCIDENT_RAID = {
  fromDay: 2,
  homeGuard: 3,
  powerRatio: 1.5,
  hive: null
};
export function pursueIncident(ctx: Context): void {
  const {
    game,
    memory,
    snap,
    turn
  } = ctx;
  let mission = memory.incidentMission;
  if (mission) {
    const target = game.state.incidents.targets.find(t => t.id === mission!.targetId && t.status === 'active');
    const crew = snap.soldiers.filter(s => mission!.unitIds.includes(s.id));
    if (!crew.length) {
      memory.incidentMission = null;
      return;
    }
    const left = ctx.phase === 'night' ? 0 : (DAY_TICKS - game.state.tick % CYCLE_TICKS) / TICKS_PER_SECOND;
    const travel = Math.max(...crew.map(s => distance(s, ctx.core) / Math.max(s.motion.speed, 0.1)));
    if (!target || left <= Math.max(8, travel + 4)) {
      // The soldier AI walks the crew home and takes it into the night's defence.
      for (const s of crew) memory.roles.set(s.id, 'garrison');
      handBack(ctx, crew);
      memory.incidentMission = null;
      return;
    }
  } else {
    if (ctx.phase !== 'day' || snap.soldiers.length < 6) return;
    const target = game.state.incidents.targets.find(t => t.status === 'active' && !memory.incidentAttempts.has(t.id));
    if (!target) return;
    const available = snap.soldiers.filter(s => memory.roles.get(s.id) === 'garrison').sort((a, b) => b.motion.speed - a.motion.speed || a.id - b.id);
    const count = target.kind === 'nestSplit' ? Math.max(0, available.length - INCIDENT_RAID.homeGuard) : Math.min(3, Math.max(0, available.length - INCIDENT_RAID.homeGuard));
    const crew = target.kind === 'rescue' ? rescueCrew(available) : available.slice(0, count);
    if (target.kind === 'rescue' && (crew.length !== 3 || powerOf(crew) < 2.7)) return;
    if (!crew.length) return;
    if (target.kind === 'nestSplit' && !raidTargets(ctx, INCIDENT_RAID, raidPowerOf(crew)).some(n => n.id === target.nestId)) return;
    const point = tileCenter(game.state.map, target.tile);
    const left = (DAY_TICKS - game.state.tick % CYCLE_TICKS) / TICKS_PER_SECOND;
    const trip = Math.max(...crew.map(s => (distance(s, point) + distance(point, ctx.core)) / Math.max(s.motion.speed, 0.1)));
    if (left < trip + 8) return;
    memory.incidentAttempts.add(target.id);
    mission = {
      targetId: target.id,
      unitIds: crew.map(s => s.id)
    };
    memory.incidentMission = mission;
    for (const s of crew) memory.roles.set(s.id, 'incident');
  }
  const target = game.state.incidents.targets.find(t => t.id === mission!.targetId)!;
  const p = tileCenter(game.state.map, target.tile);
  const crew = snap.soldiers.filter(s => mission!.unitIds.includes(s.id));
  const ids = crew.filter(s => target.kind === 'nestSplit' ? s.order.type !== 'attackTarget' || s.order.targetId !== target.nestId : s.order.type !== 'attackMove' || s.order.x !== p.x || s.order.y !== p.y).map(s => s.id);
  if (!ids.length) return;
  const cmd: Command = target.kind === 'nestSplit' ? {
    type: 'attackTarget',
    unitIds: ids,
    targetId: target.nestId
  } : {
    type: 'attackMove',
    unitIds: ids,
    ...p
  };
  if (validateCommand(game, cmd).ok) turn.issue(cmd);
}
