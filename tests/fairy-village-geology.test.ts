import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Vec3 } from '../game/src/contracts.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { resolveFairyDressing } from '../game/src/app/fairyDressing.js';
import { WorldScene } from '../game/src/render/scene.js';
import { Solids } from '../game/src/systems/solids.js';
import { sampleFairyBankHeight } from '../game/src/world/fairyBankHeightmaps.js';
import {
  FAIRY_VILLAGE_CRAGS, sampleFairyVillageBank, sampleFairyVillageSurface, sampleFairyVillageUnderlay,
  sampleFairyVillageEarth, sampleFairyVillageTerrain,
  fairyVillageCragBase,
} from '../game/src/world/fairyVillageGeology.js';

type HeightSampler = (x: number, z: number) => number;

/** The production PlaneGeometry splits each one-metre quad along h10--h01. */
function terrainTriangles(sample: HeightSampler): HeightSampler {
  const vertices = new Map<string, number>();
  const vertex = (x: number, z: number): number => {
    const key = `${x},${z}`;
    let height = vertices.get(key);
    if (height === undefined) { height = sample(x, z); vertices.set(key, height); }
    return height;
  };
  return (x, z) => {
    const column = Math.floor(x), row = Math.floor(z), tx = x - column, tz = z - row;
    const h00 = vertex(column, row), h10 = vertex(column + 1, row);
    const h01 = vertex(column, row + 1), h11 = vertex(column + 1, row + 1);
    return tx + tz <= 1
      ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
      : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };
}

/** Unique quarter-metre probes cover every current crag and its surrounding terrain cells. */
function villageProbes(): readonly (readonly [number, number])[] {
  const probes = new Map<string, readonly [number, number]>();
  for (const [, cx, cz] of FAIRY_VILLAGE_CRAGS) {
    for (let ix = Math.floor((cx - 6) * 4); ix <= Math.ceil((cx + 6) * 4); ix += 1) {
      for (let iz = Math.floor((cz - 6) * 4); iz <= Math.ceil((cz + 6) * 4); iz += 1) {
        probes.set(`${ix},${iz}`, [ix / 4, iz / 4]);
      }
    }
  }
  return [...probes.values()];
}

// The authored world evaluates each receiving bank separately, then takes the highest relief.
const bankIds = [...new Set(FAIRY_VILLAGE_CRAGS.map(([id]) => id))];
const authoredUnderlay: HeightSampler = (x, z) => Math.max(0,
  ...bankIds.map(id => sampleFairyVillageUnderlay(x, z, id)));
const authoredEarth: HeightSampler = (x, z) => Math.max(0,
  ...bankIds.map(id => sampleFairyVillageEarth(x, z, id)));
const authoredTerrain: HeightSampler = (x, z) => Math.max(0,
  ...bankIds.map(id => sampleFairyVillageTerrain(x, z, id)));

