/**
 * Unit order commands and rally points. Owner: Task 1.
 * These set Soldier.order / Survivor.task and the movement intent. What soldiers do with their
 * order while moving or standing (engaging on attack-move, chasing a focus target, holding) is
 * Task 3's soldier system. Every order puts the commanded units under player control; stop hands
 * them back to automatic control (world/control.ts hands back the orders that end on their own).
 * Survivors working inside a building can be commanded too (the client selects units on the map;
 * its panel buttons and the bots name workers); a move or a stop takes them out first.
 */
import { OK, reject, type CommandHandler } from '../commands';
import { trainsSoldiers } from '../data/combat';
import { idleTask } from '../economy/model';
import type { Game } from '../game';
import { isIsolated } from '../incidents/model';
import { forEachFootprintTile, tileAtPoint } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import { FOG_VISIBLE, type Entity, type EntityId, type Soldier, type Survivor } from '../state';
import { exitBuilding } from './entities';
import { moveUnitTo, stopUnit } from './movement';

type PlayerUnit = Soldier | Survivor;

/**
 * Living player units among `ids`, without duplicates, in the given order: on the map, or survivors
 * working inside a building. Survivors isolated by an incident take no commands.
 */
export function ownUnits(game: Game, ids: readonly EntityId[]): PlayerUnit[] {
  const out: PlayerUnit[] = [];
  const seen = new Set<EntityId>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = game.state.entities.get(id);
    if (!e || (e.kind !== 'soldier' && e.kind !== 'survivor') || e.hp <= 0) continue;
    if (e.kind === 'survivor' && isIsolated(game.state.incidents, e.id)) continue;
    out.push(e);
  }
  return out;
}

/** A survivor sent elsewhere or stopped leaves the building it works in. */
function leaveWork(game: Game, u: PlayerUnit): void {
  if (u.kind === 'survivor' && u.insideId !== 0) exitBuilding(game, u);
}

function soldiersOf(units: readonly PlayerUnit[]): Soldier[] {
  return units.filter((u): u is Soldier => u.kind === 'soldier');
}

function inMap(game: Game, x: number, y: number): boolean {
  return tileAtPoint(game.state.map, x, y) !== -1;
}

const FORMATION_SPACING = 0.75;

