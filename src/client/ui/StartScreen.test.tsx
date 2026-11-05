// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../sim';
import { clearAutoSave, saveAutoSave } from '../storage/autoSave';
import { StartScreen } from './StartScreen';

afterEach(() => {
  cleanup();
  clearAutoSave();
});

describe('StartScreen', () => {
  it('starts with the chosen origin, difficulty and custom seed', () => {
    const onStart = vi.fn();
    render(<StartScreen best={{}} onStart={onStart} />);
    fireEvent.click(screen.getByTestId('origin-militia'));
    fireEvent.click(screen.getByTestId('difficulty-hard'));
    fireEvent.click(screen.getByTestId('seed-custom'));
    fireEvent.input(screen.getByPlaceholderText('输入任意文字作为种子'), { target: { value: '  废土 7 ' } });
    fireEvent.click(screen.getByTestId('start'));
    expect(onStart).toHaveBeenCalledWith({ seed: '废土 7', origin: 'militia', difficulty: 'hard' });
  });

  it('does not start with an empty custom seed', () => {
    const onStart = vi.fn();
    render(<StartScreen best={{}} onStart={onStart} />);
    fireEvent.click(screen.getByTestId('seed-custom'));
    fireEvent.click(screen.getByTestId('start'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('daily mode uses today’s date and shows local best scores', () => {
    const onStart = vi.fn();
    render(<StartScreen best={{ normal: { score: 1234, seed: 'abc', origin: 'scholars', day: 11, at: '2026-10-30T00:00:00.000Z' } }} onStart={onStart} />);
    expect(screen.getByText('1234')).toBeTruthy();
    fireEvent.click(screen.getByTestId('seed-daily'));
    fireEvent.click(screen.getByTestId('start'));
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(onStart).toHaveBeenCalledWith({ seed: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`, origin: 'scavengers', difficulty: 'normal' });
  });

  it('introduces the game with the finalized paragraph', () => {
    render(<StartScreen best={{}} onStart={vi.fn()} />);
    expect(screen.getByTestId('pitch').textContent).toBe(
      '白天派幸存者拾荒、种地、炼油、做研究，把据点建起来；夜里变异体从雾里摸过来，守住炉心。撑过二十夜、修好 K-7 中继站向长明城求救、找到母巢把它端掉，三条路都能赢。',
    );
  });

  it('offers to continue the autosave; the delete button explains what it deletes', () => {
    saveAutoSave(createGame({ seed: 'start-save', origin: 'militia', difficulty: 'normal' }));
    render(<StartScreen best={{}} onStart={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByTestId('continue-game').textContent).toBe('继续游戏（第 1 天 · 民兵哨所）');
    expect(screen.getByTestId('delete-save').getAttribute('title')).toBe('删除这台电脑上的自动存档');
  });
});
