import { describe, expect, it } from 'vitest';
import { DAMAGE_MULTIPLIER, DAMAGE_TYPES, DAMAGE_TYPE_NAMES, HIVE_SHIELD, PROMOTIONS, SOLDIERS } from '../../sim/data/combat';
import { BUILDINGS } from '../../sim/data/economy';
import { SIGNAL_STAGE_NAMES, applyCommand, buildingYieldPerDay, createGame, onsiteWorkerCount, perDayToPerMinute, veteranThreshold, type Game } from '../../sim';
import { addBuilding, enterBuilding, removeEntity, spawnSurvivor } from '../../sim/world/entities';
import { buildTestWorld, revealAll } from '../testWorld';
import { expectMirrors } from './expectMirrors';
import { selectionPanelModel } from './selectionPanel';

describe('selectionPanelModel: units', () => {
  it('is empty without a selection', () => {
    const w = buildTestWorld();
    expect(selectionPanelModel(w.game, [])).toEqual({ kind: 'none' });
  });

  it('describes a single soldier with its order and weapon', () => {
    const w = buildTestWorld();
    const m = selectionPanelModel(w.game, [w.rifle1.id]);
    const hp = SOLDIERS.rifleman.hp;
    expect(m).toMatchObject({ kind: 'soldier', unit: { id: w.rifle1.id, name: '步枪手', role: '远程', order: '待命', armorName: '无甲', hp, maxHp: hp } });
    expect(m.kind === 'soldier' && m.unit.weapon).toBe(`普通伤害 · 射程 ${SOLDIERS.rifleman.weapon.range}`);
    w.rifle1.order = { type: 'hold' };
    expect(selectionPanelModel(w.game, [w.rifle1.id])).toMatchObject({ unit: { order: '原地坚守' } });
  });

  it('shows the veterancy threshold the simulation promotes at', () => {
    const w = buildTestWorld();
    // 12 x (1 - 0.3) = 8.4 kills: the simulation rounds to 8.
    w.game.modifiers.global.veterancyKillsPct = -0.3;
    const m = selectionPanelModel(w.game, [w.guard.id]);
    expect(m.kind === 'soldier' && m.unit.veteranKills).toBe(veteranThreshold(w.game, w.guard));
    expect(veteranThreshold(w.game, w.guard)).toBe(8);
  });

  it('offers both promotions when one is pending, mirroring choosePromotion', () => {
    const w = buildTestWorld();
    w.rifle1.veterancy.pending = true;
    const m = selectionPanelModel(w.game, [w.rifle1.id]);
    if (m.kind !== 'soldier') throw new Error('expected soldier');
    const [first, second] = SOLDIERS.rifleman.promotions;
    expect(m.unit.promotions?.map((p) => p.name)).toEqual([PROMOTIONS[first].name, PROMOTIONS[second].name]);
    expectMirrors(m.unit.promotions?.[0]?.availability, w.game, { type: 'choosePromotion', unitId: w.rifle1.id, promotion: first });
  });

  it('groups a multi-selection by type', () => {
    const w = buildTestWorld();
    const m = selectionPanelModel(w.game, [w.survivor1.id, w.rifle1.id, w.guard.id, w.rifle2.id]);
    expect(m.kind).toBe('group');
    if (m.kind !== 'group') return;
    expect(m.total).toBe(4);
    expect(m.entries.map((e) => [e.name, e.count, e.ids])).toEqual([
      ['盾卫', 1, [w.guard.id]],
      ['步枪手', 2, [w.rifle1.id, w.rifle2.id]],
      ['幸存者', 1, [w.survivor1.id]],
    ]);
    expect(m).toMatchObject({ soldiers: 3, survivors: 1 });
    expect(selectionPanelModel(w.game, [w.survivor1.id, w.survivor2.id])).toMatchObject({ kind: 'group', soldiers: 0, survivors: 2 });
  });

  it('describes what a survivor is doing', () => {
    const w = buildTestWorld();
    expect(selectionPanelModel(w.game, [w.survivor1.id])).toMatchObject({ kind: 'survivor', unit: { task: '空闲' } });
    w.survivor1.task = { type: 'work', buildingId: w.greenhouse.id };
    expect(selectionPanelModel(w.game, [w.survivor1.id])).toMatchObject({ unit: { task: '前往温室工作' } });
    w.survivor1.task = { type: 'repair', buildingId: w.damaged.id };
    expect(selectionPanelModel(w.game, [w.survivor1.id])).toMatchObject({ unit: { task: '维修拆解站' } });
    w.survivor1.task = { type: 'wait' };
    expect(selectionPanelModel(w.game, [w.survivor1.id])).toMatchObject({ unit: { task: '等待命令' } });
  });
});

