import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sat = (x: number) => Math.max(0, Math.min(1, x));
const hash = (x: number) => { const n = Math.sin(x * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
type Mat = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

function add(root: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: Mat) {
  geometry.name = `${name} geometry`;
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; root.add(mesh); return mesh;
}
function batch(root: THREE.Group, name: string, geometries: THREE.BufferGeometry[], material: Mat) {
  if (!geometries.length) return;
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error(`Could not merge ${name}`);
  add(root, name, merged, material); geometries.forEach(g => g.dispose());
}
function geo(pos: number[], uv: number[], index: number[], color?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(index); g.computeVertexNormals(); return g;
}
function texture(kind: 'metal' | 'fiber' | 'shell' | 'bone', normal: boolean) {
  const n = 128, a = new Uint8Array(n * n * 4), h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const grain = hash(x + y * n);
    h[y * n + x] = kind === 'metal' ? .35 * Math.sin(x * .31 + Math.sin(y * .36) * 2) * Math.sin(y * .29) + .13 * grain
      : kind === 'fiber' ? .28 * Math.sin(x * 2.8 + Math.sin(y * .07)) + grain * .08
      : kind === 'shell' ? grain * .2 + .2 * Math.sin(x * .24 + y * .06) * Math.sin(y * .21)
      : grain * .28 + .18 * Math.sin(x * 1.3) * Math.sin(y * .9);
  }
  const at = (x: number, y: number) => h[((y + n) % n) * n + (x + n) % n]!;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    if (normal) {
      const p = V((at(x - 1, y) - at(x + 1, y)) * .38, (at(x, y - 1) - at(x, y + 1)) * .38, 1).normalize();
      a[i] = Math.round(127.5 + p.x * 127.5); a[i + 1] = Math.round(127.5 + p.y * 127.5); a[i + 2] = Math.round(127.5 + p.z * 127.5);
    } else { a[i] = a[i + 1] = a[i + 2] = Math.round(205 + at(x, y) * 70); }
    a[i + 3] = 255;
  }
  const t = new THREE.DataTexture(a, n, n, THREE.RGBAFormat); t.name = `${kind} ${normal ? 'tangent relief' : 'roughness variation'}`;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; return t;
}
function material(name: string, color: number, metalness = 0, roughness = .5, kind: 'metal' | 'fiber' | 'shell' | 'bone' = 'metal'): Mat {
  return new THREE.MeshStandardMaterial({ name, color, metalness, roughness, normalMap: texture(kind, true), roughnessMap: texture(kind, false) });
}

/** Closed sweep, with elliptical sections and rounded or pointed ends. */
function sweep(points: THREE.Vector3[], width: (t: number) => number, depth: (t: number) => number,
  steps = 32, sides = 10, front = V(0, 0, 1)): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points), pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = curve.getPoint(t), tangent = curve.getTangent(t);
    let x = tangent.clone().cross(front).normalize();
    if (x.lengthSq() < .1) x = tangent.clone().cross(V(0, 1, 0)).normalize();
    const z = x.clone().cross(tangent).normalize();
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * TAU, q = p.clone().addScaledVector(x, Math.cos(a) * width(t)).addScaledVector(z, Math.sin(a) * depth(t));
      pos.push(q.x, q.y, q.z); uv.push(j / sides, t);
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + sides + 1; idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  for (let j = 1; j < sides - 1; j++) { idx.push(0, j, j + 1); const o = steps * (sides + 1); idx.push(o, o + j + 1, o + j); }
  return geo(pos, uv, idx);
}
function cord(points: THREE.Vector3[], radius: number, steps = 32, sides = 8) {
  return sweep(points, () => radius, () => radius, steps, sides);
}
function loop(rx: number, ry: number, tube: number, at: THREE.Vector3, tilt = 0) {
  const g = new THREE.TorusGeometry(1, tube / rx, 10, 56);
  g.scale(rx, ry, rx); g.rotateY(tilt); g.translate(at.x, at.y, at.z); return g;
}
function band(radius: number, thick: number, halfWidth: number, start = 0, end = TAU, sections = 128) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], sides = 16;
  for (let i = 0; i <= sections; i++) {
    const a = start + (end - start) * i / sections;
    for (let j = 0; j <= sides; j++) {
      const t = TAU * j / sides, c = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), .35), s = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), .35);
      const dent = .000035 * Math.sin(a * 31 + s * 7) * Math.sin(a * 23 - s * 9);
      const r = radius + (c + 1) * thick / 2 + Math.pow((c + 1) / 2, 2) * dent;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, s * halfWidth); uv.push(i / sections * 5, j / sides);
    }
  }
  for (let i = 0; i < sections; i++) for (let j = 0; j < sides; j++) { const a = i * (sides + 1) + j, b = a + sides + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  if (end - start < TAU - .001) for (let j = 1; j < sides - 1; j++) { idx.push(0, j, j + 1); const o = sections * (sides + 1); idx.push(o, o + j + 1, o + j); }
  return geo(pos, uv, idx);
}
function bead(root: THREE.Group, name: string, at: THREE.Vector3, scale: THREE.Vector3, mat: Mat) {
  const g = new THREE.SphereGeometry(1, 28, 18); g.scale(scale.x, scale.y, scale.z); g.translate(at.x, at.y, at.z); return add(root, name, g, mat);
}

