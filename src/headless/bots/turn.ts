/**
 * One bot decision (Task 5): the commands it issues and a local copy of what they use up.
 *
 * The runner applies a controller's commands in order after it returns, so a bot cannot watch its
 * own commands take effect within the decision. Turn keeps the bookkeeping instead: resources are
 * charged as commands are issued, idle survivors are handed out one by one, and recruits for
 * training are counted separately (training takes whichever idle survivor is nearest, so those
 * commands are issued last, after every command that names a survivor). The built-in survivor
 * manager puts idle survivors to work as well; once nobody is idle, a named job takes one the
 * manager keeps busy (working, helping a site, repairing), whom the command pulls off that job.
 */
import { buildingCost, trainingCost, type Building, type Command, type Game, type Survivor } from '../../sim';
import type { SoldierType } from '../../sim/data/combat';
import { RESOURCES, type BuildingType, type Resource, type ResourceAmounts } from '../../sim/data/economy';
import { isIdle, type Snapshot } from './view';

export class Turn {
  readonly resources: Record<Resource, number>;
  /** Idle survivors not yet given a job in this decision. */
  readonly idle: Survivor[];
  /** Survivors under automatic control on a job, not yet given another in this decision. */
  private readonly busy: Survivor[];
  private readonly named: Command[] = [];
  private readonly training: Command[] = [];
  /** Workers handed to automatic control for training in this decision. */
  private readonly freed = new Set<number>();
  /** Recruits promised to training orders of this decision. */
  recruits = 0;
  placedBuilding = false;

  readonly game: Game;
  readonly snap: Snapshot;

  /** `errands`: idle survivors the bot is walking somewhere itself (ruin visits); not handed out. */
  constructor(game: Game, snap: Snapshot, errands: ReadonlySet<number>) {
    this.game = game;
    this.snap = snap;
    this.resources = { ...game.state.economy.resources };
    this.idle = snap.survivors.filter((s) => isIdle(s) && !errands.has(s.id));
    this.busy = snap.survivors.filter((s) => s.control === 'auto' && s.task.type !== 'idle' && !errands.has(s.id));
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

  /** Takes the survivor nearest to (x, y) for a named job: an idle one, else a busy one; null if none is left. */
  takeSurvivor(x: number, y: number): Survivor | null {
    return takeNearest(this.idle.length > this.recruits ? this.idle : this.busy, x, y);
  }

  /** Idle survivors still free for named jobs (recruits already promised are kept back). */
  get spareIdle(): number {
    return this.idle.length - this.recruits;
  }

  place(type: BuildingType, tileX: number, tileY: number): void {
    this.charge(buildingCost(this.game.modifiers, type));
    this.placedBuilding = true;
    this.issue({ type: 'placeBuilding', building: type, tileX, tileY });
  }

  /**
   * Queues a soldier; `freeWorker` first hands its most recent worker not freed yet to automatic
   * control (stop), so there is someone training may take.
   */
  train(building: Building, unit: SoldierType, freeWorker: Building | null): void {
    this.charge(trainingCost(this.game.modifiers, unit));
    const worker = freeWorker?.workers.findLast((id) => !this.freed.has(id));
    if (worker !== undefined) {
      this.freed.add(worker);
      this.training.push({ type: 'stop', unitIds: [worker] });
    } else this.recruits++;
    this.training.push({ type: 'train', buildingId: building.id, unit });
  }

  commands(): Command[] {
    return [...this.named, ...this.training];
  }
}

function takeNearest(pool: Survivor[], x: number, y: number): Survivor | null {
  let best = -1;
  let bestD = Infinity;
  pool.forEach((s, k) => {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  });
  return best === -1 ? null : (pool.splice(best, 1)[0] as Survivor);
}
