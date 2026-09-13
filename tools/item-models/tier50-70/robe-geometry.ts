import * as THREE from 'three';
import { bodyProfile } from '../core/profile.js';
import type { ArmorMaterials, Surface } from './contracts.js';

export type Domain = 'skirt' | 'spine_03' | undefined;
export type UV = [number, number];
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const mix = THREE.MathUtils.lerp;
export const clamp = (x: number) => THREE.MathUtils.clamp(x, 0, 1);
export const TAU = Math.PI * 2;

const sections = bodyProfile.torso;
const ringCount = 96;
const rings = sections.map(section => Array.from({ length: ringCount }, (_, k) => {
  const angle = k / ringCount * TAU, dx = Math.sin(angle), dz = Math.cos(angle);
  let r = 0;
  for (let i = 0; i < section.outline.length; i++) {
    const p = section.outline[i]!, q = section.outline[(i + 1) % section.outline.length]!;
    const x = p[0] - section.center[0], z = p[1] - section.center[1];
    const ex = q[0] - p[0], ez = q[1] - p[1], det = dx * ez - dz * ex;
    if (Math.abs(det) < 1e-9) continue;
    const radius = (x * ez - z * ex) / det, f = (x * dz - z * dx) / det;
    if (radius > r && f >= -1e-5 && f <= 1.00001) r = radius;
  }
  return r;
})).map(ring => ring.map((r, i) => r * .5 + ring[(i + ringCount - 1) % ringCount]! * .25 + ring[(i + 1) % ringCount]! * .25));
const cubic = (a: number, b: number, c: number, d: number, t: number) => b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

/** Smooth native-body cross sections retain the narrow waist and asymmetric chest. */
export function bodyPoint(y: number, angle: number, ease = .014): THREE.Vector3 {
  let i = 0;
  while (i < sections.length - 2 && y > sections[i + 1]!.level) i++;
  const a = sections[i]!, b = sections[i + 1]!, t = clamp((y - a.level) / (b.level - a.level));
  const q = ((angle / TAU % 1) + 1) % 1 * ringCount, k = Math.floor(q), f = q - k;
  const rAt = (j: number) => {
    const ring = rings[Math.max(0, Math.min(rings.length - 1, j))]!;
    return cubic(ring[(k + ringCount - 1) % ringCount]!, ring[k]!, ring[(k + 1) % ringCount]!, ring[(k + 2) % ringCount]!, f);
  };
  const radius = Math.max(mix(rAt(i), rAt(i + 1), t) - .001, cubic(rAt(i - 1), rAt(i), rAt(i + 1), rAt(i + 2), t)) + ease;
  return V(mix(a.center[0], b.center[0], t) + Math.sin(angle) * radius, y,
    mix(a.center[1], b.center[1], t) + Math.cos(angle) * radius);
}

export function normalAt(f: Surface, u: number, v: number): THREE.Vector3 {
  const du = f(Math.min(1, u + .0002), v).sub(f(Math.max(0, u - .0002), v));
  const dv = f(u, Math.min(1, v + .0002)).sub(f(u, Math.max(0, v - .0002)));
  const n = du.cross(dv);
  return n.lengthSq() > 1e-28 ? n.normalize() : V(0, 0, 1);
}

export function skin(mesh: THREE.Object3D, domain?: Domain) {
  if (domain === 'skirt') mesh.userData.itemModelDeform = 'skirt';
  else if (domain) mesh.userData.itemModelBone = domain;
}

/** Closed cloth, cut leather, and metal strips share a smooth metric-UV loft. */
export function shell(g: THREE.Group, name: string, f: Surface, outer: THREE.Material,
  inside: THREE.Material, nu = 24, nv = 24, thickness = .0025, domain?: Domain, hangingFabricUV = false): THREE.Mesh {
  const stride = nu + 1, count = stride * (nv + 1);
  const points: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
  const pos: number[] = [], uv: number[] = [], indices: number[] = [], length = new Float64Array(stride);
  for (let j = 0; j <= nv; j++) {
    let around = 0;
    for (let i = 0; i <= nu; i++) {
      const p = f(i / nu, j / nv);
      if (i) around += p.distanceTo(points[points.length - 1]!);
      if (j) length[i] = length[i]! + p.distanceTo(points[(j - 1) * stride + i]!);
      points.push(p); normals.push(normalAt(f, i / nu, j / nv)); uv.push(around * 4, length[i]! * 4);
    }
    if (hangingFabricUV) for(let i=0;i<=nu;i++) {
      const k=j*stride+i;
      // Cut an upright textile sheet into the pointed panel. Starting V at
      // each different hem height bends every woven motif into a long chevron.
      // Center metric U per row and keep V at garment height instead.
      uv[k*2]=uv[k*2]!-around*2;
      uv[k*2+1]=points[k]!.y*4;
    }
  }
  for (let s = 0; s < 2; s++) for (let k = 0; k < count; k++) {
    const p = points[k]!.clone().addScaledVector(normals[k]!, s ? -thickness : 0); pos.push(p.x, p.y, p.z);
  }
  const geo = new THREE.BufferGeometry();
  for (let s = 0; s < 2; s++) {
    const start = indices.length;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = s * count + j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      if (s) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
    }
    geo.addGroup(start, indices.length - start, s);
  }
  const wallStart = indices.length;
  const wall = (a: number, b: number) => indices.push(a, a + count, b, b, a + count, b + count);
  for (let i = 0; i < nu; i++) { wall(i + 1, i); wall(nv * stride + i, nv * stride + i + 1); }
  for (let j = 0; j < nv; j++) { wall(j * stride, (j + 1) * stride); wall((j + 1) * stride + nu, j * stride + nu); }
  geo.addGroup(wallStart, indices.length - wallStart, 1);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...uv, ...uv], 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  const attr = geo.getAttribute('normal');
  for (let s = 0; s < 2; s++) for (let k = 0; k < count; k++) {
    const n = normals[k]!; attr.setXYZ(s * count + k, n.x * (s ? -1 : 1), n.y * (s ? -1 : 1), n.z * (s ? -1 : 1));
  }
  const mesh = new THREE.Mesh(geo, [outer, inside]); mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true; skin(mesh, domain); g.add(mesh); return mesh;
}