function fox(root: THREE.Group) {
  const copper = material('Red hammered copper rails and smooth bore', 0xc78965, 1, .34);
  const hide = material('Dark russet hide under dense guardhair', 0x502410, 0, .93, 'fiber');
  const fur = material('Fox guardhair warm red and cream tips', 0xffffff, 0, .84, 'fiber'); fur.vertexColors = true;
  add(root, 'Copper band with twenty millimetre finger opening', band(.010, .0015, .00315), copper);
  add(root, 'Continuous fox hide sleeve', band(.01148, .0007, .00272), hide);
  const rails = [band(.0116, .0007, .00040), band(.0116, .0007, .00040)]; rails[0]!.translate(0, 0, -.0030); rails[1]!.translate(0, 0, .0030);
  batch(root, 'Raised copper edges retaining the pelt', rails, copper);
  const hairs: THREE.BufferGeometry[] = [], red = new THREE.Color(0xad4e20), orange = new THREE.Color(0xd97b38), cream = new THREE.Color(0xe5c6a0);
  for (let i = 0; i < 2000; i++) {
    const a = hash(i * 3 + 2) * TAU, z = (hash(i * 3 + 7) - .5) * .00555;
    const r = .01215, len = .0007 + hash(i * 3 + 11) * .00115, direction = V(-Math.sin(a), Math.cos(a), .12 * Math.sin(a * 3));
    const p = V(Math.cos(a) * r, Math.sin(a) * r, z), n = V(Math.cos(a), Math.sin(a), 0);
    const g = sweep([p, p.clone().addScaledVector(direction, len * .45).addScaledVector(n, len * .38), p.clone().addScaledVector(direction, len).addScaledVector(n, len * .22)],
      t => (.000030 + hash(i + 120) * .000025) * (1 - t * .985), t => .000021 * (1 - t * .985), 3, 3);
    const c = red.clone().lerp(orange, hash(i + 8));
    const pale = sat((Math.abs(z) - .0015) / .00125) * .87 + (hash(i + 70) > .95 ? .55 : 0);
    c.lerp(cream, sat(pale)); const cs: number[] = [];
    for (let j = 0; j < g.getAttribute('position').count; j++) { const tip = Math.floor(j / 4) / 3; const col = c.clone().lerp(cream, tip * .18); cs.push(col.r, col.g, col.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3)); hairs.push(g);
  }
  batch(root, 'Two thousand individually tapered swept guardhairs', hairs, fur);
}

function lynx(root: THREE.Group) {
  const iron = material('Dark worn iron wire with bright worked edges', 0x55514d, 1, .38);
  const sinew = material('Taut honey tan longitudinal sinew fibres', 0xbe9765, 0, .47, 'fiber');
  const light = material('Fine pale raised sinew fibres', 0xe0bd85, 0, .52, 'fiber');
  const wires: THREE.BufferGeometry[] = [];
  for (let j = 0; j < 3; j++) {
    const points = Array.from({ length: 193 }, (_, i) => { const a = i / 192 * TAU, b = a * 2 + j / 3 * TAU; const r = .0116 + .0007 * Math.cos(b); return V(Math.cos(a) * r, Math.sin(a) * r, .00112 * Math.sin(b)); });
    wires.push(cord(points, .00082, 192, 10));
  }
  batch(root, 'Three twisted forged iron strands forming open ring', wires, iron);
  const wraps: THREE.BufferGeometry[] = [], fibers: THREE.BufferGeometry[] = [];
  const ranges: [number, number, number][] = [[.22, 2.85, 15], [3.05, 3.49, 4], [4.55, 5.06, 4], [5.72, 6.16, 4]];
  ranges.forEach(([start, end, turns], k) => {
    const point = (t: number, offset: number) => {
      const a = start + (end - start) * t, b = t * TAU * turns + offset;
      const r = .0116 + .00182 * Math.cos(b); return V(r * Math.cos(a), r * Math.sin(a), .00216 * Math.sin(b));
    };
    wraps.push(sweep(Array.from({ length: turns * 20 + 1 }, (_, i) => point(i / (turns * 20), 0)), () => .00040, () => .00024, turns * 24, 8));
    for (let f = 0; f < 4; f++) fibers.push(cord(Array.from({ length: turns * 20 + 1 }, (_, i) => point(i / (turns * 20), (f - 1.5) * .075)), .000029, turns * 20, 4));
    const a = end, p = V(Math.cos(a) * .0132, Math.sin(a) * .0132, .0008);
    wraps.push(sweep([p, p.clone().add(V(-.00035, .0004, .0007)), p.clone().add(V(.0002, -.0004, .0011))], t => .0003 * (1 - .5 * t), () => .00012, 8, 6));
    void k;
  });
  batch(root, 'Broad diagonal sinew wrapping with tucked cut ends', wraps, sinew);
  batch(root, 'Longitudinal filament ridges in sinew lashings', fibers, light);
}

