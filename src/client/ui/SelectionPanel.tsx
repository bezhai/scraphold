/**
 * Details and actions for the current selection (see hud/selectionPanel.ts for the model). Shown
 * only while something is selected; with nothing selected the bottom edge keeps just the minimap
 * and the build dock.
 */
import { useState } from 'preact/hooks';
import type { Availability } from '../hud/availability';
import { formatPercent, formatSigned } from '../hud/format';
import {
  selectionPanelModel,
  type BuildingDetails,
  type GroupEntry,
  type MutantDetails,
  type NestDetails,
  type SoldierDetails,
  type SurvivorDetails,
} from '../hud/selectionPanel';
import { buildingIcon, mutantIcon, nestIcon, soldierIcon, survivorIcon } from '../render/icons';
import type { Session } from '../session';
import type { SoldierType } from '../../sim/data/combat';
import { act, hpClass } from './actions';
import { Cost } from './Cost';
import { LockGlyph } from './Glyphs';

function HpLine({ hp, maxHp }: { hp: number; maxHp: number }) {
  const f = maxHp > 0 ? hp / maxHp : 0;
  return (
    <div class="hp-line">
      <div class="bar hp">
        <i class={hpClass(f)} style={{ width: `${f * 100}%` }} />
      </div>
      <span class="num">
        {hp}/{maxHp}
      </span>
    </div>
  );
}

/** A command button; its hover card is `tip` (plus the reason when it cannot be used), or just the reason. */
function ActionButton({ session, av, label, hotkey, tip, testId, danger }: { session: Session; av: Availability | null; label: string; hotkey?: string; tip?: string; testId?: string; danger?: boolean }) {
  if (!av) return null;
  return (
    <button class={`btn small has-tip ${av.ok ? '' : 'is-disabled'} ${danger ? 'danger' : ''}`} data-testid={testId} onClick={() => act(session, av)}>
      {label}
      {hotkey && <span class="key">{hotkey}</span>}
      {tip ? (
        <span class="tip">
          {tip}
          {!av.ok && <span class="reason">{av.reason}</span>}
        </span>
      ) : (
        !av.ok && <span class="tip reason-tip">{av.reason}</span>
      )}
    </button>
  );
}

function OrderButtons({ session }: { session: Session }) {
  return (
    <div class="actions">
      <button class="btn small" onClick={() => session.handleKey({ type: 'stop' }, performance.now())}>
        停止 <span class="key">X</span>
      </button>
      <button class="btn small" onClick={() => session.handleKey({ type: 'hold' }, performance.now())}>
        原地坚守 <span class="key">H</span>
      </button>
      <button class="btn small has-tip retreat-btn" data-testid="retreat-btn" onClick={() => session.handleKey({ type: 'retreat' }, performance.now())}>
        撤退回炉心 <span class="key">K</span>
        <span class="tip">选中的士兵不再交战，直接跑回炉心附近。想撤到别处，用 Ctrl+右键点位置。</span>
      </button>
    </div>
  );
}

