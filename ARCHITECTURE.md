# 锈土据点 · SCRAPHOLD 架构说明

玩法和验收结果见 `README.md` 与 `docs/acceptance.md`。本文件说明代码怎么组织、每个文件归哪个任务、共享的状态模型和指令集，以及确定性规则。后续任务先读这里，再读对应文件头部的注释。

## 技术栈和脚本

Vite + TypeScript（strict）+ Vitest，界面用 Preact，渲染用 Canvas 2D，不用游戏引擎。依赖已经全部装好（含 happy-dom、@testing-library/preact、@playwright/test 和 Chromium 1248），后续任务不要改 `package.json` 和 lockfile；确实缺依赖时报告给主会话。

| 命令 | 作用 |
|---|---|
| `pnpm typecheck` | 先用 `tsconfig.sim.json` 编译 `src/sim`（没有 DOM 和 Node 类型），再用 `tsconfig.json` 编译全部代码 |
| `pnpm test` | Vitest，测试文件放在被测文件旁边，命名 `*.test.ts(x)`，只收 `src/**` |
| `pnpm sim --seed S --days N [--origin O] [--difficulty D] [--bot B] [--json]` | 无头跑 N 个完整昼夜，打印摘要和状态哈希 |
| `pnpm dev` / `pnpm build` / `pnpm preview` | 客户端开发、构建（`base: './'`，产物可离线打开） |
| `pnpm e2e` | Playwright：先 `vite build`，再用 `vite preview` 在 4317 端口服务产物。`gameFlow`（开局到第一夜的界面流程、HUD 面板和菜单）、`firstDays`（用真实鼠标键盘玩到第 3 天，途中弹出的事件卡像玩家一样点选项回答）、`v2Flow`（第二版：看日历、找到中继站、处理第一个白天事件、刷新后继续、撤退、顶栏排版、HUD 遮挡率，以及目标点、特殊遗迹、信号塔、锈风暴夜、浓雾夜和四种结算的截图）、`renderPerf`（渲染压力）、`livePerf`（真实模拟下 300 只怪物加 80 个士兵的帧率）、`fullGame`（经济机器人在 3 倍速下通过真实客户端打满 20 夜，约 13 分钟，最终哈希与同一机器人的无头运行一致）。开局、关介绍卡、回答事件卡这些公共步骤在 `e2e/support.ts`。截图存 `e2e/screenshots/` |
| `pnpm exec playwright test -c playwright.art.config.ts` | 美术检查，和主套件分开：构建到 `dist-art/`，在 4319 端口服务。`artScenes`（固定种子的场景截图，带 HUD 和只有世界两种）、`artPerf`（渲染压力，以及缩到最小、整张地图都在视野里时和默认缩放下的实时压力帧率），截图和 `perf.json` 存 `e2e-art/screenshots/` |
| `pnpm balance [--seeds 20] [--bots ...] [--origins all] [--difficulties normal,hard]` | 机器人批量跑局，按难度和营地特性输出胜率表和 spec 的平衡指标（PASS/FAIL），结果存 `balance/latest.json` |
| `pnpm trace --bot economy [--seed S] [--origin O] [--difficulty D]` | 跑一局机器人对局，每个黄昏和天亮打印一行，用来观察机器人的行为 |

## 分层

- `src/sim/`：模拟层，纯 TypeScript，固定步长，可确定重放。不依赖浏览器和 Node，不 import 本目录以外的任何东西。
- `src/headless/`：无头运行器和命令行，只用 `src/sim/index.ts` 的公开 API。任务 5 的机器人放在这里（例如 `src/headless/bots/`）。
- `src/client/`：浏览器客户端（任务 4）。只通过公开 API 读状态、下指令，不写规则。

## 模块和归属

“归属”指哪个任务可以修改这个文件。共享文件（标“主会话”）在并行阶段不要改；确实需要改时，在报告里写清楚要改什么、为什么，由主会话合并。

| 文件 | 内容 | 归属 |
|---|---|---|
| `sim/index.ts` | 公开 API：`createGame`、`stepGame`、`applyCommand`、`validateCommand`、`drainEvents`、`checkPlacement`、`hashState`、`viewState`/`GameView`、状态类型，以及客户端显示数值用的规则函数（见“客户端读的规则函数”） | 主会话 |
| `sim/scenarios.ts` | 压测场景：`deployArmy`（核心周围摆一支混编军队）、`releaseHorde`（外圈放一群进攻的怪物）。只给客户端的 debug 钩子和测试用，不从 `index.ts` 导出 | 任务 6 |
| `sim/state.ts` | 根状态 `GameState`、实体类型、`Motion`、`SoldierOrder`、地图和迷雾、`GameStats` | 主会话 |
| `sim/events.ts` | 事件联合类型 `GameEvent`、`emit`、`drainEvents` | 主会话 |
| `sim/commands.ts` | 指令联合类型、`RejectReason` 和中文提示 `REJECT_REASON_TEXT`、`CommandHandler` | 主会话 |
| `sim/commandHandlers.ts` | 指令类型到处理器的分派表 | 主会话 |
| `sim/pipeline.ts` | 每 tick 的系统顺序 `PIPELINE` 和 `stepGame` | 主会话 |
| `sim/game.ts` | `Game` 容器（状态 + 派生缓存 + 事件）、`refreshModifiers` | 主会话 |
| `sim/modifiers.ts` | 效果类型 `Effect` 和汇总表 `Modifiers`，`computeModifiers` | 主会话 |
| `sim/time.ts`、`rng.ts`、`hash.ts`、`record.ts` | 时钟常量、带种子的随机数、状态哈希、全零记录 `zeroRecord` | 任务 1 / 主会话 |
| `sim/map/grid.ts`、`map/mapgen.ts`、`data/map.ts` | 格子工具、地图生成、地形和生成参数 | 任务 1 / 主会话 |
| `sim/nav/*` | 导航网格、格子分类常量、A*、朝核心的流场、堆 | 任务 1 / 主会话 |
| `sim/world/*` | 实体工厂和移除、空间索引、移动、迷雾、放置几何检查、单位指令、开局、时钟系统、清理系统 | 任务 1 / 主会话 |
| `sim/testing.ts` | 手画地图建测试局 `createTestGame` | 任务 1 / 主会话 |
| `sim/economy/*`（`model.ts`、`workers.ts`、`construction.ts`、`production.ts`、`population.ts`、`exploration.ts`、`tech.ts`、`policies.ts`）和 `sim/data/economy.ts` | 经济与发展的状态子结构、系统、指令处理器、数据表 | 任务 2 |
| `sim/combat/*`（`model.ts`、`night.ts`、`nightBudget.ts`、`nests.ts`、`mutants.ts`、`soldiers.ts`、`attacks.ts`、`outcome.ts`）和 `sim/data/combat.ts` | 战斗与夜晚的状态子结构、系统、指令处理器、数据表 | 任务 3 |
| `src/client/**`、`index.html`、`e2e/**`、`playwright.config.ts` | 浏览器客户端 | 任务 4 |
| `src/headless/run.ts`、`cli.ts` | 无头运行器 | 任务 1；任务 5 只加新文件 |
| `src/headless/bots/*`、`balance.ts`、`balanceGame.ts`、`trace.ts`、`economyCheck.ts` | 机器人（经济优先、清巢、工事、信号塔、什么都不做）和平衡跑局脚本。机器人只用公开 API，只针对已发现的巢穴和当前可见的怪物 | 任务 5 |

任务 2、3 可以在自己的目录里新增文件，也可以扩展自己 `model.ts` 里的类型（标了 “(UI)” 的字段客户端会读，保持含义不变）。两者都不改对方目录。互相需要的东西只通过共享状态读：例如任务 3 读 `state.economy.upkeep.hungry`，任务 2 读 `state.stats.kills`。

## 第二版共享契约与文件归属

上面的任务号描述第一版分工；第二版以下表为准。任务 1 定义共享类型与初始状态，任务 2–4 实现规则，任务 5 实现客户端，任务 6 调整机器人和平衡。日历、天气和信号塔系统已接入 pipeline；白天事件抽取仍由任务 3 实现。

| 文件 | 第二版归属与职责 |
|---|---|
| `sim/state.ts`、`game.ts`、`commands.ts`、`commandHandlers.ts`、`events.ts`、`index.ts`、`save.ts` | 任务 1 / 协调者，共享契约与存档 |
| `sim/calendar/*`、`data/calendar.ts`、`combat/night.ts`、`combat/nightBudget.ts`、`combat/nests.ts`、`data/combat.ts` 的夜晚和巢穴参数 | 任务 2，日历生成、公布、天气、夜袭与巢穴成长 |
| `sim/incidents/*`、`data/incidents.ts` | 任务 3，白天事件、选择、限时目标、效果；文案使用协调者的 `docs/narrative.md` |
| `sim/signal/*`、`data/signal.ts`、`economy/tech.ts`、`economy/policies.ts`、`data/economy.ts`、`combat/outcome.ts` | 任务 4，信号塔、科技政令与信号塔计分；向任务 2 提供广播夜袭需求 |
| `src/client/**` | 任务 5，界面、渲染、存档存储介质与暂停 |
| `src/headless/**`、`sim/scenarios.ts` | 任务 6，机器人、平衡、性能验收 |

新增权威状态（均参与哈希和存档）：

