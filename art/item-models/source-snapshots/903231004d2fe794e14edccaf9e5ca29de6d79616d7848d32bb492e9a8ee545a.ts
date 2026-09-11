import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts.js';

type V = [number, number, number];
type Surface = (u: number, v: number) => THREE.Vector3;
const ids = ['starhide_hood', 'starhide_robe', 'starhide_leggings', 'starhide_boots', 'starhide_wraps'] as const;
const vec = (p: V) => new THREE.Vector3(...p);
const TAU = Math.PI * 2;

function materials() {
  const n = 256, data = new Uint8Array(n * n * 4), rough = new Uint8Array(n * n * 4);
  let seed = 17321;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = (y * n + x) * 4;
    const grain = rnd() * 14 + 3 * Math.sin(x * 1.7 + Math.sin(y * .7));
    data[k] = 24 + grain; data[k + 1] = 24 + grain; data[k + 2] = 43 + grain * 1.3; data[k + 3] = 255;
    rough[k] = rough[k + 1] = rough[k + 2] = 130 + rnd() * 38; rough[k + 3] = 255;
  }
  // Sparse pinpricks and four-point stars are pigment in the leather, not emissive lights.
  for (let s = 0; s < 95; s++) {
    const x = Math.floor(rnd() * n), y = Math.floor(rnd() * n), arm = s % 11 === 0 ? 3 : 0;
    for (let d = -arm; d <= arm; d++) for (let axis = 0; axis < 2; axis++) {
      const k = ((((y + (axis ? d : 0) + n) % n) * n) + (x + (axis ? 0 : d) + n) % n) * 4;
      const fade = 1 - Math.abs(d) / (arm + 1);
      data[k] = 60 + 105 * fade; data[k + 1] = 65 + 105 * fade; data[k + 2] = 110 + 100 * fade;
    }
  }
  const tex = new THREE.DataTexture(data, n, n); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
  const rt = new THREE.DataTexture(rough, n, n); rt.wrapS = rt.wrapT = THREE.RepeatWrapping; rt.needsUpdate = true;
  const leather = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughnessMap: rt, roughness: .92, metalness: .08 }); leather.name = 'Star-speckled indigo leather';
  const lining = new THREE.MeshStandardMaterial({ color: 0x21132e, roughness: .87 }); lining.name = 'Deep violet lining';
  const silver = new THREE.MeshStandardMaterial({ color: 0xbeb8ad, roughness: .38, metalness: .8 }); silver.name = 'Worn silver piping and fasteners';
  const thread = new THREE.MeshStandardMaterial({ color: 0x78608d, roughness: .75 }); thread.name = 'Violet saddle stitching';
  const sole = new THREE.MeshStandardMaterial({ color: 0x242020, roughness: .91 }); sole.name = 'Layered charcoal leather soles';
  return { leather, lining, silver, thread, sole };
}
type Mats = ReturnType<typeof materials>;

function mesh(g: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) {
  const m = new THREE.Mesh(geo, mat); m.name = name; g.add(m); return m;
}
function cord(g: THREE.Group, name: string, points: THREE.Vector3[], radius: number, mat: THREE.Material) {
  return mesh(g, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(8, points.length), radius, 5, false), mat);
}
function line(g: THREE.Group, name: string, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const d = b.clone().sub(a); const item = mesh(g, name, new THREE.CylinderGeometry(r, r, d.length(), 4, 1, true), mat);
  item.position.copy(a).add(b).multiplyScalar(.5); item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return item;
}

