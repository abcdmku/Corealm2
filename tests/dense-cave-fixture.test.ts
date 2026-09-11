import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assembleDenseCavePopulation, createDenseCaveLabFixture, DENSE_CAVE_SPEC, denseCaveFloorContains } from '../game/src/featureLab/denseCave.js';
import { LEGACY_CAVE_FLOOR_INTENTS } from '../game/src/content/legacyEncounterPlacements.js';
import { REGIONS } from '../game/src/content/regions.js';
import { habitatContains, habitatForGroup, WORLD_HABITATS } from '../game/src/content/worldHabitats.js';
import { DungeonDoors } from '../game/src/world/dungeonDoors.js';
import { dungeonFloorHeight, dungeonNavigationBlockers } from '../game/src/render/dungeon.js';
import { Navigation, solidObstacleMeshes } from '../game/src/systems/navigation.js';
import { MaterialLibrary } from '../game/src/render/materials.js';
import type { CorealmSurfaceTextures } from '../game/src/render/corealmSurfaceMaterials.js';
import type { Vec3 } from '../game/src/contracts.js';

const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8'));
const assets = new Map<string, any>(manifest.assets.map((asset: any) => [asset.id, asset]));
const population = () => assembleDenseCavePopulation(id => assets.get(id)?.base?.y ?? 0, id => assets.get(id)?.size ?? null);

function renderedFixture() {
  const root = new THREE.Group(), textures: THREE.Texture[] = [];
  const family = () => {
    const maps = Array.from({ length: 3 }, () => { const map = new THREE.Texture(); textures.push(map); return map; });
    return { albedo: maps[0]!, normal: maps[1]!, roughness: maps[2]!, meanLinearRgb: [.2, .2, .2] as [number, number, number], tileMetres: 2.5 };
  };
  const surfaceTextures: CorealmSurfaceTextures = { stone: family(), bark: family(), leaf: family() };
  const fixture = createDenseCaveLabFixture({ scene: { root, materials: new MaterialLibrary() }, surfaceTextures });
  return { root, fixture, dispose() { fixture.dispose(); for (const texture of textures) texture.dispose(); } };
}

