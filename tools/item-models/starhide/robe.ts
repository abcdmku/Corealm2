import * as THREE from 'three';
import { bodyProfile } from '../core/profile.js';
import type { StarhideMaterials } from './contracts.js';

type Surface = (u: number, v: number) => THREE.Vector3;
type UV = [number, number];
const TAU = Math.PI * 2;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp;
const clamp = (x: number) => THREE.MathUtils.clamp(x, 0, 1);

/** The source figure has a narrow waist and an asymmetric chest section. Keep that
 * anatomy rather than fitting the garment to a cylinder. */
function bodyPoint(y: number, angle: number, ease = .010): THREE.Vector3 {
  const sections = bodyProfile.torso;
  let i = 0;
  while (i < sections.length - 2 && y > sections[i + 1]!.level) i++;
  const a = sections[i]!, b = sections[i + 1]!;
  const t = clamp((y - a.level) / (b.level - a.level));
  const radial = (section: typeof a) => {
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let r = 0;
    for (let k = 0; k < section.outline.length; k++) {
      const p = section.outline[k]!, q = section.outline[(k + 1) % section.outline.length]!;
      const x = p[0] - section.center[0], z = p[1] - section.center[1];
      const ex = q[0] - p[0], ez = q[1] - p[1], det = dx * ez - dz * ex;
      if (Math.abs(det) < 1e-9) continue;
      const radius = (x * ez - z * ex) / det, f = (x * dz - z * dx) / det;
      if (radius > r && f >= -1e-5 && f <= 1.00001) r = radius;
    }
    return r;
  };
  const radius = mix(radial(a), radial(b), t) + ease;
  return V(mix(a.center[0], b.center[0], t) + Math.sin(angle) * radius, y,
    mix(a.center[1], b.center[1], t) + Math.cos(angle) * radius);
}

function normalAt(f: Surface, u: number, v: number): THREE.Vector3 {
  const du = f(Math.min(1, u + .0002), v).sub(f(Math.max(0, u - .0002), v));
  const dv = f(u, Math.min(1, v + .0002)).sub(f(u, Math.max(0, v - .0002)));
  const n = du.cross(dv);
  // Finite differences are only 0.0004 of the patch size. A millimetre-wide
  // ribbon therefore legitimately has a cross-product squared near 1e-22.
  return n.lengthSq() > 1e-28 ? n.normalize() : V(0, 0, 1);
}

/** Thin sewn cloth and engraved silver have closed boundary walls. Distances in
 * UV space are metric so the textile/scales have the same size across panels. */
