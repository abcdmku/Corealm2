import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { WorldScene, curveRoadPolyline, type WorldTerrainSpec } from "../game/src/render/scene.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { NAV_CONFIG, PLAYER_SLOPES } from "../game/src/app/config.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { prepareWorldSurface } from "../game/src/app/worldSurface.js";
import { coastalSpawnSites } from "../game/src/app/coastalSpawns.js";

beforeAll(async () => Navigation.initLibrary());

describe("traversable ground", () => {
  it("keeps authored tracks below the climb limit and coastal creatures on dry biome terrain", () => {
    const scene = new WorldScene(new THREE.Scene());
    scene.buildWorld(buildWorldTerrainSpec(), (prepared) => prepareWorldSurface(prepared));
    let steepest = 0;
    for (const line of scene.getRoadPolylines()) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        for (let distance = 0; distance < length - 0.01; distance += 0.5) {
          const start = distance / length;
          const end = Math.min(distance + 0.5, length) / length;
          const height = (t: number) => scene.meshHeightAt(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t);
          const grade = Math.abs(height(end) - height(start)) / ((end - start) * length);
          steepest = Math.max(steepest, grade);
        }
      }
    }
    expect(steepest).toBeLessThan(Math.tan(PLAYER_SLOPES.maxAscentAngle * Math.PI / 180));
    expect(scene.getWaterBodies()).toHaveLength(5);
    expect(scene.getWaterBodies().every((body) => body.closed)).toBe(true);
    const sites = coastalSpawnSites(scene, 1337);
    expect(sites.length).toBeGreaterThan(100);
    expect(sites).toEqual(coastalSpawnSites(scene, 1337));
    for (const site of sites) {
      const sample = scene.sampleWorld(...site.spot);
      expect(sample.playable).toBe(true);
      expect(sample.coast!.outsideDistance).toBeGreaterThan(0);
      expect(sample.visualBiome).toBe(site.biomeId);
    }
    scene.clear();
  });
  it.each([40, 50, 58])("bakes a complete route up and down a %i degree slope", (angle) => {
    const geometry = new THREE.PlaneGeometry(20, 12, 20, 12);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position");
    const gradient = Math.tan(angle * Math.PI / 180);
    for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getX(i) * gradient);
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld(true);
    const nav = new Navigation();
    expect(nav.build([mesh], "solo", { cs: 0.45 })).toBe(true);
    for (const sign of [-1, 1]) {
      const route = nav.findPathDetailed([-6 * sign, -6 * gradient * sign, 0], [6 * sign, 6 * gradient * sign, 0]);
      expect(route).not.toBeNull();
      expect(route?.partial).toBe(false);
    }
    expect(PLAYER_SLOPES.maxAscentAngle).toBe(NAV_CONFIG.walkableSlopeAngle);
    geometry.dispose();
  });

  it("keeps a path in its graded lane when its decorative curve would cross a cliff", () => {
    const height = (x: number, z: number) => x * 0.3 + Math.max(0, Math.abs(z) - 2) * 6;
    const points: [number, number, number][] = [[0, 0, 0], [100, 30, 0]];
    const curved = curveRoadPolyline(points, 1337, height);
    expect(curved.every((point) => Math.abs(point[2]) <= 2)).toBe(true);
    expect(curved).toEqual(curveRoadPolyline(points, 1337, height));
  });

  it("shares dry coastal ground with navigation, picking, and physics while excluding the sea", () => {
    const spec: WorldTerrainSpec = {
      bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
      chunkSize: 16, metresPerQuad: 2, blendMetres: 0,
      regions: [{ regionId: "fallowmarch", rect: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
        seed: 1, character: "plains", baseHeight: 3, amplitude: 0 }],
      coast: { seed: 2, collar: 20, shoreline: [12, 16], seaLevel: -5, floorDepth: 3, gridStep: 2, oceanSize: 100 },
    };
    const scene = new WorldScene(new THREE.Scene());
    scene.buildWorld(spec);
    const coast = scene.getWalkableMeshes().find((mesh) => mesh.name === "coastal-ground")!;
    expect(coast).toBeDefined();
    expect(coast.parent).toBe(scene.terrainGroup);
    const positions = coast.geometry.getAttribute("position");
    for (const i of coast.geometry.index!.array) expect(positions.getY(i)).toBeGreaterThanOrEqual(-5);
    const nav = new Navigation();
    expect(nav.build(scene.getWalkableMeshes(), "solo")).toBe(true);
    const to: [number, number, number] = [14, scene.meshHeightAt(14, 0), 0];
    expect(scene.sampleWorld(14, 0).playable).toBe(true);
    expect(nav.findPathDetailed([0, 3, 0], to)?.partial).toBe(false);
    expect(scene.sampleWorld(28, 0).playable).toBe(false);
    const field = scene.heightfieldSamples();
    expect(field.scale.x).toBe(56);
    const col = (14 + 28) / 2;
    const row = 28 / 2;
    expect(field.heights[col * (field.nrows + 1) + row]).toBeCloseTo(to[1], 5);
    scene.clear();
  });
});
