/** On-demand production gear geometry. The asset registry owns the cached groups. */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EquipmentFaces as Faces, buildEquipmentCoreGeometry } from "./equipmentDetails.js";
import type { FishingRodLook } from "./proceduralGear.js";

type Point = readonly [number, number, number];
type EquipmentRole = "blade" | "metal" | "leather" | "gem";
type Ring = { at: number; radius: number; depth: number; bend?: number };

/** Y-up, with the grip at the origin. Each material is merged once for three colour-pass draws. */
export function buildFishingRod(look: FishingRodLook): THREE.Group {
  const buttY = -look.length * 0.18;
  const tipY = look.length * 0.82;
  const bindings: THREE.BufferGeometry[] = [];
  const fittings: THREE.BufferGeometry[] = [];
  const fitting = look.fitting ?? look.binding;

  // The grip remains straight through the palm. Its rounded ends hide the ends of the leather seam.
  bindings.push(paint(rodProfile([
    [0.017, -0.096], [0.021, -0.092], [0.023, -0.084],
    [0.023, 0.055], [0.021, 0.064], [0.017, 0.068],
  ]), look.binding));
  const wrapPoints = Array.from({ length: 193 }, (_, index) => {
    const t = index / 192;
    const angle = t * Math.PI * 24;
    return new THREE.Vector3(Math.cos(angle) * 0.023, -0.083 + t * 0.137, Math.sin(angle) * 0.023);
  });
  const seamColor = new THREE.Color(look.binding).lerp(new THREE.Color(0xb7a17b), 0.24).getHex();
  bindings.push(paint(rodCord(wrapPoints, 0.0013, 192), seamColor));

  for (const y of [-0.098, 0.070]) {
    fittings.push(paint(rodProfile([
      [0.019, y - 0.005], [0.023, y - 0.003], [0.023, y + 0.003], [0.019, y + 0.005],
    ]), fitting));
  }
  fittings.push(paint(rodProfile([
    [0, buttY - 0.0005], [0.0205, buttY - 0.0005], [0.021, buttY + 0.005],
    [0.022, buttY + 0.012], [0.022, buttY + 0.042], [0.020, buttY + 0.048],
  ]), fitting));

  // A fly-style reel sits below the palm. Its spool, rolled rims and crank all join the same axle.
  const reelCentre = new THREE.Vector3(0, -0.137, 0.051);
  fittings.push(paint(segmentBetween(
    new THREE.Vector3(0, -0.123, 0.014), reelCentre, 0.010, 0.012, 20,
  ), fitting));
  const reel = rodProfile([
    [0, -0.024], [0.029, -0.024], [0.036, -0.020], [0.037, -0.015],
    [0.030, -0.011], [0.020, -0.009], [0.020, 0.009], [0.030, 0.011],
    [0.037, 0.015], [0.036, 0.020], [0.029, 0.024], [0, 0.024],
  ]);
  reel.rotateZ(-Math.PI / 2);
  reel.translate(reelCentre.x, reelCentre.y, reelCentre.z);
  fittings.push(paint(reel, fitting));
  const winding = rodProfile([[0.023, -0.010], [0.027, -0.008], [0.027, 0.008], [0.023, 0.010]]);
  winding.rotateZ(-Math.PI / 2);
  winding.translate(reelCentre.x, reelCentre.y, reelCentre.z);
  bindings.push(paint(winding, look.line));
  const crankStart = reelCentre.clone().add(new THREE.Vector3(0.025, 0, 0));
  const crankEnd = reelCentre.clone().add(new THREE.Vector3(0.028, -0.020, 0.016));
  fittings.push(paint(segmentBetween(crankStart, crankEnd, 0.003, 0.004, 16), fitting));
  const crankKnob = rodProfile([[0, -0.007], [0.004, -0.006], [0.005, -0.002], [0.005, 0.006], [0, 0.009]]);
  crankKnob.rotateZ(-Math.PI / 2);
  crankKnob.translate(crankEnd.x + 0.006, crankEnd.y, crankEnd.z);
  bindings.push(paint(crankKnob, look.binding));

  const guidePoints: THREE.Vector3[] = [];
  for (const fraction of [0.20, 0.42, 0.64, 0.82]) {
    const y = look.length * fraction;
    const centre = rodCentre(look, y);
    const radius = rodRadius(look, y);
    const eye = centre.clone().add(new THREE.Vector3(0, 0, radius + 0.012));
    guidePoints.push(eye);
    const guide = new THREE.TorusGeometry(0.010, 0.0018, 8, 24);
    guide.rotateX(Math.PI / 2);
    guide.translate(eye.x, eye.y, eye.z);
    fittings.push(paint(guide, fitting));
    fittings.push(paint(segmentBetween(
      centre.clone().add(new THREE.Vector3(0, -0.015, radius * 0.8)),
      eye.clone().add(new THREE.Vector3(0, 0, -0.008)), 0.0023, 0.003, 16,
    ), fitting));
    // Centre each short cuff on its own section of shaft and follow the local tangent and taper.
    const cuffY = y - 0.0125;
    const cuffCentre = rodCentre(look, cuffY);
    const cuffSlope = 2 * look.bend * cuffY / (tipY * tipY);
    const binding = rodProfile([
      [rodRadius(look, y - 0.021), -0.0085],
      [rodRadius(look, y - 0.018) + 0.002, -0.0055],
      [rodRadius(look, y - 0.006) + 0.002, 0.0065],
      [rodRadius(look, y - 0.004), 0.0085],
    ]);
    binding.rotateZ(-Math.atan(cuffSlope));
    binding.translate(cuffCentre.x, cuffCentre.y, 0);
    bindings.push(paint(binding, look.binding));
  }

  // +Z becomes downward with the existing hand attachment. The float hangs on that axis.
  const tipEye = guidePoints[guidePoints.length - 1]!;
  const floatCentre = new THREE.Vector3(look.bend, tipY + 0.34, 0.535);
  const linePoints = [
    new THREE.Vector3(0, -0.110, 0.052), ...guidePoints,
    new THREE.Vector3(look.bend + 0.014, tipY + 0.15, 0.16),
    new THREE.Vector3(look.bend + 0.009, tipY + 0.29, 0.37),
    floatCentre.clone().add(new THREE.Vector3(0, 0, -0.033)),
  ];
  bindings.push(paint(rodCord(linePoints, 0.0018, 112), look.line));
  const floatLower = rodProfile([
    [0.024, 0], [0.023, 0.013], [0.016, 0.025], [0.007, 0.030], [0, 0.033],
  ]);
  const floatUpper = rodProfile([
    [0, -0.033], [0.005, -0.030], [0.006, -0.023], [0.016, -0.019], [0.023, -0.009], [0.024, 0],
  ]);
  for (const [geometry, colour] of [[floatLower, look.bobber], [floatUpper, 0xd8d1bd]] as const) {
    geometry.rotateX(Math.PI / 2);
    geometry.translate(floatCentre.x, floatCentre.y, floatCentre.z);
    bindings.push(paint(geometry, colour));
  }

  const group = new THREE.Group();
  group.name = "procedural-fishing-rod";
  group.add(mergedMesh([paint(rodShaft(look), look.shaft)], rodWoodMaterial(), "rod-shaft"));
  group.add(mergedMesh(bindings, new THREE.MeshStandardMaterial({
    name: "proc-rod-leather-line", color: 0xffffff, vertexColors: true, roughness: 0.68, metalness: 0,
  }), "rod-line-bobber"));
  group.add(mergedMesh(fittings, new THREE.MeshStandardMaterial({
    name: "proc-rod-fittings", color: 0xffffff, vertexColors: true, roughness: 0.30, metalness: 0.72,
  }), "rod-fittings"));
  group.userData["fishingRod"] = {
    grip: [0, 0, 0], tip: rodCentre(look, tipY).toArray(),
    lineGuide: tipEye.toArray(), float: floatCentre.toArray(),
  };
  return group;
}

