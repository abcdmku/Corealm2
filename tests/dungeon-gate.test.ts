import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  DUNGEON_GATE_ASSET_IDS,
  DUNGEON_GATE_DIMENSIONS,
  buildDungeonGateAssets,
  buildDungeonGateMasonryWall,
  createDungeonGateMaterials,
  registerDungeonGateAssets,
} from "../game/src/render/dungeonGate.js";

const EPSILON = 0.001;

function meshes(group: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse(object => { if ((object as THREE.Mesh).isMesh) result.push(object as THREE.Mesh); });
  return result;
}

function across(group: THREE.Object3D, x: number, y: number): THREE.Intersection[] {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, y, -3), new THREE.Vector3(0, 0, 1), 0, 6)
    .intersectObject(group, true);
}

function checkGeometry(group: THREE.Object3D): void {
  const parts = meshes(group);
  expect(parts.length).toBeGreaterThan(0);
  for (const mesh of parts) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    expect(position, `${mesh.name} positions`).toBeDefined();
    expect(normal, `${mesh.name} normals`).toBeDefined();
    expect(uv, `${mesh.name} UVs`).toBeDefined();
    expect(normal.count).toBe(position.count);
    expect(uv.count).toBe(position.count);
    expect([...position.array, ...normal.array, ...uv.array].every(Number.isFinite)).toBe(true);
    for (let vertex = 0; vertex < normal.count; vertex += 1) {
      expect(Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)), `${mesh.name} normal ${vertex}`)
        .toBeCloseTo(1, 3);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        expect((material as THREE.MeshStandardMaterial).flatShading, `${mesh.name} smooth vertex shading`).toBe(false);
      }
    }
    const index = geometry.getIndex();
    const count = index?.count ?? position.count;
    expect(count % 3).toBe(0);
    expect(count).toBeGreaterThan(0);
    for (let offset = 0; offset < count; offset += 3) {
      const ids = [0, 1, 2].map(corner => index?.getX(offset + corner) ?? offset + corner);
      const [a, b, c] = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id));
      expect(b!.sub(a!).cross(c!.sub(a!)).lengthSq(), `${mesh.name} triangle ${offset / 3}`).toBeGreaterThan(1e-15);
      const [ta, tb, tc] = ids.map(id => new THREE.Vector2(uv.getX(id), uv.getY(id)));
      expect(Math.abs(tb!.sub(ta!).cross(tc!.sub(ta!))), `${mesh.name} UV triangle ${offset / 3}`).toBeGreaterThan(1e-12);
    }
  }
}

