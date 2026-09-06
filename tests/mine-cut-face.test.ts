import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { SemanticEntity, SolidVolume } from "../game/src/contracts.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../game/src/content/worldSites.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import type { WorldScene } from "../game/src/render/scene.js";
import { buildMineCutFace, createMineBurialSampler } from "../game/src/render/mineCutFace.js";

const UP = new THREE.Vector3(0, 1, 0);
const SETBACK = 2.4;
const SURFACE_EPSILON = 0.002;

function fixture(single = false, steep = false) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  material.name = "Corealm weathered strata";
  material.map = new THREE.Texture();
  material.map.repeat.set(0.42, 0.42);
  const sourceGeometry = new THREE.BoxGeometry(12, 7, 4.8);
  const count = sourceGeometry.getAttribute("position").count;
  sourceGeometry.setAttribute("color", new THREE.Float32BufferAttribute(
    Array.from({ length: count }, () => [0.31, 0.28, 0.24]).flat(), 3,
  ));
  const source = new THREE.Group();
  source.position.set(5, 2, -3);
  source.add(new THREE.Mesh(sourceGeometry, material));
  const assets = {
    load: vi.fn(async () => source),
    assetSize: vi.fn(() => ({ x: 2.6, y: 1.6, z: 0.65 })),
    assetCenterXZ: vi.fn(() => ({ x: 0, z: 0 })),
    baseY: vi.fn(() => 0),
  };
  const slots = (single ? [0] : [-3, 3]).map((x, index) => ({
    clusterId: "proof_seam", index: index + 1, x, z: 0,
    yaw: single ? 0 : index === 0 ? 0.12 : -0.08, scale: index === 0 ? 0.88 : 1.18,
  }));
  const site: WorldSite = {
    ...WORLD_SITES[0]!, id: "proof-cut", centre: single ? [0, 0] : [30, -9],
    rotationY: single ? 0 : 0.42, resourceSlots: slots,
    cutFace: {
      stations: slots.map((slot) => ({ clusterId: slot.clusterId, index: slot.index, crestHeight: 3.6 })),
      frontSetback: SETBACK, backDepth: steep ? 10.5 : 4, buryDepth: 0.5,
    },
  };
  const height = (x: number, z: number) => steep ? Math.max(0, -z - SETBACK - 0.6) * 2.2
    : single ? 0 : 2 + (x - 30) * 0.08 + (z + 9) * 0.05;
  const scene = { meshHeightAt: height };
  const entities: SemanticEntity[] = slots.map((slot) => {
    const [x, z] = worldSitePoint(site, slot.x, slot.z);
    return {
      id: `${slot.clusterId}_${slot.index}`, archetype: "ore", name: "Ground ore", tier: 10,
      regionId: site.regionId, position: [x, height(x, z), z], state: "available", interactions: ["mine"],
      view: { assetId: "corealm_ore_grithe", scale: slot.scale, rotationY: site.rotationY + slot.yaw,
        groundNormal: [-0.12, 0.986, 0.06], tiltStrength: 0.85, materialTier: 5 },
    };
  });
  const build = (setting = site, rows = entities) => buildMineCutFace(
    scene as WorldScene, assets as unknown as AssetRegistry, setting, rows,
  );
  return { assets, scene, source, sourceGeometry, material, site, entities, build };
}

function vertices(mesh: THREE.Mesh): THREE.Vector3[] {
  const position = mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index));
}

function boxGap(point: THREE.Vector3, volume: SolidVolume): number {
  if (volume.kind !== "box") throw new Error("Expected cut-face box");
  const local = point.clone().sub(new THREE.Vector3(...volume.position)).applyAxisAngle(UP, -volume.rotationY);
  return Math.hypot(Math.max(0, Math.abs(local.x) - volume.size[0] / 2),
    Math.max(0, Math.abs(local.z) - volume.size[2] / 2));
}

