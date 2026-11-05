/** Calendar rules and exact radio text from docs/narrative.md. V2 Task 2. */
export const NIGHT_TYPES = ['calm', 'raid', 'rustStorm', 'denseFog', 'surge'] as const;
export type NightType = (typeof NIGHT_TYPES)[number];
export const NIGHT_TYPE_NAMES: Record<NightType, string> = {
  calm: '平静', raid: '夜袭', rustStorm: '锈风暴', denseFog: '浓雾', surge: '大潮',
};
/** The current night plus this many subsequent nights are published. */
export const CALENDAR = {
  previewNights: 3,
  maxEdgeNightShare: 0.65,
  surgeWindows: [[5, 6], [9, 11], [14, 16], [20, 20]] as const,
  minSurgeGap: 4,
  maxSurgeGap: 6,
  surgeExtraDirections: 1,
};

export const NIGHT_TYPE_DESCRIPTIONS: Record<NightType, string> = {
  calm: '雾很薄，边缘不会来怪；巢穴还是会派出自己的那队。',
  raid: '变异体会从几个方向摸过来。',
  rustStorm: '不来怪，但锈蚀的风会腐蚀建筑，待在外面的人会受伤。',
  denseFog: '照常来怪，可雾太浓，看不清它们从哪边来。',
  surge: '雾潮涨起来了，今晚的怪会比平时多得多。',
};

export const WEATHER = {
  /** Fraction of maximum building HP lost per second before reductions. */
  buildingDamagePerSecond: 0.004,
  coreDamageMultiplier: 0.15,
  coreMinimumHp: 1,
  outdoorDamagePerSecond: 0.6,
  denseFogVisionMultiplier: 0.65,
  postStormVisionMultiplier: 0.8,
};

export const RADIO_BROADCASTS: Record<NightType, readonly string[]> = {
  calm: ['小满报告：今晚雾薄得跟纱一样，边上应该没动静。巢穴那边我可不敢保证。', '今晚可能是这几天最安静的一晚。要我说，适合出去转转。'],
  raid: ['小满报告：雾在动了。各位，把枪擦干净。', '监听到雾里有动静，今晚它们会来。方向我标在地图上了。'],
  rustStorm: ['小满报告：风暴要来了。人都进屋，别站在外面看热闹。', '风向变了，锈风暴今晚到。明天老顾有的忙了。'],
  denseFog: ['小满报告：雾太浓了，我什么都看不见。今晚只能靠耳朵。', '无线电全是杂音，方向判断不出来。四面都守着点吧。'],
  surge: ['小满报告：雾潮在涨。我不想吓唬谁，但今晚会很难熬。', '这是大潮。把能拿枪的都叫上，把能修墙的都叫上。'],
};
export const FINAL_RADIO_BROADCAST = '小满报告：最后一晚了。雾潮比哪次都大，雾里有个很大的东西在动。撑到天亮，我们就赢了。';
