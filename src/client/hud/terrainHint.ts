/** The terrain under the cursor and what it is good for, so players learn where resources come from. */
import { FOG_UNEXPLORED, type GameView } from '../../sim';
import { TERRAIN, TERRAIN_LIST } from '../../sim/data/map';
import { SPECIAL_RUINS } from '../../sim/data/ruins';
import { RELAY } from '../../sim/data/signal';

export function terrainHint(view: GameView, x: number, y: number): string | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const { width, height, terrain } = view.map;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null;
  const i = ty * width + tx;
  if (view.fog[i] === FOG_UNEXPLORED) return null;

  // Check special ruins / ordinary ruins
  const ruin = view.map.ruins.find((r) => r.tile === i);
  if (ruin) {
    if (ruin.kind === 'supplyPod') {
      return `${SPECIAL_RUINS.supplyPod.name}：${SPECIAL_RUINS.supplyPod.description}`;
    }
    if (ruin.kind === 'warehouse') {
      return `${SPECIAL_RUINS.warehouse.name}：${SPECIAL_RUINS.warehouse.description}`;
    }
    return `遗迹：旧时代建筑的地基和碎块${ruin.explored ? '（已探索）' : '，派单位到达即可探索'}`;
  }

  // Check K-7 relay site
  const rs = view.map.relaySite;
  if (rs && tx >= rs.tileX && tx < rs.tileX + rs.size && ty >= rs.tileY && ty < rs.tileY + rs.size) {
    return `${RELAY.name}：${RELAY.description}`;
  }

  const t = TERRAIN_LIST[terrain[i] as number];
  if (!t) return null;
  return `${TERRAIN[t].name}：${TERRAIN[t].description}`;
}
