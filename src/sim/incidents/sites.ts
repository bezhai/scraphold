/** Reachable incident sites; no RNG is consumed when checking eligibility. */
import { compassDirection } from '../combat/night';
import { INCIDENT_RULES, INCIDENT_TARGETS, type IncidentTargetKind } from '../data/incidents';
import type { Game } from '../game';
import { distanceToRect, forEachRingTile, tileCenter, terrainAt } from '../map/grid';
import { ensureNav } from '../nav/navGrid';
import { type GameState, type Point } from '../state';
import { DIRECTION_NAMES } from '../data/map';
import { isRemote } from '../world/remote';
import type { PreparedTarget } from './model';
export function incidentDirection(game: Game, point: Point): string {
  const core = game.state.entities.get(game.state.coreId)!;
  return DIRECTION_NAMES[compassDirection(point.x - core.x, point.y - core.y)];
}
export function reservedSplitTiles(state: GameState): number[] {
  return [...state.incidents.targets.filter(t => t.status === 'active').map(t => t.splitTile), state.incidents.pending?.target?.splitTile ?? -1].filter(t => t >= 0);
}
export function overlapsSplitReservation(state: GameState, x: number, y: number, size: number): boolean {
  return reservedSplitTiles(state).some(tile => {
    const tx = tile % state.map.width;
    const ty = Math.floor(tile / state.map.width);
    return x < tx + 2 && x + size > tx && y < ty + 2 && y + size > ty;
  });
}
function reachableTiles(game: Game): number[] {
  const nav = ensureNav(game);
  const seen = new Uint8Array(nav.blocked.length);
  const queue: number[] = [];
  const c = game.state.map.coreTile;
  forEachRingTile(nav, c.x, c.y, 3, tile => {
    if (!nav.blocked[tile] && !seen[tile]) {
      queue.push(tile);
      seen[tile] = 1;
    }
  });
  for (let k = 0; k < queue.length; k++) {
    const tile = queue[k]!;
    const x = tile % nav.width;
    const y = Math.floor(tile / nav.width);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx!;
      const ny = y + dy!;
      const next = ny * nav.width + nx;
      if (nx < 0 || ny < 0 || nx >= nav.width || ny >= nav.height || seen[next] || nav.blocked[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return queue.sort((a, b) => a - b);
}
function availableNestFootprint(game: Game, tile: number): boolean {
  const {
    map
  } = game.state;
  const nav = ensureNav(game);
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  if (x + 2 > map.width || y + 2 > map.height || overlapsSplitReservation(game.state, x, y, 2)) return false;
  const relay = map.relaySite;
  if (relay && x < relay.tileX + relay.size && x + 2 > relay.tileX && y < relay.tileY + relay.size && y + 2 > relay.tileY) return false;
  for (const i of [tile, tile + 1, tile + map.width, tile + map.width + 1]) if (nav.blocked[i] || terrainAt(map, i) === 'ruin') return false;
  return true;
}
export function targetCandidates(game: Game, kind: IncidentTargetKind): PreparedTarget[] {
  const {
    state
  } = game;
  const core = state.entities.get(state.coreId)!;
  const nests = [...state.entities.values()].filter(e => e.kind === 'nest' && e.hp > 0 && (kind !== 'nestSplit' || !e.isHive));
  const active = state.incidents.targets.filter(t => t.status === 'active');
  const blank = {
    nestId: 0,
    splitTile: -1
  };
  const reachable = reachableTiles(game);
  if (kind === 'nestSplit') {
    const out: PreparedTarget[] = [];
    for (const n of nests) {
      if (active.some(t => t.nestId === n.id)) continue;
      const tiles = reachable.filter(tile => {
        const p = tileCenter(state.map, tile);
        return Math.abs(p.x - n.x) <= INCIDENT_RULES.splitRadius && Math.abs(p.y - n.y) <= INCIDENT_RULES.splitRadius && availableNestFootprint(game, tile);
      }).sort((a, b) => {
        const p = tileCenter(state.map, a);
        const q = tileCenter(state.map, b);
        return (p.x - n.x) * (p.x - n.x) + (p.y - n.y) * (p.y - n.y) - (q.x - n.x) * (q.x - n.x) - (q.y - n.y) * (q.y - n.y) || a - b;
      });
      if (tiles[0] !== undefined) out.push({
        ...blank,
        kind,
        nestId: n.id,
        tile: Math.floor(n.y) * state.map.width + Math.floor(n.x),
        splitTile: tiles[0]
      });
    }
    return out;
  }
  const tiles = reachable.filter(tile => {
    const p = tileCenter(state.map, tile);
    const dx = p.x - core.x;
    const dy = p.y - core.y;
    const d = dx * dx + dy * dy;
    if (terrainAt(state.map, tile) !== 'wasteland' || active.some(t => t.tile === tile)) return false;
    return isRemote(state, p) && d <= INCIDENT_RULES.rescueMaxDistance * INCIDENT_RULES.rescueMaxDistance;
  });
  const nearNest = tiles.filter(tile => {
    const p = tileCenter(state.map, tile);
    return nests.some(n => n.kind === 'nest' && distanceToRect(n.tileX, n.tileY, n.size, p.x, p.y) <= INCIDENT_RULES.rescueNestDistance);
  });
  return (nearNest.length ? nearNest : tiles).map(tile => ({
    ...blank,
    kind,
    tile
  })).filter(target => hasGuardSpawnSites(game, target));
}
/** Rescue guards occupy passable tiles around their target. */
export function guardSpawnTiles(game: Game, target: PreparedTarget): number[] {
  const {
    state
  } = game;
  const point = tileCenter(state.map, target.tile);
  const distance = (a: Point, b: Point) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
  const nav = ensureNav(game);
  const radius = INCIDENT_RULES.rescueGuardDistance;
  const sites: number[] = [];
  for (let y = Math.max(0, Math.floor(point.y) - radius); y < Math.min(nav.height, point.y + radius); y++) {
    for (let x = Math.max(0, Math.floor(point.x) - radius); x < Math.min(nav.width, point.x + radius); x++) {
      const tile = y * nav.width + x;
      if (nav.blocked[tile]) continue;
      sites.push(tile);
    }
  }
  return sites.sort((a, b) => distance(tileCenter(state.map, b), point) - distance(tileCenter(state.map, a), point) || a - b);
}
export function hasGuardSpawnSites(game: Game, target: PreparedTarget): boolean {
  const count = Object.values(INCIDENT_TARGETS[target.kind].guards).reduce((sum, n) => sum + n, 0);
  return count === 0 || guardSpawnTiles(game, target).length >= count;
}
