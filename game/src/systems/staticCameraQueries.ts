import * as THREE from "three";
import type { Vec3 } from "../contracts.js";

export interface HeightfieldInput {
  /** Column-major samples, with (nrows + 1) * (ncols + 1) entries. */
  heights: Float32Array;
  /** Subdivisions along Z. */
  nrows: number;
  /** Subdivisions along X. */
  ncols: number;
  /** Total horizontal world extents and the height multiplier. */
  scale: { x: number; y: number; z: number };
  centre: { x: number; y: number; z: number };
}

type Bounds = { min: [number, number, number]; max: [number, number, number] };
type Ray = { origin: Vec3; direction: Vec3 };
type Bounded = { bounds: Bounds };
type Tree<T extends Bounded> = Bounded & (
  | { items: T[]; left?: never; right?: never }
  | { items?: never; left: Tree<T>; right: Tree<T> }
);
type Triangle = Bounded & { a: Vec3; b: Vec3; c: Vec3 };
type Shape = Bounded & (
  | { kind: "box"; centre: Vec3; halfExtents: Vec3; cosine: number; sine: number; ownerId?: string; cutHeight: number }
  | { kind: "cylinder"; base: Vec3; radius: number; height: number }
  | { kind: "mesh"; tree: Tree<Triangle>; entityId?: string; hidden: boolean; hard: boolean }
  | { kind: "heightfield"; field: HeightfieldInput; stepX: number; stepZ: number }
);

const LEAF_SIZE = 8;

function emptyBounds(): Bounds {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function include(bounds: Bounds, point: Vec3): void {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis]!, point[axis]!);
    bounds.max[axis] = Math.max(bounds.max[axis]!, point[axis]!);
  }
}

function buildTree<T extends Bounded>(items: T[]): Tree<T> {
  const bounds = emptyBounds();
  const centres = emptyBounds();
  for (const item of items) {
    include(bounds, item.bounds.min);
    include(bounds, item.bounds.max);
    include(centres, [
      item.bounds.min[0] + item.bounds.max[0],
      item.bounds.min[1] + item.bounds.max[1],
      item.bounds.min[2] + item.bounds.max[2],
    ]);
  }
  if (items.length <= LEAF_SIZE) return { bounds, items };
  let axis = 0;
  for (let candidate = 1; candidate < 3; candidate += 1) {
    if (centres.max[candidate]! - centres.min[candidate]! > centres.max[axis]! - centres.min[axis]!) {
      axis = candidate;
    }
  }
  // Partition around the spatial midpoint in one pass. Sorting every subtree spent seconds
  // comparing the cave's triangles during boot; queries only require disjoint item ownership
  // and enclosing bounds, not sorted leaves.
  const split = (centres.min[axis]! + centres.max[axis]!) / 2;
  let middle = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.bounds.min[axis]! + item.bounds.max[axis]! < split) {
      items[index] = items[middle]!;
      items[middle++] = item;
    }
  }
  // Coincident centres and extremely skewed distributions must still produce a bounded tree.
  if (middle < items.length / 8 || middle > items.length * 7 / 8) middle = Math.floor(items.length / 2);
  return { bounds, left: buildTree(items.slice(0, middle)), right: buildTree(items.slice(middle)) };
}

/** Inclusive slabs also give zero for a solid box containing the origin. */
function boundsInterval(ray: Ray, bounds: Bounds, limit: number): [number, number] | null {
  let near = 0;
  let far = limit;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis]!;
    const direction = ray.direction[axis]!;
    // Inverse yaw can leave a corner a few ulps outside a slab, with a nominally parallel
    // direction around 1e-16. Dividing those residues invents a several-metre entry distance.
    const roundoff = 32 * Number.EPSILON * Math.max(1, Math.abs(origin), Math.abs(bounds.min[axis]!), Math.abs(bounds.max[axis]!));
    if (Math.abs(direction) <= 32 * Number.EPSILON
      && origin >= bounds.min[axis]! - roundoff && origin <= bounds.max[axis]! + roundoff) continue;
    if (direction === 0) {
      if (origin < bounds.min[axis]! || origin > bounds.max[axis]!) return null;
    } else {
      const first = (bounds.min[axis]! - origin) / direction;
      const second = (bounds.max[axis]! - origin) / direction;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) return null;
    }
  }
  return [near, far];
}

