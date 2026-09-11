import * as THREE from 'three';
import type { CoreArmorBuilder, CoreArmorOptions, FitSection } from './contracts';

type P = THREE.Vector3;
type Surface = (u: number, v: number) => P;
const TAU = Math.PI * 2;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/** Ray/polygon intersection preserves the supplied anatomical outline, including its offset. */
function radial(section: FitSection, angle: number): number {
  const dx = Math.sin(angle), dz = Math.cos(angle);
  let radius = 0;
  for (let i = 0; i < section.outline.length; i++) {
    const p = section.outline[i]!, q = section.outline[(i + 1) % section.outline.length]!;
    const x = p[0] - section.center[0], z = p[1] - section.center[1];
    const ex = q[0] - p[0], ez = q[1] - p[1], det = dx * ez - dz * ex;
    if (Math.abs(det) < 1e-10) continue;
    const r = (x * ez - z * ex) / det, t = (x * dz - z * dx) / det;
    if (r > radius && t >= -1e-6 && t <= 1.000001) radius = r;
  }
  return radius;
}

function fit(sections: readonly FitSection[], level: number, angle: number, clearance: number, axis: 'y' | 'x' = 'y'): P {
  let i = 0;
  while (i < sections.length - 2 && level > sections[i + 1]!.level) i++;
  const a = sections[i]!, b = sections[Math.min(i + 1, sections.length - 1)]!;
  const t = clamp((level - a.level) / Math.max(1e-8, b.level - a.level), 0, 1);
  const r = mix(radial(a, angle), radial(b, angle), t) + clearance;
  const x = mix(a.center[0], b.center[0], t) + Math.sin(angle) * r;
  const z = mix(a.center[1], b.center[1], t) + Math.cos(angle) * r;
  return axis === 'y' ? V(x, level, z) : V(level, x, z);
}

function add(g: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
  return mesh;
}

/** Both faces and all four boundary walls are real geometry, 5 mm apart.
 * UV distance is measured in metres. One texture repeat covers 25 cm everywhere. */
function leather(g: THREE.Group, name: string, fn: Surface, options: CoreArmorOptions, nu = 64, nv = 28,
  thickness = .005, outer = options.materials.shell, axis: 'y' | 'x' = 'y', panel?: (u: number, v: number) => boolean) {
  const points: P[] = [], normals: P[] = [], uvs: number[] = [], positions: number[] = [], indices: number[] = [];
  const stride = nu + 1, count = stride * (nv + 1), distances = new Float64Array(stride);
  for (let j = 0; j <= nv; j++) {
    let around = 0;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, p = fn(u, v);
      const du = fn(Math.min(1, u + .0001), v).sub(fn(Math.max(0, u - .0001), v));
      const dv = fn(u, Math.min(1, v + .0001)).sub(fn(u, Math.max(0, v - .0001)));
      const normal = du.cross(dv).normalize();
      // All lofts travel upward/outward and around clockwise from the front.
      if (axis === 'x') normal.negate();
      if (i) around += p.distanceTo(points[points.length - 1]!);
      if (j) distances[i] = distances[i]! + p.distanceTo(points[(j - 1) * stride + i]!);
      points.push(p); normals.push(normal); uvs.push(around * 4, distances[i]! * 4);
    }
  }
  for (let layer = 0; layer < 2; layer++) for (let k = 0; k < count; k++) {
    const p = points[k]!.clone().addScaledVector(normals[k]!, layer ? -thickness : 0);
    positions.push(p.x, p.y, p.z);
  }
  const geo = new THREE.BufferGeometry();
  for (let layer = 0; layer < 2; layer++) {
    const start = indices.length;
    const contrasting: number[] = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = layer * count + j * stride + i, b = a + stride;
      const target = layer === 0 && panel?.((i + .5) / nu, (j + .5) / nv) ? contrasting : indices;
      if ((axis === 'x') !== Boolean(layer)) target.push(a, b, a + 1, a + 1, b, b + 1);
      else target.push(a, a + 1, b, a + 1, b + 1, b);
    }
    geo.addGroup(start, indices.length - start, layer);
    if (contrasting.length) { const offset = indices.length; indices.push(...contrasting); geo.addGroup(offset, contrasting.length, 3); }
  }
  const start = indices.length;
  const wall = (a: number, b: number) => axis === 'x'
    ? indices.push(b, a, a + count, b + count, b, a + count)
    : indices.push(a, b, a + count, b, b + count, a + count);
  for (let i = 0; i < nu; i++) { wall(i + 1, i); wall(nv * stride + i, nv * stride + i + 1); }
  for (let j = 0; j < nv; j++) { wall(j * stride, (j + 1) * stride); wall((j + 1) * stride + nu, j * stride + nu); }
  geo.addGroup(start, indices.length - start, 2);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs, ...uvs], 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  return add(g, name, geo, [outer, options.materials.lining, options.materials.edge, options.materials.leather]);
}

