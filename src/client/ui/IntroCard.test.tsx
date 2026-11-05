// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { IntroCard } from './IntroCard';

afterEach(cleanup);

/** The day-1 card of docs/narrative.md「开局介绍」: its bold title line, then one line per paragraph. */
function narrativeCard(): { title: string; paragraphs: string[] } {
  const section = readFileSync('docs/narrative.md', 'utf8').split('第 1 天开局时弹出的一张介绍卡')[1]!.split('\n## ')[0]!;
  const lines = [...section.matchAll(/^> (.+)$/gm)].map((m) => m[1]!);
  return { title: lines[0]!.replace(/^\*\*(.*)\*\*$/, '$1'), paragraphs: lines.slice(1) };
}

describe('IntroCard', () => {
  it('shows the day-1 card of docs/narrative.md verbatim and nothing above its title', () => {
    render(<IntroCard session={new Session(buildTestWorld().game, { viewW: 1440, viewH: 900 })} />);
    const card = screen.getByTestId('intro-card').querySelector('.intro-card')!;
    const { title, paragraphs } = narrativeCard();
    expect(card.firstElementChild!.className).toBe('intro-title');
    expect(card.querySelector('.intro-title')!.textContent).toBe(title);
    expect([...card.querySelectorAll('.intro-body p')].map((p) => p.textContent)).toEqual(paragraphs);
  });
});