describe('dense production cave fixture', () => {
  it('fits six seven-member production packs with whole-body receiving floor and separation', () => {
    const fixture = population(), actors = fixture.entities.filter(entity => entity.meta?.denseCave);
    expect(fixture.packs).toHaveLength(6);
    expect(actors).toHaveLength(42);
    expect(new Set(actors.map(actor => actor.id)).size).toBe(42);
    expect(fixture.packs.every(pack => pack.entityIds.length === 7)).toBe(true);
    const dungeon = REGIONS.find(region => region.dungeon?.id === 'gravelmaw')!.dungeon!;
    expect(dungeon.chambers[0]!.radius).toBe(13);
    for (const pack of fixture.packs) {
      expect(dungeon.enemyGroups.find(group => group.id === pack.id)!.count).toBe(7);
      const habitat = habitatForGroup(pack.id)!;
      expect(habitat.anchors).toHaveLength(pack.anchors.length);
      // Published footprint dimensions are rounded; runtime GLB bounds retain full precision.
      habitat.anchors.forEach((anchor, index) => expect(Math.hypot(
        anchor[0] - pack.anchors[index]![0], anchor[1] - pack.anchors[index]![1],
      )).toBeLessThan(1e-5));
      for (const [x, z] of habitat.anchors) expect(habitatContains(habitat, [x, 0, z])).toBe(true);
      expect(habitatContains(habitat, [10000, 0, 10000])).toBe(false);
      expect(WORLD_HABITATS.some(candidate => candidate.groupId === pack.id)).toBe(false);
    }
    const circles = fixture.packs.flatMap(pack => pack.anchors.map(position => ({ position, radius: pack.bodyRadius })));
    for (const [index, circle] of circles.entries()) {
      expect(denseCaveFloorContains(circle.position, circle.radius), `${index} whole body fits receiving floor`).toBe(true);
      for (const other of circles.slice(index + 1)) expect(Math.hypot(circle.position[0] - other.position[0], circle.position[1] - other.position[1]))
        .toBeGreaterThanOrEqual(circle.radius + other.radius + .5 - 1e-6);
    }
    const original = structuredClone(DENSE_CAVE_SPEC);
    original.chambers[0]!.radius = LEGACY_CAVE_FLOOR_INTENTS[0].originalRadius;
    expect(circles.some(circle => !denseCaveFloorContains(circle.position, circle.radius, original)), 'the expansion solves a real floor shortage').toBe(true);
    for (const entity of actors) {
      expect(entity.regionId).toBe('gravelmaw');
      expect(entity.combat!.maxHealth).toBeGreaterThan(0);
      expect(entity.combat!.bodyRadius).toBeGreaterThan(0);
      expect(entity.view!.assetId).not.toMatch(/^animal_/);
    }
  });

  it('uses real door leaves which block both partitions and permit opened passage', () => {
    const fixture = population(), entities = new Map(fixture.entities.map(entity => [entity.id, entity]));
    const doors = new DungeonDoors(fixture.thresholds.map(threshold => threshold.barrier), id => entities.get(id));
    expect(doors.getSolids()).toHaveLength(2);
    for (const threshold of fixture.thresholds) {
      const side = (distance: number): Vec3 => {
        const x = threshold.origin[0] + Math.sin(threshold.rotationY) * distance;
        const z = threshold.origin[2] + Math.cos(threshold.rotationY) * distance;
        return [x, dungeonFloorHeight(DENSE_CAVE_SPEC, x, z), z];
      };
      expect(doors.blocksSegment(side(2), side(-2))).toBe(true);
      entities.get(threshold.id)!.state = 'open';
      expect(doors.blocksSegment(side(2), side(-2))).toBe(false);
    }
    expect(doors.getSolids()).toHaveLength(0);
  });

  it('builds the widened room through the production shell and probes its actual triangles', () => {
    const rendered = renderedFixture(), { root, fixture } = rendered;
    try {
      expect(fixture.spec.chambers.map(chamber => chamber.radius)).toEqual([13, 12, 12, 12]);
      expect(fixture.getState().ready).toBe(true);
      expect(fixture.getState().textured).toBe(true);
      expect(fixture.getViews()).toEqual([]);
      for (const pack of population().packs) for (const [x, z] of pack.anchors) {
        const probe = fixture.probe(x, z);
        expect(probe, `${pack.id} ${x},${z} production floor`).toBeTruthy();
        // The continuous production field and its finite triangulation differ slightly on ramps.
        expect(Math.abs(probe!.floorY - probe!.sampledFloorY)).toBeLessThan(.05);
        expect(probe!.headroom).toBeGreaterThan(8);
      }
    } finally { rendered.dispose(); }
    expect(root.children).toHaveLength(0);
    expect(fixture.getState().ready).toBe(false);
  });

  it('connects both real sloped thresholds through Recast when opened and blocks their live routes when closed', async () => {
    await Navigation.initLibrary();
    const rendered = renderedFixture(), { fixture } = rendered, actors = population();
    const entities = new Map(actors.entities.map(entity => [entity.id, entity]));
    const doors = new DungeonDoors(actors.thresholds.map(threshold => threshold.barrier), id => entities.get(id));
    const nav = new Navigation(), carves = solidObstacleMeshes(actors.solids);
    try {
      // Use the actual receiving-floor triangles, roof, cavern walls and threshold carves.
      // Lintel undersides must retain their authored height instead of a grounded 1.5 m skirt.
      expect(nav.build([...fixture.walkable, ...dungeonNavigationBlockers(fixture.blockers), ...carves], 'solo')).toBe(true);
      nav.setRouteGraph(actors.routeNodes, actors.routeEdges);
      nav.setPathConstraint(path => doors.clipPath(path));
      const originalPolygons = nav.getDiagnostics().polyCount;
      for (const [index, threshold] of actors.thresholds.entries()) {
        const from = actors.routeNodes[index + 1]!, to = actors.routeNodes[index + 2]!;
        const entity = entities.get(threshold.id)!;
        entity.state = 'closed';
        const closed = nav.findPathDetailed(from.position, to.position);
        expect(closed, `${threshold.id} approach route exists`).not.toBeNull();
        expect(closed!.partial, `${threshold.id} closed route stops at leaf`).toBe(true);
        expect(nav.planRoute(from.id, to.id, 1), `${threshold.id} closed graph edge`).toBeNull();
        entity.state = 'open';
        const opened = nav.findPathDetailed(from.position, to.position);
        expect(opened, `${threshold.id} opened route exists`).not.toBeNull();
        expect(opened!.partial, `${threshold.id} authored lintel allows full headroom`).toBe(false);
        expect(opened!.arrivalGap).toBeLessThan(.5);
        expect(nav.planRoute(from.id, to.id, 1), `${threshold.id} opened graph edge`).not.toBeNull();
        expect(nav.findPathDetailed(to.position, from.position)!.partial, `${threshold.id} opened reverse route`).toBe(false);
      }
      expect(nav.findPathDetailed(actors.routeNodes[0]!.position, actors.routeNodes[3]!.position)!.partial).toBe(false);
      for (const threshold of actors.thresholds) entities.get(threshold.id)!.state = 'closed';
      expect(nav.planRoute(actors.routeNodes[0]!.id, actors.routeNodes[3]!.id, 1)).toBeNull();
      expect(nav.getDiagnostics().polyCount).toBe(originalPolygons);
    } finally {
      rendered.dispose();
      for (const carve of carves) {
        carve.geometry.dispose();
        for (const material of Array.isArray(carve.material) ? carve.material : [carve.material]) material.dispose();
      }
    }
  });
});