function seam(g: THREE.Group, name: string, fn: (t: number) => P, options: CoreArmorOptions, stitched = false, radius = stitched ? .0011 : .0018) {
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 49 }, (_, i) => fn(i / 48)));
  const geometry = new THREE.TubeGeometry(curve, 48, radius, 5, false);
  // TubeGeometry's longitudinal UV is normalized; restore metric scale.
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * curve.getLength() * 4, uv.getY(i) * TAU * radius * 4);
  return add(g, name, geometry, stitched ? options.materials.thread : options.materials.edge);
}

function offsetSurface(fn: Surface, amount: number): Surface {
  return (u, v) => {
    const p = fn(u, v);
    const du = fn(Math.min(1, u + .0001), v).sub(fn(Math.max(0, u - .0001), v));
    const dv = fn(u, Math.min(1, v + .0001)).sub(fn(u, Math.max(0, v - .0001)));
    return p.addScaledVector(du.cross(dv).normalize(), amount);
  };
}

/** Visible hand-sewn dashes follow the garment rather than floating as a cord. */
function stitches(g: THREE.Group, name: string, fn: (t: number) => P, o: CoreArmorOptions) {
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 49 }, (_, i) => fn(i / 48)));
  const count = Math.max(2, Math.floor(curve.getLength() / .018));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k + .5) / count, point = curve.getPointAt(t), tangent = curve.getTangentAt(t);
    const side = V(-tangent.y, tangent.x, .12).normalize().multiplyScalar(.003);
    const direction = tangent.multiplyScalar(.0035);
    const a = point.clone().sub(direction).sub(side), b = point.clone().add(direction).add(side);
    const axis = b.clone().sub(a).normalize();
    const n = V(0, 0, 1).cross(axis).normalize();
    if (n.lengthSq() < .1) n.set(1, 0, 0);
    const q = axis.clone().cross(n).normalize();
    const base = pos.length / 3;
    for (const end of [a, b]) for (let j = 0; j < 4; j++) {
      const p = end.clone().addScaledVector(n, Math.cos(j * TAU / 4) * .0012).addScaledVector(q, Math.sin(j * TAU / 4) * .0012);
      pos.push(p.x, p.y, p.z); uv.push(j * .0012 * 4, k * .018 * 4);
    }
    for (let j = 0; j < 4; j++) {const a = base + j, b = base + (j + 1) % 4; idx.push(a, b, a + 4, b, b + 4, a + 4);}
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2, base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(idx); geometry.computeVertexNormals();
  return add(g, name, geometry, o.materials.thread);
}

function buckle(g: THREE.Group, name: string, center: P, options: CoreArmorOptions, bone = 'spine_01') {
  const path = new THREE.CatmullRomCurve3([V(-.014, -.009, 0), V(.014, -.009, 0), V(.014, .009, 0), V(-.014, .009, 0)], true, 'catmullrom', .05);
  const geo = new THREE.TubeGeometry(path, 24, .0016, 6, true); geo.translate(center.x, center.y, center.z);
  add(g, name, geo, options.materials.accent).userData.itemModelBone = bone;
}

