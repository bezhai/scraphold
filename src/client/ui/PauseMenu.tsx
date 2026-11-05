/** Pause menu (Esc): resume, the how-to-play overlay, restart with the same seed, quit. */
import type { Session } from '../session';

export function PauseMenu({ session, onRestart, onQuit }: { session: Session; onRestart: () => void; onQuit: () => void }) {
  const openHelp = () => {
    session.closeMenu();
    session.handleKey({ type: 'toggleHelp' }, performance.now());
  };
  return (
    <div class="modal-back">
      <div class="panel menu" data-testid="pause-menu">
        <h2>暂停</h2>
        <div class="menu-sub">游戏已暂停</div>
        <button class="btn primary" onClick={() => session.closeMenu()}>
          继续
        </button>
        <button class="btn" onClick={openHelp}>
          怎么玩 / 操作说明 <span class="key">F1</span>
        </button>
        <button class="btn" onClick={onRestart}>
          用同一个种子重新开始
        </button>
        <button class="btn" onClick={onQuit}>
          返回主菜单
        </button>
      </div>
    </div>
  );
}
