/**
 * What the map points out besides tonight's threat: the accepted incident targets (status
 * active) with the game time left, the target of the incident card still waiting for a decision,
 * the K-7 relay once discovered with its stage, and the hive once known. The renderer pins these
 * on the map or to the screen edge (overlays.ts), the minimap marks the incident targets.
 */
import { INCIDENT_RULES, RELAY, SIGNAL_STAGE_NAMES, TICKS_PER_SECOND, type GameView } from '../../sim';
import { tileCenter } from '../../sim/map/grid';
import { formatClock } from '../hud/format';
import { findHive } from '../hud/objectives';
import { isNestKnown } from '../view';

/** target: accepted and running; pendingTarget: on the card, not decided yet. */
export type ObjectiveKind = 'target' | 'pendingTarget' | 'relay' | 'hive';

export interface ObjectiveMarker {
  kind: ObjectiveKind;
  /** World point the marker names. */
  x: number;
  y: number;
  /**
   * Tiles from the point to the edge of what the marker names: the arrival reach of a rescue,
   * the nest of a split or the hive with its overhang, half the relay footprint. On screen the marker stays
   * outside it, so it never covers the structure.
   */
  reach: number;
  label: string;
}

/** Game time left on an accepted target, "m:ss", from `max(0, expiresTick - tick)` ticks. */
export function targetTimeLeft(expiresTick: number, tick: number): string {
  return formatClock(Math.max(0, expiresTick - tick) / TICKS_PER_SECOND);
}

/** Tiles a nest's drawn body (tendrils, spikes) reaches past its footprint. */
const NEST_OVERHANG = 0.3;

/** How far a target's marker keeps out: the rescue arrival reach, or around the nest that splits. */
function targetReach(view: GameView, kind: 'rescue' | 'nestSplit', nestId: number): number {
  const nest = kind === 'nestSplit' ? view.entities.get(nestId) : undefined;
  return nest && nest.kind === 'nest' ? nest.size / 2 + NEST_OVERHANG : INCIDENT_RULES.targetReach;
}

export function objectiveMarkers(view: GameView): ObjectiveMarker[] {
  const out: ObjectiveMarker[] = [];
  for (const t of view.incidents.targets) {
    if (t.status !== 'active') continue;
    const p = tileCenter(view.map, t.tile);
    out.push({ kind: 'target', x: p.x, y: p.y, reach: targetReach(view, t.kind, t.nestId), label: `${t.title} · 剩 ${targetTimeLeft(t.expiresTick, view.tick)}` });
  }
  const pending = view.incidents.pending;
  if (pending?.target) {
    const p = tileCenter(view.map, pending.target.tile);
    out.push({ kind: 'pendingTarget', x: p.x, y: p.y, reach: targetReach(view, pending.target.kind, pending.target.nestId), label: `${pending.title}（未决定）` });
  }
  const site = view.signal.site;
  if (view.signal.discovered && site) {
    out.push({ kind: 'relay', x: site.tileX + site.size / 2, y: site.tileY + site.size / 2, reach: site.size / 2, label: `${RELAY.name} · ${SIGNAL_STAGE_NAMES[view.signal.stage]}` });
  }
  const hive = findHive(view);
  if (hive && isNestKnown(view, hive)) out.push({ kind: 'hive', x: hive.x, y: hive.y, reach: hive.size / 2 + NEST_OVERHANG, label: '母巢' });
  return out;
}