/** Rounded turned profiles use enough radial samples for the close equipment camera. */
function rodProfile(points: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([radius, y]) => new THREE.Vector2(radius, y)), 24);
}

function rodCord(points: readonly THREE.Vector3[], radius: number, segments: number): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([...points], false, "centripetal"), segments, radius, 8, false);
}

function rodCentre(look: FishingRodLook, y: number): THREE.Vector3 {
  return new THREE.Vector3(look.bend * Math.pow(Math.max(0, y) / (look.length * 0.82), 2), y, 0);
}

function rodRadius(look: FishingRodLook, y: number): number {
  return 0.020 - 0.014 * ((y + look.length * 0.18) / look.length);
}

/** One swept surface with smooth analytic normals and caps only at its two ends. */
function rodShaft(look: FishingRodLook): THREE.BufferGeometry {
  const radial = 24;
  const axial = 48;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const buttY = -look.length * 0.18;
  const tipY = look.length * 0.82;
  for (let row = 0; row <= axial; row += 1) {
    const y = buttY + look.length * row / axial;
    const centre = rodCentre(look, y);
    const radius = rodRadius(look, y);
    const slope = 2 * look.bend * Math.max(0, y) / (tipY * tipY);
    const curvature = y > 0 ? 2 * look.bend / (tipY * tipY) : 0;
    const inverse = 1 / Math.sqrt(1 + slope * slope);
    const dr = -0.014 / look.length;
    for (let column = 0; column <= radial; column += 1) {
      const angle = column / radial * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      positions.push(centre.x + radius * cosine * inverse, y - radius * cosine * slope * inverse, radius * sine);
      const tangent = new THREE.Vector3(
        slope + dr * cosine * inverse - radius * cosine * slope * curvature * inverse ** 3,
        1 - dr * cosine * slope * inverse - radius * cosine * curvature * inverse ** 3,
        dr * sine,
      );
      const across = new THREE.Vector3(-sine * inverse, sine * slope * inverse, cosine);
      const normal = tangent.cross(across).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(column / radial, row / axial);
      if (row < axial && column < radial) {
        const a = row * (radial + 1) + column;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  for (const end of [0, 1]) {
    const y = end === 0 ? buttY : tipY;
    const centre = rodCentre(look, y);
    const slope = end === 0 ? 0 : 2 * look.bend / tipY;
    const normal = new THREE.Vector3(slope, 1, 0).normalize().multiplyScalar(end === 0 ? -1 : 1);
    const centreIndex = positions.length / 3;
    positions.push(centre.x, y, 0);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(0.5, 0.5);
    for (let column = 0; column <= radial; column += 1) {
      const source = ((end === 0 ? 0 : axial) * (radial + 1) + column) * 3;
      positions.push(positions[source]!, positions[source + 1]!, positions[source + 2]!);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(0.5 + Math.cos(column / radial * Math.PI * 2) * 0.5, 0.5 + Math.sin(column / radial * Math.PI * 2) * 0.5);
      if (column < radial) {
        const first = centreIndex + 1 + column;
        if (end === 0) indices.push(centreIndex, first, first + 1);
        else indices.push(centreIndex, first + 1, first);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

let rodGrainNormal: THREE.DataTexture | undefined;

function rodWoodMaterial(): THREE.MeshPhysicalMaterial {
  if (!rodGrainNormal) {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size * Math.PI * 2;
        const v = y / size * Math.PI * 2;
        const normal = new THREE.Vector3(
          Math.sin(u * 7 + Math.sin(v) * 0.7) * 0.22 + Math.sin(u * 19 - Math.sin(v * 2)) * 0.09,
          Math.cos(v * 2 + Math.sin(u * 3)) * 0.025, 1,
        ).normalize();
        const offset = (y * size + x) * 4;
        pixels[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
        pixels[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
        pixels[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
        pixels[offset + 3] = 255;
      }
    }
    rodGrainNormal = new THREE.DataTexture(pixels, size, size);
    rodGrainNormal.name = "rod-longitudinal-grain-normal";
    rodGrainNormal.wrapS = THREE.RepeatWrapping;
    rodGrainNormal.wrapT = THREE.RepeatWrapping;
    rodGrainNormal.magFilter = THREE.LinearFilter;
    rodGrainNormal.minFilter = THREE.LinearMipmapLinearFilter;
    rodGrainNormal.generateMipmaps = true;
    rodGrainNormal.repeat.set(1, 5);
    rodGrainNormal.needsUpdate = true;
  }
  return new THREE.MeshPhysicalMaterial({
    name: "proc-rod-varnished-wood", color: 0xffffff, vertexColors: true,
    roughness: 0.43, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.32,
    normalMap: rodGrainNormal, normalScale: new THREE.Vector2(0.24, 0.18),
  });
}

/** A low-sided cylinder aligned between two points. */
function segmentBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  topRadius: number,
  bottomRadius: number,
  radialSegments: number,
): THREE.BufferGeometry {
  const delta = end.clone().sub(start);
  const length = delta.length();
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, length, radialSegments);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  geometry.applyQuaternion(rotation);
  geometry.translate(
    (start.x + end.x) / 2,
    (start.y + end.y) / 2,
    (start.z + end.z) / 2,
  );
  return geometry;
}

/** Normalize geometry indexing and bake linear vertex colour before merging material groups. */
function paint(geometry: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const position = flat.attributes["position"];
  if (!position) throw new Error("proceduralGear: geometry has no position attribute");

  const linear = new THREE.Color(colour);
  const channels = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    channels[vertex * 3] = linear.r;
    channels[vertex * 3 + 1] = linear.g;
    channels[vertex * 3 + 2] = linear.b;
  }
  flat.setAttribute("color", new THREE.Float32BufferAttribute(channels, 3));
  return flat;
}

function mergedMesh(
  parts: readonly THREE.BufferGeometry[],
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const merged = mergeGeometries([...parts], false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`proceduralGear: ${name} parts did not merge`);
  // Merged geometry carries no bounds. Three would compute them lazily on the first frustum test,
  // which is a mid-frame cost; this runs once, at boot.
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  return mesh;
}

/** A closed oval loft. Shared ring vertices smooth the rounded grip and forged fittings. */
function loft(rings: readonly Ring[], axis: "x" | "y", sides = 24): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [row, ring] of rings.entries()) {
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const across = Math.cos(angle) * ring.radius;
      const depth = Math.sin(angle) * ring.depth;
      if (axis === "y") positions.push(across, ring.at, depth);
      else positions.push(ring.at, across + (ring.bend ?? 0), depth);
      // Restrained recess darkening leaves the lighting responsible for the form.
      const tone = 0.91 + 0.045 * Math.cos(angle * 3 + row * 0.65);
      colors.push(tone, tone, tone);
      if (row === 0) continue;
      const a = (row - 1) * sides + side;
      const b = (row - 1) * sides + (side + 1) % sides;
      const c = row * sides + (side + 1) % sides;
      const d = row * sides + side;
      // Looking down +Y, increasing angle winds clockwise; the X loft reverses it.
      if (axis === "y") indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }
  for (const [end, row] of [[-1, 0], [1, rings.length - 1]] as const) {
    const ring = rings[row]!;
    const center = positions.length / 3;
    if (axis === "y") positions.push(0, ring.at, 0);
    else positions.push(ring.at, ring.bend ?? 0, 0);
    colors.push(0.94, 0.94, 0.94);
    for (let side = 0; side < sides; side++) {
      const a = row * sides + side;
      const b = row * sides + (side + 1) % sides;
      if ((axis === "y" ? end : -end) > 0) indices.push(center, b, a);
      else indices.push(center, a, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mergeOwned(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const expanded = parts.map((part) => part.index ? part.toNonIndexed() : part);
  const merged = mergeGeometries(expanded);
  for (const geometry of new Set([...parts, ...expanded])) geometry.dispose();
  if (!merged) throw new Error("Equipment detail geometries have incompatible attributes");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function daggerBlade(): THREE.BufferGeometry {
  const faces = new Faces();
  const rows = [
    { y: 0.006, width: 0.037, thickness: 0.009, fuller: 0 },
    { y: 0.050, width: 0.037, thickness: 0.009, fuller: 0 },
    { y: 0.068, width: 0.047, thickness: 0.010, fuller: 0 },
    { y: 0.098, width: 0.046, thickness: 0.010, fuller: 1 },
    { y: 0.295, width: 0.039, thickness: 0.0085, fuller: 1 },
    { y: 0.402, width: 0.030, thickness: 0.007, fuller: 1 },
    { y: 0.473, width: 0.019, thickness: 0.005, fuller: 0 },
    { y: 0.535, width: 0.008, thickness: 0.0027, fuller: 0 },
  ];
  const rails = [-1, -0.76, -0.24, -0.10, 0.10, 0.24, 0.76, 1];
  function point(row: typeof rows[number], rail: number, front: number): Point {
    const across = Math.abs(rails[rail]!);
    const height = across === 1 ? 0.04 : across === 0.76 ? 0.56
      : across === 0.24 ? 1 : 1 - row.fuller * 0.34;
    return [rails[rail]! * row.width, row.y, row.thickness * height * front];
  }
  for (const front of [1, -1]) {
    for (let row = 0; row < rows.length - 1; row++) {
      for (let rail = 0; rail < rails.length - 1; rail++) {
        const a = point(rows[row]!, rail, front);
        const b = point(rows[row]!, rail + 1, front);
        const c = point(rows[row + 1]!, rail + 1, front);
        const d = point(rows[row + 1]!, rail, front);
        const edge = rail === 0 || rail === rails.length - 2;
        const fuller = rail === 3 && rows[row]!.fuller > 0;
        const tone = edge ? 1 : fuller ? 0.57 : 0.79 + (rail % 3) * 0.045;
        if (front > 0) faces.quad(a, b, c, d, tone);
        else faces.quad(d, c, b, a, tone);
      }
    }
    const last = rows.at(-1)!;
    for (let rail = 0; rail < rails.length - 1; rail++) {
      const a = point(last, rail, front);
      const b = point(last, rail + 1, front);
      const tip: Point = [0, 0.570, 0];
      if (front > 0) faces.triangle(a, b, tip, 0.92);
      else faces.triangle(b, a, tip, 0.92);
    }
  }
  // Close the edge and tang rather than relying on a double-sided material.
  for (const rail of [0, rails.length - 1]) {
    for (let row = 0; row < rows.length - 1; row++) {
      const a = point(rows[row]!, rail, 1);
      const b = point(rows[row]!, rail, -1);
      const c = point(rows[row + 1]!, rail, -1);
      const d = point(rows[row + 1]!, rail, 1);
      if (rail === 0) faces.quad(a, d, c, b);
      else faces.quad(a, b, c, d);
    }
    const a = point(rows.at(-1)!, rail, 1);
    const b = point(rows.at(-1)!, rail, -1);
    if (rail === 0) faces.triangle(a, [0, 0.570, 0], b);
    else faces.triangle(b, [0, 0.570, 0], a);
  }
  for (let rail = 0; rail < rails.length - 1; rail++) {
    faces.quad(point(rows[0]!, rail, -1), point(rows[0]!, rail + 1, -1),
      point(rows[0]!, rail + 1, 1), point(rows[0]!, rail, 1), 0.72);
  }
  // Fine, uneven honing marks live on the long primary bevels on both sides.
  for (const front of [-1, 1]) {
    for (let mark = 0; mark < 12; mark++) {
      const y = 0.12 + mark * 0.0223;
      const row = y < 0.295 ? 3 : 4;
      const a = rows[row]!;
      const b = rows[row + 1]!;
      const sample = (atY: number, rail: number): Point => {
        const fraction = (atY - a.y) / (b.y - a.y);
        const width = THREE.MathUtils.lerp(a.width, b.width, fraction);
        const thickness = THREE.MathUtils.lerp(a.thickness, b.thickness, fraction);
        const height = THREE.MathUtils.lerp(1, 0.56, (Math.abs(rail) - 0.24) / 0.52);
        return [width * rail, atY, front * (thickness * height + 0.000025)];
      };
      const side = mark % 2 ? 1 : -1;
      const start = side * (0.37 + (mark % 3) * 0.05);
      const p = sample(y, start);
      const q = sample(y + 0.009, start + side * 0.11);
      const r = sample(y + 0.0092, start + side * 0.112);
      if (front * side > 0) faces.triangle(p, q, r, 0.88);
      else faces.triangle(p, r, q, 0.88);
    }
  }
  return faces.geometry();
}

function leatherGrip(): THREE.BufferGeometry {
  const rings: Ring[] = [];
  for (let row = 0; row <= 10; row++) {
    const fraction = row / 10;
    const swell = Math.sin(fraction * Math.PI);
    rings.push({ at: -0.170 + fraction * 0.140, radius: 0.025 + swell * 0.004,
      depth: 0.018 + swell * 0.003 });
  }
  const wrap = new Faces();
  const turns = 7;
  const steps = turns * 28;
  function point(step: number, edge: number): Point {
    const fraction = step / steps;
    const y = -0.163 + fraction * 0.126 + edge * 0.0038;
    const angle = fraction * turns * Math.PI * 2;
    const swell = Math.sin((y + 0.170) / 0.140 * Math.PI);
    const ridge = edge === 0 ? 0.0013 : 0.00025;
    return [Math.cos(angle) * (0.025 + swell * 0.004 + ridge), y,
      Math.sin(angle) * (0.018 + swell * 0.003 + ridge)];
  }
  for (let step = 0; step < steps; step++) {
    for (const edge of [-1, 0]) {
      wrap.quad(point(step, edge), point(step, edge + 1),
        point(step + 1, edge + 1), point(step + 1, edge), edge === 0 ? 0.91 : 0.73);
    }
  }
  return mergeOwned([loft(rings, "y"), wrap.geometry()]);
}

/**
 * Shared production dagger, in metres. Origin is the guard, blade points +Y, and the grip center
 * is [0, -0.100, 0]. The existing Rx(PI/2) socket therefore needs the sword's 0.100 m grip offset.
 * Four meshes keep metal tint, leather and gem independent. Every call creates fresh resources;
 * the asset registry may own and cache the result, while icons may dispose their own result.
 */
export function buildEquipmentDagger(): THREE.Group {
  const group = new THREE.Group();
  group.name = "equipment-dagger";
  group.userData.gripCenter = [0, -0.100, 0];
  const guard = loft([
    { at: -0.090, radius: 0.001, depth: 0.003, bend: 0.017 },
    { at: -0.086, radius: 0.006, depth: 0.010, bend: 0.017 },
    { at: -0.074, radius: 0.008, depth: 0.014, bend: 0.014 },
    { at: -0.054, radius: 0.009, depth: 0.017, bend: 0.008 },
    { at: -0.031, radius: 0.011, depth: 0.021, bend: 0.002 },
    { at: 0, radius: 0.013, depth: 0.024, bend: 0 },
    { at: 0.031, radius: 0.011, depth: 0.021, bend: 0.002 },
    { at: 0.054, radius: 0.009, depth: 0.017, bend: 0.008 },
    { at: 0.074, radius: 0.008, depth: 0.014, bend: 0.014 },
    { at: 0.086, radius: 0.006, depth: 0.010, bend: 0.017 },
    { at: 0.090, radius: 0.001, depth: 0.003, bend: 0.017 },
  ], "x", 16);
  const topCollar = loft([
    { at: -0.036, radius: 0.025, depth: 0.018 },
    { at: -0.033, radius: 0.028, depth: 0.021 },
    { at: -0.022, radius: 0.028, depth: 0.021 },
    { at: -0.018, radius: 0.025, depth: 0.019 },
    { at: -0.010, radius: 0.025, depth: 0.019 },
  ], "y");
  const pommel = loft([
    { at: -0.208, radius: 0.012, depth: 0.008 },
    { at: -0.205, radius: 0.023, depth: 0.014 },
    { at: -0.196, radius: 0.034, depth: 0.022 },
    { at: -0.183, radius: 0.033, depth: 0.022 },
    { at: -0.176, radius: 0.025, depth: 0.018 },
    { at: -0.173, radius: 0.025, depth: 0.018 },
    { at: -0.170, radius: 0.028, depth: 0.020 },
    { at: -0.165, radius: 0.028, depth: 0.020 },
  ], "y");
  const gems = [-1, 1].map((side) => {
    const geometry = buildEquipmentCoreGeometry();
    geometry.scale(0.010, 0.012, 0.006);
    geometry.translate(0, -0.189, side * 0.022);
    return geometry;
  });
  const parts: Record<EquipmentRole, THREE.BufferGeometry> = {
    blade: daggerBlade(), metal: mergeOwned([guard, topCollar, pommel]),
    leather: leatherGrip(), gem: mergeOwned(gems),
  };
  const materials: Record<EquipmentRole, THREE.MeshStandardMaterial> = {
    blade: new THREE.MeshStandardMaterial({ color: 0xe7e9eb, metalness: 0.82, roughness: 0.29, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa7a7a5, metalness: 0.76, roughness: 0.39, vertexColors: true }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4e3427, metalness: 0, roughness: 0.88, vertexColors: true }),
    gem: new THREE.MeshPhysicalMaterial({ color: 0x6c8c92, metalness: 0.08, roughness: 0.18,
      clearcoat: 0.8, clearcoatRoughness: 0.16, vertexColors: true }),
  };
  for (const role of Object.keys(parts) as EquipmentRole[]) {
    const material = materials[role];
    material.name = `equipment-dagger-${role}`;
    material.userData.equipmentRole = role;
    const mesh = new THREE.Mesh(parts[role], material);
    mesh.name = `equipment-dagger-${role}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
