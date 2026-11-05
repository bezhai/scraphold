// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { clockAt, createGame } from '../../sim';
import { INCIDENTS } from '../../sim/data/incidents';
import { DAY_TICKS, DUSK_TICKS } from '../../sim/time';
import { Session } from '../session';
import { IncidentModal } from './IncidentModal';

afterEach(cleanup);

function sessionWithCaravan(tick: number): Session {
  const game = createGame({ seed: 'incident-card', origin: 'scavengers', difficulty: 'normal' });
  const def = INCIDENTS.caravan;
  game.state.tick = tick;
  game.state.clock = clockAt(tick);
  game.state.incidents.pending = {
    id: 7,
    definitionId: 'caravan',
    raisedTick: 100,
    deadlineTick: DAY_TICKS,
    title: def.title,
    description: def.description,
    choices: def.choices.map((c) => ({ ...c, description: '效果描述' })),
    target: null,
  };
  const session = new Session(game, { viewW: 1440, viewH: 900 });
  session.openIncidentModal();
  return session;
}

describe('IncidentModal', () => {
  it('uses the finalized wording, without emoji; 查看地图 closes the card and keeps the incident pending', () => {
    const session = sessionWithCaravan(200);
    render(<IncidentModal session={session} />);
    const card = screen.getByTestId('incident-modal');
    expect(card.textContent).toContain('白天事件');
    expect(card.textContent).toContain('按 1–3 选择，按 Esc 先去看地图');
    expect(card.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(card.textContent).not.toContain('天黑前不处理');
    const close = screen.getByTestId('close-incident');
    expect(close.textContent).toBe('查看地图 Esc');
    fireEvent.click(close);
    expect(session.incidentModalOpen).toBe(false);
    expect(session.game.state.incidents.pending).not.toBeNull();
  });

  it('at dusk it warns that nightfall settles it, without a countdown (time stands still while the card is open)', () => {
    const session = sessionWithCaravan(DAY_TICKS - DUSK_TICKS + 40);
    render(<IncidentModal session={session} />);
    const card = screen.getByTestId('incident-modal');
    expect(card.textContent).toContain('天黑前不处理，会按最后一个选项结算');
    expect(card.textContent).not.toMatch(/\d+\s*(s|秒)/);
  });
});