function shell(g: THREE.Group, name: string, f: Surface, outer: THREE.Material,
  inside: THREE.Material, nu = 28, nv = 28, thickness = .003,
  domain?: 'skirt' | string): THREE.Mesh {
  const stride = nu + 1, count = stride * (nv + 1);
  const points: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  const length = new Float64Array(stride);
  for (let j = 0; j <= nv; j++) {
    let around = 0;
    for (let i = 0; i <= nu; i++) {
      const p = f(i / nu, j / nv);
      if (i) around += p.distanceTo(points[points.length - 1]!);
      if (j) length[i] = length[i]! + p.distanceTo(points[(j - 1) * stride + i]!);
      points.push(p); normals.push(normalAt(f, i / nu, j / nv));
      uv.push(around * 4, length[i]! * 4);
    }
  }
  for (let s = 0; s < 2; s++) for (let k = 0; k < count; k++) {
    const p = points[k]!.clone().addScaledVector(normals[k]!, s ? -thickness : 0);
    pos.push(p.x, p.y, p.z);
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
  // Boundary walls must not round the thin fabric's large faces.
  const attr = geo.getAttribute('normal');
  for (let s = 0; s < 2; s++) for (let k = 0; k < count; k++) {
    const n = normals[k]!; attr.setXYZ(s * count + k, n.x * (s ? -1 : 1), n.y * (s ? -1 : 1), n.z * (s ? -1 : 1));
  }
  const mesh = new THREE.Mesh(geo, [outer, inside]); mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  if (domain === 'skirt') mesh.userData.itemModelDeform = 'skirt';
  else if (domain) mesh.userData.itemModelBone = domain;
  g.add(mesh); return mesh;
}

function offset(f: Surface, distance: number): Surface {
  return (u, v) => f(u, v).addScaledVector(normalAt(f, u, v), distance);
}

/** Flat silver strips, never inflated tube piping. Their narrow bevel has a real
 * 1.3 mm back face and follows the same skin domain as the supporting textile. */
function ribbon(g: THREE.Group, name: string, f: Surface, path: UV[], width: number,
  material: THREE.Material, domain?: string, curved = true) {
  const primary = material.name.includes('polished silver') && width >= .003;
  if (primary) width *= 1.42;
  const points = path.map(([u, v]) => V(u, v, 0));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const location = (t: number): UV => {
    if (curved && path.length > 2) { const q = curve.getPoint(clamp(t)); return [clamp(q.x), clamp(q.y)]; }
    const k = Math.min(path.length - 2, Math.floor(clamp(t) * (path.length - 1)));
    const a = path[k]!, b = path[k + 1]!, alpha = clamp(t) * (path.length - 1) - k;
    return [mix(a[0], b[0], alpha), mix(a[1], b[1], alpha)];
  };
  const strip: Surface = (u, v) => {
    const [a, b] = location(v), n = normalAt(f, a, b), p = f(a, b);
    const [a0, b0] = location(v - .0005), [a1, b1] = location(v + .0005);
    const tangent = f(a1, b1).sub(f(a0, b0)).normalize();
    const across = tangent.cross(n).normalize();
    return p.addScaledVector(across, (u - .5) * width)
      .addScaledVector(n, .0017 + (primary ? .001 : .00065) * Math.sin(u * Math.PI));
  };
  return shell(g, name, strip, material, material, 2, Math.max(12, path.length * 5), .0013, domain);
}

function frame(g: THREE.Group, name: string, f: Surface, m: StarhideMaterials, width = .0047, domain?: string) {
  ribbon(g, `${name} left silver binding`, f, [[0, 0], [0, 1]], width, m.silver, domain);
  ribbon(g, `${name} right silver binding`, f, [[1, 0], [1, 1]], width, m.silver, domain);
  ribbon(g, `${name} pointed hem binding`, f, [[0, 0], [.5, 0], [1, 0]], width, m.silver, domain, false);
}

function diamond(g: THREE.Group, name: string, f: Surface, u: number, v: number,
  du: number, dv: number, m: StarhideMaterials, domain?: string, jewel = false) {
  ribbon(g, `${name} engraved diamond`, f, [[u, v + dv], [u + du, v], [u, v - dv], [u - du, v], [u, v + dv]],
    jewel ? .0038 : .0011, m.silver, domain, false);
  if (jewel) {
    const p = f(u, v).addScaledVector(normalAt(f, u, v), .004);
    const stone = new THREE.Mesh(new THREE.OctahedronGeometry(.018, 0), m.gem);
    stone.name = `${name} cut blue starstone`; stone.scale.set(.48, 1.42, .22); stone.position.copy(p);
    if (domain === 'skirt') stone.userData.itemModelDeform = 'skirt'; else if (domain) stone.userData.itemModelBone = domain;
    g.add(stone);
  }
}

function filigree(g: THREE.Group, name: string, f: Surface, m: StarhideMaterials,
  domain?: string, front = true) {
  // The image's ornament consists of long leaf stems and open diamond stars.
  // Keep the 1 mm lines light, with navy cloth showing between them.
  for (const side of [-1, 1]) {
    const s = (u: number) => .5 + side * u;
    ribbon(g, `${name} leaf stem ${side}`, f,
      [[s(0), .06], [s(.03), .14], [s(.10), .23], [s(.22), .31], [s(.27), .45]], .00115, m.silver, domain);
    ribbon(g, `${name} inner branch ${side}`, f,
      [[s(.015), .11], [s(.08), .18], [s(.20), .20], [s(.27), .30]], .00095, m.silver, domain);
    ribbon(g, `${name} leaf return ${side}`, f,
      [[s(.03), .15], [s(.05), .25], [s(.17), .34], [s(.27), .45]], .0009, m.silver, domain);
  }
  diamond(g, `${name} lower star`, f, .5, .10, .065, .055, m, domain);
  diamond(g, `${name} central star`, f, .5, .34, .12, .080, m, domain);
  if (front) diamond(g, `${name} high star`, f, .5, .56, .058, .05, m, domain);
}

function torso(g: THREE.Group, m: StarhideMaterials) {
  // The side opening drops to the armpit while front and back continue to the
  // throat. Arms remain exposed exactly as in the sleeveless item reference.
  const bodice: Surface = (u, v) => bodyPoint(mix(1.025, 1.332, v), u * TAU, .012);
  shell(g, 'Fitted midnight cloth lower bodice', bodice, m.cloth, m.lining, 64, 25);
  const upper: Surface = (u, v) => {
    const a = u * TAU, top = 1.490 - .092 * Math.pow(Math.abs(Math.sin(a)), 6);
    const y = mix(1.326, top, v), p = bodyPoint(y, a, .014);
    // High native profile rings include the deltoid. Keep the sleeveless edge
    // at the actual shoulder joint rather than spreading onto the upper arm.
    p.x = THREE.MathUtils.clamp(p.x, -.207, .207);
    return p;
  };
  shell(g, 'Closed upper back and sleeveless shoulder yoke', upper, m.cloth, m.lining, 64, 18, .003, 'spine_03');
  ribbon(g, 'Bound sleeveless opening', upper, [[0, 1], [.25, 1], [.5, 1], [.75, 1], [1, 1]], .007, m.silver, 'spine_03', false);

  // Y coordinates use the measured body profile directly. The scaled panels
  // follow the reference's sinuous teardrops narrowing into the waist.
  for (const side of [-1, 1]) {
    const chest: Surface = (u, v) => {
      const y = mix(1.082, 1.405, v), center = .235 + .62 * v - .14 * Math.sin(v * Math.PI);
      const half = .028 + .29 * Math.sin(Math.PI * v * .88);
      const a = side * (center + (u - .5) * half * 2);
      return bodyPoint(y, a, .016);
    };
    const oriented: Surface = (u, v) => chest(side > 0 ? u : 1 - u, v);
    shell(g, `Iridescent curved chest scale inset ${side}`, oriented, m.scales, m.lining, 14, 28, .0025);
    frame(g, `Chest inset ${side}`, oriented, m, .0082);
    const lapel: Surface = (u, v) => {
      const y = mix(1.079, 1.468, v), a = side * (.024 + .44 * v + (u - .5) * (.028 + .10 * v));
      return bodyPoint(y, a, .021);
    };
    const front: Surface = (u, v) => lapel(side > 0 ? u : 1 - u, v);
    shell(g, `Long slender folded V lapel ${side}`, front, m.cloth, m.lining, 6, 34, .003);
    frame(g, `V lapel ${side}`, front, m, .0065);
    const seam: Surface = (u, v) => bodyPoint(mix(1.064, 1.34, v), side * (.94 + .18 * v + (u - .5) * .18), .013);
    const seamFace: Surface = (u, v) => seam(side > 0 ? u : 1 - u, v);
    ribbon(g, `Curved tailored side seam ${side}`, seamFace, [[.5, 0], [.36, .36], [.65, .69], [.5, 1]], .0012, m.thread);
    const backInset: Surface = (u, v) => bodyPoint(mix(1.09, 1.42, v), Math.PI + side * (.22 + .37 * v + (u - .5) * (.055 + .33 * Math.sin(v * Math.PI))), .015);
    const back: Surface = (u, v) => backInset(side > 0 ? u : 1 - u, v);
    shell(g, `Back tapered scale inset ${side}`, back, m.scales, m.lining, 10, 25, .0025);
    frame(g, `Back scale inset ${side}`, back, m, .0064);
  }
  const collar: Surface = (u, v) => {
    const a = .40 + u * (TAU - .80), bottom = 1.449 + .011 * Math.cos(a);
    const y = mix(bottom, 1.582 - .025 * Math.cos(a), v);
    const rx = mix(.093, .086, v), rz = mix(.092, .101, v);
    return V(Math.sin(a) * rx, y, -.046 + Math.cos(a) * rz);
  };
  shell(g, 'Tall split standing collar with dark interior', collar, m.cloth, m.lining, 48, 12, .0035, 'spine_03');
  frame(g, 'Standing collar', collar, m, .0070, 'spine_03');
  ribbon(g, 'Standing collar top silver rim', collar, [[0, 1], [.25, 1], [.5, 1], [.75, 1], [1, 1]], .0074, m.silver, 'spine_03', false);
  for (const u of [.10, .90]) diamond(g, 'Collar engraved star', collar, u, .58, .045, .21, m, 'spine_03');
}

function shoulders(g: THREE.Group, m: StarhideMaterials) {
  for (const side of [-1, 1]) {
    const crestCurve = (rear: boolean) => new THREE.CatmullRomCurve3([
      V(side * .098, 1.468, rear ? -.118 : .032),
      V(side * .148, 1.499, rear ? -.159 : .071),
      V(side * .228, 1.526, rear ? -.170 : .029),
      V(side * .299, 1.565, rear ? -.136 : -.021),
    ]);
    const frontCrest = crestCurve(false), rearCrest = crestCurve(true);
    const saddle: Surface = (u, v) => {
      const t = .002 + .995 * v, p = frontCrest.getPoint(t).lerp(rearCrest.getPoint(t), u);
      // A continuous curved shoulder saddle joins the front and rear leaves.
      // The shallow inward scallop preserves their two swept outer tips.
      p.x -= side * .052 * Math.sin(u * Math.PI) * Math.pow(v, 3);
      p.y += .013 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) - .025 * Math.sin(u * Math.PI) * v * v;
      return p;
    };
    const saddleFlip = normalAt(saddle, .5, .5).y < 0;
    const roof: Surface = (u, v) => saddle(saddleFlip ? 1 - u : u, v);
    shell(g, `Connected curved shoulder saddle ${side}`, roof, m.cloth, m.cloth, 18, 24, .0035, 'spine_03');
    const roofScales: Surface = (u, v) => offset(roof, .003)(.13 + .74 * u, .22 + .70 * v);
    shell(g, `Shoulder saddle scale inlay ${side}`, roofScales, m.scales, m.lining, 14, 16, .002, 'spine_03');
    ribbon(g, `Shoulder saddle swept silver lip ${side}`, roof, [[0, 1], [.25, 1], [.5, 1], [.75, 1], [1, 1]], .0082, m.silver, 'spine_03', false);
    ribbon(g, `Shoulder saddle inner collar join ${side}`, roof, [[0, 0], [.5, 0], [1, 0]], .006, m.silver, 'spine_03', false);
    // Narrow rising leaves extend across the shoulder. Each front/rear shell
    // has a tapered outer point, open space beneath it and no spherical padding.
    for (const rear of [false, true]) {
      const left = crestCurve(rear);
      const right = new THREE.CatmullRomCurve3([V(side * .185, 1.405, rear ? -.153 : .066), V(side * .221, 1.450, rear ? -.167 : .043), V(side * .259, 1.499, rear ? -.163 : .008), V(side * .298, 1.564, rear ? -.136 : -.021)]);
      const leaf: Surface = (u, v) => {
        const t = .002 + .995 * v;
        const a = left.getPoint(t), b = right.getPoint(t);
        const q = a.lerp(b, u);
        q.y += .006 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
        return q;
      };
      // Choose winding from actual surface orientation. Front faces look +Z,
      // rear faces look -Z; both keep their filigree on the exposed face.
      const n = normalAt(leaf, .5, .4);
      const flip = n.z * (rear ? -1 : 1) < 0;
      const f: Surface = (u, v) => leaf(flip ? 1 - u : u, v);
      const bone = 'spine_03';
      shell(g, `${rear ? 'Rear' : 'Front'} swept pointed shoulder petal ${side}`, f, m.cloth, m.cloth, 14, 24, .0035, bone);
      frame(g, `Shoulder petal ${side} ${rear}`, f, m, .0076, bone);
      const inset: Surface = (u, v) => offset(f, .003)(.18 + .63 * u, .15 + .80 * v);
      shell(g, `Shoulder petal scale flash ${side} ${rear}`, inset, m.scales, m.lining, 8, 16, .002, bone);
      ribbon(g, `Shoulder diagonal silver vane ${side} ${rear}`, f, [[.04, .09], [.46, .25], [.68, .49], [.5, .97]], .0035, m.silver, bone);
      diamond(g, `Shoulder ${side} ${rear} star`, f, .48, .35, .17, .13, m, bone);
      ribbon(g, `Shoulder curling engraving ${side} ${rear}`, f, [[.35, .18], [.23, .31], [.33, .49], [.50, .59], [.58, .82]], .0012, m.silver, bone);
    }
  }
}

