/**
 * One bot decision (Task 5, v3 Task 4): the commands it issues and a local copy of what they use up.
 *
 * The runner applies a controller's commands in order after it returns, so a bot cannot watch its
 * own commands take effect within the decision. Turn keeps the bookkeeping instead: resources are
 * charged as commands are issued, and the survivors under automatic control are handed out one by
 * one. Those are the only survivors a bot names: the survivor AI keeps them busy (working, helping
 * a site, repairing), so an errand (a ruin visit) takes the nearest one, idle ones first, and the
 * command pulls it off its job. Training takes whichever automatic survivor is nearest to the
 * barracks (sim nearestAutoSurvivor), so the bot only counts recruits, and training commands go
 * last, after every command that names a survivor.
 */
import { buildingCost, trainingCost, type Building, type Command, type Game, type Survivor } from '../../sim';
import type { SoldierType } from '../../sim/data/combat';
import { RESOURCES, type BuildingType, type Resource, type ResourceAmounts } from '../../sim/data/economy';
import type { Snapshot } from './view';

export class Turn {
  readonly resources: Record<Resource, number>;
  /** Survivors under automatic control not named or promised to training yet in this decision. */
  private readonly free: Survivor[];
  private readonly named: Command[] = [];
  private readonly training: Command[] = [];
  /** Recruits promised to training orders of this decision. */
  recruits = 0;
  placedBuilding = false;

  readonly game: Game;
  readonly snap: Snapshot;

  /** `errands`: survivors the bot is walking somewhere itself (ruin visits); not handed out. */
  constructor(game: Game, snap: Snapshot, errands: ReadonlySet<number>) {
    this.game = game;
    this.snap = snap;
    this.resources = { ...game.state.economy.resources };
    const isolated = new Set(game.state.incidents.isolatedSurvivors.map((r) => r.unitId));
    this.free = snap.survivors.filter((s) => s.control === 'auto' && !isolated.has(s.id) && !errands.has(s.id));
  }

  canAfford(cost: ResourceAmounts, reserve: ResourceAmounts = {}): boolean {
    return RESOURCES.every((r) => this.resources[r] - (reserve[r] ?? 0) >= (cost[r] ?? 0));
  }

  private charge(cost: ResourceAmounts): void {
    for (const r of RESOURCES) this.resources[r] -= cost[r] ?? 0;
  }

  issue(cmd: Command): void {
    this.named.push(cmd);
  }

  /** Takes the automatic survivor nearest to (x, y), idle ones first, for an errand; null if none is spare. */
  takeSurvivor(x: number, y: number): Survivor | null {
    if (this.spareSurvivors <= 0) return null;
    const idle = this.free.filter((s) => s.task.type === 'idle' && s.insideId === 0);
    const s = nearest(idle.length > 0 ? idle : this.free, x, y);
    this.free.splice(this.free.indexOf(s), 1);
    return s;
  }

  /** Automatic survivors not yet named or promised to training in this decision. */
  get spareSurvivors(): number {
    return this.free.length - this.recruits;
  }

  place(type: BuildingType, tileX: number, tileY: number): void {
    this.charge(buildingCost(this.game.modifiers, type));
    this.placedBuilding = true;
    this.issue({ type: 'placeBuilding', building: type, tileX, tileY });
  }

  /** Queues a soldier; training takes a spare automatic survivor. */
  train(building: Building, unit: SoldierType): void {
    this.charge(trainingCost(this.game.modifiers, unit));
    this.recruits++;
    this.training.push({ type: 'train', buildingId: building.id, unit });
  }

  commands(): Command[] {
    return [...this.named, ...this.training];
  }
}

/** The survivor of a non-empty pool nearest to (x, y), the first one listed on a tie. */
function nearest(pool: readonly Survivor[], x: number, y: number): Survivor {
  let best = pool[0] as Survivor;
  let bestD = Infinity;
  for (const s of pool) {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
