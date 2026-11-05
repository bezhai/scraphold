/**
 * Test hook for end-to-end tests, installed only when the page URL has `?debug`: read-only
 * helpers to find things on screen and what the game was when the screen got it (`loaded`),
 * `advance(ticks)` to fast-forward the simulation through the same path the frame loop uses,
 * `autopilot(bot)` to let a headless bot play through the real client, `stress()` to set up the
 * performance scenario, `rasterizeSections(on)` to make the renderer's section timings include
 * the rasterizer's work, and `finishResearch(tech)` to set up screenshot scenes. Bots and
 * scenarios are loaded with dynamic imports, so they are separate small files the game never
 * downloads. Not part of normal play.
 */
import { BUILDINGS, TECHS, type BuildingType, type TechId } from '../sim/data/economy';
import { hashState, placementBonusPct, validateCommand } from '../sim';
import { viewWorldRect, worldToScreen } from './camera';
import type { Renderer } from './render/renderer';
import type { Session } from './session';

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Per-frame timings in ms: the game loop's phases and the renderer's sections; HUD (Preact) renders as running totals. */
export interface FrameProfile {
  loop: Record<string, number>;
  render: Record<string, number>;
  hud: { renders: number; totalMs: number; maxMs: number };
}

declare global {
  interface Window {
    scraphold?: ReturnType<typeof debugApi>;
  }
}

/** The renderer setting the hook switches. */
export type DebugRenderer = Pick<Renderer, 'rasterizeSections'>;

