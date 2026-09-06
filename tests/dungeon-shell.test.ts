import { createHash } from "node:crypto";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createCaveLabFixture } from "../game/src/featureLab/cave.js";
import type { SolidVolume } from "../game/src/contracts.js";
import type { CorealmSurfaceTextures } from "../game/src/render/corealmSurfaceMaterials.js";
import { buildDungeon, dungeonFloorHeight, dungeonSolids, type DungeonOptions, type DungeonSpec } from "../game/src/render/dungeon.js";
import { MaterialLibrary } from "../game/src/render/materials.js";

const MATERIAL_SPEC: DungeonSpec = {
  regionId: "gravelmaw",
  chambers: [
    { id: "test-upper", name: "Upper", centre: [2, -3], radius: 4.25, floorY: -7, lit: true },
    { id: "test-lower", name: "Lower", centre: [9, 0.5], radius: 4.75, floorY: -9.5, lit: false },
  ],
  corridors: [{ from: [2, -3], to: [9, 0.5], fromY: -7, toY: -9.5, width: 3.2 }],
  wallHeight: 9.3,
};
const LONG_SPEC: DungeonSpec = {
  regionId: "gravelmaw",
  chambers: [
    { id: "long-upper", name: "Upper", centre: [2, 5], radius: 4.25, floorY: -8, lit: true },
    { id: "long-lower", name: "Lower", centre: [31, 14], radius: 4.75, floorY: -11.2, lit: false },
  ],
  corridors: [{ from: [2, 5], to: [31, 14], fromY: -8, toY: -11.2, width: 4.6 }],
  wallHeight: 13,
};
const CASES = ["cave", "material", "material-capped", "long"] as const;
type CaseId = typeof CASES[number];
type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
interface Fixture {
  spec: DungeonSpec;
  options: DungeonOptions;
  group: THREE.Group;
  floor: Mesh;
  roof: Mesh;
  wall: Mesh;
  solids: SolidVolume[];
}

// Captured before the shell repair. None of the walkable floor's existing buffers may change.
const FLOOR_BASELINES = {
  cave: [352,
    "ebabbf829011ec1cca0e7aea8592a2131beced52965bfbd0864e1501e8f87ea9",
    "97dade86422c53f21bb4f39bb927a3eed89a6b07ec4864d1c75812121a80ab4e",
    "bf63767bb3d5744981194a5bdde9b7c9b3dbd71b5b3fae5b752ed0056fb9bf3f",
    "386430b0ed4e778312714e8bbbb28ec8b310a9ebbaa488e0b276993f46026a47"],
  material: [304,
    "21ce21f552da024856fba768353748a778d939f3a23362cc245438d904da50ac",
    "28f3ad318088e0f78be6512707f3ad79ebe36fd150b57bba351e863eaddc5b78",
    "171acd93b5ac51d096a10bbc5cdf577b658e99ba3da4ae9bba886afe1919a267",
    "91aa6a2cd055e1b59946c3c037f30ee6a561981e3f0338cc71b15f9ba311735c"],
  long: [720,
    "acb6601d8d53c1b77db9c1f63ef9c00ba58bf6511e3f03491470f653aafe72f0",
    "79b1a90a4d259572f0f7be272569f2364ebc504530f4460f9193368369e1dee8",
    "967d5de15ab5cc226f93ab71c497fbec495c9206fc42b6fa1fce682b429f98a2",
    "4d7ef67e368db6d92ef8ac61e27e4085120616698d3453582a7c3447886b99cd"],
};
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); });