function castTree<T extends Bounded>(
  tree: Tree<T>, ray: Ray, limit: number, cast: (item: T, ray: Ray, limit: number) => number | null,
): number | null {
  if (!boundsInterval(ray, tree.bounds, limit)) return null;
  let closest: number | null = null;
  if (tree.items) {
    for (const item of tree.items) {
      if (!boundsInterval(ray, item.bounds, closest ?? limit)) continue;
      const hit = cast(item, ray, closest ?? limit);
      if (hit !== null) closest = hit;
      if (closest === 0) break;
    }
    return closest;
  }
  const leftNear = boundsInterval(ray, tree.left.bounds, limit)?.[0];
  const rightNear = boundsInterval(ray, tree.right.bounds, limit)?.[0];
  if (leftNear === undefined && rightNear === undefined) return null;
  const leftFirst = (leftNear ?? Infinity) <= (rightNear ?? Infinity);
  const first = leftFirst ? tree.left : tree.right;
  const second = leftFirst ? tree.right : tree.left;
  closest = castTree(first, ray, limit, cast);
  if (closest === 0) return 0;
  return castTree(second, ray, closest ?? limit, cast) ?? closest;
}

/** Both triangle faces block the camera, independent of rendering material or winding. */
function castTriangle(triangle: Pick<Triangle, "a" | "b" | "c">, ray: Ray, limit: number): number | null {
  const { a, b, c } = triangle;
  const [dx, dy, dz] = ray.direction;
  const e1x = b[0] - a[0]; const e1y = b[1] - a[1]; const e1z = b[2] - a[2];
  const e2x = c[0] - a[0]; const e2y = c[1] - a[1]; const e2z = c[2] - a[2];
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;
  if (determinant === 0) return null;
  const tx = ray.origin[0] - a[0]; const ty = ray.origin[1] - a[1]; const tz = ray.origin[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) / determinant;
  if (u < -1e-10 || u > 1 + 1e-10) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) / determinant;
  if (v < -1e-10 || u + v > 1 + 1e-10) return null;
  const distance = (e2x * qx + e2y * qy + e2z * qz) / determinant;
  // Rapier surface queries accept an origin on the incoming face, but not the departing face.
  if (distance === 0 && determinant < 0) return null;
  return distance >= 0 && distance <= limit ? Math.max(0, distance) : null;
}

function castCylinder(shape: Extract<Shape, { kind: "cylinder" }>, ray: Ray, limit: number): number | null {
  const x = ray.origin[0] - shape.base[0];
  const y = ray.origin[1] - shape.base[1];
  const z = ray.origin[2] - shape.base[2];
  const [dx, dy, dz] = ray.direction;
  const radiusSquared = shape.radius * shape.radius;
  if (x * x + z * z <= radiusSquared && y >= 0 && y <= shape.height) return 0;
  let closest: number | null = null;
  const accept = (distance: number): void => {
    if (distance >= 0 && distance <= (closest ?? limit)) closest = distance;
  };
  const a = dx * dx + dz * dz;
  const b = x * dx + z * dz;
  const c = x * x + z * z - radiusSquared;
  const discriminant = b * b - a * c;
  if (a > 0 && discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    for (const distance of [(-b - root) / a, (-b + root) / a]) {
      const hitY = y + distance * dy;
      if (hitY >= 0 && hitY <= shape.height) accept(distance);
    }
  }
  if (dy !== 0) {
    for (const capY of [0, shape.height]) {
      const distance = (capY - y) / dy;
      const hitX = x + distance * dx;
      const hitZ = z + distance * dz;
      if (hitX * hitX + hitZ * hitZ <= radiusSquared) accept(distance);
    }
  }
  return closest;
}