/** Closed thickness across all boundaries, with separately shaded inside faces. */
function shell(g: THREE.Group, name: string, f: Surface, m: Mats, nu = 48, nv = 18, thick = .004, hole?: (u: number, v: number) => boolean) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  const center = new THREE.Vector3();
  for (let j = 0; j <= 8; j++) for (let i = 0; i < 16; i++) center.add(f(i / 16, j / 8));
  center.divideScalar(144);
  let facing = 0;
  for (let j = 1; j < 8; j++) for (let i = 1; i < 16; i++) {
    const u = i / 16, v = j / 8, q = f(u, v);
    const du = f(u + .001, v).sub(f(u - .001, v)); const dv = f(u, v + .001).sub(f(u, v - .001));
    facing += du.cross(dv).dot(q.sub(center));
  }
  const reverse = facing < 0;
  for (let side = 0; side < 2; side++) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, q = f(u, v);
    const du = f(Math.min(1, u + .0001), v).sub(f(Math.max(0, u - .0001), v));
    const dv = f(u, Math.min(1, v + .0001)).sub(f(u, Math.max(0, v - .0001)));
    const normal = du.cross(dv).normalize().multiplyScalar(reverse ? -1 : 1);
    q.addScaledVector(normal, side ? -thick : 0); p.push(q.x, q.y, q.z); uv.push(u * 2, v * 2);
  }
  const count = (nu + 1) * (nv + 1);
  let outer = 0;
  for (let s = 0; s < 2; s++) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (hole?.((i + .5) / nu, (j + .5) / nv)) continue;
    const a = s * count + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if ((s === 0) !== reverse) ix.push(a, b, c, b, d, c); else ix.push(a, c, b, b, c, d);
    if (s === 0) outer += 6;
  }
  const edge = (a: number, b: number) => ix.push(a, a + count, b, b, a + count, b + count);
  if (hole) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (hole((i + .5) / nu, (j + .5) / nv)) continue;
    const a = j * (nu + 1) + i;
    if (i > 0 && hole((i - .5) / nu, (j + .5) / nv)) edge(a, a + nu + 1);
    if (i < nu - 1 && hole((i + 1.5) / nu, (j + .5) / nv)) edge(a + nu + 2, a + 1);
    if (j > 0 && hole((i + .5) / nu, (j - .5) / nv)) edge(a + 1, a);
    if (j < nv - 1 && hole((i + .5) / nu, (j + 1.5) / nv)) edge(a + nu + 1, a + nu + 2);
  }
  for (let i = 0; i < nu; i++) { edge(i + 1, i); edge(nv * (nu + 1) + i, nv * (nu + 1) + i + 1); }
  for (let j = 0; j < nv; j++) { edge(j * (nu + 1), (j + 1) * (nu + 1)); edge((j + 1) * (nu + 1) + nu, j * (nu + 1) + nu); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.addGroup(0, outer, 0); geo.addGroup(outer, ix.length - outer, 1); geo.computeVertexNormals();
  mesh(g, name, geo, [m.leather, m.lining]); return f;
}
function seam(g: THREE.Group, name: string, f: Surface, direction: 'u' | 'v', value: number, m: Mats, silver = true) {
  const at = (t: number) => direction === 'u' ? f(t, value) : f(value, t);
  const pts = Array.from({ length: 49 }, (_, i) => at(i / 48));
  cord(g, `${name} piping`, pts, silver ? .0024 : .0011, silver ? m.silver : m.thread);
  // Each short raised stitch is an individual geometric thread segment.
  for (let i = 0; i < 36; i++) line(g, `${name} stitch ${i}`, at((i + .12) / 36), at((i + .62) / 36), .00085, m.thread);
}
function jewel(g: THREE.Group, name: string, p: V, size: number, m: Mats) {
  const a = vec(p); const points = [new THREE.Vector3(0, size, 0), new THREE.Vector3(size * .68, 0, 0), new THREE.Vector3(0, -size, 0), new THREE.Vector3(-size * .68, 0, 0), new THREE.Vector3(0, size, 0)].map(q => q.add(a));
  cord(g, `${name} diamond frame`, points, .0026, m.silver);
  const stone = mesh(g, `${name} pointed inset`, new THREE.OctahedronGeometry(size * .55), m.silver); stone.position.copy(a); stone.scale.set(.7, 1.4, .23);
}
type Ring = [number, number, number, number?]; // y, x radius, z radius, z center
function profile(rings: Ring[], x = 0, start = 0, end = TAU, folds = .002): Surface {
  return (u, v) => {
    const t = v * (rings.length - 1), i = Math.min(rings.length - 2, Math.floor(t)), a = rings[i]!, b = rings[i + 1]!, f = t - i;
    const mix = (k: 0 | 1 | 2) => a[k] + (b[k] - a[k]) * f;
    const theta = start + (end - start) * u, w = folds * Math.sin(theta * 9 + v * 25) * Math.sin(v * Math.PI);
    return new THREE.Vector3(x + (mix(1) + w) * Math.sin(theta), mix(0), (a[3] ?? -.03) * (1 - f) + (b[3] ?? -.03) * f + (mix(2) + w) * Math.cos(theta));
  };
}
function band(g: THREE.Group, name: string, rings: Ring[], m: Mats, x = 0) { const f = shell(g, name, profile(rings, x, TAU, 0, .001), m, 48, 4); seam(g, `${name} upper`, f, 'u', 1, m); seam(g, `${name} lower`, f, 'u', 0, m); return f; }

