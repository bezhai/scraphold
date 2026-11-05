/** 100 seeded calendars per difficulty, checked against actual edge attack plans. */
import { createGame, stepGame, drainEvents, nightType, NIGHT_TYPES, type NightType } from '../sim';
import { DIFFICULTY_IDS } from '../sim/data/combat';
import { TOTAL_NIGHTS, CYCLE_TICKS, DAY_TICKS, DUSK_TICKS } from '../sim/time';

for (const difficulty of DIFFICULTY_IDS) {
  const counts = Object.fromEntries(NIGHT_TYPES.map((type) => [type, 0])) as Record<NightType, number>;
  const surgeNights: Record<number, number> = {};
  let edgeNights = 0;
  const seeds = 100;
  for (let i = 0; i < seeds; i++) {
    const game = createGame({ seed: `calendar-check-${i}`, origin: 'militia', difficulty });
    for (let night = 1; night <= TOTAL_NIGHTS; night++) {
      // Sample each dusk through the public pipeline without running the intervening combat.
      game.state.tick = (night - 1) * CYCLE_TICKS + DAY_TICKS - DUSK_TICKS;
      stepGame(game);
      drainEvents(game);
      const type = nightType(game.state)!;
      counts[type]++;
      if (type === 'surge') surgeNights[night] = (surgeNights[night] ?? 0) + 1;
      const plan = game.state.night.plan!;
      if (plan.groups.some((group) => group.nestId === 0 && (group.boss !== null || Object.values(group.mutants).some((count) => count > 0)))) edgeNights++;
    }
  }
  console.log(JSON.stringify({ difficulty, seeds, averageNights: Object.fromEntries(NIGHT_TYPES.map((type) => [type, counts[type] / seeds])), surgeNights, edgeNights, totalNights: seeds * TOTAL_NIGHTS, edgeNightRatio: edgeNights / (seeds * TOTAL_NIGHTS) }));
}