/** Curved closed feather vane. Thickness is a real lenticular section, with a bowed shaft. */
function feather(root: THREE.Group, name: string, top: THREE.Vector3, tip: THREE.Vector3, width: number, mat: Mat, shaftMat: Mat, barred: boolean, bend: number) {
  const dir = tip.clone().sub(top), side = V(-dir.y, dir.x, 0).normalize();
  const center = (t: number) => top.clone().addScaledVector(dir, t).addScaledVector(side, Math.sin(t * Math.PI) * bend).add(V(0, 0, Math.sin(t * Math.PI) * .0014));
  const span = (t: number, s: number) => width * Math.pow(Math.sin(Math.PI * Math.pow(t, .78)), .65) * (s < 0 ? .85 : 1.0);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], colors: number[] = [];
  const rows = 96, sides = 16;
  for (let i = 0; i <= rows; i++) {
    const t = Math.max(.00002, Math.min(.99998, i / rows));
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * TAU, s = Math.cos(a);
      const ragged = 1 - .035 * (Math.sin(i * 2.3) * .5 + .5) - (i % 13 === 0 ? .048 : 0);
      const p = center(t).addScaledVector(side, s * span(t, s) * ragged);
      p.z += Math.sin(a) * (.00015 + Math.sin(t * Math.PI) * .00024) - Math.abs(s) * .0007 + .00013 * Math.sin(t * 110 + Math.abs(s) * 8);
      pos.push(p.x, p.y, p.z); uv.push((s + 1) * .5, t * 3);
      const base = new THREE.Color(barred ? 0x37281f : 0x74869d), pale = new THREE.Color(barred ? 0xe4d2ab : 0xe7e6df);
      const bar = barred ? sat((Math.sin((t + Math.abs(s) * .022) * TAU * 5.2) - .33) * 5) : sat(Math.abs(s) * .8 + t * .28);
      base.lerp(pale, bar); base.multiplyScalar(.9 + hash(i * 21 + j) * .17); colors.push(base.r, base.g, base.b);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < sides; j++) { const a = i * (sides + 1) + j, b = a + sides + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  add(root, `${name} volumetric barred vane`, geo(pos, uv, idx, colors), mat);
  const shaft = Array.from({ length: 30 }, (_, i) => center(i / 29).add(V(0, 0, .0003)));
  add(root, `${name} tapered curved rachis`, sweep(shaft, t => .00029 * (1 - t * .92), t => .00024 * (1 - t * .92), 64, 8), shaftMat);
  const barbs: THREE.BufferGeometry[] = [];
  for (let i = 4; i < 85; i++) for (const s of [-1, 1]) {
    const t = i / 96, p = center(t).add(V(0, 0, .00032)), t2 = Math.min(.99, t + .047);
    const q = center(t2).addScaledVector(side, s * span(t2, s) * .98).add(V(0, 0, -.00050));
    const mid = p.clone().lerp(q, .55).add(V(0, 0, .00007));
    const g = sweep([p, mid, q], u => .000037 * (1 - .83 * u), u => .000023 * (1 - .8 * u), 3, 3);
    const cc: number[] = [], c = new THREE.Color(barred ? (Math.sin(t * TAU * 5.2) > .33 ? 0xe0c9a0 : 0x76604a) : 0xc0cbd4);
    for (let v = 0; v < g.getAttribute('position').count; v++) cc.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); barbs.push(g);
  }
  batch(root, `${name} individually swept vane barbs`, barbs, mat);
}
function crystal(root: THREE.Group, copper: Mat) {
  const quartz = new THREE.MeshPhysicalMaterial({ name: 'Cloudy natural quartz crystal with clear thick volume', color: 0xf9eee0, roughness: .18, transmission: .75, thickness: .006, ior: 1.544, attenuationColor: new THREE.Color(0xf6eadb), attenuationDistance: .06 });
  const mineral = material('Fine milky quartz inclusions', 0xe8e1d3, 0, .45, 'bone');
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  const rings: [number, number][] = [[.002, .0002], [-.001, .0033], [-.013, .0037], [-.018, .0026], [-.024, .00010]];
  rings.forEach(([y, radius], k) => { for (let j = 0; j < 7; j++) { const a = j / 7 * TAU; pos.push(.0015 + Math.cos(a) * radius * (1 + .13 * Math.sin(j * 8 + k)), y, .0042 + Math.sin(a) * radius * .73); uv.push(j / 7, k / 4); } });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) { const a = i * 7 + j, b = i * 7 + (j + 1) % 7; idx.push(a, b, a + 7, b, b + 7, a + 7); }
  for (let j = 1; j < 6; j++) idx.push(0, j + 1, j, 28, 28 + j, 29 + j);
  const g = geo(pos, uv, idx).toNonIndexed(); g.computeVertexNormals(); add(root, 'Asymmetric terminated raw quartz pendant', g, quartz);
  const inclusions: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 31; i++) { const g = new THREE.TetrahedronGeometry(1); g.scale(.0001 + hash(i) * .0007, .0002 + hash(i + 1) * .0013, .00004); g.rotateY(i * .91); g.rotateZ(i); g.translate(.0015 + (hash(i + 3) - .5) * .0035, -.002 - hash(i + 8) * .018, .0042 + (hash(i + 6) - .5) * .003); inclusions.push(g); }
  batch(root, 'Small mineral fractures inside natural quartz', inclusions, mineral);
  const wires: THREE.BufferGeometry[] = [];
  for (let strand = 0; strand < 2; strand++) wires.push(cord(Array.from({ length: 70 }, (_, i) => { const t = i / 69, a = t * TAU * 1.4 + strand * Math.PI; return V(.0015 + Math.cos(a) * (.0018 + .0022 * Math.sin(t * Math.PI * .68)), .002 - t * .014, .0042 + Math.sin(a) * .0033); }), .00043, 80, 8));
  batch(root, 'Crossing copper wire cage holding quartz', wires, copper);
  add(root, 'Copper cage neck hooked into feather binding', cord([V(.0015, .0017, .0043), V(.0014, .0048, .0036), V(.0002, .0073, .0020), V(-.0008, .0069, .0002)], .00043, 24, 8), copper);
}
function turkey(root: THREE.Group) {
  const copper = material('Hammered red copper hanging loop and binding wire', 0xc18455, 1, .33);
  const shaft = material('Dark warm turkey feather rachis', 0x594532, 0, .56, 'fiber');
  const vane = material('Natural cream and dark brown turkey barring', 0xffffff, 0, .78, 'fiber'); vane.vertexColors = true;
  feather(root, 'Left long turkey plume', V(-.002, .008, -.0006), V(-.017, -.037, -.001), .0085, vane, shaft, true, -.003);
  feather(root, 'Right narrow turkey plume', V(.001, .008, -.0016), V(.012, -.041, -.002), .0062, vane, shaft, true, .0015);
  crystal(root, copper);
  add(root, 'Oval copper suspension eye', loop(.0035, .0048, .0008, V(0, .017, 0)), copper);
  add(root, 'Interlocking copper jump ring', loop(.0019, .0027, .00048, V(0, .0112, 0), Math.PI / 2), copper);
  for (let i = 0; i < 3; i++) { const g = loop(.0022, .0017, .00043, V(0, 0, 0)); g.rotateX(Math.PI / 2); g.translate(0, .0084 - i * .00077, 0); add(root, `Feather stem copper collar turn ${i + 1}`, g, copper); }
  bead(root, 'Peened left binding wire end', V(-.0015, .0068, .002), V(.0009, .0009, .0007), copper);
  bead(root, 'Peened right binding wire end', V(.0016, .0068, .002), V(.0008, .0008, .0007), copper);
}

