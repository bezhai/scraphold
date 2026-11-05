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
    description: '旧时代的轨道补给舱，坠落在这里，还没有被打开过。',
    feedback: '打开了补给舱，得到 80 废料和 20 燃料。',
    reward: { kind: 'resources', amounts: { scrap: 80, fuel: 20 } },
  },
  warehouse: {
    kind: 'warehouse', count: 1,
    name: '旧时代仓库',
    description: '旧时代的物资仓库，门还锁着。',
    feedback: '打开了仓库，得到 1 名狙击手。',
    reward: { kind: 'unit', unit: 'sniper' },
  },
};
