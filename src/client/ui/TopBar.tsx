/**
 * The top bar, one slim row: resources with per-minute rates and population on the left; the
 * 目标 (O) button in the middle; the fog calendar, day/night clock with tonight's forecast hanging
 * below it, speed, help and menu on the right.
 */
import { formatClock, formatSigned } from '../hud/format';
import { dayClockModel } from '../hud/dayClock';
import { foodBalance, growthReadout, populationReadout, populationTip, resourceReadouts, survivorsTip } from '../hud/topBar';
import type { Session } from '../session';
import type { Speed } from '../tickClock';
import { rateTone } from './actions';
import { CalendarStrip } from './CalendarStrip';
import { ObjectivesButton } from './ObjectivesPanel';
import { PauseGlyph, PlayGlyph } from './Glyphs';
import { ResourceIcon } from './ResourceIcon';

const RESOURCE_USE = {
  scrap: '建造建筑、维修',
  food: '训练和供养士兵；盈余会让新的幸存者诞生',
  fuel: '燃料兵种、机枪塔和改装车间',
  research: '推进当前研究的科技',
} as const;

export function TopBar({ session, onCalendarHover }: { session: Session; onCalendarHover: () => void }) {
  const view = session.game.state;
  const resources = resourceReadouts(view);
  const pop = populationReadout(view);
  const food = foodBalance(view);
  const growth = growthReadout(view);
  const clock = dayClockModel(view);
  const housingFull = pop.people >= pop.housingCap && pop.housingCap > 0;
  return (
    <div class="topbar">
      <div class="tb-group tb-economy">
        {resources.map((r) => (
          <div class={`res res-${r.resource} has-tip`} key={r.resource}>
            <ResourceIcon resource={r.resource} />
            <div class="res-values">
              <div class="amount num" data-testid={`res-${r.resource}`}>
                {r.amount}
              </div>
              <div class={`rate num ${rateTone(r.perMinute)}`}>
                {formatSigned(r.perMinute)}
                <span class="unit">/分</span>
              </div>
            </div>
            <div class="tip below">
              <b class={`res-name res-${r.resource}`}>{r.name}</b>　{RESOURCE_USE[r.resource]}
              <br />
              收入 <span class="tone-good num">+{Math.round(r.incomePerMinute)}</span>/分　支出{' '}
              <span class="tone-danger num">−{Math.round(r.expensePerMinute)}</span>/分
              {r.resource === 'food' && (
                <>
                  <br />
                  每天口粮结余 <span class={`num ${rateTone(food.perDay)}`}>{formatSigned(food.perDay)}</span>（黄昏结算士兵口粮）
                </>
              )}
            </div>
          </div>
        ))}
        <span class="tb-sep" />
        <button
          class={`pop-item has-tip ${pop.idle > 0 ? 'has-idle' : ''}`}
          data-testid="select-idle"
          onClick={() => session.handleKey({ type: 'selectIdleSurvivors' }, performance.now())}
        >
          <span class="v num" data-testid="pop-survivors">
            {pop.survivors}
          </span>
          <span class="k">
            幸存者（空闲 <span class="idle" data-testid="pop-idle">{pop.idle}</span>）
          </span>
          <span class="tip below">{survivorsTip(pop)}</span>
        </button>
        <div class="pop-item">
          <span class="v num" data-testid="pop-soldiers">
            {pop.soldiers}
            {pop.training > 0 && <small class="training"> +{pop.training}</small>}
          </span>
          <span class="k">{pop.training > 0 ? '士兵 · 训练中' : '士兵'}</span>
        </div>
        <div class="pop-item has-tip" data-testid="pop-housing-item">
          <span class={`v num ${housingFull ? 'tone-warn' : ''}`} data-testid="pop-housing">
            {pop.people}/{pop.housingCap}
          </span>
          <span class="k">人口 / 住房</span>
          <div class="bar growth">
            <i style={{ width: `${growth * 100}%` }} />
          </div>
          <div class="tip below">{populationTip(pop)}</div>
        </div>
        {food.hungry ? (
          <span class="food-chip hungry tone-danger">士兵饥饿</span>
        ) : (
          <span class={`food-chip ${rateTone(food.perDay)}`}>
            口粮 <span class="num">{formatSigned(food.perDay)}</span>/天
          </span>
        )}
      </div>

      <ObjectivesButton session={session} />

      <div class="tb-group tb-time">
        <CalendarStrip session={session} onHover={onCalendarHover} />
        <div class="clock">
          <div class="dayno" data-testid="day">
            第{clock.day}天<small class="num">/{clock.totalNights}</small>
          </div>
          <div class="phase">
            <div class="row">
              <span class={`phase-name phase-${clock.phase}`} data-testid="phase">
                {clock.phaseName}
              </span>
              <span class="left">
                <span class="num">{formatClock(clock.secondsLeft)}</span> 后{clock.nextLabel}
              </span>
            </div>
            <div class={`track ${clock.phase}`}>
              <i style={{ width: `${clock.phaseProgress * 100}%` }} />
            </div>
          </div>
          {clock.forecast && (
            <div class={`forecast ${clock.forecast.groups.length > 0 ? 'has-tip' : 'quiet'}`} data-testid="forecast">
              <span class="f-label">今夜来袭</span>
              {!clock.forecast.directionsKnown ? (
                <span class="f-none">方向不明</span>
              ) : clock.forecast.groups.length === 0 ? (
                <span class="f-none">无</span>
              ) : (
                clock.forecast.groups.map((g) => (
                  <span class="chip" key={g.direction}>
                    {g.directionName} {g.sizeName}
                    {g.boss ? ' · 首领' : ''}
                  </span>
                ))
              )}
              {clock.forecast.groups.length > 0 && (
                <div class="tip below">
                  <b>第 {clock.forecast.night} 夜侦察报告</b>
                  {clock.forecast.groups.map((g) => (
                    <div key={g.direction}>
                      {g.directionName}：{g.sizeName}
                      {g.detail ? `（${g.detail}）` : ''}
                      {g.boss === null ? '' : g.boss ? '，有首领' : '，无首领'}
                    </div>
                  ))}
                  {!clock.forecast.precise && <div class="muted">造一座瞭望塔可以看到每个方向的具体数量和首领。</div>}
                </div>
              )}
            </div>
          )}
        </div>
        <SpeedControls session={session} />
      </div>
    </div>
  );
}

