// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../sim';
import { DAY_TICKS } from '../../sim/time';
import { Session } from '../session';
import { CalendarStrip } from './CalendarStrip';

afterEach(cleanup);

function newSession() {
  return new Session(createGame({ seed: 'cal-strip', origin: 'scavengers', difficulty: 'normal' }), { viewW: 1440, viewH: 900 });
}

describe('CalendarStrip', () => {
  it('shows four nights with the hover card, colour-coded by the real night type', () => {
    const session = newSession();
    render(<CalendarStrip session={session} onHover={() => {}} />);
    expect(screen.getByTestId('cal-night-1').className).toContain('night-calm');
    expect(screen.getByTestId('cal-night-1').textContent).toBe('今晚平静');
    const tip = screen.getByTestId('calendar-tip');
    expect(tip.textContent).toContain('雾情日历');
    expect(tip.textContent).toContain('今晚（第 1 夜）· 平静');
  });

  it('hides its hover card while the objectives card is open, so the two never overlap', () => {
    const session = newSession();
    session.objectivesOpen = true;
    render(<CalendarStrip session={session} onHover={() => {}} />);
    expect(screen.queryByTestId('calendar-tip')).toBeNull();
  });

  it('reports a hover (the guide step) and does nothing on click', () => {
    const session = newSession();
    const onHover = vi.fn();
    render(<CalendarStrip session={session} onHover={onHover} />);
    fireEvent.mouseEnter(screen.getByTestId('calendar-strip'));
    expect(onHover).toHaveBeenCalledTimes(1);
    const version = session.version;
    fireEvent.click(screen.getByTestId('calendar-strip'));
    expect(session.version).toBe(version);
    expect(session.incidentModalOpen).toBe(false);
  });

  it('warns about the post-storm vision penalty with the simulation’s number', () => {
    const session = newSession();
    session.game.state.calendar.reducedVisionUntilTick = session.game.state.tick + DAY_TICKS;
    render(<CalendarStrip session={session} onHover={() => {}} />);
    expect(screen.getByTestId('calendar-tip').textContent).toContain('锈风暴过后，今天白天视野降低 20%。');
  });
});
