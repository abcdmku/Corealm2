import * as THREE from 'three';
import type { FitSection } from '../core/contracts';

export const TAU = Math.PI * 2;
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const lerp = THREE.MathUtils.lerp;
export type Surface = (u: number, v: number) => THREE.Vector3;

export function fit(sections: readonly FitSection[], y: number, angle: number, ease: number) {
  let i = 0;
  while (i < sections.length - 2 && y > sections[i + 1]!.level) i++;
  const a = sections[i]!, b = sections[i + 1]!;
  const t = THREE.MathUtils.clamp((y - a.level) / (b.level - a.level), 0, 1);
  function radius(s: FitSection) {
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let r = 0;
    for (let j = 0; j < s.outline.length; j++) {
      const p = s.outline[j]!, q = s.outline[(j + 1) % s.outline.length]!;
      const x = p[0] - s.center[0], z = p[1] - s.center[1];
      const ex = q[0] - p[0], ez = q[1] - p[1], det = dx * ez - dz * ex;
      if (Math.abs(det) < 1e-10) continue;
      const distance = (x * ez - z * ex) / det, segment = (x * dz - z * dx) / det;
      if (segment >= -.000001 && segment <= 1.000001) r = Math.max(r, distance);
    }
    return r;
  }
  const r = lerp(radius(a), radius(b), t) + ease;
  return V(lerp(a.center[0], b.center[0], t) + Math.sin(angle) * r, y,
    lerp(a.center[1], b.center[1], t) + Math.cos(angle) * r);
}

export function normal(fn: Surface, u: number, v: number) {
  u = THREE.MathUtils.clamp(u, .00001, .99999);
  v = THREE.MathUtils.clamp(v, .00001, .99999);
  const du = fn(Math.min(1, u + .0001), v).sub(fn(Math.max(0, u - .0001), v));
  const dv = fn(u, Math.min(1, v + .0001)).sub(fn(u, Math.max(0, v - .0001)));
  return du.cross(dv).normalize();
}

const profileCache = new WeakMap<object, Float64Array[]>();
const radialSamples = 128;
/** Smooth the measured body section edges without replacing the measured fit. */
export function smoothFit(sections: readonly FitSection[], y: number, angle: number, ease: number) {
  let rings = profileCache.get(sections);
  if (!rings) {
    const raw = sections.map(section => Float64Array.from({ length: radialSamples }, (_, k) => {
      const p = fit(sections, section.level, k / radialSamples * TAU, 0);
      return Math.hypot(p.x - section.center[0], p.z - section.center[1]);
    }));
    rings = raw.map(row => Float64Array.from(row, (_, k) =>
      (row[(k + radialSamples - 2) % radialSamples]! + 4 * row[(k + radialSamples - 1) % radialSamples]!
       + 6 * row[k]! + 4 * row[(k + 1) % radialSamples]! + row[(k + 2) % radialSamples]!) / 16 + .0005));
    profileCache.set(sections, rings);
  }
  let i = 0;
  while (i < sections.length - 2 && y > sections[i + 1]!.level) i++;
  const a = sections[i]!, b = sections[i + 1]!;
  const t = THREE.MathUtils.clamp((y - a.level) / (b.level - a.level), 0, 1);
  const u = ((angle / TAU % 1 + 1) % 1) * radialSamples, k = Math.floor(u), f = u - k;
  const cubic = (p0: number, p1: number, p2: number, p3: number, x: number) =>
    p1 + .5 * x * (p2 - p0 + x * (2 * p0 - 5 * p1 + 4 * p2 - p3 + x * (3 * (p1 - p2) + p3 - p0)));
  const radial = (j: number) => {
    const row = rings![THREE.MathUtils.clamp(j, 0, rings!.length - 1)]!;
    return cubic(row[(k + radialSamples - 1) % radialSamples]!, row[k % radialSamples]!, row[(k + 1) % radialSamples]!, row[(k + 2) % radialSamples]!, f);
  };
  const interpolate = (get: (j: number) => number) => {
    const j0 = Math.max(0, i - 1), j3 = Math.min(sections.length - 1, i + 2);
    const p1 = get(i), p2 = get(i + 1), span = b.level - a.level;
    const m1 = (p2 - get(j0)) / (b.level - sections[j0]!.level) * span;
    const m2 = (get(j3) - p1) / (sections[j3]!.level - a.level) * span;
    return (2*t*t*t-3*t*t+1)*p1 + (t*t*t-2*t*t+t)*m1 + (-2*t*t*t+3*t*t)*p2 + (t*t*t-t*t)*m2;
  };
  const r = Math.max(.001, interpolate(radial)) + ease;
  return V(interpolate(j => sections[j]!.center[0]) + Math.sin(angle) * r, y,
    interpolate(j => sections[j]!.center[1]) + Math.cos(angle) * r);
}

export function mesh(g: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) {
  const m = new THREE.Mesh(geometry, material); m.name = name; m.castShadow = m.receiveShadow = true;
  g.add(m); return m;
}