function assertClosedShell(mesh: THREE.Mesh) {
  const points = vertices(mesh);
  const key = (point: THREE.Vector3) => point.toArray().map((value) => value.toFixed(5)).join(",");
  const edges = new Map<string, number>();
  const neighbours = new Map<string, Set<string>>();
  let signedVolume = 0;
  for (let index = 0; index < points.length; index += 3) {
    const triangle = points.slice(index, index + 3);
    expect(triangle.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
    const area = new THREE.Vector3().crossVectors(triangle[1]!.clone().sub(triangle[0]!), triangle[2]!.clone().sub(triangle[0]!));
    expect(area.lengthSq()).toBeGreaterThan(1e-14);
    signedVolume += triangle[0]!.dot(new THREE.Vector3().crossVectors(triangle[1]!, triangle[2]!)) / 6;
    for (let edge = 0; edge < 3; edge++) {
      const a = key(triangle[edge]!); const b = key(triangle[(edge + 1) % 3]!);
      const id = [a, b].sort().join("|");
      edges.set(id, (edges.get(id) ?? 0) + 1);
      const links = neighbours.get(a) ?? new Set<string>(); links.add(b); neighbours.set(a, links);
    }
  }
  expect([...edges].filter(([, count]) => count !== 2)).toEqual([]);
  expect(signedVolume).toBeGreaterThan(1);
  const visited = new Set<string>(); const pending = [neighbours.keys().next().value!];
  while (pending.length) {
    const point = pending.pop()!;
    if (visited.has(point)) continue;
    visited.add(point); pending.push(...neighbours.get(point)!);
  }
  expect(visited.size).toBe(neighbours.size);
}

/** Group shared-edge hits before parity checks. Opposing normals mark a tangent, not a crossing. */
function crossings(mesh: THREE.Mesh, origin: THREE.Vector3, direction: THREE.Vector3, far: number) {
  const hits = new THREE.Raycaster(origin, direction, 0, far).intersectObject(mesh);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const groups: { distance: number; signs: Set<number> }[] = [];
  for (const hit of hits) {
    const dot = hit.face!.normal.clone().applyNormalMatrix(normalMatrix).dot(direction);
    const sign = Math.abs(dot) < 1e-7 ? 0 : Math.sign(dot);
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.distance - hit.distance) < 0.0001) previous.signs.add(sign);
    else groups.push({ distance: hit.distance, signs: new Set([sign]) });
  }
  return groups;
}

function classify(groups: ReturnType<typeof crossings>, distance: number): boolean | undefined {
  if (groups.some((group) => Math.abs(group.distance - distance) <= SURFACE_EPSILON)) return true;
  const before = groups.filter((group) => group.distance < distance);
  if (before.some((group) => group.signs.has(0) || group.signs.size !== 1)) return undefined;
  return before.length % 2 === 1;
}

