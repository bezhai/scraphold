/** node --import tsx src/headless/incidentCheck.ts [--start=1 --count=30] [--balance] */
import { writeFileSync } from 'node:fs';
import { INCIDENT_IDS, INCIDENT_TARGETS } from '../sim/data/incidents';
import { SPECIAL_RUINS } from '../sim/data/ruins';
import type { Game } from '../sim';
import { createController, type BotName } from './bots';
import { runHeadless } from './run';
const numberArg = (name: string, fallback: number) => Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const start = numberArg('start', 1);
const count = numberArg('count', 30);
const balance = process.argv.includes('--balance');
if (!Number.isInteger(start) || !Number.isInteger(count) || start < 1 || count < 1) throw new Error('Positive integer start/count required');
const jobs = balance ? ['economy', 'raider', 'fortress', 'signal'].map(bot => ({
  seed: 'balance-6',
  bot
})) : Array.from({
  length: count
}, (_, i) => ({
  seed: `incident-${start + i}`,
  bot: 'economy'
}));
const results = jobs.map(job => {
  const inner = createController(job.bot as BotName);
  let final: Game | null = null;
  const result = runHeadless({
    seed: job.seed,
    origin: 'scavengers',
    difficulty: 'normal',
    days: 20,
    controller: (game, events) => {
      final = game;
      return inner(game, events);
    }
  });
  const inc = (final! as Game).state.incidents;
  const appearances = [...inc.history.map(h => h.definitionId), ...(inc.pending ? [inc.pending.definitionId] : [])];
  const row = {
    seed: job.seed,
    bot: job.bot,
    outcome: result.outcome,
    reason: result.reason,
    day: result.clock.day,
    ticks: result.ticks,
    score: result.score,
    events: appearances.length,
    byType: Object.fromEntries(INCIDENT_IDS.map(id => [id, appearances.filter(x => x === id).length])),
    objectives: Object.fromEntries(Object.keys(INCIDENT_TARGETS).map(kind => {
      const targets = inc.targets.filter(t => t.kind === kind);
      return [kind, {
        accepted: targets.length,
        completed: targets.filter(t => t.status === 'completed').length,
        expired: targets.filter(t => t.status === 'expired').length,
        active: targets.filter(t => t.status === 'active').length
      }];
    })),
    specialRuinsExplored: Object.fromEntries(Object.keys(SPECIAL_RUINS).map(kind => [kind, (final! as Game).state.map.ruins.filter(r => r.kind === kind && r.explored).length])),
    resolved: inc.history.length,
    automatic: inc.history.filter(h => h.automatic).length,
    rejected: result.commands.rejected,
    hash: result.hash
  };
  console.log(JSON.stringify(row));
  return row;
});
const resolved = results.reduce((s, r) => s + r.resolved, 0);
const automatic = results.reduce((s, r) => s + r.automatic, 0);
const summary = {
  games: results.length,
  perGame: results.map(r => ({
    seed: r.seed,
    bot: r.bot,
    events: r.events,
    objectives: r.objectives,
    specialRuinsExplored: r.specialRuinsExplored
  })),
  distributions: Object.fromEntries(INCIDENT_IDS.map(id => [id, Object.fromEntries([0, 1, 2].map(n => [n, results.filter(r => r.byType[id] === n).length]))])),
  objectives: Object.fromEntries(Object.keys(INCIDENT_TARGETS).map(kind => {
    const total = results.reduce((s, r) => {
      const t = r.objectives[kind]!;
      return {
        accepted: s.accepted + t.accepted,
        completed: s.completed + t.completed,
        expired: s.expired + t.expired,
        active: s.active + t.active
      };
    }, {
      accepted: 0,
      completed: 0,
      expired: 0,
      active: 0
    });
    return [kind, {
      ...total,
      completionRate: total.accepted ? total.completed / total.accepted : 0
    }];
  })),
  resolved,
  automatic,
  automaticRate: resolved ? automatic / resolved : 0
};
console.log(JSON.stringify({
  summary
}));
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
if (out) writeFileSync(out, JSON.stringify({
  results,
  summary
}, null, 2) + '\n');