function castHeightfield(shape: Extract<Shape, { kind: "heightfield" }>, ray: Ray, limit: number): number | null {
  const interval = boundsInterval(ray, shape.bounds, limit);
  if (!interval) return null;
  const { field, stepX, stepZ } = shape;
  const start = interval[0];
  const end = interval[1];
  const startX = ray.origin[0] + ray.direction[0] * start;
  const startZ = ray.origin[2] + ray.direction[2] * start;
  const minX = shape.bounds.min[0];
  const minZ = shape.bounds.min[2];
  let col = Math.max(0, Math.min(field.ncols - 1, Math.floor((startX - minX) / stepX)));
  let row = Math.max(0, Math.min(field.nrows - 1, Math.floor((startZ - minZ) / stepZ)));
  const incrementX = Math.sign(ray.direction[0]);
  const incrementZ = Math.sign(ray.direction[2]);
  const deltaX = incrementX === 0 ? Infinity : stepX / Math.abs(ray.direction[0]);
  const deltaZ = incrementZ === 0 ? Infinity : stepZ / Math.abs(ray.direction[2]);
  let nextX = incrementX === 0 ? Infinity
    : (minX + (col + (incrementX > 0 ? 1 : 0)) * stepX - ray.origin[0]) / ray.direction[0];
  let nextZ = incrementZ === 0 ? Infinity
    : (minZ + (row + (incrementZ > 0 ? 1 : 0)) * stepZ - ray.origin[2]) / ray.direction[2];
  const vertex = (x: number, z: number): Vec3 => [
    minX + x * stepX,
    field.centre.y + field.heights[x * (field.nrows + 1) + z]! * field.scale.y,
    minZ + z * stepZ,
  ];
  while (col >= 0 && col < field.ncols && row >= 0 && row < field.nrows) {
    const a = vertex(col, row);
    const b = vertex(col, row + 1);
    const c = vertex(col + 1, row);
    const d = vertex(col + 1, row + 1);
    const first = castTriangle({ a, b, c }, ray, end);
    const second = castTriangle({ a: b, b: d, c }, ray, first ?? end);
    const hit = second ?? first;
    if (hit !== null) return hit;
    const next = Math.min(nextX, nextZ);
    if (next > end || !Number.isFinite(next)) break;
    if (nextX === next) { col += incrementX; nextX += deltaX; }
    if (nextZ === next) { row += incrementZ; nextZ += deltaZ; }
  }
  return null;
}

function castShape(shape: Shape, ray: Ray, limit: number, hardOnly = false): number | null {
  // Terrain cannot be opened by the building cutaway. Fixed follow uses only this cast, so
  // excluding heightfields lets its requested seat pass straight through a raised bank.
  if (hardOnly && shape.kind !== "heightfield" && !(shape.kind === "mesh" && shape.hard)) return null;
  switch (shape.kind) {
    case "mesh": return shape.hidden ? null : castTree(shape.tree, ray, limit, castTriangle);
    case "heightfield": return castHeightfield(shape, ray, limit);
    case "cylinder": return castCylinder(shape, ray, limit);
    case "box": {
      const top = Math.min(shape.halfExtents[1], shape.cutHeight - shape.centre[1]);
      if (top <= -shape.halfExtents[1]) return null;
      const x = ray.origin[0] - shape.centre[0];
      const z = ray.origin[2] - shape.centre[2];
      const [dx, dy, dz] = ray.direction;
      const local: Ray = {
        origin: [shape.cosine * x - shape.sine * z, ray.origin[1] - shape.centre[1], shape.sine * x + shape.cosine * z],
        direction: [shape.cosine * dx - shape.sine * dz, dy, shape.sine * dx + shape.cosine * dz],
      };
      return boundsInterval(local, {
        min: [-shape.halfExtents[0], -shape.halfExtents[1], -shape.halfExtents[2]],
        max: [shape.halfExtents[0], top, shape.halfExtents[2]],
      }, limit)?.[0] ?? null;
    }
  }
}

/**
 * Static camera occlusion geometry. Registration takes a snapshot; edits need clearStatic and
 * registration again. Scene and triangle BVHs bound structural queries, while terrain rays visit
 * only crossed grid cells. No simulation step, dynamic bodies, or rendering materials are involved.
 */
export class StaticCameraQueries {
  private shapes: Shape[] = [];
  private tree: Tree<Shape> | null = null;
  private dirty = false;

  addHeightfield(input: HeightfieldInput): boolean {
    if (!Number.isInteger(input.nrows) || input.nrows < 1 || !Number.isInteger(input.ncols) || input.ncols < 1
      || input.heights.length !== (input.nrows + 1) * (input.ncols + 1)
      || ![input.scale.x, input.scale.y, input.scale.z, input.centre.x, input.centre.y, input.centre.z].every(Number.isFinite)
      || input.scale.x <= 0 || input.scale.z <= 0) return false;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const height of input.heights) {
      if (!Number.isFinite(height)) return false;
      const y = input.centre.y + height * input.scale.y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const field = { ...input, heights: input.heights.slice(), centre: { ...input.centre }, scale: { ...input.scale } };
    this.add({
      kind: "heightfield", field, stepX: input.scale.x / input.ncols, stepZ: input.scale.z / input.nrows,
      bounds: {
        min: [input.centre.x - input.scale.x / 2, minY, input.centre.z - input.scale.z / 2],
        max: [input.centre.x + input.scale.x / 2, maxY, input.centre.z + input.scale.z / 2],
      },
    });
    return true;
  }