- `calendar: CalendarState`：`nights[night - 1] = {night, type}`，夜晚从 1 开始，共 `TOTAL_NIGHTS` 项。`NightType` 为 `calm | raid | rustStorm | denseFog | surge`。**权威状态本身只保存公开项的类型，未公开项为 null**，所以直接读取 `game.state` 或 `viewState(game)` 都读不到未来类型。`revealedThroughNight` 初值 4，每天增加到 `min(20, day + 3)`；已公开的历史不隐藏。`CALENDAR.previewNights = 3` 指今晚之外再公开未来 3 晚。
- 完整日历在开局从 `rng.calendar` 生成，生成前的随机流快照保存在 `calendar.generationRng`。`game.calendarPlan` 是由该快照和难度完全重建的派生缓存，不属于 `GameView`，客户端和机器人不得读取。恢复存档时从快照副本重建，不消耗正在使用的随机流；不把未来类型数组放进客户端可读状态。黄昏播报随后使用 `rng.calendar`，不会改变已定日历。
- 日历固定第 1 夜为平静，第 20 夜为大潮；在 `[5,6]`、`[9,11]`、`[14,16]`、`[20,20]` 各选一次大潮，并约束相邻大潮间隔 4–6 天。相同种子在各难度使用同一组大潮日期，便于比较。按难度数据填入其他夜晚，回溯保证平静夜不连续超过 2 晚，且每个日历前缀的边缘进攻夜比例不超过 `CALENDAR.maxEdgeNightShare = 0.65`；提前结束的对局也受此约束。无随机重试次数上限导致的偶发失败。由此前缀约束可推出：前 3 夜最多 1 个边缘进攻夜；普通/困难各有 13 个进攻夜，第 18 夜前最多安排 11 个，因此第 19 夜必为进攻夜。静夜也倾向前置：普通 `balance-1` 至 `balance-20` 样本，第 1–10 夜平静/风暴合计 87 次，第 11–20 夜 53 次；这是样本分布，非额外固定配额。设计上接受开局建设时间较多、后期压力递增。
- 难度数据新增 `calmNights/stormNights/denseFogNights/surgeBudgetMultiplier`。简单为 `6/2/2/1.3`，普通为 `5/2/3/1.5`，困难为 `4/3/4/1.7`；余下非大潮夜为普通夜袭。因此无边缘夜袭分别为 8/7/7 晚。大潮预算为 `NIGHTS[n-1].budget × nightBudgetPct × surgeBudgetMultiplier`，额外增加一个方向，最多使用实际存在的出生点。预算表中的 `boss` 是该日发生大潮时的候选首领，普通夜袭和浓雾不使用；第一次首领跟随第一个大潮，第 20 夜必有首领。普通巢穴/母巢等级上限为 12/20。母巢基础生命 100000，每级增加 1600；守卫为 10 + 2 × 等级。`DifficultyDef.hiveHpPct` 在简单/普通/困难分别为 0.8/1/1.2，仅缩放母巢生命；实体创建和成长共用 `nestMaxHp`，每天及撤退吸收仍可提升等级，增加生命上限时只补本次增加量。普通巢穴专属生命、成长和守卫配置不变，怪物伤害仍使用难度的全局倍率；母巢不分裂。
- 平静夜只保留巢穴攻击组；锈风暴不产生边缘或巢穴攻击组，已有守卫仍按既有规则行动。其他夜晚正常生成夜袭，浓雾夜隐藏方向。
- `NightForecast.directionsKnown` 明确表示是否知道方向。浓雾固定 `{directionsKnown:false, precise:false, groups:[]}`，瞭望塔不能解除；其他类型为 true，空组表示没有进攻组。`night.plan` 是模拟规则使用的真实计划，客户端和机器人不得用它推断浓雾方向。
- `night.broadcast: {night, type, text} | null`：黄昏第一个 tick 写入当晚的完整播报，持续到天亮后清空。普通夜晚按类型从 `RADIO_BROADCASTS` 用种子选取（每种类型只有一条，但仍用 `pick` 抽取，保证日历随机数的消耗不变），第 20 夜固定 `FINAL_RADIO_BROADCAST`。文案及日历提示逐字取自 `docs/narrative.md`；本轮只提供状态，日志展现由客户端任务接入。
- 锈风暴每秒腐蚀建筑最大生命的 0.4%，核心再乘 0.15，且腐蚀本身不使核心生命低于 1；户外幸存者每秒损失 0.6 生命，建筑内工人和士兵不受暴露伤害。包括工地在内的玩家建筑均受腐蚀，环境伤害绕过武器护甲倍率，复用统一伤亡统计。新增全局修正键 `stormBuildingDamageTakenPct`、`stormOutdoorDamageTakenPct`，分别乘 `max(0, 1 + 修正和)`，可由科技、政令使用；`-1` 为完全免疫，不产生伤害或警报。
- `calendar.reducedVisionUntilTick` 为风暴后视野惩罚的排他结束 tick；次日天亮起持续至次日入夜（含黄昏），全局视野乘 0.8。浓雾夜视野乘 0.65，只在夜间生效。`visionRadius` 统一应用天气缩放，渲染和规则无需重复计算。

- `incidents: IncidentState` 保存事件卡、历史、限时目标和持续效果，全部参与哈希及存档。具体契约和规则见下面“白天事件与遗迹残页”。
- `data/incidents.ts` 为 13 个事件、31 个选项及 2 类目标的唯一效果数据表；标题、正文、选项、反馈逐字取自 `docs/narrative.md`。`data/fragments.ts` 保存 8 段残页原文及署名。
- `map.relaySite: RelaySite | null` 是固定的 `{tileX, tileY, size:3}`，手画测试地图可以为 null。独立于一次性奖励遗迹；学者开局揭示遗迹不揭示中继站。废墟可通行，普通建筑不能覆盖。`BuildingType.signalTower` 只能通过 `placeBuilding` 建在这个原址。
- `signal: SignalState`：`site` 固定；`discovered` 表示占地进入探索范围；`visited` 永久记录任意存活己方单位到达占地边缘 1.2 格内。完成 `oldFrequency` 且曾经到达即自动破译，先到访后研究也在研究完成当 tick 生效。
- `stage: decoding | repair | ready | broadcast`；`buildingId` 是工地/成塔实体 id，未建或被毁为 0。施工唯一真值为该实体的 `construction.progress/total`；工人唯一名单为 `Building.workers`，使用 `assignWork/unassignWork`。在途工人不施工，实际入驻的存活工人按工位上限线性增加速度；普通 repair 助建不推进信号塔。建成同 tick 通过共用撤工逻辑释放在岗工人；在途工人在下次 workers 阶段回到空闲；已建成的塔拒绝新的 `assignWork`。`ready` 不自动广播。
- `retainedProgress` 是下次重新付费放置可恢复的施工比例，正常为 0；被毁保存实际已完成比例的 50%，成塔被毁为 50%。重新放置后消费该值，取消/主动拆除不保留进度。没有额外工人名单或重复的活动施工进度。
- `nightsHeld/nightsRequired` 表示广播进度；基础需要 3 晚，`signalAmplification` 减少 1 晚（目标即时更新；若已守足两晚，研究完成即可触发胜利，避免因研究时机额外等待一晚）；`broadcastStartedTick`（初值 -1）与 `lastHeldNight` 防止重复结算；只有开播后才进入黄昏规划的夜晚计数，黄昏规划之后或夜里开播的当晚均不计数。`lastHeldNight` 是最近已处理的广播天亮对应夜号（包括未计数的首晚）。塔被毁清零广播进度并回到 `repair`。风暴夜也计数：风暴会持续损伤塔，守住风暴同样应获得进展。
- `researchAnnounced` 保证首次开始破译研究只发一次消息。原 `unmannedAnnounced` 已删除，改为 `constructionStaffed`（本次施工曾有在岗工人）、`unmannedSinceTick`（连续无人起点，-1 表示未计时）及 `lastUnmannedDay`（最近提示日，初值 0）。连续无人 15 秒才发提示（`SIGNAL.unmannedDelaySeconds`）；首次派工的在途时间不计；工人回来清空计时，可再次触发，但同一天最多一次，重建也不绕过同日限制。
- `GameEvent.signalMessage.text` 直接输出完整 narrative 原文模板。开播后首个天亮使用 `SIGNAL_TEXT.dawn`（带“收到你们的信号”），之后使用 `SIGNAL_TEXT.convoy`，将 N 替换为还需守住的晚数；不计数的首晚仍播报剩余晚数。满额天亮不发长明城的回复，直接输出救援尾声。被毁重启后重新使用首句。事件只供显示，不反推玩法状态。
- 广播定向攻击沿用 `AttackGroup.assaultTargetId → PendingSpawn.assaultTargetId → MutantAi.assaultTargetId`（0 为核心）。开播指令不修改任何已经规划、待生成或在场怪物的目标；之后的夜袭规划从新生成的方向队伍/巢穴队伍中指定恰好一组攻塔，平静夜仅从巢穴队伍中选择；不额外提高预算，风暴不刷怪。塔方向与核心方向共用流场算法，缓存按目标 id 与 navVersion 重建，阻路建筑仍须先被摧毁；塔消失时退回核心目标。
- `VictoryMethod = survived | hiveDestroyed | signal` 直接用于 `outcome.reason` 和 `gameOver.reason`。三种胜利基础分分别为 1500、1750（1500 + hive 250）、2000（1500 + signal 500）；母巢和信号塔提前胜利均按完整剩余天数每昼夜 +50；每摧毁一座巢穴 +80、每名存活幸存者 +10、每座非路障建筑损失 -10，难度乘数不变。核心同 tick 被毁优先判负。

指令契约（旧的 `decodeSignal/startSignalRepair/assignSignalWorkers/unassignSignalWorkers` 已删除，不提供兼容别名）：

| 指令 | 参数 | 行为 |
|---|---|---|
| `resolveIncident` | `incidentId, choiceId` | 校验待处理事件、截止时间及选项条件，付费并执行效果；见下文拒绝原因 |
| `placeBuilding` | `building:'signalTower', tileX, tileY` | 校验已破译、原址、资源、占地后付费建造 |
| `assignWork` / `unassignWork` | 现有参数 | 与普通建筑共用派工及工位限制，允许向信号塔工地派工 |
| `startSignalBroadcast` | 无 | 仅存活、已完成且处于 `ready` 的塔可启动；已生成的夜袭计划保持不变 |

新增拒绝原因：`signalNotDecoded`（须研究并到达）、`wrongRelaySite`（必须原址）、`signalNotReady`（未建成或已广播）、`signalTowerComplete`（成塔不再需要施工工人），均有中文文本；资源不足沿用 `insufficientResources`。

新增科技 id：生存 `oldFrequency/relayPower/signalAmplification/fogFiltration/reserveGranary`，军工 `nightVision/rapidDeployment/expeditionPack`，工事 `windReinforcement/outpostWorks`。科技总数 25（10/8/7），所有新增科技均有一次性的 50% 灵感条件；政令总数 14，新增 `stormReadiness/expeditionSupplies/fullBroadcast`。具体数值以 `data/economy.ts` 为准。

远程效果统一调用 `world/remote.ts:isRemote(state, point)`，按单位/建筑中心到核心中心距离 **大于等于 16 格** 判断，阈值为 `REMOTE_DISTANCE`。远征补给在其他口粮修正之后将远程士兵消耗乘 0.5；风暴戒备的生产损失仅在风暴夜生效。前哨生命和速度只作用于满足距离条件的建筑。士兵所有最大生命变化统一保持血量比例，包括晋升、科技和远征切换，不再因是否研究远征背包而改变规则；这样可避免反复跨界回血。`Soldier.deploymentGoal: Point | null` 保存新兵第一次集结目的地；抵达或收到新指令时清除，快速部署的额外加速随之结束。`soldierWeapon` 的只读输入现在还包含位置和 deploymentGoal。

信号塔基础费用 400 废料、80 燃料，生命 2400，工位数从 `SIGNAL.workerSlots` 读取（当前 3）；总工作量按工期 × 昼夜 tick × 工位数推导（当前 19800 工人 tick，满 3 人、无加成需 3 个昼夜）；中继供能费用 -25%、速度 +30%；全频广播在施工/广播期间将武器与环境伤害乘 0.65，可广播但尚未启动时不生效。新科技花费 180–320，原 15 项科技花费不变；任务 6 将研究站每工人每秒科研从 0.25 提到 0.35。