function coatPoint(y: number, angle: number, lift = 0): THREE.Vector3 {
  const t = clamp((1.052 - y) / .74), waist = bodyPoint(1.052, angle, .014);
  // Long slim tails follow the legs. The front opening and pointed edges supply
  // movement without a wide cone of cloth around the feet.
  const xRadius = .171 + .070 * Math.pow(t, .72);
  const zRadius = .134 + .030 * t;
  const centerZ = -.022 - .017 * t;
  const anatomy = Math.pow(1 - t, 5);
  const pleat = .0026 * Math.sin(angle * 9 + .8 * t) * Math.sin(t * Math.PI);
  // The worn leggings have short articulated hip tabs. Keep a small local
  // movement allowance over the upper thighs; a straight waist-to-hem loft
  // otherwise touched their front corners despite looking clean unworn.
  const hipEase = .014 * Math.exp(-Math.pow((y - .84) / .115, 2)) * Math.pow(Math.abs(Math.sin(angle)), 1.5);
  const kneeEase = .014 * Math.exp(-Math.pow((y - .57) / .12, 2)) * Math.pow(Math.max(0, Math.cos(angle)), 3);
  const x = Math.sin(angle) * (xRadius + lift + pleat + hipEase), z = centerZ + Math.cos(angle) * (zRadius + lift + pleat + hipEase + kneeEase);
  return V(mix(x, waist.x + Math.sin(angle) * lift, anatomy), y, mix(z, waist.z + Math.cos(angle) * lift, anatomy));
}

