// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { REJECT_REASON_TEXT, createGame, type SignalStage } from '../../sim';
import { addBuilding } from '../../sim/world/entities';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { SelectionPanel } from './SelectionPanel';

afterEach(cleanup);

const VIEW = { viewW: 1440, viewH: 900 };

function towerPanel(stage: SignalStage) {
  const w = buildTestWorld();
  const tower = addBuilding(w.game, 'signalTower', 0, 5, { complete: stage !== 'repair' });
  Object.assign(w.game.state.signal, { buildingId: tower.id, stage, nightsHeld: 1, nightsRequired: 3 });
  const session = new Session(w.game, VIEW);
  session.select([tower.id]);
  render(<SelectionPanel session={session} />);
  return screen.getByTestId('selection-panel');
}

describe('SelectionPanel', () => {
  it('a selected hive shows the shield rule instead of the old guard and score line', () => {
    const game = createGame({ seed: 'sel-hive', origin: 'militia', difficulty: 'normal' });
    const hive = [...game.state.entities.values()].find((e) => e.kind === 'nest' && e.isHive)!;
    if (hive.kind === 'nest') hive.discovered = true;
    const session = new Session(game, VIEW);
    session.select([hive.id]);
    render(<SelectionPanel session={session} />);
    const desc = screen.getByTestId('selection-panel').querySelector('.sel-desc')?.textContent;
    expect(desc).toMatch(/^地图上每剩一个普通巢穴，母巢受到的伤害降低 \d+%，最多降低 \d+%。现在还剩 8 个，减伤 \d+%。$/);
    expect(screen.getByTestId('selection-panel').textContent).not.toContain('得分更高');
  });

  it('is not there while nothing is selected, and shows the selection once something is', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, VIEW);
    const { rerender } = render(<SelectionPanel session={session} />);
    expect(screen.queryByTestId('selection-panel')).toBeNull();
    session.select([w.barracks.id]);
    rerender(<SelectionPanel session={session} />);
    expect(screen.getByTestId('selection-panel').textContent).toContain('兵营');
  });

  it('a selected soldier gets the retreat button with its hotkey and hover text', () => {
    const w = buildTestWorld();
    const session = new Session(w.game, VIEW);
    session.select([w.rifle1.id]);
    render(<SelectionPanel session={session} />);
    const button = screen.getByTestId('retreat-btn');
    expect(button.querySelector('.key')?.textContent).toBe('K');
    expect(button.firstChild?.textContent?.trim()).toBe('撤退回炉心');
    expect(button.querySelector('.tip')?.textContent).toBe('选中的士兵不再交战，直接跑回炉心附近。想撤到别处，用 Ctrl+右键点位置。');
  });

  it('the signal tower under construction shows its stage and crew buttons, and no help-build button', () => {
    const panel = towerPanel('repair');
    expect(screen.getByTestId('signal-stage').textContent).toBe('修建中');
    expect(screen.getByTestId('add-worker')).toBeTruthy();
    expect(screen.queryByTestId('repair')).toBeNull();
    expect(panel.textContent).not.toContain('派人帮忙建造');
    expect(panel.textContent).not.toContain('剩');
  });

  it('the finished tower offers 开始广播 with its hover text', () => {
    towerPanel('ready');
    expect(screen.getByTestId('signal-stage').textContent).toBe('可以广播');
    const start = screen.getByTestId('start-broadcast');
    expect(start.firstChild?.textContent).toBe('开始广播');
    expect(start.querySelector('.tip')?.textContent).toBe('开始向长明城广播。之后的夜里会有一队怪物专门来打信号塔，守住 3 晚，车队就会到。塔被毁会中断广播。');
    expect(screen.queryByTestId('add-worker')).toBeNull();
  });

  it('while broadcasting only the progress shows: no start button and no refusal reason over it', () => {
    const panel = towerPanel('broadcast');
    expect(screen.getByTestId('signal-stage').textContent).toBe('广播中 · 已守住 1/3 晚');
    expect(screen.queryByTestId('start-broadcast')).toBeNull();
    expect(panel.textContent).not.toContain(REJECT_REASON_TEXT.signalNotReady);
    expect(panel.querySelectorAll('[data-testid="signal-stage"]')).toHaveLength(1);
  });
});
