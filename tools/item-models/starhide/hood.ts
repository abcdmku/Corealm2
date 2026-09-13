import * as THREE from 'three';
import type { StarhideMaterials } from './contracts.js';

type Surface = (u: number, v: number) => THREE.Vector3;
type Path = (t: number) => THREE.Vector3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const TAU = Math.PI * 2;

function normal(f: Surface, u: number, v: number) {
  const du = f(clamp(u + .0001, 0, 1), v).sub(f(clamp(u - .0001, 0, 1), v));
  const dv = f(u, clamp(v + .0001, 0, 1)).sub(f(u, clamp(v - .0001, 0, 1)));
  const n = du.cross(dv).normalize();
  return n.lengthSq() > .1 ? n : V(0, 1, 0);
}

/** Sewn cloth is a closed 2 mm shell, with independently shaded inner and edge faces. */
function shell(g: THREE.Group, name: string, f: Surface, outer: THREE.Material, inner: THREE.Material,
  nu = 40, nv = 24, thickness = .002, uvScale: [number, number] = [1, 1]) {
  const p: number[] = [], uv: number[] = [], indices: number[] = [];
  const count = (nu + 1) * (nv + 1);
  for (let side = 0; side < 2; side++) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, q = f(u, v);
    if (side) q.addScaledVector(normal(f, u, v), -thickness);
    p.push(q.x, q.y, q.z); uv.push(u * uvScale[0], v * uvScale[1]);
  }
  for (let side = 0; side < 2; side++) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = side * count + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (!side) indices.push(a, b, c, b, d, c); else indices.push(a, c, b, b, c, d);
  }
  const surfaceCount = indices.length;
  // Duplicate the boundary vertices so the thin cut edges do not round the cloth normals.
  const edge = (a: number, b: number) => {
    const base = p.length / 3;
    for (const k of [a, a + count, b, b + count]) {
      p.push(p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!); uv.push(uv[k * 2]!, uv[k * 2 + 1]!);
    }
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  for (let i = 0; i < nu; i++) { edge(i + 1, i); edge(nv * (nu + 1) + i, nv * (nu + 1) + i + 1); }
  for (let j = 0; j < nv; j++) { edge(j * (nu + 1), (j + 1) * (nu + 1)); edge((j + 1) * (nu + 1) + nu, j * (nu + 1) + nu); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
  geo.addGroup(0, surfaceCount / 2, 0); geo.addGroup(surfaceCount / 2, indices.length - surfaceCount / 2, 1);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, [outer, inner]); mesh.name = name;
  mesh.userData.itemModelBone = 'Head'; g.add(mesh); return mesh;
}

function binding(g: THREE.Group, name: string, path: Path, outward: Path, width: number, m: THREE.Material, segments = 56) {
  const f: Surface = (u, v) => {
    const q = path(v), n = outward(v).normalize();
    const tangent = path(clamp(v + .0001, 0, 1)).sub(path(clamp(v - .0001, 0, 1))).normalize();
    const across = tangent.clone().cross(n).normalize();
    return q.addScaledVector(across, (u - .5) * width).addScaledVector(n, .0011 + .0008 * Math.sin(Math.PI * u));
  };
  return shell(g, name, f, m, m, 4, segments, .001, [1, 5]);
}

function edge(g: THREE.Group, name: string, f: Surface, axis: 'u' | 'v', value: number, m: StarhideMaterials, width = .0043) {
  const at: Path = t => axis === 'u' ? f(t, value) : f(value, t);
  const n: Path = t => axis === 'u' ? normal(f, t, value) : normal(f, value, t);
  binding(g, name, at, n, width, m.silver);
}

