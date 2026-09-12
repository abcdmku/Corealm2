import { describe, expect, it } from 'vitest';
import { FAIRY_AGILITY_LINKS, fairyAgilityLocations, fairyAgilityObstacles, fairyAgilityApproachRoads,
  type FairyAgilityLink } from '../game/src/content/fairyAgility.js';
import { FAIRY_REGIONS } from '../game/src/content/fairyRegions.js';
import { agilityXp } from '../game/src/content/index.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_LANDFORM_PROBES } from '../game/src/world/fairyLandforms.js';
import { SKILL_IDS, type SemanticEntity, type SkillId, type Vec3 } from '../game/src/contracts.js';
import { EventBus } from '../game/src/core/events.js';
import { RngStreams } from '../game/src/core/rng.js';
import { SimClock } from '../game/src/core/time.js';
import { Store, setSkillLevel } from '../game/src/state/store.js';
import { ActivitySystem } from '../game/src/systems/activity.js';
import { AgilitySystem } from '../game/src/systems/agility.js';
import { InteractionDispatcher } from '../game/src/world/interactions.js';
import * as THREE from 'three';
import { WorldScene, type WorldTerrainSpec } from '../game/src/render/scene.js';
import { assembleAgilityFixture, configureAgilityLabTerrain, createAgilityWorkbench, FAIRY_AGILITY_LAB_PLACEMENTS } from '../game/src/featureLab/agility.js';

function traversalFixture(link: FairyAgilityLink) {
  const definition = link.obstacle;
  const plateau = FAIRY_COMBAT_PLATEAUS.find(candidate => candidate.id === link.landformId)!;
  // Endpoint grounding is injected here. Real navmesh and final terrain proof belongs to the world gate.
  const entry: Vec3 = [definition.position[0], -120, definition.position[1]];
  const exit: Vec3 = [definition.exitPosition[0], -120 + plateau.rise, definition.exitPosition[1]];
  const entity: SemanticEntity = {
    id: definition.id, name: definition.name, archetype: 'obstacle', regionId: link.regionId, tier: link.tier,
    position: entry, state: 'available', interactions: ['inspect', definition.interaction],
    requirements: { agility: definition.reqLevel },
    obstacle: { reqLevel: definition.reqLevel, exitPosition: exit,
      durationMs: definition.durationMs, savesMeters: definition.savesMeters },
    meta: { oneWay: definition.oneWay === true },
  };
  const store = new Store(2, 0), state = store.get();
  state.player.position = [...entry];
  const events = new EventBus(), clock = new SimClock(), rng = new RngStreams(2);
  const entities = { get: (id: string) => id === entity.id ? entity : undefined };
  const dispatcher = new InteractionDispatcher({ get: entities.get,
    playerPosition: () => state.player.position,
    skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, state.skills[id].level])) as Record<SkillId, number>,
  });
  const activity = new ActivitySystem(store, events);
  const agility = new AgilitySystem({ store, events, clock, rng, entities, activity, dispatcher,
    nav: { closestPoint: point => [...point] as Vec3 } });
  const step = (ticks: number) => {
    for (let index = 0; index < ticks; index++) {
      clock.commitTick(); activity.tick(100, clock.elapsedMs); events.flush();
    }
  };
  return { state, entity, entry, exit, dispatcher, agility, step };
}

