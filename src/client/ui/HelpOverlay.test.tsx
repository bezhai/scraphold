// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../session';
import { buildTestWorld } from '../testWorld';
import { HelpOverlay } from './HelpOverlay';

afterEach(cleanup);

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
    expect(help.textContent).toContain('撑过二十夜、修好 K-7 中继站向长明城求救、找到母巢把它端掉，三条路都能赢。');
    expect(help.textContent).not.toContain('据点核心');
  });
});
