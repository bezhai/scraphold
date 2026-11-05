/** Measure, without changing combat: starting militia attacks the nearest ordinary nest on day 1 or 2. */
import { writeFileSync } from 'node:fs';
import { applyCommand, createGame, drainEvents, stepGame } from '../sim';
import { CYCLE_TICKS, DAY_TICKS, TICKS_PER_SECOND } from '../sim/time';
import { ORIGIN_IDS } from '../sim/data/economy';
const count = Number(process.argv.find(a => a.startsWith('--seeds='))?.slice(8) ?? 20);
const results = [];
for (const origin of ORIGIN_IDS) for (const day of [1, 2]) for (let i = 1; i <= count; i++) {
  const game = createGame({ seed: `balance-${i}`, origin, difficulty: 'normal' });
  const army = [...game.state.entities.values()].filter(e => e.kind === 'soldier');
  if (!army.length) { results.push({ seed: `balance-${i}`, origin, day, soldiers: 0, attempted: false }); continue; }
  const start = (day - 1) * CYCLE_TICKS;
  while (game.state.tick < start) { stepGame(game); drainEvents(game); }
  const core = game.state.entities.get(game.state.coreId)!;
  const target = [...game.state.entities.values()].filter(e => e.kind === 'nest' && !e.isHive).sort((a,b) => Math.hypot(a.x-core.x,a.y-core.y)-Math.hypot(b.x-core.x,b.y-core.y) || a.id-b.id)[0]!;
  const initialHp = army.reduce((sum,s) => sum+s.hp,0);
  const command = applyCommand(game, { type:'attackMove', unitIds:army.map(s=>s.id), x:target.x,y:target.y });
  if (!command.ok) throw new Error(command.reason);
  while (game.state.tick < start + DAY_TICKS && game.state.outcome.status === 'playing' && target.hp > 0 && army.some(s=>s.hp>0)) { stepGame(game); drainEvents(game); }
  results.push({seed:`balance-${i}`,origin,day,soldiers:army.length,attempted:true,success:target.hp<=0,seconds:(game.state.tick-start)/TICKS_PER_SECOND,dead:army.filter(s=>s.hp<=0).length,hpLost:initialHp-army.reduce((sum,s)=>sum+Math.max(0,s.hp),0),targetHpLeft:Math.max(0,target.hp)});
}
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6) ?? '/tmp/task9-early-raids.json';
writeFileSync(out,JSON.stringify({seeds:count,limitSeconds:DAY_TICKS/TICKS_PER_SECOND,results},null,2)+'\n');
for(const origin of ORIGIN_IDS)for(const day of [1,2]) {
 const rows=results.filter(r=>r.origin===origin&&r.day===day);const attempts=rows.filter(r=>r.attempted);const wins=attempts.filter(r=>r.success);
 console.log(JSON.stringify({origin,day,attempts:attempts.length,successes:wins.length,seconds:wins.map(r=>r.seconds),deaths:attempts.reduce((s,r)=>s+(r.dead??0),0),hpLost:attempts.map(r=>r.hpLost)}));
}
