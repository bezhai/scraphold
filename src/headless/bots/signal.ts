/** Economic/scientific relay strategy. Only public state, commands and existing bot machinery. */
import { buildingCost, validateCommand, nightType, type Soldier } from '../../sim';
import type { Controller } from '../run';
import { createBot } from './bot';
import { findSite } from './sites';
import { economyFirst } from './economyFirst';
import { knowsOil, nearCore } from './common';
import type { Context, Strategy } from './strategy';

export function signalStrategy(): Strategy {
  const base = economyFirst({ switchDay: 4 });
  return {
    ...base, name: 'signal', raids: null, scouts: 1,
    research: ['scavengingTools', 'hydroponics', 'armory', 'demolitions', 'communityPlan', 'refinery', 'ruinArchives', 'oldFrequency', 'relayPower', 'machineGuns', 'reinforcement', 'windReinforcement', 'signalAmplification'],
    policies: ctx => ctx.game.state.signal.buildingId ? ['fullBroadcast', 'scholarsFirst', 'salvageDrive'] : ['salvageDrive', 'scholarsFirst', 'harvestFestival'],
    workforce: ctx => ({ food: .42, scrap: .28, research: .2, fuel: ctx.game.state.economy.resources.fuel < 100 ? .1 : .01, support: .03 }),
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

export function createSignalBot(): Controller {
  const strategy = signalStrategy();
  let escort: number[] = [];
  let lastOrder = -1000;
  return createBot(strategy, (ctx: Context) => {
    const { game, turn, snap } = ctx;
    const signal = game.state.signal;
    // Keep the fuel supply staffed before committing workers to the relay.
    if (game.state.economy.resources.fuel < 100) for (const oil of snap.buildings.filter(b => b.type === 'oilWell' && !b.construction)) {
      const assigned = snap.survivors.filter(s => s.task.type === 'work' && s.task.buildingId === oil.id).length;
      if (assigned < 2) {
        const s = turn.takeIdle(oil.x, oil.y);
        if (s) turn.issue({ type: 'assignWork', buildingId: oil.id, unitIds: [s.id] });
      }
    }
    if (!signal.site || !signal.discovered) return;
    const x = signal.site.tileX - 1; const y = signal.site.tileY + 1.5;
    if (!signal.visited) {
      const scout = snap.soldiers.find(s => s.type === 'scout');
      if (scout && game.state.tick - lastOrder >= 100) { turn.issue({ type: 'move', unitIds: [scout.id], x, y }); lastOrder = game.state.tick; }
    }
    const tower = snap.buildings.find(b => b.id === signal.buildingId);
    if (!tower) {
      const alive = escort.filter(id => snap.soldiers.some(s => s.id === id));
      for (const id of alive) ctx.memory.roles.set(id, 'garrison');
      if (alive.length) turn.issue({ type: 'move', unitIds: alive, x: ctx.core.x, y: ctx.core.y + 3 });
      escort = [];
      return;
    }
    if (tower.construction) {
      const assigned = snap.survivors.filter(s => s.task.type === 'work' && s.task.buildingId === tower.id).length;
      for (let i = assigned; i < 3; i++) {
        const s = turn.takeIdle(tower.x, tower.y);
        if (s) turn.issue({ type: 'assignWork', buildingId: tower.id, unitIds: [s.id] });
        else {
          const from = snap.buildings.find(b => b.id !== tower.id && b.workers.length > 1);
          if (from) turn.issue({ type: 'unassignWork', buildingId: from.id, count: 1 });
          break;
        }
      }
    } else if (tower.workers.length > 0) turn.issue({ type: 'unassignWork', buildingId: tower.id, count: tower.workers.length });
    // Before committing to broadcast, keep the field army home through nearby surges.
    const surgeSoon = [0, 1, 2].some(offset => nightType(game.state, ctx.day + offset) === 'surge');
    if (surgeSoon && signal.stage !== 'broadcast') {
      const alive = escort.filter(id => snap.soldiers.some(s => s.id === id));
      for (const id of alive) ctx.memory.roles.set(id, 'garrison');
      if (alive.length) turn.issue({ type: 'move', unitIds: alive, x: ctx.core.x, y: ctx.core.y + 3 });
      escort = [];
      return;
    }
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
    // Override the shared home defense order only for the explicitly reserved outpost escort.
    for (const id of escort) ctx.memory.roles.set(id, 'raid');
    if (game.state.tick - lastOrder >= 100) { turn.issue({ type: 'attackMove', unitIds: escort, x, y }); lastOrder = game.state.tick; }
  });
}
