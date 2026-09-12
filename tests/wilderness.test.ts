import { describe, expect, it } from 'vitest';
import MANIFEST from '../game/public/assets/manifest.json';
import { REGIONS, WORLD_BOUNDS } from '../game/src/content/regions.js';
import { enemyBlockFor } from '../game/src/content/enemies.js';
import { inStarterWildlifeArea, isStarterAnimalAsset } from '../game/src/content/fantasyEncounters.js';
import { WILDERNESS_GROUPS } from '../game/src/content/wilderness.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { sampleOrganicBiomeWeights } from '../game/src/world/organicFields.js';
import { blendBiomeSky } from '../game/src/render/biomeSky.js';
import { createInitialState } from '../game/src/state/store.js';
import { SaveService } from '../game/src/persistence/storage.js';

describe('northern wilderness and fantasy encounters', () => {
  it('confines every authored animal footprint to the starting area and resolves its actual occupant stats', () => {
    for (const region of REGIONS) for (const group of [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]) {
      if (isStarterAnimalAsset(group.assetId)) expect(inStarterWildlifeArea(region.id, group.centre, group.radius), group.id).toBe(true);
      expect(enemyBlockFor(group.id, group.family, group.tier)?.family, group.id).toBe(group.family);
      expect(MANIFEST.assets.some(asset => asset.id === group.assetId), group.id).toBe(true);
    }
  });

  it('keeps a continuous northern night climate across the island and daylight at the starting town', () => {
    const spec = buildWorldTerrainSpec();
    expect(WORLD_BOUNDS).toEqual({ min: [-350, -200], max: [700, 940] });
    for (const z of [650, 720, 820, 930]) for (let x = -350; x <= 700; x += 50) {
      const weights = Object.fromEntries(sampleOrganicBiomeWeights(x, z, spec.biomes!).map(row => [row.id, row.weight]));
      expect(weights.wilderness, `north at ${x}`).toBeGreaterThan(.9);
      expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
      expect(blendBiomeSky(weights).night).toBeGreaterThan(.9);
    }
    expect(blendBiomeSky(Object.fromEntries(sampleOrganicBiomeWeights(-160, -72, spec.biomes!).map(row => [row.id, row.weight]))).night).toBeLessThan(.01);
    const north = REGIONS.find(region => region.id === 'wilderness')!;
    expect(north.settlement).toBeUndefined();
    expect(north.terrainAmplitude).toBeGreaterThan(6);
    expect(north.terrainAmplitude).toBeLessThan(20);
    expect(WILDERNESS_GROUPS.reduce((sum, group) => sum + group.count, 0)).toBeGreaterThan(35);
  });

  it('gives the northern ecotone a traversable stretch of dusk instead of a sudden night wall', () => {
    const spec = buildWorldTerrainSpec().biomes!;
    for (const x of [-350, -300, -150, 0, 150, 300, 350, 500, 650, 700]) {
      const samples = Array.from({ length: 61 }, (_, i) => {
        const z = 380 + i * 5;
        return { z, weight: sampleOrganicBiomeWeights(x, z, spec).find(row => row.id === 'wilderness')!.weight };
      });
      const dusk = samples.find(row => row.weight >= .1)!;
      const night = samples.find(row => row.weight >= .9)!;
      expect(dusk, `dusk on transect ${x}`).toBeDefined();
      expect(night, `night on transect ${x}`).toBeDefined();
      expect(night.z - dusk.z, `transition width at ${x}`).toBeGreaterThanOrEqual(65);
      for (let i = 1; i < samples.length; i++) {
        expect(Math.abs(samples[i]!.weight - samples[i - 1]!.weight), `five-metre step at ${x},${samples[i]!.z}`).toBeLessThan(.14);
      }
    }
  });

  it('loads wilderness saves and transfers earned quest kills and stage baselines exactly once', () => {
    const state = createInitialState(7, 0), saves = new SaveService(false);
    state.player.regionId = 'wilderness';
    state.player.position = [40, 9, 594];
    state.quests.eleven_empty_days = { status: 'active', stage: 1,
      counters: { 'kill:hog': 9, '@base:kill:hog': 7 }, flags: { walked_the_line: true } };
    state.quests.long_cairn = { status: 'active', stage: 6,
      counters: { 'kill:rat': 10, '@base:kill:rat': 6, 'kill:bear': 6, '@base:kill:bear': 5 }, flags: {} };
    const loaded = saves.loadSerialized(saves.serialize(state));
    expect(loaded.status).toBe('loaded');
    expect(loaded.state?.player.regionId).toBe('wilderness');
    expect(loaded.state?.quests.eleven_empty_days?.counters).toEqual({ 'kill:fen_crawler': 9, '@base:kill:fen_crawler': 7 });
    expect(loaded.state?.quests.long_cairn?.counters).toEqual({
      'kill:blind_cave_weaver': 10, '@base:kill:blind_cave_weaver': 6,
      'kill:vault_custodian': 6, '@base:kill:vault_custodian': 5,
    });
    const twice = saves.loadSerialized(saves.serialize(loaded.state!));
    expect(twice.state?.quests).toEqual(loaded.state?.quests);
  });

  it('merges prior fantasy kills with current families without losing progress or changing unrelated skeleton counters', () => {
    const state = createInitialState(7, 0), saves = new SaveService(false);
    state.quests.eleven_empty_days = { status: 'active', stage: 1, counters: {
      'kill:beetle_golem': 4, '@base:kill:beetle_golem': 2,
      'kill:fen_crawler': 1, '@base:kill:fen_crawler': 1,
    }, flags: { walked_the_line: true } };
    state.quests.long_cairn = { status: 'active', stage: 6, counters: {
      'kill:skeleton_soldier': 10, '@base:kill:skeleton_soldier': 7,
      'kill:blind_cave_weaver': 2, '@base:kill:blind_cave_weaver': 1,
      'kill:stone_golem': 4, '@base:kill:stone_golem': 3,
      'kill:vault_custodian': 3, '@base:kill:vault_custodian': 3,
      stones_given: 1,
    }, flags: { door_open: true } };
    state.quests.the_carters_wager = { status: 'active', stage: 0,
      counters: { 'kill:skeleton_soldier': 2, '@base:kill:skeleton_soldier': 1 }, flags: {} };
    const unrelated = structuredClone(state.quests.the_carters_wager);
    const loaded = saves.loadSerialized(saves.serialize(state));
    expect(loaded.status).toBe('loaded');
    expect(loaded.state?.quests.eleven_empty_days).toEqual({ status: 'active', stage: 1,
      counters: { 'kill:fen_crawler': 5, '@base:kill:fen_crawler': 3 }, flags: { walked_the_line: true } });
    expect(loaded.state?.quests.long_cairn).toEqual({ status: 'active', stage: 6, counters: {
      'kill:blind_cave_weaver': 12, '@base:kill:blind_cave_weaver': 8,
      'kill:vault_custodian': 7, '@base:kill:vault_custodian': 6,
      stones_given: 1,
    }, flags: { door_open: true } });
    expect(loaded.state?.quests.the_carters_wager).toEqual(unrelated);
    const twice = saves.loadSerialized(saves.serialize(loaded.state!));
    expect(twice.state?.quests).toEqual(loaded.state?.quests);
  });
});
