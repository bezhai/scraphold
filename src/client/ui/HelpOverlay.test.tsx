// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { HIVE_SHIELD } from '../../sim/data/combat';
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
    expect(help.textContent).toContain('炉心被摧毁就失败。满足以下任一条件获胜：守满 20 夜；摧毁母巢；修好 K-7 中继站，广播求援直到长明城的车队到达。');
    expect(help.textContent).not.toContain('据点核心');
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
