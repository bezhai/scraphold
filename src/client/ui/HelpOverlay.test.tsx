// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { HIVE_SHIELD } from '../../sim/data/combat';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { HelpOverlay } from './HelpOverlay';

afterEach(cleanup);

/** The quoted text of a table row in docs/narrative.md「单位控制（第三版）」, by its first cell. */
function unitControlRow(label: string): string {
  const section = readFileSync('docs/narrative.md', 'utf8').split('## 单位控制（第三版）')[1]!.split('\n## ')[0]!;
  const row = section.split('\n').find((line) => line.startsWith(`| ${label} | `));
  if (!row) throw new Error(`no row ${label}`);
  return row.slice(`| ${label} | "`.length, -'" |'.length);
}

describe('HelpOverlay', () => {
  it('lists the second-version keys and all three ways to win; the core is called 炉心', () => {
    const session = new Session(buildTestWorld().game, { viewW: 1440, viewH: 900 });
    render(<HelpOverlay session={session} />);
    const help = screen.getByTestId('help-modal');
    const rows = [...help.querySelectorAll('.keys > .k')].map((k) => `${k.textContent} ${k.nextElementSibling?.textContent}`);
    expect(rows).toContain('K 撤退回炉心');
    expect(rows).toContain('O 胜利目标');
    expect(rows).toContain('Tab 打开待处理事件');
    expect(rows.some((r) => r.startsWith('Ctrl右键 强制移动'))).toBe(true);
    expect(help.textContent).toContain('炉心被摧毁就失败。满足以下任一条件获胜：守满 20 夜；摧毁母巢；修好 K-7 中继站，广播求援直到长明城的车队到达。');
    expect(help.textContent).not.toContain('据点核心');
  });

  it('explains unit control and the X, H, G and right-click keys in the words of docs/narrative.md「单位控制」', () => {
    const session = new Session(buildTestWorld().game, { viewW: 1440, viewH: 900 });
    render(<HelpOverlay session={session} />);
    const help = screen.getByTestId('help-modal');
    const rows = Object.fromEntries([...help.querySelectorAll('.keys > .k')].map((k) => [k.textContent, k.nextElementSibling?.textContent]));
    for (const key of ['右键', 'X', 'H', 'G']) expect(rows[key], key).toBe(unitControlRow(key));
    const paragraphs = [...help.querySelectorAll('p')].map((p) => p.textContent);
    // The label 单位控制 is the heading of its section.
    expect(paragraphs).toContain(unitControlRow('帮助界面').replace(/^单位控制：/, ''));
    for (const section of ['资源从哪来', '人口', '防守']) expect(paragraphs, section).toContain(unitControlRow(`帮助界面「${section}」`));
    expect(help.textContent).not.toContain('空闲幸存者');
    expect(help.textContent).not.toContain('空闲的士兵');
  });

  it('explains the hive shield with the numbers from the data table', () => {
    const session = new Session(buildTestWorld().game, { viewW: 1440, viewH: 900 });
    render(<HelpOverlay session={session} />);
    const pct = (share: number) => `${Math.round(share * 100)}%`;
    expect(screen.getByTestId('help-modal').textContent).toContain(
      `母巢：地图上每剩一个普通巢穴，母巢受到的伤害降低 ${pct(HIVE_SHIELD.reductionPerNest)}，最多降低 ${pct(HIVE_SHIELD.maxReduction)}。先清掉普通巢穴，再打母巢。`,
    );
  });
});