function SpeedControls({ session }: { session: Session }) {
  const speeds: Speed[] = [1, 2, 3];
  return (
    <div class="speed">
      <div class="seg-ctl">
        <button
          class={session.paused ? 'paused' : ''}
          data-testid="pause"
          onClick={() => session.handleKey({ type: 'togglePause' }, performance.now())}
          title={session.paused ? '继续（空格）' : '暂停（空格）'}
          aria-label={session.paused ? '继续' : '暂停'}
        >
          {session.paused ? <PlayGlyph /> : <PauseGlyph />}
        </button>
        {speeds.map((s) => (
          <button key={s} class={`num ${!session.paused && session.speed === s ? 'on' : ''}`} data-testid={`speed-${s}`} onClick={() => session.setSpeed(s)} title={`${s} 倍速（- / = 调整）`}>
            {s}×
          </button>
        ))}
      </div>
      <button class="btn small" data-testid="help" onClick={() => session.handleKey({ type: 'toggleHelp' }, performance.now())} title="怎么玩 / 操作说明（F1 或 ?）">
        帮助 <span class="key">F1</span>
      </button>
      <button class="btn small" data-testid="menu" onClick={() => session.handleKey({ type: 'cancel' }, performance.now())} title="菜单（Esc）">
        菜单
      </button>
    </div>
  );
}