/** Open points around (x, y) for a group, nearest first; the point itself first if open. */
export function formationSlots(game: Game, x: number, y: number, count: number): { x: number; y: number }[] {
  if (count === 1) return [{ x, y }];
  const nav = ensureNav(game);
  const candidates: { x: number; y: number; d: number; k: number }[] = [];
  const rings = Math.ceil(Math.sqrt(count)) + 4;
  let k = 0;
  for (let j = -rings; j <= rings; j++) {
    for (let i = -rings; i <= rings; i++) {
      const px = x + i * FORMATION_SPACING;
      const py = y + j * FORMATION_SPACING;
      const t = tileAtPoint(nav, px, py);
      if (t === -1 || nav.blocked[t]) continue;
      candidates.push({ x: px, y: py, d: i * i + j * j, k: k++ });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.k - b.k);
  const slots = candidates.slice(0, count).map(({ x: px, y: py }) => ({ x: px, y: py }));
  while (slots.length < count) slots.push({ x, y });
  return slots;
}

/** Moves a group so each unit gets its own goal near (x, y); nearer units take the inner slots. */
export function sendGroup(game: Game, units: readonly PlayerUnit[], x: number, y: number): void {
  const slots = formationSlots(game, x, y, units.length);
  const byDistance = [...units].sort((a, b) => {
    const da = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
    const db = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
    return da - db || a.id - b.id;
  });
  byDistance.forEach((u, i) => {
    const slot = slots[i] as { x: number; y: number };
    moveUnitTo(game, u, slot.x, slot.y);
  });
}

function validateGroupMove(game: Game, unitIds: readonly EntityId[], x: number, y: number) {
  if (ownUnits(game, unitIds).length === 0) return reject('noValidUnits');
  if (!inMap(game, x, y)) return reject('outOfBounds');
  return OK;
}

export const moveHandler: CommandHandler<'move'> = {
  validate: (game, cmd) => validateGroupMove(game, cmd.unitIds, cmd.x, cmd.y),
  execute(game, cmd) {
    const units = ownUnits(game, cmd.unitIds);
    for (const u of units) {
      u.control = 'player';
      leaveWork(game, u);
      if (u.kind === 'soldier') u.deploymentGoal = null;
      if (u.kind === 'soldier') u.order = { type: 'move', x: cmd.x, y: cmd.y };
      else u.task = idleTask();
    }
    sendGroup(game, units, cmd.x, cmd.y);
  },
};

export const attackMoveHandler: CommandHandler<'attackMove'> = {
  validate: (game, cmd) => validateGroupMove(game, cmd.unitIds, cmd.x, cmd.y),
  execute(game, cmd) {
    const units = ownUnits(game, cmd.unitIds);
    for (const u of units) {
      u.control = 'player';
      leaveWork(game, u);
      if (u.kind === 'soldier') u.deploymentGoal = null;
      if (u.kind === 'soldier') u.order = { type: 'attackMove', x: cmd.x, y: cmd.y };
      else u.task = idleTask();
    }
    sendGroup(game, units, cmd.x, cmd.y);
  },
};

/** A hostile target the player can currently see (mutants) or has discovered (nests). */
function targetVisible(game: Game, target: Entity): boolean {
  const { fog, map } = game.state;
  if (target.kind === 'nest') {
    let visible = target.discovered;
    forEachFootprintTile(map, target.tileX, target.tileY, target.size, (i) => {
      if (fog[i] === FOG_VISIBLE) visible = true;
    });
    return visible;
  }
  const t = tileAtPoint(map, target.x, target.y);
  return t !== -1 && fog[t] === FOG_VISIBLE;
}

export const attackTargetHandler: CommandHandler<'attackTarget'> = {
  validate(game, cmd) {
    if (soldiersOf(ownUnits(game, cmd.unitIds)).length === 0) return reject('noValidUnits');
    const target = game.state.entities.get(cmd.targetId);
    if (!target || target.hp <= 0) return reject('unknownTarget');
    if (target.faction !== 'mutant') return reject('invalidTarget');
    if (!targetVisible(game, target)) return reject('targetNotVisible');
    return OK;
  },
  execute(game, cmd) {
    const target = game.state.entities.get(cmd.targetId) as Entity;
    for (const s of soldiersOf(ownUnits(game, cmd.unitIds))) {
      s.control = 'player';
      s.deploymentGoal = null;
      s.order = { type: 'attackTarget', targetId: cmd.targetId };
      moveUnitTo(game, s, target.x, target.y);
    }
  },
};

export const stopHandler: CommandHandler<'stop'> = {
  validate: (game, cmd) => (ownUnits(game, cmd.unitIds).length === 0 ? reject('noValidUnits') : OK),
  execute(game, cmd) {
    for (const u of ownUnits(game, cmd.unitIds)) {
      u.control = 'auto';
      leaveWork(game, u);
      if (u.kind === 'soldier') u.deploymentGoal = null;
      if (u.kind === 'soldier') u.order = { type: 'idle' };
      else u.task = idleTask();
      stopUnit(u);
    }
  },
};

export const holdHandler: CommandHandler<'hold'> = {
  validate: (game, cmd) => (soldiersOf(ownUnits(game, cmd.unitIds)).length === 0 ? reject('noValidUnits') : OK),
  execute(game, cmd) {
    for (const s of soldiersOf(ownUnits(game, cmd.unitIds))) {
      s.control = 'player';
      s.deploymentGoal = null;
      s.order = { type: 'hold' };
      stopUnit(s);
    }
  },
};

export const setRallyHandler: CommandHandler<'setRally'> = {
  validate(game, cmd) {
    const b = game.state.entities.get(cmd.buildingId);
    if (!b || b.kind !== 'building') return reject('unknownTarget');
    if (!trainsSoldiers(b.type)) return reject('notMilitary');
    if (!inMap(game, cmd.x, cmd.y)) return reject('outOfBounds');
    return OK;
  },
  execute(game, cmd) {
    const b = game.state.entities.get(cmd.buildingId);
    if (b && b.kind === 'building') b.rally = { x: cmd.x, y: cmd.y };
  },
};
