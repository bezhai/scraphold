// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { ObjectivesButton, ObjectivesCard } from './ObjectivesPanel';

afterEach(cleanup);

describe('objectives', () => {
  it('the top bar button reads 目标 (O) and toggles the card', () => {
    const session = new Session(buildTestWorld().game, { viewW: 1440, viewH: 900 });
    render(<ObjectivesButton session={session} />);
    const button = screen.getByTestId('objectives-capsule');
    expect(button.textContent).toBe('目标O');
    fireEvent.click(button);
    expect(session.objectivesOpen).toBe(true);
    fireEvent.click(button);
    expect(session.objectivesOpen).toBe(false);
  });

  it('the card lists the three routes under 胜利目标 and closes with its button', () => {
    const session = new Session(buildTestWorld().game, { viewW: 1440, viewH: 900 });
    session.objectivesOpen = true;
    render(<ObjectivesCard session={session} />);
    const card = screen.getByTestId('objectives-card');
    expect(card.textContent).toContain('胜利目标');
    expect([...card.querySelectorAll('.route-title')].map((e) => e.textContent)).toEqual(['坚守撑过二十夜', '清巢摧毁母巢', '求援信号塔']);
    fireEvent.click(screen.getByTestId('objectives-close'));
    expect(session.objectivesOpen).toBe(false);
  });
});