function heron(root: THREE.Group) {
  const iron = material('Brown grey forged iron quill ferrule', 0x746558, 1, .37);
  const horn = material('Ivory split quill with longitudinal striation', 0xe9dabc, 0, .40, 'fiber');
  const blue = material('Slate blue grey heron feather tips', 0x637289, 0, .65, 'fiber');
  const vane = material('Heron pale grey feather vane', 0xffffff, 0, .76, 'fiber'); vane.vertexColors = true;
  const amber = new THREE.MeshPhysicalMaterial({ name: 'Polished honey orange amber with warm volume', color: 0xff9b14, roughness: .16, transmission: .56, thickness: .012, ior: 1.54, attenuationColor: new THREE.Color(0xff8b0e), attenuationDistance: .035, clearcoat: .5 });
  const flecks = material('Amber suspended brown mineral flecks', 0x8a430b, 0, .56, 'bone');
  feather(root, 'Side heron feather', V(.001, .019, -.002), V(.010, -.020, -.002), .0057, vane, blue, false, .0025);
  const left = [V(-.0013, .018, 0), V(-.0034, .008, .002), V(-.009, -.005, .0032), V(-.0072, -.016, .003), V(-.003, -.032, .0005)];
  const right = [V(.0014, .018, 0), V(.0042, .005, .003), V(.007, -.008, .004), V(.0032, -.023, .002), V(-.0025, -.032, .0003)];
  [left, right].forEach((p, i) => {
    add(root, `${i ? 'Right' : 'Left'} bowed half of split hollow quill`, sweep(p, t => (.0011 + Math.sin(t * Math.PI) * .00125) * (1 - Math.pow(t, 5) * .97), t => (.00065 + Math.sin(t * Math.PI) * .00050) * (1 - Math.pow(t, 5) * .97), 64, 12), horn);
    const c = new THREE.CatmullRomCurve3(p), tipPoints = Array.from({ length: 16 }, (_, j) => c.getPoint(.72 + j / 15 * .278).add(V(0, 0, .00043 * (1 - j / 15))));
    add(root, `${i ? 'Right' : 'Left'} blue grey distal quill stain`, sweep(tipPoints, t => .0007 * (1 - t * .99), t => .00024 * (1 - t * .99), 20, 8), blue);
  });
  bead(root, 'Single oval amber bead captured between split quill halves', V(-.0008, -.007, .0015), V(.0062, .008, .0039), amber);
  const dust: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 35; i++) { const g = new THREE.TetrahedronGeometry(1); g.scale(.00012 + hash(i + 8) * .00035, .0002 + hash(i + 2) * .00035, .00008); g.rotateZ(i); g.translate(-.0008 + (hash(i + 3) - .5) * .008, -.007 + (hash(i + 13) - .5) * .011, .0015 + (hash(i + 22) - .5) * .004); dust.push(g); }
  batch(root, 'Amber small suspended organic inclusions', dust, flecks);
  for (const y of [-.014, .000]) add(root, 'Iron cross strap behind amber bead', cord([V(-.0045, y, .001), V(-.001, y - .0004, .0056), V(.004, y, .001)], .00056, 18, 8), iron);
  const ferrule = band(.00235, .00065, .002, 0, TAU, 64); ferrule.rotateX(Math.PI / 2); ferrule.translate(0, .0175, 0); add(root, 'Thick hollow forged socket around split quill roots', ferrule, iron);
  for (const y of [.0154, .0196]) { const g = loop(.0028, .0028, .0003, V(0, 0, 0)); g.rotateX(Math.PI / 2); g.translate(0, y, 0); add(root, 'Ferrule folded lip', g, iron); }
  add(root, 'Iron joining link', loop(.0019, .0032, .00055, V(0, .022, 0), Math.PI / 2), iron);
  add(root, 'Large oval iron suspension eye', loop(.0033, .005, .00085, V(0, .028, 0)), iron);
}

