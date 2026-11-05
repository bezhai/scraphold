/** Fixed relay project parameters; progress is stored on its building. */
export type SignalStage = 'decoding' | 'repair' | 'ready' | 'broadcast';
export const SIGNAL_STAGE_NAMES: Record<SignalStage, string> = { decoding: '未破译', repair: '修建中', ready: '可以广播', broadcast: '广播中' };
export const SIGNAL = { repairDays: 3, workerSlots: 3, unmannedDelaySeconds: 15, broadcastNights: 3, retainProgress: 0.5, arrivalReach: 1.2 };
export const RELAY = {
  name: 'K-7 中继站',
  hint: '雾里那座铁塔是旧时代的 K-7 中继站，天线还立着。',
  description: '旧时代沿北线修建的信号中继站之一。修好它，就能向长明城发出求救信号。',
};
export const SIGNAL_TEXT = {
  discovered: '小满："那座铁塔！是中继站！老顾，你能修吗？" 老顾："得先知道它说什么话。"',
  research: '小满："我把能找到的旧频段资料都翻出来了。"',
  decoded: '老顾："密钥对上了。给我材料和人手，我把它重新立起来。"',
  build: '老顾："修这东西要时间。人别撤，材料别断。"',
  paused: '老顾："工地没人，我一个人可立不起塔。"',
  ready: '老顾："塔立起来了，随时能开机。不过开了机，雾里的东西也听得见。"',
  broadcast: '小满："信号发出去了！频率四四七点二……长明城，长明城，这里是锈原。"',
  dawn: '长明城接线员："锈原，我们收到了。车队正在集结，预计还要 N 天，请坚持住。"',
  destroyed: '小满："信号断了！塔倒了！"老顾："还能修，就是得从头接线。"',
  convoy: '长明城接线员："车队已经出发，预计还要 N 天。"',
  endingTitle: '长明城的车队',
  ending: '车队是在正午到的，车头漆着一盏灯。接线员本人跳下车，跟每个人握了手。\'我们以为北线已经没有人了。\'小满哭了，老顾假装在检查轮胎。你回头看了一眼炉心，它还亮着。',
} as const;
