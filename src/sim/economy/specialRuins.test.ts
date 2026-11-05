import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createGame, serializeGame, restoreGame, SAVE_VERSION, hashState } from '../index';
import { SPECIAL_RUINS } from '../data/ruins';
import { RUIN_FRAGMENTS } from '../data/fragments';
import { TECHS, TECH_IDS } from '../data/economy';
import { tileCenter } from '../map/grid';
import { removeEntity, spawnSurvivor } from '../world/entities';
import { rebuildSpatialIndex } from '../world/spatial';
import { explorationSystem } from './exploration';
import { inspirationProgress, techSystem } from './tech';
import { dailyUpkeep } from './population';
import { SOLDIERS } from '../data/combat';
import { refreshModifiers } from '../game';
import { incidentSystem } from '../incidents/incidents';

describe('special ruins', () => {
  it('copies names, descriptions, feedback and counts exactly from narrative', () => {
    const text = readFileSync('docs/narrative.md', 'utf8').split('## 地图上的特殊遗迹')[1]!.split('## ')[0]!;
    const rows = text.split('\n').filter(row => row.startsWith('| 坠落的') || row.startsWith('| 旧时代仓库')).map(row => row.split('|').slice(1, -1).map(cell => cell.trim()));
    expect(rows).toHaveLength(2);
    for (const [i, def] of Object.values(SPECIAL_RUINS).entries()) {
      const row = rows[i]!;
      expect(def.count).toBe(Number(row[1]!.split(' ')[0]));
      expect([def.name, def.description, def.feedback]).toEqual([row[2], row[3], row[5]].map(s => s!.slice(1, -1)));
    }
  });
  it('grants fixed rewards once, shares fragments/counts/inspirations and round trips the current save version', () => {
    const g = createGame({ seed: 'special-ruins', origin: 'scavengers', difficulty: 'normal' });
    incidentSystem(g);
    for (const e of [...g.state.entities.values()]) if (e.kind === 'soldier' || e.kind === 'survivor') removeEntity(g, e);
    const specials = g.state.map.ruins.filter(r => r.kind !== 'ordinary');
    expect(specials.map(r => r.kind)).toEqual(['supplyPod', 'supplyPod', 'warehouse']);
    for (const r of specials) {
      const p = tileCenter(g.state.map, r.tile);
      spawnSurvivor(g, p.x, p.y);
    }
    const before = { ...g.state.economy.resources };
    rebuildSpatialIndex(g.spatial, g.state);
    explorationSystem(g);
    expect(g.state.economy.resources.scrap - before.scrap).toBe(160);
    expect(g.state.economy.resources.fuel - before.fuel).toBe(40);
    expect([...g.state.entities.values()].filter(e => e.kind === 'survivor')).toHaveLength(3);
    expect([...g.state.entities.values()].filter(e => e.kind === 'soldier').map(e => e.type)).toEqual(['sniper']);
    expect(g.state.stats.soldiersTrained.sniper).toBe(0);
    expect(dailyUpkeep(g)).toBe(SOLDIERS.sniper.upkeepFoodPerDay);
    expect(g.state.stats.ruinsExplored).toBe(3);
    expect(g.state.incidents.fragmentIndex).toBe(3);
    expect(g.events.filter(e => e.type === 'ruinFragment').map(e => e.text)).toEqual(RUIN_FRAGMENTS.slice(0, 3));
    expect(g.events.filter(e => e.type === 'ruinExplored').map(e => e.feedback)).toEqual(specials.map(r => SPECIAL_RUINS[r.kind as keyof typeof SPECIAL_RUINS].feedback));
    for (const id of TECH_IDS) if (TECHS[id].inspiration.kind === 'exploreRuins') expect(inspirationProgress(g.state, id).value).toBe(3);
    techSystem(g);
    for (const id of TECH_IDS) if (TECHS[id].inspiration.kind === 'exploreRuins' && TECHS[id].inspiration.count <= 3) expect(g.state.economy.tech.inspired).toContain(id);
    const saved = serializeGame(g);
    expect(SAVE_VERSION).toBe(12);
    const restored = restoreGame(saved)!;
    expect(hashState(restored)).toBe(hashState(g));
    expect(restored.state.map.ruins).toEqual(g.state.map.ruins);
    expect(restored.state.incidents.eventDays).toEqual(g.state.incidents.eventDays);
    rebuildSpatialIndex(restored.spatial, restored.state);
    explorationSystem(restored);
    expect(restored.state.stats.ruinsExplored).toBe(3);
    expect(restored.events).toEqual([]);
    const old = JSON.parse(saved); old.version = 8;
    expect(restoreGame(JSON.stringify(old))).toBeNull();
  });
  it('applies ordinary resource reward modifiers to a fixed supply bundle', () => {
    const g = createGame({ seed: 'special-modifiers', origin: 'scavengers', difficulty: 'normal' });
    g.state.economy.tech.researched.push('ruinArchives');
    refreshModifiers(g);
    const ruin = g.state.map.ruins.find(r => r.kind === 'supplyPod')!;
    const p = tileCenter(g.state.map, ruin.tile);
    spawnSurvivor(g, p.x, p.y);
    const before = { ...g.state.economy.resources };
    rebuildSpatialIndex(g.spatial, g.state);
    explorationSystem(g);
    expect(g.state.economy.resources.scrap - before.scrap).toBe(120);
    expect(g.state.economy.resources.fuel - before.fuel).toBe(30);
    expect(ruin.reward).toEqual({ kind: 'resources', amounts: { scrap: 80, fuel: 20 } });
  });

});
