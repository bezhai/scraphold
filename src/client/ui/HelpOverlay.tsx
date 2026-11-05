/**
 * How to play, for players who have not read anything (F1, ?, or the 帮助 button): the goal, the
 * day/night rhythm, where each resource comes from (with the terrain colors of the map), unit
 * control, people, defense, and the full key reference. Time stands still while it is open.
 */
import { DAY_SECONDS, DUSK_SECONDS, NIGHT_SECONDS } from '../../sim/time';
import { HIVE_SHIELD } from '../../sim/data/combat';
import { BUILDINGS } from '../../sim/data/economy';
import { TERRAIN, type Terrain } from '../../sim/data/map';
import { formatPercent } from '../hud/format';
import { BUILD_HOTKEYS, ORDER_KEY_TEXT } from '../input/keymap';
import { COLORS } from '../render/palette';
import type { Session } from '../session';
import { ResourceIcon } from './ResourceIcon';

const KEYS: [string[], string][] = [
  [['左键'], '选择；拖拽框选；双击选中屏幕内同类'],
  [['Shift'], '加选 / 连续放置建筑'],
  [['右键'], '士兵：地面攻击移动，敌人集火；幸存者：生产建筑派工，受损建筑维修；兵营：设集结点（士兵白天在这里待命）'],
  [['Ctrl', '右键'], '强制移动（不理会敌人）'],
  [['W', 'A', 'S', 'D'], '平移镜头（方向键、鼠标到屏幕边缘也可以），滚轮缩放，点小地图跳转'],
  [['Ctrl', '1-5'], '编队（也可用 Alt+数字或右键编队格）；数字键选队，连按两次镜头跳过去'],
  [['X'], ORDER_KEY_TEXT.stop],
  [['H'], ORDER_KEY_TEXT.hold],
  [['K'], '撤退回炉心'],
  [['G'], '选中空闲或等待命令的幸存者'],
  [['F'], '跳到最近的警报'],
  [['T'], '科技树'],
  [['P'], '政令'],
  [['O'], '胜利目标'],
  [['Tab'], '打开待处理事件'],
  [['空格'], '暂停 / 继续（暂停时仍可下令）'],
  [['-', '='], '调整速度 1× / 2× / 3×'],
  [['Esc'], '取消放置 / 清空选择 / 菜单'],
  [['F1', '?'], '打开 / 关闭本说明'],
];

const TERRAIN_SWATCHES: [Terrain, string][] = [
  ['fertile', COLORS.fertile],
  ['wreckage', COLORS.rust],
  ['oil', COLORS.oil],
  ['water', COLORS.water],
  ['ruin', COLORS.ruinStone],
  ['rock', COLORS.rock],
];

const BUILD_KEYS = Object.entries(BUILD_HOTKEYS).map(([code, type]) => `${code.slice(3)} ${BUILDINGS[type].name}`);

function Key({ k }: { k: string }) {
  return <span class="key">{k}</span>;
}