function body(g: THREE.Group, o: CoreArmorOptions) {
  const torso = o.body.torso;
  const top = torso[torso.length - 1]!.level, waist = 1.015, bottom = .34;
  const coat: Surface = (u, v) => {
    const a = u * TAU, y = mix(bottom, top, v);
    if (y >= waist) {
      const p = fit(torso, y, a, .016);
      const folds = .0015 * Math.sin(a * 7 + y * 12) * Math.exp(-Math.pow((y - 1.09) / .10, 2));
      return p.add(V(Math.sin(a) * folds, 0, Math.cos(a) * folds));
    }
    const hip = fit(torso, waist, a, .016), k = (waist - y) / (waist - bottom);
    const flare = .085 * Math.pow(k, .9);
    const fold = .0032 * Math.sin(8 * a + k * 1.2) * k * k;
    return V(hip.x + Math.sin(a) * (flare + fold), y, hip.z + Math.cos(a) * (flare * .60 + fold));
  };
  // Separate the deformation domains at the waist. The shared coat function keeps
  // their fitted contours identical, with a 2 mm tucked overlap under the belt.
  const skirtTop = (1.022 - bottom) / (top - bottom);
  const bodiceBottom = (1.020 - bottom) / (top - bottom);
  const sideGore = (u: number) => (u >= .125 && u < .3125) || (u >= .6875 && u < .875);
  leather(g, 'Continuous modest flared robe skirt with darker side gores', (u, v) => coat(u, v * skirtTop), o, 64, 23, .005, o.materials.shell, 'y', sideGore)
    .userData.itemModelDeform = 'skirt';
  leather(g, 'Fitted robe bodice with shaped side panels', (u, v) => coat(u, mix(bodiceBottom, 1, v)), o, 64, 18, .005, o.materials.shell, 'y', sideGore);
  seam(g, 'Bound continuous robe hem', t => coat(t, 0), o).userData.itemModelDeform = 'skirt';
  const raisedCoat = offsetSurface(coat, .004);
  leather(g, 'Turned contrasting skirt hem facing', (u, v) => raisedCoat(u, v * .020), o, 64, 2, .004, o.materials.edge)
    .userData.itemModelDeform = 'skirt';
  for (const u of [.125, .3125, .6875, .875]) {
    stitches(g, 'Sewn skirt gore join', t => raisedCoat(u, t * skirtTop), o).userData.itemModelDeform = 'skirt';
    stitches(g, 'Sewn bodice side join', t => raisedCoat(u, mix(bodiceBottom, .93, t)), o);
  }
  // The underlying coat is fully closed. This thin front facing gives a real wrap edge.
  const lapel: Surface = (u, v) => {
    const y = mix(1.022, top - .012, v);
    const a = mix(.48, -.52, v) + (u - .5) * .50;
    const p = coat(((a / TAU) % 1 + 1) % 1, (y - bottom) / (top - bottom));
    return p.add(V(Math.sin(a) * .006, 0, Math.cos(a) * .006));
  };
  leather(g, 'Single overlapping tailored wrap lapel', lapel, o, 6, 24, .004, o.materials.leather);
  seam(g, 'Lapel bound opening', t => lapel(0, t), o);
  stitches(g, 'Visible lapel saddle stitch', t => offsetSurface(lapel, .002)(.12, t), o);
  const belt: Surface = (u, v) => {
    const a = u * TAU, p = coat(u, (mix(1.004, 1.032, v) - bottom) / (top - bottom));
    return p.add(V(Math.sin(a) * .007, 0, Math.cos(a) * .007));
  };
  leather(g, 'Narrow fitted waist belt', belt, o, 64, 3, .004, o.materials.leather)
    .userData.itemModelDeform = 'skirt';
  buckle(g, 'Small robe belt buckle', belt(.025, .5).add(V(0, 0, .004)), o, 'pelvis');
  for (const side of [-1, 1]) {
    const a = o.body.leftArm, low = a[0]!.level - .012, high = a[a.length - 1]!.level + .008;
    const sleeve: Surface = (u, v) => {
      const x = mix(low, high, v), angle = u * TAU;
      const ease = .013 + .0014 * Math.sin(v * 24 + angle * 2) * Math.exp(-Math.pow((v - .58) / .17, 2));
      const p = fit(a, x, angle, ease, 'x'); p.x *= side; return p;
    };
    // Mirroring changes winding. Author positive then mirror its baked geometry.
    const local = new THREE.Group();
    const positive: Surface = (u, v) => { const p = sleeve(u, v); p.x *= side; return p; };
    leather(local, 'Fitted sleeve', positive, o, 40, 20, .005, o.materials.shell, 'x');
    const sleeveFacing = (u: number, v: number) => {
      const p = positive(u, v), a = u * TAU;
      return p.add(V(0, Math.sin(a) * .004, Math.cos(a) * .004));
    };
    leather(local, 'Fitted contrasting shoulder yoke', (u, v) => sleeveFacing(u, mix(.04, .19, v)), o, 32, 3, .004, o.materials.leather, 'x');
    stitches(local, 'Visible shoulder joining stitches', t => sleeveFacing(t, .19), o);
    leather(local, 'Turned cuff facing', (u, v) => sleeveFacing(u, mix(.94, 1, v)), o, 32, 2, .004, o.materials.edge, 'x');
    seam(local, 'Narrow sleeve cuff binding', t => positive(t, 1), o);
    if (o.detail > 0) seam(local, 'Cuff fine topstitch', t => positive(t, .98), o, true);
    mirrorInto(g, local, side, 'Robe');
  }
  if (o.detail > 0) seam(g, 'Lapel fine topstitch', t => lapel(.12, t), o, true);
  if (o.detail > 1) seam(g, 'Hem fine topstitch', t => coat(t, .012), o, true).userData.itemModelDeform = 'skirt';
}

