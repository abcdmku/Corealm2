import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { portalMantleSolid } from "../game/src/world/portalMantle.js";
import { buildDungeonMouth } from "../game/src/render/dungeonMouth.js";

function portal(): SemanticEntity {
  return { id: "proof_portal", archetype: "portal", name: "Portal", tier: 1, regionId: "fallowmarch",
    position: [0, 0, 0], state: "available", interactions: ["inspect"],
    view: { assetId: "wall_brick_door", scale: 1, rotationY: 0 } };
}

describe("production dungeon mouth", () => {
  it("surrounds the surface passage with grounded rock mass while keeping interior portals compact", () => {
    const surface = buildDungeonMouth(portal());
    surface.updateMatrixWorld(true);
    const mantle = surface.getObjectByName("dungeon-mouth-rock-mantle") as THREE.Mesh;
    expect(mantle).toBeDefined();
    const bounds = new THREE.Box3().setFromObject(mantle);
    expect(bounds.min.y).toBeCloseTo(-0.05, 6);
    expect(bounds.min.z).toBeCloseTo(-3.9, 6);
    const solid = portalMantleSolid(portal())!;
    expect(solid.kind).toBe("box");
    if (solid.kind !== "box") throw new Error("Expected mantle box");
    expect(bounds.min.x).toBeGreaterThanOrEqual(solid.position[0] - solid.size[0] / 2);
    expect(bounds.max.x).toBeLessThanOrEqual(solid.position[0] + solid.size[0] / 2);
    expect(bounds.max.y).toBeLessThanOrEqual(solid.position[1] + solid.size[1]);
    expect(bounds.max.z).toBeLessThan(0);

    for (const z of [-0.5, -1, -1.8, -2.8, -3.8]) {
      const down = new THREE.Raycaster(new THREE.Vector3(0, 5, z), new THREE.Vector3(0, -1, 0));
      const top = down.intersectObject(mantle)[0];
      expect(top, `solid roof above ${z}`).toBeDefined();
      expect(top!.point.y).toBeGreaterThan(2.5);
      for (const side of [-1, 1]) {
        const lateral = new THREE.Raycaster(new THREE.Vector3(side * 3, 0.25, z), new THREE.Vector3(-side, 0, 0));
        expect(lateral.intersectObject(mantle)[0], `grounded support ${side},${z}`).toBeDefined();
      }
    }
    const interior = portal(); interior.regionId = "gravelmaw";
    expect(buildDungeonMouth(interior).getObjectByName("dungeon-mouth-rock-mantle")).toBeUndefined();
  });

  it("keeps the measured opening clear, encloses the rear and covers the source timber crown", () => {
    const group = buildDungeonMouth(portal());
    group.updateMatrixWorld(true);
    for (const x of [-0.58, 0, 0.58]) for (const y of [0.10, 1, 2]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 0.5), new THREE.Vector3(0, 0, -1), 0, 0.8);
      expect(ray.intersectObject(group, true), `clear aperture at ${x},${y}`).toHaveLength(0);
    }
    for (const x of [-0.95, -0.5, 0, 0.5, 0.95]) for (const y of [2.98, 3.08]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, y, 0.5), new THREE.Vector3(0, 0, -1), 0, 0.5)
        .intersectObject(group, true)[0];
      expect(hit, `masonry over source timber at ${x},${y}`).toBeDefined();
      expect(hit!.point.z).toBeGreaterThan(0.092);
    }
    const rear = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), 0, 5)
      .intersectObject(group, true)[0];
    expect(rear?.object.name).toBe("dungeon-mouth-dark-end");
    expect(rear!.point.z).toBeCloseTo(-0.185 - 5 / 3, 6);
    for (const side of [-1, 1]) for (const y of [0.12, 0.9, 1.9]) for (const z of [-0.15, 0, 0.09]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(0, y, z), new THREE.Vector3(side, 0, 0), 0, 1)
        .intersectObject(group, true)[0];
      expect(hit?.object.name, `continuous dressed reveal at ${side},${y},${z}`).toBe("dungeon-mouth-stone-recess");
      expect(hit!.point.x).toBeCloseTo(side < 0 ? -0.64942 : 0.65552, 6);
    }
  });

  it.each([1, 3])("encloses every exposed timber face, seam and corner at scale %s", (scale) => {
    const entity = portal();
    entity.position = [11, 4, -7];
    entity.view = { ...entity.view!, scale, rotationY: 0.61 };
    const group = buildDungeonMouth(entity);
    group.updateMatrixWorld(true);

    // Measured bounds of the original timber in wall_brick_door.glb. Rays stop at its
    // surfaces: a stone face behind the timber cannot satisfy this coverage check.
    const sourceMin = [-1, 2.877, -0.314] as const;
    const sourceMax = [1, 3.123, 0.0924] as const;
    const samples = [
      // Dressed cap joints stay covered by the continuous stone beneath their gaps.
      [-1, -0.999, -0.75, -0.69, -0.5, -0.35, 0, 0.005, 0.37, 0.5, 0.70, 0.75, 0.999, 1],
      // Include the old crown's 2.910..2.916 mortar gap and both timber edges.
      [2.877, 2.878, 2.910, 2.913, 2.916, 3, 3.122, 3.123],
      [-0.314, -0.313, -0.2, -0.1108, 0, 0.0914, 0.0924],
    ] as const;
    const faces = [
      { name: "front", axis: 2, sign: 1 }, { name: "back", axis: 2, sign: -1 },
      { name: "top", axis: 1, sign: 1 }, { name: "below", axis: 1, sign: -1 },
      { name: "left", axis: 0, sign: -1 }, { name: "right", axis: 0, sign: 1 },
    ] as const;
    for (const face of faces) {
      const tangentAxes = [0, 1, 2].filter(axis => axis !== face.axis);
      for (const u of samples[tangentAxes[0]!]!) for (const v of samples[tangentAxes[1]!]!) {
        const point = new THREE.Vector3();
        point.setComponent(face.axis, face.sign > 0 ? sourceMax[face.axis] : sourceMin[face.axis]);
        point.setComponent(tangentAxes[0]!, u);
        point.setComponent(tangentAxes[1]!, v);
        const origin = point.clone();
        origin.setComponent(face.axis, origin.getComponent(face.axis) + face.sign * 0.15);
        const timberSurface = point.clone().applyMatrix4(group.matrixWorld);
        origin.applyMatrix4(group.matrixWorld);
        const direction = timberSurface.clone().sub(origin);
        const distanceToTimber = direction.length();
        direction.normalize();
        const hit = new THREE.Raycaster(origin, direction, 0, distanceToTimber + 0.00001)
          .intersectObject(group, true)[0];
        const label = `${face.name} coverage at native ${point.toArray().join(",")}, scale ${scale}`;
        expect(hit, label).toBeDefined();
        expect(["dungeon-mouth-stone-recess", "dungeon-mouth-rock-mantle"], label).toContain(hit!.object.name);
        expect(hit!.distance, label).toBeLessThan(distanceToTimber - 0.00001);
      }
    }
  });

  it("keeps threshold wear below a small step and supplies finite, nondegenerate owned geometry", () => {
    const entity = portal(); const before = structuredClone(entity);
    const group = buildDungeonMouth(entity);
    group.updateMatrixWorld(true);
    const levels: number[] = [];
    for (const x of [-0.5, -0.15, 0.2, 0.5]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 0.25, -0.04), new THREE.Vector3(0, -1, 0), 0, 0.3)
        .intersectObject(group, true)[0];
      expect(hit).toBeDefined(); levels.push(hit!.point.y);
    }
    expect(Math.min(...levels)).toBeGreaterThan(0);
    expect(Math.max(...levels)).toBeLessThan(0.03);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.001);
    group.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      expect(mesh.userData.ownedGeometry).toBe(true); expect(mesh.userData.ownedMaterial).toBe(true);
      const position = mesh.geometry.getAttribute("position");
      const normal = mesh.geometry.getAttribute("normal");
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      expect(Array.from(normal.array).every(Number.isFinite)).toBe(true);
      const index = mesh.geometry.index;
      for (let face = 0; face < (index?.count ?? position.count); face += 3) {
        const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position, index?.getX(face + offset) ?? face + offset));
        expect(vertices[1]!.sub(vertices[0]!).cross(vertices[2]!.sub(vertices[0]!)).lengthSq()).toBeGreaterThan(1e-15);
      }
    });
    expect(entity).toEqual(before);
    expect(group.parent).toBeNull();
  });

  it("preserves metre density on scaled masonry and applies the semantic portal transform", () => {
    const entity = portal(); entity.position = [17, 4, -23];
    entity.view = { ...entity.view!, scale: 3, scaleAxes: [1.1, 0.9, 1.2], rotationY: 0.74 };
    const group = buildDungeonMouth(entity);
    expect(group.position.toArray()).toEqual(entity.position);
    for (const [index, expected] of [3.3, 2.7, 3.6].entries()) expect(group.scale.toArray()[index]).toBeCloseTo(expected, 6);
    expect(group.rotation.y).toBe(0.74);
    group.updateMatrixWorld(true);
    const mesh = group.getObjectByName("dungeon-mouth-stone-recess") as THREE.Mesh;
    expect((mesh.material as THREE.Material).name).toBe("Corealm weathered strata");
    const position = mesh.geometry.getAttribute("position"); const uv = mesh.geometry.getAttribute("uv");
    const index = mesh.geometry.index!;
    let frontFaces = 0;
    for (let face = 0; face < index.count; face += 3) {
      const ids = [index.getX(face), index.getX(face + 1), index.getX(face + 2)];
      const points = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id));
      if (!points.every(point => Math.abs(point.z - 0.105) < 0.000001)) continue;
      const world = points.map(point => point.applyMatrix4(mesh.matrixWorld));
      const worldArea = world[1]!.sub(world[0]!).cross(world[2]!.sub(world[0]!)).length();
      const coords = ids.map(id => new THREE.Vector2(uv.getX(id), uv.getY(id)));
      const uvArea = Math.abs(coords[1]!.sub(coords[0]!).cross(coords[2]!.sub(coords[0]!)));
      expect(uvArea / worldArea).toBeCloseTo(1, 4);
      frontFaces++;
    }
    expect(frontFaces).toBeGreaterThan(20);
  });
});
