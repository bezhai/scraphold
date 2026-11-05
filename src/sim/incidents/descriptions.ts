/** Effect summaries use the settlement data, including conditional rewards and attack dates. */
import { SOLDIERS } from '../data/combat';
import { RESOURCE_NAMES, RESOURCES, TECHS, type ResourceAmounts } from '../data/economy';
import { INCIDENT_RULES, INCIDENT_TARGETS, type IncidentChoice, type IncidentEffect } from '../data/incidents';
import type { Game } from '../game';
import type { Effect } from '../modifiers';
import { incidentAttackNight } from './effects';
const percent = (n: number) => `${Math.round(n * 100)}%`;
function amounts(value: ResourceAmounts): string {
  return RESOURCES.filter(r => value[r] !== undefined).map(r => `${value[r]} ${RESOURCE_NAMES[r]}`).join('、');
}
function decrease(fraction: number): string {
  return fraction === 0.5 ? '减半' : `降低 ${percent(fraction)}`;
}
function modifierText(effect: Effect, permanent: boolean): string {
  const duration = permanent ? '永久' : '';
  if (effect.kind === 'factor') return `${{
    coreYield: '核心保底产出',
    stormBuildingDamage: '锈风暴对建筑的腐蚀',
    nightBuildingDamage: '所有建筑受到的伤害'
  }[effect.stat]}${duration}${decrease(1 - effect.value)}`;
  if (effect.kind === 'global') {
    if (effect.stat === 'repairCostPct') return `维修费用${duration}${decrease(-effect.value)}`;
    if (effect.stat === 'trainSpeedPct') return `训练速度${duration}增加 ${percent(effect.value)}`;
  }
  if (effect.kind === 'building') {
    if (effect.stat === 'buildCostPct') return `机枪塔造价${duration}${decrease(-effect.value)}`;
    if (effect.stat === 'visionAdd') return `炉心视野${duration}缩小 ${-effect.value} 格`;
  }
  throw new Error('Unsupported incident modifier description');
}
function effectText(game: Game, effect: IncidentEffect): string {
  switch (effect.kind) {
    case 'resources':
      return `得到 ${amounts(effect.amounts)}`;
    case 'survivors':
      return `得到 ${effect.count} 名幸存者，不受住房限制`;
    case 'soldiers':
      return `得到 ${effect.count} 名${effect.veteran ? '已经升为老兵的' : ''}${SOLDIERS[effect.unit].name}，不消耗幸存者，照常吃口粮`;
    case 'isolate':
      return `${effect.count} 名在岗工人停工 ${effect.days} 天`;
    case 'casualties':
      return `接下来 ${effect.nights} 晚，每晚损失 ${effect.count} 名幸存者`;
    case 'nightBudget':
      {
        const night = incidentAttackNight(game);
        return `${night === game.state.clock.day ? '今晚' : `第 ${night} 夜`}边缘夜袭规模增加 ${percent(effect.budgetPct)}`;
      }
    case 'revealNests':
      return `揭示距离核心最近的最多 ${effect.count} 个未发现巢穴`;
    case 'relayReveal':
      return game.state.signal.discovered ? `得到 ${effect.discoveredResearch} 科研` : `揭开中继站周围 ${effect.radius} 格的迷雾`;
    case 'research':
      {
        if (effect.tech !== 'current' && game.modifiers.researched.has(effect.tech)) return `得到 ${effect.fallbackResearch} 科研`;
        return effect.tech === 'current' ? `当前研究进度增加 ${percent(effect.fraction)}，需要有当前研究` : `“${TECHS[effect.tech].name}”的研究进度增加 ${percent(effect.fraction)}`;
      }
    case 'modifier':
      {
        const duration = effect.duration === 'permanent' ? '' : effect.duration === 'today' ? '入夜前' : effect.duration === 'tonight' ? '今晚' : `接下来 ${effect.duration} 天，`;
        return duration + effect.effects.map(e => modifierText(e, effect.duration === 'permanent')).join('，');
      }
    case 'target':
      {
        const t = INCIDENT_TARGETS[effect.target];
        if (t.kind === 'nestSplit') return `地图上标出巢穴，${t.days} 天内摧毁。超时会在附近生成一个 ${INCIDENT_RULES.splitLevel} 级巢穴`;
        const reach = '任意士兵';
        const guards = Object.values(t.guards).reduce((sum, n) => sum + n, 0);
        const lead = `地图上标出目标点，${t.days} 天内派${reach}到达${guards ? `，附近有 ${guards} 只变异体` : ''}`;
        const rewards = t.rewards.map(e => e.kind === 'resources' ? amounts(e.amounts) : e.kind === 'survivors' ? `${e.count} 名幸存者` : effectText(game, e));
        return `${lead}。完成后得到 ${rewards.join('和 ')}${t.rewards.some(e => e.kind === 'survivors') ? '，幸存者不受住房限制' : ''}`;
      }
  }
}
export function incidentChoiceDescription(game: Game, choice: IncidentChoice): string {
  const parts: string[] = [];
  if (Object.keys(choice.cost).length) parts.push(`消耗 ${amounts(choice.cost)}`);
  if (choice.researchProgressCost) parts.push(`消耗 ${choice.researchProgressCost} 科研，先扣存着的科研，不够再扣当前研究进度。两者合计不足 ${choice.researchProgressCost} 时不可选`);
  for (const r of RESOURCES) if (choice.costPct[r]) parts.push(`交出当前${RESOURCE_NAMES[r]}的 ${percent(choice.costPct[r]!)}`);
  if (choice.minSoldiers) parts.push(`需要至少 ${choice.minSoldiers} 名士兵，没有任何损失`);
  parts.push(...choice.effects.map(e => effectText(game, e)));
  return parts.length ? `${parts.join('，')}。` : '没有效果。';
}
