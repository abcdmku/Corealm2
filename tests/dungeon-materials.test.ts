import { createHash } from "node:crypto";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDungeon, chamberFloorAt, dungeonFloorHeight, dungeonSolids,
  type BuiltDungeon, type DungeonOptions, type DungeonSpec,
} from "../game/src/render/dungeon.js";
import type { CorealmSurfaceTextures } from "../game/src/render/corealmSurfaceMaterials.js";
import { MaterialLibrary } from "../game/src/render/materials.js";

// Independent of authored world depths: overlapping chambers exercise the sloped floor,
// missing wall arcs, irregular wall lean and a terrain-limited ceiling in one compact fixture.
const SPEC: DungeonSpec = {
  regionId: "gravelmaw",
  chambers: [
    { id: "test-upper", name: "Upper", centre: [2, -3], radius: 4.25, floorY: -7, lit: true },
    { id: "test-lower", name: "Lower", centre: [9, 0.5], radius: 4.75, floorY: -9.5, lit: false },
  ],
  corridors: [{ from: [2, -3], to: [9, 0.5], fromY: -7, toY: -9.5, width: 3.2 }],
  wallHeight: 9.3,
};
const ceilingAt = (x: number, z: number): number => -1.5 + 0.08 * x - 0.06 * z;
const CASES = [
  { name: "plain", options: {} },
  { name: "capped", options: { ceilingAt } },
] as const;

// Captured before material/UV restoration and retained through the later shell repair.
// The walkable floor is immutable; wall and roof geometry now have enclosure invariants.
const FLOOR_BASELINE = {
  name: "dungeon-floor", count: 304,
  position: "21ce21f552da024856fba768353748a778d939f3a23362cc245438d904da50ac",
  normal: "28f3ad318088e0f78be6512707f3ad79ebe36fd150b57bba351e863eaddc5b78",
  color: "171acd93b5ac51d096a10bbc5cdf577b658e99ba3da4ae9bba886afe1919a267",
  index: "91aa6a2cd055e1b59946c3c037f30ee6a561981e3f0338cc71b15f9ba311735c",
};
const builtDungeons: BuiltDungeon[] = [];
const ownedTextures: THREE.Texture[] = [];

function build(options?: DungeonOptions): BuiltDungeon {
  const built = buildDungeon(SPEC, new MaterialLibrary(), options);
  builtDungeons.push(built);
  return built;
}

function meshes(built: BuiltDungeon): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] {
  return built.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
}

function meshNamed(built: BuiltDungeon, name: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  return meshes(built).find(mesh => mesh.name === name)!;
}

function hash(array: ArrayBufferView | null): string | null {
  return array === null ? null : createHash("sha256")
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest("hex");
}

function meshSnapshot(built: BuiltDungeon) {
  return meshes(built).map(({ name, geometry }) => ({
    name, count: geometry.getAttribute("position").count,
    position: hash(geometry.getAttribute("position").array),
    normal: hash(geometry.getAttribute("normal").array),
    color: hash(geometry.getAttribute("color").array),
    index: hash(geometry.index?.array ?? null),
  }));
}

function surfaceTextures(): CorealmSurfaceTextures {
  function map(r: number, g: number, b: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
    const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(1 / 2.5);
    texture.needsUpdate = true;
    ownedTextures.push(texture);
    return texture;
  }
  function family(): CorealmSurfaceTextures["stone"] {
    return {
      albedo: map(130, 118, 102, THREE.SRGBColorSpace),
      normal: map(128, 128, 255, THREE.NoColorSpace),
      roughness: map(211, 211, 211, THREE.NoColorSpace),
      meanLinearRgb: [0.22, 0.18, 0.13], tileMetres: 2.5,
    };
  }
  return { bark: family(), stone: family(), leaf: family() };
}

afterEach(() => {
  for (const built of builtDungeons.splice(0)) {
    const materials = new Set<THREE.Material>();
    for (const mesh of meshes(built)) {
      mesh.geometry.dispose();
      materials.add(mesh.material);
    }
    for (const material of materials) material.dispose();
  }
  for (const texture of ownedTextures.splice(0)) texture.dispose();
});

