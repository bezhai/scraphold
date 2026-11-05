/**
 * Debug scenarios on a real game: an army of soldiers around the core and a horde of assaulting
 * mutants closing in. The entities come from the world factories and are then run by the normal
 * systems, so a scenario exercises the full simulation (targeting, movement, combat). Used by the
 * performance end-to-end test through the client's ?debug hook; not part of normal play, not
 * exported from index.ts. Owner: main session (Task 6).
 */
import type { MutantType, SoldierType } from './data/combat';
import type { Game } from './game';
import { ensureNav } from './nav/navGrid';
import type { Mutant, Soldier } from './state';
import { spawnMutant, spawnSoldier } from './world/entities';
import { followFlowField } from './world/movement';

/** Soldier types handed out in turn, roughly a mixed late-game army. */
const ARMY_CYCLE: readonly SoldierType[] = ['shieldGuard', 'rifleman', 'rifleman', 'grenadier', 'shieldGuard', 'rifleman', 'sniper', 'flamethrower', 'rifleman', 'pickup', 'scout'];
/** Mutant types handed out in turn, roughly a late night. */
const HORDE_CYCLE: readonly MutantType[] = ['wanderer', 'runner', 'wanderer', 'runner', 'crawler', 'wanderer', 'spitter', 'runner', 'boomer', 'wanderer'];

/** Free tiles (passable, no structure) whose centers lie between `inner` and `outer` tiles from the core, nearest first. */
function ringTiles(game: Game, inner: number, outer: number): number[] {
  const { state } = game;
  const nav = ensureNav(game);
  const core = state.entities.get(state.coreId);
  const cx = core ? core.x : state.map.width / 2;
  const cy = core ? core.y : state.map.height / 2;
  const tiles: { i: number; d: number }[] = [];
  for (let i = 0; i < nav.blocked.length; i++) {
    if (nav.blocked[i] !== 0) continue;
    const dx = (i % state.map.width) + 0.5 - cx;
    const dy = Math.floor(i / state.map.width) + 0.5 - cy;
    const d = dx * dx + dy * dy;
    if (d >= inner * inner && d <= outer * outer) tiles.push({ i, d });
  }
  return tiles.sort((a, b) => a.d - b.d || a.i - b.i).map((t) => t.i);
}

function tileCenterOf(game: Game, tile: number): { x: number; y: number } {
  const w = game.state.map.width;
  return { x: (tile % w) + 0.5, y: Math.floor(tile / w) + 0.5 };
}

/** `count` idle soldiers of mixed types on free tiles 3 to 9 tiles from the core, one per tile. */
export function deployArmy(game: Game, count: number): Soldier[] {
  return ringTiles(game, 3, 9)
    .slice(0, count)
    .map((tile, k) => {
      const p = tileCenterOf(game, tile);
      return spawnSoldier(game, ARMY_CYCLE[k % ARMY_CYCLE.length] as SoldierType, p.x, p.y);
    });
}

export interface HordeOptions {
  /** Max hp multiplier, so the horde lasts while it is measured. */
  hpPct: number;
  /** Added to the damage multiplier (MutantAi.damagePct), e.g. -0.8 so the army lasts too. */
  damagePct: number;
}

/**
 * `count` assaulting mutants of mixed types on free tiles 12 to 22 tiles from the core, spread
 * evenly over the ring, already following the flow field toward the core.
 */
export function releaseHorde(game: Game, count: number, opts: HordeOptions): Mutant[] {
  const tiles = ringTiles(game, 12, 22);
  const out: Mutant[] = [];
  if (tiles.length === 0) return out;
  for (let k = 0; k < count; k++) {
    const tile = tiles[Math.floor((k * tiles.length) / count) % tiles.length] as number;
    const p = tileCenterOf(game, tile);
    const m = spawnMutant(game, HORDE_CYCLE[k % HORDE_CYCLE.length] as MutantType, p.x, p.y, { mode: 'assault', hpPct: opts.hpPct });
    m.ai.damagePct = opts.damagePct;
    followFlowField(m);
    out.push(m);
  }
  return out;
}