function makeFixture(id: CaseId): Fixture {
  const materials = new MaterialLibrary();
  let spec: DungeonSpec, group: THREE.Group;
  const options: DungeonOptions = id === "material-capped" ? { ceilingAt: (x, z) => -1.5 + 0.08 * x - 0.06 * z } : {};
  if (id === "cave") {
    const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
    const maps: CorealmSurfaceTextures["stone"] = {
      albedo: textures[0]!, normal: textures[1]!, roughness: textures[2]!,
      meanLinearRgb: [0.22, 0.18, 0.13], tileMetres: 2.5,
    };
    const cave = createCaveLabFixture({ scene: { root: new THREE.Group(), materials },
      surfaceTextures: { bark: maps, stone: maps, leaf: maps } });
    spec = cave.spec;
    group = cave.group;
    cleanup.push(() => { cave.dispose(); for (const texture of textures) texture.dispose(); });
  } else {
    spec = id === "long" ? LONG_SPEC : MATERIAL_SPEC;
    const built = buildDungeon(spec, materials, options);
    group = built.group;
    cleanup.push(() => {
      const ownedMaterials = new Set<THREE.Material>();
      for (const object of group.children) {
        const mesh = object as Mesh;
        if (!mesh.isMesh) continue;
        mesh.geometry.dispose();
        ownedMaterials.add(mesh.material);
      }
      for (const material of ownedMaterials) material.dispose();
      group.removeFromParent();
    });
  }
  group.updateMatrixWorld(true);
  return {
    spec, options, group, solids: dungeonSolids(spec, options),
    floor: group.getObjectByName("dungeon-floor") as Mesh,
    roof: group.getObjectByName("dungeon-ceiling") as Mesh,
    wall: group.getObjectByName("dungeon-wall") as Mesh,
  };
}

