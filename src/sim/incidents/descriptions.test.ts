import { expect, it } from 'vitest';
import { createGame } from '../index';
import { INCIDENTS, INCIDENT_IDS, type IncidentId } from '../data/incidents';
import { incidentChoiceDescription } from './descriptions';
import { refreshModifiers } from '../game';
const expected: Record<IncidentId, string[]> = {
  caravan: ['消耗 60 废料，得到 25 燃料。', '消耗 50 食物，得到 40 科研。', '没有效果。'],
  refugees: ['消耗 40 食物，得到 4 名幸存者，不受住房限制。', '得到 2 名幸存者，不受住房限制。', '得到 20 废料。'],
  rescue: ['地图上标出目标点，2 天内派任意士兵到达，附近有 3 只变异体。完成后得到 3 名幸存者和 30 燃料，幸存者不受住房限制。', '没有效果。'],
  raiders: ['交出当前废料的 30%。', '需要至少 8 名士兵，没有任何损失。', '今晚边缘夜袭规模增加 30%。'],
  mechanic: ['维修费用永久降低 30%。', '机枪塔造价永久降低 25%。', '得到 40 科研。'],
  spores: ['2 名在岗工人停工 1 天。', '消耗 40 科研，先扣存着的科研，不够再扣当前研究进度。两者合计不足 40 时不可选。', '接下来 2 晚，每晚损失 1 名幸存者。'],
  nestSplit: ['地图上标出巢穴，2 天内摧毁。超时会在附近生成一个 1 级巢穴。'],
  veteran: ['得到 1 名已经升为老兵的步枪手，不消耗幸存者，照常吃口粮。', '消耗 20 食物，当前研究进度增加 25%，需要有当前研究。'],
  overheat: ['消耗 30 燃料。', '接下来 2 天，核心保底产出减半，炉心视野缩小 4 格。', '2 名在岗工人停工 1 天。'],
  northernSignal: ['“旧频段破译”的研究进度增加 50%。', '揭开中继站周围 8 格的迷雾。'],
  tribe: ['消耗 40 食物，揭示距离核心最近的最多 2 个未发现巢穴。', '没有效果。'],
  stormWarning: ['消耗 50 废料，今晚锈风暴对建筑的腐蚀减半。', '没有效果。'],
  surgeWarning: ['入夜前训练速度增加 50%。', '今晚所有建筑受到的伤害降低 20%。']
};
it.each(INCIDENT_IDS)('%s has exact, complete effect descriptions', id => {
  const g = createGame({
    seed: 'words',
    origin: 'scavengers',
    difficulty: 'normal'
  });
  g.calendarPlan[0] = 'raid';
  expect(INCIDENTS[id].choices.map(c => incidentChoiceDescription(g, c))).toEqual(expected[id]);
});
it('northern replacements and deferred raider date have exact descriptions', () => {
  const g = createGame({
    seed: 'words',
    origin: 'scavengers',
    difficulty: 'normal'
  });
  g.state.economy.tech.researched.push('oldFrequency');
  g.state.signal.discovered = true;
  refreshModifiers(g);
  expect(INCIDENTS.northernSignal.choices.map(c => incidentChoiceDescription(g, c))).toEqual(['得到 40 科研。', '得到 30 科研。']);
  g.calendarPlan.splice(0, 3, 'calm', 'rustStorm', 'raid');
  expect(incidentChoiceDescription(g, INCIDENTS.raiders.choices[2]!)).toBe('第 3 夜边缘夜袭规模增加 30%。');
});
