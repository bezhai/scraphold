/**
 * Where tonight's threat is, for the markers the renderer pins to the screen edge. At dusk: the
 * spawn point of every forecast direction (where the attack will come from). At night: the
 * attackers themselves, grouped by compass sector around the core (the forecast's sectors), so a
 * marker always points at where the enemies are now, not where they started. On a dense-fog night
 * only the attackers the player can see right now are counted, so the markers give away nothing
 * the fog hides.
 */
import { compassDirection, nightType, type GameView } from '../../sim';
import { DIRECTIONS, DIRECTION_NAMES, type Direction } from '../../sim/data/map';
import { isTileVisible } from '../view';
import { forecastView } from './dayClock';

export interface ThreatMarker {
  /** forecast: where a group will appear tonight; live: attackers on their way or at the base. */
  kind: 'forecast' | 'live';
  /** World point the marker points at. */
  x: number;
  y: number;
  label: string;
}

function forecastMarkers(view: GameView): ThreatMarker[] {
  const f = forecastView(view);
  if (!f || !f.directionsKnown) return [];
  const out: ThreatMarker[] = [];
  for (const g of f.groups) {
    const sp = view.map.spawnPoints.find((p) => p.direction === g.direction);
    if (!sp) continue;
    out.push({ kind: 'forecast', x: (sp.tile % view.map.width) + 0.5, y: Math.floor(sp.tile / view.map.width) + 0.5, label: `${g.directionName} · ${g.sizeName}${g.boss ? ' · 首领' : ''}` });
  }
  return out;
}

function liveMarkers(view: GameView): ThreatMarker[] {
  const core = view.entities.get(view.coreId);
  if (!core) return [];
  const seenOnly = nightType(view) === 'denseFog';
  const sectors = new Map<Direction, { x: number; y: number; n: number; boss: boolean }>();
  for (const e of view.entities.values()) {
    if (e.kind !== 'mutant' || e.hp <= 0 || e.ai.mode !== 'assault') continue;
    if (seenOnly && !isTileVisible(view, e.x, e.y)) continue;
    const d = compassDirection(e.x - core.x, e.y - core.y);
    const s = sectors.get(d) ?? { x: 0, y: 0, n: 0, boss: false };
    s.x += e.x;
    s.y += e.y;
    s.n++;
    s.boss ||= e.ai.boss;
    sectors.set(d, s);
  }
  return DIRECTIONS.filter((d) => sectors.has(d)).map((d) => {
    const s = sectors.get(d) as { x: number; y: number; n: number; boss: boolean };
    return { kind: 'live', x: s.x / s.n, y: s.y / s.n, label: `${DIRECTION_NAMES[d]} · ${s.n} 只${s.boss ? ' · 首领' : ''}` };
  });
}

export function threatMarkers(view: GameView): ThreatMarker[] {
  const phase = view.clock.phase;
  if (phase === 'dusk') return forecastMarkers(view);
  if (phase === 'night') return liveMarkers(view);
  return [];
}