function digest(array: ArrayBufferView | null): string | null {
  return array === null ? null : createHash("sha256")
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest("hex");
}
function floorSnapshot(geometry: THREE.BufferGeometry) {
  return [geometry.getAttribute("position").count,
    ...["position", "normal", "color"].map(name => digest(geometry.getAttribute(name).array)),
    digest(geometry.index?.array ?? null)];
}
function shellSnapshot(fixture: Fixture) {
  return [fixture.floor, fixture.wall, fixture.roof].map(mesh => ({ name: mesh.name,
    attributes: Object.keys(mesh.geometry.attributes).sort().map(name => [name, digest(mesh.geometry.getAttribute(name).array)]),
    index: digest(mesh.geometry.index?.array ?? null),
  }));
}
function hit(mesh: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3, far = 150) {
  return new THREE.Raycaster(origin, direction.clone().normalize(), 0.00001, far).intersectObject(mesh, true)[0];
}
function verticalProbe(fixture: Fixture, x: number, z: number) {
  const origin = new THREE.Vector3(x, 100, z), down = new THREE.Vector3(0, -1, 0);
  // The primary navigation floor stays byte-identical. Authored outward bays have an opaque
  // dressing apron in the rock mesh, after its vertical wall triangles.
  const apronStart = fixture.wall.geometry.userData.wallVertexCount / 3;
  const apron = new THREE.Raycaster(origin, down, 0.00001, 250).intersectObject(fixture.wall)
    .find(intersection => (intersection.faceIndex ?? -1) >= apronStart);
  const floor = hit(fixture.floor, origin, down, 250) ?? apron;
  expect(floor, `floor at ${x},${z}`).toBeDefined();
  const roof = hit(fixture.roof, new THREE.Vector3(x, floor!.point.y + 0.05, z), new THREE.Vector3(0, 1, 0));
  expect(roof, `roof above ${x},${floor!.point.y},${z}`).toBeDefined();
  expect(floor!.face!.normal.y).toBeGreaterThan(0);
  expect(roof!.face!.normal.y).toBeLessThan(0);
  return { floorY: floor!.point.y, roofY: roof!.point.y };
}
function routePoints(spec: DungeonSpec, maxStep: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const corridor of spec.corridors) {
    const from = new THREE.Vector2(...corridor.from), to = new THREE.Vector2(...corridor.to);
    const steps = Math.ceil(from.distanceTo(to) / maxStep);
    for (let i = 0; i <= steps; i++) out.push(from.clone().lerp(to, i / steps));
  }
  return out;
}
function interiorPoints(spec: DungeonSpec): THREE.Vector2[] {
  const points = routePoints(spec, 4);
  for (const chamber of spec.chambers) {
    for (const side of [-1, 1]) points.push(new THREE.Vector2(chamber.centre[0], chamber.centre[1] + chamber.radius * 0.28 * side));
  }
  return points;
}
function firstContourExit(fixture: Fixture, point: THREE.Vector2, direction: THREE.Vector3): number {
  // V6 authors explicit asymmetric bay contours outside the old circular rooms. Intersect that
  // measured contour independently in 2D; a distant wall cannot hide a missing nearer face.
  // This replaces old-circle exit + 1.5 m with actual-contour exit + 2.5 cm.
  const contours = fixture.wall.geometry.userData.outerContours as [number, number][][];
  let nearest = Infinity;
  for (const contour of contours) for (let i = 0; i < contour.length; i++) {
    const a = contour[i]!, b = contour[(i + 1) % contour.length]!;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const cross = direction.x * ez - direction.z * ex;
    if (Math.abs(cross) < 1e-9) continue;
    const px = a[0] - point.x, pz = a[1] - point.y;
    const distance = (px * ez - pz * ex) / cross;
    const along = (px * direction.z - pz * direction.x) / cross;
    if (distance > 0 && along >= 0 && along <= 1) nearest = Math.min(nearest, distance);
  }
  expect(Number.isFinite(nearest)).toBe(true);
  return nearest + 0.025;
}
function note(origin: THREE.Vector3, direction: THREE.Vector3): string {
  const numbers = (p: THREE.Vector3) => p.toArray().map(value => Number(value.toFixed(6))).join(",");
  return `origin=[${numbers(origin)}] direction=[${numbers(direction)}]`;
}
function distanceToSolid(point: THREE.Vector3, solid: SolidVolume): number {
  if (solid.kind !== "box") return Infinity;
  const dx = point.x - solid.position[0], dz = point.z - solid.position[2];
  const cos = Math.cos(solid.rotationY ?? 0), sin = Math.sin(solid.rotationY ?? 0);
  const x = dx * cos - dz * sin, y = point.y - solid.position[1], z = dx * sin + dz * cos;
  return Math.hypot(Math.max(0, Math.abs(x) - solid.size[0] / 2),
    Math.max(0, -y, y - solid.size[1]), Math.max(0, Math.abs(z) - solid.size[2] / 2));
}
function oldJoinPoints(spec: DungeonSpec): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < spec.chambers.length; i++) for (let j = i + 1; j < spec.chambers.length; j++) {
    const a = spec.chambers[i]!, b = spec.chambers[j]!;
    const ca = new THREE.Vector2(...a.centre), cb = new THREE.Vector2(...b.centre);
    const r = a.radius + 1.2, s = b.radius + 1.2, distance = ca.distanceTo(cb);
    if (distance >= r + s || distance <= Math.abs(r - s)) continue;
    const along = (r * r - s * s + distance * distance) / (2 * distance);
    const height = Math.sqrt(r * r - along * along);
    const direction = cb.sub(ca).normalize(), perpendicular = new THREE.Vector2(-direction.y, direction.x);
    for (const side of [-1, 1]) points.push(ca.clone().addScaledVector(direction, along).addScaledVector(perpendicular, side * height));
  }
  for (const corridor of spec.corridors) {
    const from = new THREE.Vector2(...corridor.from), to = new THREE.Vector2(...corridor.to);
    const direction = to.clone().sub(from).normalize(), perpendicular = new THREE.Vector2(-direction.y, direction.x);
    const halfWidth = corridor.width / 2 + 0.5;
    for (const [endpoint, sign] of [[from, 1], [to, -1]] as const) {
      const chamber = spec.chambers.find(chamber => endpoint.distanceTo(new THREE.Vector2(...chamber.centre)) < 0.001);
      if (!chamber || chamber.radius + 1.2 <= halfWidth) continue;
      const along = Math.sqrt((chamber.radius + 1.2) ** 2 - halfWidth ** 2);
      for (const side of [-1, 1]) points.push(endpoint.clone().addScaledVector(direction, sign * along).addScaledVector(perpendicular, side * halfWidth));
    }
  }
  return points;
}