function stitches(g: THREE.Group, name: string, f: Surface, axis: 'u' | 'v', value: number, material: THREE.Material, total: number) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let s = 0; s < total; s++) {
    const a = (s + .10) / total, b = (s + .57) / total;
    const at = (t: number) => axis === 'u' ? f(t, value) : f(value, t);
    const q1 = at(a), q2 = at(b), n = axis === 'u' ? normal(f, a, value) : normal(f, value, a);
    const across = q2.clone().sub(q1).cross(n).normalize().multiplyScalar(.00035);
    q1.addScaledVector(n, .0012); q2.addScaledVector(n, .0012);
    const base = p.length / 3;
    for (const q of [q1.clone().sub(across), q1.clone().add(across), q2.clone().sub(across), q2.clone().add(across)]) p.push(q.x, q.y, q.z);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1); ix.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.name = name; mesh.userData.itemModelBone = 'Head'; g.add(mesh);
}

function star(g: THREE.Group, name: string, center: THREE.Vector3, n: THREE.Vector3, width: number, height: number, m: StarhideMaterials) {
  const points = [[0, 1], [.15, .19], [1, 0], [.16, -.14], [0, -.7], [-.16, -.14], [-1, 0], [-.15, .19]];
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x! * width, y! * height) : shape.moveTo(x! * width, y! * height)); shape.closePath();
  const hole = new THREE.Path();
  [[0, .32], [-.23, 0], [0, -.28], [.23, 0]].forEach(([x, y], i) => i ? hole.lineTo(x! * width, y! * height) : hole.moveTo(x! * width, y! * height)); hole.closePath(); shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: .0012, bevelEnabled: true, bevelSegments: 2, bevelSize: .00045, bevelThickness: .0003, steps: 1 });
  const mesh = new THREE.Mesh(geo, m.silver); mesh.name = name; mesh.position.copy(center);
  mesh.quaternion.setFromUnitVectors(V(0, 0, 1), n.normalize()); mesh.userData.itemModelBone = 'Head'; g.add(mesh);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(width * .20, 0), m.gem); gem.name = `${name} violet inset`;
  gem.scale.set(1, 1.45, .19); gem.quaternion.copy(mesh.quaternion); gem.position.copy(center).addScaledVector(n, .0018); gem.userData.itemModelBone = 'Head'; g.add(gem);
}

type Ring = [number, number, number, number, number, number];
// v, height, half-width, depth radius, depth center, face-opening angle.
const rings: Ring[] = [
  [0, 1.454, .159, .145, -.029, .68],
  [.14, 1.515, .143, .126, -.027, .80],
  [.29, 1.575, .114, .119, -.012, .83],
  [.45, 1.642, .101, .116, -.006, .78],
  [.59, 1.704, .098, .116, -.005, .80],
  [.72, 1.758, .086, .106, -.006, .70],
  [.82, 1.798, .067, .084, -.009, 0],
  [.90, 1.817, .044, .059, -.012, 0],
  [.965, 1.826, .018, .026, -.016, 0],
  [1, 1.829, .0006, .0006, -.016, 0],
];

function hoodSurface(u: number, v: number) {
  let index = rings.findIndex(r => r[0] >= v); if (index <= 0) index = 1;
  const a = rings[index - 1]!, b = rings[index]!;
  const t = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
  // Monotone cubic slopes keep the skull and drape profile smooth across authored sections.
  const mix = (i: number) => {
    const slope = (at: number) => {
      if (at === 0) return (rings[1]![i]! - rings[0]![i]!) / (rings[1]![0] - rings[0]![0]);
      if (at === rings.length - 1) return (rings[at]![i]! - rings[at - 1]![i]!) / (rings[at]![0] - rings[at - 1]![0]);
      const before = (rings[at]![i]! - rings[at - 1]![i]!) / (rings[at]![0] - rings[at - 1]![0]);
      const after = (rings[at + 1]![i]! - rings[at]![i]!) / (rings[at + 1]![0] - rings[at]![0]);
      if (before * after <= 0) return 0;
      return Math.sign(before) * Math.min((Math.abs(before) + Math.abs(after)) * .5, Math.abs(before) * 2, Math.abs(after) * 2);
    };
    const span = b[0] - a[0], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[i]! + (t3 - 2 * t2 + t) * span * slope(index - 1)
      + (-2 * t3 + 3 * t2) * b[i]! + (t3 - t2) * span * slope(index);
  };
  const angle = mix(5) + (TAU - mix(5) * 2) * u;
  // Small seam tension ripples, rather than helmet-like inflated ridges.
  const fold = .0022 * Math.sin(v * 24 + angle * 3) * Math.sin(v * Math.PI) * Math.pow(Math.sin(angle), 2);
  const lowerSweep = .047 * Math.pow(1 - v, 5) * Math.sin(angle) ** 2;
  // The rear point is sewn into a continuous falling center-back gusset. Its side silhouette
  // must not leave a triangular window between the tip and the upper-back collar.
  const rearWeight = Math.pow(Math.max(0, -Math.cos(angle)), 7);
  const rearGather = .134 * Math.exp(-Math.pow((v - .469) / .153, 2)) * rearWeight;
  // Inward diagonal creases give the gusset soft cloth folds without adding helmet volume.
  const crease = .012 * (.5 + .5 * Math.cos(v * 45 + angle * 15))
    * Math.exp(-Math.pow((v - .535) / .20, 2)) * Math.pow(Math.max(0, -Math.cos(angle)), 3);
  return V((mix(2) + fold - crease) * Math.sin(angle), mix(1) + lowerSweep,
    mix(4) + (mix(3) + fold - crease) * Math.cos(angle) - rearGather + crease * .7);
}

