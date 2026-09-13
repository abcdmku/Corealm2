import * as THREE from 'three';
import type { ArmorMaterials, Surface } from './contracts.js';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const clamp = THREE.MathUtils.clamp;
export type Path = (t: number) => THREE.Vector3;

export function normal(f: Surface, u: number, v: number): THREE.Vector3 {
  const du = f(clamp(u + .0001, 0, 1), v).sub(f(clamp(u - .0001, 0, 1), v));
  const dv = f(u, clamp(v + .0001, 0, 1)).sub(f(u, clamp(v - .0001, 0, 1)));
  const n = du.cross(dv).normalize();
  return n.lengthSq() > .1 ? n : V(0, 1, 0);
}

/** Closed sewn sheet. Separate edge vertices keep the 2 mm cloth hem crisp. */
export function shell(g: THREE.Group, name: string, f: Surface, outer: THREE.Material, inner: THREE.Material,
  nu = 32, nv = 24, thickness = .002, uvScale: [number, number] = [1, 1]): THREE.Mesh {
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

export function binding(g: THREE.Group, name: string, path: Path, outward: Path, width: number,
  material: THREE.Material, segments = 40, lift = .0011): void {
  const f: Surface = (u, v) => {
    const q = path(v), n = outward(v).normalize();
    const tangent = path(clamp(v + .0001, 0, 1)).sub(path(clamp(v - .0001, 0, 1))).normalize();
    const across = tangent.clone().cross(n).normalize();
    // The raised center and rolled edges catch different highlights on a real forged strip.
    const relief = .00065 * Math.sin(Math.PI * u) + .00035 * Math.cos(u * Math.PI * 4);
    return q.addScaledVector(across, (u - .5) * width).addScaledVector(n, lift + relief);
  };
  shell(g, name, f, material, material, 6, segments, .001, [1, 5]);
}

export function edge(g: THREE.Group, name: string, f: Surface, axis: 'u' | 'v', value: number,
  m: ArmorMaterials, width = .005, segments = 40): void {
  const at: Path = t => axis === 'u' ? f(t, value) : f(value, t);
  const n: Path = t => axis === 'u' ? normal(f, t, value) : normal(f, value, t);
  binding(g, name, at, n, width, m.metal, segments);
}

export function stitches(g: THREE.Group, name: string, f: Surface, axis: 'u' | 'v', value: number,
  material: THREE.Material, total: number, lift = .0013): void {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let s = 0; s < total; s++) {
    const a = (s + .10) / total, b = (s + .57) / total;
    const at = (t: number) => axis === 'u' ? f(t, value) : f(value, t);
    const q1 = at(a), q2 = at(b), n = axis === 'u' ? normal(f, a, value) : normal(f, value, a);
    const across = q2.clone().sub(q1).cross(n).normalize().multiplyScalar(.00032);
    q1.addScaledVector(n, lift); q2.addScaledVector(n, lift);
    const base = p.length / 3;
    for (const q of [q1.clone().sub(across), q1.clone().add(across), q2.clone().sub(across), q2.clone().add(across)]) p.push(q.x, q.y, q.z);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1); ix.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.name = name; mesh.userData.itemModelBone = 'Head'; g.add(mesh);
}

/** Sculpted openwork metal. Shapes are authored separately for the two icon crests. */
export function ornament(g: THREE.Group, name: string, center: THREE.Vector3, direction: THREE.Vector3,
  points: readonly (readonly [number, number])[], holes: readonly (readonly (readonly [number, number])[])[],
  m: ArmorMaterials, depth = .0014): THREE.Mesh {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  for (const outline of holes) {
    const hole = new THREE.Path(); outline.forEach(([x, y], i) => i ? hole.lineTo(x, y) : hole.moveTo(x, y)); hole.closePath(); shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: .0006, bevelThickness: .0004, steps: 1 });
  const mesh = new THREE.Mesh(geo, m.metal); mesh.name = name; mesh.position.copy(center);
  mesh.quaternion.setFromUnitVectors(V(0, 0, 1), direction.clone().normalize()); mesh.userData.itemModelBone = 'Head'; g.add(mesh);
  return mesh;
}

export function diamond(g: THREE.Group, name: string, center: THREE.Vector3, direction: THREE.Vector3,
  w: number, h: number, m: ArmorMaterials): void {
  ornament(g, `${name} beveled metal bezel`, center, direction,
    [[0, h], [w, 0], [0, -h], [-w, 0]], [[[0, h * .70], [-w * .59, 0], [0, -h * .70], [w * .59, 0]]], m);
  const geo = new THREE.OctahedronGeometry(1, 0); geo.scale(w * .61, h * .74, .0022);
  const mesh = new THREE.Mesh(geo, m.gem); mesh.name = `${name} faceted inset`;
  mesh.position.copy(center).addScaledVector(direction.clone().normalize(), .0017);
  mesh.quaternion.setFromUnitVectors(V(0, 0, 1), direction.clone().normalize()); mesh.userData.itemModelBone = 'Head'; g.add(mesh);
}

export function star(g: THREE.Group, name: string, center: THREE.Vector3, direction: THREE.Vector3,
  w: number, h: number, m: ArmorMaterials): void {
  ornament(g, name, center, direction,
    [[0, h], [.17 * w, .19 * h], [w, 0], [.18 * w, -.15 * h], [0, -.80 * h], [-.18 * w, -.15 * h], [-w, 0], [-.17 * w, .19 * h]],
    [[[0, h * .35], [-w * .27, 0], [0, -h * .31], [w * .27, 0]]], m);
}