`signal` 系统在 tech 之后、outcome 之前运行，因此可处理当 tick 科技完成、施工完成和战斗死亡；cleanup 最后移除死亡实体。`src/headless/bots/signal.ts` 为正式的第四套策略（`signal`），采用经济科研路线，通过现有指令和共享策略流程执行；只在发现中继站后安排到访和驻场，不读取未公布日历。`node --import tsx src/headless/signalCheck.ts [--origin=scavengers|militia|scholars] [seed ...]` 输出各局结果及信号胜利天数分布。

公开 API 增加 `nightType(state, night?)`（只返回已公布类型，未知/越界为 null）、`weatherVisionMultiplier({state, modifiers})`（只读接口，直接读取已汇总的 `modifiers.global.postStormVisionImmunity`，不再扫描科技表），并导出 `NIGHT_TYPE_DESCRIPTIONS/WEATHER/RADIO_BROADCASTS/FINAL_RADIO_BROADCAST`；同时导出上述模型、`NightType`、`SignalStage`、incident 数据类型、名称表，以及 `TOTAL_NIGHTS/GAME_END_TICK/CYCLE_TICKS`。不增加旧字段别名或兼容路径。

### 白天事件与遗迹残页（第二版任务 3）

**客户端契约。** `state.incidents.pending` 为唯一待选卡片或 null：`id/definitionId/raisedTick/deadlineTick/title/description/choices/target`。`deadlineTick` 为当天入夜的排他截止点。`choices[]` 含 `id/label/description/feedback/cost/costPct/researchProgressCost/minSoldiers/effects`；正文及反馈的 `{方向}` 已按核心到目标/中继站的实际八方位填好。`description` 由同一效果数据生成，北方信号的研究/发现状态变化后随 tick 更新。成本按结算时资源计算，百分比费用向下取整。客户端必须调用 `validateCommand(game, {type:'resolveIncident', incidentId, choiceId})`，使用 `REJECT_REASON_TEXT[result.reason]` 判断及解释可选性，不自行重算前置条件。暂停和卡片组件仍由客户端任务接入。

拒绝原因新增 `incidentNotPending/unknownIncidentChoice/incidentExpired/insufficientSoldiers/insufficientWorkers/noCurrentResearch/noUndiscoveredNests/incidentTargetUnavailable`；资源不足沿用 `insufficientResources`。`unassignWork` 对未到期隔离工人返回 `workersIsolated`；分裂预留地的建造返回 `incidentReserved`。每个原因都有中文文本。手选和自动结算调用同一校验/效果逻辑；天黑从末尾向前寻找首个可选项。除唯一选项的分裂预警外，所有数据定义至少有一个始终可选项。已被摧毁的分裂父巢由系统自动确认完成，避免唯一选项失效后卡住。旧的 `notImplemented` 占位处理器及拒绝原因已删除。

`pending.target` 在卡片出现时已经确定，结构为 `{kind,tile,nestId,splitTile}`。选中目标选项后写入 `incidents.targets[]`，另有 `id/incidentId/title/createdTick/expiresTick/status/guardIds`。类型为 `rescue | nestSplit`；非适用实体 id 为 0，非分裂 `splitTile` 为 -1。地图显示 `status === 'active'` 的项；位置为 `tileCenter(state.map, target.tile)`，剩余秒数为 `max(0, expiresTick-state.tick)/TICKS_PER_SECOND`。完成/过期记录保留用于统计，不再显示为活动目标。`history[]` 记录实例、定义、出现/处理 tick、choiceId 和 automatic；`nextId` 供卡片与目标共用。`eventDays/northernDay/nextIncidentTick/lastIncidentDay` 为已确定的调度状态。

输出事件为 `incidentRaised {incidentId}`、`incidentResolved {incidentId,choiceId,automatic,feedback}`、`incidentTargetResolved {targetId,status,text}`、`ruinFragment {index,text}`。目标接受选项在原文中没有即时反馈，所以 `feedback` 为 null，只在完成或超时输出原文。残页索引为 1–8；`fragmentIndex` 保存已经发出的段数，探索第 9 处及以后仍给普通奖励但不再发残页。新局从 0 开始。输出队列不是玩法状态，恢复存档不会重播历史消息。

**抽取。** 首次 incidents 阶段使用独立 `rng.incidents` 预排第 2–20 天，先均匀选定 9–11 次配额，再以随机顺序回溯选择事件日，约束连续事件日最多 2 天、连续空白日最多 3 天（第 1 天也计入初始空白连续长度）。结果保存为升序 `eventDays`，初始为空，只初始化一次；回溯对数量进行剪枝，没有随机重试次数上限，因此保证约束而不是概率满足。第 1 天无事件。正常完整对局按表产生 9–11 次；提前结束时只发生截至终局的事件。事件日白天第 5–15 秒（100–300 tick，含端点）均匀抽取时刻。池为空的异常状态跳过当天，不抛异常或反复重试。

先过滤资格再加权：商队权重 3，难民、求救信号权重 2，其余 1；住房剩余不超过 2 时难民乘 3。每类最多 2 次，相邻两次事件不重复（跨空白日也不重复）。北方信号整局恰好 1 次：预演第 2–6 天**事件日**的天气预警（遵守次数/相邻限制），优先从第 3–6 天未被预警占用的事件日选取；如果均被占用，则从该窗口事件日选一个并挤掉当天预警。空白日不消耗预警名额，也不打断相邻事件限制。风暴/大潮预警仅在事件日出现，优先于随机事件；大潮虽有四晚，预警仍最多两次。`IncidentDef.earliestDay` 中炉心过热为第 5 天，其余为第 2 天。无普通巢穴时排除分裂（母巢永不分裂），无未发现巢穴时排除部族；目标没有可达候选地点时排除。候选按稳定顺序生成，资格检查不消耗随机数。

**目标及守卫。** 只保留救援与分裂，删除补给/钥匙卡定义、类型、配置和执行分支。目标确认时开始计时，均为 2 个完整昼夜；到期优先于同 tick 抵达/击毁。救援要求存活且在地图上的士兵，单位边缘距目标中心不超过 1.2 格即到达，无须先杀完守卫；分裂以父巢消失或生命归零判定完成。

候选由核心外圈的可通行区域遍历得出。救援复用统一 `isRemote`（距核心至少 16 格），最远 36 格，优先距巢穴占地不超过 9 格的荒地。生成 3 个 wanderer，从目标周围每轴 3 格内选择可通行格，按距目标从远到近、tile 编号排序，复用守卫 AI/移动/战斗。出卡和确认均复核出生位置数量，不足时不入池或返回 `incidentTargetUnavailable`。`MutantAi.guardPoint: Point | null` 是守卫锚点，普通巢穴守卫仍使用 homeNestId。目标结束移除剩余事件守卫，不给击杀奖励。

**特殊遗迹。** `Ruin.kind: 'ordinary' | 'supplyPod' | 'warehouse'` 为必填状态。普通 12–16 处之外，额外生成 `supplyPod` 2 处和 `warehouse` 1 处；在巢穴和中继站占地确定后，从核心可达、无结构的荒地选择位置，直接调用 `isRemote`，保留遗迹间距，不另写远程阈值。`isRemote` 接受 `{coreId, entities: ReadonlyMap<number, Readonly<Point>>}` 坐标投影，仍兼容直接传入完整 GameView。私有地图随机流负责位置，不消耗事件流。

客户端读取 `state.map.ruins[].kind/tile/explored`，对非 ordinary 种类查 `SPECIAL_RUINS[kind].name/description` 显示名字和悬停描述；数据和 `RuinKind/SpecialRuinDef` 从 `sim/index.ts` 导出，也可直接导入 `sim/data/ruins.ts`。绘制外观留给前端任务。表内还包含 `count/feedback/reward`，文案逐字来自 narrative。补给舱固定基础奖励 `{kind:'resources', amounts:{scrap:80,fuel:20}}`（RuinReward 新增资源包形状）；仓库固定 `{kind:'unit', unit:'sniper'}`。不从随机表抽取。探索复用原系统，资源包沿用 `ruinRewardPct` 加成，免费单位不消耗幸存者、不记训练数，照常计入口粮。计数、科技灵感和残页与普通遗迹完全相同。

`ruinExplored` 新增必填 `feedback: string | null`：特殊遗迹为反馈原文，普通遗迹为 null；保留 `ruinId/tile/reward`（实际奖励）。客户端日志优先显示反馈，否则显示原奖励说明，并支持资源包；其他客户端显示不变。机器人 `knownRuins/visitRuin` 不筛种类，自然覆盖特殊遗迹，不新增专用策略。

分裂只能指定普通巢穴，允许未发现的普通巢穴，确认后揭示它。父巢在待选期间被摧毁时，手动标记返回 `incidentTargetUnavailable`；incidents 或 incidentTargets 阶段自动按该唯一选项记入历史、立即完成目标并输出完成原文，不生成新的活动任务或子巢。选点同时在父巢中心每轴 10 格以内，按距离、tile 顺序选择一块可通行的 2×2 地，排除建筑、遗迹、中继站及其他分裂预留地。待选卡与活动目标期间禁止玩家建筑占用；超时在那里生成 1 级普通巢穴并揭示。临时站在该占地内的单位移动到新巢外围可通行格，避免陷入结构。父巢已被摧毁则完成，不再分裂。

部族情报在结算前重新检查未发现巢穴，已经全部发现时返回 `noUndiscoveredNests`，不扣食物；当前研究、资源、士兵、在岗人数等前置条件也均以结算时状态校验。

**持续效果及确定性选择。** 永久和临时效果保存于 `incidents.modifiers {incidentId,effects,startsTick,expiresTick}`，由唯一的 `computeModifiers` 与科技/政令/出身合并。永久 expiresTick 为 null；今天止于入夜；今晚为入夜至下个黎明；N 天为确认后 N 个完整昼夜。新增 `Effect.kind='factor'`，`Modifiers.factor.coreYield/stormBuildingDamage/nightBuildingDamage` 初始 1、逐项相乘，分别用于核心保底产出、风暴建筑腐蚀及夜间建筑武器/环境伤害，保证“减半”与已有减伤正确相乘。核心视野单独使用 `building.core.visionAdd`，本次过热为 -4 格；普通产出不受核心减产影响。机械师两次相同永久效果按现有 Pct 相加。

配药使用选项数据 `researchProgressCost=40`：先扣科研库存，不足部分扣当前未完成研究的进度；库存与该进度合计不足时返回 `insufficientResources`。其他科技的进度、已经完成的研究不能支付。普通 `cost` 仍只扣库存。事件和遗迹奖励统一调用 `economy/recruitment.ts:recruitSurvivors`，沿用遗迹每行两人、间隔 0.6 格的落点，统一累计招募及发送 survivorJoined。