function quillguard(root: THREE.Group) {
  const cobalt = material('Worn cobalt blue forged band and sockets', 0x345986, 1, .31);
  const quill = material('Porcupine quill dark roots grading into ivory tips', 0xffffff, 0, .37, 'fiber'); quill.vertexColors = true;
  add(root, 'Broad cobalt guard band with smooth open bore', band(.010, .00145, .00335), cobalt);
  const tips: THREE.BufferGeometry[] = [], sockets: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU + row * .18, radial = V(Math.cos(a), Math.sin(a), 0), tangent = V(-Math.sin(a), Math.cos(a), 0);
    const p = radial.clone().multiplyScalar(.01145).add(V(0, 0, (row ? 1 : -1) * .0017));
    const q = p.clone().addScaledVector(radial, .0039).addScaledVector(tangent, .0014).add(V(0, 0, (row ? 1 : -1) * .00025));
    const g = sweep([p, p.clone().lerp(q, .58).addScaledVector(tangent, .00025), q], t => .00122 * Math.pow(1 - t * .997, .64), t => .00105 * Math.pow(1 - t * .997, .64), 18, 10);
    const c: number[] = [], brown = new THREE.Color(0x302016), ivory = new THREE.Color(0xf3dfb4);
    for (let j = 0; j < g.getAttribute('position').count; j++) { const t = Math.floor(j / 11) / 18; const blend = sat((t - .42 + .06 * Math.sin(j * 3.3)) / .18); const col = brown.clone().lerp(ivory, blend); c.push(col.r, col.g, col.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); tips.push(g);
    const collar = sweep([p.clone().addScaledVector(radial, -.0001), p.clone().addScaledVector(radial, .0008)], () => .00138, () => .00113, 3, 8); sockets.push(collar);
  }
  batch(root, 'Two staggered rows of short two tone porcupine quills', tips, quill);
  batch(root, 'Individual crimped cobalt quill sockets', sockets, cobalt);
  for (const z of [-.003, .003]) { const g = band(.0113, .00055, .00032); g.translate(0, 0, z); add(root, 'Protective cobalt edge rail', g, cobalt); }
}