describe("dungeon material restoration", () => {
  it.each(CASES)("preserves the original floor and keeps textures independent of shell geometry and collision ($name)", ({ options }) => {
    const textures = surfaceTextures();
    const plain = build(options);
    for (const surfaceOptions of [options, { ...options, surfaceTextures: textures }]) {
      const built = build(surfaceOptions);
      expect(meshSnapshot(built).find(mesh => mesh.name === "dungeon-floor")).toEqual(FLOOR_BASELINE);
      expect(meshSnapshot(built)).toEqual(meshSnapshot(plain));
      expect(built.triangles).toBe(meshes(built).reduce((sum, mesh) =>
        sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3, 0));
      const solids = dungeonSolids(SPEC, surfaceOptions);
      expect(solids).toEqual(dungeonSolids(SPEC, options));
      expect(solids.length).toBeGreaterThan(2);
    }
    expect(dungeonSolids(SPEC, { ...options, surfaceTextures: textures, includeCeilings: false }))
      .toEqual(dungeonSolids(SPEC, { ...options, includeCeilings: false }));
  });

  it("retains floor sampling, chamber membership and raycast heights with shared textures", () => {
    const plain = build({ ceilingAt });
    const textured = build({ ceilingAt, surfaceTextures: surfaceTextures() });
    const samples = [
      { x: 2, z: -3, floor: -7.000260711557142, inside: true },
      { x: 9, z: 0.5, floor: -9.499739288442859, inside: true },
      { x: 5.5, z: -1.25, floor: -8.25, inside: true },
      { x: -1, z: -3, floor: -7.055595865554896, inside: true },
      { x: 30, z: 30, floor: -8.576528359863037, inside: false },
    ];
    for (const sample of samples) {
      expect(dungeonFloorHeight(SPEC, sample.x, sample.z)).toBeCloseTo(sample.floor, 12);
      expect(chamberFloorAt(SPEC, [sample.x, 999, sample.z])).toBe(sample.inside ? sample.floor : null);
      if (!sample.inside) continue;
      for (const name of ["dungeon-floor", "dungeon-ceiling"]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(sample.x, sample.floor + 2, sample.z),
          new THREE.Vector3(0, name === "dungeon-floor" ? -1 : 1, 0));
        const before = ray.intersectObject(meshNamed(plain, name))[0];
        const after = ray.intersectObject(meshNamed(textured, name))[0];
        expect(before, `${name} at ${sample.x},${sample.z}`).toBeDefined();
        expect(after?.point.toArray()).toEqual(before!.point.toArray());
        expect(after?.face?.normal.toArray()).toEqual(before!.face!.normal.toArray());
      }
    }
  });

  it("uses the shared stone maps without changing the two-material cave palette or mesh roles", () => {
    const textures = surfaceTextures();
    const built = build({ ceilingAt, surfaceTextures: textures });
    const floor = meshNamed(built, "dungeon-floor");
    const wall = meshNamed(built, "dungeon-wall");
    const ceiling = meshNamed(built, "dungeon-ceiling");
    expect(meshes(built)).toHaveLength(3);
    expect(built.walkable).toEqual([floor]);
    expect(built.blockers).toEqual([ceiling, wall]);
    expect(new Set(meshes(built).map(mesh => mesh.material)).size).toBe(2);
    expect(ceiling.material).toBe(wall.material);
    expect(floor.material.name).toBe("dungeon-floor");
    expect(wall.material.name).toBe("dungeon-rock");
    expect(floor.material.roughness).toBe(0.97);
    expect(wall.material.roughness).toBe(0.95);
    for (const material of [floor.material, wall.material]) {
      expect(material.map).toBe(textures.stone.albedo);
      expect(material.normalMap).toBe(textures.stone.normal);
      expect(material.roughnessMap).toBe(textures.stone.roughness);
      expect(material.envMapIntensity).toBe(0.12);
      expect(material.vertexColors).toBe(true);
      expect(material.flatShading).toBe(false);
      expect(material.metalness).toBe(0);
      expect(material.color.getHex()).toBe(0xffffff);
    }
    // The original floor is warm; the original walls/ceiling retain their cooler rock tint.
    // The floor hash also protects its per-vertex contact darkening.
    const color = floor.geometry.getAttribute("color");
    for (let i = 0; i < color.count; i++) {
      expect(color.getX(i)).toBeGreaterThan(color.getY(i));
      expect(color.getY(i)).toBeGreaterThan(color.getZ(i));
    }
    for (const texture of [textures.stone.albedo, textures.stone.normal, textures.stone.roughness]) {
      expect(texture.repeat.toArray()).toEqual([0.4, 0.4]);
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    }
  });

  it("keeps the optional-texture fallback untextured", () => {
    const built = build();
    expect(meshes(built)).toHaveLength(3);
    expect(new Set(meshes(built).map(mesh => mesh.material)).size).toBe(2);
    for (const mesh of meshes(built)) {
      expect(mesh.material.map).toBeNull();
      expect(mesh.material.normalMap).toBeNull();
      expect(mesh.material.roughnessMap).toBeNull();
    }
    expect(meshNamed(built, "dungeon-wall").material.flatShading).toBe(false);
  });

  it.each(CASES)("projects floor and ceiling UVs in world X/Z metres ($name)", ({ options }) => {
    const built = build({ ...options, surfaceTextures: surfaceTextures() });
    for (const name of ["dungeon-floor", "dungeon-ceiling"]) {
      const geometry = meshNamed(built, name).geometry;
      const position = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      if (name === "dungeon-floor") expect(geometry.index).not.toBeNull();
      expect(uv.itemSize).toBe(2);
      expect(uv.count).toBe(position.count);
      for (let i = 0; i < position.count; i++) {
        expect(uv.getX(i), `${name} U vertex ${i}`).toBe(position.getX(i));
        expect(uv.getY(i), `${name} V vertex ${i}`).toBe(position.getZ(i));
      }
    }
  });

  it.each(CASES)("keeps stone phase continuous across wall courses and panels ($name)", ({ options }) => {
    const geometry = meshNamed(build({ ...options, surfaceTextures: surfaceTextures() }), "dungeon-wall").geometry;
    const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    expect(uv.count).toBe(position.count);
    const endpoints = new Map<string, number[][]>();
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => v.toFixed(5)).join(",");
      const coordinates = endpoints.get(key) ?? [];
      coordinates.push([uv.getX(i), uv.getY(i)]);
      endpoints.set(key, coordinates);
      expect(uv.getY(i)).toBe(position.getY(i));
    }
    let shared = 0, wrapSeams = 0;
    for (const values of endpoints.values()) {
      if (values.length < 2) continue;
      shared++;
      const u = values.map(value => value[0]!);
      const spread = Math.max(...u) - Math.min(...u);
      // A closed perimeter needs one wrap seam. Every other shared vertex matches.
      if (spread > 0.0001) {
        expect(Math.min(...u)).toBe(0);
        expect(spread).toBeGreaterThan(10);
        wrapSeams++;
      }
    }
    expect(shared).toBeGreaterThan(100);
    expect(wrapSeams).toBeLessThanOrEqual(15);
  });
});
