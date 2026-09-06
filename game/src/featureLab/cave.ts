import * as THREE from "three";
import type { SolidVolume, Vec3 } from "../contracts.js";
import type { CorealmSurfaceTextures } from "../render/corealmSurfaceMaterials.js";
import {
  addChamberLights, buildDungeon, dungeonFloorHeight, dungeonSolids, type DungeonSpec, type CaveRockSource,
} from "../render/dungeon.js";
import type { WorldScene } from "../render/scene.js";

export type CaveLabViewId = "chambers" | "wall" | "floor" | "ceiling";

export interface CaveLabCameraView {
  id: CaveLabViewId;
  eye: Vec3;
  target: Vec3;
  /** Ready for debug.inspectPose or the lab-session camera operation, including upward views. */
  inspectPose: {
    x: number; y: number; z: number; yaw: number; pitch: number; distance: number; detached: true;
  };
}

export interface CaveLabProbe {
  x: number;
  z: number;
  /** Intersections with the actual rendered triangles, including their interpolated UVs. */
  floorY: number;
  ceilingY: number;
  headroom: number;
  floorUv: [number, number];
  ceilingUv: [number, number];
  /** The same continuous sampler used for production entity grounding. */
  sampledFloorY: number;
}

export interface CaveLabFixtureState {
  ready: boolean;
  visible: boolean;
  origin: Vec3;
  triangles: number;
  meshCount: number;
  materialCount: number;
  textured: boolean;
  stoneTileMetres: number;
  sourceFacing: { wallPanels: number; roofPanels: number; renderedTriangles: number; provenance: string } | null;
  views: CaveLabViewId[];
  probes: { upper: CaveLabProbe | null; join: CaveLabProbe | null; lower: CaveLabProbe | null };
}

export interface CaveLabFixture {
  group: THREE.Group;
  spec: DungeonSpec;
  walkable: THREE.Mesh[];
  blockers: THREE.Mesh[];
  /** Returned for root-owned physics wiring; the fixture does not mutate physics or navigation. */
  solids: SolidVolume[];
  navigationSolids: SolidVolume[];
  getViews(): CaveLabCameraView[];
  getBounds(): { min: Vec3; max: Vec3 } | null;
  getState(): CaveLabFixtureState;
  probe(x: number, z: number): CaveLabProbe | null;
  dispose(): void;
}

export interface CaveLabFixtureDeps {
  scene: Pick<WorldScene, "root" | "materials">;
  surfaceTextures: CorealmSurfaceTextures;
  rockSource?: CaveRockSource;
  /** Upper chamber centre and floor datum. Default keeps the entire fixture below the lab yard. */
  origin?: Vec3;
}