function mirrorInto(g: THREE.Group, local: THREE.Group, side: number, prefix: string) {
  for (const object of [...local.children]) {
    const mesh = object as THREE.Mesh;
    if (side < 0) {
      mesh.geometry.scale(-1, 1, 1);
      const index = mesh.geometry.getIndex()!;
      for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i + 1)); index.setX(i + 1, a); }
      mesh.geometry.computeVertexNormals();
    }
    mesh.name = `${prefix} ${side > 0 ? 'left' : 'right'} ${mesh.name}`; g.add(mesh);
  }
}

function hood(g: THREE.Group, o: CoreArmorOptions) {
  // The two lowest horizontal head measurements still intersect the trapezius.
  const h = o.body.head.filter(section => section.level >= 1.56), max = h[h.length - 1]!.level;
  const bottom = 1.515, top = max + .021;
  const hoodSurface: Surface = (u, v) => {
    const y = mix(bottom, top, v);
    const opening = mix(.52, .87, smooth(0, .25, v)) * (1 - smooth(.68, .89, v));
    const angle = opening + u * (TAU - 2 * opening);
    const p = fit(h, Math.min(y, max), angle, .021);
    p.y = y;
    if (y > max - .018) {
      const taper = 1 - smooth(max - .018, top, y);
      const c = h[h.length - 1]!.center;
      p.x = mix(c[0], p.x, taper); p.z = mix(c[1], p.z, taper);
    }
    return p;
  };
  leather(g, 'Close shaped hood with open face and closed crown', hoodSurface, o, 48, 26, .006);
  const raised = offsetSurface(hoodSurface, .004);
  for (const side of [0, 1]) {
    const facing: Surface = (u, v) => raised(side === 0 ? u * .065 : .935 + u * .065, v * .89);
    leather(g, 'Broad contrasting turned hood face rim', facing, o, 5, 24, .004, o.materials.edge);
    seam(g, 'Soft pale nap at hood opening', t => raised(side, t * .89), o, true, .003);
    stitches(g, 'Hood rim hand stitching', t => raised(side === 0 ? .052 : .948, t * .87), o);
  }
  leather(g, 'Narrow turned nape collar', (u, v) => raised(u, v * .06), o, 40, 2, .004, o.materials.edge);
  seam(g, 'Short pale hide nap at collar edge', t => raised(t, 0), o, true, .0035);
  if (o.detail > 0) seam(g, 'Hood crown center seam', t => hoodSurface(.5, t), o, true);
}