function tails(g: THREE.Group, m: StarhideMaterials) {
  const centers = [.43, 1.12, 1.87, 2.67, 3.61, 4.41, 5.16, 5.85];
  for (let k = 0; k < centers.length; k++) {
    const center = centers[k]!, front = k === 0 || k === 7;
    const side = k === 1 || k === 6;
    const half = front ? .375 : .405;
    const lower = front ? .34 : side ? .42 : .365;
    const panel: Surface = (u, v) => {
      const angle = center + (u - .5) * half * 2 + .158 * Math.sin(v * Math.PI) * Math.sin(center);
      const bottom = lower + .147 * Math.pow(Math.abs(2 * u - 1), .9);
      const y = mix(bottom, 1.058, v);
      return coatPoint(y, angle, front ? .008 : .002 + (k % 2) * .004);
    };
    shell(g, `Long split pointed ${front ? 'front' : side ? 'side' : 'rear'} coat tail ${k}`, panel, m.cloth, m.lining, 16, 32, .003, 'skirt');
    frame(g, `Coat tail ${k}`, panel, m, .0072, 'skirt');
    const stitched = offset(panel, .0022);
    ribbon(g, `Tail ${k} fine inner seam`, stitched, [[.075, .025], [.075, .4], [.075, 1]], .0008, m.thread, 'skirt');
    ribbon(g, `Tail ${k} fine outer seam`, stitched, [[.925, .025], [.925, .4], [.925, 1]], .0008, m.thread, 'skirt');
    if (front || k === 3 || k === 4) filigree(g, `Tail ${k} branching star embroidery`, offset(panel, .0025), m, 'skirt', front);
    if (k === 2 || k === 5) {
      // Sweeping overlapping leaf inset, broad near the hip and ending in a
      // sharp lower point, as the scale-faced outer panels in the PNG.
      const scale: Surface = (u, v) => {
        const width = .045 + .78 * Math.sin(Math.PI * (.10 + .84 * v));
        const localU = .49 + (u - .5) * width + .07 * Math.sin(v * Math.PI);
        return offset(panel, .0045)(localU, .025 + v * .955);
      };
      const scaleMesh = shell(g, `Overlapping pointed scale tail inset ${k}`, scale, m.scales, m.lining, 12, 28, .0025, 'skirt');
      const tex = scaleMesh.geometry.getAttribute('uv');
      for (let i = 0; i < tex.count; i++) tex.setY(i, tex.getY(i) * .70);
      frame(g, `Scale tail ${k}`, scale, m, .0070, 'skirt');
      const overleaf: Surface = (u, v) => {
        const localV = .29 + .38 * v + .085 * (u - .5);
        return offset(panel, .010)(.05 + .90 * u, localV);
      };
      ribbon(g, `Swept overlapping scale-tail silver leaf ${k}`, overleaf, [[.02, .96], [.2, .60], [.62, .37], [.99, .05]], .0074, m.silver, 'skirt');
    }
  }
  // Two broad curved leaves overlap down each front flank. Their actual curved
  // boundaries, rather than a line across a straight strip, make the stepped
  // scale-panel construction visible from front and side during movement.
  for (const side of [-1, 1]) for (const layer of [0, 1]) {
    const leaf: Surface = (u, v) => {
      const y = mix(layer ? .635 : .397, layer ? 1.052 : .896, v);
      const center = mix(layer ? .66 : .61, layer ? 1.12 : 1.22, v) + .075 * Math.sin(v * Math.PI);
      const width = .010 + (layer ? .79 : .76) * Math.pow(Math.sin(v * Math.PI * .91), .88);
      const angle = side * (center + (u - .5) * width);
      return coatPoint(y, angle, layer ? .023 : .016);
    };
    const f: Surface = (u, v) => leaf(side > 0 ? u : 1 - u, v);
    const scaleMesh = shell(g, `Curved overlapping ${layer ? 'upper' : 'lower'} scale leaf ${side}`, f, m.scales, m.lining, 18, 28, .0028, 'skirt');
    const tex = scaleMesh.geometry.getAttribute('uv');
    for (let i = 0; i < tex.count; i++) tex.setY(i, tex.getY(i) * .72);
    frame(g, `Broad scale leaf ${side} ${layer}`, f, m, .0078, 'skirt');
    ribbon(g, `Scale leaf ${side} ${layer} waist binding`, f, [[0, 1], [.5, 1], [1, 1]], .0062, m.silver, 'skirt', false);
    diamond(g, `Scale leaf ${side} ${layer} silver tip`, offset(f, .0015), .5, .075, .18, .057, m, 'skirt');
  }
  // Two short angled scale leaves articulate the hip without a thick overskirt.
  for (const side of [-1, 1]) {
    const hip: Surface = (u, v) => {
      const a = side * (.87 + (u - .5) * .70);
      const y = mix(.90 + .09 * Math.abs(2 * u - 1), 1.055, v);
      return coatPoint(y, a, .014);
    };
    const f: Surface = (u, v) => hip(side > 0 ? u : 1 - u, v);
    shell(g, `Short pointed scale hip leaf ${side}`, f, m.scales, m.lining, 16, 12, .0028, 'skirt');
    frame(g, `Hip leaf ${side}`, f, m, .0075, 'skirt');
  }
}