export const offset = (f: Surface, distance: number): Surface => (u, v) => f(u, v).addScaledVector(normalAt(f, u, v), distance);
export const face = (f: Surface, direction: THREE.Vector3): Surface => normalAt(f, .5, .5).dot(direction) < 0 ? (u, v) => f(1 - u, v) : f;

/** The cross section has bevelled edges and a recessed engraved centre. */
export function ribbon(g: THREE.Group, name: string, f: Surface, path: UV[], width: number,
  material: THREE.Material, domain?: Domain, tapered = false, straight = false) {
  const curve = new THREE.CatmullRomCurve3(path.map(([u, v]) => V(u, v, 0)), false, 'centripetal');
  const location = (t: number): UV => {
    if (!straight && path.length > 2) { const q = curve.getPoint(clamp(t)); return [clamp(q.x), clamp(q.y)]; }
    const k = Math.min(path.length - 2, Math.floor(clamp(t) * (path.length - 1)));
    const a = path[k]!, b = path[k + 1]!, alpha = clamp(t) * (path.length - 1) - k;
    return [mix(a[0], b[0], alpha), mix(a[1], b[1], alpha)];
  };
  const strip: Surface = (u, v) => {
    const [a, b] = location(v), n = normalAt(f, a, b), p = f(a, b);
    const [a0, b0] = location(v - .0005), [a1, b1] = location(v + .0005);
    const tangent = f(a1, b1).sub(f(a0, b0)).normalize(), across = tangent.cross(n).normalize();
    const shape = tapered ? .10 + .90 * Math.pow(Math.sin(Math.PI * v), .65) : 1;
    const sewing = width < .0015;
    const bevel = sewing ? .0004 : .001 + .0017 * Math.min(1, Math.min(u, 1 - u) * 6) - .0006 * Math.exp(-Math.pow((u - .5) / .095, 2));
    return p.addScaledVector(across, (u - .5) * width * shape).addScaledVector(n, bevel + (sewing ? .0002 : .001));
  };
  return shell(g, name, strip, material, material, 4, Math.max(10, path.length * 3), width < .0015 ? .00065 : .0030, domain);
}

export function frame(g: THREE.Group, name: string, f: Surface, m: ArmorMaterials, width = .007, domain?: Domain) {
  width *= 1.12;
  ribbon(g, `${name} left engraved metal binding`, f, [[0, 0], [0, 1]], width, m.metal, domain);
  ribbon(g, `${name} right engraved metal binding`, f, [[1, 0], [1, 1]], width, m.metal, domain);
  ribbon(g, `${name} curved lower metal binding`, f, [[0, 0], [.25, 0], [.5, 0], [.75, 0], [1, 0]], width, m.metal, domain, false, true);
}

export function diamond(g: THREE.Group, name: string, f: Surface, u: number, v: number,
  du: number, dv: number, m: ArmorMaterials, domain?: Domain, jewel = false) {
  ribbon(g, `${name} carved diamond setting`, f, [[u, v + dv], [u + du, v], [u, v - dv], [u - du, v], [u, v + dv]],
    jewel ? .0062 : .0024, m.metal, domain, false, true);
  if (jewel) {
    const p = f(u, v).addScaledVector(normalAt(f, u, v), .006);
    const stone = new THREE.Mesh(new THREE.OctahedronGeometry(.018, 0), m.gem);
    stone.name = `${name} cut inset stone`; stone.scale.set(.58, 1.35, .32); stone.position.copy(p); skin(stone, domain); g.add(stone);
  }
}

export function filigree(g: THREE.Group, name: string, f: Surface, m: ArmorMaterials, domain?: Domain, dragon = false) {
  for (const side of [-1, 1]) {
    const s = (u: number) => .5 + side * u;
    ribbon(g, `${name} raised scrolling stem ${side}`, f,
      dragon
        ? [[s(.02), .055], [s(.12), .115], [s(.32), .18], [s(.29), .265], [s(.17), .25]]
        : [[s(0), .055], [s(.075), .12], [s(.23), .18], [s(.29), .28], [s(.19), .32]],
      dragon ? .0036 : .0023, m.metal, domain, true);
    ribbon(g, `${name} swept sculpted leaf ${side}`, f,
      dragon
        ? [[s(.12), .12], [s(.035), .185], [s(.17), .24], [s(.29), .20]]
        : [[s(.065), .11], [s(.22), .105], [s(.32), .16], [s(.23), .20]],
      dragon ? .0072 : .0034, m.metal, domain, true);
    ribbon(g, `${name} curled sculpted leaf ${side}`, f,
      dragon
        ? [[s(.19), .17], [s(.34), .16], [s(.36), .10], [s(.26), .085]]
        : [[s(.19), .20], [s(.075), .23], [s(.105), .30], [s(.19), .32]],
      dragon ? .0056 : .0030, m.metal, domain, true);
  }
  // Dragonhide's icon uses curled gilt leaves around its hem. Open stars belong
  // to the Starhide embroidery, separated from its shorter branching stems.
  if (!dragon) {
    diamond(g, `${name} lower open star`, f, .5, .090, .065, .035, m, domain);
    diamond(g, `${name} central open star`, f, .5, .39, .105, .044, m, domain);
  }
}
