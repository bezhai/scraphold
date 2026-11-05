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
  calm: '边缘不会来变异体，巢穴仍会派出自己的队伍。',
  raid: '变异体会从一个或几个方向过来。',
  rustStorm: '不来变异体，但风暴会腐蚀建筑，户外的人会受伤。',
  denseFog: '照常来变异体，但预报里看不到方向。',
  surge: '来的变异体比平时多得多。',
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

/**
 * One line per night type. The dusk broadcast still draws from this list with pick(), which consumes
 * exactly one calendar random number whatever the length, so the calendar stream stays unchanged.
 */
export const RADIO_BROADCASTS: Record<NightType, readonly string[]> = {
  calm: ['今晚是平静夜，边缘不会来变异体。'],
  raid: ['今晚有夜袭。'],
  rustStorm: ['今晚有锈风暴，建筑会受腐蚀，户外的人会受伤。'],
  denseFog: ['今晚是浓雾夜，判断不出变异体从哪个方向来。'],
  surge: ['今晚是大潮夜，变异体会比平时多得多。'],
};
export const FINAL_RADIO_BROADCAST = '今晚是最后一夜，大潮，有首领。守到天亮就获胜。';