/** Real thin cloth shell. Texture coordinates retain physical distance and smooth normals. */
export function shell(g: THREE.Group, name: string, fn: Surface, outer: THREE.Material, lining: THREE.Material,
  nu = 48, nv = 24, thickness = .0025, uvScale = 4) {
  const points: THREE.Vector3[] = [], normals: THREE.Vector3[] = [], uv: number[] = [], p: number[] = [], ix: number[] = [];
  const stride = nu + 1, n = stride * (nv + 1), lengths = new Float64Array(stride);
  for (let j = 0; j <= nv; j++) {
    let across = 0;
    for (let i = 0; i <= nu; i++) {
      const point = fn(i / nu, j / nv);
      if (i) across += point.distanceTo(points[points.length - 1]!);
      if (j) lengths[i] = lengths[i]! + point.distanceTo(points[(j - 1) * stride + i]!);
      points.push(point); normals.push(normal(fn, i / nu, j / nv)); uv.push(across * uvScale, lengths[i]! * uvScale);
    }
  }
  for (let l = 0; l < 2; l++) for (let i = 0; i < n; i++) {
    const q = points[i]!.clone().addScaledVector(normals[i]!, l ? -thickness : 0); p.push(q.x, q.y, q.z);
  }
  const geometry = new THREE.BufferGeometry();
  for (let l = 0; l < 2; l++) {
    const start = ix.length;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = l * n + j * stride + i, b = a + stride;
      if (!l) ix.push(a, a + 1, b, a + 1, b + 1, b);
      else ix.push(a, b, a + 1, a + 1, b, b + 1);
    }
    geometry.addGroup(start, ix.length - start, l);
  }
  const wallStart = ix.length;
  const wall = (a: number, b: number) => ix.push(a, b, a + n, b, b + n, a + n);
  for (let i = 0; i < nu; i++) { wall(i + 1, i); wall(nv * stride + i, nv * stride + i + 1); }
  for (let j = 0; j < nv; j++) { wall(j * stride, (j + 1) * stride); wall((j + 1) * stride + nu, j * stride + nu); }
  geometry.addGroup(wallStart, ix.length - wallStart, 1);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...uv, ...uv], 2));
  geometry.setIndex(ix); geometry.computeVertexNormals();
  return mesh(g, name, geometry, [outer, lining]);
}

/** Flat, narrow ribbon sewn onto the garment, rather than inflated round piping. */
export function ribbon(g: THREE.Group, name: string, fn: Surface, path: (t: number) => [number, number],
  material: THREE.Material, width = .0027, segments = 48, lift = .001) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  const primary = material instanceof THREE.MeshStandardMaterial && material.metalness >= .55 && width >= .002;
  const cross = primary ? [-1, -.70, 0, .70, 1] : [-1, 1], stride = cross.length;
  let distance = 0, prior: THREE.Vector3 | undefined;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, [u, v] = path(t), n = normal(fn, u, v), a = path(Math.max(0, t - .0002)), b = path(Math.min(1, t + .0002));
    const tangent = fn(b[0], b[1]).sub(fn(a[0], a[1])).normalize();
    const side = tangent.cross(n).normalize();
    const center = fn(u, v).addScaledVector(n, lift);
    if (prior) distance += center.distanceTo(prior); prior = center.clone();
    for (const s of cross) {
      const q = center.clone().addScaledVector(side, width * s / 2).addScaledVector(n, primary ? .0013 * (1 - Math.abs(s) * .82) : 0);
      p.push(q.x, q.y, q.z); uv.push((s + 1) / 2, distance * 4);
    }
    if (i) for (let col = 0; col < stride - 1; col++) {
      const k = i * stride + col; ix.push(k - stride, k - stride + 1, k, k - stride + 1, k + 1, k);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  return mesh(g, name, geo, material);
}

export function border(g: THREE.Group, name: string, fn: Surface, mat: THREE.Material, width = .003) {
  ribbon(g, `${name} lower edge`, fn, t => [t, .002], mat, width);
  ribbon(g, `${name} upper edge`, fn, t => [t, .998], mat, width);
  ribbon(g, `${name} left edge`, fn, t => [.002, t], mat, width);
  ribbon(g, `${name} right edge`, fn, t => [.998, t], mat, width);
}

export function diamond(g: THREE.Group, name: string, fn: Surface, u: number, v: number, du: number, dv: number, mat: THREE.Material, width = .001) {
  const points: [number, number][] = [[u,v-dv],[u+du,v],[u,v+dv],[u-du,v],[u,v-dv]];
  for (let i = 0; i < 4; i++) { const a = points[i]!, b = points[i + 1]!;
    ribbon(g, `${name} ${i}`, fn, t => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], mat, width, 12);
  }
}

export function mirror(g: THREE.Group, local: THREE.Group, sign: number, prefix: string) {
  local.traverse(o => { if (!(o instanceof THREE.Mesh)) return;
    if (sign < 0) {
      o.geometry.scale(-1, 1, 1);
      const index = o.geometry.getIndex();
      if (index) for (let i = 0; i < index.count; i += 3) { const n = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, n); }
      o.geometry.computeVertexNormals();
    }
    o.name = `${prefix} ${sign > 0 ? 'left' : 'right'} ${o.name}`;
  }); g.add(local);
}
