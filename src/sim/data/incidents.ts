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
    description: '一支骆驼和改装车混编的商队停在据点外面。领头的人摘下防毒面具：\'有什么换什么，天黑前我们就走。\'',
    earliestDay: 2,
    weight: 3,
    maxOccurrences: 2,
    choices: [{
      id: 'fuel',
      label: '用废料换燃料',
      feedback: '商队的人往桶里灌油的时候，一直在数我们的废铁。',
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
      feedback: '一箱发霉的旧时代手册，小满高兴得像捡到了宝。',
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
      feedback: '商队走了，扬起一路的灰。',
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
    description: '一群人跟着炉心的光走到了围墙外，有老有小。为首的人说他们可以干活，只求一口饭和一个能睡觉的地方。',
    earliestDay: 2,
    weight: 2,
    maxOccurrences: 2,
    choices: [{
      id: 'all',
      label: '全部收留',
      feedback: '据点一下子热闹了，炊烟多了两缕。',
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
      feedback: '剩下的人往北走了。没人回头。',
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
      feedback: '他们留下几袋零件就走了，说算是谢谢我们没开枪。',
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
    description: '小满收到一段断断续续的求救信号：\'……被困在……{方向}边的旧加油站……还剩三个人……\'信号来源已经标在地图上。',
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
      label: '顾不上了',
      feedback: '小满把那个频道调成了静音。',
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
    description: '三辆改装车停在据点外面，车顶架着枪。\'这片地是我们的。交点过路费，大家相安无事。\'',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'pay',
      label: '交出物资',
      feedback: '他们装满了车斗，按了两声喇叭走了。',
      cost: {},
      costPct: {
        scrap: 0.3
      },
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }, {
      id: 'intimidate',
      label: '让他们看看我们的枪',
      feedback: '他们数了数墙上的枪口，掉头就走。',
      cost: {},
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 8,
      effects: []
    }, {
      id: 'refuse',
      label: '拒绝',
      feedback: '他们骂着走了。小满说，那些人知道怎么把变异体引过来。',
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
    description: '一个背着工具箱的人在炉心旁边坐了一下午，修好了三台坏掉的抽水机。老顾说，这人留下来能顶两个他。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'repair',
      label: '请他教大家修房子',
      feedback: '现在连小满都会焊钢板了。',
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
      label: '请他改机枪塔',
      feedback: '新的供弹槽，老顾看了一晚上。',
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
      label: '送他上路',
      feedback: '他走之前把笔记本塞给了小满。',
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
    description: '两个拾荒回来的人开始咳嗽，咳出来的痰是锈色的。老顾说，再晚几天就会传开。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'isolate',
      label: '隔离',
      feedback: '隔离帐篷搭在了下风口。',
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
      feedback: '小满翻遍了旧手册，总算配出一剂能用的。',
      cost: {},
      costPct: {},
      researchProgressCost: 40,
      minSoldiers: 0,
      effects: []
    }, {
      id: 'ignore',
      label: '不管它',
      feedback: '咳嗽声一天比一天多。',
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
    description: '小满盯着雾气图看了很久：\'有个巢穴在鼓起来，像是要分出一个新的。两天之内不把它端掉，旁边就会多出一个。\'',
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
    description: '一个独自走来的人把枪放在门口，举起双手。\'我在西边的哨所打了十年变异体。哨所没了，我还没死。\'',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'recruit',
      label: '收下他',
      feedback: '他挑了围墙上风最大的位置。',
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
      label: '给他点吃的，让他走',
      feedback: '他走之前跟小满讲了一晚上西边的事。',
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
    description: '炉心的外壳烫得能煎蛋，指针一直在红区抖。老顾说要么喂它燃料降温，要么停掉一半功率慢慢修。',
    earliestDay: 5,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'fuel',
      label: '用燃料降温',
      feedback: '炉心的嗡嗡声低了下去，所有人都松了口气。',
      cost: {
        fuel: 30
      },
      costPct: {},
      researchProgressCost: 0,
      minSoldiers: 0,
      effects: []
    }, {
      id: 'power',
      label: '降功率慢慢修',
      feedback: '据点暗了一圈。',
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
      label: '让大家帮忙修',
      feedback: '老顾带着两个人钻进了炉心底下。',
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
    description: '半夜里，无线电里突然出现一段很干净的信号，重复播放着一串数字，最后是一句话：\'这里是长明城，我们还在。\'信号很快被杂音盖住了。',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 1,
    choices: [{
      id: 'numbers',
      label: '记下这串数字',
      feedback: '小满把那串数字抄在了墙上，抄了三遍。',
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
      label: '循着信号找源头',
      feedback: '信号是从{方向}边那座铁塔传出来的。它还活着。',
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
    description: '一队骑着摩托的拾荒者路过，他们在锈原跑了好几年。\'给点吃的，我们告诉你巢穴在哪。\'',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'intel',
      label: '用食物换情报',
      feedback: '他们在地图上画了两个圈，圈得很用力。',
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
      feedback: '摩托声越来越远。',
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
    description: '老顾舔了舔手指举起来：\'今晚的风不对。现在加固还来得及。\'',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'reinforce',
      label: '加固所有建筑',
      feedback: '钉子、铁皮、沙袋，能用的都用上了。',
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
      label: '风来了再说',
      feedback: '老顾摇了摇头，回去收拾他的工具。',
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
    description: '雾潮还没到，天边已经暗了一截。小满把所有频道都调到了最大：\'今晚是大潮。我们还能做点什么？\'',
    earliestDay: 2,
    weight: 1,
    maxOccurrences: 2,
    choices: [{
      id: 'training',
      label: '全员赶工训练',
      feedback: '兵营里的灯一直亮到黄昏。',
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
      label: '加固围墙',
      feedback: '墙又厚了一层。',
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
    completeText: '三个人活着出来了，其中一个还抱着一桶油。',
    expireText: '那个频道再也没有响过。',
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
    completeText: '菌巢塌下去的时候，里面还在搏动。',
    expireText: '雾里多了一团新的红光。',
    rewards: []
  },
};