function assertExposedCollisionContained(mesh: THREE.Mesh, solids: readonly SolidVolume[], height: (x: number, z: number) => number) {
  const probeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const probe = new THREE.Mesh(mesh.geometry, probeMaterial);
  probe.matrix.copy(mesh.matrix); probe.matrixAutoUpdate = false; probe.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(probe);
  const centre = bounds.getCenter(new THREE.Vector3());
  const diagonal = bounds.getSize(new THREE.Vector3()).length();
  const errors: { id: string; point: number[]; crossingHeights: number[]; oblique: boolean | undefined }[] = [];
  let checked = 0;
  try {
    for (const solid of solids) {
      if (solid.kind !== "box") throw new Error("Expected cut-face box");
      expect(solid.size.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
      const top = solid.position[1] + solid.size[1];
      const rayY = Math.max(bounds.max.y, top) + 1;
      const ratios = [-0.5, -0.25, 0, 0.25, 0.5];
      for (const x of ratios) for (const z of ratios) {
        const column = new THREE.Vector3(x * solid.size[0], 0, z * solid.size[2])
          .applyAxisAngle(UP, solid.rotationY).add(new THREE.Vector3(...solid.position));
        const rayOrigin = new THREE.Vector3(column.x, rayY, column.z);
        const groups = crossings(probe, rayOrigin, new THREE.Vector3(0, -1, 0), rayY - bounds.min.y + 1);
        const heights = Math.abs(x) === 0.5 || Math.abs(z) === 0.5 ? [0, 0.25, 0.5, 0.75, 1] : [0, 1];
        for (const y of heights) {
          const point = column.clone(); point.y += y * solid.size[1];
          if (point.y <= height(point.x, point.z) + SURFACE_EPSILON) continue;
          checked++;
          let contained = classify(groups, rayY - point.y);
          // A vertical ray can touch a crease without crossing it. Retry unchanged sample points
          // from oblique exterior origins instead of nudging protruding corners into the mesh.
          for (const direction of [new THREE.Vector3(0.371, 0.829, 0.419), new THREE.Vector3(-0.613, 0.733, 0.291)]) {
            if (contained !== undefined) break;
            direction.normalize();
            const distance = point.distanceTo(centre) + diagonal + 1;
            const origin = point.clone().addScaledVector(direction, -distance);
            contained = classify(crossings(probe, origin, direction, distance + SURFACE_EPSILON), distance);
          }
          if (contained !== true && errors.length < 8) {
            const direction = new THREE.Vector3(0.371, 0.829, 0.419).normalize();
            const distance = point.distanceTo(centre) + diagonal + 1;
            const origin = point.clone().addScaledVector(direction, -distance);
            errors.push({ id: solid.id, point: point.toArray(),
              crossingHeights: groups.map((group) => rayY - group.distance),
              oblique: classify(crossings(probe, origin, direction, distance + SURFACE_EPSILON), distance),
            });
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
    expect(errors).toEqual([]);
  } finally {
    probeMaterial.dispose();
  }
}

describe("authored stone mine cliff", () => {
  it("samples burial from actual rendered triangle indices rather than a bilinear saddle", () => {
    for (const flipped of [false, true]) {
      const geometry = new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2);
      const positions = geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) positions.setY(i, i === 0 || i === 3 ? 4 : 0);
      if (flipped) geometry.setIndex([0, 2, 3, 0, 3, 1]);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mesh.position.set(7, 3, 11); mesh.updateMatrixWorld(true);
      const scene = { getWalkableMeshes: () => [mesh], meshHeightAt: () => 5 } as unknown as WorldScene;
      const sample = createMineBurialSampler(scene);
      for (const [x, z] of [[6.3, 10.4], [7.6, 11.2], [6.8, 11.7], [7, 11]]) {
        const hit = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0]!;
        expect(sample(x!, z!)).toBeCloseTo(hit.point.y, 6);
      }
      // At the saddle's centre the diagonal differs by two metres from bilinear terrain.
      expect(Math.abs(sample(7, 11) - scene.meshHeightAt(7, 11))).toBeCloseTo(2, 6);
      geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
  });

  it("anchors behind authored slots independently of ore placement, appearance, dimensions, or depletion", async () => {
    const h = fixture();
    const first = await h.build();
    const changed = h.entities.map((entity): SemanticEntity => ({ ...entity,
      position: [800, 90, -700], state: "depleted", view: undefined,
    }));
    h.assets.assetSize.mockReturnValue({ x: 20, y: 0.1, z: 9 });
    const second = await h.build(h.site, changed);
    expect(Array.from((second.objects[0] as THREE.Mesh).geometry.getAttribute("position").array))
      .toEqual(Array.from((first.objects[0] as THREE.Mesh).geometry.getAttribute("position").array));
    expect(second.solids).toEqual(first.solids);
    const forward = new THREE.Vector3(Math.sin(h.site.rotationY), 0, Math.cos(h.site.rotationY));
    for (const entity of h.entities) {
      for (const point of [new THREE.Vector3(...entity.position), new THREE.Vector3(...entity.position).addScaledVector(forward, 1.4)]) {
        for (const solid of first.solids) expect(boxGap(point, solid)).toBeGreaterThanOrEqual(0.45);
      }
    }

    const flat = fixture(true);
    const original = vertices((await flat.build()).objects[0] as THREE.Mesh);
    const shifted = vertices((await flat.build({ ...flat.site,
      cutFace: { ...flat.site.cutFace!, frontSetback: SETBACK + 1 },
    })).objects[0] as THREE.Mesh);
    expect(shifted.length).toBe(original.length);
    for (let index = 0; index < original.length; index++) {
      expect(shifted[index]!.x).toBeCloseTo(original[index]!.x, 4);
      expect(shifted[index]!.y).toBeCloseTo(original[index]!.y, 4);
      expect(shifted[index]!.z).toBeCloseTo(original[index]!.z - 1, 4);
    }
    expect(Math.max(...original.map((point) => point.z))).toBeLessThan(-SETBACK + 0.7);
  });

  it("stitches a finite, connected, outward-facing closed shell across the station gap", async () => {
    const { build } = fixture();
    const { objects } = await build();
    expect(objects).toHaveLength(1);
    assertClosedShell(objects[0] as THREE.Mesh);
  });

  it("borrows one stone material, keeps metre-density front UVs, and owns only generated geometry", async () => {
    const { build, source, sourceGeometry, material, site } = fixture();
    const before = Array.from(sourceGeometry.getAttribute("position").array);
    const sourceDispose = vi.spyOn(sourceGeometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const { objects } = await build();
    expect(objects).toHaveLength(1);
    const mesh = objects[0] as THREE.Mesh;
    expect(mesh.children).toHaveLength(0);
    expect(mesh.parent).toBeNull();
    expect(mesh.material).toBe(material);
    expect(mesh.userData.ownedGeometry).toBe(true);
    expect(source.position.toArray()).toEqual([5, 2, -3]);
    expect(Array.from(sourceGeometry.getAttribute("position").array)).toEqual(before);
    const position = mesh.geometry.getAttribute("position"); const uv = mesh.geometry.getAttribute("uv");
    expect(Array.from(uv.array).every(Number.isFinite)).toBe(true);
    const forward = new THREE.Vector3(Math.sin(site.rotationY), 0, Math.cos(site.rotationY));
    const sampled = new Map<string, THREE.Vector2>();
    let measuredEdges = 0;
    for (let index = 0; index < position.count; index += 3) {
      const points = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(position, index + offset));
      const normal = new THREE.Vector3().crossVectors(points[1]!.clone().sub(points[0]!), points[2]!.clone().sub(points[0]!)).normalize();
      if (normal.dot(forward) < 0.92) continue;
      const coords = [0, 1, 2].map((offset) => new THREE.Vector2(uv.getX(index + offset), uv.getY(index + offset)));
      for (let edge = 0; edge < 3; edge++) {
        const key = points[edge]!.toArray().map((value) => value.toFixed(5)).join(",");
        const previous = sampled.get(key);
        if (previous) expect(previous.distanceTo(coords[edge]!)).toBeLessThan(0.0001);
        sampled.set(key, coords[edge]!);
        const next = (edge + 1) % 3;
        const ratio = coords[edge]!.distanceTo(coords[next]!) / points[edge]!.distanceTo(points[next]!);
        expect(ratio).toBeGreaterThan(0.85);
        expect(ratio).toBeLessThan(1.01);
        measuredEdges++;
      }
    }
    expect(measuredEdges).toBeGreaterThan(12);
    mesh.geometry.dispose();
    expect(sourceDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
  });

  it("sculpts irregular stone relief across the lower face instead of retaining flat ore windows", async () => {
    const { build } = fixture(true);
    const { objects } = await build();
    const mesh = objects[0] as THREE.Mesh; mesh.updateMatrixWorld(true);
    const depths: number[] = [];
    for (let y = 0.25; y < 1.6; y += 0.025) {
      const hit = new THREE.Raycaster(new THREE.Vector3(0.25, y, 1), new THREE.Vector3(0, 0, -1), 0, 10).intersectObject(mesh)[0];
      expect(hit).toBeDefined(); depths.push(hit!.point.z);
    }
    const residual = depths.map((depth, index) => depth - THREE.MathUtils.lerp(depths[0]!, depths.at(-1)!, index / (depths.length - 1)));
    const valleys = residual.filter((value, index) => index > 0 && index < residual.length - 1
      && value < residual[index - 1]! - 0.0001 && value < residual[index + 1]! - 0.0001);
    expect(Math.max(...residual) - Math.min(...residual)).toBeGreaterThan(0.04);
    expect(valleys.length).toBeGreaterThanOrEqual(2);
    const normals = mesh.geometry.getAttribute("normal");
    for (let index = 0; index < normals.count; index++) expect(new THREE.Vector3().fromBufferAttribute(normals, index).length()).toBeCloseTo(1, 5);
    expect(mesh.geometry.getAttribute("position").count / 3).toBeLessThan(12000);
  });

  it.each([false, true])("buries tapered ends and contains exposed collision in the final shell with steep=%s", async (steep) => {
    const h = fixture(true, steep);
    const { objects, solids } = await h.build();
    const mesh = objects[0] as THREE.Mesh;
    const points = vertices(mesh); const bounds = mesh.geometry.boundingBox!;
    const middle = points.filter((point) => Math.abs(point.x) < 0.4);
    const middleDepth = Math.max(...middle.map((point) => point.z)) - Math.min(...middle.map((point) => point.z));
    expect(middleDepth).toBeGreaterThan(1);
    for (const x of [bounds.min.x, bounds.max.x]) {
      const end = points.filter((point) => Math.abs(point.x - x) < 0.0001);
      expect(end.length).toBeGreaterThan(4);
      const depth = Math.max(...end.map((point) => point.z)) - Math.min(...end.map((point) => point.z));
      expect(depth).toBeLessThan(0.25);
      expect(depth).toBeLessThan(middleDepth * 0.2);
      for (const point of end) expect(point.y).toBeLessThanOrEqual(h.scene.meshHeightAt(point.x, point.z) - 0.10);
    }
    expect(solids.length).toBeGreaterThan(0);
    assertExposedCollisionContained(mesh, solids, h.scene.meshHeightAt);
  });

  it("buries a deep rear shell within a metre of its lip instead of exposing a long roof", async () => {
    const h = fixture(true);
    const result = await h.build({ ...h.site, cutFace: { ...h.site.cutFace!, backDepth: 10.5 } });
    const rear = vertices(result.objects[0] as THREE.Mesh)
      .filter((point) => point.z < -SETBACK - 1.7);
    expect(rear.length).toBeGreaterThan(100);
    for (const point of rear) {
      expect(point.y).toBeLessThanOrEqual(h.scene.meshHeightAt(point.x, point.z) - 0.10);
    }
  });

  it("keeps the closed underside below a curved two-metre terrain lattice", async () => {
    const h = fixture(true);
    const analytic = (x: number, z: number) => {
      const depth = Math.max(0, -z - SETBACK - 0.6);
      return 8 * THREE.MathUtils.smoothstep(depth, 0, 8) + Math.sin(x * 0.5) * depth * 0.05;
    };
    h.scene.meshHeightAt = (x: number, z: number) => {
      const x0 = Math.floor(x / 2) * 2, z0 = Math.floor(z / 2) * 2;
      const u = (x - x0) / 2, v = (z - z0) / 2;
      const a = analytic(x0, z0), b = analytic(x0 + 2, z0);
      const c = analytic(x0, z0 + 2), d = analytic(x0 + 2, z0 + 2);
      return u + v <= 1 ? a + u * (b - a) + v * (c - a)
        : d + (1 - u) * (c - d) + (1 - v) * (b - d);
    };
    const result = await h.build({ ...h.site, cutFace: { ...h.site.cutFace!, backDepth: 10.5 } });
    const mesh = result.objects[0] as THREE.Mesh;
    assertClosedShell(mesh);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const probe = new THREE.Mesh(mesh.geometry, material);
    probe.updateMatrixWorld(true);
    let checked = 0;
    for (const x of [-0.6, 0, 0.6]) for (let depth = 2; depth <= 9; depth += 0.2) {
      const z = -SETBACK - depth;
      const ground = h.scene.meshHeightAt(x, z);
      const hits = new THREE.Raycaster(new THREE.Vector3(x, ground + 12, z), new THREE.Vector3(0, -1, 0), 0, 30)
        .intersectObject(probe);
      expect(hits.length).toBeGreaterThan(0);
      const underside = hits.filter((hit) => hit.face!.normal.y < 0);
      expect(underside.length).toBeGreaterThan(0);
      for (const hit of underside) expect(hit.point.y, `buried underside at ${x},${z}`).toBeLessThan(ground - 0.1);
      // Beyond the receiving bank the complete shell, including its top, stays hidden.
      if (depth >= 5) for (const hit of hits) expect(hit.point.y).toBeLessThan(ground - 0.1);
      checked++;
    }
    expect(checked).toBeGreaterThan(90);
    const rearHit = new THREE.Raycaster(new THREE.Vector3(0, 3.0, -14), new THREE.Vector3(0, 0, 1), 0, 20)
      .intersectObject(probe).find((hit) => hit.face!.normal.y > 0)!;
    expect(rearHit).toBeDefined();
    // The receiving shoulder meets this rear ray as a sloped cap, not the near-vertical
    // back strip produced by forcing a high crest down to the work floor within one metre.
    expect(rearHit.face!.normal.y).toBeGreaterThan(0.45);
    material.dispose();
  });

  it("does nothing without a cut and requires each referenced station to be an ore entity", async () => {
    const { build, site, assets, entities } = fixture();
    expect(await build({ ...site, cutFace: undefined })).toEqual({ objects: [], solids: [] });
    expect(assets.load).not.toHaveBeenCalled();
    await expect(build(site, [])).rejects.toThrow(/station|resource|ore/i);
    await expect(build(site, entities.map((entity) => ({ ...entity, archetype: "tree" })))).rejects.toThrow(/station|resource|ore/i);
    expect(assets.load).not.toHaveBeenCalled();
  });
});
