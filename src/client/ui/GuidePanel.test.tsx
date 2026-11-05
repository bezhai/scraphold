// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { GuidePanel } from './GuidePanel';

afterEach(cleanup);

describe('GuidePanel', () => {
  it('folds down to the next step and back; every step keeps its id for the done state', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    render(<GuidePanel session={session} calendarSeen={false} />);
    const guide = screen.getByTestId('guide');
    expect(guide.textContent).toContain('1/8');
    expect(screen.getByTestId('guide-barracks').className).toContain('done');
    fireEvent.click(screen.getByTestId('guide-toggle'));
    expect(screen.getByTestId('guide').className).toContain('collapsed');
    expect(screen.getByTestId('guide').querySelectorAll('li')).toHaveLength(8);
    expect(screen.getByTestId('guide-produce').className).toContain('next');
    fireEvent.click(screen.getByTestId('guide-toggle'));
    expect(screen.getByTestId('guide').className).not.toContain('collapsed');
  });

  it('closes for good', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    const { rerender } = render(<GuidePanel session={session} calendarSeen={false} />);
    fireEvent.click(screen.getByTestId('guide-close'));
    rerender(<GuidePanel session={session} calendarSeen={false} />);
    expect(screen.queryByTestId('guide')).toBeNull();
  });

  it('ticks off the calendar step once the calendar was hovered', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    render(<GuidePanel session={session} calendarSeen={true} />);
    expect(screen.getByTestId('guide-calendar').className).toContain('done');
    expect(screen.getByTestId('guide').textContent).toContain('2/8');
  });
});