function SoldierView({ session, unit }: { session: Session; unit: SoldierDetails }) {
  return (
    <>
      <div class="portrait">
        <img src={soldierIcon(unit.type)} alt="" />
        {unit.promotion && <span class="badge">{unit.promotion}</span>}
      </div>
      <div class="sel-main">
        <div class="sel-title">
          <h3>{unit.name}</h3>
          <span class="role">{unit.role}</span>
          {unit.hungry && <span class="pill tone-danger">饥饿</span>}
        </div>
        <HpLine hp={unit.hp} maxHp={unit.maxHp} />
        <div class="stats">
          <span>
            <span class="k">护甲</span>
            {unit.armorName}
          </span>
          <span>
            <span class="k">武器</span>
            {unit.weapon}
          </span>
          <span>
            <span class="k">指令</span>
            {unit.order}
          </span>
          <span>
            <span class="k">击杀</span>
            <span class="num">
              {unit.kills}/{unit.veteranKills}
            </span>
          </span>
        </div>
        {unit.promotions ? (
          <div class="promo">
            <span class="promo-label">老兵强化 · 选一项</span>
            {unit.promotions.map((p) => (
              <button key={p.id} class="btn" onClick={() => act(session, p.availability)}>
                <b>{p.name}</b>
                <span class="muted">{p.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div class="sel-desc">{unit.description}</div>
        )}
        <OrderButtons session={session} />
      </div>
    </>
  );
}

function SurvivorView({ unit }: { unit: SurvivorDetails }) {
  return (
    <>
      <div class="portrait">
        <img src={survivorIcon()} alt="" />
      </div>
      <div class="sel-main">
        <div class="sel-title">
          <h3>幸存者</h3>
          <span class="role">{unit.task}</span>
        </div>
        <HpLine hp={unit.hp} maxHp={unit.maxHp} />
        <div class="hint">
          右键生产建筑：派去工作　右键受损建筑或工地：维修 / 帮忙建造
          <br />
          兵营训练士兵时会带走一名空闲幸存者。
        </div>
      </div>
    </>
  );
}

function entryIcon(e: GroupEntry): string {
  return e.key === 'survivor' ? survivorIcon() : soldierIcon(e.key.slice('soldier:'.length) as SoldierType);
}

function GroupView({ session, entries, total, soldiers }: { session: Session; entries: GroupEntry[]; total: number; soldiers: number }) {
  return (
    <div class="sel-main">
      <div class="sel-title">
        <h3>已选 {total} 个单位</h3>
        <span class="role">点击类型只保留该类</span>
      </div>
      <div class="chips">
        {entries.map((e) => (
          <button key={e.key} class="unit-chip" onClick={() => session.select(e.ids)} title={`平均生命 ${formatPercent(e.health)}`}>
            <img src={entryIcon(e)} alt="" />
            <span>{e.name}</span>
            <span class="count">×{e.count}</span>
          </button>
        ))}
      </div>
      {soldiers > 0 ? (
        <>
          <div class="hint">
            右键地面：攻击移动　<span class="key">Ctrl</span>+右键：强制移动　右键敌人：集火　<span class="key">Ctrl</span>+<span class="key">1</span>～<span class="key">5</span>：编队
            {soldiers < total && (
              <>
                <br />
                右键建筑时幸存者去工作或维修，士兵只走到旁边。
              </>
            )}
          </div>
          <OrderButtons session={session} />
        </>
      ) : (
        <div class="hint">
          右键生产建筑：派去工作（工位满了，其余的人留在原地）　右键受损建筑或工地：维修 / 帮忙建造　右键地面：移动
        </div>
      )}
    </div>
  );
}

function BuildingView({ session, b }: { session: Session; b: BuildingDetails }) {
  const [confirm, setConfirm] = useState(0);
  const demolish = () => {
    const now = performance.now();
    if (now - confirm < 2500) {
      act(session, b.demolish);
      setConfirm(0);
    } else setConfirm(now);
  };
  return (
    <>
      <div class="portrait">
        <img src={buildingIcon(b.type)} alt="" />
        {b.construction && <span class="badge">施工中</span>}
      </div>
      <div class="sel-main">
        <div class="sel-title">
          <h3>{b.name}</h3>
          {b.signal && (
            <span class="role" data-testid="signal-stage">
              {b.signal.progress ?? b.signal.stage}
            </span>
          )}
          {b.output.length > 0 && (
            <span class="role output" data-testid="building-output">
              {b.isCore ? '保底产出' : '产出'}
              {b.output.map((o) => (
                <span key={o.resource} class="out">
                  {o.name} {formatSigned(o.perMinute)}/分
                </span>
              ))}
              {b.workers && b.workers.count === 0 && <span class="tone-warn">（派幸存者进来工作才会产出）</span>}
            </span>
          )}
          {b.housing !== null && <span class="role">住房 +{b.housing}</span>}
        </div>
        <HpLine hp={b.hp} maxHp={b.maxHp} />
        {b.construction ? (
          <div class="hp-line">
            <div class="bar build">
              <i style={{ width: `${b.construction.progress * 100}%` }} />
            </div>
            <span class="num">{b.construction.secondsLeft === null ? formatPercent(b.construction.progress) : `剩 ${b.construction.secondsLeft} 秒`}</span>
          </div>
        ) : (
          <div class="sel-desc">{b.description}</div>
        )}
        {b.workers && (
          <div class="actions">
            <span class="k-label">工位</span>
            <div class="slots">
              {Array.from({ length: b.workers.slots }, (_, i) => (
                <span key={i} class={`s ${i < b.workers!.count ? 'on' : ''}`} />
              ))}
            </div>
            <ActionButton session={session} av={b.addWorker} label="派一名空闲幸存者" testId="add-worker" />
            <ActionButton session={session} av={b.removeWorker} label="撤出一人" />
          </div>
        )}
        {b.training && <TrainingView session={session} training={b.training} />}
        <div class="actions">
          {b.signal && <ActionButton session={session} av={b.signal.start} label="开始广播" tip={b.signal.startTip} testId="start-broadcast" />}
          {b.repair && <ActionButton session={session} av={b.repair} label={b.construction ? '派人帮忙建造' : '派人维修'} testId="repair" />}
          {b.cancelConstruction && <ActionButton session={session} av={b.cancelConstruction} label="取消建造（全额退还）" danger />}
          {b.demolish && (
            <button class={`btn small danger ${b.demolish.ok ? '' : 'is-disabled'}`} onClick={demolish}>
              {confirm ? '再点一次确认拆除' : '拆除'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function TrainingView({ session, training }: { session: Session; training: NonNullable<BuildingDetails['training']> }) {
  return (
    <>
      <div class="train-row">
        {training.options.map((o) => (
          <button key={o.unit} class={`train-btn has-tip ${o.availability.ok ? '' : 'off'} ${o.lockedBy ? 'locked' : ''}`} data-testid={`train-${o.unit}`} onClick={() => act(session, o.availability)}>
            <img src={soldierIcon(o.unit)} alt="" />
            {o.lockedBy && (
              <span class="lock">
                <LockGlyph />
              </span>
            )}
            <span>
              <div class="nm">
                {o.name} <span class="role">{o.role}</span>
              </div>
              <Cost items={o.cost} />
            </span>
            <span class="tip">
              <b>{o.name}</b>（{o.role}）训练 {o.seconds} 秒，消耗一名空闲幸存者
              <div>{o.description}</div>
              {o.lockedBy && (
                <span class="reason locked">
                  <LockGlyph />
                  需要科技：{o.lockedBy}
                </span>
              )}
              {!o.availability.ok && !o.lockedBy && <span class="reason">{o.availability.reason}</span>}
            </span>
          </button>
        ))}
      </div>
      <div class="actions">
        {training.queue.length > 0 ? (
          <div class="queue">
            {training.queue.map((q) => (
              <button key={q.index} class="q" title={`${q.name}：点击取消`} onClick={() => act(session, q.cancel)}>
                <img src={soldierIcon(q.unit)} alt="" />
                <span class="p" style={{ width: `${q.progress * 100}%` }} />
              </button>
            ))}
          </div>
        ) : (
          <span class="hint">训练队列为空</span>
        )}
        <span class="hint">{training.hasRally ? '已设集结点 · 右键地面修改' : '右键地面设置集结点'}</span>
      </div>
    </>
  );
}

function MutantView({ m }: { m: MutantDetails }) {
  return (
    <>
      <div class="portrait hostile">
        <img src={mutantIcon(m.type)} alt="" />
        {m.boss && <span class="badge">首领</span>}
      </div>
      <div class="sel-main">
        <div class="sel-title">
          <h3 class="hostile">{m.name}</h3>
          <span class="role">怪物</span>
        </div>
        <HpLine hp={m.hp} maxHp={m.maxHp} />
        <div class="stats">
          <span>
            <span class="k">护甲</span>
            {m.armorName}
          </span>
          <span>
            <span class="k">弱点</span>
            {m.weakness}
          </span>
        </div>
        <div class="sel-desc">{m.description}</div>
      </div>
    </>
  );
}

function NestView({ n }: { n: NestDetails }) {
  return (
    <>
      <div class="portrait hostile">
        <img src={nestIcon(n.isHive)} alt="" />
        <span class="badge">{n.level} 级</span>
      </div>
      <div class="sel-main">
        <div class="sel-title">
          <h3 class="hostile">{n.name}</h3>
          <span class="role">{n.isHive ? '摧毁即胜利' : '每夜成长，派出额外怪物'}</span>
        </div>
        <HpLine hp={n.hp} maxHp={n.maxHp} />
        <div class="sel-desc">{n.description}</div>
      </div>
    </>
  );
}

export function SelectionPanel({ session }: { session: Session }) {
  const model = selectionPanelModel(session.game, session.selection);
  if (model.kind === 'none') return null;
  return (
    <div class={`panel selection-panel sel-${model.kind}`} data-testid="selection-panel">
      {model.kind === 'soldier' && <SoldierView session={session} unit={model.unit} />}
      {model.kind === 'survivor' && <SurvivorView unit={model.unit} />}
      {model.kind === 'group' && <GroupView session={session} entries={model.entries} total={model.total} soldiers={model.soldiers} />}
      {model.kind === 'building' && <BuildingView session={session} b={model.building} />}
      {model.kind === 'mutant' && <MutantView m={model.mutant} />}
      {model.kind === 'nest' && <NestView n={model.nest} />}
    </div>
  );
}
