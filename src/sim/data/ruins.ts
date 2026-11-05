import type { RuinReward } from './economy';

export type RuinKind = 'ordinary' | 'supplyPod' | 'warehouse';
export interface SpecialRuinDef {
  kind: Exclude<RuinKind, 'ordinary'>;
  count: number;
  name: string;
  description: string;
  feedback: string;
  reward: RuinReward;
}
/** Fixed base rewards; ordinary ruin resource modifiers still apply when explored. */
export const SPECIAL_RUINS: Record<Exclude<RuinKind, 'ordinary'>, SpecialRuinDef> = {
  supplyPod: {
    kind: 'supplyPod', count: 2,
    name: '坠落的补给舱',
    description: '旧时代的轨道补给舱，砸进沙地里，还没被人翻过。',
    feedback: '舱里是成箱的零件，还有一张写着\'应急\'的标签。',
    reward: { kind: 'resources', amounts: { scrap: 80, fuel: 20 } },
  },
  warehouse: {
    kind: 'warehouse', count: 1,
    name: '旧时代仓库',
    description: '一扇厚重的金属门，门牌上印着仓库编号。',
    feedback: '仓库的门锈住了，撬了半天才打开。里面的东西保养得比我们还好。',
    reward: { kind: 'unit', unit: 'sniper' },
  },
};