function hood(g: THREE.Group, m: Mats) {
  const f: Surface = (u, v) => {
    const theta = .33 + (TAU - .66) * (1 - u);
    const width = .135 * (1 - Math.pow(v, 6)) + .006;
    const zrad = .145 * (1 - Math.pow(v, 4)) + .005;
    return new THREE.Vector3(width * Math.sin(theta), 1.485 + .39 * v + .023 * Math.cos(theta) * (1 - v), -.028 - .055 * v * v + zrad * Math.cos(theta) + .003 * Math.sin(v * 32 + theta * 4));
  };
  shell(g, 'Pointed hood with open face and violet interior', f, m, 64, 32, .007);
  for (const u of [0, 1]) seam(g, 'Silver face opening', f, 'v', u, m);
  for (const u of [.23, .5, .77]) seam(g, 'Crown panel seam', f, 'v', u, m, false);
  const mantle = shell(g, 'Split shoulder mantle', profile([[1.395, .256, .168], [1.442, .223, .162], [1.493, .115, .12]], 0, TAU - .07, .07, .003), m);
  seam(g, 'Mantle hem', mantle, 'u', 0, m); seam(g, 'Mantle stitched panel', mantle, 'u', .25, m, false);
  for (const u of [0, 1]) seam(g, 'Mantle split', mantle, 'v', u, m);
  jewel(g, 'Forehead star', [0, 1.819, .084], .017, m);
  jewel(g, 'Left throat clasp', [-.026, 1.48, .128], .013, m); jewel(g, 'Right throat clasp', [.026, 1.48, .128], .013, m);
  cord(g, 'Throat linking ring', Array.from({length: 25}, (_, i) => new THREE.Vector3(.013 * Math.cos(i / 24 * TAU), 1.48 + .008 * Math.sin(i / 24 * TAU), .14)), .0024, m.silver);
}

function robe(g: THREE.Group, m: Mats) {
  const body: Surface = (u, v) => {
    const base = profile([[1.015, .153, .112], [1.15, .158, .123], [1.32, .199, .142], [1.44, .197, .121], [1.52, .083, .083]], 0, TAU, 0, .003);
    const opening = .06 + .59 * v;
    return base((opening + (TAU - 2 * opening) * u) / TAU, v);
  };
  shell(g, 'Fitted open V bodice and standing collar', body, m, 56, 24);
  for (const u of [0, 1]) seam(g, 'V front silver lapel', body, 'v', u, m);
  for (const u of [.18, .35, .65, .82]) seam(g, 'Tailored bodice seam', body, 'v', u, m, false);
  seam(g, 'Standing collar rim', body, 'u', 1, m);
  const skirt = shell(g, 'Full split leather robe skirt with folded back', profile([[.19, .345, .226], [.38, .302, .214], [.69, .243, .18], [.92, .19, .141], [1.075, .153, .118]], 0, TAU - .13, .13, .009), m, 56, 25);
  seam(g, 'Skirt hem', skirt, 'u', 0, m);
  for (const u of [0, 1, .2, .4, .6, .8]) seam(g, 'Skirt tailored length seam', skirt, 'v', u, m, u === 0 || u === 1);
  for (const u of [.05, .23, .77, .95]) {
    const f: Surface = (a, b) => skirt(u + (a - .5) * .105, .12 + b * .88).add(new THREE.Vector3(0, -.02 * Math.sin(a * Math.PI), .004 * Math.cos(TAU * u)));
    shell(g, 'Long pointed overlay panel', f, m, 14, 18); for (const edge of [0, 1]) seam(g, 'Overlay edge', f, 'v', edge, m);
    const q = f(.5, 0); jewel(g, 'Panel hem star', [q.x, q.y + .03, q.z + .006], .014, m);
  }
  band(g, 'Broad fitted waist belt', [[1.035, .16, .125], [1.097, .16, .125]], m); jewel(g, 'Large waist star buckle', [0, 1.067, .111], .038, m);
  for (const side of [-1, 1]) {
    const sleeve: Surface = (u, v) => {
      const theta = TAU * (side > 0 ? u : 1 - u), r = .075 + .04 * Math.pow(v, 3) + .004 * Math.sin(v * 30 + theta * 3);
      return new THREE.Vector3(side * (.195 + .469 * v), 1.4555 + r * Math.cos(theta), -.066 + r * .86 * Math.sin(theta));
    };
    shell(g, 'Flared T-pose sleeve', sleeve, m, 40, 24); seam(g, 'Bell cuff', sleeve, 'u', 1, m); seam(g, 'Cuff violet seam', sleeve, 'u', .95, m, false); seam(g, 'Rear sleeve seam', sleeve, 'v', .73, m, false);
    for (let layer = 0; layer < 3; layer++) {
      const cape: Surface = (u, v) => {
        const theta = Math.PI * (u - .5), r = .111 - .009 * layer;
        return new THREE.Vector3(side * (.145 + layer * .044 + v * .125), 1.455 + r * Math.cos(theta) - .035 * v, -.066 + r * 1.1 * Math.sin(theta));
      };
      shell(g, 'Layered pointed shoulder cape', cape, m, 28, 8); seam(g, 'Shoulder cape border', cape, 'u', 1, m);
    }
  }
}