/** The ownership line of the panel for these units (docs/narrative.md「单位控制」). */
function controlLine(game: Game, ids: number[]): string | null {
  const m = selectionPanelModel(game, ids);
  if (m.kind === 'soldier' || m.kind === 'survivor') return m.unit.control.text;
  return m.kind === 'group' ? m.control.text : null;
}

describe('selectionPanelModel: who controls the selected units', () => {
  it('units start under automatic control', () => {
    const w = buildTestWorld();
    expect(controlLine(w.game, [w.rifle1.id])).toBe('自动管理');
    expect(controlLine(w.game, [w.survivor1.id])).toBe('自动管理');
    expect(selectionPanelModel(w.game, [w.rifle1.id])).toMatchObject({ unit: { control: { player: false } } });
  });

  it('flags a selection with any unit under player control', () => {
    const w = buildTestWorld();
    applyCommand(w.game, { type: 'hold', unitIds: [w.rifle1.id] });
    expect(selectionPanelModel(w.game, [w.rifle1.id])).toMatchObject({ unit: { control: { player: true } } });
    expect(selectionPanelModel(w.game, [w.rifle1.id, w.rifle2.id])).toMatchObject({ control: { player: true } });
    expect(selectionPanelModel(w.game, [w.rifle2.id, w.guard.id])).toMatchObject({ control: { player: false } });
  });

  it('a soldier given an order with an end is under player control until it ends; X hands it back', () => {
    const w = buildTestWorld();
    applyCommand(w.game, { type: 'move', unitIds: [w.rifle1.id], x: 10.5, y: 10.5 });
    expect(controlLine(w.game, [w.rifle1.id])).toBe('由你指挥，命令完成后转回自动管理');
    applyCommand(w.game, { type: 'stop', unitIds: [w.rifle1.id] });
    expect(controlLine(w.game, [w.rifle1.id])).toBe('自动管理');
  });

  it('a holding soldier keeps holding until X', () => {
    const w = buildTestWorld();
    applyCommand(w.game, { type: 'hold', unitIds: [w.rifle1.id] });
    expect(controlLine(w.game, [w.rifle1.id])).toBe('由你指挥，原地坚守。按 X 转回自动管理');
  });

  it('a survivor the player sent to work stays there; one sent to repair goes back when done', () => {
    const w = buildTestWorld();
    applyCommand(w.game, { type: 'assignWork', unitIds: [w.survivor1.id], buildingId: w.greenhouse.id });
    expect(controlLine(w.game, [w.survivor1.id])).toBe('由你指挥，固定在这里工作。按 X 转回自动管理');
    applyCommand(w.game, { type: 'repair', unitIds: [w.survivor2.id], buildingId: w.damaged.id });
    expect(controlLine(w.game, [w.survivor2.id])).toBe('由你指挥，命令完成后转回自动管理');
  });

  it('a survivor pulled out of a building waits for orders', () => {
    const w = buildTestWorld();
    enterBuilding(w.game, w.survivor1, w.greenhouse);
    applyCommand(w.game, { type: 'unassignWork', buildingId: w.greenhouse.id, count: 1 });
    expect(controlLine(w.game, [w.survivor1.id])).toBe('由你指挥，等待命令。按 X 转回自动管理');
  });

  it('a multi-selection counts both sides when they differ, and shows the common line when they agree', () => {
    const w = buildTestWorld();
    expect(controlLine(w.game, [w.rifle1.id, w.rifle2.id, w.survivor1.id])).toBe('自动管理');
    applyCommand(w.game, { type: 'hold', unitIds: [w.rifle1.id, w.rifle2.id] });
    expect(controlLine(w.game, [w.rifle1.id, w.rifle2.id])).toBe('由你指挥，原地坚守。按 X 转回自动管理');
    expect(controlLine(w.game, [w.rifle1.id, w.rifle2.id, w.guard.id, w.survivor1.id])).toBe('2 个自动管理，2 个由你指挥');
    applyCommand(w.game, { type: 'move', unitIds: [w.guard.id], x: 10.5, y: 10.5 });
    expect(controlLine(w.game, [w.rifle1.id, w.guard.id])).toBe('由你指挥。按 X 转回自动管理');
  });
});

