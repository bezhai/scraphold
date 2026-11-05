import { describe, expect, it } from 'vitest';
import { REJECT_REASON_TEXT, bonusTerrainTiles, checkBuildable, checkPlacement, placementBonusPct } from '../../sim';
import { BUILDINGS } from '../../sim/data/economy';
import { buildTestWorld } from '../testWorld';
import { buildMenuModel, footprintAt, placementPreview } from './buildMenu';
import { expectMirrors } from './expectMirrors';

describe('buildMenuModel', () => {
  it('groups placeable buildings into economy, military and defense', () => {
    const w = buildTestWorld();
    const sections = buildMenuModel(w.game);
    expect(sections.map((s) => s.label)).toEqual(['经济', '军事', '防御']);
    expect(sections.map((s) => s.entries.map((e) => e.type))).toEqual([
      ['shack', 'salvageYard', 'greenhouse', 'oilWell', 'researchStation', 'dispatchHub', 'signalTower'],
      ['barracks', 'armory', 'workshop'],
      ['barricade', 'machineGunTower', 'watchtower'],
    ]);
  });

  it('shows hotkey, cost with affordability, and the tech that unlocks it', () => {
    const w = buildTestWorld();
    const shackScrap = BUILDINGS.shack.cost.scrap as number;
    w.game.state.economy.resources.scrap = shackScrap;
    const entries = buildMenuModel(w.game).flatMap((s) => s.entries);
    const shack = entries.find((e) => e.type === 'shack');
    const yard = entries.find((e) => e.type === 'salvageYard');
    const armory = entries.find((e) => e.type === 'armory');
    expect(shack).toMatchObject({ name: '棚屋', hotkey: 'Q', lockedBy: null, cost: [{ resource: 'scrap', name: '废料', amount: shackScrap, affordable: true }] });
    expect(yard?.cost[0]?.affordable).toBe((BUILDINGS.salvageYard.cost.scrap as number) <= shackScrap);
    expect(armory?.lockedBy).toBe('军械制造');
  });

  it('availability mirrors checkBuildable', () => {
    const w = buildTestWorld();
    w.game.state.economy.resources.scrap = BUILDINGS.shack.cost.scrap as number;
    for (const e of buildMenuModel(w.game).flatMap((s) => s.entries)) {
      const r = checkBuildable(w.game, e.type);
      const reason = r.ok ? null : r.reason === 'locked' ? `需要科技：${e.lockedBy}` : REJECT_REASON_TEXT[r.reason];
      expect(e.availability).toEqual(r.ok ? { ok: true } : { ok: false, reason });
    }
  });

  it('shows costs after cost modifiers', () => {
    const w = buildTestWorld();
    w.game.modifiers.global.buildCostPct = 0.1;
    const shack = buildMenuModel(w.game).flatMap((s) => s.entries).find((e) => e.type === 'shack');
    expect(shack?.cost[0]?.amount).toBe(Math.round((BUILDINGS.shack.cost.scrap as number) * 1.1));
  });
});

describe('placement preview', () => {
  it('centers the footprint on the cursor', () => {
    expect(footprintAt('shack', 5.2, 9.9)).toEqual({ tileX: 4, tileY: 9, size: 2 });
    expect(footprintAt('barricade', 5.7, 9.2)).toEqual({ tileX: 5, tileY: 9, size: 1 });
    expect(footprintAt('core', 5, 5)).toEqual({ tileX: 4, tileY: 4, size: 3 });
  });

  it('separates bad spots from rejected commands', () => {
    const w = buildTestWorld();
    const p = placementPreview(w.game, 'shack', 5.2, 9.9);
    const geometry = checkPlacement(w.game, 'shack', 4, 9);
    expect(p.geometryOk).toBe(geometry.ok);
    expectMirrors(p.availability, w.game, { type: 'placeBuilding', building: 'shack', tileX: 4, tileY: 9 });
    expect(p.status).toBe(p.availability.ok ? 'valid' : p.geometryOk ? 'unavailable' : 'blocked');
    expect(p.bonusPct).toBe(null);
    const yard = placementPreview(w.game, 'salvageYard', 5, 3);
    expect(yard.bonusPct).toBe(placementBonusPct(w.game, 'salvageYard', 4, 2));
    expect(yard.bonusPct).toBeGreaterThan(0);
    const onCore = placementPreview(w.game, 'shack', 8.5, 5.5);
    expect(onCore.geometryOk).toBe(false);
    expect(onCore.status).toBe('blocked');
  });

  it('highlights terrain that gives the building a bonus (the simulation\'s bonus tiles)', () => {
    const w = buildTestWorld();
    const yard = placementPreview(w.game, 'salvageYard', 5, 3).bonusTiles.map((i) => [i % 24, Math.floor(i / 24)]);
    expect(yard).toEqual([
      [3, 2],
      [3, 3],
    ]);
    expect(placementPreview(w.game, 'greenhouse', 9, 3).bonusTiles).toEqual(bonusTerrainTiles(w.game.state.map, 'greenhouse', 8, 2));
    expect(placementPreview(w.game, 'greenhouse', 9, 3).bonusTiles).toHaveLength(4);
    expect(placementPreview(w.game, 'shack', 9, 3).bonusTiles).toEqual([]);
  });
});