function waist(g: THREE.Group, m: StarhideMaterials) {
  const sash: Surface = (u, v) => {
    const a = u * TAU;
    // Belt dips to the central diamond then rises over either hip.
    const y = 1.064 + .027 * Math.abs(Math.sin(a)) - .029 * Math.pow(Math.max(0, Math.cos(a)), 10) + (v - .5) * .036;
    return bodyPoint(y, a, .021);
  };
  shell(g, 'Narrow angular fitted waist sash', sash, m.cloth, m.lining, 64, 4, .003, 'skirt');
  for (const v of [0, 1]) ribbon(g, `Waist sash fine silver edge ${v}`, sash, [[0, v], [.25, v], [.5, v], [.75, v], [1, v]], .0068, m.silver, 'skirt', false);
  const clasp: Surface = (u, v) => V((u - .5) * .061, 1.040 + (v - .5) * .147, .132 + .002 * Math.sin(v * Math.PI));
  diamond(g, 'Elongated central waist starstone clasp', clasp, .5, .57, .43, .34, m, 'skirt', true);
  diamond(g, 'Lower pointed waist pendant', clasp, .5, .13, .23, .12, m, 'skirt');
}

export function buildRobe(m: StarhideMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = 'Starhide reference sleeveless robe';
  torso(g, m); shoulders(g, m); tails(g, m); waist(g, m);
  return g;
}