describe('fairy shelf agility access', () => {
  it('stages all five production definitions on real compact terrain with their endpoint deltas and rises', () => {
    const bounds = { minX: -128, maxX: 128, minZ: -128, maxZ: 128 };
    const terrain: WorldTerrainSpec = { bounds, chunkSize: 64, metresPerQuad: 2, blendMetres: 0,
      regions: [{ regionId: 'fallowmarch', rect: bounds, seed: 2, character: 'plains', baseHeight: 0, amplitude: 0 }] };
    configureAgilityLabTerrain(terrain);
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(terrain);
      const fixture = assembleAgilityFixture((x, z) => scene.meshHeightAt(x, z), () => 0, () => null, () => null);
      const workbench = createAgilityWorkbench(fixture, {
        store: new Store(2, 0), rng: new RngStreams(2).get('misc'),
        quests: { setStage: () => { throw Error('No quest setup needed for observation'); }, evaluateNow: () => {} },
        // Reproduce marker-adjacent navigation lifting the foot farther than the summit.
        navigation: { closestPoint: point => [point[0], point[1] + (point[1] < 1 ? .56 : .2), point[2]] },
        movement: { planPath: () => null },
      });
      const observed = workbench.getState();
      expect(fixture.lanes.filter(lane => lane.id.startsWith('contact_'))).toHaveLength(4);
      expect(fixture.lanes.some(lane => lane.id === 'root_tunnel')).toBe(true);
      expect(fixture.lanes.some(lane => lane.id === 'sunder_ledge')).toBe(true);
      for (const { link, entry, exit, rise } of FAIRY_AGILITY_LAB_PLACEMENTS) {
        const lane = fixture.lanes.find(candidate => candidate.id === link.obstacle.id)!;
        const entity = fixture.entities.find(candidate => candidate.id === link.obstacle.id)!;
        const observation = observed.lanes.find(candidate => candidate.id === link.obstacle.id)!;
        expect(lane.entry).toEqual([entry[0], 0, entry[1]]);
        expect(lane.exit[0] - lane.entry[0]).toBeCloseTo(link.obstacle.exitPosition[0] - link.obstacle.position[0], 8);
        expect(lane.exit[2] - lane.entry[2]).toBeCloseTo(link.obstacle.exitPosition[1] - link.obstacle.position[1], 8);
        expect(lane.exit[1] - lane.entry[1]).toBeCloseTo(rise, 4);
        expect(lane.exit[1]).toBeCloseTo(scene.meshHeightAt(...exit), 8);
        expect(observation.groundEntry).toEqual(lane.entry);
        expect(observation.groundExit).toEqual(lane.exit);
        expect(observation.exit[1] - observation.entry[1]).toBeCloseTo(rise - .36, 8);
        expect(observation.groundExit[1] - observation.groundEntry[1]).toBeCloseTo(rise, 8);
        expect(entity.obstacle).toMatchObject({ reqLevel: link.obstacle.reqLevel, durationMs: link.obstacle.durationMs });
        expect(entity.meta).toMatchObject({ authoredRegionId: link.regionId, fromLocationId: link.obstacle.fromLocationId,
          toLocationId: link.obstacle.toLocationId });
        expect(fixture.routeEdges.filter(edge => edge.obstacleId === entity.id)).toHaveLength(2);
      }
    } finally { scene.dispose(); }
  });

  it('adds five flank climbs with valley approaches and preserves each ordinary return ramp', () => {
    expect(FAIRY_AGILITY_LINKS.map(link => link.landformId)).toEqual([
      'moonpetal_table', 'southern_bloom_table', 'prism_table', 'starroot_crown', 'orchid_crown',
    ]);
    const ids = FAIRY_AGILITY_LINKS.flatMap(link => [link.obstacle.id, ...link.locations.map(location => location.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const link of FAIRY_AGILITY_LINKS) {
      const plateau = FAIRY_COMBAT_PLATEAUS.find(candidate => candidate.id === link.landformId)!;
      const probe = FAIRY_LANDFORM_PROBES.find(candidate => candidate.id === link.landformId)!;
      const region = FAIRY_REGIONS.find(candidate => candidate.id === link.regionId)!;
      expect(plateau.ramps.length).toBeGreaterThan(0);
      expect(link.obstacle.position).toEqual(probe.flankFoot);
      expect(link.obstacle.exitPosition).toEqual(probe.flankTop);
      expect(link.obstacle.oneWay).not.toBe(true);
      expect(region.locations.some(location => location.id === link.approachRoad.from)).toBe(true);
      expect(link.approachRoad.to).toBe(link.obstacle.fromLocationId);
      expect(link.approachRoad.from).not.toBe(link.obstacle.toLocationId);
      for (const [id, position] of [[link.obstacle.fromLocationId, probe.flankFoot],
        [link.obstacle.toLocationId, probe.flankTop]] as const) {
        expect(link.locations.find(location => location.id === id)).toMatchObject({ position, routeNode: true });
      }
    }
    expect(FAIRY_COMBAT_PLATEAUS.find(plateau => plateau.id === 'lantern_crown')!.ramps).toHaveLength(2);
    for (const regionId of ['gloamgarden', 'faeholme'] as const) {
      const count = regionId === 'gloamgarden' ? 2 : 3;
      expect(fairyAgilityLocations(regionId)).toHaveLength(count * 2);
      expect(fairyAgilityObstacles(regionId)).toHaveLength(count);
      expect(fairyAgilityApproachRoads(regionId)).toHaveLength(count);
    }
  });

  it.each(FAIRY_AGILITY_LINKS)('$landformId enforces its skill gate, timed ascent and earned return', link => {
    const h = traversalFixture(link);
    setSkillLevel(h.state, 'agility', link.obstacle.reqLevel - 1);
    const beforeXp = h.state.skills.agility.xp;
    expect(h.dispatcher.run(h.entity.id, 'climb')).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET' } });
    expect(h.agility.beginRoute(h.entity.id, h.entry, h.exit)).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET' } });
    expect(h.state.activity).toBeNull();
    expect(h.state.player.position).toEqual(h.entry);
    expect(h.state.skills.agility.xp).toBe(beforeXp);

    // Twenty levels above the authored requirement is the production guaranteed-success threshold.
    setSkillLevel(h.state, 'agility', link.obstacle.reqLevel + 20);
    const trainedXp = h.state.skills.agility.xp;
    expect(h.dispatcher.run(h.entity.id, 'climb').ok).toBe(true);
    expect(h.state.activity).toMatchObject({ kind: 'traversing', obstacleId: h.entity.id });
    h.step(link.obstacle.durationMs / 100 - 1);
    expect(h.state.player.position).toEqual(h.entry);
    expect(h.state.world.obstaclesUsed[h.entity.id]).toBeUndefined();
    h.step(1);
    expect(h.state.player.position).toEqual(h.exit);
    expect(h.state.world.obstaclesUsed[h.entity.id]).toBe(1);
    expect(h.state.skills.agility.xp).toBe(trainedXp + agilityXp(link.tier));

    expect(h.agility.beginRoute(h.entity.id, h.exit, h.entry).ok).toBe(true);
    h.step(link.obstacle.durationMs / 100);
    expect(h.state.player.position).toEqual(h.entry);
    expect(h.state.world.obstaclesUsed[h.entity.id]).toBe(2);
    expect(h.state.skills.agility.xp).toBe(trainedXp + agilityXp(link.tier) * 2);
  });
});
