import * as THREE from "three";

export interface NavigationWaterBody {
  id: string;
  contour: readonly (readonly [number, number])[];
  level: number;
  floorY: number;
}

export interface DryNavigationGeometry {
  /** Detached meshes in world space. The caller owns their geometries, but not their materials. */
  meshes: THREE.Mesh[];
  sourceTriangles: number;
  excludedTriangles: number;
  /** A triangle touching overlapping bodies is attributed to the first body. */
  excludedByBody: Record<string, number>;
}

const EPSILON = 1e-8;

function cross(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

function onSegment(ax: number, az: number, bx: number, bz: number, px: number, pz: number): boolean {
  return Math.abs(cross(ax, az, bx, bz, px, pz)) <= EPSILON
    && px >= Math.min(ax, bx) - EPSILON && px <= Math.max(ax, bx) + EPSILON
    && pz >= Math.min(az, bz) - EPSILON && pz <= Math.max(az, bz) + EPSILON;
}

function inside(x: number, z: number, polygon: readonly (readonly [number, number])[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j]!;
    const [bx, bz] = polygon[i]!;
    if (onSegment(ax, az, bx, bz, x, z)) return true;
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) result = !result;
  }
  return result;
}

function edgesIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  if (Math.max(ax, bx) < Math.min(cx, dx) - EPSILON
    || Math.min(ax, bx) > Math.max(cx, dx) + EPSILON
    || Math.max(az, bz) < Math.min(cz, dz) - EPSILON
    || Math.min(az, bz) > Math.max(cz, dz) + EPSILON) return false;
  const abC = cross(ax, az, bx, bz, cx, cz);
  const abD = cross(ax, az, bx, bz, dx, dz);
  const cdA = cross(cx, cz, dx, dz, ax, az);
  const cdB = cross(cx, cz, dx, dz, bx, bz);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (Math.abs(abC) <= EPSILON && onSegment(ax, az, bx, bz, cx, cz))
    || (Math.abs(abD) <= EPSILON && onSegment(ax, az, bx, bz, dx, dz))
    || (Math.abs(cdA) <= EPSILON && onSegment(cx, cz, dx, dz, ax, az))
    || (Math.abs(cdB) <= EPSILON && onSegment(cx, cz, dx, dz, bx, bz));
}

function intersects(
  wetTriangle: readonly (readonly [number, number])[],
  contour: readonly (readonly [number, number])[],
): boolean {
  for (const [x, z] of wetTriangle) if (inside(x, z, contour)) return true;
  // A small pond can lie wholly inside one coarse terrain triangle.
  if (inside(contour[0]![0], contour[0]![1], wetTriangle)) return true;
  for (let i = 0; i < wetTriangle.length; i++) {
    const [ax, az] = wetTriangle[i]!;
    const [bx, bz] = wetTriangle[(i + 1) % wetTriangle.length]!;
    for (let j = 0; j < contour.length; j++) {
      const [cx, cz] = contour[j]!;
      const [dx, dz] = contour[(j + 1) % contour.length]!;
      if (edgesIntersect(ax, az, bx, bz, cx, cz, dx, dz)) return true;
    }
  }
  return false;
}

/**
 * Remove submerged terrain before Recast rasterizes it. An obstacle ring alone leaves a second,
 * walkable navmesh island on the basin floor, so closest-point queries can still enter the water.
 *
 * This masks complete source triangles against the actual solved shoreline. Only a triangle's
 * below-water portion participates, preserving bridges and dry banks inside a contour's bounds.
 * The shoreline loses at most one terrain triangle plus Recast's normal agent-radius erosion.
 * Source meshes, attributes, indices, groups and materials are never changed.
 */
