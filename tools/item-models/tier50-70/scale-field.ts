import * as THREE from 'three';
import type { ArmorMaterials, ScaleFieldOptions, Surface } from './contracts.js';

type UV = [number, number];
interface Batch { positions: number[]; uvs: number[]; indices: number[]; plates: number; curvatureLifts: number[]; }
const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));

// Counterclockwise, with a short rounded tip and a broad sewn root.
const OUTLINE: readonly UV[] = [
  [-.40, .50], [-.50, .26], [-.49, -.10], [-.35, -.39], [-.12, -.56],
  [.12, -.56], [.35, -.39], [.49, -.10], [.50, .26], [.40, .50],
];

function normalAt(surface: Surface, u: number, v: number): THREE.Vector3 {
  const delta = .0002;
  const du = surface(clamp(u + delta), v).sub(surface(clamp(u - delta), v));
  const dv = surface(u, clamp(v + delta)).sub(surface(u, clamp(v - delta)));
  const normal = du.cross(dv);
  if (normal.lengthSq() > 1e-28) return normal.normalize();
  // A pointed panel can collapse exactly at an edge. Probe toward its interior.
  const a = clamp(u, .0005, .9995), b = clamp(v, .0005, .9995);
  const fallback = surface(a + delta, b).sub(surface(a - delta, b))
    .cross(surface(a, b + delta).sub(surface(a, b - delta)));
  return fallback.lengthSq() > 1e-28 ? fallback.normalize() : new THREE.Vector3(0, 0, 1);
}

function arcLength(surface: Surface, alongU: boolean): number {
  let previous = surface(alongU ? 0 : .5, alongU ? .5 : 0), length = 0;
  for (let i = 1; i <= 24; i++) {
    const point = surface(alongU ? i / 24 : .5, alongU ? .5 : i / 24);
    length += previous.distanceTo(point); previous = point;
  }
  return length;
}

function clipPolygon(polygon: UV[], axis: 0 | 1, limit: number, keepAbove: boolean): UV[] {
  if (!polygon.length) return polygon;
  const result: UV[] = [];
  let previous = polygon[polygon.length - 1]!;
  let previousInside = keepAbove ? previous[axis] >= limit : previous[axis] <= limit;
  for (const point of polygon) {
    const inside = keepAbove ? point[axis] >= limit : point[axis] <= limit;
    if (inside !== previousInside) {
      const t = (limit - previous[axis]) / (point[axis] - previous[axis]);
      const crossing: UV = [previous[0] + (point[0] - previous[0]) * t,
        previous[1] + (point[1] - previous[1]) * t];
      crossing[axis] = limit; result.push(crossing);
    }
    if (inside) result.push(point);
    previous = point; previousInside = inside;
  }
  return result;
}

function paletteIndex(seed: number, row: number, column: number, count: number): number {
  let value = (seed ^ Math.imul(row + 8192, 374761393) ^ Math.imul(column + 8192, 668265263)) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) % count;
}

/** Sewn overlapping hide plates. Surface winding defines outward; UV V defines
 * the course direction. All geometry, including the closed edges, shares one
 * skin hint. Full plates use 40 triangles and reuse the supplied materials.
 */
