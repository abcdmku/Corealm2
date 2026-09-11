import * as THREE from 'three';
import type { FeatureLabPreset, SemanticEntity, SolidVolume, Vec3 } from '../contracts.js';
import { REGIONS, type Spot } from '../content/regions.js';
import { LEGACY_CAVE_FLOOR_INTENTS, LEGACY_ENCOUNTER_PLACEMENTS, createLegacyEncounterFormation } from '../content/legacyEncounterPlacements.js';
import { addChamberLights, buildDungeon, dungeonFloorHeight, dungeonSolids, type DungeonSpec, type CaveRockSource } from '../render/dungeon.js';
import { authoredThresholds, createDungeonDoorEntities } from '../world/dungeonDoors.js';
import { createFeatureLabEntity } from './catalog.js';
import type { CaveLabFixture, CaveLabFixtureDeps, CaveLabFixtureState, CaveLabProbe } from './cave.js';
import type { DungeonDoorFixture } from './dungeonDoors.js';

const dungeon = REGIONS.flatMap(region => region.dungeon ? [region.dungeon] : []).find(def => def.id === 'gravelmaw')!;
if (!dungeon) throw new Error('Dense cave fixture requires the production Gravelmaw definition');

/** A fixed underground datum keeps the receiving-floor experiment independent of surface edits. */
export const DENSE_CAVE_FLOOR_BASE = 0;
export const DENSE_CAVE_SPEC: DungeonSpec = {
  regionId: 'gravelmaw', wallHeight: 13,
  chambers: dungeon.chambers.map(chamber => ({ ...chamber,
    centre: [...chamber.centre], floorY: DENSE_CAVE_FLOOR_BASE + chamber.floorOffset,
    radius: LEGACY_CAVE_FLOOR_INTENTS.find(intent => intent.id === chamber.id)?.radius ?? chamber.radius,
  })),
  corridors: dungeon.chambers.slice(1).map((chamber, index) => ({
    from: [...dungeon.chambers[index]!.centre], to: [...chamber.centre],
    fromY: DENSE_CAVE_FLOOR_BASE + dungeon.chambers[index]!.floorOffset,
    toY: DENSE_CAVE_FLOOR_BASE + chamber.floorOffset, width: 6,
  })),
};

export interface DenseCavePack {
  id: string;
  assetId: string;
  bodyRadius: number;
  entityIds: string[];
  anchors: Spot[];
}
export interface DenseCavePopulation extends DungeonDoorFixture {
  packs: DenseCavePack[];
  spawn: Vec3;
}

/** Conservative whole-body clearance inside the authored floor discs and connecting corridors. */
export function denseCaveFloorContains(point: Spot, radius = 0, spec = DENSE_CAVE_SPEC): boolean {
  const inside = (x: number, z: number): boolean => spec.chambers.some(chamber =>
    Math.hypot(x - chamber.centre[0], z - chamber.centre[1]) <= chamber.radius + 1e-6)
    || spec.corridors.some(corridor => {
      const dx = corridor.to[0] - corridor.from[0], dz = corridor.to[1] - corridor.from[1];
      const t = THREE.MathUtils.clamp(((x - corridor.from[0]) * dx + (z - corridor.from[1]) * dz) / (dx * dx + dz * dz), 0, 1);
      return Math.hypot(x - corridor.from[0] - dx * t, z - corridor.from[1] - dz * t) <= corridor.width / 2 + 1e-6;
    });
  if (!inside(...point)) return false;
  for (let i = 0; i < 48; i++) if (!inside(point[0] + Math.cos(i * Math.PI / 24) * radius,
    point[1] + Math.sin(i * Math.PI / 24) * radius)) return false;
  return true;
}