export function HelpOverlay({ session }: { session: Session }) {
  const close = () => session.handleKey({ type: 'toggleHelp' }, performance.now());
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="panel modal help" data-testid="help-modal">
        <div class="modal-head">
          <div>
            <h2>怎么玩</h2>
            <div class="sub">打开说明时游戏暂停。随时按 F1 或 ? 再看。</div>
          </div>
          <button class="btn small" onClick={close}>
            关闭 <Key k="F1" />
          </button>
        </div>
        <div class="help-cols">
          <div>
            <h4>目标</h4>
            <p>
              <b>炉心</b>被摧毁就失败。满足以下任一条件获胜：守满 20 夜；摧毁母巢；修好 K-7 中继站，广播求援直到长明城的车队到达。
            </p>
            <p>
              <b>母巢</b>：地图上每剩一个普通巢穴，母巢受到的伤害降低 {formatPercent(HIVE_SHIELD.reductionPerNest)}，最多降低 {formatPercent(HIVE_SHIELD.maxReduction)}。先清掉普通巢穴，再打母巢。
            </p>
            <h4>一天的节奏</h4>
            <p>
              一天分为白天 {DAY_SECONDS} 秒（最后 {DUSK_SECONDS} 秒是黄昏）和夜晚 {NIGHT_SECONDS} 秒。黄昏时右上角出现<b>侦察报告</b>，屏幕上的红色箭头指向今夜怪物来的方向；入夜后箭头跟着来袭的怪物移动。天亮时没死的怪物撤回巢穴，让巢穴变强；巢穴每过一夜也会升级。
            </p>
            <h4>资源从哪来</h4>
            <ul class="res-list">
              <li>
                <ResourceIcon resource="scrap" />
                <span>
                  <b class="res-name res-scrap">废料</b>：拆解站，挨着残骸越多产量越高。造建筑、维修用。
                </span>
              </li>
              <li>
                <ResourceIcon resource="food" />
                <span>
                  <b class="res-name res-food">食物</b>：温室，建在沃土上或挨着水源产量更高。训练和养活士兵；有盈余时炉心会诞生新的幸存者。
                </span>
              </li>
              <li>
                <ResourceIcon resource="fuel" />
                <span>
                  <b class="res-name res-fuel">燃料</b>：油井，只能建在油渍上。高级兵种和机枪塔用。
                </span>
              </li>
              <li>
                <ResourceIcon resource="research" />
                <span>
                  <b class="res-name res-research">科研</b>：研究站，挨着遗迹有加成。推进科技（<Key k="T" />）。
                </span>
              </li>
            </ul>
            <p>生产建筑有幸存者在里面工作才有产出；放置时会显示这个位置的「产出加成」。炉心有少量保底产出。鼠标停在地面上，左下角会显示这块地适合做什么。</p>
            <div class="swatches">
              {TERRAIN_SWATCHES.map(([t, color]) => (
                <span key={t} class="swatch">
                  <i style={{ background: color }} />
                  {TERRAIN[t].name}
                </span>
              ))}
            </div>
            <h4>建造快捷键</h4>
            <p class="build-keys">{BUILD_KEYS.join(' · ')}</p>
            <h4>单位控制</h4>
            <p>
              幸存者和士兵默认<b>自动管理</b>。幸存者按资源缺口去工地、维修和生产建筑工作，锈风暴夜躲进建筑。士兵在据点范围内迎敌，夜里移到预报的来袭方向，血量低时撤回炉心，白天回到兵营集结点；自动管理的士兵不会去打巢穴和母巢。选中单位下命令后<b>由你指挥</b>，命令完成后转回自动管理。派工和原地坚守（H）会一直保持，按 X 转回自动管理。
            </p>
          </div>
          <div>
            <h4>人口</h4>
            <p>
              幸存者可以派去工作，也可以训练成士兵：每训练一名士兵，从自动管理的幸存者里调走一人。士兵每天要吃食物（黄昏结算，不够就挨饿、战斗力下降）。住房满了就不会再诞生新的幸存者，造棚屋可以增加住房。在建筑里工作的幸存者是安全的，在户外会受到怪物攻击。
            </p>
            <h4>防守</h4>
            <p>
              兵营训练盾卫（前排，挡住疾行者）、步枪手（远程主力）、摩托斥候（侦察）；科技解锁狙击手（打甲壳兽）、掷弹兵（打成群的怪物）和燃料兵种。选中士兵右键地面，它们走过去，路上遇敌会交战，到达后转回自动管理；想让士兵留在那里，再按 H 原地坚守。右键敌人集火。路障能引导怪物绕路，机枪塔夜里消耗燃料。选中怪物可以看到它怕什么伤害。
            </p>
            <h4>操作</h4>
            <div class="keys">
              {KEYS.map(([keys, text]) => (
                <>
                  <span class="k">
                    {keys.map((k) => (
                      <Key k={k} key={k} />
                    ))}
                  </span>
                  <span>{text}</span>
                </>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
