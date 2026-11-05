/**
 * New game assembly: map from the seed, core and nests, starting survivors and resources, origin
 * start bonuses, initial fog. Owner: Task 1.
 */
import { housingCapacity } from '../economy/population';
import { BUILDINGS, ORIGINS, RESOURCES, START, type BuildingType } from '../data/economy';
import { assembleGame, refreshModifiers, type Game } from '../game';
import { forEachRingTile, terrainAt } from '../map/grid';
import { generateMap, type NestSite } from '../map/mapgen';
import type { Building, GameOptions } from '../state';
import { addBuilding, addNest, openTilesAround, spawnSoldier, spawnSurvivor } from './entities';
import { revealCircle, updateFog } from './fog';
import { checkPlacement } from './placement';

/** Places the core at map.coreTile and a level-1 nest (or the hive) at every site. */
export function placeCoreAndNests(game: Game, nests: readonly NestSite[]): void {
  const { coreTile } = game.state.map;
  game.state.coreId = addBuilding(game, 'core', coreTile.x, coreTile.y, { complete: true }).id;
  for (const n of nests) addNest(game, n.tileX, n.tileY, n.isHive);
}

/** Origin start building site within 12 tiles of the core, one tile clear of it; best terrain bonus first. */
function findStartSite(game: Game, type: BuildingType): { x: number; y: number } | null {
  const def = BUILDINGS[type];
  const core = game.state.map.coreTile;
  const cx = core.x + 1.5;
  const cy = core.y + 1.5;
  let best: { x: number; y: number; score: number; d: number } | null = null;
  for (let ty = core.y - 12; ty <= core.y + 12; ty++) {
    for (let tx = core.x - 12; tx <= core.x + 12; tx++) {
      const clearOfCore = tx + def.size <= core.x - 1 || tx >= core.x + 4 || ty + def.size <= core.y - 1 || ty >= core.y + 4;
      if (!clearOfCore || !checkPlacement(game, type, tx, ty).ok) continue;
      let score = 0;
      for (const bonus of def.bonuses) {
        if (bonus.kind !== 'adjacentTerrain') continue;
        let n = 0;
        forEachRingTile(game.state.map, tx, ty, def.size, (i) => {
          if (terrainAt(game.state.map, i) === bonus.terrain) n++;
        });
        score += Math.min(n, bonus.maxTiles);
      }
      const dx = tx + def.size / 2 - cx;
      const dy = ty + def.size / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d > 144) continue;
      if (!best || score > best.score || (score === best.score && d < best.d)) best = { x: tx, y: ty, score, d };
    }
  }
  return best;
}

export function createGame(options: GameOptions): Game {
  const { map, nests } = generateMap(options.seed);
  const game = assembleGame(options, map);
  placeCoreAndNests(game, nests);
  const origin = ORIGINS[options.origin];
  const resources = game.state.economy.resources;
  for (const r of RESOURCES) resources[r] += origin.start.extraResources[r] ?? 0;
  if (origin.start.revealRuins) {
    for (const ruin of map.ruins) revealCircle(game, (ruin.tile % map.width) + 0.5, Math.floor(ruin.tile / map.width) + 0.5, 0.5);
  }
  updateFog(game);
  for (const type of origin.start.buildings) {
    const site = findStartSite(game, type);
    if (site) addBuilding(game, type, site.x, site.y, { complete: true });
  }
  const core = game.state.entities.get(game.state.coreId) as Building;
  const soldiers = origin.start.soldiers.flatMap((s) => Array.from({ length: s.count }, () => s.type));
  const survivors = START.survivors + origin.start.extraSurvivors;
  const tiles = openTilesAround(game, core, survivors + soldiers.length);
  const at = (k: number) => {
    const t = tiles[k] ?? tiles[0] ?? 0;
    return { x: (t % map.width) + 0.5, y: Math.floor(t / map.width) + 0.5 };
  };
  for (let k = 0; k < survivors; k++) spawnSurvivor(game, at(k).x, at(k).y);
  soldiers.forEach((type, k) => spawnSoldier(game, type, at(survivors + k).x, at(survivors + k).y));
  updateFog(game);
  refreshModifiers(game);
  game.state.economy.housingCap = housingCapacity(game);
  return game;
}