隔离/维护选择编号最小的 2 名存活、实际在岗工人（沿用工位上限），离开原岗位进入核心停工，1 个昼夜后释放为核心旁的空闲幸存者，不自动重派原岗位。期间仍计人口/住房，不能训练、移动或提前撤工；核心保底产出不依赖这些人。`isolatedSurvivors {unitId,expiresTick}` 只保存期限，实体位置与 Building.workers 复用现有系统。感染在当前及下一晚各损失编号最小的存活幸存者，包含隔离者；没有幸存者时当晚无损失，也不改杀士兵。`casualties {incidentId,night,count}` 消费一次后删除。研究灵感无当前研究时拒绝；有研究则增加该科技总成本的 25%，不占用科技自身的 50% 自动灵感机会。超过成本封顶，由既有研究系统完成科技。北方信号的已完成/已发现替代奖励按结算时状态判断。

掠夺者拒绝写入 `nightBudgetAdjustments {night,budgetPct}`，平静/锈风暴顺延到下个有边缘进攻的夜晚，多次加码相加。小字与结算共用 `incidentAttackNight`，出卡时直接说明今晚或第 N 夜。`AttackGroup.baseBudget` 保存加码前预算；黄昏后选择或入夜自动选择时，按修正后预算重新购买边缘队伍并更新预报，保留方向、首领、巢穴组、攻塔目标，额外随机抽取只消费 night 流。夜袭计划与生成顺序沿用现有系统，没有第二条刷怪通道。

机器人在同一个决策 tick 返回事件选择与常规决策。选择通过校验后，在独立存档副本上预演该指令，随后以预演后的资源、工人、研究和修正生成常规指令；返回顺序为选择在前、常规指令在后，不修改传入游戏，也不漏掉侦察、科研或工程决策。预演复用公开 serializeGame/restoreGame/applyCommand，不另写效果估算或资源补偿。

目标行动使用 `Memory.incidentAttempts` 和 `incidentMission {targetId,unitIds,returning}`，同一目标最多派遣一次；小队全灭后不补派。普通目标最多派最快的 3 名守军，至少留下 3 名；分裂目标可用留下 3 名后的守军，复用 `army.ts:raidTargets` 与 `raidPowerOf` 的战力判断，倍率 1.5，不攻击母巢。只在白天出发，剩余白天须足够往返并留 8 秒；返程阈值为距入夜不超过 max(8 秒, 当前最慢返程耗时 + 4 秒)。返程使用强制移动，保留 incident 角色直至回到核心 6 格内，防止其他守军指令覆盖；同一目标不再出发。机器人记忆不属于模拟层存档。

统计入口：`node --import tsx src/headless/incidentCheck.ts --start=1 --count=30 --out=/tmp/incidents.json`；`--balance` 改跑四种机器人在 balance-6 的完整对局。报告逐局事件数、各事件 0/1/2 次分布、救援/分裂接受数及各类特殊遗迹探索数。目标完成率分母为已接受目标，另列到终局仍活动的数量；自动比例分母为已结算事件。一次性统计只放报告及 /tmp，不写入仓库。

计分中，路障是当前唯一的消耗型建筑，其死亡不增加 `stats.buildingsLost/buildingsLostTonight`，因此不扣损失建筑分，也不打断无建筑损失夜数。核心继续沿用原有豁免；其余生产、住宅、训练、防御塔和信号塔均为应保护的设施，仍计入建筑损失。拆除规则、死亡事件及战斗本身不变。

文案口径：协调者已将难民效果意图改为即时食物取舍，与当前 40 食物支付一致，不新增幸存者日耗。北方信号“第二个选项改为得到 30 科研”按效果替换处理，原选项标题及反馈保留，生成小字显示 30 科研。

### 自动存档

- `serializeGame(game: Pick<Game, 'state'>): string` 返回 JSON 字符串；`restoreGame(text: string): Game | null` 恢复整局。调用者负责 localStorage/IndexedDB、存储键和写入时机。
- 格式是 `{version: SAVE_VERSION, hash, state}`，当前 `SAVE_VERSION = 11`（母巢生命及成长规则不兼容旧局；拒绝所有旧版存档）。状态里的 `entities` 按创建顺序编码为条目数组，`terrain/fog` 编码为数值数组；JSON 无法保留的负零使用保留标记 `{$number:'-0'}`。所有其他状态字段直接保留，不筛选动态 payload。
- 版本不匹配、JSON 损坏、数组非法或状态哈希不匹配时返回 null，不迁移、不部分恢复。状态结构或规则发生不兼容变更时提升格式版本。
- 恢复不调用 `createGame`、不消耗 RNG、不重新揭开迷雾；重建完整日历缓存、导航/流场、空间索引、修正汇总，事件输出队列为空。恢复后的状态哈希必须完全一致，随后同指令继续推进的哈希和输出事件也必须一致。
- 本任务仅提供模拟层存档；“继续游戏”、自动保存时机、最佳成绩新存储键以及事件卡暂停由客户端任务完成。

## 每 tick 的系统顺序

`stepGame(game)` 依次运行 `PIPELINE` 里的系统，然后 `state.tick++`。游戏结束（`outcome.status !== 'playing'`）后 `stepGame` 不再推进。

1. `clock`（任务 1）：`state.clock = clockAt(tick)`，每个阶段第一个 tick 发 `phaseChanged`。系统用 `state.clock.phaseTick === 0` 判断“刚进入某阶段”。
2. `calendar`（第二版任务 2）：公布今晚及未来 3 晚，设置风暴次日的视野期限；`incidents` 处理自动结算、隔离/减员/效果到期与当天抽取；然后 `modifiers`（任务 1）：重算 `game.modifiers`。
3. `nav`（任务 1）：建筑占用变了就重建导航网格和流场。
4. `spatial`（任务 1）：重建空间索引。
5. `night`、`nests`、`mutantAi`、`soldiers`（任务 3）：黄昏预报、夜里刷怪、天亮撤退、巢穴；怪物和士兵决定目标、设置移动意图。
6. `workers`（任务 2）：幸存者走去工作或维修、进出建筑；然后 `weather`（第二版任务 2）执行风暴腐蚀和户外暴露伤害。
7. `movement`、`spatialAfterMove`、`fog`（任务 1）：移动、重建空间索引、更新迷雾。
8. `exploration`（任务 2）：遗迹奖励，随后输出下一段残页。
9. `combat`（任务 3）：攻击、伤害、击杀、老兵、机枪塔。
10. `construction`、`production`、`population`、`tech`（任务 2）：建造和训练进度、产出、人口和口粮、科研和灵感。
11. `signal` 结算工程，`incidentTargets` 结算目标完成/超时并刷新动态选项小字；`outcome`（任务 3）判定胜负和计分。
12. `cleanup`（任务 1）：移除 hp ≤ 0 的实体并发 `died` 事件；据点核心不移除。

时间单位：1 tick = 1/20 秒。白天 60 秒（最后 15 秒是黄昏），夜晚 50 秒，一个昼夜 2200 tick；第 20 夜结束是第 21 天的第一个 tick（`GAME_END_TICK = 44000`），1 倍速约 36.7 分钟；处理该 tick 后 `state.tick = 44001`。数据表里时长写秒、速度写格/秒，用 `secondsToTicks`、`perSecondToPerTick` 换算。

## 状态模型

`Game = { state, calendarPlan, nav, spatial, modifiers, events }`。只有 `state` 是权威状态，参与哈希，可以 `structuredClone`；其余是派生缓存或输出。

`GameState` 的字段：

- `options`：种子（任意字符串，每日种子用日期）、营地特性 `origin`、难度 `difficulty`。
- `tick`（已完成的 tick 数）、`clock`（`day`、`phase` 为 `day | dusk | night`、`phaseTick`、`phaseTicks`）。
- `rng`：六个独立随机流 `night`、`combat`、`ai`（任务 3）和 `economy`（任务 2），以及 `calendar`（第二版任务 2）和 `incidents`（第二版任务 3），都由种子派生。地图生成用自己的私有流，所以地图只取决于种子。
- `nextId`、`navVersion`（建筑占用每变一次加一）。
- `map`：宽高、`terrain`（`Uint8Array`，值是 `TERRAIN_LIST` 的下标）、`coreTile`、`ruins`（种类、位置、生成时定好的奖励、是否已探索）、`spawnPoints`（八个方向各一个可达的地图边缘格）、`relaySite`（中继站保留占地）。地形生成后不再改变。
- `fog`：每格 0 未探索、1 探索过、2 当前可见（`FOG_*` 常量）。
- `entities`：`Map<id, Entity>`，按创建顺序（即 id 顺序）迭代。id 从 1 递增、不复用，0 表示“无”。实体被移除后别处的 id 引用会悬空，读的时候总要重新查。
- `coreId`、`economy`（任务 2，见 `economy/model.ts`）、`night`（任务 3，见 `combat/model.ts`）、`stats`、`outcome`（任务 3）。

实体（`state.ts`）都有 `id、kind、faction、x、y、radius、hp、maxHp、armor、vision、lastDamagedTick`：

- `survivor`：`motion`、`task`（`idle | work | repair`，任务 2）、`insideId`（在哪座建筑里工作，0 表示在地图上；在建筑里的幸存者不移动、不提供视野、不会被打）。
- `soldier`：`type`、`motion`、`order`（`idle | move | attackMove | attackTarget | hold`，任务 1 由指令设置，任务 3 执行战斗部分）、`attack`（目标和冷却）、`veterancy`（击杀数、已选强化、是否待选）。
- `mutant`：`type`、`motion`、`attack`、`ai`（`guard | assault | retreat`、所属巢穴、是否首领、伤害加成）。
- `building`：`type`、占地 `tileX/tileY/size`、`construction`（`{progress,total}` 以 tick 计，完工后为 null）、`workers`、`trainQueue`、`rally`、`attack`（机枪塔用）。
- `nest`：`isHive`、占地、`discovered`（玩家见过一次就为 true，客户端在“探索过”的迷雾下也画出来）、`growth`（等级和撤退累积的成长点）。

`Motion` 是移动意图，由移动系统执行：`mode` 为 `stand | path | flow`；`path` 是平滑后的路点（格子下标），最后走到精确的 `goal`；`flow` 沿共享流场走向核心。`speed`（格/秒）、`mass`（分离时越重越不容易被推开）。`blockedBy` 是挡住下一步的建筑 id，任务 3 让被围住的怪物攻击它。

`stats` 是多个系统写、灵感和计分读的计数器，每个字段注释里写了由哪个任务维护。

派生数据：`game.nav`（`blocked`、`structureAt`、`region`（可通行格的连通区域编号，两格编号相同当且仅当 A* 能在两格之间找到路）、`flowCost`、`flowNext`，读之前调 `ensureNav(game)`）、`game.spatial`、`game.modifiers`、`game.events`。

坐标：格子 (tx, ty) 覆盖 [tx, tx+1) × [ty, ty+1)，实体坐标是浮点格坐标，格子中心是 (tx+0.5, ty+0.5)，下标 = ty × width + tx。射程和接触都按边缘距离算：单位是中心距离减半径，建筑是到占地矩形的距离（`edgeDistance`）。

## 指令

