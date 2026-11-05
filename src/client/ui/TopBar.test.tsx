// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { TopBar } from './TopBar';

afterEach(cleanup);

describe('TopBar', () => {
  it('the worker readout selects the idle survivors, like G', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    render(<TopBar session={session} onCalendarHover={() => {}} />);
    fireEvent.click(screen.getByTestId('select-idle'));
    expect([...session.selection].sort()).toEqual([w.survivor1.id, w.survivor2.id].sort());
  });

  it('survivors read as a total with the idle count below; population reads people / housing', () => {
    const w = buildTestWorld();
    w.survivor1.insideId = w.greenhouse.id;
    w.survivor1.task = { type: 'work', buildingId: w.greenhouse.id };
    w.game.state.economy.housingCap = 12;
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    render(<TopBar session={session} onCalendarHover={() => {}} />);
    expect(screen.getByTestId('pop-survivors').textContent).toBe('2');
    expect(screen.getByTestId('select-idle').textContent).toContain('幸存者（空闲 1）');
    expect(screen.getByTestId('pop-housing').textContent).toBe('5/12');
    expect(screen.getByTestId('pop-housing-item').textContent).toContain('人口 / 住房');
  });

  it('has the objectives button; tonight’s report says when no attack is coming or the fog hides the directions', () => {
    const w = buildTestWorld();
    w.game.state.clock = { ...w.game.state.clock, phase: 'dusk' };
    w.game.state.night.forecast = { night: 1, directionsKnown: true, precise: false, groups: [] };
    const session = new Session(w.game, { viewW: 1440, viewH: 900 });
    const { rerender } = render(<TopBar session={session} onCalendarHover={() => {}} />);
    expect(screen.getByTestId('objectives-capsule')).toBeTruthy();
    expect(screen.getByTestId('forecast').textContent).toBe('今夜来袭无');
    w.game.state.night.forecast = { night: 1, directionsKnown: false, precise: false, groups: [] };
    rerender(<TopBar session={session} onCalendarHover={() => {}} />);
    expect(screen.getByTestId('forecast').textContent).toBe('今夜来袭方向不明');
  });
});
