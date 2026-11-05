/**
 * One running game in the browser: the simulation plus everything the client keeps on its own
 * side (camera, selection, control groups, speed and pause, panels and cards, placement mode,
 * log, alerts, toasts, visual effects, autosave timing). Input handlers call the methods here
 * with world coordinates; this turns them into commands through the pure mapping modules in
 * input/ and shows rejections as toasts.
 */
import {
  REJECT_REASON_TEXT,
  applyCommand,
  drainEvents,
  stepGame,
  type ClockState,
  type Command,
  type CommandResult,
  type EntityId,
  type Game,
} from '../sim';
import type { BuildingType } from '../sim/data/economy';
import { DEFAULT_ZOOM, PAN_SPEED_PX, centerOn, clampCamera, panByScreen, resizeView, viewWorldRect, zoomAt, type Camera } from './camera';
import { buildChoice, footprintAt } from './hud/buildMenu';
import { alertFromEvent, logLineForEvent, type Alert, type LogTone } from './hud/eventLog';
import { addToGroup, assignGroup, createControlGroups, recallGroup, type ControlGroups } from './input/controlGroups';
import type { KeyAction, ModalCard } from './input/keymap';
import { pickEntity, playerUnitsInRect, type WorldRect } from './input/picking';
import { commandsForRightClick } from './input/rightClick';
import { pruneSelection, sameTypeInRect, selectionAfterBox, selectionAfterClick } from './input/selection';
import { createPositionHistory, recordPositions } from './interpolation';
import { effectsForEvent, liveEffects, orderMarker, type VisualEffect } from './render/effects';
import { clearAutoSave, saveAutoSave } from './storage/autoSave';
import { browserStorage, type KeyValueStorage } from './storage/browserStorage';
import { advanceTicks, nextSpeed, type Speed } from './tickClock';
import { isOnMap, isPlayerUnit } from './view';

export type ApplyCommand = (game: Game, cmd: Command) => CommandResult;

/**
 * Issues commands before a tick, like a headless controller (the debug hook plugs a bot in here).
 * The bot answers incident cards with commands itself, so they do not open while it plays.
 */
export type Autopilot = (game: Game) => readonly Command[];

export interface SessionOptions {
  /** Defaults to the simulation's applyCommand; tests inject a recorder. */
  apply?: ApplyCommand;
  /** Whether to display the opening Day 1 intro card modal dialog. Defaults to false. */
  showIntro?: boolean;
  /** Where the autosave goes; defaults to localStorage (tests pass an in-memory store). */
  storage?: KeyValueStorage;
}

export interface LogEntry {
  id: number;
  tick: number;
  text: string;
  tone: LogTone;
  at?: { x: number; y: number };
}

export interface Toast {
  id: number;
  text: string;
  born: number;
}

const LOG_LIMIT = 60;
const ALERT_LIMIT = 20;
const TOAST_MS = 2600;
const DOUBLE_RECALL_MS = 400;
/** Extra pick radius in screen pixels around small units. */
const PICK_SLACK_PX = 6;
/** Non-core "under attack" log lines at most this often (ticks). */
const ATTACK_LOG_INTERVAL = 60;

/**
 * The autosave is written right after the first tick of every dawn (from day 2 on) and of every
 * dusk, the two moments a player plans around; `clock` is the clock of the tick just processed.
 */
function isAutoSaveTick(clock: ClockState): boolean {
  return clock.phaseTick === 0 && (clock.phase === 'dusk' || (clock.phase === 'day' && clock.day > 1));
}

