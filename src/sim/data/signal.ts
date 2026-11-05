/** Fixed relay project parameters; progress is stored on its building. */
export type SignalStage = 'decoding' | 'repair' | 'ready' | 'broadcast';
export const SIGNAL_STAGE_NAMES: Record<SignalStage, string> = { decoding: '未破译', repair: '修建中', ready: '可以广播', broadcast: '广播中' };
export const SIGNAL = { repairDays: 3, workerSlots: 3, unmannedDelaySeconds: 15, broadcastNights: 3, retainProgress: 0.5, arrivalReach: 1.2 };
export const RELAY = {
  name: 'K-7 中继站',
  description: '旧时代北线的信号中继站。研究"旧频段破译"后，可以在原址修建信号塔，向长明城求援。',
};
export const SIGNAL_TEXT = {
  discovered: '发现了 K-7 中继站。研究"旧频段破译"后可以在这里修建信号塔。',
  research: '开始破译旧频段。',
  decoded: '旧频段已经破译，可以在 K-7 中继站修建信号塔。',
  build: '信号塔开始修建，工人在场时才有进度。',
  paused: '信号塔工地没有工人，修建暂停。',
  ready: '信号塔建好了。开始广播后，变异体会专门来攻击信号塔。',
  broadcast: '信号塔开始向长明城广播。',
  dawn: '长明城："收到你们的信号。车队预计 N 天后到达。"',
  destroyed: '信号塔被摧毁，广播中断。',
  convoy: '长明城："车队预计 N 天后到达。"',
  endingTitle: '长明城的车队',
  ending: '长明城的车队到了，拓荒队跟着车队去了长明城。',
} as const;
