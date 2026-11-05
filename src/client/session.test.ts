import { describe, expect, it } from 'vitest';
import { createController } from '../headless/bots';
import { CYCLE_TICKS, createGame, hashState, restoreGame } from '../sim';
import { OK, type Command, type CommandResult } from '../sim/commands';
import { raiseIncident } from '../sim/incidents/incidents';
import { DAY_TICKS, DUSK_TICKS } from '../sim/time';
import { addBuilding, spawnMutant } from '../sim/world/entities';
import { AUTOSAVE_STORAGE_KEY } from './storage/autoSave';
import type { KeyValueStorage } from './storage/browserStorage';
import { buildTestWorld, revealAll } from './testWorld';
import { Session } from './session';

const VIEW = { viewW: 1280, viewH: 720 };
/** About 9 x 5.5 tiles at the default zoom: the 24 x 12 test map is larger, so the camera can move (in VIEW it stays centered). */
const SMALL_VIEW = { viewW: 400, viewH: 240 };

function recordingSession(result: CommandResult = OK) {
  const w = buildTestWorld();
  const issued: Command[] = [];
  const session = new Session(w.game, VIEW, {
    apply: (_game, cmd) => {
      issued.push(cmd);
      return result;
    },
  });
  return { ...w, session, issued };
}

describe('Session basics', () => {
  it('starts centered on the core, running at 1x with nothing selected', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    expect(s.camera).toMatchObject({ x: 8.5, y: 5.5 });
    expect(s).toMatchObject({ paused: false, speed: 1, placing: null });
    expect(s.selection).toEqual([]);
  });

  it('frames advance the simulation by speed and not while paused', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.frame(100, 0);
    expect(w.game.state.tick).toBe(2);
    s.handleKey({ type: 'speed', delta: 1 }, 0);
    s.handleKey({ type: 'speed', delta: 1 }, 0);
    s.handleKey({ type: 'speed', delta: 1 }, 0);
    expect(s.speed).toBe(3);
    s.frame(100, 100);
    expect(w.game.state.tick).toBe(8);
    s.handleKey({ type: 'togglePause' }, 0);
    s.frame(100, 200);
    expect(w.game.state.tick).toBe(8);
  });
});

describe('Session autopilot (test hook)', () => {
  it('asks the autopilot for commands before every tick and applies them, frame and advance alike', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    const seen: number[] = [];
    s.autopilot = (game) => {
      seen.push(game.state.tick);
      return game.state.tick === 1 ? [{ type: 'hold', unitIds: [w.rifle1.id] }] : [];
    };
    s.frame(100, 0);
    expect(seen).toEqual([0, 1]);
    expect(w.rifle1.order).toEqual({ type: 'hold' });
    s.advanceTicks(2, 0);
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('Session mouse input', () => {
  it('click selects, double-click selects the same type on screen, box selects units', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.leftClick(2.5, 8.5, { shift: false, double: false });
    expect(s.selection).toEqual([w.rifle1.id]);
    s.leftClick(2.5, 8.5, { shift: false, double: true });
    expect(s.selection).toEqual([w.rifle1.id, w.rifle2.id]);
    s.boxSelect({ x0: 4, y0: 8, x1: 5, y1: 11 }, false);
    expect(s.selection).toEqual([w.guard.id]);
    s.boxSelect({ x0: 2, y0: 10, x1: 4, y1: 11 }, true);
    expect(s.selection).toEqual([w.guard.id, w.survivor1.id, w.survivor2.id]);
  });

  it('right-click on ground attack-moves soldiers; Ctrl+right-click forces a move', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.leftClick(2.5, 8.5, { shift: false, double: false });
    s.rightClick(6.5, 9.5, { ctrl: false }, 0);
    expect(w.rifle1.order).toEqual({ type: 'attackMove', x: 6.5, y: 9.5 });
    s.rightClick(5.5, 10.5, { ctrl: true }, 0);
    expect(w.rifle1.order).toEqual({ type: 'move', x: 5.5, y: 10.5 });
    expect(s.effects.some((e) => e.kind === 'order')).toBe(true);
  });

  it('a mixed selection right-clicking a workplace splits into assignWork and move', () => {
    const r = recordingSession();
    // Shift-click mixes kinds (a box would take only the soldier).
    r.session.leftClick(2.5, 10.5, { shift: false, double: false });
    r.session.leftClick(2.5, 8.5, { shift: true, double: false });
    r.session.rightClick(9, 3, { ctrl: false }, 0);
    expect(r.issued).toEqual([
      { type: 'assignWork', unitIds: [r.survivor1.id], buildingId: r.greenhouse.id },
      { type: 'move', unitIds: [r.rifle1.id], x: 9, y: 3 },
    ]);
  });

  it('a survivor right-clicking the signal tower site joins its crew, and the tower gets built', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    const tower = addBuilding(w.game, 'signalTower', 0, 5, { complete: false });
    s.select([w.survivor1.id]);
    s.rightClick(tower.x, tower.y, { ctrl: false }, 0);
    expect(w.survivor1.task).toEqual({ type: 'work', buildingId: tower.id });
    s.advanceTicks(200, 0);
    expect(w.survivor1.insideId).toBe(tower.id);
    expect(tower.construction?.progress).toBeGreaterThan(0);
  });

  it('a selected barracks sets its rally point with right-click', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.leftClick(13, 3, { shift: false, double: false });
    s.rightClick(6, 9, { ctrl: false }, 0);
    expect(w.barracks.rally).toEqual({ x: 6, y: 9 });
  });

  it('shows the simulation’s reject reason when a command is refused', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.leftClick(2.5, 10.5, { shift: false, double: false });
    s.handleKey({ type: 'hold' }, 0);
    expect(s.toasts.map((t) => t.text)).toEqual(['没有可以执行该指令的单位']);
  });
});

