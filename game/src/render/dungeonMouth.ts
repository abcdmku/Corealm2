import * as THREE from "three";
import type { SemanticEntity } from "../contracts.js";
import { PORTAL_MANTLE } from "../world/portalMantle.js";

// Transformed opening vertices from wall_brick_door.glb, whose front is local Z=0.
// At the authored 3x scale the jamb gap is 3.915 m and the apex is 7.419 m.
const LEFT = -0.64942;
const RIGHT = 0.65552;
const SPRING = 2.15492;
const APEX = 2.47289;
const FRONT_Z = -0.185;
const DEPTH = 5 / 3;
const FLOOR = 0.006;
const OVERLAP = 0.018;

type Point = readonly [number, number];

/**
 * The visible recess behind the production masonry portal. Geometry starts inside the arch's
 * 0.2 m native reveal and ends five world metres farther back at the authored scale of three.
 * Returns an unattached group; the caller owns every marked geometry and material. This adds no
 * semantic entity, collision or navigation geometry, and does not load or borrow asset resources.
 */
export function buildDungeonMouth(entity: SemanticEntity): THREE.Group {
  const view = entity.view;
  if (view?.assetId !== "wall_brick_door") throw new Error("Dungeon mouth requires the wall_brick_door arch profile");
  const scale = view.scale ?? 1;
  const axes = view.scaleAxes ?? [1, 1, 1];
  const yaw = view.rotationY ?? 0;
  if (![...entity.position, yaw, scale, ...axes].every(Number.isFinite)
    || scale <= 0 || axes.some((axis) => axis <= 0)) {
    throw new Error(`Dungeon mouth ${entity.id} has an invalid transform`);
  }

  const profile: Point[] = [[LEFT - OVERLAP, FLOOR]];
  const courseY = [FLOOR, 0.20, 0.43, 0.63, 0.90, 1.12, 1.34, 1.60, 1.81, 1.98, SPRING];
  const courses = courseY.length - 1;
  for (let row = 1; row <= courses; row++) profile.push([LEFT - OVERLAP, courseY[row]!]);
  profile.push(
    [-0.50514 - OVERLAP, 2.29977 + OVERLAP],
    [-0.34175 - OVERLAP, 2.39760 + OVERLAP],
    [-0.17116 - OVERLAP, 2.45650 + OVERLAP],
    [0.00076, APEX + OVERLAP],
    [0.17421 + OVERLAP, 2.45650 + OVERLAP],
    [0.34194 + OVERLAP, 2.39760 + OVERLAP],
    [0.50247 + OVERLAP, 2.29977 + OVERLAP],
    [RIGHT + OVERLAP, SPRING],
  );
  for (let row = courses - 1; row >= 0; row--) profile.push([RIGHT + OVERLAP, courseY[row]!]);
  for (let column = 1; column < 4; column++) profile.push([RIGHT + OVERLAP - (RIGHT - LEFT + 2 * OVERLAP) * column / 4, FLOOR]);

  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const entrance = new THREE.Color().setRGB(0.29, 0.275, 0.24);
  const darkness = new THREE.Color(0x080b0d);
  const colour = new THREE.Color();
  type Projection = "front" | "wall" | "floor";
  function polygon(points: readonly THREE.Vector3[], depths: readonly number[], tone: number, projection: Projection = "front"): void {
    const offset = positions.length / 3;
    for (let corner = 0; corner < points.length; corner++) {
      const point = points[corner]!;
      positions.push(point.x, point.y, point.z);
      const falloff = (1 - depths[corner]!) ** 2.2;
      colour.copy(darkness).lerp(entrance, falloff).multiplyScalar(tone);
      colours.push(colour.r, colour.g, colour.b);
      uvs.push(projection === "wall" ? -point.z * scale * axes[2] : point.x * scale * axes[0],
        projection === "floor" ? -point.z * scale * axes[2] : point.y * scale * axes[1]);
    }
    indices.push(offset, offset + 1, offset + 2);
    if (points.length === 4) indices.push(offset, offset + 2, offset + 3);
  }
  function dressedStone(corners: readonly THREE.Vector3[], depths: readonly number[], tone: number,
    projection: Projection, identity: number, relief = 0.010): void {
    const normal = corners[1]!.clone().sub(corners[0]!).cross(corners[3]!.clone().sub(corners[0]!)).normalize();
    const centre = corners.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(0.25);
    const rim: THREE.Vector3[] = [];
    const face: THREE.Vector3[] = [];
    const ringDepth: number[] = [];
    for (let corner = 0; corner < 4; corner++) {
      const next = (corner + 1) % 4;
      const chip = 0.045 + (1 + Math.sin(identity * 1.7 + corner * 3.1)) * 0.035;
      for (const t of [chip, 1 - chip * 0.75]) {
        const point = corners[corner]!.clone().lerp(corners[next]!, t);
        rim.push(point);
        // Worn arrises have unequal clipped corners, with broad stone faces behind the bevel.
        face.push(point.clone().lerp(centre, 0.025 + (corner % 2) * 0.018)
          .addScaledVector(normal, relief * (0.82 + 0.18 * Math.sin(identity + corner * 2.4))));
        ringDepth.push(THREE.MathUtils.lerp(depths[corner]!, depths[next]!, t));
      }
    }
    const crown = centre.clone().addScaledVector(normal, relief * 1.04);
    const centreDepth = depths.reduce((sum, value) => sum + value, 0) / 4;
    for (let edge = 0; edge < rim.length; edge++) {
      const next = (edge + 1) % rim.length;
      polygon([face[edge]!, face[next]!, crown], [ringDepth[edge]!, ringDepth[next]!, centreDepth], tone, projection);
      polygon([rim[edge]!, rim[next]!, face[next]!, face[edge]!],
        [ringDepth[edge]!, ringDepth[next]!, ringDepth[next]!, ringDepth[edge]!], tone * 0.79, projection);
    }
  }
  function point(at: Point, depth: number): THREE.Vector3 {
    const centre = (LEFT + RIGHT) * 0.5;
    return new THREE.Vector3(
      centre + (at[0] - centre) * (1 - depth * 0.045),
      FLOOR + (at[1] - FLOOR) * (1 - depth * 0.035),
      FRONT_Z - depth * DEPTH,
    );
  }

  const facadeZ = 0.105;
  for (let edge = 0; edge < profile.length; edge++) {
    const a = profile[edge]!;
    const b = profile[(edge + 1) % profile.length]!;
    const projection: Projection = a[1] === FLOOR && b[1] === FLOOR ? "floor"
      : Math.abs(a[0] - b[0]) < 0.0001 ? "wall" : "floor";
    if (!(a[1] === FLOOR && b[1] === FLOOR)) {
      // Return each dressed course across the source panel's reveal. The old gap from the
      // facade to FRONT_Z exposed the source's stretched jamb UVs as a separate vertical strip.
      // This veneer lies on the measured opening plane, so it does not narrow the aperture.
      const reveal = ([x, y]: Point, z: number): THREE.Vector3 => new THREE.Vector3(
        Math.abs(x) > 0.01 ? x - Math.sign(x) * OVERLAP : x,
        y > SPRING ? y - OVERLAP : y, z,
      );
      polygon([reveal(a, facadeZ), reveal(a, FRONT_Z - 0.008), reveal(b, FRONT_Z - 0.008), reveal(b, facadeZ)],
        [0, 0.07, 0.07, 0], 0.88 + Math.sin(edge * 2.63) * 0.055, projection);
    }
    polygon([point(a, 0), point(a, 1), point(b, 1), point(b, 0)], [0, 1, 1, 0], 0.48, projection);
    let start = 0;
    let stone = 0;
    while (start < 1) {
      const end = Math.min(1, start + (stone === 0 && edge % 2 ? 0.105 : 0.20 + 0.025 * Math.sin(edge * 1.7 + stone)));
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const margin = Math.min(0.03, 0.0035 / length);
      const near = start + 0.0025 / DEPTH;
      const far = end - 0.0025 / DEPTH;
      const along = (fraction: number): Point => [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
      const corners = [point(along(margin), near), point(along(margin), far), point(along(1 - margin), far), point(along(1 - margin), near)];
      const depths = [near, far, far, near];
      const tone = 0.88 + 0.14 * Math.sin(edge * 2.63 + stone * 1.81);
      const floor = projection === "floor" && a[1] === FLOOR;
      dressedStone(corners, depths, tone, projection, edge * 31 + stone,
        floor ? 0.0045 + Math.abs(corners[0]!.x) * 0.007 : 0.010 + 0.002 * Math.sin(edge * 4.7 + stone * 2.3));
      start = end;
      stone++;
    }
  }

  // Dressed jamb courses and radial voussoirs carry the crown. They cover the source panel's
  // timber band while leaving every point of the measured doorway aperture open.
  const facePoint = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(x, y, facadeZ);
  const facade = (corners: THREE.Vector3[], identity: number): void => {
    polygon(corners, [0, 0, 0, 0], 0.50);
    dressedStone(corners, [0, 0, 0, 0], 0.94 + Math.sin(identity * 1.31) * 0.07, "front", identity, 0.016);
  };
  for (const side of [-1, 1]) {
    const inner = side < 0 ? LEFT - OVERLAP : RIGHT + OVERLAP;
    const outer = side * 1.025;
    const x0 = Math.min(inner, outer); const x1 = Math.max(inner, outer);
    for (let row = 0; row < courses; row++) facade([
      facePoint(x0, courseY[row]! + 0.003), facePoint(x1, courseY[row]! + 0.003),
      facePoint(x1, courseY[row + 1]! - 0.003), facePoint(x0, courseY[row + 1]! - 0.003),
    ], 700 + row + side * 17);
  }
  const arch = profile.slice(courses, courses + 9);
  const outerArch = arch.map(([x, y]) => {
    const radial = new THREE.Vector2(x - (LEFT + RIGHT) / 2, y - SPRING + 0.40).normalize();
    return [x + radial.x * 0.22, y + radial.y * 0.22] as Point;
  });
  for (let segment = 0; segment < arch.length - 1; segment++) {
    const a = arch[segment]!; const b = arch[segment + 1]!;
    const c = outerArch[segment + 1]!; const d = outerArch[segment]!;
    facade([facePoint(...a), facePoint(...b), facePoint(...c), facePoint(...d)], 800 + segment);
    facade([facePoint(...d), facePoint(...c), facePoint(c[0], 2.91), facePoint(d[0], 2.91)], 850 + segment);
    facade([facePoint(d[0], 2.916), facePoint(c[0], 2.916), facePoint(c[0], 3.145), facePoint(d[0], 3.145)], 900 + segment);
  }
  for (const side of [-1, 1]) {
    const edge = outerArch[side < 0 ? 0 : outerArch.length - 1]!;
    const x0 = Math.min(side * 1.025, edge[0]); const x1 = Math.max(side * 1.025, edge[0]);
    facade([facePoint(x0, SPRING), facePoint(x1, SPRING), facePoint(x1, 2.68), facePoint(x0, 2.68)], 950 + side);
    facade([facePoint(x0, 2.686), facePoint(x1, 2.686), facePoint(x1, 3.145), facePoint(x0, 3.145)], 960 + side);
  }

  // The source timber occupies X[-1,1], Y[2.877,3.123], Z[-0.314,0.0924]. A front veneer
  // leaves its upper edge, rear and end grain visible. This fitted coping encloses all six
  // faces in stone, including a continuous recessed bed behind the joints between capstones.
  const copingFaces = (left: number, right: number, bottom: number, top: number, back: number, front: number):
  Array<{ corners: THREE.Vector3[]; projection: Projection }> => {
    const p = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    return [
      { corners: [p(left, bottom, front), p(right, bottom, front), p(right, top, front), p(left, top, front)], projection: "front" },
      { corners: [p(right, bottom, back), p(left, bottom, back), p(left, top, back), p(right, top, back)], projection: "front" },
      { corners: [p(left, top, front), p(right, top, front), p(right, top, back), p(left, top, back)], projection: "floor" },
      { corners: [p(left, bottom, back), p(right, bottom, back), p(right, bottom, front), p(left, bottom, front)], projection: "floor" },
      { corners: [p(left, bottom, back), p(left, bottom, front), p(left, top, front), p(left, top, back)], projection: "wall" },
      { corners: [p(right, bottom, front), p(right, bottom, back), p(right, top, back), p(right, top, front)], projection: "wall" },
    ];
  };
  for (const face of copingFaces(-1.035, 1.035, 2.869, 3.137, -0.333, 0.125)) {
    polygon(face.corners, [0, 0, 0, 0], 0.59, face.projection);
  }
  const capJoints = [-1.04, -0.69, -0.35, 0.005, 0.37, 0.70, 1.04];
  for (let block = 0; block < capJoints.length - 1; block++) {
    const left = capJoints[block]! + (block > 0 ? 0.0025 : 0);
    const right = capJoints[block + 1]! - (block < capJoints.length - 2 ? 0.0025 : 0);
    const faces = copingFaces(left, right, 2.862, 3.145, -0.337, 0.127);
    for (const [side, face] of faces.entries()) {
      // Only the two outside ends need dressed returns. Joint bottoms remain continuous stone.
      if (side === 4 && block > 0 || side === 5 && block < capJoints.length - 2) continue;
      polygon(face.corners, [0, 0, 0, 0], 0.67, face.projection);
      dressedStone(face.corners, [0, 0, 0, 0], 1.01 + Math.sin(block * 2.4) * 0.045,
        face.projection, 1100 + block * 7 + side, face.projection === "floor" ? 0.006 : 0.009);
    }
  }

  // Separate threshold flags carry a shallow central wear trough and settled edge heights.
  const flagEdges = [LEFT - OVERLAP, -0.33, 0.035, 0.36, RIGHT + OVERLAP];
  for (let flag = 0; flag < flagEdges.length - 1; flag++) {
    const x0 = flagEdges[flag]! + 0.002; const x1 = flagEdges[flag + 1]! - 0.002;
    const worn = 0.006 + Math.abs((x0 + x1) / 2) * 0.012;
    const corners = [new THREE.Vector3(x0, worn, 0.042), new THREE.Vector3(x1, worn + 0.001, 0.042),
      new THREE.Vector3(x1, FLOOR, FRONT_Z - 0.025), new THREE.Vector3(x0, FLOOR, FRONT_Z - 0.025)];
    dressedStone(corners, [0, 0, 0, 0], 1.08, "floor", 1000 + flag, 0.004);
    polygon([new THREE.Vector3(x0, -0.025, 0.045), new THREE.Vector3(x1, -0.025, 0.045), corners[1]!, corners[0]!], [0, 0, 0, 0], 0.69);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const stoneMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  // The returned courses cover the original reveal at its exact plane, without moving the
  // aperture. Depth bias prevents coplanar source masonry from showing through that veneer.
  stoneMaterial.polygonOffset = true;
  stoneMaterial.polygonOffsetFactor = -1;
  stoneMaterial.polygonOffsetUnits = -1;
  stoneMaterial.name = "Corealm weathered strata";
  const stone = new THREE.Mesh(geometry, stoneMaterial);
  stone.name = "dungeon-mouth-stone-recess";
  stone.castShadow = false;
  stone.receiveShadow = true;
  stone.userData.ownedGeometry = true;
  stone.userData.ownedMaterial = true;

  const shape = new THREE.Shape();
  profile.forEach((vertex, index) => {
    const rear = point(vertex, 1);
    if (index === 0) shape.moveTo(rear.x, rear.y);
    else shape.lineTo(rear.x, rear.y);
  });
  shape.closePath();
  const rear = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x050709, toneMapped: false, fog: false }));
  rear.name = "dungeon-mouth-dark-end";
  rear.position.z = FRONT_Z - DEPTH;
  rear.userData.ownedGeometry = true;
  rear.userData.ownedMaterial = true;

  const group = new THREE.Group();
  group.name = `${entity.id}-recess`;
  group.position.fromArray(entity.position);
  group.rotation.y = yaw;
  group.scale.set(scale * axes[0], scale * axes[1], scale * axes[2]);
  group.add(stone, rear);
  if (entity.regionId !== "gravelmaw") group.add(buildRockMantle(profile));
  return group;
}

