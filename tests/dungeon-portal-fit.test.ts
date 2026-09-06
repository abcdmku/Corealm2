import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import * as THREE from "three";
import { REGIONS } from "../game/src/content/regions.js";
import { buildDungeon, dungeonFloorHeight, type CaveRockSource, type DungeonSpec } from "../game/src/render/dungeon.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { createCaveLabFixture } from "../game/src/featureLab/cave.js";
import { assemblePortalFixture } from "../game/src/featureLab/portal.js";

const source = REGIONS.find(region => region.dungeon)?.dungeon!;
const first = source.chambers[0]!;
const bearing = Math.atan2(source.entrance[0] - first.centre[0], source.entrance[1] - first.centre[1]);
const inset = Math.max(0, first.radius - 6);
const worldSpec: DungeonSpec = {
  regionId: "gravelmaw", wallHeight: 13,
  chambers: source.chambers.map(chamber => ({ ...chamber, centre: [...chamber.centre] as [number, number], floorY: chamber.floorOffset })),
  corridors: source.chambers.slice(1).map((chamber, index) => ({
    from: [...source.chambers[index]!.centre] as [number, number], to: [...chamber.centre] as [number, number],
    fromY: source.chambers[index]!.floorOffset, toY: chamber.floorOffset, width: 6,
  })),
};
const labPortal = assemblePortalFixture(() => 0, () => 0).entities[1]!;
const cases = [
  { name: "authored first chamber", spec: worldSpec, scanned: false,
    x: first.centre[0] + Math.sin(bearing) * inset, z: first.centre[1] + Math.cos(bearing) * inset,
    yaw: bearing + Math.PI, scale: 2.2 },
  { name: "authored first chamber with the scanned V7 facing", spec: worldSpec, scanned: true,
    x: first.centre[0] + Math.sin(bearing) * inset, z: first.centre[1] + Math.cos(bearing) * inset,
    yaw: bearing + Math.PI, scale: 2.2 },
  { name: "compact portal cave", spec: null, scanned: false, x: labPortal.position[0], z: labPortal.position[2], yaw: 0, scale: 1.2 },
];

/** The staged V7 scan envelope, loaded the way the browser does but without a renderer. */
async function loadScannedSource(): Promise<CaveRockSource> {
  const document = await new NodeIO().read("art/rebuild/candidates/finish-cave-source/v7/models/cave/rock-face-01.glb");
  const extras = document.getRoot().listScenes()[0]!.getExtras() as { caveContinuousEnvelope?: boolean; caveDomainWarp?: { columns: number; rows: number } };
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!, geometry = new THREE.BufferGeometry();
  for (const [semantic, name, size] of [["POSITION", "position", 3], ["NORMAL", "normal", 3], ["TEXCOORD_0", "uv", 2]] as const) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(primitive.getAttribute(semantic)!.getArray()!, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices()!.getArray()! as Uint16Array, 1));
  return { geometry, material: new THREE.MeshStandardMaterial(), provenance: "Poly Haven Rock Face 01, Dario Barresi, CC0-1.0",
    continuousEnvelope: extras.caveContinuousEnvelope === true, domainWarp: extras.caveDomainWarp };
}

describe("sealed portal recess fits the production cave shell", () => {
  it.each(cases)("keeps masonry and dark rear in front of rock in $name", async ({ spec, scanned, x, z, yaw, scale }) => {
    const texture = new THREE.Texture();
    const family = { albedo: texture, normal: texture, roughness: texture,
      meanLinearRgb: [1, 1, 1] as const, tileMetres: 2.5 };
    const fixture = spec === null ? createCaveLabFixture({
      scene: { root: new THREE.Group(), materials: new MaterialLibrary() },
      surfaceTextures: { bark: family, stone: family, leaf: family },
    }) : null;
    const rockSource = scanned ? await loadScannedSource() : undefined;
    const built = fixture ?? buildDungeon(spec!, new MaterialLibrary(), rockSource ? { rockSource } : undefined);
    built.group.updateMatrixWorld(true);
    if (rockSource) {
      const facing = built.blockers.find(mesh => mesh.name === "dungeon-rock-facing")!;
      expect(facing).toBeDefined();
      console.log("authored Gravelmaw scanned facing", facing.geometry.userData);
    }
    const floorY = dungeonFloorHeight(fixture?.spec ?? spec!, x, z);
    const inward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const depth = (0.185 + 5 / 3) * scale;
    const ray = new THREE.Raycaster();
    try {
      // Rays span the visible opening, through to the physical rear cap. Starting at the
      // threshold excludes approach floor; shell blockers must lie behind that cap.
      for (const across of [-0.5, 0, 0.5]) for (const height of [0.25, 1, 2, 2.4]) {
        if (Math.abs(across) > 0.4 && height > 2.2) continue;
        const eye = new THREE.Vector3(x, floorY + height * scale, z).addScaledVector(right, across * scale);
        ray.set(eye, inward);
        const wall = ray.intersectObjects(built.blockers)[0];
        expect(wall, `${across},${height} needs closed shell behind recess`).toBeDefined();
        expect(wall!.distance, `${across},${height} shell intersects real recess`).toBeGreaterThan(depth);
        // The scanned facing is the visible rock; the recess must end in front of it as well.
        if (rockSource) expect(wall!.object.name, `${across},${height} first rock behind the recess`).toBe("dungeon-rock-facing");
        const rear = eye.clone().addScaledVector(inward, depth);
        ray.set(rear, new THREE.Vector3(0, 1, 0));
        const roof = ray.intersectObjects(built.blockers)[0];
        expect(roof, `roof above ${across},${height}`).toBeDefined();
        expect(roof!.distance).toBeGreaterThan(0.1);
      }
    } finally {
      texture.dispose();
      rockSource?.geometry.dispose(); rockSource?.material.dispose();
      built.group.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        }
      });
    }
  }, 60000);
});