function antler(root: THREE.Group) {
  const bone = material('Warm cream polished antler end grain', 0xeee0bd, 0, .55, 'bone');
  const bark = material('Dark mottled antler cortex around sawn edge', 0x6d4a2c, 0, .76, 'bone');
  const pore = material('Honey brown depths of cancellous antler pores', 0x9d7c4b, 0, .89, 'bone');
  const copper = material('Hammered bronze antler bail', 0x986744, 1, .38);
  const cobalt = material('Dark cobalt blue interlocking chain', 0x295b96, 1, .29);
  const outline = new THREE.Shape();
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, r = .016 * (1 + .035 * Math.sin(a * 9) + .024 * Math.sin(a * 15)); points.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r * 1.06)); }
  outline.moveTo(points[0]!.x, points[0]!.y); points.slice(1).forEach(p => outline.lineTo(p.x, p.y)); outline.closePath();
  const hole = new THREE.Path(); hole.absellipse(0, .012, .00205, .0026, 0, TAU, true); outline.holes.push(hole);
  const pores: { x: number; y: number; size: number; aspect: number }[] = [];
  for (let i = 0; i < 185; i++) {
    const a = i * 2.39996, r = .0118 * Math.sqrt((i + .5) / 185), x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (y > .0088 && Math.abs(x) < .0034) continue;
    const size = .00016 + hash(i + 9) * .00036, aspect = .75 + hash(i) * .5;
    pores.push({ x, y, size, aspect });
    const opening = new THREE.Path();
    for (let j = 0; j < 8; j++) { const a = -j / 8 * TAU, xx = x + Math.cos(a) * size, yy = y + Math.sin(a) * size * aspect; if (j === 0) opening.moveTo(xx, yy); else opening.lineTo(xx, yy); }
    opening.closePath(); outline.holes.push(opening);
  }
  const disk = new THREE.ExtrudeGeometry(outline, { depth: .0034, bevelEnabled: false, curveSegments: 24, steps: 1 }); disk.translate(0, 0, -.0017);
  add(root, 'Sawn antler disc with genuinely drilled suspension hole', disk, bone);
  const rind: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU, b = (i + 1) / 96 * TAU;
    const p = (t: number) => { const r = .016 * (1 + .035 * Math.sin(t * 9) + .024 * Math.sin(t * 15)); return V(Math.cos(t) * r, Math.sin(t) * r * 1.06, 0); };
    const g = sweep([p(a), p((a + b) / 2), p(b)], () => .00047 + hash(i) * .00019, () => .00165 + hash(i + 20) * .0002, 2, 8); rind.push(g);
  }
  batch(root, 'Rugged brown antler cortex continuous around edge', rind, bark);
  // Recessed cup mouths with a broad pale lip. Both faces carry the sawn porous structure.
  const cups: THREE.BufferGeometry[] = [], rims: THREE.BufferGeometry[] = [];
  for (let side = -1; side <= 1; side += 2) for (const { x, y, size, aspect } of pores) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let row = 0; row <= 3; row++) for (let j = 0; j <= 8; j++) { const t = row / 3, aa = j / 8 * TAU, rr = size * t; pos.push(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr * aspect, side * (.00134 + t * t * .00036)); uv.push(j / 8, t); }
    for (let row = 0; row < 3; row++) for (let j = 0; j < 8; j++) { const p = row * 9 + j, q = p + 9; if (side > 0) idx.push(p, q, p + 1, q, q + 1, p + 1); else idx.push(p, p + 1, q, q, p + 1, q + 1); }
    cups.push(geo(pos, uv, idx));
    const rim = new THREE.TorusGeometry(size, .000040, 3, 8); rim.scale(1, aspect, 1); rim.translate(x, y, side * .00171); rims.push(rim);
  }
  batch(root, 'Hundreds of small inset cancellous pore cups on both sawn faces', cups, pore);
  batch(root, 'Cream rounded mouths of antler pores', rims, bone);
  add(root, 'Broad bronze bail through drilled antler hole', loop(.0024, .0048, .00085, V(0, .0155, .001), Math.PI / 2), copper);
  const chain: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const a = 2.45 - i / 12 * TAU, x = .011 + Math.cos(a) * .012, y = .012 + Math.sin(a) * .012;
    const g = new THREE.TorusGeometry(1, .00065 / .0025, 8, 40); g.scale(.0025, .0037, .0025);
    g.rotateY(i % 2 ? 1.15 : .05); g.rotateZ(a); g.translate(x, y, -.001); chain.push(g);
  }
  batch(root, 'Twelve interlinked oval cobalt chain links draped behind disc', chain, cobalt);
}