所有改变游戏的操作都是指令，`applyCommand(game, cmd)` 立即生效并返回 `{ok:true}` 或 `{ok:false, reason}`；暂停时也可以下指令。每个处理器分 `validate`（纯检查）和 `execute`；客户端用 `validateCommand` 判断按钮能不能点、放置预览是否合法，不需要自己写规则。拒绝原因的中文提示在 `REJECT_REASON_TEXT`，新增原因时同时加提示（`commands.ts` 是共享文件，报告给主会话）。

| 指令 | 参数 | 处理器 |
|---|---|---|
| `attackMove` | `unitIds, x, y` | 任务 1（`world/orders.ts`）：士兵设攻击移动，选中的幸存者普通移动；多单位分散到各自的目标点 |
| `move` | `unitIds, x, y` | 任务 1：强制移动；目标格被挡（比如右键自己的建筑）时走到最近的可达格 |
| `attackTarget` | `unitIds, targetId` | 任务 1：目标必须是怪物（当前可见）或巢穴（已发现）；只对士兵生效 |
| `stop` / `hold` | `unitIds` | 任务 1 |
| `setRally` | `buildingId, x, y` | 任务 1：只对能训练士兵的建筑 |
| `assignWork` / `unassignWork` / `repair` | | 任务 2（`economy/workers.ts`） |
| `placeBuilding` / `cancelConstruction` / `demolish` / `train` / `cancelTraining` | | 任务 2（`economy/construction.ts`）；放置的几何检查调 `world/placement.ts` 的 `checkPlacement` |
| `setResearch` | `tech \| null` | 任务 2（`economy/tech.ts`） |
| `setPolicy` | `slot, policy \| null` | 任务 2（`economy/policies.ts`），夜里拒绝 |
| `choosePromotion` | `unitId, promotion` | 任务 3（`combat/attacks.ts`） |

第一版处理器和第二版信号塔指令已实现。`resolveIncident` 由事件处理器校验并结算。

不是指令、由客户端自己处理的：选择和框选、编队、相机、暂停和变速（模拟没有墙钟，暂停就是不调 `stepGame`）、跳到最近的警报。选中的单位混有士兵和幸存者时，客户端按种类拆成多条指令（例如右键建筑：幸存者 `assignWork`，士兵 `move`）。

## 事件

`events.ts` 里的 `GameEvent` 是给客户端和机器人的输出，每种事件注释了由哪个任务发出。事件不进哈希，任何系统都不能读事件做决策（规则需要的信息放在状态或 `stats` 里）。客户端每帧调 `drainEvents`；无头运行器每 tick 取一次。

## 效果和派生属性

科技、政令、营地特性的数据里带 `Effect` 列表，`computeModifiers` 是唯一把它们加总的地方，结果在 `game.modifiers`：`global[stat]`、`unit[soldierType][stat]`、`building[buildingType][stat]`，以及解锁集合。约定：`...Pct` 是相加的比例（+0.2 表示 +20%，用法 `base * (1 + pct)`），`...Add` 和 `policySlots` 是直接加的数。解锁不是效果：建筑、兵种、政令的定义里有 `tech` 字段，研究了这项科技就解锁。

实体上的 `maxHp`、`vision`、`motion.speed` 由工厂按数据表的基础值设置，之后由各自的任务保持更新：任务 2 负责建筑（建筑生命加成、视野），任务 3 负责士兵和怪物（科技里的兵种加成、老兵强化、饥饿、难度）。全局视野加成 `global.visionAdd` 由迷雾系统统一加，实体的 `vision` 里不要再加一次。

## 数据表

数值都在模拟层的数据表里，按归属分两份文件，便于任务 2、3 并行调整：

- `data/economy.ts`（任务 2）：资源、开局资源和幸存者数、幸存者属性、增长、口粮、维修、建造、训练、13 种建筑、遗迹奖励表、15 项科技（三条线各 5 项，含灵感条件）、11 张政令、3 个营地特性。
- `data/combat.ts`（任务 3）：伤害类型 × 护甲类型倍率表、7 个兵种（含训练建筑、科技、老兵击杀数和两个强化选项）、14 个强化、饥饿惩罚、机枪塔武器、6 种怪物、巢穴和母巢、20 夜的预算和组成（首领仅在日历大潮夜出现）、预报阈值、警报间隔、3 档难度、计分。
- `data/map.ts`（任务 1）：地形定义和地图生成参数。

`data/data.test.ts` 检查数据的完整性（引用存在、科技无环、每种怪物有克制兵种等）。改数值不需要改这个测试；改结构时同步更新。

## 地图、寻路和移动

- 地图生成（`map/mapgen.ts`）：96×72，核心在中心附近，周围 6 格内没有不可通行地形；湖、岩石块、断墙；修复连通性（小的封闭区域填成岩石，大的挖一条通道）；沃土、残骸、油渍按设计总量放置，并保证核心附近各有一定数量；12–16 个普通遗迹及额外 3 个特殊遗迹；母巢放在按四邻接步行距离最远的合法位置（并列按行、列确定），6–9 个普通巢穴离核心至少 22 格；3×3 中继站占地离核心 20–28 格，保留通行环，初始在迷雾中；八个方向各一个边缘出生点。每个建筑占地外围一圈都可通行，所以放下它不会切断地图。测试对 100 个种子检查：所有可通行格都能从核心走到、巢穴可达、资源数量在范围内。
- 导航网格（`nav/navGrid.ts`）：地形和所有建筑、巢穴占地都挡路。增删建筑必须通过 `world/entities.ts` 的 `addBuilding`/`addNest`/`removeEntity`，它们会更新 `navVersion`。
- 单位寻路：`moveUnitTo(game, unit, x, y)`（A*，8 方向，不切角，路径平滑；目标不可达时走到最近的可达格）、`stopUnit`、`followFlowField`。路线上新放了建筑会自动重算。
- 流场：从核心占地出发的 Dijkstra。玩家建筑格可以通过但每格加 5000 的代价，所以只要还有通路怪物就会绕路，被完全围死时会选穿过最少建筑的路线，这时 `motion.blockedBy` 指向挡路的建筑（被围时是路障，走到核心旁时是核心）。巢穴格不可通过。
- 移动系统每 tick：算期望速度 → 所有单位之间按质量分离（敌我也互相挡，盾卫可以堵住疾行者；`hold` 的士兵质量乘 10）→ 按轴滑动地避开挡路格。
- 拐角和卡住：单位离路点 0.3 格（曼哈顿距离）以内时，只有碰撞体从当前位置到再下一个点的直线不碰挡路格（`lineClear`）才跳到下一个路点，否则继续走向这个路点（到 0.02 格以内一律算走过），所以在 1 格宽的通道口不会切角卡在建筑角上。一个 tick 里离当前目标点（路点、终点或流场的下一格）近了不到一步的 20% 就记为卡住一次（`stuckTicks`，路径和流场模式都算，前进一次清零）；路径模式连续卡住 60 tick 重算路径，超过 200 tick 停下。两个都在移动、都已卡住至少 3 tick 的单位重叠时不按质量分推力，id 小的保持路线、id 大的承担全部推力，否则两者把对方推离通道中线的力和自己走回中线的力正好抵消，会一直卡住。
- 空间索引（`world/spatial.ts`）：`forEachInRadius`、`findNearest`（距离相同取 id 小的）、`edgeDistance`。不收录 hp ≤ 0 的实体和在建筑里的幸存者。`forEachInRadius` 的最后一个参数 `maxExtent` 是查询要覆盖的最大实体半径，默认是包括建筑在内的最大值；只关心单位的查询（移动系统的分离）传 `MAX_UNIT_RADIUS`，少扫一圈格子，结果不变。
- 迷雾（`world/fog.ts`）：玩家实体按 `vision + global.visionAdd` 点亮圆形区域；首次探索按地形计入 `stats.exploredTerrain`（“发现油渍”灵感用它）；巢穴第一次被看见时 `discovered = true` 并发 `nestDiscovered`。`revealCircle` 给遗迹“揭开一片地图”的奖励用。
- 实体工厂（`world/entities.ts`）不做任何规则检查（不扣资源、不查解锁）。`enterBuilding`/`exitBuilding` 维护 `insideId` 和 `workers`；移除建筑时里面的工人被放到旁边的空格并变为空闲。工位上限等规则由任务 2 在调用前检查。

## 确定性规则

同一个种子加同一串指令（按 tick 和顺序）得到完全相同的状态哈希，`determinism.test.ts` 验证。模拟层必须遵守：

1. 随机数只用 `state.rng` 的流（`nextFloat(state.rng.combat)` 等），不同用途用不同的流。日历派生缓存从权威状态保存的生成前随机流快照副本重建，不能消费活跃随机流，也不能引用墙钟或新的随机来源。
2. 不读墙钟（`Date`、`performance`），不用定时器，不访问 `window`/`document`/`process` 等宿主对象，不 import `src/sim` 以外的模块。
3. 不用精度依赖引擎实现的数学函数：`Math.sin/cos/tan/atan2/exp/log/pow/hypot/cbrt` 等和 `**` 运算符。只用加减乘除和 `Math.sqrt`（IEEE 规定正确舍入）以及取整类函数。锥形判定用点积和余弦阈值（`coneCos`）。
4. 迭代顺序要确定：`entities` 按 id 顺序；排序要给完整的比较键（距离相同再比 id）。
5. 事件只是输出，规则不能读事件。
6. 派生数据只能由状态算出来，不能携带状态里没有的信息。

`purity.test.ts` 扫描 `src/sim` 的非测试源码检查第 1–3 条，`tsconfig.sim.json` 让 DOM 和 Node 的全局对象在模拟层里直接编译失败。

## 测试工具和无头运行

- `createTestGame(rows, opts)`（`sim/testing.ts`）：用字符画建一局。图例：`.` 荒地、`f` 沃土、`w` 残骸、`o` 油渍、`~` 水源、`#` 岩石、`=` 断墙、`r` 遗迹（奖励 50 废料）、`C` 3×3 核心（必需）、`N` 2×2 巢穴、`H` 3×3 母巢。默认整张图标为“探索过”、不放幸存者（`survivors` 可指定）、营地特性默认 `scavengers`（它的废料 +25% 会进 `modifiers`，算产出时注意）；不施加营地开局奖励。配合 `world/entities.ts` 的工厂函数和 `stepGame` 写测试。
- `runHeadless({seed, origin, difficulty, days, controller})`（`src/headless/run.ts`）：跑完指定数量的昼夜或直到结束，请求至少 `TOTAL_NIGHTS` 天时包括最终天亮的判定 tick，返回包含单位、建筑、资源、巢穴、统计、胜负原因、事件计数、指令拒绝原因计数和哈希的摘要。`controller(game, eventsOfLastTick)` 每 tick 调一次，返回要下的指令，机器人就写成 controller。

## 第二版机器人与平衡验收（任务 6）

