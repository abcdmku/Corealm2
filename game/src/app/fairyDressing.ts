import { FAIRY_VILLAGE_CRAGS, fairyVillageCragBase, sampleFairyVillageSurface } from '../world/fairyVillageGeology.js';
import { buildFairyCorridorDressing } from '../world/fairyCorridorDressing.js';
import { buildFairyCorridorCanopy } from '../world/fairyCorridorCanopy.js';
import { buildFairyGardenGroves } from '../world/fairyGardenGroves.js';
import type { SolidVolume } from '../contracts.js';
import type { WorldScene } from '../render/scene.js';
import { buildFairyLandformDressing, fairyDressingBodyRadius, FAIRY_ROCK_NATIVE_BOUNDS } from '../world/fairyLandformDressing.js';
import { DEFAULT_SCATTER, type RegionScatterSpec } from '../world/scatter.js';
import { FAIRY_REGIONS } from '../content/fairyRegions.js';
import { FAIRY_VILLAGE_BANKS } from '../world/fairyLandforms.js';
import { seedFromText } from '../world/organicFields.js';
import { Rng } from '../core/rng.js';

/** Stable grove trunks on the receiving banks; roofs and the inward door lanes stay clear. */
const VILLAGE_TREES = {
  gloamgarden: [[2061, -102], [2068, -77], [2095, -77], [2098, -96],
    [2097, -132], [2059, -130], [2081, -87], [2079, -122], [2073.5, -107.9],
    [2058, -88], [2106, -84], [2080, -70], [2061, -114], [2114, -116],
    [2052, -76], [2064, -66], [2091.5, -60], [2116, -92], [2117, -77], [2085.2, -110.6]],
  faeholme: [[2285, 145], [2314, 151], [2301, 166], [2316, 133],
    [2292, 154], [2325, 162], [2284, 130]],
} as const;