describe("production dungeon gate geometry", () => {
  it("keeps the agreed human-scale aperture, frame, leaf depth and opening distance", () => {
    expect(DUNGEON_GATE_DIMENSIONS).toMatchObject({
      clearWidth: 3.2, clearHeight: 3.4, springHeight: 2.15,
      leafDepth: 0.32, frameWidth: 4.5, frameHeight: 4.15, frameDepth: 1.2, openLift: 3.6,
    });
    const { closed, open, frame } = buildDungeonGateAssets(createDungeonGateMaterials());
    for (const leaf of [closed, open]) {
      expect(meshes(leaf).length).toBeGreaterThan(0);
      expect(meshes(leaf).length).toBeLessThanOrEqual(3);
    }
    expect(meshes(frame).length).toBeGreaterThan(0);
    expect(meshes(frame).length).toBeLessThanOrEqual(3);
    const frameBounds = new THREE.Box3().setFromObject(frame);
    expect(frameBounds.min.x).toBeGreaterThanOrEqual(-DUNGEON_GATE_DIMENSIONS.frameWidth / 2 - EPSILON);
    expect(frameBounds.max.x).toBeLessThanOrEqual(DUNGEON_GATE_DIMENSIONS.frameWidth / 2 + EPSILON);
    expect(Math.abs(frameBounds.max.y - DUNGEON_GATE_DIMENSIONS.frameHeight)).toBeLessThanOrEqual(EPSILON);
    expect(frameBounds.getSize(new THREE.Vector3()).z).toBeGreaterThanOrEqual(DUNGEON_GATE_DIMENSIONS.frameDepth - EPSILON);
    expect(frameBounds.getSize(new THREE.Vector3()).z).toBeLessThanOrEqual(1.32 + EPSILON);
  });

  it("bakes the open lift into identical geometry while keeping the asset pivots unchanged", () => {
    const { closed, open } = buildDungeonGateAssets(createDungeonGateMaterials());
    expect(open.position.toArray()).toEqual(closed.position.toArray());
    expect(open.quaternion.toArray()).toEqual(closed.quaternion.toArray());
    expect(open.scale.toArray()).toEqual(closed.scale.toArray());
    expect(closed.position.toArray()).toEqual([0, 0, 0]);
    const shutParts = meshes(closed);
    const raisedParts = meshes(open);
    expect(raisedParts).toHaveLength(shutParts.length);
    for (let part = 0; part < shutParts.length; part += 1) {
      const shut = shutParts[part]!;
      const raised = raisedParts[part]!;
      expect(raised.position.toArray()).toEqual(shut.position.toArray());
      expect(raised.quaternion.toArray()).toEqual(shut.quaternion.toArray());
      expect(raised.scale.toArray()).toEqual(shut.scale.toArray());
      const source = shut.geometry.getAttribute("position");
      const target = raised.geometry.getAttribute("position");
      expect(target.count).toBe(source.count);
      expect(raised.geometry).not.toBe(shut.geometry);
      for (let vertex = 0; vertex < source.count; vertex += 1) {
        expect(target.getX(vertex)).toBeCloseTo(source.getX(vertex), 6);
        expect(target.getY(vertex)).toBeCloseTo(source.getY(vertex) + DUNGEON_GATE_DIMENSIONS.openLift, 5);
        expect(target.getZ(vertex)).toBeCloseTo(source.getZ(vertex), 6);
      }
      expect(raised.geometry.index?.array).toEqual(shut.geometry.index?.array);
      expect(raised.geometry.getAttribute("normal").array).toEqual(shut.geometry.getAttribute("normal").array);
      expect(raised.geometry.getAttribute("uv").array).toEqual(shut.geometry.getAttribute("uv").array);
    }
    const shutBounds = new THREE.Box3().setFromObject(closed);
    const openBounds = new THREE.Box3().setFromObject(open);
    expect(openBounds.min.y).toBeGreaterThanOrEqual(3.6 - EPSILON);
    expect(openBounds.min.y - shutBounds.min.y).toBeCloseTo(DUNGEON_GATE_DIMENSIONS.openLift, 5);
    expect(openBounds.max.y - shutBounds.max.y).toBeCloseTo(DUNGEON_GATE_DIMENSIONS.openLift, 5);
  });

  it("leaves the frame aperture and raised passage empty while retaining solid jambs and crown", () => {
    const { closed, open, frame } = buildDungeonGateAssets(createDungeonGateMaterials());
    const aperture = [
      ...[-1.5, -0.75, 0, 0.75, 1.5].flatMap(x => [0.05, 0.8, 1.5, 1.99].map(y => [x, y] as const)),
      ...[2.15, 2.7, 3.1, 3.29].map(y => [0, y] as const),
    ];
    for (const [x, y] of aperture) {
      expect(across(frame, x, y), `frame aperture ${x},${y}`).toHaveLength(0);
      expect(across(open, x, y), `open gate clearance ${x},${y}`).toHaveLength(0);
    }
    for (const x of [-1.95, 1.95]) for (const y of [0.4, 1.3, 2.1]) {
      expect(across(frame, x, y).length, `solid jamb ${x},${y}`).toBeGreaterThan(0);
    }
    expect(across(frame, 0, 3.85).length, "solid arch crown").toBeGreaterThan(0);
    expect(aperture.filter(([x, y]) => across(closed, x, y).length > 0).length, "closed leaf occupies passage").toBeGreaterThan(0);
  });

  it("keeps a real lift slot between the stone faces with exposed guides outside the clear width", () => {
    const { frame } = buildDungeonGateAssets(createDungeonGateMaterials());
    frame.updateMatrixWorld(true);
    for (const x of [-1.59, -0.75, 0, 0.75, 1.59]) for (const z of [-0.16, 0, 0.16]) {
      const lift = new THREE.Raycaster(new THREE.Vector3(x, -0.6, z), new THREE.Vector3(0, 1, 0), 0, 8)
        .intersectObject(frame, true);
      expect(lift, `unobstructed leaf lift at ${x},${z}`).toHaveLength(0);
    }
    for (const side of [-1, 1]) {
      for (const z of [-0.208, 0, 0.208]) {
        const rail = new THREE.Raycaster(new THREE.Vector3(0, 1.3, z), new THREE.Vector3(side, 0, 0), 0, 3)
          .intersectObject(frame, true)[0];
        expect(rail, `exposed channel at side ${side}, z ${z}`).toBeDefined();
        expect(rail!.object.name).toBe("gate-recessed-lift-guides");
        expect(Math.abs(rail!.point.x)).toBeGreaterThanOrEqual(DUNGEON_GATE_DIMENSIONS.clearWidth / 2);
        expect(Math.abs(rail!.point.x)).toBeLessThan(1.72);
      }
      const crown = new THREE.Raycaster(new THREE.Vector3(0, 3.85, side * 2), new THREE.Vector3(0, 0, -side), 0, 3)
        .intersectObject(frame, true)[0];
      expect(crown!.object.name).toBe("gate-dressed-stone-portal");
      expect(Math.abs(crown!.point.z)).toBeGreaterThan(0.5);
    }
  });

  it("unwraps the curved soffit continuously at one UV unit per metre", () => {
    const { frame } = buildDungeonGateAssets(createDungeonGateMaterials());
    const geometry = (frame.getObjectByName("gate-dressed-stone-portal") as THREE.Mesh).geometry;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    const shared = new Map<string, THREE.Vector2>();
    let triangles = 0;
    for (let offset = 0; offset < position.count; offset += 3) {
      const ids = [offset, offset + 1, offset + 2];
      if (!ids.every(id => Math.abs(normal.getZ(id)) < 1e-6
        && position.getY(id) >= 2.15 - EPSILON
        && Math.abs((position.getX(id) / 1.6) ** 2 + ((position.getY(id) - 2.15) / 1.25) ** 2 - 1) < 1e-5)) continue;
      triangles++;
      for (const id of ids) {
        const key = [position.getX(id), position.getY(id), position.getZ(id)].map(value => value.toFixed(5)).join(",");
        const current = new THREE.Vector2(uv.getX(id), uv.getY(id));
        const previous = shared.get(key);
        if (previous) expect(current.distanceTo(previous), `continuous UV at ${key}`).toBeLessThan(1e-5);
        else shared.set(key, current);
      }
      for (let edge = 0; edge < 3; edge++) {
        const a = ids[edge]!; const b = ids[(edge + 1) % 3]!;
        const xy = Math.hypot(position.getX(a) - position.getX(b), position.getY(a) - position.getY(b));
        const z = Math.abs(position.getZ(a) - position.getZ(b));
        const u = Math.abs(uv.getX(a) - uv.getX(b));
        const v = Math.abs(uv.getY(a) - uv.getY(b));
        expect(u, `soffit arc distance ${a}-${b}`).toBeCloseTo(xy, 5);
        expect(v, `soffit depth distance ${a}-${b}`).toBeCloseTo(z, 5);
      }
    }
    expect(triangles).toBe(64 * 2 * 2);
  });

  it("provides finite nondegenerate triangles, unit normals, and usable UVs", () => {
    const assets = buildDungeonGateAssets(createDungeonGateMaterials());
    for (const group of Object.values(assets)) checkGeometry(group);
  });

  it("fits sloped masonry to the supplied floor and exact boundaries without moving the floor", () => {
    const floor = (x: number, z: number): number => 0.4 + 0.17 * x - 0.09 * z;
    const bottomAt = vi.fn(floor);
    const options = Object.freeze({ minX: -7.3, maxX: -2.25, bottomAt, height: 2.8, depth: 1.2, zCenter: 0.55 });
    const probes = [-7.25, -6, -4.5, -2.3].flatMap(x => [0.06, 0.55, 1.04].map(z => ({ x, z, floor: floor(x, z) })));
    const wall = buildDungeonGateMasonryWall(options, createDungeonGateMaterials());
    wall.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(wall);
    expect(bottomAt).toHaveBeenCalled();
    expect(Math.abs(bounds.min.x - options.minX)).toBeLessThanOrEqual(EPSILON);
    expect(Math.abs(bounds.max.x - options.maxX)).toBeLessThanOrEqual(EPSILON);
    expect(Math.abs(bounds.min.z - (options.zCenter - options.depth / 2))).toBeLessThanOrEqual(EPSILON);
    expect(Math.abs(bounds.max.z - (options.zCenter + options.depth / 2))).toBeLessThanOrEqual(EPSILON);
    expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
    for (const probe of probes) {
      const bottom = new THREE.Raycaster(new THREE.Vector3(probe.x, probe.floor - 0.2, probe.z), new THREE.Vector3(0, 1, 0), 0, 0.4)
        .intersectObject(wall, true)[0];
      expect(bottom, `wall bottom ${probe.x},${probe.z}`).toBeDefined();
      expect(Math.abs(bottom!.point.y - probe.floor)).toBeLessThanOrEqual(EPSILON);
      const top = new THREE.Raycaster(new THREE.Vector3(probe.x, probe.floor + options.height + 0.2, probe.z), new THREE.Vector3(0, -1, 0), 0, 0.4)
        .intersectObject(wall, true)[0];
      expect(top, `wall top ${probe.x},${probe.z}`).toBeDefined();
      expect(Math.abs(top!.point.y - (probe.floor + options.height))).toBeLessThanOrEqual(EPSILON);
      expect(bottomAt(probe.x, probe.z)).toBe(probe.floor);
    }
    expect(options.bottomAt).toBe(bottomAt);
    checkGeometry(wall);
  });

  it("registers exactly the closed gate, raised gate and frame through the supplied sink", async () => {
    const entries: Array<{ id: string; group: THREE.Group }> = [];
    const sink = { registerBuilt: vi.fn((id: string, group: THREE.Group) => { entries.push({ id, group }); }) };
    const result = await registerDungeonGateAssets(sink, createDungeonGateMaterials());
    const expected = ["corealm_dungeon_portcullis", "corealm_dungeon_portcullis_open", "corealm_dungeon_gate_frame"].sort();
    expect(Object.values(DUNGEON_GATE_ASSET_IDS).sort()).toEqual(expected);
    expect(sink.registerBuilt).toHaveBeenCalledTimes(3);
    expect(entries.map(entry => entry.id).sort()).toEqual(expected);
    expect([...result].sort()).toEqual(expected);
    expect(new Set(entries.map(entry => entry.group)).size).toBe(3);
    expect(entries.every(entry => entry.group.isGroup && meshes(entry.group).length > 0)).toBe(true);
  });
});