`createController` 和 `BOT_NAMES` 注册 `doNothing/economy/raider/fortress/signal`；`STRATEGY_BOTS` 为四套主动策略。`pnpm sim --bot signal`、`pnpm trace --bot signal`、`pnpm balance --bots signal` 使用同一控制器。脚本通过 `node --import tsx` 启动，不依赖 tsx CLI 的 IPC 服务。

机器人仍只读公开状态：当前威胁沿用 `estimateThreat`，训练准备额外考虑已公布的一、两晚后的进攻预算（分别乘 0.75、0.5）。遗迹搜索半径从 16 提到 30，保留邻近已知巢穴的避让。救援必须能留下三名守军、另派三名健康战士；分裂巢穴沿用共享战力门槛。劫掠者仅在废料不少于 500 时考虑支付，过热仅在燃料不少于 50 时考虑支付；八名以上士兵优先威慑。工事策略优先塔类事件奖励、风暴准备和快速维修，维修先保核心、再非路障建筑，最后路障。

经济策略从第六天扩军，第八天起清理普通巢穴，出击时保留十二名守军保护生产区，以较少的远征兵力承担巢穴持续成长的后期风险。清巢策略清理普通巢穴时留三人驻防，母巢远征则保留八人并优先让新兵补足阵亡驻军；`RaidPlan.hive.homeGuard` 单独规定持续攻城的驻防人数。最低工人数固定为人口的 35%（至少四人），不按日期提高军队下限；从第八天起，根据已发现母巢的等级和剩余生命估算进攻战力。`hiveAssaultPower` 取守卫估值的 40% 与剩余生命除以两个半昼夜预期结构输出的较大值；`raidTargets` 分别接收 `combat/structure` 两种战力：守卫条件按剩余血量折算生存战力，拆除母巢的时间按存活士兵的完整武器输出估算，受伤本身不降低攻击伤害。完成远征背包后，训练目标至少为完整守卫估值与上述攻城估值较大者的 1.4 倍。母巢决战可以跨夜持续；驻军优先获得补兵，前线不因受伤战力低于出发时的 45% 而回营（游戏没有回营治疗），直到母巢被毁或突击部队全部阵亡才结束。普通巢穴仍按返程时间和 45% 战力撤退条件控制。信号策略侦察并到访中继站、研究破译与供能、派三工修塔、预先安排燃料供应；修塔及为修塔预留资源均从第八天起；开播须在白天、今夜及未来两晚均非大潮、塔血量至少 85%、总兵力至少六人且两名健康护卫已到场。护卫目标人数为三人与兵力的 30% 之间的较大值，初次派出时至少留下四人守家；塔被毁后召回护卫；尚未广播时若今夜或未来两晚有大潮则召回护卫，已广播时保留现有护卫但不再增派。研究列表必须逐项满足前置闭包，见 `bots/research.test.ts`；`signalStrategy()` 与正式信号控制器共用同一份计划，明确保留第 4 天扩军，不跟随经济策略的第 6 天参数。计划内科技与北方信号赠送的科技分别统计，不能将赠送项目计入计划标价。

第 2 夜边缘预算为 22、方向数为 1；新增 `NightDef.nestBudgetPct`（第 2 夜 0.25，其余 1）。`combat/nests.ts:nestNightThreat(nest, night, difficulty)` 为夜袭计划和机器人共享的巢穴预算函数，不影响白天守卫、巢穴生命、成长或奖励。预报不展示预算不足、没有任何单位的进攻组。`createGame` 在返回前用共享 `housingCapacity` 初始化住房上限，tick 0 即可显示正确数值。

`pnpm balance --seeds 20 --jobs 24` 默认跑 20 种子 × 三营地 × 五机器人 × 普通/困难，共 600 局。可用 `--progress /tmp/progress.jsonl` 逐局记录进度，最终仍写 `balance/latest.json`。JSON 顶层为 `seeds/prefix/bots/origins/difficulties/checks/results`；逐局新增 `firstSurgeNight/nightsStarted/edgeAttackNights/researched/researchCostShare/specialRuinsExplored/scoreParts`。边缘夜袭按实际新生成的无归属巢穴进攻怪物统计，分母为已开始的夜晚（包含结束对局的部分夜晚），不使用整局预排的 20 夜掩盖提前结束。科研成本占比使用已完成科技标价之和除以全树 4020。策略差异保留原脚本的严格检查：每套策略至少在两个同种子、同营地组合中失败而另一策略获胜；另外比较最终分数，每套策略至少在一个地图组合中被其他策略超过。`balanceAcceptance.ts` 集中计算全部第二版验收指标。

`node --import tsx src/headless/earlyRaidCheck.ts --seeds=20 --out=/tmp/early-raids.json` 只测开局兵力在第 1/2 天攻击最近普通巢穴：不额外造兵、不发经济指令，按已知目标坐标直接进攻，限当天 60 秒，统计成功、耗时、死亡及损血。只有民兵有两名开局步枪手，其他营地记为无兵力、不尝试；不以额外生成士兵替代。该测量不包含寻找巢穴的侦察时间。

## 留给后续任务决定的事

- 第二版任务 2（已实现）：机器人仅用公开日历和预报估计威胁；平静夜保留已知巢穴威胁，风暴夜威胁为零，浓雾不给虚构方向。平静/风暴夜允许延长清巢行动，固定驻防兵仍守家。风暴黄昏和夜间停止招募抽调、维修和遗迹外出，优先把户外工人安排进有空工位的建筑；工位不足的完整应对留给任务 6。`node --import tsx src/headless/calendarStats.ts` 用 100 个种子×三档难度采样各夜黄昏的真实计划，统计夜晚类型和边缘夜袭比例（不是胜率模拟）。
- 任务 2（第一版已定）：建造不需要幸存者，工地自己推进；对工地下维修指令的幸存者每人加 50% 速度，最多 3 人。训练在入队时就带走最近的一名空闲幸存者（没有空闲的就拒绝，不会抽调在岗工人），取消订单或拆掉建筑时退还幸存者和费用。口粮每天在黄昏第一个 tick 结算一次，食物不够时吃光剩余食物、`upkeep.hungry = true`，持续到下一次结算，也就是覆盖当晚。工地生命从 10% 开始随进度增长，施工期间受的伤保留。零血工地不再推进施工或训练，随后由 cleanup 移除，不能靠同 tick 施工回血复活。
- 任务 3（已定）：攻击即时命中，状态里没有弹体；客户端用 `shot` 事件（起点、终点）画弹道，用 `explosion` 事件画范围伤害。空闲士兵的察觉半径取"视野"和"射程 + 2.5"中较小的一个，但不小于射程，只追离站位 5 格以内的敌人，打完回到站位（`AttackState.post`，按停止键后原地成为新站位）。任务 6 补充：正在攻击据点（核心、任何建筑、幸存者）的怪物，只要玩家看得见、在射程内或离站位不超过“5 格 + 射程”，空闲士兵就会去打，不受察觉半径限制，所以核心在士兵够得着的地方挨打时士兵不会站着不动；其他士兵之间的交火不会把它们拉走。巢穴守卫在每天开始时补满到"基础数 + 每级数量 × 等级"，白天被打死的要到下一个天亮才补。`underAttack` 只在实体 4 秒没受伤后再次被打时发出，持续挨打只提示一次。
- 任务 4：客户端按每帧时间累积调用 `stepGame`（1/2/3 倍速对应每秒 20/40/60 tick），用两个 tick 之间的插值画位置；暂停时继续接受指令。

## 客户端读的规则函数（任务 6）

客户端显示的数值（射程圈、老兵进度、每分钟产出、建筑产出、住房、放置加成、视野）都调模拟层的函数算，不在客户端重写规则。这些函数从 `sim/index.ts` 导出，参数只要求用到的字段（`Pick<...>`），所以 `GameView` 里的只读实体可以直接传进去：

- 战斗：`soldierWeapon`、`mutantWeapon`、`towerWeapon`（工地返回 null）、`towerWeaponOfType`（放置预览用）、`veteranThreshold`（`max(1, round(击杀数 × (1 + 加成)))`）、`compassDirection`。
- 经济：`buildingYieldPerDay`（一座建筑按当前工人、地形和加成每天的产出）、`perDayToPerMinute`、`RATE_PERIOD_SECONDS`（产出按一个完整昼夜计）、`bonusTerrainTiles`（放置预览里高亮的加成格）、`placementBonusPct`、`terrainBonusPct`、`buildingHousing`、`populationCount`。
- 视野：`visionRadius`（实体视野加全局视野加成）。

## 客户端结构补充（任务 6）

- 新手引导：`hud/guide.ts` 根据状态算开局的任务清单，共 9 步，覆盖第 1–3 天（生产建筑、派工、兵营、训练、看雾情日历、看预报、守住第 1 夜、处理白天事件、找到中继站）。只有“看日历”模拟层不记录，由 `GameScreen` 在玩家悬停日历时记下（`calendarSeen`）。第 3 天过后或全部完成后消失，玩家也可以手动关闭（`Session.dismissGuide`）；`ui/GuidePanel.tsx` 显示它。`ui/HelpOverlay.tsx` 是说明页（目标、昼夜、资源、人口、防守、按键），由顶栏的“帮助”按钮、F1 或 ? 打开，打开时暂停（`Session.helpOpen`）。科技树和政令面板打开时同样停住时间（`Session.techOpen`、`policiesOpen`），关闭后保持玩家原来的暂停状态。
- 威胁标记：`hud/threatMarkers.ts` 在黄昏给出预报的出生点，在夜里把正在进攻的怪物按核心周围的方位分组（`compassDirection`），渲染器在屏幕边缘画指向它们的箭头和“方向 · 数量”标签（落点见“边缘箭头”）；目标在屏幕内时改成在原地画一个闪烁的圆圈，夜里的怪物只在藏在迷雾里时才画。
- 地形提示：`hud/terrainHint.ts` 给鼠标下的格子一行“地形名：适合做什么”，显示在左下角。
- 框选：框里有士兵时只选士兵（`input/selection.ts`）。
- debug 钩子（`client/debugHook.ts`，只在 URL 带 `?debug` 时安装）：只读的 `summary`、`entities`、`toScreen`、`hash`、`onScreen`、`profile`、`findPlacement`/`bestPlacement`，以及 `loaded`（这个画面拿到的那一局在第一帧之前的天数、tick 和哈希，e2e 用它核对“继续游戏”读回的是不是刷新前那一局）；`advance(ticks)` 走和帧循环相同的步进路径快进，不受暂停和卡片影响；`autopilot(bot)` 让 `src/headless/bots` 的机器人通过 `Session` 的正常指令路径操作真实客户端（`Session.autopilot` 在每个 tick 前调用；有机器人时事件卡不弹出，由机器人自己下 `resolveIncident`）；`stress(opts)` 调 `sim/scenarios.ts` 摆压测场景；`rasterizeSections(on)` 打开或关闭渲染器分段计时里的强制光栅化（见“渲染性能”）；`finishResearch(tech)` 只给截图场景用，把这项科技和它缺的前置都填满研究点，由模拟层在接下来几个 tick 完成。机器人和场景通过动态 import 加载，构建时是单独的小文件，正常游戏不会下载。