function distanceToRoad(x: number, z: number, roads: readonly (readonly (readonly number[])[])[]): number {
  let distance = Infinity;
  for (const line of roads) for (let i = 1; i < line.length; i++) {
    const from = line[i - 1]!, to = line[i]!, dx = to[0]! - from[0]!, dz = to[2]! - from[2]!;
    const t = Math.max(0, Math.min(1, ((x - from[0]!) * dx + (z - from[2]!) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - from[0]! - dx * t, z - from[2]! - dz * t));
  }
  return distance;
}

function insideBuilding(x: number, z: number, margin: number): boolean {
  return FAIRY_REGIONS.some(region => region.settlement?.buildings.some(building => {
    const dx = x - building.position[0], dz = z - building.position[1], c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
    return Math.abs(dx * c - dz * s) < building.footprint[0] / 2 + margin
      && Math.abs(dx * s + dz * c) < building.footprint[1] / 2 + margin;
  }));
}

/** Native geology and its collision share the final terrain sample and exact instance transform. */
export function resolveFairyDressing(scene: WorldScene) {
  const ground = (x: number, z: number) => scene.meshHeightAt(x, z);
  const roads = scene.getRoadPolylines();
  const plantingOffset = (x: number, z: number) => sampleFairyVillageSurface(x, z, ground) - ground(x, z);
  const dressingRoads = roads.map(line => ({
    points: line.map(point => [point[0], point[2]] as const), halfWidth: 1.6, allowSway: false,
  }));
  const fieldPoints = [...buildFairyLandformDressing(ground, dressingRoads), ...buildFairyCorridorDressing(ground, dressingRoads)]
    .filter(point => VILLAGE_TREES[point.regionId].every(tree =>
    Math.hypot(point.position[0] - tree[0], point.position[1] - tree[1]) > fairyDressingBodyRadius(point) + 1));
  // These crags are embedded in the authored banks. Their common base is the valley
  // beneath the receiving bank, rather than the top of the hill under the mesh origin.
  const crags = FAIRY_VILLAGE_CRAGS.map(([bankId, x, z, scale, rotationY, variant], index) => {
    const bank = FAIRY_VILLAGE_BANKS.find(bank => bank.id === bankId)!;
    const valley = fairyVillageCragBase(index, ground);
    return { id: `${bankId}_crag_${index}`, landformId: bankId, regionId: bank.regionId,
      assetId: variant === 0 ? 'fairy_rounded_bank_0' as const : 'fairy_rounded_bank_1' as const,
      position: [x, z] as const, rotationY, scale, sink: .08 * scale,
      heightOffset: valley - ground(x, z) };
  });
  const points = [...fieldPoints, ...crags];
  const corridorCanopy = buildFairyCorridorCanopy(ground, dressingRoads, points);
  const gardenGroves = buildFairyGardenGroves(ground, dressingRoads, points,
    [...corridorCanopy, ...Object.values(VILLAGE_TREES).flat().map(position => ({ position }))]);
  const solids: SolidVolume[] = points.map(point => {
    const bounds = FAIRY_ROCK_NATIVE_BOUNDS[point.assetId];
    return { kind: 'box', id: point.id,
      position: [point.position[0], ground(...point.position) + point.heightOffset - point.sink, point.position[1]],
      size: [bounds[0] * point.scale, bounds[1] * point.scale, bounds[2] * point.scale],
      rotationY: point.rotationY };
  });
  const specs = { ...DEFAULT_SCATTER };
  for (const regionId of ['gloamgarden', 'faeholme'] as const) {
    const spec: RegionScatterSpec = DEFAULT_SCATTER[regionId];
    const grove = VILLAGE_TREES[regionId].map((position, index) => {
      const hero = (regionId === 'gloamgarden' ? [0, 1, 2, 3, 6, 8, 9, 10, 11, 15, 16, 19] : [0, 1, 2, 4, 5]).includes(index);
      const palette = regionId === 'gloamgarden' ? 'gloam' : 'fae';
      return { id: `${regionId}_village_tree_${index + 1}`,
        assetId: hero ? `fairy_hero_${palette}_sheltered` : `fairy_canopy_${palette}_${index % 2 + 1}`,
        position, rotationY: index * 2.4,
        scale: hero ? (regionId === 'gloamgarden' && [6, 8, 19].includes(index) ? 1 : .82) : 1.05 + (index % 3) * .13,
        sink: 0, heightOffset: plantingOffset(position[0], position[1]),
      };
    });
    const gardens = crags.filter(crag => crag.regionId === regionId).flatMap(crag => {
      const rng = new Rng(seedFromText(`${crag.id}:garden`));
      const accepted: { id: string; assetId: string; position: readonly [number, number]; rotationY: number;
        scale: number; sink: number; heightOffset: number }[] = [];
      const spread = fairyDressingBodyRadius(crag) + 1.2;
      for (let index = 0; index < 160; index++) {
        const angle = rng.float(0, Math.PI * 2), radius = Math.sqrt(rng.float(.12, 1)) * spread;
        const x = crag.position[0] + Math.cos(angle) * radius, z = crag.position[1] + Math.sin(angle) * radius;
        if (roads.some(line => line.slice(1).some((to, index) => {
          const from = line[index]!, dx = to[0] - from[0], dz = to[2] - from[2];
          const t = Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[2]) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
          return Math.hypot(x - from[0] - dx * t, z - from[2] - dz * t) < 2.2;
        }))) continue;
        if (FAIRY_REGIONS.some(region => region.settlement?.buildings.some(building => {
          const dx = x - building.position[0], dz = z - building.position[1], c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
          return Math.abs(dx * c - dz * s) < building.footprint[0] / 2 + .15
            && Math.abs(dx * s + dz * c) < building.footprint[1] / 2 + .15;
        }))) continue;
        if (accepted.some(plant => Math.hypot(x - plant.position[0], z - plant.position[1]) < .64)) continue;
        const assetId = index % 7 === 0 ? 'corealm_flower_1' : index % 3 === 0 ? 'corealm_fern_gloam_1' : index % 5 === 0 ? 'corealm_shrub_1' : 'corealm_fern_1';
        accepted.push({ id: `${crag.id}_garden_${index}`, assetId, position: [x, z], rotationY: angle,
          scale: assetId === 'corealm_flower_1' ? .8 : assetId === 'corealm_fern_gloam_1' ? rng.float(.5, .85) : rng.float(.65, 1.05), sink: .06, heightOffset: plantingOffset(x, z) });
      }
      return accepted;
    });
    const bounds = regionId === 'gloamgarden' ? [2050, 2115, -135, -66] : [2274, 2333, 125, 174];
    const meadow = [];
    const rng = new Rng(seedFromText(`${regionId}:village-meadow`));
    for (let x = bounds[0]!; x < bounds[1]!; x += .65) for (let z = bounds[2]!; z < bounds[3]!; z += .65) {
      const px = x + rng.float(-.24, .24), pz = z + rng.float(-.24, .24);
      const edge = Math.min(px - bounds[0]!, bounds[1]! - px, pz - bounds[2]!, bounds[3]! - pz);
      if (rng.next() > Math.min(1, Math.max(0, edge) / 5)) continue;
      if (insideBuilding(px, pz, .15)) continue;
      const laneDistance = distanceToRoad(px, pz, roads);
      if (laneDistance < 1.05) continue;
      const bank = FAIRY_VILLAGE_BANKS.find(bank => bank.regionId === regionId
        && Math.hypot(px - bank.centre[0], pz - bank.centre[1]) < bank.radius + 2);
      if (rng.next() > (bank ? .65 : .18)) continue;
      const leaf = `fairy_groundcover_${regionId === 'gloamgarden' ? 'gloam' : 'fae'}_${rng.next() < .55 ? 1 : 2}`;
      const assetId = bank && laneDistance > 2 && rng.next() < .08 ? leaf
        : `fairy_finegrass_${regionId === 'gloamgarden' ? 'gloam' : 'fae'}_${rng.next() < .55 ? 1 : 2}`;
      meadow.push({ id: `${regionId}_meadow_${meadow.length}`, assetId,
        position: [px, pz] as const, rotationY: rng.float(0, Math.PI * 2),
        scale: assetId.startsWith('fairy_groundcover_') ? rng.float(.28, .46) : rng.float(.55, .85),
        sink: .012, heightOffset: plantingOffset(px, pz) });
    }
    specs[regionId] = { ...spec, layers: [...spec.layers.map(layer => layer.id === 'fairy_canopy'
      ? { ...layer, authoredPoints: [...grove, ...corridorCanopy.filter(tree => tree.regionId === regionId),
        ...gardenGroves.filter(tree => tree.regionId === regionId)] } : layer), {
      id: 'fitted-boulders', assetIds: Object.keys(FAIRY_ROCK_NATIVE_BOUNDS),
      authoredPoints: points.filter(point => point.regionId === regionId),
      maxCount: 0, scale: [1, 1], castShadow: true,
    }, {
      id: 'bank-gardens', assetIds: ['corealm_fern_gloam_1', 'corealm_fern_1', 'corealm_shrub_1', 'corealm_flower_1'],
      authoredPoints: gardens, maxCount: 0, scale: [1, 1], castShadow: false,
    }, {
      id: 'village-meadow', assetIds: [`fairy_finegrass_${regionId === 'gloamgarden' ? 'gloam' : 'fae'}_1`, `fairy_finegrass_${regionId === 'gloamgarden' ? 'gloam' : 'fae'}_2`, `fairy_groundcover_${regionId === 'gloamgarden' ? 'gloam' : 'fae'}_1`, `fairy_groundcover_${regionId === 'gloamgarden' ? 'gloam' : 'fae'}_2`, 'corealm_fern_1'],
      authoredPoints: meadow, maxCount: 0, scale: [1, 1], castShadow: false,
    }] };
  }
  return { points, solids, specs };
}