describe('Session keyboard input', () => {
  it('stop and hold apply to the selected soldiers, also while paused', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.boxSelect({ x0: 2, y0: 8, x1: 5, y1: 9 }, false);
    s.handleKey({ type: 'togglePause' }, 0);
    s.handleKey({ type: 'hold' }, 0);
    expect([w.rifle1.order, w.rifle2.order, w.guard.order]).toEqual([{ type: 'hold' }, { type: 'hold' }, { type: 'hold' }]);
    s.handleKey({ type: 'stop' }, 0);
    expect(w.guard.order).toEqual({ type: 'idle' });
  });

  it('control groups: Ctrl+1 stores, 1 recalls, pressing 1 twice centers the camera', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, SMALL_VIEW);
    s.boxSelect({ x0: 2, y0: 8, x1: 2.9, y1: 9 }, false);
    s.boxSelect({ x0: 4, y0: 8, x1: 5, y1: 9 }, true);
    s.handleKey({ type: 'assignGroup', index: 0 }, 0);
    s.leftClick(20, 1, { shift: false, double: false });
    expect(s.selection).toEqual([]);
    s.handleKey({ type: 'recallGroup', index: 0 }, 1000);
    expect(s.selection).toEqual([w.rifle1.id, w.guard.id]);
    expect(s.camera.x).toBe(8.5);
    s.handleKey({ type: 'recallGroup', index: 0 }, 1200);
    expect(s.camera).toMatchObject({ x: 3.5, y: 8.5 });
    s.handleKey({ type: 'addToGroup', index: 0 }, 2000);
    expect(s.groups[0]).toEqual([w.rifle1.id, w.guard.id]);
  });

  it('build hotkey enters placement; click places; Shift keeps placing; Escape cancels', () => {
    const r = recordingSession();
    r.session.handleKey({ type: 'build', building: 'shack' }, 0);
    expect(r.session.placing).toBe('shack');
    r.session.leftClick(5.2, 9.9, { shift: true, double: false });
    expect(r.issued).toEqual([{ type: 'placeBuilding', building: 'shack', tileX: 4, tileY: 9 }]);
    expect(r.session.placing).toBe('shack');
    r.session.leftClick(5.2, 9.9, { shift: false, double: false });
    expect(r.session.placing).toBeNull();
    r.session.handleKey({ type: 'build', building: 'barricade' }, 0);
    r.session.handleKey({ type: 'cancel' }, 0);
    expect(r.session.placing).toBeNull();
  });

  it('a rejected placement keeps placement mode and explains why', () => {
    const r = recordingSession({ ok: false, reason: 'insufficientResources' });
    r.session.handleKey({ type: 'build', building: 'shack' }, 0);
    r.session.leftClick(5.2, 9.9, { shift: false, double: false });
    expect(r.session.placing).toBe('shack');
    expect(r.session.toasts.map((t) => t.text)).toEqual(['资源不足']);
  });

  it('a building locked by tech cannot be picked for placement', () => {
    const r = recordingSession();
    r.session.handleKey({ type: 'build', building: 'armory' }, 0);
    expect(r.session.placing).toBeNull();
    expect(r.session.toasts[0]?.text).toBe('需要科技：军械制造');
  });

  it('G selects the idle survivors on the map', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    w.survivor2.task = { type: 'repair', buildingId: w.damaged.id };
    s.handleKey({ type: 'selectIdleSurvivors' }, 0);
    expect(s.selection).toEqual([w.survivor1.id]);
  });

  it('Escape clears the selection first, then opens the pause menu, which stops time', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.leftClick(2.5, 8.5, { shift: false, double: false });
    s.handleKey({ type: 'cancel' }, 0);
    expect(s.selection).toEqual([]);
    expect(s.menuOpen).toBe(false);
    s.handleKey({ type: 'cancel' }, 0);
    expect(s.menuOpen).toBe(true);
    const tick = w.game.state.tick;
    s.frame(500, 0);
    expect(w.game.state.tick).toBe(tick);
  });

  it('the tech tree and the policy panel stop time while open, still take commands, and leave the player’s own pause as it was', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    const tick = w.game.state.tick;
    s.handleKey({ type: 'toggleTech' }, 0);
    s.frame(500, 0);
    expect(w.game.state.tick).toBe(tick);
    s.issue([{ type: 'setResearch', tech: 'scavengingTools' }], 0);
    expect(w.game.state.economy.tech.current).toBe('scavengingTools');
    s.handleKey({ type: 'togglePolicies' }, 0);
    s.frame(500, 0);
    expect(w.game.state.tick).toBe(tick);
    s.issue([{ type: 'setPolicy', slot: 0, policy: 'salvageDrive' }], 0);
    expect(w.game.state.economy.policies.slots[0]).toBe('salvageDrive');
    s.handleKey({ type: 'togglePolicies' }, 0);
    expect(s).toMatchObject({ paused: false, techOpen: false, policiesOpen: false });
    s.frame(100, 0);
    expect(w.game.state.tick).toBe(tick + 2);

    // Paused with Space before opening: still paused after the panel closes.
    s.handleKey({ type: 'togglePause' }, 0);
    s.handleKey({ type: 'toggleTech' }, 0);
    s.handleKey({ type: 'cancel' }, 0);
    expect(s).toMatchObject({ paused: true, techOpen: false });
    s.frame(500, 0);
    expect(w.game.state.tick).toBe(tick + 2);
  });
});

