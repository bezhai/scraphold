// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../sim';
import { ORIGIN_IDS } from '../../sim/data/economy';
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

  it('introduces the game with the start-screen paragraph of docs/narrative.md', () => {
    const paragraph = readFileSync('docs/narrative.md', 'utf8').split('开始界面的介绍段落：\n\n> ')[1]!.split('\n')[0];
    render(<StartScreen best={{}} onStart={vi.fn()} />);
    expect(screen.getByTestId('pitch').textContent).toBe(paragraph);
  });

  it('shows each camp origin with its effects only, without a background quote', () => {
    render(<StartScreen best={{}} onStart={vi.fn()} />);
    for (const id of ORIGIN_IDS) {
      const card = screen.getByTestId(`origin-${id}`);
      expect([...card.children].map((c) => c.className)).toEqual(['o-tag', 'o-name', 'o-desc', 'o-start']);
    }
  });

  it('offers to continue the autosave; the delete button explains what it deletes', () => {
    saveAutoSave(createGame({ seed: 'start-save', origin: 'militia', difficulty: 'normal' }));
    render(<StartScreen best={{}} onStart={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByTestId('continue-game').textContent).toBe('继续游戏（第 1 天 · 民兵哨所）');
    expect(screen.getByTestId('delete-save').getAttribute('title')).toBe('删除这台电脑上的自动存档');
  });
});