function debugApi(session: Session, profile: FrameProfile, renderer: DebugRenderer) {
  const view = () => session.game.state;
  const toScreen = (x: number, y: number) => worldToScreen(session.camera, x, y);
  const loaded = { day: view().clock.day, tick: view().tick, hash: hashState(session.game) };
  return {
    session,
    /** The game as this screen received it, before any frame ran: a new game, or the save that 继续游戏 restored. */
    loaded,
    summary() {
      const v = view();
      return { tick: v.tick, clock: v.clock, resources: { ...v.economy.resources }, outcome: v.outcome.status, entities: v.entities.size, paused: session.paused, speed: session.speed };
    },
    entities(kind?: string) {
      return [...view().entities.values()]
        .filter((e) => !kind || e.kind === kind)
        .map((e) => {
          const s = toScreen(e.x, e.y);
          return {
            id: e.id,
            kind: e.kind,
            type: 'type' in e ? e.type : e.kind,
            x: e.x,
            y: e.y,
            sx: s.x,
            sy: s.y,
            hp: e.hp,
            task: e.kind === 'survivor' ? e.task.type : null,
            insideId: e.kind === 'survivor' ? e.insideId : null,
            constructing: e.kind === 'building' ? e.construction !== null : null,
            queue: e.kind === 'building' ? e.trainQueue.length : null,
          };
        });
    },
    toScreen,
    /** The accepted spot inside `safe` with the highest production bonus (ties: nearest the core). */
    bestPlacement(type: BuildingType, safe: ScreenRect) {
      const size = BUILDINGS[type].size;
      const core = view().map.coreTile;
      let best: { tileX: number; tileY: number; bonus: number; d: number; sx: number; sy: number } | null = null;
      for (let ty = core.y - 12; ty <= core.y + 12; ty++)
        for (let tx = core.x - 14; tx <= core.x + 14; tx++) {
          const s = toScreen(tx + size / 2, ty + size / 2);
          if (s.x < safe.x0 || s.x > safe.x1 || s.y < safe.y0 || s.y > safe.y1) continue;
          if (!validateCommand(session.game, { type: 'placeBuilding', building: type, tileX: tx, tileY: ty }).ok) continue;
          const bonus = placementBonusPct(session.game, type, tx, ty);
          const d = (tx - core.x) ** 2 + (ty - core.y) ** 2;
          if (!best || bonus > best.bonus + 1e-9 || (Math.abs(bonus - best.bonus) <= 1e-9 && d < best.d)) best = { tileX: tx, tileY: ty, bonus, d, sx: s.x, sy: s.y };
        }
      return best;
    },
    /** A spot near the core where placing `type` is accepted, with the cursor point on screen inside `safe`. */
    findPlacement(type: BuildingType, safe: ScreenRect) {
      const v = view();
      const size = BUILDINGS[type].size;
      const core = v.map.coreTile;
      const candidates: { tileX: number; tileY: number; d: number }[] = [];
      for (let ty = core.y - 10; ty <= core.y + 10; ty++)
        for (let tx = core.x - 12; tx <= core.x + 12; tx++) candidates.push({ tileX: tx, tileY: ty, d: (tx - core.x) ** 2 + (ty - core.y) ** 2 });
      candidates.sort((a, b) => a.d - b.d);
      for (const c of candidates) {
        const wx = c.tileX + size / 2;
        const wy = c.tileY + size / 2;
        const s = toScreen(wx, wy);
        if (s.x < safe.x0 || s.x > safe.x1 || s.y < safe.y0 || s.y > safe.y1) continue;
        if (validateCommand(session.game, { type: 'placeBuilding', building: type, tileX: c.tileX, tileY: c.tileY }).ok) return { ...c, wx, wy, sx: s.x, sy: s.y };
      }
      return null;
    },
    profile() {
      return { loop: { ...profile.loop }, render: { ...profile.render }, hud: { ...profile.hud } };
    },
    /**
     * Off by default. On: every renderer section reads one pixel back before its clock reading,
     * so `profile().render` shows where the rasterizer's time goes; the readbacks cost frames, so
     * switch it off again before measuring the frame rate.
     */
    rasterizeSections(on: boolean) {
      renderer.rasterizeSections = on;
    },
    advance(ticks: number) {
      session.advanceTicks(ticks, performance.now());
    },
    hash() {
      return hashState(session.game);
    },
    /**
     * Scene setup: gives `tech` and the techs it requires all their research points; the
     * simulation completes them over the next ticks (run here), as if the points had come in.
     */
    finishResearch(tech: TechId) {
      const t = session.game.state.economy.tech;
      const fill = (id: TechId) => {
        if (t.researched.includes(id)) return;
        for (const r of TECHS[id].requires) fill(r);
        t.progress[id] = TECHS[id].cost;
      };
      fill(tech);
      for (let i = 0; i < 10 && !t.researched.includes(tech); i++) session.advanceTicks(1, performance.now());
      return t.researched.includes(tech);
    },
    /** Hands the game to a headless bot (economy, raider, fortress, doNothing): it decides before every tick. */
    async autopilot(bot: string) {
      const { BOT_NAMES, createController } = await import('../headless/bots');
      const name = BOT_NAMES.find((b) => b === bot);
      if (!name) throw new Error(`unknown bot ${bot}`);
      const controller = createController(name);
      session.autopilot = (game) => controller(game, []);
    },
    /**
     * Performance scenario: `soldiers` around the core, fast-forward to the start of night `night`,
     * then `mutants` assaulting from a ring 12-22 tiles out (sturdier and weaker than normal so
     * both sides last while frames are measured).
     */
    async stress(opts: { soldiers: number; mutants: number; night: number }) {
      const { deployArmy, releaseHorde } = await import('../sim/scenarios');
      deployArmy(session.game, opts.soldiers);
      while (!session.isOver && !(view().clock.phase === 'night' && view().clock.day >= opts.night)) session.advanceTicks(20, performance.now());
      releaseHorde(session.game, opts.mutants, { hpPct: 6, damagePct: -0.85 });
      return this.onScreen();
    },
    /** Living soldiers and mutants inside the camera view. */
    onScreen() {
      const r = viewWorldRect(session.camera);
      let soldiers = 0;
      let mutants = 0;
      for (const e of view().entities.values()) {
        if (e.hp <= 0 || e.x < r.x0 || e.x > r.x1 || e.y < r.y0 || e.y > r.y1) continue;
        if (e.kind === 'soldier') soldiers++;
        else if (e.kind === 'mutant') mutants++;
      }
      return { soldiers, mutants };
    },
  };
}

export function installDebugHook(session: Session, profile: FrameProfile, renderer: DebugRenderer): () => void {
  if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('debug')) return () => {};
  window.scraphold = debugApi(session, profile, renderer);
  return () => {
    if (window.scraphold?.session === session) delete window.scraphold;
  };
}