describe('Session help and first-day guide', () => {
  it('the help overlay toggles, closes the other panels, stops time while open, and Escape closes it first', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.handleKey({ type: 'toggleTech' }, 0);
    s.handleKey({ type: 'toggleHelp' }, 0);
    expect(s).toMatchObject({ helpOpen: true, techOpen: false });
    const tick = w.game.state.tick;
    s.frame(500, 0);
    expect(w.game.state.tick).toBe(tick);
    s.handleKey({ type: 'cancel' }, 0);
    expect(s).toMatchObject({ helpOpen: false, menuOpen: false });
    s.frame(100, 0);
    expect(w.game.state.tick).toBe(tick + 2);
    s.handleKey({ type: 'toggleHelp' }, 0);
    s.handleKey({ type: 'toggleHelp' }, 0);
    expect(s.helpOpen).toBe(false);
  });

  it('the first-day guide can be dismissed', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    expect(s.guideDismissed).toBe(false);
    s.dismissGuide();
    expect(s.guideDismissed).toBe(true);
  });
});

describe('Session events', () => {
  it('turns events into log lines, alerts and effects; F jumps to the latest alert', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, SMALL_VIEW);
    s.handleKey({ type: 'togglePause' }, 0);
    w.game.events.push({ type: 'underAttack', entityId: w.shack.id, x: 16, y: 9, core: false });
    w.game.events.push({ type: 'explosion', x: 16, y: 9, radius: 1, damageType: 'explosive' });
    s.frame(16, 0);
    expect(s.alerts).toHaveLength(1);
    expect(s.log.map((l) => l.text)).toContain('棚屋 遭到攻击');
    expect(s.effects.map((e) => e.kind)).toContain('blast');
    s.handleKey({ type: 'jumpToAlert' }, 0);
    expect(s.camera).toMatchObject({ x: 16, y: 9 });
  });

  it('drops dead units from the selection', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.boxSelect({ x0: 2, y0: 8, x1: 4, y1: 9 }, false);
    w.rifle1.hp = 0;
    s.frame(16, 0);
    expect(s.selection).toEqual([w.rifle2.id]);
  });
});

/** In-memory storage that also records the tick of every autosave write. */
function savingStorage(game: { state: { tick: number } }) {
  const items = new Map<string, string>();
  const savedAt: number[] = [];
  const storage: KeyValueStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
      if (key === AUTOSAVE_STORAGE_KEY) savedAt.push(game.state.tick);
    },
    removeItem: (key) => void items.delete(key),
  };
  return { storage, items, savedAt };
}