function chitin(root: THREE.Group) {
  const titanium = material('Worn pale titanium band and sculpted plate retainers', 0xb5b0a4, 1, .32);
  const shell = new THREE.MeshPhysicalMaterial({ name: 'Polished reddish brown centipede chitin', color: 0x6b2e12, roughness: .31, metalness: .06, clearcoat: .55, clearcoatRoughness: .24, normalMap: texture('shell', true), roughnessMap: texture('shell', false), vertexColors: true });
  const seams = material('Dark chitin plate seams and fine growth lines', 0x25150f, 0, .67, 'shell');
  add(root, 'Titanium open band with polished bore', band(.010, .00125, .00335), titanium);
  const plates: THREE.BufferGeometry[] = [], trims: THREE.BufferGeometry[] = [], ridges: THREE.BufferGeometry[] = [];
  const count = 11;
  for (let i = 0; i < count; i++) {
    const a = i / count * TAU, pos: number[] = [], uv: number[] = [], idx: number[] = [], colors: number[] = [];
    const rows = 16, cross = 16;
    for (let u = 0; u <= rows; u++) for (let j = 0; j <= cross; j++) {
      const t = u / rows, b = j / cross * TAU, s = Math.cos(b), angle = a + (t - .5) * TAU / count * .96;
      const edge = .00318 * (.92 + .08 * Math.sin(t * Math.PI));
      const r = .01165 + Math.sin(b) * (.00035 + .00050 * Math.sin(t * Math.PI)) + .00027 * Math.cos(s * Math.PI / 2);
      pos.push(Math.cos(angle) * r, Math.sin(angle) * r, s * edge); uv.push(t, (s + 1) / 2);
      const c = new THREE.Color(0x3b190d).lerp(new THREE.Color(0xb66027), Math.sin(t * Math.PI) * (.58 + .42 * (1 - Math.abs(s)))); colors.push(c.r, c.g, c.b);
    }
    for (let u = 0; u < rows; u++) for (let j = 0; j < cross; j++) { const p = u * (cross + 1) + j, q = p + cross + 1; idx.push(p, p + 1, q, p + 1, q + 1, q); }
    for (let j = 1; j < cross - 1; j++) { idx.push(0, j + 1, j); const o = rows * (cross + 1); idx.push(o, o + j, o + j + 1); }
    plates.push(geo(pos, uv, idx, colors));
    const aa = a - TAU / count * .47;
    const p = (z: number, da: number, r: number) => V(Math.cos(aa + da) * r, Math.sin(aa + da) * r, z);
    trims.push(sweep([p(-.0035, -.09, .0114), p(-.0027, -.035, .01215), p(0, .035, .01265), p(.0027, -.035, .01215), p(.0035, -.09, .0114)], t => .00038 + .00035 * Math.pow(Math.abs(t - .5) * 2, 3), () => .00025, 24, 8));
    for (const z of [-.00125, .00125]) ridges.push(cord(Array.from({ length: 16 }, (_, k) => { const t = k / 15, angle = a + (t - .5) * TAU / count * .85; return V(Math.cos(angle) * .01245, Math.sin(angle) * .01245, z + .00015 * Math.sin(t * Math.PI)); }), .000045, 18, 5));
    for (const z of [-.00318, .00318]) trims.push(cord(Array.from({ length: 13 }, (_, k) => { const angle = a + (k / 12 - .5) * TAU / count; return V(Math.cos(angle) * .0118, Math.sin(angle) * .0118, z); }), .00028, 18, 8));
  }
  batch(root, 'Eleven overlapping domed centipede shell plates', plates, shell);
  batch(root, 'Titanium recurved dividers and continuous side bezels', trims, titanium);
  batch(root, 'Fine lengthwise chitin growth seams', ridges, seams);
}