export class Session {
  readonly game: Game;
  camera: Camera;
  selection: EntityId[] = [];
  groups: ControlGroups = createControlGroups();
  speed: Speed = 1;
  paused = false;
  menuOpen = false;
  /** The tech tree and the policy panel cover most of the field, so time stands still while either is open. */
  techOpen = false;
  policiesOpen = false;
  /** The controls / how-to-play overlay; time stands still while it is open. */
  helpOpen = false;
  /** Opening world intro card on Day 1. */
  introCardOpen = false;
  /** Victory routes progress panel (O hotkey). */
  objectivesOpen = false;
  /** The player closed the first-day checklist. */
  guideDismissed = false;
  placing: BuildingType | null = null;
  /** World point under the cursor (placement ghost, hover range preview). */
  hover: { x: number; y: number } | null = null;
  /** Box selection being dragged, in screen pixels (drawn by the renderer). */
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Interpolation factor between the last two ticks. */
  alpha = 0;
  readonly history = createPositionHistory();
  log: LogEntry[] = [];
  alerts: Alert[] = [];
  toasts: Toast[] = [];
  effects: VisualEffect[] = [];
  /** Bumped whenever something the HUD shows changes outside the regular refresh. */
  version = 0;
  /** Test hook: asked for commands before every tick (rejections are dropped silently). Not used in normal play. */
  autopilot: Autopilot | null = null;

  private readonly apply: ApplyCommand;
  private carry = 0;
  private nextId = 1;
  private lastRecall: { index: number; at: number } | null = null;
  private alertCursor = 0;
  private lastAttackLogTick = -Infinity;
  private readonly storage: KeyValueStorage;
  /** The incident whose card is showing (null: closed). */
  private incidentCardId: number | null = null;
  /** The last incident that opened its card by itself, so closing it does not bring it back. */
  private lastRaisedIncidentId: number | null = null;

  constructor(game: Game, view: { viewW: number; viewH: number }, options: SessionOptions = {}) {
    this.game = game;
    this.apply = options.apply ?? applyCommand;
    this.storage = options.storage ?? browserStorage();
    const core = game.state.entities.get(game.state.coreId);
    const cx = core ? core.x : game.state.map.width / 2;
    const cy = core ? core.y : game.state.map.height / 2;
    this.camera = { x: cx, y: cy, zoom: DEFAULT_ZOOM, viewW: view.viewW, viewH: view.viewH };
    this.introCardOpen = Boolean(options.showIntro && game.state.clock.day === 1 && game.state.clock.phase === 'day' && game.state.clock.phaseTick === 0 && game.state.tick === 0);
  }

  get mapSize(): { width: number; height: number } {
    return this.game.state.map;
  }

  get isOver(): boolean {
    return this.game.state.outcome.status !== 'playing';
  }

  /**
   * The daytime incident card. While it is open time stands still, like with the other panels,
   * without touching the player's own pause; it closes by itself once its incident is no longer
   * pending (chosen, or settled at nightfall).
   */
  get incidentModalOpen(): boolean {
    const pending = this.game.state.incidents.pending;
    return pending !== null && pending.id === this.incidentCardId;
  }

  /**
   * The modal card in front, if any: while it is open the keyboard does only what the card's keys
   * do (input/keymap.ts) and the camera stays put. The day-1 intro card comes before an incident card.
   */
  get modalCard(): ModalCard | null {
    if (this.introCardOpen) return 'intro';
    return this.incidentModalOpen ? 'incident' : null;
  }

  /** Whether the simulation stands still: the player's pause, or a panel or card covering the field. */
  private get timeStopped(): boolean {
    return this.paused || this.menuOpen || this.techOpen || this.policiesOpen || this.helpOpen || this.incidentModalOpen || this.introCardOpen || this.isOver;
  }

  // -------------------------------------------------------------------------------------------
  // Commands

  /** Applies commands in order; every rejection becomes a toast with the simulation's reason. */
  issue(commands: readonly Command[], now = 0): CommandResult[] {
    const results = commands.map((cmd) => {
      const r = this.apply(this.game, cmd);
      if (!r.ok) this.toast(REJECT_REASON_TEXT[r.reason], now);
      return r;
    });
    this.version++;
    return results;
  }

  toast(text: string, now: number): void {
    this.toasts = [...this.toasts.filter((t) => t.text !== text), { id: this.nextId++, text, born: now }].slice(-4);
    this.version++;
  }