describe('selectionPanelModel: buildings', () => {
  it('shows worker slots and sends the nearest idle survivor to work', () => {
    const w = buildTestWorld();
    w.survivor1.insideId = w.greenhouse.id;
    w.survivor1.task = { type: 'work', buildingId: w.greenhouse.id };
    (w.greenhouse.workers as number[]).push(w.survivor1.id);
    const m = selectionPanelModel(w.game, [w.greenhouse.id]);
    if (m.kind !== 'building') throw new Error('expected building');
    const slots = BUILDINGS.greenhouse.workerSlots;
    expect(m.building).toMatchObject({ name: '温室', workers: { count: 1, slots }, production: '食物' });
    const food = perDayToPerMinute(buildingYieldPerDay(w.game, w.greenhouse).food);
    expect(food).toBeGreaterThan(0);
    expect(m.building.output).toEqual([{ resource: 'food', name: '食物', perMinute: food }]);
    w.game.modifiers.building.greenhouse.workerSlotsAdd = 1;
    expect(selectionPanelModel(w.game, [w.greenhouse.id])).toMatchObject({ building: { workers: { count: 1, slots: slots + 1 } } });
    expectMirrors(m.building.addWorker, w.game, { type: 'assignWork', unitIds: [w.survivor2.id], buildingId: w.greenhouse.id });
    expectMirrors(m.building.removeWorker, w.game, { type: 'unassignWork', buildingId: w.greenhouse.id, count: 1 });
  });

  it('shows the output of the core and of an unstaffed production building', () => {
    const w = buildTestWorld();
    const core = selectionPanelModel(w.game, [w.game.state.coreId]);
    if (core.kind !== 'building') throw new Error('expected building');
    expect(core.building.output.map((o) => o.resource)).toEqual(['scrap', 'food', 'research']);
    const coreState = w.game.state.entities.get(w.game.state.coreId)!;
    if (coreState.kind !== 'building') throw new Error('expected building');
    expect(core.building.output[1]?.perMinute).toBeCloseTo(perDayToPerMinute(buildingYieldPerDay(w.game, coreState).food));
    const empty = selectionPanelModel(w.game, [w.greenhouse.id]);
    expect(empty.kind === 'building' && empty.building.output).toEqual([{ resource: 'food', name: '食物', perMinute: 0 }]);
    expect(selectionPanelModel(w.game, [w.shack.id])).toMatchObject({ building: { output: [] } });
  });

  it('sends a survivor under automatic control from another job when nobody is idle', () => {
    const w = buildTestWorld();
    w.survivor1.task = { type: 'repair', buildingId: w.damaged.id };
    w.survivor2.hp = 0;
    const m = selectionPanelModel(w.game, [w.greenhouse.id]);
    if (m.kind !== 'building') throw new Error('expected building');
    expectMirrors(m.building.addWorker, w.game, { type: 'assignWork', unitIds: [w.survivor1.id], buildingId: w.greenhouse.id });
  });

  it('cannot add a worker without a survivor under automatic control', () => {
    const w = buildTestWorld();
    w.survivor1.task = { type: 'repair', buildingId: w.damaged.id };
    w.survivor1.control = 'player';
    w.survivor2.hp = 0;
    const m = selectionPanelModel(w.game, [w.greenhouse.id]);
    if (m.kind !== 'building') throw new Error('expected building');
    expect(m.building.addWorker).toEqual({ ok: false, reason: '没有自动管理的幸存者', command: null });
  });

  it('lists trainable units and the queue of a military building', () => {
    const w = buildTestWorld();
    (w.barracks.trainQueue as { unit: 'rifleman'; progress: number; total: number }[]).push({ unit: 'rifleman', progress: 50, total: 200 });
    const m = selectionPanelModel(w.game, [w.barracks.id]);
    if (m.kind !== 'building') throw new Error('expected building');
    const t = m.building.training;
    expect(t?.options.map((o) => o.name)).toEqual(['盾卫', '步枪手', '摩托斥候']);
    expect(t?.options[1]?.description).toBe(SOLDIERS.rifleman.description);
    const base = SOLDIERS.rifleman.cost;
    expect(t?.options[1]?.cost).toEqual([
      { resource: 'scrap', name: '废料', amount: base.scrap, affordable: true },
      { resource: 'food', name: '食物', amount: base.food, affordable: true },
    ]);
    expectMirrors(t?.options[0]?.availability, w.game, { type: 'train', buildingId: w.barracks.id, unit: 'shieldGuard' });
    w.game.modifiers.global.trainCostPct = 0.2;
    const pricier = selectionPanelModel(w.game, [w.barracks.id]);
    expect(pricier.kind === 'building' && pricier.building.training?.options[1]?.cost.map((c) => c.amount)).toEqual([
      Math.round((base.scrap as number) * 1.2),
      Math.round((base.food as number) * 1.2),
    ]);
    expect(t?.queue).toHaveLength(1);
    expect(t?.queue[0]).toMatchObject({ index: 0, name: '步枪手', progress: 0.25 });
    expectMirrors(t?.queue[0]?.cancel, w.game, { type: 'cancelTraining', buildingId: w.barracks.id, index: 0 });
    expect(selectionPanelModel(w.game, [w.greenhouse.id])).toMatchObject({ building: { training: null } });
  });

  it('construction sites show progress, cancel, and help-build, but take no workers yet', () => {
    const w = buildTestWorld();
    (w.site.construction as { progress: number; total: number }).progress = 40;
    const m = selectionPanelModel(w.game, [w.site.id]);
    if (m.kind !== 'building') throw new Error('expected building');
    expect(m.building.construction?.progress).toBeCloseTo(40 / (w.site.construction as { total: number }).total);
    expectMirrors(m.building.cancelConstruction, w.game, { type: 'cancelConstruction', buildingId: w.site.id });
    expectMirrors(m.building.repair, w.game, { type: 'repair', unitIds: [w.survivor2.id], buildingId: w.site.id });
    const farm = addBuilding(w.game, 'greenhouse', 16, 1, { complete: false });
    expect(selectionPanelModel(w.game, [farm.id])).toMatchObject({ building: { workers: null, addWorker: null, removeWorker: null, signal: null } });
  });

  it('damaged buildings offer repair; intact ones do not; the core cannot be demolished', () => {
    const w = buildTestWorld();
    const damaged = selectionPanelModel(w.game, [w.damaged.id]);
    if (damaged.kind !== 'building') throw new Error('expected building');
    expectMirrors(damaged.building.repair, w.game, { type: 'repair', unitIds: [w.survivor1.id], buildingId: w.damaged.id });
    expectMirrors(damaged.building.demolish, w.game, { type: 'demolish', buildingId: w.damaged.id });
    expect(selectionPanelModel(w.game, [w.shack.id])).toMatchObject({ building: { repair: null, housing: BUILDINGS.shack.housing } });
    expect(selectionPanelModel(w.game, [w.game.state.coreId])).toMatchObject({ building: { isCore: true, demolish: null } });
  });
});

