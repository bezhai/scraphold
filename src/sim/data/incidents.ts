/** Narrative text is verbatim from docs/narrative.md; choice descriptions are derived from these effects. */
import type { SoldierType, MutantType } from './combat';
import type { ResourceAmounts, TechId } from './economy';
import type { Effect } from '../modifiers';
export type IncidentId = 'caravan' | 'refugees' | 'rescue' | 'raiders' | 'mechanic' | 'spores' | 'nestSplit' | 'veteran' | 'overheat' | 'northernSignal' | 'tribe' | 'stormWarning' | 'surgeWarning';
export type IncidentTargetKind = 'rescue' | 'nestSplit';
export type IncidentDuration = 'permanent' | 'today' | 'tonight' | number;
export type IncidentEffect = {
  kind: 'resources';
  amounts: ResourceAmounts;
} | {
  kind: 'survivors';
  count: number;
} | {
  kind: 'soldiers';
  unit: SoldierType;
  count: number;
  veteran: boolean;
} | {
  kind: 'modifier';
  effects: Effect[];
  duration: IncidentDuration;
} | {
  kind: 'nightBudget';
  budgetPct: number;
} | {
  kind: 'isolate';
  count: number;
  days: number;
} | {
  kind: 'casualties';
  nights: number;
  count: number;
} | {
  kind: 'research';
  tech: TechId | 'current';
  fraction: number;
  fallbackResearch: number;
} | {
  kind: 'relayReveal';
  radius: number;
  discoveredResearch: number;
} | {
  kind: 'revealNests';
  count: number;
} | {
  kind: 'target';
  target: IncidentTargetKind;
};
export interface IncidentChoice {
  id: string;
  label: string;
  feedback: string | null;
  cost: ResourceAmounts;
  costPct: ResourceAmounts;
  /** Additional research paid from the bank, then the current unfinished tech. */
  researchProgressCost: number;
  minSoldiers: number;
  effects: IncidentEffect[];
}
export interface IncidentDef {
  id: IncidentId;
  title: string;
  description: string;
  choices: IncidentChoice[];
  weight: number;
  earliestDay: number;
  maxOccurrences: number;
}
export interface IncidentTargetDef {
  kind: IncidentTargetKind;
  title: string;
  days: number;
  guards: Partial<Record<MutantType, number>>;
  completeText: string;
  expireText: string;
  rewards: IncidentEffect[];
}
export const INCIDENT_RULES = {
  firstDay: 2,
  minEvents: 9,
  maxEvents: 11,
  maxEventStreak: 2,
  maxEmptyStreak: 3,
  earliestSecond: 5,
  latestSecond: 15,
  northernFirstDay: 3,
  northernLastDay: 6,
  tightHousingSlots: 2,
  refugeeWeightMultiplier: 3,
  targetReach: 1.2,
  targetRevealRadius: 2,
  rescueMaxDistance: 36,
  rescueNestDistance: 9,
  splitRadius: 10,
  splitLevel: 1,
  guardRadius: 2,
  rescueGuardDistance: 3,
};
export const INCIDENTS: Record<IncidentId, IncidentDef> = {
  caravan: {
    id: 'caravan',
    title: '流浪商队',
    description: '一支商队停在据点外，愿意拿燃料和旧资料换物资，天黑前离开。',
    earliestDay: 2,
    weight: 3,
    maxOccurrences: 2,
    choices: [{
      id: 'fuel',
      label: '用废料换燃料',
      feedback: '和商队换了燃料。',
      cost: {
        scrap: 60
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'resources',
        amounts: {
          fuel: 25
        }
      }]
    }, {
      id: 'research',
      label: '用食物换科研资料',
      feedback: '和商队换了一箱旧资料。',
      cost: {
        food: 50
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'resources',
        amounts: {
          research: 40
        }
      }]
    }, {
      id: 'decline',
      label: '不交易',
      feedback: '商队离开了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }]
  },
  refugees: {
    id: 'refugees',
    title: '难民',
    description: '一群难民来到据点外，想留下来干活换口饭吃。',
    earliestDay: 2,
    weight: 2,
    maxOccurrences: 2,
    choices: [{
      id: 'all',
      label: '全部收留',
      feedback: '难民都留了下来。',
      cost: {
        food: 40
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'survivors',
        count: 4
      }]
    }, {
      id: 'workers',
      label: '只收留能干活的',
      feedback: '留下了能干活的人，其余的人离开了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'survivors',
        count: 2
      }]
    }, {
      id: 'decline',
      label: '拒绝',
      feedback: '难民留下一些零件后离开了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'resources',
        amounts: {
          scrap: 20
        }
      }]
    }]
  },
  rescue: {
    id: 'rescue',
    title: '求救信号',
    description: '收到一段求救信号：有三个人被困在{方向}边的旧加油站。信号位置已经标在地图上。',
    earliestDay: 2,
    weight: 2,
    maxOccurrences: 2,
    choices: [{
      id: 'rescue',
      label: '派人去救',
      feedback: null,
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'target',
        target: 'rescue'
      }]
    }, {
      id: 'decline',
      label: '不去',
      feedback: '没有回应求救信号。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }]
  },
  raiders: {
    id: 'raiders',
    title: '掠夺者',
    description: '三辆武装改装车停在据点外，要求交出物资作为过路费。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'pay',
      label: '交出物资',
      feedback: '掠夺者拿走物资后离开了。',
      cost: {},
      costPct: {
        scrap: 0.3
      },
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }, {
      id: 'intimidate',
      label: '展示兵力',
      feedback: '掠夺者看到守军后离开了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 8,
      effects: []
    }, {
      id: 'refuse',
      label: '拒绝',
      feedback: '掠夺者离开了，他们会把变异体引到据点来。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'nightBudget',
        budgetPct: 0.3
      }]
    }]
  },
  mechanic: {
    id: 'mechanic',
    title: '流浪机械师',
    description: '一名流浪机械师路过据点，可以留下来传授一门手艺，或者留下笔记后离开。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'repair',
      label: '请他教大家维修',
      feedback: '大家学会了更省料的维修方法。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'modifier',
        effects: [{
          kind: 'global',
          stat: 'repairCostPct',
          value: -0.3
        }],
        duration: 'permanent'
      }]
    }, {
      id: 'towers',
      label: '请他改进机枪塔',
      feedback: '机枪塔的设计改进了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'modifier',
        effects: [{
          kind: 'building',
          building: 'machineGunTower',
          stat: 'buildCostPct',
          value: -0.25
        }],
        duration: 'permanent'
      }]
    }, {
      id: 'notes',
      label: '让他离开',
      feedback: '机械师留下笔记后离开了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'resources',
        amounts: {
          research: 40
        }
      }]
    }]
  },
  spores: {
    id: 'spores',
    title: '孢子感染',
    description: '两名拾荒回来的人出现了孢子感染的症状，不处理会传染给其他人。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'isolate',
      label: '隔离',
      feedback: '两名工人进入隔离。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'isolate',
        count: 2,
        days: 1
      }]
    }, {
      id: 'medicine',
      label: '用科研配药',
      feedback: '配出了药，感染控制住了。',
      cost: {},
      costPct: {},
      researchProgressCost: 40,
      minSoldiers: 0,
      effects: []
    }, {
      id: 'ignore',
      label: '不管它',
      feedback: '感染开始扩散。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'casualties',
        nights: 2,
        count: 1
      }]
    }]
  },
  nestSplit: {
    id: 'nestSplit',
    title: '巢穴分裂',
    description: '一个巢穴正在分裂。两天内不摧毁它，旁边就会长出一个新巢穴。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'mark',
      label: '标出位置',
      feedback: null,
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'target',
        target: 'nestSplit'
      }]
    }]
  },
  veteran: {
    id: 'veteran',
    title: '老兵投奔',
    description: '一名老兵独自来到据点，想要加入。他守过的西边哨所已经没了。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'recruit',
      label: '收下他',
      feedback: '老兵加入了据点。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'soldiers',
        unit: 'rifleman',
        count: 1,
        veteran: true
      }]
    }, {
      id: 'inspiration',
      label: '给食物，让他离开',
      feedback: '老兵离开前讲了西边的情况。',
      cost: {
        food: 20
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'research',
        tech: 'current',
        fraction: 0.25,
        fallbackResearch: 0
      }]
    }]
  },
  overheat: {
    id: 'overheat',
    title: '炉心过热',
    description: '炉心温度过高，需要处理：用燃料降温，降低功率检修，或者派人抢修。',
    earliestDay: 5,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'fuel',
      label: '用燃料降温',
      feedback: '炉心温度降下来了。',
      cost: {
        fuel: 30
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }, {
      id: 'power',
      label: '降低功率检修',
      feedback: '炉心降低了功率。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'modifier',
        effects: [{
          kind: 'factor',
          stat: 'coreYield',
          value: 0.5
        }, {
          kind: 'building',
          building: 'core',
          stat: 'visionAdd',
          value: -4
        }],
        duration: 2
      }]
    }, {
      id: 'workers',
      label: '派人抢修',
      feedback: '两名工人去抢修炉心。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'isolate',
        count: 2,
        days: 1
      }]
    }]
  },
  northernSignal: {
    id: 'northernSignal',
    title: '北方的信号',
    description: '无线电收到一段清晰的信号，内容是一串数字和一句话：\'这里是长明城，我们还在。\'信号很快中断了。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 1,
    choices: [{
      id: 'numbers',
      label: '记下这串数字',
      feedback: '数字已经记下，可以用于旧频段破译。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'research',
        tech: 'oldFrequency',
        fraction: 0.5,
        fallbackResearch: 40
      }]
    }, {
      id: 'source',
      label: '定位信号来源',
      feedback: '信号来自{方向}边的 K-7 中继站。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'relayReveal',
        radius: 8,
        discoveredResearch: 30
      }]
    }]
  },
  tribe: {
    id: 'tribe',
    title: '拾荒者部族',
    description: '一队拾荒者路过，愿意用巢穴的位置换食物。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'intel',
      label: '用食物换情报',
      feedback: '拾荒者在地图上标出了两个巢穴。',
      cost: {
        food: 40
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'revealNests',
        count: 2
      }]
    }, {
      id: 'decline',
      label: '不需要',
      feedback: '拾荒者离开了。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }]
  },
  stormWarning: {
    id: 'stormWarning',
    title: '风暴前兆',
    description: '今晚有锈风暴，现在加固建筑还来得及。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'reinforce',
      label: '加固所有建筑',
      feedback: '建筑已经加固。',
      cost: {
        scrap: 50
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'modifier',
        effects: [{
          kind: 'factor',
          stat: 'stormBuildingDamage',
          value: 0.5
        }],
        duration: 'tonight'
      }]
    }, {
      id: 'ignore',
      label: '不加固',
      feedback: '没有加固建筑。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }]
  },
  surgeWarning: {
    id: 'surgeWarning',
    title: '大潮前夜',
    description: '今晚是大潮夜，白天还有时间准备。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'training',
      label: '加快训练',
      feedback: '兵营加快了训练。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'modifier',
        effects: [{
          kind: 'global',
          stat: 'trainSpeedPct',
          value: 0.5
        }],
        duration: 'today'
      }]
    }, {
      id: 'walls',
      label: '加固建筑',
      feedback: '建筑已经加固。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: [{
        kind: 'modifier',
        effects: [{
          kind: 'factor',
          stat: 'nightBuildingDamage',
          value: 0.8
        }],
        duration: 'tonight'
      }]
    }]
  }
};
export const INCIDENT_IDS: readonly IncidentId[] = ['caravan', 'refugees', 'rescue', 'raiders', 'mechanic', 'spores', 'nestSplit', 'veteran', 'overheat', 'northernSignal', 'tribe', 'stormWarning', 'surgeWarning'];
export const INCIDENT_TARGETS: Record<IncidentTargetKind, IncidentTargetDef> = {
  rescue: {
    kind: 'rescue',
    title: '求救信号',
    days: 2,
    guards: {
      wanderer: 3
    },
    completeText: '被困的三个人已经救回。',
    expireText: '求救信号中断了。',
    rewards: [{
      kind: 'survivors',
      count: 3
    }, {
      kind: 'resources',
      amounts: {
        fuel: 30
      }
    }]
  },
  nestSplit: {
    kind: 'nestSplit',
    title: '巢穴分裂',
    days: 2,
    guards: {},
    completeText: '分裂中的巢穴已被摧毁。',
    expireText: '巢穴分裂了，附近多了一个新巢穴。',
    rewards: []
  },
};