/** Exact-icon reconstruction, fitted over the native male 1.81 m crown and 0.176 m ear width. */
export function buildHood(m: StarhideMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = 'Starhide hood';
  const hood = hoodSurface;
  shell(g, 'Starhide fitted midnight woven crown and hanging side cloth', hood, m.cloth, m.lining, 72, 56, .0023, [1.9, 1.4]);
  const opening: Surface = (u, v) => hood(u, v * .82);
  for (const u of [0, 1]) {
    edge(g, 'Starhide thin silver peaked face opening', opening, 'v', u, m, .0087);
    stitches(g, 'Starhide face edge pale saddle stitches', opening, 'v', u === 0 ? .009 : .991, m.thread, 70);
  }
  edge(g, 'Starhide curved lower sidecloth silver hem', hood, 'u', 0, m, .0050);
  for (const u of [.215, .5, .785]) stitches(g, 'Starhide sewn crown panel seam', hood, 'v', u, m.thread, 66);

  // Each temple panel follows the crown exactly and stays below its raised cloth seam.
  for (const side of [-1, 1]) {
    const patch: Surface = (u, v) => {
      const width = .087 * Math.sin(Math.PI * (.09 + v * .85)) + .014;
      const center = side < 0 ? .817 : .183;
      const hu = center + (u - .5) * width;
      const hv = .235 + v * (.555 - .062 * Math.abs(u - .5));
      return hood(hu, hv).addScaledVector(normal(hood, hu, hv), .0031);
    };
    shell(g, `Starhide ${side > 0 ? 'right' : 'left'} teal violet temple scale inset`, patch, m.scales, m.lining, 20, 28, .0013, [.6, 1]);
    for (const u of [0, 1]) edge(g, 'Starhide temple inset flat silver border', patch, 'v', u, m, .0043);
    for (const v of [0, 1]) edge(g, 'Starhide pointed temple inset cap border', patch, 'u', v, m, .0043);
    const q = patch(side > 0 ? 0 : 1, .16), n = normal(patch, side > 0 ? 0 : 1, .16);
    star(g, 'Starhide side four-point silver filigree', q.addScaledVector(n, .002), n, .013, .023, m);
  }

  // The long rear point is cloth cut on the bias. Its flattened cross section falls from the rounded crown.
  const rearAxis = new THREE.CatmullRomCurve3([V(0, 1.745, -.063), V(.002, 1.740, -.142), V(.009, 1.704, -.199), V(.018, 1.667, -.232), V(.026, 1.651, -.259)]);
  const rear: Surface = (u, v) => {
    const q = rearAxis.getPoint(v), tangent = rearAxis.getTangent(v).normalize();
    const across = V(1, 0, 0), vertical = tangent.clone().cross(across).normalize();
    const a = -u * TAU, r = .064 * Math.pow(1 - v, 1.18) + .0005;
    const fluting = 1 + .045 * Math.cos(a * 5 + v * 8) * Math.sin(Math.PI * v);
    return q.addScaledVector(across, Math.sin(a) * r * .80).addScaledVector(vertical, Math.cos(a) * r * fluting);
  };
  shell(g, 'Starhide long curved supple rear hood point', rear, m.cloth, m.lining, 40, 30, .0017, [1, 1.1]);
  // The sewn root remains closed even when the camera catches its junction with the crown.
  const rearRoot: Surface = (u, v) => rear(1 - u, 0).lerp(rearAxis.getPoint(0), v * .9995);
  shell(g, 'Starhide enclosed rear fold sewn root', rearRoot, m.cloth, m.lining, 40, 6, .0015);
  stitches(g, 'Starhide rear point center stitched seam', rear, 'v', .25, m.thread, 50);

  // A dark inset sits behind the eye opening. The visible veil begins below it and hangs in shallow catenary folds.
  const darkness: Surface = (u, v) => {
    const rim = hood(0, .50 + v * .3198), x = (u * 2 - 1) * rim.x * .995;
    // Recess at the silver rim, bowed just ahead of the native face through the eye line.
    return V(x, rim.y, rim.z - .002 + .048 * Math.sqrt(Math.sin(Math.PI * v)) * Math.pow(Math.sin(Math.PI * u), .7));
  };
  shell(g, 'Starhide recessed dark eye opening lining', darkness, m.lining, m.lining, 24, 12, .0015);
  const veil: Surface = (u, v) => {
    const across = u * 2 - 1;
    const x = across * (.009 + .087 * Math.pow(v, .62));
    const y = 1.400 + .278 * v + .032 * across * across * (1 - v) + .013 * Math.abs(across) ** 3 * v;
    const phase = v * 22 - Math.abs(across) * 2.4;
    const folds = .010 * Math.sin(phase) * Math.sin(Math.PI * v) * (1 - Math.abs(across) ** 2);
    const z = .146 - .017 * v - .016 * Math.abs(across) ** 1.7 + folds;
    return V(x, y, z);
  };
  shell(g, 'Starhide pointed draped navy lower face veil with sewn folds', veil, m.cloth, m.lining, 42, 56, .002, [.85, 1.35]);
  edge(g, 'Starhide veil top narrow silver edge', veil, 'u', 1, m, .0063);
  for (const u of [0, 1]) {
    edge(g, 'Starhide pointed veil side silver hem', veil, 'v', u, m, .0053);
    stitches(g, 'Starhide veil hem stitches', veil, 'v', u === 0 ? .026 : .974, m.thread, 56);
  }
  stitches(g, 'Starhide veil upper edge stitching', veil, 'u', .975, m.thread, 38);

  // Narrow scale leaves frame the bottom veil, continuing the reference's long pointed chest opening.
  for (const side of [-1, 1]) {
    const leaf: Surface = (u, v) => {
      const innerX = .009 + .087 * Math.pow(v, .62);
      const span = .035 * Math.sin(Math.PI * v) ** .68;
      return V(side * (innerX + u * span), 1.400 + .278 * v + .027 * u * Math.sin(Math.PI * v), .132 - .020 * v - .039 * u * Math.sin(Math.PI * v));
    };
    const patch: Surface = side > 0 ? leaf : (u, v) => leaf(1 - u, v);
    shell(g, 'Starhide long narrow throat-side iridescent scale leaf', patch, m.scales, m.lining, 10, 40, .0018, [.31, .80]);
    for (const u of [0, 1]) edge(g, 'Starhide throat scale leaf flat silver binding', patch, 'v', u, m, .0045);
  }

  star(g, 'Starhide peaked forehead four-point open silver filigree', V(0, 1.795, .080), V(0, .30, 1), .017, .029, m);
  star(g, 'Starhide veil center descending star clasp', veil(.5, 1).add(V(0, .002, .002)), V(0, 0, 1), .011, .018, m);
  g.userData.fit = { nativeBody: 'base_male', crownY: 1.81, clothThicknessMeters: .002, frontVeilMinY: 1.4, headBone: 'Head' };
  return g;
}