describe('selectionPanelModel: enemies', () => {
  it('describes a mutant with its weakness (the damage type with the highest multiplier)', () => {
    const w = buildTestWorld();
    revealAll(w.game);
    const best = [...DAMAGE_TYPES].sort((a, b) => DAMAGE_MULTIPLIER[b].none - DAMAGE_MULTIPLIER[a].none)[0]!;
    expect(selectionPanelModel(w.game, [w.mutant.id])).toMatchObject({
      kind: 'mutant',
      mutant: { name: '游荡者', armorName: '无甲', weakness: `${DAMAGE_TYPE_NAMES[best]}伤害 ×${DAMAGE_MULTIPLIER[best].none}`, boss: false },
    });
  });

  it('describes a nest with its level', () => {
    const w = buildTestWorld();
    (w.nest as { discovered: boolean }).discovered = true;
    expect(selectionPanelModel(w.game, [w.nest.id])).toMatchObject({
      kind: 'nest',
      nest: { name: '巢穴', level: 1, isHive: false, description: '摧毁巢穴可以获得燃料、科研，有时还有幸存者。选中士兵后右键巢穴即可集火。' },
    });
  });

  it('explains the hive shield with the ordinary nests left and the current reduction', () => {
    const game = createGame({ seed: 'sel-hive', origin: 'militia', difficulty: 'normal' });
    const hive = [...game.state.entities.values()].find((e) => e.kind === 'nest' && e.isHive)!;
    const pct = (share: number) => `${Math.round(share * 100)}%`;
    const rule = `地图上每剩一个普通巢穴，母巢受到的伤害降低 ${pct(HIVE_SHIELD.reductionPerNest)}，最多降低 ${pct(HIVE_SHIELD.maxReduction)}。`;
    const ordinary = [...game.state.entities.values()].filter((e) => e.kind === 'nest' && !e.isHive);
    for (const e of ordinary.slice(2)) removeEntity(game, e);
    expect(selectionPanelModel(game, [hive.id])).toMatchObject({
      kind: 'nest',
      nest: { name: '母巢', isHive: true, description: `${rule}现在还剩 2 个，减伤 ${pct(2 * HIVE_SHIELD.reductionPerNest)}。` },
    });
    for (const e of ordinary.slice(0, 2)) removeEntity(game, e);
    expect(selectionPanelModel(game, [hive.id])).toMatchObject({ nest: { description: `${rule}普通巢穴已全部摧毁，母巢不再减伤。` } });
  });
});