/** Two connected chambers use the production shell, stone maps, contact colors and torch lights. */
export function createCaveLabFixture({
  scene, surfaceTextures, rockSource, origin: requestedOrigin = [-36, -12, -36],
}: CaveLabFixtureDeps): CaveLabFixture {
  if (!requestedOrigin.every(Number.isFinite)) throw new Error("Cave fixture origin must be finite");
  const origin: Vec3 = [...requestedOrigin];
  const [x, y, z] = origin;
  const upper: Vec3 = [x, y, z];
  const lower: Vec3 = [x + 9, y - 1.7, z - 2];
  const spec: DungeonSpec = {
    regionId: "gravelmaw",
    chambers: [
      { id: "feature-lab:cave:upper", name: "Upper stone chamber", centre: [x, z], radius: 5, floorY: y, lit: true },
      { id: "feature-lab:cave:lower", name: "Lower stone chamber", centre: [lower[0], lower[2]], radius: 5.5, floorY: lower[1], lit: false },
    ],
    corridors: [{ from: [x, z], to: [lower[0], lower[2]], fromY: y, toY: lower[1], width: 3.6 }],
    wallHeight: 8,
  };
  const built = buildDungeon(spec, scene.materials, { surfaceTextures, rockSource });
  const group = built.group;
  group.name = "feature-lab-cave";
  addChamberLights(spec, group);
  const meshes = [...built.walkable, ...built.blockers];
  const geometries = new Set(meshes.map(mesh => mesh.geometry));
  const materials = new Set(meshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  const lights = group.children.filter((child): child is THREE.Light => (child as THREE.Light).isLight);
  const bounds = new THREE.Box3().setFromObject(group);
  const floor = built.walkable[0]!;
  const ceiling = built.blockers.find(mesh => mesh.name === "dungeon-ceiling")!;
  const wall = built.blockers.find(mesh => mesh.name === "dungeon-wall")!;
  const ray = new THREE.Raycaster();
  let disposed = false;

  function probe(px: number, pz: number): CaveLabProbe | null {
    if (disposed) return null;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) throw new Error("Cave probe coordinates must be finite");
    group.updateWorldMatrix(true, true);
    ray.set(new THREE.Vector3(px, bounds.max.y + 1, pz), new THREE.Vector3(0, -1, 0));
    const floorHit = ray.intersectObject(floor, false)[0];
    if (!floorHit?.uv) return null;
    ray.set(new THREE.Vector3(px, floorHit.point.y + 0.05, pz), new THREE.Vector3(0, 1, 0));
    const ceilingHit = ray.intersectObjects(rockSource ? built.blockers : [ceiling], false)[0];
    if (!ceilingHit?.uv) return null;
    return {
      x: px, z: pz, floorY: floorHit.point.y, ceilingY: ceilingHit.point.y,
      headroom: ceilingHit.point.y - floorHit.point.y,
      floorUv: floorHit.uv.toArray(), ceilingUv: ceilingHit.uv.toArray(),
      sampledFloorY: dungeonFloorHeight(spec, px, pz),
    };
  }

  const upperProbe = probe(x, z)!;
  const floorProbe = probe(x + 1.7, z + 0.7)!;
  const roofProbe = probe(x - 0.6, z - 0.8)!;
  const joinProbe = probe(x + 4.5, z - 1)!;
  ray.set(new THREE.Vector3(x, upperProbe.floorY + 1.8, z), new THREE.Vector3(-1, 0, 0));
  const wallTarget = ray.intersectObject(wall, false)[0]!.point.toArray() as Vec3;
  const views: CaveLabCameraView[] = [
    cameraView("chambers", [x - 2.4, upperProbe.floorY + 2.8, z + 3],
      [x + 4.5, joinProbe.floorY + 0.9, z - 1]),
    cameraView("wall", [wallTarget[0] + 2.6, wallTarget[1] + 0.8, z + 0.7], wallTarget),
    cameraView("floor", [x - 0.1, floorProbe.floorY + 2.4, z + 2.9],
      [x + 1.7, floorProbe.floorY + 0.03, z + 0.7]),
    cameraView("ceiling", [x + 0.8, roofProbe.ceilingY - 2.2, z + 1.2],
      [x - 0.6, roofProbe.ceilingY, z - 0.8]),
  ];
  scene.root.add(group);

  return {
    group, spec, walkable: built.walkable, blockers: built.blockers,
    solids: dungeonSolids(spec, { rockSource }),
    navigationSolids: dungeonSolids(spec, { includeCeilings: false, rockSource }),
    getViews: () => structuredClone(views),
    getBounds: () => disposed ? null : { min: bounds.min.toArray() as Vec3, max: bounds.max.toArray() as Vec3 },
    getState: () => ({
      ready: !disposed, visible: !disposed && group.visible && group.parent !== null,
      origin: [...origin], triangles: built.triangles, meshCount: meshes.length, materialCount: materials.size,
      textured: [...materials].every(material => {
        const standard = material as THREE.MeshStandardMaterial;
        if (material.name === 'dungeon-scanned-rock') return !!standard.map && !!standard.normalMap && !!standard.roughnessMap;
        return standard.map === surfaceTextures.stone.albedo && standard.normalMap === surfaceTextures.stone.normal
          && standard.roughnessMap === surfaceTextures.stone.roughness;
      }),
      stoneTileMetres: surfaceTextures.stone.tileMetres, views: views.map(view => view.id),
      sourceFacing: rockSource
        ? (built.group.getObjectByName('dungeon-rock-facing') as THREE.Mesh).geometry.userData as CaveLabFixtureState['sourceFacing']
        : null,
      probes: { upper: probe(upper[0], upper[2]), join: probe(x + 4.5, z - 1), lower: probe(lower[0], lower[2]) },
    }),
    probe,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      // Capture ownership at creation: caller-added objects and globally shared maps are untouched.
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const light of lights) { light.dispose(); light.removeFromParent(); }
    },
  };
}

function cameraView(id: CaveLabViewId, eye: Vec3, target: Vec3): CaveLabCameraView {
  const dx = eye[0] - target[0];
  const dy = eye[1] - target[1];
  const dz = eye[2] - target[2];
  const distance = Math.hypot(dx, dy, dz);
  const pitch = Math.asin(dy / distance);
  return {
    id, eye, target,
    // The detached debug path subtracts 1.2 m before the camera adds its 1.1 m focus height.
    inspectPose: {
      x: target[0], y: target[1] + 0.1, z: target[2],
      yaw: Math.atan2(dx, dz), pitch, distance, detached: true,
    },
  };
}
