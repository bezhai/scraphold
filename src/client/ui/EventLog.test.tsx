// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { RADIO_BROADCASTS, clockAt } from '../../sim';
import { INCIDENTS } from '../../sim/data/incidents';
import { DAY_TICKS } from '../../sim/time';
import { FEED_FADE_TICKS, FEED_HOLD_TICKS } from '../hud/eventLog';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { EventLog } from './EventLog';

afterEach(cleanup);

describe('EventLog', () => {
  it('collapsed it shows only fresh lines; expanding lists the older ones too', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    const now = FEED_HOLD_TICKS + FEED_FADE_TICKS + 100;
    w.game.state.tick = now;
    session.log = [
      { id: 1, tick: 0, text: '很久以前的事', tone: 'info' },
      { id: 2, tick: now - 10, text: '刚刚发生的事', tone: 'good' },
    ];
    render(<EventLog session={session} />);
    const log = screen.getByTestId('event-log');
    expect(log.textContent).toContain('刚刚发生的事');
    expect(log.textContent).not.toContain('很久以前的事');
    fireEvent.click(screen.getByTestId('log-toggle'));
    expect(screen.getByTestId('event-log').textContent).toContain('很久以前的事');
  });

  it('keeps the pending incident at the top; clicking it reopens the card', () => {
    const w = buildTestWorld();
    const def = INCIDENTS.caravan;
    w.game.state.incidents.pending = {
      id: 4, definitionId: 'caravan', raisedTick: 100, deadlineTick: DAY_TICKS, title: def.title, description: def.description,
      choices: def.choices.map((c) => ({ ...c, description: '' })), target: null,
    };
    w.game.state.tick = 400;
    w.game.state.clock = clockAt(400);
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    const { rerender } = render(<EventLog session={session} />);
    const item = screen.getByTestId('pending-incident');
    expect(item.textContent).toBe(`待处理：${def.title}（点击或按 Tab 打开）`);
    fireEvent.click(item);
    expect(session.incidentModalOpen).toBe(true);

    // Dusk: seconds of game time to nightfall, blinking over the last 10.
    w.game.state.tick = DAY_TICKS - 12 * 20;
    w.game.state.clock = clockAt(w.game.state.tick);
    rerender(<EventLog session={session} />);
    expect(screen.getByTestId('pending-incident').textContent).toBe(`待处理：${def.title}（点击或按 Tab 打开） · 天黑还剩 12 秒`);
    expect(screen.getByTestId('pending-incident').className).not.toContain('urgent');
    w.game.state.tick = DAY_TICKS - 9 * 20;
    w.game.state.clock = clockAt(w.game.state.tick);
    rerender(<EventLog session={session} />);
    expect(screen.getByTestId('pending-incident').className).toContain('urgent');
  });

  it('shows the dusk radio broadcast from the state', () => {
    const w = buildTestWorld();
    const text = RADIO_BROADCASTS.denseFog[1]!;
    w.game.state.night.broadcast = { night: 1, type: 'denseFog', text };
    w.game.state.tick = DAY_TICKS - 200;
    w.game.state.clock = clockAt(w.game.state.tick);
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    render(<EventLog session={session} />);
    expect(screen.getByTestId('event-log').textContent).toContain(text);
  });
});