export function dryNavigationMeshes(
  source: readonly THREE.Mesh[],
  bodies: readonly NavigationWaterBody[],
): DryNavigationGeometry {
  const prepared = bodies.filter((body) => body.contour.length >= 3 && body.level > body.floorY).map((body) => ({
    ...body,
    minX: Math.min(...body.contour.map(([x]) => x)),
    maxX: Math.max(...body.contour.map(([x]) => x)),
    minZ: Math.min(...body.contour.map(([, z]) => z)),
    maxZ: Math.max(...body.contour.map(([, z]) => z)),
  }));
  const result: DryNavigationGeometry = {
    meshes: [], sourceTriangles: 0, excludedTriangles: 0,
    excludedByBody: Object.fromEntries(bodies.map((body) => [body.id, 0])),
  };
  const point = new THREE.Vector3();
  for (const sourceMesh of source) {
    sourceMesh.updateWorldMatrix(true, false);
    const position = sourceMesh.geometry.getAttribute("position");
    if (!position) continue;
    const world = new Float64Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex++) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(sourceMesh.matrixWorld).toArray(world, vertex * 3);
    }
    const sourceIndex = sourceMesh.geometry.getIndex();
    const indexCount = sourceIndex?.count ?? position.count;
    const kept: number[] = [];
    const retainedOffsets: number[] = [];
    const triangle = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let offset = 0; offset + 2 < indexCount; offset += 3) {
      result.sourceTriangles++;
      const a = sourceIndex ? sourceIndex.getX(offset) : offset;
      const b = sourceIndex ? sourceIndex.getX(offset + 1) : offset + 1;
      const c = sourceIndex ? sourceIndex.getX(offset + 2) : offset + 2;
      triangle[0]!.fromArray(world, a * 3);
      triangle[1]!.fromArray(world, b * 3);
      triangle[2]!.fromArray(world, c * 3);
      const minX = Math.min(triangle[0]!.x, triangle[1]!.x, triangle[2]!.x);
      const maxX = Math.max(triangle[0]!.x, triangle[1]!.x, triangle[2]!.x);
      const minZ = Math.min(triangle[0]!.z, triangle[1]!.z, triangle[2]!.z);
      const maxZ = Math.max(triangle[0]!.z, triangle[1]!.z, triangle[2]!.z);
      const minY = Math.min(triangle[0]!.y, triangle[1]!.y, triangle[2]!.y);
      let excluded = false;
      for (const body of prepared) {
        if (minY >= body.level - EPSILON || maxX < body.minX || minX > body.maxX
          || maxZ < body.minZ || minZ > body.maxZ) continue;
        // Clip against the horizontal water plane before testing polygon overlap. A sloped
        // triangle may cross the shoreline while its submerged end lies outside the body.
        const wet: [number, number][] = [];
        for (let i = 0; i < 3; i++) {
          const start = triangle[i]!;
          const end = triangle[(i + 1) % 3]!;
          const startWet = start.y < body.level;
          const endWet = end.y < body.level;
          if (startWet) wet.push([start.x, start.z]);
          if (startWet !== endWet) {
            const fraction = (body.level - start.y) / (end.y - start.y);
            wet.push([start.x + (end.x - start.x) * fraction, start.z + (end.z - start.z) * fraction]);
          }
        }
        if (wet.length < 3 || !intersects(wet, body.contour)) continue;
        result.excludedTriangles++;
        result.excludedByBody[body.id] = (result.excludedByBody[body.id] ?? 0) + 1;
        excluded = true;
        break;
      }
      if (!excluded) {
        kept.push(a, b, c);
        retainedOffsets.push(offset);
      }
    }
    const geometry = sourceMesh.geometry.clone();
    geometry.setIndex(kept);
    const retainedBefore = (offset: number): number => {
      let low = 0;
      let high = retainedOffsets.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (retainedOffsets[middle]! < offset) low = middle + 1;
        else high = middle;
      }
      return low * 3;
    };
    geometry.clearGroups();
    for (const group of sourceMesh.geometry.groups) {
      const start = retainedBefore(group.start);
      const count = retainedBefore(group.start + group.count) - start;
      if (count) geometry.addGroup(start, count, group.materialIndex);
    }
    const range = sourceMesh.geometry.drawRange;
    const rangeStart = retainedBefore(range.start);
    geometry.setDrawRange(rangeStart, retainedBefore(range.start + range.count) - rangeStart);
    const mesh = new THREE.Mesh(geometry, sourceMesh.material).copy(sourceMesh, false);
    mesh.geometry = geometry;
    mesh.matrix.copy(sourceMesh.matrixWorld);
    mesh.matrixWorld.copy(sourceMesh.matrixWorld);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.matrixAutoUpdate = false;
    result.meshes.push(mesh);
  }
  return result;
}
