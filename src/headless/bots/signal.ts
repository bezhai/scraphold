/** Economic/scientific relay strategy. Only public state, commands and existing bot machinery. */
import { buildingCost, validateCommand, nightType, type Soldier } from '../../sim';
import type { Controller } from '../run';
import { handBack } from './army';
import { createBot } from './bot';
import { findSite } from './sites';
import { economyFirst } from './economyFirst';
import { knowsOil, nearCore } from './common';
import type { Context, Strategy } from './strategy';

export function signalStrategy(): Strategy {
  const base = economyFirst({ switchDay: 6 });
  return {
    ...base, name: 'signal', raids: null, scouts: 1,
    research: ['scavengingTools', 'hydroponics', 'armory', 'demolitions', 'communityPlan', 'refinery', 'ruinArchives', 'oldFrequency', 'relayPower', 'machineGuns', 'reinforcement', 'windReinforcement', 'signalAmplification'],
    policies: ctx => ctx.game.state.signal.buildingId ? ['fullBroadcast', 'scholarsFirst', 'salvageDrive'] : ['salvageDrive', 'harvestFestival', 'scholarsFirst'],
    workplaces: ctx => ({ food: .42, scrap: .28, research: .2, fuel: ctx.game.state.economy.resources.fuel < 100 ? .1 : .01, support: .03 }),
    army: ctx => ({ ...base.army(ctx), scout: ctx.game.state.signal.visited ? 0 : 1 }),
    build(ctx) {
      const signal = ctx.game.state.signal;
      if (ctx.count('oilWell') === 0 && ctx.day >= 3 && knowsOil(ctx)) {
        const site = findSite(ctx.game, 'oilWell', { maxDistance: 30, score: (_x, _y, d) => -d });
        if (site) return { type: 'oilWell', site };
      }
      if (signal.stage === 'repair' && !signal.buildingId && ctx.day >= 8 && signal.site && ctx.turn.canAfford(buildingCost(ctx.game.modifiers, 'signalTower'))) return { type: 'signalTower', site: signal.site };
      if (ctx.researchPending && ctx.count('researchStation') < 2 && ctx.day >= 4) return nearCore('researchStation');
      return base.build(ctx);
    },
    reserve: ctx => ctx.day >= 8 && ctx.game.state.signal.stage === 'repair' && !ctx.game.state.signal.buildingId ? buildingCost(ctx.game.modifiers, 'signalTower') : {},
  };
}

/** Escorts within this distance (tiles) of their post by the tower hold there. */
const ESCORT_REACH = 4;

/**
 * The signal strategy plus its project: the scout visits the relay, and an escort walks to the
 * tower and holds there (hold has no end, so the soldier AI leaves it alone) until the tower falls
 * or a surge comes before the broadcast, when the escort is handed back to the soldier AI. The
 * tower crew is the survivor AI's (it staffs a signal tower site before production).
 */
export function createSignalBot(): Controller {
  const strategy = signalStrategy();
  let escort: number[] = [];
  let scoutOrderTick = -1000;
  return createBot(strategy, (ctx: Context) => {
    const { game, turn, snap } = ctx;
    const signal = game.state.signal;
    if (!signal.site || !signal.discovered) return;
    const post = { x: signal.site.tileX - 1, y: signal.site.tileY + 1.5 };
    if (!signal.visited) {
      const scout = snap.soldiers.find(s => s.type === 'scout');
      if (scout && game.state.tick - scoutOrderTick >= 100) {
        turn.issue({ type: 'move', unitIds: [scout.id], ...post });
        scoutOrderTick = game.state.tick;
      }
    }
    const release = () => {
      const alive = snap.soldiers.filter(s => escort.includes(s.id));
      for (const s of alive) ctx.memory.roles.set(s.id, 'garrison');
      handBack(ctx, alive);
      escort = [];
    };
    const tower = snap.buildings.find(b => b.id === signal.buildingId);
    if (!tower) return release();
    // Before committing to broadcast, keep the field army home through nearby surges.
    const surgeSoon = [0, 1, 2].some(offset => nightType(game.state, ctx.day + offset) === 'surge');
    if (surgeSoon && signal.stage !== 'broadcast') return release();
    const army = snap.soldiers.filter(s => s.type !== 'scout');
    escort = escort.filter(id => army.some(s => s.id === id));
    const wanted = surgeSoon ? escort.length : Math.min(Math.max(0, army.length - 4), Math.max(3, Math.floor(army.length * .3)));
    const distance = (s: Soldier) => Math.hypot(s.x - tower.x, s.y - tower.y);
    for (const s of [...army].sort((a, b) => distance(a) - distance(b) || a.id - b.id)) {
      if (escort.length >= wanted) break;
      if (!escort.includes(s.id)) escort.push(s.id);
    }
    const guardsReady = army.filter(s => distance(s) <= 8 && s.hp >= s.maxHp * .6).length >= 2;
    if (signal.stage === 'ready' && ctx.phase === 'day' && !surgeSoon && tower.hp >= tower.maxHp * .85 && army.length >= 6 && guardsReady && validateCommand(game, { type: 'startSignalBroadcast' }).ok) turn.issue({ type: 'startSignalBroadcast' });
    const guards = army.filter(s => escort.includes(s.id));
    for (const s of guards) ctx.memory.roles.set(s.id, 'raid');
    const away = (s: Soldier) => Math.hypot(s.x - post.x, s.y - post.y) > ESCORT_REACH;
    const walking = guards.filter(s => away(s) && !(s.order.type === 'attackMove' && s.order.x === post.x && s.order.y === post.y));
    if (walking.length) turn.issue({ type: 'attackMove', unitIds: walking.map(s => s.id), ...post });
    const arrived = guards.filter(s => !away(s) && s.order.type !== 'hold');
    if (arrived.length) turn.issue({ type: 'hold', unitIds: arrived.map(s => s.id) });
  });
}