  addStaticBox(centre: Vec3, halfExtents: Vec3, rotationY = 0, ownerId?: string): boolean {
    if (![...centre, ...halfExtents, rotationY].every(Number.isFinite) || halfExtents.some((extent) => extent < 0)) return false;
    const cosine = Math.cos(rotationY);
    const sine = Math.sin(rotationY);
    const extentX = Math.abs(cosine) * halfExtents[0] + Math.abs(sine) * halfExtents[2];
    const extentZ = Math.abs(sine) * halfExtents[0] + Math.abs(cosine) * halfExtents[2];
    this.add({
      kind: "box", centre: [...centre], halfExtents: [...halfExtents], cosine, sine, ownerId, cutHeight: Infinity,
      bounds: {
        min: [centre[0] - extentX, centre[1] - halfExtents[1], centre[2] - extentZ],
        max: [centre[0] + extentX, centre[1] + halfExtents[1], centre[2] + extentZ],
      },
    });
    return true;
  }

  addStaticCylinder(base: Vec3, radius: number, height: number): boolean {
    if (![...base, radius, height].every(Number.isFinite) || radius < 0 || height < 0) return false;
    this.add({
      kind: "cylinder", base: [...base], radius, height,
      bounds: { min: [base[0] - radius, base[1], base[2] - radius], max: [base[0] + radius, base[1] + height, base[2] + radius] },
    });
    return true;
  }

  addStaticMesh(mesh: THREE.Mesh): boolean {
    const position = mesh.geometry.getAttribute("position");
    if (!position) return false;
    mesh.updateWorldMatrix(true, false);
    const point = new THREE.Vector3();
    const vertices: Vec3[] = [];
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position as THREE.BufferAttribute, index).applyMatrix4(mesh.matrixWorld);
      if (![point.x, point.y, point.z].every(Number.isFinite)) return false;
      // The old static trimesh path gave Rapier Float32 world vertices.
      vertices.push([Math.fround(point.x), Math.fround(point.y), Math.fround(point.z)]);
    }
    const index = mesh.geometry.getIndex();
    const count = index?.count ?? position.count;
    const triangles: Triangle[] = [];
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const a = vertices[index ? index.getX(offset) : offset];
      const b = vertices[index ? index.getX(offset + 1) : offset + 1];
      const c = vertices[index ? index.getX(offset + 2) : offset + 2];
      if (!a || !b || !c) return false;
      const bounds = emptyBounds();
      include(bounds, a); include(bounds, b); include(bounds, c);
      triangles.push({ a, b, c, bounds });
    }
    if (triangles.length === 0) return false;
    const tree = buildTree(triangles);
    this.add({ kind: "mesh", tree, bounds: tree.bounds, hidden: false,
      entityId: mesh.userData["structureCamera"] as string | undefined,
      // Opt-in, never inferred: a mesh is a hard blocker only when its author says no cutaway can
      // ever open it. Untagged structure meshes stay ordinary so town framing is unaffected.
      hard: mesh.userData["cameraHardBlocker"] === true });
    return true;
  }

  /**
   * Normalizes direction and returns metres. Like Rapier World.castRay, the end is exclusive.
   *
   * `hardOnly` restricts the cast to terrain and meshes tagged as hard blockers — geometry such
   * as raised banks and cave shells that the roof cutaway will never remove.
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 100, hardOnly = false): number | null {
    if (maxDistance <= 0 || Number.isNaN(maxDistance) || ![...origin, ...direction].every(Number.isFinite)) return null;
    if (this.dirty) {
      this.tree = this.shapes.length > 0 ? buildTree(this.shapes.slice()) : null;
      this.dirty = false;
    }
    if (!this.tree) return null;
    const length = Math.hypot(...direction) || 1;
    const hit = castTree(this.tree, {
      origin, direction: [direction[0] / length, direction[1] / length, direction[2] / length],
    }, maxDistance, (shape, ray, limit) => castShape(shape, ray, limit, hardOnly));
    return hit !== null && hit < maxDistance ? hit : null;
  }

  /** Hidden roofs stop blocking the camera; movement and navigation geometry are unchanged. */
  setHiddenEntities(ids: ReadonlySet<string>, cutHeights: ReadonlyMap<string, number> = new Map()): void {
    for (const shape of this.shapes) if (shape.kind === "box") {
      shape.cutHeight = shape.ownerId ? cutHeights.get(shape.ownerId) ?? Infinity : Infinity;
    }
    for (const shape of this.shapes) if (shape.kind === "mesh") {
      shape.hidden = shape.entityId !== undefined && ids.has(shape.entityId);
    }
  }

  clearStatic(): void {
    this.shapes = [];
    this.tree = null;
    this.dirty = false;
  }

  private add(shape: Shape): void {
    this.shapes.push(shape);
    this.dirty = true;
  }
}