describe('Session intro card', () => {
  it('a new game opens it in front of everything: it takes the keyboard before an incident card, and closeIntroCard closes it', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW, { showIntro: true });
    expect(s).toMatchObject({ introCardOpen: true, modalCard: 'intro' });
    raiseIncident(w.game, 'caravan');
    s.openIncidentModal();
    expect(s.modalCard).toBe('intro');
    s.handleKey({ type: 'closeIntroCard' }, 0);
    expect(s).toMatchObject({ introCardOpen: false, paused: false, modalCard: 'incident' });
    s.closeIncidentModal();
    expect(s.modalCard).toBeNull();
  });
});

describe('Session incident card', () => {
  it('opens by itself for a new incident and stops time like any open panel, without touching the player’s pause', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    raiseIncident(w.game, 'caravan');
    const tick = w.game.state.tick;
    s.frame(500, 0);
    expect(s).toMatchObject({ incidentModalOpen: true, paused: false });
    expect(w.game.state.tick).toBe(tick);
    // Commands still go through while it is open.
    s.issue([{ type: 'hold', unitIds: [w.rifle1.id] }], 0);
    expect(w.rifle1.order).toEqual({ type: 'hold' });
  });

  it('Esc closes it and time runs again; it does not pop up again for the same incident; Tab reopens it', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    raiseIncident(w.game, 'caravan');
    s.frame(16, 0);
    s.handleKey({ type: 'cancel' }, 0);
    expect(s).toMatchObject({ incidentModalOpen: false, menuOpen: false });
    const tick = w.game.state.tick;
    s.frame(100, 0);
    s.frame(100, 0);
    expect(s.incidentModalOpen).toBe(false);
    expect(w.game.state.tick).toBe(tick + 4);
    s.handleKey({ type: 'reopenIncident' }, 0);
    expect(s.incidentModalOpen).toBe(true);
    s.frame(100, 0);
    expect(w.game.state.tick).toBe(tick + 4);
  });

  it('closing the card keeps the player’s own pause: paused before, still paused after', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.handleKey({ type: 'togglePause' }, 0);
    raiseIncident(w.game, 'caravan');
    s.openIncidentModal();
    s.closeIncidentModal();
    expect(s).toMatchObject({ paused: true, incidentModalOpen: false });
    const tick = w.game.state.tick;
    s.frame(500, 0);
    expect(w.game.state.tick).toBe(tick);
  });

  it('choosing with 1–3 resolves the incident and closes the card', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    raiseIncident(w.game, 'caravan');
    s.frame(16, 0);
    const choices = w.game.state.incidents.pending!.choices;
    s.handleKey({ type: 'chooseIncidentChoice', index: choices.length - 1 }, 0);
    expect(w.game.state.incidents.pending).toBeNull();
    expect(w.game.state.incidents.history.at(-1)).toMatchObject({ choiceId: choices.at(-1)!.id, automatic: false });
    expect(s.incidentModalOpen).toBe(false);
  });

  it('the card cannot stay open, holding time, for an incident that is no longer pending', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    raiseIncident(w.game, 'caravan');
    s.frame(16, 0);
    s.issue([{ type: 'resolveIncident', incidentId: w.game.state.incidents.pending!.id, choiceId: 'decline' }], 0);
    expect(s.incidentModalOpen).toBe(false);
    const tick = w.game.state.tick;
    s.frame(100, 0);
    expect(w.game.state.tick).toBe(tick + 2);
  });

  it('under an autopilot the card never opens by itself: time keeps running for the bot to decide', () => {
    const w = buildTestWorld();
    const s = new Session(w.game, VIEW);
    s.autopilot = () => [];
    raiseIncident(w.game, 'caravan');
    const tick = w.game.state.tick;
    s.frame(100, 0);
    expect(s.incidentModalOpen).toBe(false);
    expect(w.game.state.tick).toBe(tick + 2);
  });

  it(
    'the fullGame scenario: the economy bot through the frame loop resolves every incident itself and time never stops',
    () => {
      const game = createGame({ seed: 'full-game-01', origin: 'militia', difficulty: 'normal' });
      const s = new Session(game, VIEW);
      const bot = createController('economy');
      s.autopilot = (g) => bot(g, []);
      s.setSpeed(3);
      // This seed has incidents on days 4 and 5 (the e2e run used to stop on day 4 with the card open).
      let frames = 0;
      while (game.state.clock.day <= 5 && !s.isOver) {
        const before = game.state.tick;
        s.frame(200, frames * 200);
        frames++;
        expect(s.incidentModalOpen).toBe(false);
        expect(game.state.tick).toBe(before + 12);
      }
      expect(game.state.incidents.eventDays.slice(0, 2)).toEqual([4, 5]);
      const history = game.state.incidents.history;
      expect(history).toHaveLength(2);
      expect(history.every((h) => !h.automatic)).toBe(true);
      expect(game.state.incidents.pending).toBeNull();
    },
    60_000,
  );
});