export function addScaleField(group: THREE.Group, name: string, surface: Surface,
  materials: ArmorMaterials, options: ScaleFieldOptions): void {
  if (options.bone && options.deform) throw new Error(`${name}: scales cannot have both bone and deform hints`);
  if (!Number.isInteger(options.columns) || options.columns < 1 ||
      !Number.isInteger(options.rows) || options.rows < 1) {
    throw new Error(`${name}: scale rows and columns must be positive integers`);
  }
  const width = arcLength(surface, true), height = arcLength(surface, false);
  if (!(width > 1e-7 && height > 1e-7)) return;
  const palette = materials.scutes.length ? materials.scutes : [materials.scales];
  // Cut hide has a dark matte edge. Reuse the lining instead of tinting or
  // cloning immutable face materials, and keep all those edges in one batch.
  const batchMaterials = [...palette, materials.lining];
  const batches: Batch[] = batchMaterials.map(() => ({ positions: [], uvs: [], indices: [], plates: 0, curvatureLifts: [] }));
  const edgeBatch = batches[palette.length]!;
  const insetU = Math.min(.075, .0024 / width), insetV = Math.min(.06, .0018 / height);
  const lowU = insetU, highU = 1 - insetU, lowV = insetV, highV = 1 - insetV;
  const stepU = (highU - lowU) / options.columns, stepV = (highV - lowV) / options.rows;
  const plateWidth = stepU * 1.12, plateHeight = stepV * 1.47;
  const direction = options.reverse ? -1 : 1, lift = options.lift ?? .00025;
  // Scale relief with the nominal physical plate size, keeping the existing
  // small outlines and all fan vertices. The underside of the sewn root stays
  // at its original height even though the exposed cut edge is now thicker.
  const plateSpan = Math.min(plateWidth * width, plateHeight * height * 1.06);
  const freeTipLift = Math.min(.003, Math.max(.0016, plateSpan * .18));
  const edgeThickness = Math.min(.00078, Math.max(.00052, plateSpan * .04));
  const requestedCrown = Math.min(.00155, plateSpan * .085);
  const rootRelief = lift + edgeThickness - .00014;
  const courseRelief = freeTipLift * stepV / (plateHeight * 1.06);
  const overlapStart = stepV / plateHeight - .56;
  const minimumLayerClearance = .00015;
  const seed = options.seed ?? 0x71c3;
  let maxCurvatureLift = 0, curvatureLiftCapped = 0;
  let minCrownLift = Infinity, maxCrownLift = 0, crownOverlapCapped = 0;
  let minLayerClearance = Infinity, minFaceRelief = Infinity, maxFaceRelief = -Infinity;

  for (let row = 0; row <= options.rows; row++) {
    const centerV = lowV + (row + .28) * stepV;
    const stagger = row % 2 ? .5 : 0;
    for (let column = -1; column <= options.columns; column++) {
      const centerU = lowU + (column + .5 + stagger) * stepU;
      let polygon: UV[] = OUTLINE.map(([x, y]) => [centerU + x * plateWidth, centerV + y * plateHeight * direction]);
      if (options.reverse) polygon.reverse();
      polygon = clipPolygon(clipPolygon(clipPolygon(clipPolygon(polygon,
        0, lowU, true), 0, highU, false), 1, lowV, true), 1, highV, false);
      // Clipping a convex plate can add corners. Remove the least visible corner
      // first so every trimmed plate also stays within the 40-triangle budget.
      while (polygon.length > 10) {
        let smallest = Infinity, remove = 0;
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[(i + polygon.length - 1) % polygon.length]!, b = polygon[i]!, c = polygon[(i + 1) % polygon.length]!;
          const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
          if (area < smallest) { smallest = area; remove = i; }
        }
        polygon.splice(remove, 1);
      }
      if (polygon.length < 3) continue;
      let twiceArea = 0;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
        twiceArea += a[0] * b[1] - b[0] * a[1];
      }
      if (twiceArea < stepU * stepV * .012) continue;
      const batch = batches[paletteIndex(seed, row, column, palette.length)]!;
      const n = polygon.length, base = batch.positions.length / 3;
      const center: UV = [polygon.reduce((sum, p) => sum + p[0], 0) / n,
        polygon.reduce((sum, p) => sum + p[1], 0) / n];
      const centerX = (center[0] - centerU) / plateWidth;
      const centerY = (center[1] - centerV) / (plateHeight * direction);
      // In the shared footprint, the upper underside is courseRelief above
      // the lower rim, less its thickness. Bound how much of the lower fan's
      // crown can reach that zone. Clipped fragments can move the fan center
      // toward the sewn root, so they need their own conservative crown cap.
      const overlapCrownWeight = centerY >= overlapStart ? 1
        : clamp((.50 - overlapStart) / (.50 - centerY));
      const desiredCrown = requestedCrown * Math.max(0, 1 - 4 * centerX * centerX);
      const crownLimit = Math.max(0, courseRelief - edgeThickness - minimumLayerClearance)
        / Math.max(overlapCrownWeight, 1e-8);
      const crownLift = Math.min(desiredCrown, crownLimit);
      if (crownLift < desiredCrown - 1e-10) crownOverlapCapped++;
      minCrownLift = Math.min(minCrownLift, crownLift);
      maxCrownLift = Math.max(maxCrownLift, crownLift);
      minLayerClearance = Math.min(minLayerClearance, courseRelief - edgeThickness - crownLift * overlapCrownWeight);
      const mapped = (point: UV, bottom: boolean, crown = false): THREE.Vector3 => {
        const [u, v] = point;
        const tipAmount = clamp((.50 - (v - centerV) / (plateHeight * direction)) / 1.06);
        // The free edge rides above the sewn root of the previous course.
        // A low central ridge and the separate cut walls produce dimension
        // without replacing the smooth face fan with an inflated dome.
        const relief = rootRelief + tipAmount * freeTipLift + (crown ? crownLift : 0) - (bottom ? edgeThickness : 0);
        if (!bottom) {
          minFaceRelief = Math.min(minFaceRelief, relief);
          maxFaceRelief = Math.max(maxFaceRelief, relief);
        }
        return surface(u, v).addScaledVector(normalAt(surface, u, v), relief);
      };
      const addVertex = (target: Batch, point: THREE.Vector3, uv: UV): void => {
        target.positions.push(point.x, point.y, point.z);
        target.uvs.push(uv[0] * width * 4, uv[1] * height * 4);
        target.curvatureLifts.push(curvatureLift);
      };
      // Insetting only the face creates a real, upward-facing 0.32 mm bevel.
      // The clipped underside retains the original footprint at panel seams.
      const facePolygon: UV[] = polygon.map(p => {
        const radius = Math.hypot((p[0] - center[0]) * width, (p[1] - center[1]) * height);
        const inset = Math.min(.045, .00032 / Math.max(radius, 1e-8));
        return [p[0] + (center[0] - p[0]) * inset, p[1] + (center[1] - p[1]) * inset];
      });
      const top = facePolygon.map(p => mapped(p, false));
      const bottom = polygon.map(p => mapped(p, true));
      const topCenter = mapped(center, false, true), bottomCenter = mapped(center, true);
      // The underlying leather is more finely sampled than an individual
      // scute. Measure the surface bulge between its vertices so that a curved
      // calf cannot break through otherwise correctly ordered plate faces.
      let neededLift = 0;
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n, a = facePolygon[i]!, b = facePolygon[next]!;
        for (let j = 0; j <= 4; j++) for (let k = 0; k <= 4 - j; k++) {
          const wa = j / 4, wb = k / 4, wc = 1 - wa - wb;
          const u = center[0] * wc + a[0] * wa + b[0] * wb;
          const v = center[1] * wc + a[1] * wa + b[1] * wb;
          const chord = topCenter.clone().multiplyScalar(wc).addScaledVector(top[i]!, wa).addScaledVector(top[next]!, wb);
          const clearance = chord.sub(surface(u, v)).dot(normalAt(surface, u, v));
          neededLift = Math.max(neededLift, .00025 - clearance);
        }
      }
      const curvatureLift = Math.min(.002, Math.max(0, neededLift) * 1.12);
      maxCurvatureLift = Math.max(maxCurvatureLift, curvatureLift);
      if (neededLift * 1.12 > .002) curvatureLiftCapped++;
      if (curvatureLift > 0) {
        topCenter.addScaledVector(normalAt(surface, ...center), curvatureLift);
        bottomCenter.addScaledVector(normalAt(surface, ...center), curvatureLift);
        for (let i = 0; i < n; i++) {
          top[i]!.addScaledVector(normalAt(surface, ...facePolygon[i]!), curvatureLift);
          bottom[i]!.addScaledVector(normalAt(surface, ...polygon[i]!), curvatureLift);
        }
      }
      addVertex(batch, topCenter, center);
      for (let i = 0; i < n; i++) addVertex(batch, top[i]!, facePolygon[i]!);
      for (let i = 0; i < n; i++) batch.indices.push(base, base + 1 + i, base + 1 + (i + 1) % n);
      const bottomBase = edgeBatch.positions.length / 3;
      // Match the top's fan through the sampled surface center. A fan rooted
      // at a boundary vertex cuts across curved breasts, hips and toes, where
      // its underside can protrude through the face as a large dark triangle.
      addVertex(edgeBatch, bottomCenter, center);
      for (let i = 0; i < n; i++) addVertex(edgeBatch, bottom[i]!, polygon[i]!);
      for (let i = 0; i < n; i++) edgeBatch.indices.push(bottomBase, bottomBase + 1 + (i + 1) % n, bottomBase + 1 + i);
      // Separate wall vertices keep the thin lip crisp instead of smoothing it
      // into the face and making the scute look like an inflated cushion.
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n, edge = edgeBatch.positions.length / 3;
        addVertex(edgeBatch, top[i]!, facePolygon[i]!); addVertex(edgeBatch, bottom[i]!, polygon[i]!);
        addVertex(edgeBatch, top[next]!, facePolygon[next]!); addVertex(edgeBatch, bottom[next]!, polygon[next]!);
        edgeBatch.indices.push(edge, edge + 1, edge + 2, edge + 2, edge + 1, edge + 3);
      }
      batch.plates++;
    }
  }
  batches.forEach((batch, index) => {
    if (!batch.indices.length) return;
    // Use one clearance lift for the entire field. Independently lifting a
    // lower plate could otherwise force it through the tip of its upper one.
    for (let i = 0; i < batch.curvatureLifts.length; i++) {
      const extra = maxCurvatureLift - batch.curvatureLifts[i]!;
      if (extra <= 0) continue;
      const normal = normalAt(surface, batch.uvs[i * 2]! / (width * 4), batch.uvs[i * 2 + 1]! / (height * 4));
      batch.positions[i * 3]! += normal.x * extra;
      batch.positions[i * 3 + 1]! += normal.y * extra;
      batch.positions[i * 3 + 2]! += normal.z * extra;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.setIndex(batch.indices); geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, batchMaterials[index]!);
    mesh.name = index === palette.length ? `${name} dark cut-hide scute bevels` : `${name} overlapping scutes ${index + 1}`;
    mesh.castShadow = mesh.receiveShadow = true;
    if (options.bone) mesh.userData.itemModelBone = options.bone;
    if (options.deform) mesh.userData.itemModelDeform = options.deform;
    mesh.userData.scaleField = { plates: batch.plates, rows: options.rows, columns: options.columns, seed,
      maxCurvatureLift, curvatureLiftCapped,
      // Metres. Clearance is the conservative UV-domain overlap bound before
      // surface curvature; the existing sampled backing safeguard still runs.
      plateSpan, freeTipLift, edgeThickness, requestedCrown,
      crownLiftRange: [minCrownLift, maxCrownLift], crownOverlapCapped,
      minimumLayerClearance, nominalLayerClearance: minLayerClearance,
      sewnRootUndersideRelief: lift - .00014 + maxCurvatureLift,
      faceReliefRange: [minFaceRelief + maxCurvatureLift, maxFaceRelief + maxCurvatureLift],
      triangles: batch.indices.length / 3, trianglesPerFullPlate: 40 };
    group.add(mesh);
  });
}