function clearPartition(point: Spot, radius: number, solid: SolidVolume): boolean {
  if (solid.kind !== 'box') return true;
  const floorY = dungeonFloorHeight(DENSE_CAVE_SPEC, ...point);
  if (solid.position[1] > floorY + 3.5 || solid.position[1] + solid.size[1] < floorY) return true;
  const dx = point[0] - solid.position[0], dz = point[1] - solid.position[2];
  const cos = Math.cos(solid.rotationY ?? 0), sin = Math.sin(solid.rotationY ?? 0);
  const x = Math.max(0, Math.abs(dx * cos - dz * sin) - solid.size[0] / 2);
  const z = Math.max(0, Math.abs(dx * sin + dz * cos) - solid.size[2] / 2);
  return Math.hypot(x, z) >= radius + .05;
}

/** The exact six legacy packs, their final body radii, native doors and continuous floor sampler. */
export function assembleDenseCavePopulation(
  baseY: (assetId: string) => number,
  assetSize: (assetId: string) => { x: number; y: number; z: number } | null,
): DenseCavePopulation {
  const fixtureDungeon = { ...dungeon, chambers: dungeon.chambers.map(chamber => ({ ...chamber,
    radius: DENSE_CAVE_SPEC.chambers.find(candidate => candidate.id === chamber.id)!.radius,
  })) };
  const thresholds = authoredThresholds(fixtureDungeon, DENSE_CAVE_FLOOR_BASE);
  const solids = thresholds.flatMap(threshold => [...threshold.staticSolids]);
  const entities: SemanticEntity[] = thresholds.flatMap(threshold => {
    const door = dungeon.doors.find(candidate => candidate.id === threshold.id)!;
    return createDungeonDoorEntities(threshold, { regionId: 'gravelmaw', tier: dungeon.tier,
      name: door.name, state: door.state, lockedReason: door.lockedReason });
  });
  const occupied: { position: Spot; bodyRadius: number }[] = [], packs: DenseCavePack[] = [];
  for (const layout of LEGACY_ENCOUNTER_PLACEMENTS.filter(row => row.regionId === 'gravelmaw')) {
    const group = dungeon.enemyGroups.find(candidate => candidate.id === layout.id);
    if (!group) throw new Error(`Dense cave pack missing from production: ${layout.id}`);
    const preset: FeatureLabPreset = { id: `gravelmaw:${group.id}`, kind: 'creature', label: group.name, tier: group.tier };
    const make = (id: string, position: Spot) => createFeatureLabEntity(preset, {
      entityId: id, groundPosition: [position[0], dungeonFloorHeight(DENSE_CAVE_SPEC, ...position), position[1]], baseY, assetSize,
    });
    const measured = make(`lab:dense-cave:${group.id}:measure`, layout.centre).combat?.bodyRadius;
    if (!measured || !Number.isFinite(measured)) throw new Error(`Dense cave needs measured production bounds for ${group.assetId}`);
    const formation = createLegacyEncounterFormation(group, { bodyRadius: measured, occupied,
      accepts: (point, radius) => denseCaveFloorContains(point, radius)
        && solids.every(solid => clearPartition(point, radius, solid)) });
    if (!formation) throw new Error(`Dense cave has no formation for ${group.id}`);
    const actorIds = formation.actorIds.map(id => `lab:dense-cave:${id}`);
    formation.anchors.forEach((anchor, index) => {
      const entity = make(actorIds[index]!, anchor);
      entity.meta = { ...entity.meta, featureLab: true, denseCave: true };
      entities.push(entity); occupied.push({ position: anchor, bodyRadius: measured });
    });
    packs.push({ id: group.id, assetId: group.assetId, bodyRadius: measured, entityIds: actorIds,
      anchors: formation.anchors.map(anchor => [...anchor]) });
  }
  const routeNodes = DENSE_CAVE_SPEC.chambers.map(chamber => ({ id: `lab:dense-cave:${chamber.id}`,
    name: chamber.name, regionId: 'gravelmaw' as const,
    position: [chamber.centre[0], dungeonFloorHeight(DENSE_CAVE_SPEC, ...chamber.centre), chamber.centre[1]] as Vec3,
  }));
  const routeEdges = routeNodes.slice(1).flatMap((to, index) => {
    const from = routeNodes[index]!, cost = Math.hypot(from.position[0] - to.position[0], from.position[2] - to.position[2]) / 4.2;
    return [{ from: from.id, to: to.id, cost, kind: 'walk' as const }, { from: to.id, to: from.id, cost, kind: 'walk' as const }];
  });
  const spawn: Vec3 = [43, dungeonFloorHeight(DENSE_CAVE_SPEC, 43, -32), -32];
  return { entities, solids, thresholds, routeNodes, routeEdges, enclosure: [], packs, spawn };
}