function leggings(g: THREE.Group, m: Mats) {
  // Pelvic yoke and individually shaped legs leave both ankle openings real.
  const yoke = shell(g, 'Open waist and shaped hip yoke', profile([[.867, .174, .123], [.97, .183, .129], [1.045, .165, .116]], 0, TAU, 0, .002), m, 36, 12);
  seam(g, 'Waist rim', yoke, 'u', 1, m);
  band(g, 'Trouser belt', [[.993, .172, .123], [1.035, .17, .123]], m); jewel(g, 'Waist diamond buckle', [0, 1.015, .098], .017, m);
  for (const side of [-1, 1]) {
    const x = side * .1143;
    const leg = shell(g, 'Fitted leg with knee and ankle folds', profile([[.145, .054, .059], [.195, .06, .066], [.22, .054, .06], [.245, .065, .072], [.28, .06, .066], [.36, .07, .076], [.46, .068, .073], [.49, .078, .084], [.515, .068, .074], [.545, .075, .08], [.585, .084, .093], [.615, .075, .084], [.65, .085, .094], [.79, .09, .1], [.9, .092, .106]], x, TAU, 0, .0065), m, 32, 44);
    seam(g, 'Ankle opening edge', leg, 'u', 0, m); for (const u of [.08, .23, .75, .91]) seam(g, 'Leg outer and rear seams', leg, 'v', u, m, false);
    for (let layer = 0; layer < 2; layer++) {
      const knee: Surface = (u, v) => { const a = (u - .5) * 2.5; return new THREE.Vector3(x + .086 * Math.sin(a), .447 + layer * .057 + v * .1 + .085 * Math.abs(u - .5), -.019 + (.108 + layer * .004) * Math.cos(a)); };
      shell(g, 'Raised pointed overlapping shield knee guard', knee, m, 18, 6, .006); seam(g, 'Knee guard silver chevron border', knee, 'u', 0, m); seam(g, 'Knee guard top silver chevron', knee, 'u', 1, m); seam(g, 'Knee guard violet inset seam', knee, 'u', .12, m, false);
      for (const u of [0, 1]) seam(g, 'Knee guard side edge', knee, 'v', u, m);
      const rivet = knee(side > 0 ? .91 : .09, .68); jewel(g, 'Knee guard lateral silver rivet', [rivet.x, rivet.y, rivet.z + .007], .009, m);
    }
    for (let layer = 0; layer < 3; layer++) {
      const hip: Surface = (u, v) => { const a = side * .95 + (u - .5) * 1.12; return new THREE.Vector3((.208 + layer * .003) * Math.sin(a), .78 + layer * .057 + v * .083 + .084 * Math.abs(u - .5), -.022 + .155 * Math.cos(a)); };
      shell(g, 'Raised layered outer hip leather scale', hip, m, 18, 6, .006); seam(g, 'Hip scale pointed silver rim', hip, 'u', 0, m); seam(g, 'Hip scale violet stitching', hip, 'u', .12, m, false);
      const rivet = hip(.5, .67); jewel(g, 'Lateral hip scale silver fastener', [rivet.x, rivet.y, rivet.z + .009], .012, m);
    }
    const strap: Surface = (u, v) => new THREE.Vector3(side * (.124 + (u - .5) * .024), .953 + v * .102, .09 + .009 * Math.sin(v * Math.PI));
    shell(g, 'Raised waist belt keeper strap', strap, m, 4, 8, .006); for (const u of [0, 1]) seam(g, 'Belt keeper stitched edge', strap, 'v', u, m, false);
    jewel(g, 'Belt keeper lower silver buckle', [side * .124, .961, .104], .016, m);
  }
}