function mantis(root: THREE.Group) {
  const titanium = material('Polished hammered titanium open cage', 0xbeb6a5, 1, .30);
  const chitin = new THREE.MeshPhysicalMaterial({ name: 'Olive green mantis spur with amber brown cutting edge', color: 0xffffff, roughness: .35, clearcoat: .46, clearcoatRoughness: .27, normalMap: texture('shell', true), vertexColors: true });
  const edgeMat = material('Amber brown mantis edge and tooth tips', 0x784016, 0, .36, 'shell');
  const points = [V(.002, .023, 0), V(.006, .011, .0003), V(.0035, -.006, .0005), V(-.003, -.022, 0), V(-.015, -.030, -.0003)];
  const c = new THREE.CatmullRomCurve3(points);
  const width = (t: number) => .0047 * Math.pow(Math.sin(Math.PI * (t * .96 + .035)), .70) * (1 - t * .55);
  const body = sweep(points, width, t => .0012 * Math.pow(Math.sin(Math.PI * (t * .97 + .02)), .55), 96, 20);
  const colors: number[] = [];
  for (let i = 0; i < body.getAttribute('position').count; i++) { const j = i % 21, t = Math.floor(i / 21) / 96; const s = Math.abs(Math.cos(j / 20 * TAU)); const col = new THREE.Color(0x7e9329).lerp(new THREE.Color(0x804011), sat((s - .60) * 2.3 + Math.pow(t, 5) * .9)); col.multiplyScalar(.9 + hash(i) * .16); colors.push(col.r, col.g, col.b); }
  body.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); add(root, 'Curved thick olive mantis cutting spur', body, chitin);
  const teeth: THREE.BufferGeometry[] = [], veins: THREE.BufferGeometry[] = [];
  const side = (t: number) => { const tan = c.getTangent(t); return V(tan.y, -tan.x, 0).normalize(); };
  for (let i = 0; i < 8; i++) {
    const t = .15 + i * .078, p = c.getPoint(t).addScaledVector(side(t), width(t) * .65);
    const q = p.clone().addScaledVector(side(t), .0032 - i * .00019).add(V(0, -.0015, .00005));
    const g = sweep([p, p.clone().lerp(q, .52).add(V(0, .00035, 0)), q], u => (.0012 - i * .00007) * Math.pow(1 - u * .999, .76), u => .0007 * (1 - u * .999), 18, 10);
    teeth.push(g);
  }
  batch(root, 'Eight recurved serrations with pointed brown cutting tips', teeth, edgeMat);
  const cage: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    cage.push(cord(Array.from({ length: 48 }, (_, i) => { const t = i / 47; return c.getPoint(t).addScaledVector(side(t), s * (width(t) + (s > 0 ? .002 : .00055))).add(V(0, 0, -.0002)); }), .00048, 70, 8));
    veins.push(cord(Array.from({ length: 48 }, (_, i) => { const t = .05 + i / 47 * .90; return c.getPoint(t).addScaledVector(side(t), s * width(t) * .62).add(V(0, 0, .00115 * Math.sin(t * Math.PI))); }), .00012, 64, 6));
  }
  batch(root, 'Brown raised longitudinal chitin ridges', veins, edgeMat);
  for (const t of [.065, .29, .69, .88]) {
    const p = c.getPoint(t), s = side(t), w = width(t) + .0009;
    const strap = Array.from({ length: 25 }, (_, i) => { const a = i / 24 * TAU; return p.clone().addScaledVector(s, Math.cos(a) * w).add(V(0, 0, Math.sin(a) * .0018)); });
    cage.push(sweep(strap, () => .00062, () => .00028, 36, 8, c.getTangent(t)));
  }
  batch(root, 'Titanium cage rails and four bent retaining straps', cage, titanium);
  add(root, 'Small interlocking titanium jump ring', loop(.0021, .0028, .00055, V(.001, .026, 0), Math.PI / 2), titanium);
  add(root, 'Thick oval titanium suspension bail', loop(.0034, .0052, .00095, V(.001, .032, 0)), titanium);
}

const descriptions: Record<string, string> = {
  foxhair_ring: 'Hammered copper ring with 20 mm bore, raised copper retaining edges and dense swept red fox guardhair with pale tips over a real hide sleeve. Full rear pelt and smooth inner band inferred.',
  turkey_plume_charm: 'Two thick curved brown and cream barred turkey feathers, separate tapered rachises and barbs, a terminated cloudy quartz crystal in crossed copper wire and interlocking hammered copper suspension fittings. Closed feather backs and wrapped rear crystal inferred.',
  lynx_sinew_ring: 'Three dark twisted iron wires form a 20 mm open finger bore, lashed with broad tan sinew across the crown and three smaller binding stations, with fine longitudinal fibres and tucked ends.',
  heron_quill_charm: 'Honey amber oval held between two ivory halves of a split quill, slate blue distal markings, one curved blue grey heron feather, iron socket and two interlocking suspension loops. Quill backs and retaining straps inferred.',
  quillguard_ring: 'Broad cobalt guard ring with a 20 mm bore, two staggered rows of short blunt dark rooted ivory porcupine quills in individual crimped blue metal sockets and protective side rails.',
  antler_palm_charm: 'Cream sawn antler disc with a drilled hole, rugged dark outer cortex, hundreds of recessed cancellous pore cups on both faces, broad bronze bail and twelve interlinked cobalt chain links. Rear cut face inferred from front.',
  chitin_ring: 'Eleven domed reddish brown centipede plates overlap around a smooth 20 mm titanium bore, retained by recurved titanium dividers and side bezels. Fine growth seams and complete rear construction.',
  mantis_edge_charm: 'Curved olive green mantis cutting spur with eight brown hooked serrations and raised growth ridges, held in an open titanium cage by four straps with interlocking pendant fittings. Thick shell back inferred.',
};
export const author: ItemModelAuthor = {
  ids: ['foxhair_ring', 'turkey_plume_charm', 'lynx_sinew_ring', 'heron_quill_charm', 'quillguard_ring', 'antler_palm_charm', 'chitin_ring', 'mantis_edge_charm'],
  build(itemId) {
    const builders: Record<string, (root: THREE.Group) => void> = { foxhair_ring: fox, turkey_plume_charm: turkey, lynx_sinew_ring: lynx, heron_quill_charm: heron, quillguard_ring: quillguard, antler_palm_charm: antler, chitin_ring: chitin, mantis_edge_charm: mantis };
    const build = builders[itemId]; if (!build) throw new Error(`Unsupported jewelry trophy ${itemId}`);
    const root = new THREE.Group(); root.name = itemId.replaceAll('_', ' ');
    root.userData.itemModel = { itemId, author: 'jewelry-trophies', reference: `art/item-icons/generated/${itemId}.png`, description: descriptions[itemId]! };
    build(root); return root;
  },
};