## 美术改版（界面部分）

美术规范在 `docs/art-direction.md`，画布调色板 `render/palette.ts` 和 `styles.css` 开头的 CSS 变量使用同一组色值。界面的几条行为约定：选中面板只在有东西被选中时出现；顶栏的“工人”格可以点击，等同按 G 选中空闲幸存者；事件日志收起时只显示最近 4 条，按游戏时间显示 15 秒后用 5 秒淡出（暂停时不消失），点“事件”展开最近 12 条（`hud/eventLog.ts`）；开局指引在建造栏上方，可以折叠到只剩下一步，也可以关闭（`hud/guide.ts`、`ui/GuidePanel.tsx`）。帮助页的地形色块读 `render/palette.ts` 的键，开始界面的背景调用渲染层的 `renderTerrain` 和 `drawBuilding`，改这些名字或签名时要同步改界面。

## 第二版客户端实现（任务 5）

客户端只通过 `src/sim/index.ts` 读状态、下指令。下面每一项都写明了数据和可用性从哪里来，界面不另写规则。

- **雾情日历**（`hud/calendar.ts`、`ui/CalendarStrip.tsx`）：在顶栏右侧的时间区，显示今晚和之后 `CALENDAR.previewNights`（3）晚。每格两行，上面是“今晚”或“第 N 夜”，下面是类型名，按夜晚类型着色。类型用 `nightType(view, night)` 读 `calendar.nights[night - 1]`。悬停卡的标题是“雾情日历”，每晚一行“今晚（第 N 夜）· 类型名”或“第 N 夜 · 类型名”，下面是 `NIGHT_TYPE_DESCRIPTIONS` 里的一句话说明（与 narrative.md 一致），不给防守或兵种建议。锈风暴过后的白天，悬停卡另起一行写视野降低了多少，数值用 `weatherVisionMultiplier` 算，研究“雾气过滤”后为 0，这一行不显示。胜利目标卡打开时悬停卡不出现，两者挂在同一位置，不会重叠。
- **胜利目标**（`hud/objectives.ts`、`ui/ObjectivesPanel.tsx`）：顶栏中间是“目标 (O)”按钮，按钮本身不显示进度。按钮或 O 键打开一张卡，坚守、清巢、求援三条路线各一行状态：现在是第几天；母巢还没找到，或母巢生命百分比；信号塔按阶段写“找到 K-7 中继站并研究旧频段破译”、修建进度和在岗工人（`onsiteWorkerCount` / `workerSlots`）、“随时可以开始广播”或已守住几晚。事件目标点不在卡里列出，只标在地图上。
- **白天事件卡**（`hud/incidents.ts`、`ui/IncidentModal.tsx`、`session.ts`）：`state.incidents.pending` 出现新事件时卡片自动打开；有 autopilot（debug 钩子接入的机器人）时不打开，由机器人自己处理。`Session.incidentModalOpen` 是只读属性，表示待处理事件存在并且正是卡片对应的那个。卡片打开时时间停住，但不改玩家自己的 `paused`，关闭后按玩家原来的暂停状态继续。卡片打开时键盘只认 1–3（选选项）、Esc（“查看地图”，事件保持待处理）和 Tab，其他快捷键、编队数字键和镜头平移都不生效。这套拦截和开局介绍卡共用一处：`Session.modalCard` 给出当前在最前面的模态卡（`'intro'`、`'incident'` 或 null，介绍卡优先），`input/domInput.ts` 把它作为 `actionForKey` 的 `modal` 上下文传给 `input/keymap.ts`，由 `MODAL_CARD_KEYS` 查这张卡认哪些键；`modalCard` 不为空时 `pan` 直接返回，键盘和鼠标贴边都不移动镜头。选项能否点选和不可选的原因只来自 `validateCommand(game, {type:'resolveIncident', ...})` 和 `REJECT_REASON_TEXT`，选项下方的小字直接显示 `choices[].description`。卡片里没有倒计时（打开时时间是停的），黄昏时多一行“天黑前不处理，会按最后一个选项结算”。卡片里不用 emoji。
- **事件日志**（`hud/eventLog.ts`、`ui/EventLog.tsx`）：有待处理事件时，日志顶部常驻一条“待处理：{title}（点击或按 Tab 打开）”，点击重新打开卡片；黄昏时后面加“· 天黑还剩 {s} 秒”（按 `deadlineTick` 换算成游戏秒数），最后 10 秒闪烁。选项结算后显示模拟层给的反馈原文；接受目标点时写“{title}：目标点已经标在地图上，{N} 天内到达”，点击这一行镜头跳到目标点。黄昏无线电播报读 `night.broadcast`，作为一条日志插在黄昏那一行后面。目标点完成或过期、遗迹残页和信号塔台词（`signalMessage`）也各占一行。
- **目标点**（`render/objectiveMarkers.ts`、`render/overlays.ts`、`render/minimap.ts`）：`objectiveMarkers` 汇总地图上要指出的东西：`state.incidents.targets` 里 `status === 'active'` 的目标点，标签“{title} · 剩 m:ss”，按 `max(0, expiresTick - tick) / TICKS_PER_SECOND` 换算游戏时间；事件卡还没处理时 `pending.target` 的位置，标签“{title}（未决定）”；发现后的中继站（名字和阶段）；见过的母巢。`drawObjectiveMarkers` 在目标位于屏幕内时，给目标点画一个圆环（已接受为实线，未决定为虚线），给中继站和母巢只在占地上方画标签和指向它的小三角，不压住塔身；目标在屏幕外或被 HUD 面板挡住时，在屏幕边缘画箭头和标签（落点见“边缘箭头”），未决定的箭头是虚线轮廓。小地图用实心橙点标已接受的目标点，用虚线圈标未决定的。
- **特殊遗迹**（`render/terrainLayer.ts`、`hud/terrainHint.ts`）：遗迹按 `state.map.ruins[].kind` 画进每局只画一次的静态地形画布（`paintRuin`）：普通遗迹是地基和碎块，坠落的补给舱是坑里的轨道补给舱，旧时代仓库是混凝土框里的厚金属门。鼠标悬停时，左下角的地形提示显示 `SPECIAL_RUINS[kind].name` 和 `description`。
- **中继站和信号塔**：没建塔时，渲染器在中继站原址画废墟（`renderer.ts` 的 `drawRelayRuins`）。塔从建造栏放到中继站原址（`placeBuilding`，能不能放由模拟层判断）。选中幸存者右键塔的工地发出 `assignWork`（`input/rightClick.ts`；模拟层对信号塔不计助建，所以不发 `repair`）。阶段名统一用 `SIGNAL_STAGE_NAMES`（未破译 / 修建中 / 可以广播 / 广播中），地图上中继站的标签和选中塔时的面板都读它；广播中面板改为“广播中 · 已守住 n/m 晚”；“开始广播”按钮下 `startSignalBroadcast`，能否点击用 `validateCommand`。`render/drawBuildings.ts` 画塔身、闪烁的航标灯和施工时的焊接火花（塔有指派工人时），广播中由 `overlays.ts` 的 `drawBroadcastPulseRings` 画向外扩散的圆环。
- **锈风暴和浓雾夜**：锈风暴夜，`render/lighting.ts` 把夜里的冷蓝换成亮度相近的锈红，入夜时渐入、次日天亮时渐出，`stormLevel` 给出当前的风沙浓度。`render/stormEffects.ts` 预先按设备像素比画好几种沙尘条贴图，每帧在世界和光照画完之后、撤掉世界坐标变换，在屏幕坐标下把这些贴图复制几百次；数量随视图面积和风沙浓度变化，风速是固定的屏幕像素每秒，不随缩放改变；屏幕上的标记画在沙尘之上。浓雾夜，`render/fogLayer.ts` 把“探索过但现在看不见”的区域压得更暗（记忆层不透明度 0.75），`hud/threatMarkers.ts` 只统计玩家此刻看得见的进攻怪物，黄昏预报显示“方向不明”。
- **边缘箭头**（`camera.ts` 的 `edgeAnchor`、`render/overlays.ts` 的 `markerArea`、`ui/GameScreen.tsx` 的 `measureHudPanels`）：威胁标记和目标点共用同一套落点。目标在屏幕上的空闲区域里时，标记画在目标本身；否则从屏幕中心朝目标连一条线，箭头放在这条线离开屏幕边缘、或碰到第一个 HUD 面板的位置，标签放在箭头朝屏幕中心的一侧。箭头中心离屏幕边缘和每个面板都至少 `MARKER_CLEARANCE`（24px），箭头的图形最远伸出中心约 20px，所以箭头不会压到面板上。HUD 面板的位置不写死在渲染层：`GameScreen` 在每次 HUD 刷新提交后（至少每 200ms 一次，窗口缩放后也会很快跟上）用 `measureHudPanels` 量出顶栏、今夜来袭、事件日志、横幅和目标卡、底部的小地图列、选中面板和指引/建造栏的矩形，写进 `Renderer.hudPanels`；提示条（toast）几秒就消失，不算在内。之前用的是写死的安全区（顶部 100px、底部 250px、左右再内缩 150px 的椭圆）和事件日志矩形，没有选中东西时底部 HUD 只占两角，屏幕下方中间却也被让出 250px，结果正下方屏幕外的目标（例如炉心南边的中继站）的箭头落在炉心旁边的建筑上方，看起来像在指那座建筑；量出实际面板以后，同一个目标的箭头贴着屏幕底边。
- **渲染性能**（`render/effects.ts`、`render/drawEffects.ts`、`render/sectionTimer.ts`）：
  - 来自模拟事件的特效（弹道、爆炸、尸体、焦痕等）寿命按游戏时间算。`effectsForEvent(event, now, speed, shooter)` 把每种特效在 1 倍速下的寿命换成真实时间 `max(min(寿命, 120), 寿命 / 倍速)` 毫秒，`Session.consumeEvents` 传入当前倍速。3 倍速下事件来得快三倍，如果每个特效仍活一样久，屏幕上同时存在的特效就是 1 倍速的三倍；按游戏时间算以后数量和 1 倍速时相当。120 毫秒的下限保证加速后火焰和榴弹仍然看得见，本来就不到 120 毫秒的特效不再缩短。玩家点击下令的标记（`orderMarker`）是对操作的反馈，按真实时间算，不随倍速变短。
  - `effectLights` 每帧最多给 `MAX_EFFECT_LIGHTS`（16）个特效发光：先剔除光照范围碰不到屏幕的，再按强度乘半径取最大的 16 个。每个光源都要在光照层上画一次光晕，大战里同时有上百个枪口火光和爆炸，不设上限时这一步随特效数量线性变慢；被舍弃的是最弱的光，画面上几乎看不出差别。建筑、巢穴、遗迹的光不受这个上限限制，它们数量有限，也是夜里辨认据点的依据。
  - 分段计时在 `render/sectionTimer.ts`，记录渲染器每段上一帧花的毫秒数，通过 debug 钩子的 `profile().render` 读取。Canvas 2D 的绘制调用大多只是把命令记下来，真正的光栅化在 `draw()` 返回之后、最晚在这一帧上屏时才做，所以默认的分段时间不含像素工作量。`Renderer.rasterizeSections` 默认关闭，可以用 debug 钩子的 `rasterizeSections(true)` 打开（只在 `?debug` 时可用）：打开后每段读时钟前先读回 1 个像素（`getImageData`），逼画布把这一段画的东西光栅化完，于是每段时间包含它自己的像素工作量。读回会让绘制流水线停顿、掉帧，测帧率时要关掉。
  - 帧率背景：这台机器上 Playwright 的 Chromium 用软件光栅化画 2D canvas（WebGL 渲染器报告的是 SwiftShader），所以像素填充量直接决定帧率。美术 e2e `artPerf` 的默认缩放实时压力（缩放 44，300 只怪物加 80 个士兵，3 倍速）在本节这些修复之前是 47–49 fps，修复后 55.8–57.4 fps。