describe('Session autosave', () => {
  it('saves at every dawn and at the start of every dusk, and nowhere else', () => {
    const w = buildTestWorld();
    const { storage, items, savedAt } = savingStorage(w.game);
    const s = new Session(w.game, VIEW, { storage });
    s.advanceTicks(2 * CYCLE_TICKS + 10, 0);
    const duskStart = DAY_TICKS - DUSK_TICKS;
    // The tick after the first tick of the phase has been processed.
    expect(savedAt).toEqual([duskStart + 1, CYCLE_TICKS + 1, CYCLE_TICKS + duskStart + 1, 2 * CYCLE_TICKS + 1]);
    expect(restoreGame(items.get(AUTOSAVE_STORAGE_KEY)!)?.state.tick).toBe(2 * CYCLE_TICKS + 1);
  });

  it('autoSave() (page hidden or closed) writes the game as it is now', () => {
    const w = buildTestWorld();
    const { storage, items } = savingStorage(w.game);
    const s = new Session(w.game, VIEW, { storage });
    s.advanceTicks(30, 0);
    s.autoSave();
    expect(hashState(restoreGame(items.get(AUTOSAVE_STORAGE_KEY)!)!)).toBe(hashState(w.game));
  });

  it('when the game ends the autosave is deleted, and nothing saves it again', () => {
    const w = buildTestWorld();
    const { storage, items, savedAt } = savingStorage(w.game);
    const s = new Session(w.game, VIEW, { storage });
    s.advanceTicks(DAY_TICKS - DUSK_TICKS + 5, 0);
    expect(items.has(AUTOSAVE_STORAGE_KEY)).toBe(true);
    const core = w.game.state.entities.get(w.game.state.coreId)!;
    core.hp = 0;
    s.advanceTicks(1, 0);
    expect(s.isOver).toBe(true);
    expect(items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);
    s.autoSave();
    s.frame(1000, 0);
    expect(items.has(AUTOSAVE_STORAGE_KEY)).toBe(false);
    expect(savedAt).toHaveLength(1);
  });
});

describe('Session retreat', () => {
  it('K sends only the selected soldiers to the core with a plain (forced) move', () => {
    const r = recordingSession();
    r.session.select([r.rifle1.id, r.survivor1.id, r.guard.id]);
    r.session.handleKey({ type: 'retreat' }, 0);
    const core = r.game.state.entities.get(r.game.state.coreId)!;
    expect(r.issued).toEqual([{ type: 'move', unitIds: [r.rifle1.id, r.guard.id], x: core.x, y: core.y }]);
  });

  it('without soldiers selected nothing is issued; a refused retreat shows only the simulation’s reason', () => {
    const r = recordingSession();
    r.session.select([r.survivor1.id]);
    r.session.handleKey({ type: 'retreat' }, 0);
    expect(r.issued).toEqual([]);
    expect(r.session.toasts.map((t) => t.text)).toEqual(['没有选中士兵']);

    const refused = recordingSession({ ok: false, reason: 'noValidUnits' });
    refused.session.select([refused.rifle1.id]);
    refused.session.handleKey({ type: 'retreat' }, 0);
    expect(refused.session.toasts.map((t) => t.text)).toEqual(['没有可以执行该指令的单位']);
  });

  it('retreating soldiers walk past enemies without fighting and stop in the simulation’s formation around the core', () => {
    const w = buildTestWorld();
    revealAll(w.game);
    const s = new Session(w.game, VIEW);
    spawnMutant(w.game, 'wanderer', 6.5, 9.5, { mode: 'assault' });
    s.select([w.rifle1.id, w.rifle2.id, w.guard.id]);
    s.handleKey({ type: 'retreat' }, 0);
    const soldiers = [w.rifle1, w.rifle2, w.guard];
    for (let i = 0; i < 10; i++) {
      s.advanceTicks(10, 0);
      for (const u of soldiers) if (u.order.type === 'move') expect(u.attack.targetId).toBe(0);
    }
    expect(soldiers.some((u) => u.order.type === 'move')).toBe(true);
    s.advanceTicks(100, 0);
    const core = w.game.state.entities.get(w.game.state.coreId)!;
    for (const u of soldiers) expect(Math.hypot(u.x - core.x, u.y - core.y)).toBeLessThan(3.5);
  });
});