describe('fairy village native geology', () => {
  it('keeps one-metre terrain wedges behind the native footprint, with the old failure as a control', () => {
    const hiddenTerrain = terrainTriangles(authoredUnderlay);
    const connectedTerrain = terrainTriangles(authoredTerrain), earthTerrain = terrainTriangles(authoredEarth);
    const oldUnrecessedTerrain = terrainTriangles(sampleFairyVillageBank);
    let exteriorSamples = 0, worstProtrusion = 0, extraExteriorTerrain = 0, oldWedgeCount = 0, oldWorstWedge = 0;
    for (const [x, z] of villageProbes()) {
      if (sampleFairyVillageBank(x, z) > 0) continue;
      exteriorSamples += 1;
      worstProtrusion = Math.max(worstProtrusion, hiddenTerrain(x, z));
      extraExteriorTerrain = Math.max(extraExteriorTerrain, connectedTerrain(x, z) - earthTerrain(x, z));
      const oldWedge = oldUnrecessedTerrain(x, z);
      if (oldWedge > .1) oldWedgeCount += 1;
      oldWorstWedge = Math.max(oldWorstWedge, oldWedge);
    }
    expect(exteriorSamples).toBeGreaterThan(10_000);
    expect(worstProtrusion, 'hidden rock underlay outside every native footprint').toBeLessThanOrEqual(.1);
    expect(extraExteriorTerrain, 'exterior terrain must match the authored low earth shoulder').toBeLessThanOrEqual(.1);
    // This counterfactual confirms the probe set detects the chipped/floating-wall regression.
    expect(oldWedgeCount).toBeGreaterThan(100);
    expect(oldWorstWedge).toBeGreaterThan(.5);
  });

  it('plants on the translated native top instead of the hidden underlay on nonconstant ground', () => {
    const crag = FAIRY_VILLAGE_CRAGS.find(([id]) => id === 'lantern_south_bank')!;
    const [, cx, cz, scale, yaw, variant] = crag;
    const localX = 1.2, localZ = -.4, c = Math.cos(yaw), s = Math.sin(yaw);
    const x = cx + (localX * c + localZ * s) * scale;
    const z = cz + (-localX * s + localZ * c) * scale;
    const native = sampleFairyBankHeight(variant === 0 ? 'fairy_rounded_bank_0' : 'fairy_rounded_bank_1', localX, localZ);
    expect(native).not.toBeNull();
    const valley: HeightSampler = (px, pz) => 70 + .10 * (px - cx) - .05 * (pz - cz) + .005 * (px - cx) ** 2;
    const ground: HeightSampler = (px, pz) => valley(px, pz) + authoredTerrain(px, pz);
    const burial = .08;
    // Rendering seats the rigid body into its lowest supporting ground, then plants on the same transform.
    const base = fairyVillageCragBase(FAIRY_VILLAGE_CRAGS.indexOf(crag), ground);
    expect(base).toBeLessThan(valley(cx, cz));
    const expectedTop = base + (native! - burial) * scale;
    const surface = sampleFairyVillageSurface(x, z, ground);
    expect(surface).toBeCloseTo(expectedTop, 8);
    expect(surface - ground(x, z), 'plant would sink if placed on the recessed terrain').toBeGreaterThan(.1);
    expect(Math.abs(valley(x, z) - valley(cx, cz)), 'sloping-ground fixture must distinguish mesh-centre anchoring').toBeGreaterThan(.03);
    expect(Math.abs(surface - (valley(x, z) + (native! - burial) * scale))).toBeGreaterThan(.1);
    const translatedGround: HeightSampler = (px, pz) => ground(px, pz) - 183.25;
    expect(sampleFairyVillageSurface(x, z, translatedGround)).toBeCloseTo(surface - 183.25, 8);
    expect(sampleFairyVillageSurface(cx - 12, cz - 12, ground)).toBe(ground(cx - 12, cz - 12));
  });

  it('keeps every resolved road clear of actual village crag bodies at a 0.9 metre walking radius', () => {
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      const dressing = resolveFairyDressing(scene);
      const villageIds = new Set(dressing.points.filter(point => bankIds.some(id => id === point.landformId)).map(point => point.id));
      const volumes = dressing.solids.filter(volume => volume.id !== undefined && villageIds.has(volume.id));
      expect(volumes.length).toBe(FAIRY_VILLAGE_CRAGS.length);
      // This gate concerns authored village geology. Field crags, mobs and actor bodies are excluded.
      const solids = new Solids(volumes);
      const individual = volumes.map(volume => ({ volume, solids: new Solids([volume]) }));
      const collisions = new Map<string, { road: number; crag: string; sampleCount: number;
        maxPush: number; first: readonly [number, number]; roadFrom: readonly [number, number]; roadTo: readonly [number, number] }>();
      const roads = scene.getRoadPolylines();
      let samples = 0;
      for (const [roadIndex, road] of roads.entries()) for (let segment = 1; segment < road.length; segment += 1) {
        const a = road[segment - 1]!, b = road[segment]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / .2));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
          const point: Vec3 = [x, scene.meshHeightAt(x, z), z];
          samples += 1;
          const resolved = solids.resolve(point, point, .9);
          if (Math.hypot(resolved[0] - x, resolved[2] - z) <= 1e-6) continue;
          for (const { volume, solids: body } of individual) {
            const moved = body.resolve(point, point, .9);
            const push = Math.hypot(moved[0] - x, moved[2] - z);
            if (push <= 1e-6) continue;
            const key = `${roadIndex}:${volume.id!}`;
            const prior = collisions.get(key);
            if (prior) { prior.sampleCount += 1; prior.maxPush = Math.max(prior.maxPush, push); }
            else collisions.set(key, { road: roadIndex, crag: volume.id!, sampleCount: 1, maxPush: push,
              first: [Number(x.toFixed(3)), Number(z.toFixed(3))],
              roadFrom: [road[0]![0], road[0]![2]], roadTo: [road.at(-1)![0], road.at(-1)![2]] });
          }
        }
      }
      expect(samples).toBeGreaterThan(5_000);
      const failures = [...collisions.values()].map(record => ({ ...record, maxPush: Number(record.maxPush.toFixed(4)) }));
      expect(failures, `All village road/crag collisions: ${JSON.stringify(failures)}`).toEqual([]);
    } finally {
      scene.clear();
    }
  });

});