function boots(g: THREE.Group, m: Mats) {
  for (const side of [-1, 1]) {
    const x = side * .1143;
    const shaft = shell(g, 'Wrinkled hollow boot shaft', profile([[.035, .067, .103, .008], [.09, .065, .09, -.025], [.128, .059, .067, -.05], [.155, .067, .073, -.05], [.18, .059, .064, -.049], [.207, .072, .078, -.045], [.231, .063, .067, -.042], [.251, .071, .077, -.04], [.285, .069, .074, -.035], [.345, .075, .08, -.035]], x, TAU, 0, .007), m, 40, 32);
    for (const u of [.08, .5, .91]) seam(g, 'Boot sewn shaft panels', shaft, 'v', u, m, false);
    for (let layer = 0; layer < 2; layer++) {
      const cuff: Surface = (u, v) => { const a = TAU * (1 - u); return new THREE.Vector3(x + (.08 + layer * .004) * Math.sin(a), .252 + layer * .049 + v * .05 + .024 * (1 - Math.cos(a)) - .013 * Math.sin(a), -.031 + (.087 + layer * .004) * Math.cos(a)); };
      shell(g, 'Raised diagonal overlapping boot cuff layer', cuff, m, 48, 6, .007); seam(g, 'Pointed cuff lower silver border', cuff, 'u', 0, m); seam(g, 'Cuff upper silver border', cuff, 'u', 1, m); seam(g, 'Cuff inset violet seam', cuff, 'u', .17, m, false);
    }
    band(g, 'Broad raised ankle buckle strap', [[.137, .074, .083, -.043], [.174, .074, .083, -.043]], m, x);
    jewel(g, 'Cuff diamond clasp', [x, .269, .067], .022, m);
    const bx = x + side * .029, by = .155, bz = .039;
    cord(g, 'Ankle rectangular silver buckle frame', [[bx - .014, by - .017, bz], [bx + .014, by - .017, bz], [bx + .014, by + .017, bz], [bx - .014, by + .017, bz], [bx - .014, by - .017, bz]].map(p => vec(p as V)), .0032, m.silver);
    line(g, 'Ankle buckle tongue', new THREE.Vector3(bx, by, bz + .002), new THREE.Vector3(bx + side * .016, by, bz + .003), .0018, m.silver);
    const foot: Surface = (u, v) => {
      const a = TAU * (1 - u), y = .026 + v * .095;
      const shrink = Math.sqrt(Math.max(.005, 1 - v * v));
      return new THREE.Vector3(x + .07 * Math.sin(a) * shrink, y, .014 + .173 * Math.cos(a) * shrink);
    };
    shell(g, 'Rounded shaped leather toe and instep', foot, m, 56, 18, .006);
    const toe: Surface = (u, v) => { const a = (u - .5) * 2.15, vv = .06 + v * (.69 - .14 * Math.abs(u - .5)); const r = Math.sqrt(1 - vv * vv); return new THREE.Vector3(x + .073 * Math.sin(a) * r, .029 + vv * .095, .016 + .177 * Math.cos(a) * r); };
    shell(g, 'Raised shaped leather toe cap', toe, m, 28, 12, .004); seam(g, 'Toe cap silver chevron crown', toe, 'u', 1, m); for (const u of [0, 1, .5]) seam(g, 'Toe cap silver panel seam', toe, 'v', u, m); seam(g, 'Toe cap inset violet seam', toe, 'u', .87, m, false);
    const soleShape = new THREE.Shape();
    for (let i = 0; i <= 64; i++) { const a = i / 64 * TAU; const px = .074 * Math.sin(a), py = .014 + .177 * Math.cos(a); if (i === 0) soleShape.moveTo(px, py); else soleShape.lineTo(px, py); }
    const soleGeo = new THREE.ExtrudeGeometry(soleShape, { depth: .019, bevelEnabled: true, bevelSize: .003, bevelThickness: .002, bevelSegments: 2, steps: 1 }); soleGeo.rotateX(Math.PI / 2); soleGeo.translate(x, .024, 0); mesh(g, 'Thick stitched sole', soleGeo, m.sole);
    const heelShape = new THREE.Shape(); heelShape.moveTo(-.053, -.057); heelShape.lineTo(.053, -.057); heelShape.quadraticCurveTo(.062, -.095, .048, -.137); heelShape.quadraticCurveTo(0, -.166, -.048, -.137); heelShape.quadraticCurveTo(-.062, -.095, -.053, -.057);
    const heelGeo = new THREE.ExtrudeGeometry(heelShape, {depth: .019, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 2, steps: 1}); heelGeo.rotateX(Math.PI / 2); heelGeo.translate(x, .021, 0); mesh(g, 'Rounded stacked leather heel', heelGeo, m.sole);
    seam(g, 'Sole welt stitch', foot, 'u', .04, m, false);
  }
}