  private selectedUnitIds(): EntityId[] {
    return this.selection.filter((id) => {
      const e = this.game.state.entities.get(id);
      return e !== undefined && isPlayerUnit(e);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Mouse

  private pickSlack(): number {
    return PICK_SLACK_PX / this.camera.zoom;
  }

  leftClick(wx: number, wy: number, mods: { shift: boolean; double: boolean }, now = 0): void {
    if (this.placing) {
      this.placeAt(wx, wy, mods.shift, now);
      return;
    }
    const view = this.game.state;
    const picked = pickEntity(view, wx, wy, this.pickSlack());
    if (mods.double && picked && isPlayerUnit(picked)) this.selection = sameTypeInRect(view, picked, viewWorldRect(this.camera));
    else this.selection = selectionAfterClick(view, this.selection, picked, mods.shift);
    this.version++;
  }

  boxSelect(rect: WorldRect, shift: boolean): void {
    const view = this.game.state;
    const boxed = playerUnitsInRect(view, rect).map((e) => e.id);
    this.selection = selectionAfterBox(view, this.selection, boxed, shift);
    this.version++;
  }

  rightClick(wx: number, wy: number, mods: { ctrl: boolean }, now = 0): void {
    if (this.placing) {
      this.placing = null;
      this.version++;
      return;
    }
    const view = this.game.state;
    const entity = pickEntity(view, wx, wy, this.pickSlack());
    const commands = commandsForRightClick(view, this.selection, { x: wx, y: wy, entity }, { forceMove: mods.ctrl });
    if (commands.length === 0) return;
    const results = this.issue(commands, now);
    if (results.some((r) => r.ok)) {
      const hostile = commands.some((c) => c.type === 'attackTarget' || (c.type === 'attackMove' && !mods.ctrl));
      this.effects.push(orderMarker(wx, wy, hostile, now));
    }
  }

  /** Right-click on the minimap: same as on the ground at that point. */
  commandAt(wx: number, wy: number, mods: { ctrl: boolean }, now = 0): void {
    const view = this.game.state;
    const commands = commandsForRightClick(view, this.selection, { x: wx, y: wy, entity: null }, { forceMove: mods.ctrl });
    if (commands.length > 0) this.issue(commands, now);
  }

  startPlacing(type: BuildingType, now = 0): void {
    const choice = buildChoice(this.game, type);
    if (!choice.availability.ok) {
      this.toast(choice.availability.reason, now);
      return;
    }
    this.placing = type;
    this.techOpen = false;
    this.policiesOpen = false;
    this.version++;
  }

  placeAt(wx: number, wy: number, keepPlacing: boolean, now = 0): void {
    if (!this.placing) return;
    const { tileX, tileY } = footprintAt(this.placing, wx, wy);
    const [result] = this.issue([{ type: 'placeBuilding', building: this.placing, tileX, tileY }], now);
    if (result?.ok && !keepPlacing) this.placing = null;
  }

  // -------------------------------------------------------------------------------------------
  // Camera

  pan(dx: number, dy: number, dtMs: number): void {
    if (dx === 0 && dy === 0) return;
    const d = (PAN_SPEED_PX * dtMs) / 1000;
    this.camera = clampCamera(panByScreen(this.camera, dx * d, dy * d), this.mapSize);
  }

  zoom(sx: number, sy: number, factor: number): void {
    this.camera = zoomAt(this.camera, sx, sy, factor, this.mapSize);
  }

  centerOn(wx: number, wy: number): void {
    this.camera = centerOn(this.camera, wx, wy, this.mapSize);
  }

  resize(viewW: number, viewH: number): void {
    this.camera = resizeView(this.camera, viewW, viewH, this.mapSize);
  }

  jumpToAlert(now = 0): void {
    if (this.alerts.length === 0) {
      this.toast('暂时没有警报', now);
      return;
    }
    const index = this.alerts.length - 1 - (this.alertCursor % this.alerts.length);
    const a = this.alerts[index] as Alert;
    this.alertCursor++;
    this.centerOn(a.x, a.y);
  }

  private centerOnSelection(): void {
    const items = this.selection.map((id) => this.game.state.entities.get(id)).filter((e) => e !== undefined);
    if (items.length === 0) return;
    const x = items.reduce((s, e) => s + e.x, 0) / items.length;
    const y = items.reduce((s, e) => s + e.y, 0) / items.length;
    this.centerOn(x, y);
  }

  select(ids: readonly EntityId[]): void {
    this.selection = pruneSelection(this.game.state, ids);
    this.version++;
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard

  handleKey(action: KeyAction, now = 0): void {
    switch (action.type) {
      case 'togglePause':
        this.paused = !this.paused;
        break;
      case 'closeIntroCard':
        this.introCardOpen = false;
        break;
      case 'cancel':
        if (this.incidentModalOpen) this.incidentCardId = null;
        else if (this.objectivesOpen) this.objectivesOpen = false;
        else if (this.helpOpen) this.helpOpen = false;
        else if (this.placing) this.placing = null;
        else if (this.techOpen || this.policiesOpen) {
          this.techOpen = false;
          this.policiesOpen = false;
        } else if (this.selection.length > 0) this.selection = [];
        else this.menuOpen = !this.menuOpen;
        break;
      case 'retreat':
        this.retreatSelectedSoldiers(now);
        break;
      case 'toggleObjectives':
        this.objectivesOpen = !this.objectivesOpen;
        break;
      case 'reopenIncident':
        if (this.game.state.incidents.pending) this.openIncidentModal();
        else this.toast('现在没有待处理的事件', now);
        break;
      case 'chooseIncidentChoice': {
        const choice = this.incidentModalOpen ? this.game.state.incidents.pending?.choices[action.index] : undefined;
        if (choice) this.resolveIncidentChoice(choice.id, now);
        break;
      }
      case 'hold':
      case 'stop': {
        const ids = this.selectedUnitIds();
        if (ids.length > 0) this.issue([{ type: action.type, unitIds: ids }], now);
        break;
      }
      case 'jumpToAlert':
        this.jumpToAlert(now);
        break;
      case 'toggleTech':
        this.techOpen = !this.techOpen;
        this.policiesOpen = false;
        break;
      case 'togglePolicies':
        this.policiesOpen = !this.policiesOpen;
        this.techOpen = false;
        break;
      case 'toggleHelp':
        this.helpOpen = !this.helpOpen;
        this.techOpen = false;
        this.policiesOpen = false;
        break;
      case 'selectIdleSurvivors': {
        const idle: EntityId[] = [];
        for (const e of this.game.state.entities.values()) if (e.kind === 'survivor' && isOnMap(e) && e.task.type === 'idle') idle.push(e.id);
        if (idle.length === 0) this.toast('没有空闲的幸存者', now);
        else this.selection = idle;
        break;
      }
      case 'speed':
        this.speed = nextSpeed(this.speed, action.delta);
        break;
      case 'recallGroup': {
        const ids = recallGroup(this.game.state, this.groups, action.index);
        if (ids.length === 0) break;
        this.selection = ids;
        const again = this.lastRecall && this.lastRecall.index === action.index && now - this.lastRecall.at <= DOUBLE_RECALL_MS;
        if (again) this.centerOnSelection();
        this.lastRecall = { index: action.index, at: now };
        break;
      }
      case 'assignGroup':
        this.groups = assignGroup(this.groups, action.index, this.selection);
        if (this.selection.length > 0) this.toast(`编队 ${action.index + 1} 已设置`, now);
        break;
      case 'addToGroup':
        this.groups = addToGroup(this.groups, action.index, this.selection);
        break;
      case 'build':
        this.startPlacing(action.building, now);
        break;
    }
    this.version++;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.paused = false;
    this.version++;
  }

  closeMenu(): void {
    this.menuOpen = false;
    this.version++;
  }

  dismissGuide(): void {
    this.guideDismissed = true;
    this.version++;
  }

  /** Opens the card of the pending incident (event log entry, Tab); nothing pending, nothing opens. */
  openIncidentModal(): void {
    const pending = this.game.state.incidents.pending;
    if (!pending) return;
    this.incidentCardId = pending.id;
    this.version++;
  }

  /** "查看地图 (Esc)": the incident stays pending and can be reopened. */
  closeIncidentModal(): void {
    this.incidentCardId = null;
    this.version++;
  }

  closeIntroCard(): void {
    this.introCardOpen = false;
    this.version++;
  }

  /** Picks a choice of the pending incident; once the simulation accepts it the card closes. */
  resolveIncidentChoice(choiceId: string, now = 0): void {
    const pending = this.game.state.incidents.pending;
    if (pending) this.issue([{ type: 'resolveIncident', incidentId: pending.id, choiceId }], now);
  }

  /**
   * "撤退回炉心 (K)": the selected soldiers get a plain move to the core, the same command as
   * Ctrl+right-click, so they stop fighting on the way; the simulation spreads the group into its
   * formation slots around the core.
   */
  private retreatSelectedSoldiers(now: number): void {
    const view = this.game.state;
    const soldierIds = this.selection.filter((id) => {
      const e = view.entities.get(id);
      return e !== undefined && e.kind === 'soldier' && isOnMap(e);
    });
    const core = view.entities.get(view.coreId);
    if (soldierIds.length === 0 || !core) {
      this.toast('没有选中士兵', now);
      return;
    }
    const [result] = this.issue([{ type: 'move', unitIds: soldierIds, x: core.x, y: core.y }], now);
    if (result?.ok) this.effects.push(orderMarker(core.x, core.y, false, now));
  }

  /** Writes the autosave now (the page is being hidden or closed). A finished game is never saved. */
  autoSave(): void {
    saveAutoSave(this.game, this.storage);
  }

  // -------------------------------------------------------------------------------------------
  // Frame

  /** Advances the simulation by the elapsed wall time and processes its events. */
  frame(dtMs: number, now: number): void {
    // Also an incident that was pending before any tick ran here (a restored save).
    this.openNewIncident();
    const adv = advanceTicks(this.carry, dtMs, this.speed, this.timeStopped);
    // An incident card that opens mid-frame stops the remaining ticks too.
    for (let i = 0; i < adv.steps && !this.timeStopped; i++) this.step();
    this.carry = adv.carry;
    this.alpha = this.isOver ? 1 : adv.alpha;
    this.consumeEvents(now);
    this.effects = liveEffects(this.effects, now);
    if (this.toasts.some((t) => now - t.born > TOAST_MS)) {
      this.toasts = this.toasts.filter((t) => now - t.born <= TOAST_MS);
      this.version++;
    }
    const pruned = pruneSelection(this.game.state, this.selection);
    if (pruned.length !== this.selection.length) {
      this.selection = pruned;
      this.version++;
    }
  }

  /** Runs `ticks` simulation steps right away (debug hook / tests), with the same bookkeeping as frame(). */
  advanceTicks(ticks: number, now: number): void {
    for (let i = 0; i < ticks && !this.isOver; i++) this.step();
    this.consumeEvents(now);
  }

  /**
   * One simulation tick: the autopilot's commands, then the step (positions kept for
   * interpolation), then the autosave and a newly raised incident's card. A game that just ended
   * deletes its autosave: a finished game cannot be continued.
   */
  private step(): void {
    if (this.autopilot) for (const cmd of this.autopilot(this.game)) this.apply(this.game, cmd);
    recordPositions(this.history, this.game.state.entities.values());
    stepGame(this.game);
    if (this.isOver) clearAutoSave(this.storage);
    else if (isAutoSaveTick(this.game.state.clock)) this.autoSave();
    this.openNewIncident();
  }

  /** A newly raised incident opens its card, except under an autopilot, which answers it itself. */
  private openNewIncident(): void {
    const pending = this.game.state.incidents.pending;
    if (!pending || pending.id === this.lastRaisedIncidentId) return;
    this.lastRaisedIncidentId = pending.id;
    if (!this.autopilot) this.incidentCardId = pending.id;
    this.version++;
  }

  private consumeEvents(now: number): void {
    const events = drainEvents(this.game);
    if (events.length === 0) return;
    const view = this.game.state;
    const tick = view.tick;
    for (const event of events) {
      for (const fx of effectsForEvent(event, now, this.speed, (id) => view.entities.get(id))) this.effects.push(fx);
      const alert = alertFromEvent(event, tick);
      if (alert) {
        this.alerts = [...this.alerts, alert].slice(-ALERT_LIMIT);
        this.alertCursor = 0;
        if (!alert.core) {
          if (tick - this.lastAttackLogTick < ATTACK_LOG_INTERVAL) continue;
          this.lastAttackLogTick = tick;
        }
      }
      const line = logLineForEvent(view, event);
      if (line) this.log = [...this.log, { id: this.nextId++, tick, ...line }].slice(-LOG_LIMIT);
    }
    this.version++;
  }
}