- **撤退**：选中士兵时面板里有“撤退回炉心 (K)”按钮，K 键效果相同。它对选中的士兵下一条移动到炉心中心的 `move` 指令（和 Ctrl+右键是同一种指令，途中不交战），由模拟层的编队落点把士兵摆在炉心周围；e2e 实测士兵停在离炉心中心约 2 格。
- **开局介绍卡**（`ui/IntroCard.tsx`）：新开的一局（第 1 天、tick 0）先显示世界观介绍卡，文字取自 narrative.md。卡片打开时时间停住，点“进入据点”或按空格、Enter、Esc 关闭（按钮调 `Session.closeIntroCard`，按键是 `closeIntroCard` 动作）。卡片是模态的：打开时其他快捷键和镜头平移都不生效，和事件卡用同一处拦截（`Session.modalCard`，见“白天事件卡”）。读档继续的局不显示。
- **顶栏和人口读数**（`ui/TopBar.tsx`、`hud/topBar.ts`）：顶栏在 1440×900 和 1280×800 下都是一行，高 40px，不溢出、不换行、按钮不出屏（`v2Flow` 检查）。窗口宽度不到 1440px 时，隐藏资源产出的“/分”单位、天数后的“/20”、口粮结余小块（饥饿提示照常显示）和速度区按钮上的按键提示。这个阈值原来是 1366px，但完整布局在 1366px 宽时已经溢出 10px；顶栏加了全屏按钮后，完整布局需要约 1411px，所以阈值提到 1440px，1440px 宽时完整布局还剩约 29px。幸存者读数是大字总数加小字“幸存者（空闲 n）”，人口读数是“人口/住房上限”，两者的悬停说明按模拟层规则写：训练士兵占用一名空闲幸存者；住房只限制自然增长，建棚屋提高上限。
- **镜头**（`camera.ts`、`input/domInput.ts`、`ui/FullscreenButton.tsx`）：默认缩放 44 像素/格，最大 `MAX_ZOOM` 80。最小缩放由 `minZoom` 按视口计算：整张地图放进视口，四边各留 `FIT_MARGIN_PX`（56px），这样顶栏（离顶 8px、高 40px）不会盖住地图最上面几行；96×72 的地图在 1440×900 下约 10.9，在 1920×1080 下约 13.4。底部的小地图列、指引和建造栏、左侧事件日志不计入留白：它们只占角落和侧边，算进去地图会缩得很小，而且这些面板随选中和指引展开而变化，最小缩放会跟着跳。窗口变大（例如进入全屏）时最小缩放随之提高，`resizeView` 会把缩放和镜头中心重新限制到范围内。镜头中心在每条轴上可以离开地图中点，最多偏离地图比视野长出的长度，并且不超过地图边缘：地图至少是视野两倍长时，中心可以到地图边缘，和以前一样能把地图边缘拉到屏幕中间、从 HUD 下面露出来；视野变大时可移动的范围连续收窄，整张地图放得下时地图停在视野正中。因为范围是连续变化的，滚轮缩小时地图平滑地移到中间，不会跳。中键拖动地图时，移动事件在 window 上处理，鼠标经过 HUD 面板或移出画布时拖动继续，松开中键或窗口失焦时结束。顶栏和暂停菜单有全屏按钮，对整个页面调用 Fullscreen API，按钮文字随 `fullscreenchange` 更新，用户按 Esc 或 F11 退出全屏时也会更新；浏览器不支持或不允许全屏时不显示按钮。全屏没有快捷键。
- **结算**（`hud/endScreen.ts`、`ui/EndScreen.tsx`）：标题和尾声按胜利方式区分，取自 narrative.md「结局」；副标题是“守到了第 21 天”“第 N 天摧毁了母巢”“第 N 天，长明城的车队到了”或“炉心在第 N 天熄灭”。获胜时显示模拟层 `outcome.score` 的分项和总分，失守没有分数。
- **自动存档**（`storage/autoSave.ts`、`session.ts`、`ui/GameScreen.tsx`、`ui/StartScreen.tsx`）：存在 localStorage 的 `scraphold.autosave.v2`，只存一局。每天天亮（从第 2 天起）和每个黄昏开始的那个 tick 处理完后各存一次，页面隐藏（`visibilitychange` 变为 hidden）或离开（`pagehide`，包括刷新）时再存一次；处理事件后不单独存。已结束的局不存，局结束的那个 tick 删除存档。主菜单显示“继续游戏（第 N 天 · 营地特性）”之前，先用 `restoreGame` 完整校验（格式版本、数据完整、状态哈希一致）；通不过或那一局已经结束，就删掉存档、不显示按钮。“删除存档”按钮清掉它。实测体积约 54 KB（第 1 天）到 125–195 KB（第 14–20 天）。
- **快捷键**：第二版新增 K（撤退回炉心）、O（胜利目标）、Tab（打开待处理事件，并阻止浏览器用 Tab 切换焦点）；Ctrl+右键是强制移动；事件卡打开时 1–3 选选项，不选编队；开局介绍卡打开时只有空格、Enter、Esc（关闭卡片）生效。第一版曾有的 J 键已删除。帮助页（`ui/HelpOverlay.tsx`）列出全部按键。
- **HUD 遮挡**：`v2Flow` 在 1440×900 下按各面板的矩形每 4px 采样一次：开局时（开局指引展开、没有选中）约 21.5%，其中开局指引单独约占 9%；选中炉心后约 26%。

## 第二版任务 6 返工的接口与验收口径

`sim/index.ts` 统一导出 `edgeNightBudget(night, difficulty, type)` 和 `nestNightThreat(nest, night, difficulty)`。前者只计算基础边缘预算，平静、风暴或未公布类型返回 0；事件加成仍在计划生成后统一调整。夜袭计划、当前威胁估计和提前备战共用它，机器人读公开类型均通过 `nightType(state, night)`。`StrategyName` 为四种策略名的联合类型，事件选择必须显式传入；信号统计脚本也通过 `createController('signal')` 创建控制器。

上一轮报告的 **23/23 PASS 指新 v2 检查集**，不是保留全部 v1 附加指标。删除的附加检查为：策略两两训练兵种构成距离至少 0.35；第 6–20 夜有损失的对局占多数；终局未用废料与食物低于累计获取量的 25%；三个营地的主动策略胜率跨度不超过 20 个百分点。这些不属于 v2 spec 的验收指标。原“第 3 夜前失败”改为“首次大潮前失败”，普通胜率门槛 60% 改为 spec 的 55%；保留每套策略至少两个同图败局而其他策略获胜的检查。上一轮另新增胜利路线、信号归属、实际夜袭比例及同图得分比较。

此前在这 23 项上新增 7 项检查：四策略困难胜率分别至少 20%、普通清巢母巢胜利中位日期至少 13、困难母巢中位日期不早于普通、普通三种胜利分数中位数最大/最小不超过 1.5。缺失母巢胜利或某条计分路线时检查失败，不以缺失样本视作通过。本轮新增普通母巢胜利中第 11 天及以前不超过 10%，合计 31 项检查。


研究计划按当前完整前置顺序计算，科技树标价总计 4020（灵感折扣前）；这些是计划标价，不是实际累计科研产出：

| 策略 | 计划项数 | 标价合计 | 占全树 |
|---|---:|---:|---:|
| 经济 | 14 | 1890 | 47.0% |
| 清巢 | 13 | 1940 | 48.3% |
| 工事 | 14 | 1700 | 42.3% |
| 信号 | 13 | 1770 | 44.0% |

北方信号可免费给出 `oldFrequency`（标价 220）。经济、清巢、工事的计划不包含它；信号计划包含，但免费取得时不再付费研究。上一轮经济列表删掉 `machineGuns` 后，可达部分只有 1560（38.8%），加上赠送科技才约 44%；本轮恢复此前置，`reinforcement/windReinforcement` 均可达。研究站每工人每秒 0.35 不变。`Context.researchPending` 表示正在研究或本次决策已选到可研究项；四套策略在其为 false 时撤回在岗和在途研究工人，下一次决策重新分配到生产或训练，研究权重归零且禁止新增研究站，风暴避难也不占用研究站。科研累计获取仍包含巢穴、遗迹和事件奖励，不能当作实际解锁科技的标价；报告分别统计累计获取与已完成科技成本。

工事将 `machineGuns/reinforcement/windReinforcement` 前移，再研究经济与后续工事科技，以提前获得塔、防御生命和风暴保护。本轮将炼油从研究列表第 11 项前移到第 6 项，以便及时启用燃料配给。


机器人训练会先为最低工人数保留空闲幸存者，避免损失工人后新生幸存者全部被征兵、生产无法恢复。工事布局将环墙间隔从 5 格缩到 3 格，生产建筑优先靠近核心，驻军交战半径 12 格覆盖生产区；军械厂从第八天起在 14 格内择近建造，避免核心预留区占满后阻塞整个建设队列。研究在经济基础后优先军械厂和爆破，补充狙击手和掷弹兵。核心八个固定塔位用完后继续搜索合法位置，塔数目标为 `min(12, 2 + floor(day/2))`；远程油井周围先补塔，油井总数限制为 2。燃料不足 20 时，机枪塔不折算为驻军战力；有燃料时每座塔折算 0.8，军队战力目标为 `max(6, preparationThreat × 0.25 − 有燃料塔数 × 0.8)`。困难边缘预算与怪物伤害倍率由 1.35/1.15 回调为 1.2/1.1，母巢的独立生命倍率为 1.2。

工事在已度过第一次大潮、已有至少两座机枪塔、公开日历显示今夜或未来两晚有大潮时，燃料目标由 `20 + 5 × 塔数` 提高到 `60 + 5 × 塔数`；不足时燃料工作权重为 0.25，在基本生产与兵营之后优先重建 16 格内缺失的油井，燃料配给优先于废料动员。暴露油井保持一座邻近机枪塔保护。难度倍率不因工事策略调整。
