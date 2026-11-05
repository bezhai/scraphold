// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { GAME_END_TICK } from '../../sim/time';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { EndScreen } from './EndScreen';

afterEach(cleanup);

const DEFEAT_NOTE = '只有获胜才产生成绩';

function endScreen(outcome: Session['game']['state']['outcome']) {
  const { game } = buildTestWorld();
  game.state.outcome = outcome;
  const session = new Session(game, { viewW: 1440, viewH: 900 });
  render(<EndScreen session={session} best={{}} newBest={false} onRestart={() => {}} onQuit={() => {}} />);
  return screen.getByTestId('end-screen');
}

describe('EndScreen', () => {
  it('a victory shows its score and never the defeat note', () => {
    const end = endScreen({
      status: 'won',
      reason: 'survived',
      endTick: GAME_END_TICK,
      score: { victory: 1000, earlyDays: 0, hive: 0, nests: 0, survivors: 40, buildingsLost: 0, multiplier: 1, total: 1040 },
    });
    expect(end.textContent).toContain('守到了第 21 天');
    expect(end.querySelector('.score-total')?.textContent).toContain('1040');
    expect(end.textContent).not.toContain(DEFEAT_NOTE);
  });

  it('a victory without a score breakdown (the simulation always gives one) still does not claim it was not a win', () => {
    const end = endScreen({ status: 'won', reason: 'hiveDestroyed', endTick: 3000, score: null });
    expect(end.textContent).not.toContain(DEFEAT_NOTE);
  });

  it('a defeat explains why there is no score', () => {
    const end = endScreen({ status: 'lost', reason: 'coreDestroyed', endTick: 3000, score: null });
    expect(end.textContent).toContain(DEFEAT_NOTE);
    expect(end.textContent).toContain('炉心在第 2 天熄灭');
  });
});