describe("continuous production dungeon shell", () => {
  it.each(CASES)("keeps near shell faces opaque from inside and outside camera positions (%s)", id => {
    const fixture = makeFixture(id);
    for (const mesh of [fixture.floor, fixture.wall, fixture.roof]) {
      expect(mesh.material.opacity).toBe(1);
      expect(mesh.material.transparent).toBe(false);
      expect(mesh.material.side).toBe(THREE.DoubleSide);
      const geometry = mesh.geometry, position = geometry.getAttribute("position");
      const count = geometry.index?.count ?? position.count;
      const vertex = (index: number) => new THREE.Vector3().fromBufferAttribute(position, geometry.index?.getX(index) ?? index);
      const stride = Math.max(1, Math.floor(count / 3 / 48)) * 3;
      for (let index = 0; index < count; index += stride) {
        const a = vertex(index), b = vertex(index + 1), c = vertex(index + 2);
        const centre = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        for (const side of [-1, 1]) {
          const origin = centre.clone().addScaledVector(normal, side * 0.08);
          const direction = normal.clone().multiplyScalar(-side);
          const first = hit(mesh, origin, direction, 0.0801);
          expect(first, `${mesh.name} triangle ${index / 3}, camera side ${side}`).toBeDefined();
        }
      }
    }
  });

  it("has no open wall edges between its buried footing and roof overlap", () => {
    const fixture = makeFixture("cave"), position = fixture.wall.geometry.getAttribute("position");
    const point = (index: number) => new THREE.Vector3().fromBufferAttribute(position, index);
    const key = (index: number) => point(index).toArray().map(value => Math.round(value * 100000)).join(",");
    const edges = new Map<string, { count: number; a: number; b: number }>();
    for (let index = 0; index < fixture.wall.geometry.userData.wallVertexCount; index += 3) {
      for (const [a, b] of [[index, index + 1], [index + 1, index + 2], [index + 2, index]]) {
        const edgeKey = [key(a!), key(b!)].sort().join("|");
        const edge = edges.get(edgeKey) ?? { count: 0, a: a!, b: b! };
        edge.count++;
        edges.set(edgeKey, edge);
      }
    }
    let footEdges = 0, roofEdges = 0;
    for (const edge of edges.values()) {
      expect(edge.count).toBeLessThanOrEqual(2);
      if (edge.count === 2) continue;
      const ends = [edge.a, edge.b].map(index => {
        const p = point(index);
        return { y: p.y, ...verticalProbe(fixture, p.x, p.z) };
      });
      const foot = ends.every(p => p.y < p.floorY - 0.3);
      const roof = ends.every(p => p.y > p.roofY + 0.3);
      expect(foot || roof, `open wall edge: ${point(edge.a).toArray()} to ${point(edge.b).toArray()}`).toBe(true);
      if (foot) footEdges++;
      if (roof) roofEdges++;
    }
    expect(footEdges).toBeGreaterThan(0);
    expect(roofEdges).toBe(footEdges);
  });

  it.each(CASES)("keeps the original floor immutable and emits deterministic finite geometry and solids (%s)", id => {
    const a = makeFixture(id), b = makeFixture(id);
    expect(floorSnapshot(a.floor.geometry)).toEqual(FLOOR_BASELINES[id === "material-capped" ? "material" : id]);
    expect(shellSnapshot(a)).toEqual(shellSnapshot(b));
    expect(a.solids).toEqual(b.solids);
    expect(new Set(a.solids.map(solid => solid.id)).size).toBe(a.solids.length);
    expect(a.solids.length).toBeGreaterThan(2);
    for (const solid of a.solids) {
      expect(solid.kind).toBe("box");
      if (solid.kind !== "box") continue;
      expect([...solid.position, ...solid.size, solid.rotationY ?? 0].every(Number.isFinite)).toBe(true);
      expect(solid.size.every(value => value > 0)).toBe(true);
    }
    for (const mesh of [a.floor, a.wall, a.roof]) {
      expect(mesh.material.side).toBe(THREE.DoubleSide);
      for (const attribute of Object.values(mesh.geometry.attributes)) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    }
  });

  it.each(CASES)("encloses dense interior and connector views with front-facing floor, wall and roof (%s)", id => {
    const fixture = makeFixture(id);
    const misses: string[] = [];
    for (const point of interiorPoints(fixture.spec)) {
      const { floorY, roofY } = verticalProbe(fixture, point.x, point.y);
      expect(roofY - floorY, `headroom at ${point.toArray()}`).toBeGreaterThanOrEqual(4 - 0.0001);
      for (const height of [floorY + 0.2, floorY + 1.7, roofY - 0.2]) {
        const origin = new THREE.Vector3(point.x, height, point.y);
        for (let angleIndex = 0; angleIndex < 128; angleIndex++) {
          const angle = angleIndex * Math.PI * 2 / 128;
          const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
          const first = hit(fixture.group, origin, direction);
          const far = firstContourExit(fixture, point, direction);
          if (!first || first.distance > far) misses.push(`horizontal ${note(origin, direction)} hit=${first?.object.name ?? "none"} distance=${first?.distance ?? "none"} limit=${far}`);
          else if (first.face!.normal.dot(direction) >= 0) misses.push(`wrong winding ${note(origin, direction)}`);
        }
      }
      const origin = new THREE.Vector3(point.x, floorY + 1.7, point.y);
      for (let i = 0; i < 192; i++) {
        const y = 1 - 2 * (i + 0.5) / 192, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
        const direction = new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));
        if (!hit(fixture.group, origin, direction)) misses.push(`spherical ${note(origin, direction)}`);
      }
    }
    expect(misses.slice(0, 12), `${misses.length} enclosure failures in ${id}`).toEqual([]);
  }, 20_000);

  it.each(CASES)("closes old chamber and corridor joins at walking and near-roof heights (%s)", id => {
    const fixture = makeFixture(id), joins = oldJoinPoints(fixture.spec);
    expect(joins.length).toBeGreaterThan(0);
    const misses: string[] = [];
    for (const chamber of fixture.spec.chambers) {
      const [x, z] = chamber.centre, { floorY, roofY } = verticalProbe(fixture, x, z);
      for (const target of joins) {
        const bearing = Math.atan2(target.y - z, target.x - x);
        for (const offset of [-0.02, -0.005, -0.001, 0, 0.001, 0.005, 0.02]) {
          for (const height of [floorY + 1.2, roofY - 0.15]) {
            const origin = new THREE.Vector3(x, height, z);
            const direction = new THREE.Vector3(Math.cos(bearing + offset), 0, Math.sin(bearing + offset));
            const first = hit(fixture.group, origin, direction);
            const far = firstContourExit(fixture, new THREE.Vector2(x, z), direction);
            if (!first || first.distance > far) misses.push(`join ${note(origin, direction)} target=[${target.toArray()}]`);
          }
          const origin = new THREE.Vector3(x, floorY + 1.7, z);
          const direction = new THREE.Vector3(Math.cos(bearing + offset), 0.65, Math.sin(bearing + offset)).normalize();
          if (!hit(fixture.group, origin, direction)) misses.push(`roof join ${note(origin, direction)}`);
        }
      }
    }
    expect(misses.slice(0, 12), `${misses.length} join failures in ${id}`).toEqual([]);
  });

  it.each(CASES)("backs the exposed chamber and connector walls with collision (%s)", id => {
    const fixture = makeFixture(id);
    const solids = fixture.solids.filter(solid => !solid.id.startsWith("dungeon-ceiling"));
    const missing: string[] = [];
    let wallHits = 0;
    for (const point of interiorPoints(fixture.spec)) {
      const { floorY } = verticalProbe(fixture, point.x, point.y);
      const origin = new THREE.Vector3(point.x, floorY + 1.7, point.y);
      for (let i = 0; i < 64; i++) {
        const angle = i * Math.PI * 2 / 64;
        const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const first = hit(fixture.group, origin, direction);
        // A rising floor can meet this horizontal eye ray before a more distant wall.
        if (first?.object !== fixture.wall) continue;
        wallHits++;
        const gap = Math.min(...solids.map(solid => distanceToSolid(first.point, solid)));
        // Allow the shallow dressed ledge beyond the box face, not an uncollidable corridor.
        if (gap > 0.16) missing.push(`${note(origin, direction)} wall=[${first.point.toArray()}] colliderGap=${gap}`);
      }
    }
    expect(wallHits).toBeGreaterThan(64);
    expect(missing.slice(0, 12), `${missing.length} wall collision gaps in ${id}`).toEqual([]);
  });

  it.each(CASES)("keeps angular roof relief within the cap and exposes several wall courses (%s)", id => {
    const fixture = makeFixture(id), floor = fixture.floor.geometry.getAttribute("position");
    const roof = fixture.roof.geometry.getAttribute("position"), roofIndex = fixture.roof.geometry.index;
    const floorHeights = new Map<string, number>();
    for (let i = 0; i < floor.count; i++) floorHeights.set(`${floor.getX(i)},${floor.getZ(i)}`, floor.getY(i));
    let maximumRelief = 0;
    const reliefs: number[] = [];
    const referenced = roofIndex ? new Set(Array.from(roofIndex.array)) : new Set(Array.from({ length: roof.count }, (_, i) => i));
    for (const i of referenced) {
      const x = roof.getX(i), y = roof.getY(i), z = roof.getZ(i);
      const floorY = floorHeights.get(`${x},${z}`) ?? dungeonFloorHeight(fixture.spec, x, z);
      const nominal = Math.max(floorY + 4, Math.min(floorY + fixture.spec.wallHeight, fixture.options.ceilingAt?.(x, z) ?? Infinity));
      expect(y, `roof cap at ${x},${z}`).toBeLessThanOrEqual(nominal + 0.00001);
      expect(y, `roof relief at ${x},${z}`).toBeGreaterThanOrEqual(nominal - 1.4 - 0.00001);
      expect(y - floorY, `minimum roof clearance at ${x},${z}`).toBeGreaterThanOrEqual(4 - 0.00001);
      maximumRelief = Math.max(maximumRelief, nominal - y);
      reliefs.push(nominal - y);
    }
    expect(maximumRelief).toBeGreaterThan(0.15);
    expect(Math.max(...reliefs) - Math.min(...reliefs)).toBeGreaterThan(0.1);
    const wall = fixture.wall.geometry.getAttribute("position"), normals = fixture.wall.geometry.getAttribute("normal");
    expect(fixture.wall.geometry.index).toBeNull();
    expect(wall.count % 6).toBe(0);
    let interiorCourseVertices = 0, slopedFaceVertices = 0;
    for (let i = 0; i < wall.count; i++) {
      const height = wall.getY(i) - dungeonFloorHeight(fixture.spec, wall.getX(i), wall.getZ(i));
      if (height > 1 && height < fixture.spec.wallHeight - 2) interiorCourseVertices++;
      if (Math.abs(normals.getY(i)) > 0.08) slopedFaceVertices++;
    }
    expect(interiorCourseVertices).toBeGreaterThan(24);
    expect(slopedFaceVertices).toBeGreaterThan(24);
  });

  it("retains 13-metre shell headroom and a 3.4-metre gate approach through the long corridor", () => {
    const fixture = makeFixture("long"), corridor = fixture.spec.corridors[0]!;
    const direction = new THREE.Vector2(corridor.to[0] - corridor.from[0], corridor.to[1] - corridor.from[1]).normalize();
    const perpendicular = new THREE.Vector2(-direction.y, direction.x);
    expect(new THREE.Vector2(...corridor.from).distanceTo(new THREE.Vector2(...corridor.to)))
      .toBeGreaterThan(fixture.spec.chambers.reduce((sum, chamber) => sum + chamber.radius + 1.2, 0));
    const points = routePoints(fixture.spec, 0.75);
    const lanes = [-1.7, 0, 1.7];
    for (const lane of lanes) {
      let previous: THREE.Vector3 | undefined;
      for (const centre of points) {
        const point = centre.clone().addScaledVector(perpendicular, lane);
        const { floorY, roofY } = verticalProbe(fixture, point.x, point.y);
        expect(roofY - floorY, `13m shell headroom lane=${lane} at ${point.toArray()}`).toBeGreaterThanOrEqual(11.6 - 0.0001);
        const current = new THREE.Vector3(point.x, floorY, point.y);
        for (const height of [0.25, 1.7, 3.3]) {
          const probe = current.clone().add(new THREE.Vector3(0, height, 0));
          for (const solid of fixture.solids) {
            if (solid.kind !== "box" || solid.id.startsWith("dungeon-ceiling")) continue;
            const dx = probe.x - solid.position[0], dz = probe.z - solid.position[2];
            const cos = Math.cos(solid.rotationY ?? 0), sin = Math.sin(solid.rotationY ?? 0);
            const within = Math.abs(dx * cos - dz * sin) < solid.size[0] / 2 - 0.0001
              && Math.abs(dx * sin + dz * cos) < solid.size[2] / 2 - 0.0001
              && probe.y > solid.position[1] && probe.y < solid.position[1] + solid.size[1];
            expect(within, `gate approach collider ${solid.id} at ${probe.toArray()}`).toBe(false);
          }
          if (previous) {
            const origin = previous.clone().add(new THREE.Vector3(0, height, 0));
            const segment = probe.clone().sub(origin);
            expect(hit(fixture.wall, origin, segment, segment.length()), `walk lane ${lane}: ${note(origin, segment)}`).toBeUndefined();
          }
        }
        previous = current;
      }
    }
  });
});