function legs(g: THREE.Group, o: CoreArmorOptions) {
  const pelvis: Surface = (u, v) => fit(o.body.torso, mix(.91, 1.045, v), u * TAU, .013);
  leather(g, 'Continuous leather waist and seat', pelvis, o, 48, 10);
  seam(g, 'Trouser waistband', t => pelvis(t, 1), o);
  for (const side of [-1, 1]) {
    const local = new THREE.Group();
    const fn: Surface = (u, v) => {
      const y = mix(.105, .953, v), a = u * TAU;
      const ease = .012 + .0015 * Math.sin(y * 49 + a * 2) * Math.exp(-Math.pow((y - .53) / .08, 2));
      return fit(o.body.leftLeg, y, a, ease);
    };
    leather(local, 'Fitted continuous leather trouser leg', fn, o, 40, 22);
    seam(local, 'Outer felled trouser seam', t => fn(.25, t), o, o.detail > 0);
    seam(local, 'Trouser ankle binding', t => fn(t, 0), o);
    mirrorInto(g, local, side, 'Leggings');
  }
}

function feet(g: THREE.Group, o: CoreArmorOptions) {
  for (const side of [-1, 1]) {
    const local = new THREE.Group(), foot = o.body.leftFoot;
    const low = Math.max(.006, foot[0]!.level - .004);
    const fn: Surface = (u, v) => {
      const y = mix(low, .265, v), a = u * TAU;
      return fit(y <= foot[foot.length - 1]!.level ? foot : o.body.leftLeg, y, a, .012);
    };
    leather(local, 'Close leather boot vamp and ankle', fn, o, 48, 18, .006);
    const sole: Surface = (u, v) => {
      const p = fn(u, 0), center = foot[0]!.center;
      return V(mix(center[0], p.x, v), low - .004, mix(center[1], p.z, v));
    };
    leather(local, 'Closed thin leather sole', sole, o, 48, 2, .006, o.materials.leather);
    seam(local, 'Boot sole welt', t => fn(t, .018), o);
    seam(local, 'Boot narrow cuff binding', t => fn(t, 1), o);
    if (o.detail > 0) seam(local, 'Boot back quarter stitching', t => fn(.5, t), o, true);
    mirrorInto(g, local, side, 'Boot');
  }
}

function hands(g: THREE.Group, o: CoreArmorOptions) {
  for (const side of [-1, 1]) {
    const local = new THREE.Group(), hand = o.body.leftHand, arm = o.body.leftArm;
    const wrist = hand[0]!.level, end = Math.min(hand[hand.length - 1]!.level, .77);
    const fn: Surface = (u, v) => {
      const x = mix(wrist - .07, end, v), a = u * TAU;
      return fit(x < wrist ? arm : hand, x, a, .009, 'x');
    };
    leather(local, 'Thin fingerless wrist and palm wrap', fn, o, 32, 12, .004, o.materials.shell, 'x');
    seam(local, 'Bound wrist opening', t => fn(t, 0), o);
    seam(local, 'Bound knuckle opening', t => fn(t, 1), o);
    // A shallow diagonal stitched overlap reads as wrapped hide without inflated rings.
    seam(local, 'Diagonal palm overlap seam', t => fn(t, .24 + t * .37), o, o.detail > 0);
    mirrorInto(g, local, side, 'Wrap');
  }
}

export const buildHideArmor: CoreArmorBuilder = (slot, options) => {
  const group = new THREE.Group(); group.name = `Core tailored hide ${slot}`;
  ({ head: hood, body, legs, feet, hands })[slot](group, options);
  return group;
};