/** Production render/physics shell. Camera proof is obtained only by walking and player-follow orbit. */
export function createDenseCaveLabFixture({ scene, surfaceTextures, rockSource, rockEnvelope }: CaveLabFixtureDeps): CaveLabFixture {
  const spec = structuredClone(DENSE_CAVE_SPEC);
  const built = buildDungeon(spec, scene.materials, { surfaceTextures, rockSource, rockEnvelope });
  const group = built.group; group.name = 'feature-lab-dense-cave';
  const lights = addChamberLights(spec, group);
  const meshes = [...built.walkable, ...built.blockers];
  const geometries = new Set(meshes.map(mesh => mesh.geometry));
  const materials = new Set(meshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  const bounds = new THREE.Box3().setFromObject(group), ray = new THREE.Raycaster();
  const floor = built.walkable[0]!, ceiling = built.blockers.find(mesh => mesh.name === 'dungeon-ceiling')!;
  let disposed = false;
  function probe(x: number, z: number): CaveLabProbe | null {
    if (disposed) return null;
    if (![x, z].every(Number.isFinite)) throw new Error('Dense cave probe must be finite');
    group.updateWorldMatrix(true, true);
    ray.set(new THREE.Vector3(x, bounds.max.y + 1, z), new THREE.Vector3(0, -1, 0));
    const down = ray.intersectObject(floor, false)[0];
    if (!down?.uv) return null;
    ray.set(new THREE.Vector3(x, down.point.y + .05, z), new THREE.Vector3(0, 1, 0));
    const up = ray.intersectObjects(rockSource ? built.blockers : [ceiling], false)[0];
    if (!up?.uv) return null;
    return { x, z, floorY: down.point.y, ceilingY: up.point.y, headroom: up.point.y - down.point.y,
      floorUv: down.uv.toArray(), ceilingUv: up.uv.toArray(), sampledFloorY: dungeonFloorHeight(spec, x, z) };
  }
  scene.root.add(group);
  return {
    built, group, spec, walkable: built.walkable, blockers: built.blockers,
    solids: dungeonSolids(spec, { rockSource }), navigationSolids: dungeonSolids(spec, { rockSource, includeCeilings: false }),
    facingAttached(source: CaveRockSource) {
      rockSource = source;
      for (const mesh of built.blockers) {
        if (!meshes.includes(mesh)) meshes.push(mesh);
        geometries.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      }
      bounds.setFromObject(group);
    },
    getViews: () => [],
    getBounds: () => disposed ? null : { min: bounds.min.toArray() as Vec3, max: bounds.max.toArray() as Vec3 },
    getState: (): CaveLabFixtureState => ({
      ready: !disposed, visible: !disposed && group.visible && group.parent !== null,
      origin: [40, DENSE_CAVE_FLOOR_BASE - 23.2, -40], triangles: built.triangles,
      meshCount: meshes.length, materialCount: materials.size,
      textured: [...materials].every(material => {
        const standard = material as THREE.MeshStandardMaterial;
        return !!standard.map && !!standard.normalMap && !!standard.roughnessMap;
      }), stoneTileMetres: surfaceTextures.stone.tileMetres, views: [],
      sourceFacing: rockSource ? (group.getObjectByName('dungeon-rock-facing') as THREE.Mesh)?.geometry.userData as CaveLabFixtureState['sourceFacing'] : null,
      probes: { upper: probe(40, -40), join: probe(35, -49), lower: probe(22, -76) },
    }),
    probe,
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const light of lights) { light.dispose(); light.removeFromParent(); }
    },
  };
}