function wraps(g: THREE.Group, m: Mats) {
  for (const side of [-1, 1]) {
    const f: Surface = (u, v) => { const a = TAU * (side > 0 ? u : 1 - u), r = .043 + .006 * Math.sin(v * Math.PI) + .0025 * Math.sin(v * 35 + a * 3); return new THREE.Vector3(side * (.632 + v * .129), 1.4555 + r * Math.cos(a), -.0654 + r * .72 * Math.sin(a)); };
    const thumbU = side > 0 ? .35 : .65;
    shell(g, 'Fingerless hollow hand wrap in native T-pose', f, m, 48, 20, .004, (u, v) => Math.abs(u - thumbU) < .09 && v > .54 && v < .83);
    seam(g, 'Open palm edge silver', f, 'u', 1, m); seam(g, 'Open wrist edge silver', f, 'u', 0, m);
    for (let layer = 0; layer < 3; layer++) {
      const strip: Surface = (u, v) => { const vv = .06 + layer * .27 + v * .16 + .09 * Math.sin(u * TAU); const q = f(u, vv); q.y += .003 * Math.cos(u * TAU); q.z += .003 * Math.sin(u * TAU); return q; };
      shell(g, 'Diagonal overlapping stitched wrap band', strip, m, 48, 5); seam(g, 'Wrap band edge', strip, 'u', 0, m); seam(g, 'Wrap band violet stitching', strip, 'u', .83, m, false);
    }
    const thumb: Surface = (u, v) => { const a = TAU * (1 - u); return new THREE.Vector3(side * (.719 + .018 * Math.sin(a)), 1.432 - v * .033, -.033 + .019 * Math.cos(a) + v * .014); };
    shell(g, 'Open thumb collar', thumb, m, 32, 6); seam(g, 'Thumb hole silver edge', thumb, 'u', 1, m);
    jewel(g, 'Wrist strap silver star button', [side * .646, 1.485, -.025], .009, m);
  }
}

export const author: ItemModelAuthor = {
  ids,
  build(itemId) {
    const g = new THREE.Group(); g.name = itemId;
    const m = materials();
    const builders: Record<string, (g: THREE.Group, m: Mats) => void> = { starhide_hood: hood, starhide_robe: robe, starhide_leggings: leggings, starhide_boots: boots, starhide_wraps: wraps };
    const build = builders[itemId]; if (!build) throw new Error(`Unknown Starhide armor: ${itemId}`); build(g, m);
    g.userData['itemModel'] = { itemId, author: 'armor-starhide', reference: `art/item-icons/generated/${itemId}.png`, description: 'Indigo star-speckled leather with violet saddle stitching, dark violet lining, silver edging and pointed star fasteners; hollow native male T-pose garment.', wearable: true };
    return g;
  },
};