/** A closed rock volume surrounds the surface passage and meets the bank behind it. */
function buildRockMantle(opening: readonly Point[]): THREE.Mesh {
  const positions: number[] = [], indices: number[] = [], colours: number[] = [], uvs: number[] = [];
  const rings = 13, count = opening.length;
  const colour = new THREE.Color(0x625c51);
  for (let ring = 0; ring < rings; ring++) {
    const t = ring / (rings - 1);
    const z = PORTAL_MANTLE.frontZ + (PORTAL_MANTLE.backZ - PORTAL_MANTLE.frontZ) * t;
    for (let vertex = 0; vertex < count; vertex++) {
      const [ix, iy] = opening[vertex]!;
      const f = Math.max(0, (iy - FLOOR) / (APEX + OVERLAP - FLOOR));
      const irregularity = Math.sin(t * 13.7 + vertex * 0.71) * 0.025
        + Math.sin(t * 5.8 + vertex * 1.27) * 0.025;
      const width = 1.6 + 0.22 * Math.sin(t * Math.PI);
      const x = ix * width + Math.sign(ix) * irregularity * f;
      // A 0.6 m minimum rock roof covers the existing tunnel; at the rear it tapers into
      // the authored 8.2 m bank crest. The base remains buried and the sides carry the roof.
      const roofY = PORTAL_MANTLE.frontRoofY + (PORTAL_MANTLE.rearRoofY - PORTAL_MANTLE.frontRoofY) * t;
      const y = iy <= FLOOR ? PORTAL_MANTLE.baseY : PORTAL_MANTLE.baseY + f * roofY + irregularity * f;
      positions.push(x, y, z);
      const shade = 0.91 + 0.09 * Math.sin(vertex * 0.43 + t * 8.7);
      colours.push(colour.r * shade, colour.g * shade, colour.b * shade);
      uvs.push(z, iy <= FLOOR ? x : y + ix * 0.37);
    }
  }
  for (let ring = 0; ring < rings - 1; ring++) for (let edge = 0; edge < count; edge++) {
    const next = (edge + 1) % count;
    const a = ring * count + edge, b = ring * count + next;
    const c = (ring + 1) * count + edge, d = (ring + 1) * count + next;
    indices.push(a, c, b, b, c, d);
  }
  // Front annulus connects to the real aperture. It leaves the passage completely open.
  const innerStart = positions.length / 3;
  for (const [x, y] of opening) {
    positions.push(x, y, PORTAL_MANTLE.frontZ);
    colours.push(colour.r, colour.g, colour.b); uvs.push(x, y);
  }
  for (let edge = 0; edge < count; edge++) {
    const next = (edge + 1) % count;
    indices.push(edge, next, innerStart + edge, next, innerStart + next, innerStart + edge);
  }
  const rearCentre = positions.length / 3;
  positions.push(0, 1.25, PORTAL_MANTLE.backZ); colours.push(colour.r, colour.g, colour.b); uvs.push(0, 1.25);
  for (let edge = 0; edge < count; edge++) {
    indices.push((rings - 1) * count + edge, rearCentre, (rings - 1) * count + (edge + 1) % count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  material.name = "Corealm weathered strata";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "dungeon-mouth-rock-mantle";
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.ownedGeometry = true; mesh.userData.ownedMaterial = true;
  return mesh;
}
