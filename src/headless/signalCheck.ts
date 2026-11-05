/** node --import tsx src/headless/signalCheck.ts [seed ...] */
import { ORIGIN_IDS, type OriginId } from '../sim/data/economy';
import { createController } from './bots';
import { runHeadless } from './run';
const origin = (process.argv.find(a => a.startsWith('--origin='))?.slice(9) ?? 'scavengers') as OriginId;
if (!ORIGIN_IDS.includes(origin)) throw new Error('Unknown origin');
const seeds = process.argv.slice(2).filter(a => !a.startsWith('--origin='));
const days: number[] = [];
for (const seed of seeds.length ? seeds : ['signal-1', 'signal-2', 'signal-3', 'signal-4', 'signal-5']) {
  const controller = createController('signal');
  let stage = ''; let day = 0;
  const r = runHeadless({ seed, difficulty: 'normal', origin, days: 20, controller: (game, events) => {
    if (process.env.SIGNAL_TRACE && (game.state.signal.stage !== stage || game.state.clock.day !== day)) {
      stage = game.state.signal.stage; day = game.state.clock.day;
      const b = game.state.entities.get(game.state.signal.buildingId);
      console.error(JSON.stringify({ seed, day, stage, visited: game.state.signal.visited, discovered: game.state.signal.discovered,
        research: game.state.economy.tech.researched, resources: game.state.economy.resources,
        tower: b?.kind === 'building' ? { hp: b.hp, workers: b.workers.length, progress: b.construction } : null }));
    }
    return controller(game, events);
  } });
  if (r.reason === 'signal') days.push(r.clock.day);
  console.log(JSON.stringify({ seed, origin, outcome: r.outcome, reason: r.reason, day: r.clock.day, ticks: r.ticks, score: r.score, hash: r.hash, commands: r.commands }));
}
console.log(JSON.stringify({ signalWins: days.length, days, distribution: Object.fromEntries([...new Set(days)].sort((a,b) => a-b).map(d => [d, days.filter(x => x === d).length])) }));
