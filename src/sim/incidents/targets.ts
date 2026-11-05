import { guardSpawnTiles } from './sites';
import { MUTANT_TYPES } from '../data/combat';
import { INCIDENT_RULES, INCIDENT_TARGETS } from '../data/incidents';
import { emit } from '../events';
import type { Game } from '../game';
import { tileCenter } from '../map/grid';
import { CYCLE_TICKS } from '../time';
import { addNest, openTilesAround, removeEntity, spawnMutant } from '../world/entities';
import { revealCircle } from '../world/fog';
import { isOnMap } from '../world/spatial';
import { stopUnit } from '../world/movement';
import { applyIncidentEffect } from './effects';
import type { PendingIncident, IncidentTarget } from './model';
export function activateTarget(game: Game, pending: PendingIncident): void {
  const prepared = pending.target;
  if (!prepared) throw new Error('Missing prepared incident target');
  const def = INCIDENT_TARGETS[prepared.kind];
  const {
    state
  } = game;
  const target: IncidentTarget = {
    ...prepared,
    id: state.incidents.nextId++,
    incidentId: pending.id,
    title: def.title,
    createdTick: state.tick,
    expiresTick: state.tick + def.days * CYCLE_TICKS,
    status: 'active',
    guardIds: []
  };
  state.incidents.targets.push(target);
  const point = tileCenter(state.map, target.tile);
  revealCircle(game, point.x, point.y, INCIDENT_RULES.targetRevealRadius);
  const sites = guardSpawnTiles(game, target);
  let i = 0;
  for (const type of MUTANT_TYPES) for (let n = 0; n < (def.guards[type] ?? 0); n++) {
    const p = tileCenter(state.map, sites[i++ % sites.length] ?? target.tile);
    const m = spawnMutant(game, type, p.x, p.y, {
      mode: 'guard',
      guardPoint: point
    });
    target.guardIds.push(m.id);
  }
}
function split(game: Game, target: IncidentTarget): void {
  const tile = target.splitTile;
  const w = game.state.map.width;
  const nest = addNest(game, tile % w, Math.floor(tile / w), false);
  nest.growth.level = INCIDENT_RULES.splitLevel;
  // Reserved land cannot receive buildings; move transient occupants onto the new nest's open ring.
  const open = openTilesAround(game, nest, 1)[0];
  if (open !== undefined) for (const e of game.state.entities.values()) if ((e.kind === 'soldier' || e.kind === 'survivor' || e.kind === 'mutant') && isOnMap(e) && e.x >= nest.tileX && e.x < nest.tileX + nest.size && e.y >= nest.tileY && e.y < nest.tileY + nest.size) {
    const p = tileCenter(game.state.map, open);
    e.x = p.x;
    e.y = p.y;
    stopUnit(e);
  }
  revealCircle(game, nest.x, nest.y, nest.radius);
}
export function updateTargets(game: Game): void {
  const {
    state
  } = game;
  for (const target of state.incidents.targets) {
    if (target.status !== 'active') continue;
    const def = INCIDENT_TARGETS[target.kind];
    const point = tileCenter(state.map, target.tile);
    const parent = state.entities.get(target.nestId);
    const completed = target.kind === 'nestSplit' ? !parent || parent.hp <= 0 : [...state.entities.values()].some(e => e.kind === 'soldier' && isOnMap(e) && Math.sqrt((e.x - point.x) * (e.x - point.x) + (e.y - point.y) * (e.y - point.y)) - e.radius <= INCIDENT_RULES.targetReach);
    if (state.tick < target.expiresTick && !completed) continue;
    target.status = state.tick >= target.expiresTick ? 'expired' : 'completed';
    if (target.status === 'completed') for (const effect of def.rewards) {
      if (effect.kind === 'target') throw new Error('Recursive target reward');
      applyIncidentEffect(game, effect, target.incidentId, point);
    } else if (target.kind === 'nestSplit') split(game, target);
    for (const id of target.guardIds) {
      const guard = state.entities.get(id);
      if (guard) removeEntity(game, guard);
    }
    emit(game, {
      type: 'incidentTargetResolved',
      targetId: target.id,
      status: target.status,
      text: target.status === 'completed' ? def.completeText : def.expireText
    });
  }
}