describe('selectionPanelModel: signal tower', () => {
  function towerWorld(stage: 'repair' | 'ready' | 'broadcast') {
    const w = buildTestWorld();
    const tower = addBuilding(w.game, 'signalTower', 0, 5, { complete: stage !== 'repair' });
    Object.assign(w.game.state.signal, { buildingId: tower.id, stage });
    return { ...w, tower };
  }

  function towerModel(w: ReturnType<typeof towerWorld>) {
    const m = selectionPanelModel(w.game, [w.tower.id]);
    if (m.kind !== 'building') throw new Error('expected building');
    return m.building;
  }

  it('while it is being built it takes a crew: only living workers on site count, sending and withdrawing use assignWork / unassignWork, and there is no help-build button', () => {
    const w = towerWorld('repair');
    for (const s of [w.survivor1, w.survivor2]) {
      s.insideId = w.tower.id;
      s.task = { type: 'work', buildingId: w.tower.id };
      (w.tower.workers as number[]).push(s.id);
    }
    // Died inside this tick: still listed until cleanup, but not working any more.
    w.survivor2.hp = 0;
    const idle = spawnSurvivor(w.game, 4.5, 10.5);
    const b = towerModel(w);
    expect(onsiteWorkerCount(w.game, w.tower)).toBe(1);
    expect(b.workers).toEqual({ count: 1, slots: BUILDINGS.signalTower.workerSlots });
    expectMirrors(b.addWorker, w.game, { type: 'assignWork', unitIds: [idle.id], buildingId: w.tower.id });
    expectMirrors(b.removeWorker, w.game, { type: 'unassignWork', buildingId: w.tower.id, count: 1 });
    expect(b.addWorker?.ok).toBe(true);
    expect(b.repair).toBeNull();
    // How long it takes depends on the crew on site, so no countdown in seconds.
    expect(b.construction?.secondsLeft).toBeNull();
    expect(b.signal).toMatchObject({ stage: SIGNAL_STAGE_NAMES.repair, progress: null, start: null });
    expect(b.signal?.stage).toBe('修建中');
  });

  it('once it stands it takes no crew and offers 开始广播, mirroring startSignalBroadcast; a damaged tower can be repaired', () => {
    const w = towerWorld('ready');
    const b = towerModel(w);
    expect(b).toMatchObject({ workers: null, addWorker: null, removeWorker: null, repair: null, construction: null });
    expect(b.signal).toMatchObject({ stage: '可以广播', progress: null });
    expectMirrors(b.signal?.start, w.game, { type: 'startSignalBroadcast' });
    expect(b.signal?.start?.ok).toBe(true);
    const required = w.game.state.signal.nightsRequired;
    expect(b.signal?.startTip).toBe(`开始向长明城广播。之后的夜里会有一队怪物专门来打信号塔，守住 ${required} 晚，车队就会到。塔被毁会中断广播。`);
    w.tower.hp -= 100;
    expectMirrors(towerModel(w).repair, w.game, { type: 'repair', unitIds: [w.survivor1.id], buildingId: w.tower.id });
  });

  it('while broadcasting it shows the nights held instead of a start button (no refusal reason next to it)', () => {
    const w = towerWorld('broadcast');
    Object.assign(w.game.state.signal, { nightsHeld: 1, nightsRequired: 3 });
    const b = towerModel(w);
    expect(b.signal).toMatchObject({ stage: '广播中', progress: '广播中 · 已守住 1/3 晚', start: null });
  });
});
