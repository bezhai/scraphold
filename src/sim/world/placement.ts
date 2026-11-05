import { overlapsSplitReservation } from '../incidents/sites';
/**
 * Building placement geometry. Owner: Task 1.
 * Checks only the map: bounds, explored fog, other structures, terrain, units standing there.
 * Costs, unlocks and count limits are rules of the placeBuilding handler (Task 2), which calls this.
 */
import { reject, OK, type CommandResult, type RejectReason } from '../commands';
import { BUILDINGS, type BuildingType } from '../data/economy';
import type { Game } from '../game';
import { PASSABLE_BY_CODE, distanceToRect, forEachFootprintTile, terrainAt } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import { FOG_UNEXPLORED } from '../state';
import { isOnMap } from './spatial';

/** When several tiles fail, report the most important problem. */
const SEVERITY: Partial<Record<RejectReason, number>> = { unexplored: 3, occupied: 2, blockedTerrain: 1, wrongTerrain: 0 };

export function checkPlacement(game: Game, type: BuildingType, tileX: number, tileY: number): CommandResult {
  const def = BUILDINGS[type];
  if (type === 'signalTower' && (tileX !== game.state.signal.site?.tileX || tileY !== game.state.signal.site?.tileY)) return reject('wrongRelaySite');
  if (def.allowedTerrain.length === 0) return reject('notPlaceable');
  const { map, fog } = game.state;
  if (tileX < 0 || tileY < 0 || tileX + def.size > map.width || tileY + def.size > map.height) return reject('outOfBounds');
  if (overlapsSplitReservation(game.state, tileX, tileY, def.size)) return reject('incidentReserved');
  const nav = ensureNav(game);
  let problem: RejectReason | null = null;
  forEachFootprintTile(map, tileX, tileY, def.size, (i) => {
    let r: RejectReason | null = null;
    if (fog[i] === FOG_UNEXPLORED) r = 'unexplored';
    else if (nav.structureAt[i] !== 0) r = 'occupied';
    else if (type !== 'signalTower' && map.relaySite && i % map.width >= map.relaySite.tileX && i % map.width < map.relaySite.tileX + map.relaySite.size &&
      Math.floor(i / map.width) >= map.relaySite.tileY && Math.floor(i / map.width) < map.relaySite.tileY + map.relaySite.size) r = 'occupied';
    else if (!PASSABLE_BY_CODE[map.terrain[i] as number]) r = 'blockedTerrain';
    else if (!def.allowedTerrain.includes(terrainAt(map, i))) r = 'wrongTerrain';
    if (r !== null && (problem === null || (SEVERITY[r] as number) > (SEVERITY[problem] as number))) problem = r;
  });
  if (problem !== null) return reject(problem);
  for (const e of game.state.entities.values()) {
    if ((e.kind === 'survivor' || e.kind === 'soldier' || e.kind === 'mutant') && isOnMap(e)) {
      if (distanceToRect(tileX, tileY, def.size, e.x, e.y) < e.radius) return reject('unitsInTheWay');
    }
  }
  return OK;
}
