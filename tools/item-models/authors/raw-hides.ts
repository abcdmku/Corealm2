import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const ids = ['coarse_hide', 'bramble_hide', 'cairn_pelt', 'charhide', 'dragonhide', 'starhide', 'tapir_leather', 'bighorn_fleece'] as const;
type Id = typeof ids[number];
const descriptions: Record<Id, string> = {
  coarse_hide: 'Goat and rabbit skins, scraped and salted together. Stiff until you work it.',
  bramble_hide: 'Deepwood deer and hog, thorns still in the seam. Nothing in Woodlands tans clean.',
  cairn_pelt: 'Winter coat off something that lived above the treeline. Takes no dye and does not tear.',
  charhide: 'Foothill hide seared grey at the edges. Sheds heat the way fur pelt sheds cold.',
  dragonhide: "Supple hide beneath a young dragon's scales. Grave Thread binds it into level 50 casting armour.",
  starhide: 'Adult dragon hide steeped in deep magic. Void Thread stitches it into level 70 casting armour.',
  tapir_leather: "Thick strips from a tapir's flank. Trim three strips into two standard hide sheets.",
  bighorn_fleece: 'Dense wool from a ridge ram. A felted lining stretches a pelt into a pair of leggings.',
};
const TAU = Math.PI * 2;
function hash(n: number): number { return (Math.sin(n * 127.1 + 311.7) * 43758.5453 % 1 + 1) % 1; }
function tex(name: string, sample: (u: number, v: number) => number[], linear = false): THREE.DataTexture {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = sample(x / (size - 1), y / (size - 1)), i = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, c[k]!));
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.name = name;
  t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true; return t;
}
function pebble(u: number, v: number, freq: number): number {
  const x = u * freq, y = v * freq * 2.4, ix = Math.floor(x), iy = Math.floor(y);
  let a = 10, b = 10;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const key = (ix + dx) * 43 + (iy + dy) * 197;
    const d = Math.hypot(x - ix - dx - .2 - .6 * hash(key), y - iy - dy - .2 - .6 * hash(key + 7));
    if (d < a) { b = a; a = d; } else if (d < b) b = d;
  }
  return Math.min(1, (b - a) * 9);
}
function mat(id: Id, underside = false): THREE.MeshStandardMaterial {
  const base: Record<Id, number[]> = { coarse_hide: [174, 124, 78], bramble_hide: [114, 61, 34], cairn_pelt: [195, 190, 178], charhide: [70, 49, 39], dragonhide: [135, 59, 27], starhide: [32, 34, 66], tapir_leather: [111, 93, 80], bighorn_fleece: [217, 198, 161] };
  const color = base[id];
  const scaled = id === 'dragonhide' || id === 'starhide';
  const revised = id === 'bramble_hide' || id === 'charhide' || id === 'tapir_leather';
  const crease = (u: number, v: number) => {
    const a = Math.abs(Math.sin(u * 18 + v * 11 + .8 * Math.sin(v * 17)));
    const b = Math.abs(Math.sin(v * 29 - u * 8 + .7 * Math.cos(u * 13)));
    return Math.exp(-a * a * 240) + .6 * Math.exp(-b * b * 320);
  };
  const height = (u: number, v: number) => revised
    ? underside ? pebble(u, v, 91) * .11 : pebble(u, v, id === 'tapir_leather' ? 41 : 36) * .62 - crease(u, v) * .16
    : underside ? .2 * Math.sin(u * 1300 + Math.sin(v * 940)) : pebble(u, v, scaled ? 39 : 62) * .55 + .12 * Math.sin(u * 370 + v * 24 + Math.sin(v * 81));
  const map = tex(`${id} ${underside ? 'fibrous flesh side' : 'grain and worn edges'}`, (u, v) => {
    const grain = hash(Math.floor(u * 512) + Math.floor(v * 512) * 512) - .5;
    if (underside) return [141 + grain * 35, 120 + grain * 35, 94 + grain * 32];
    const h = height(u, v), mott = Math.sin(u * 15 + v * 24) * Math.sin(v * 19 - u * 7);
    const d = h * 22 + grain * 13 + mott * 12;
    if (id === 'cairn_pelt') { const patch = Math.max(0, Math.sin(u * 11 + 1.1 * Math.sin(v * 9))); return [218 - patch * 92 + grain * 22, 212 - patch * 91 + grain * 22, 201 - patch * 80 + grain * 22]; }
    const edge = Math.max(0, 1 - Math.min(u, 1 - u, v, 1 - v) * 15);
    if (id === 'charhide') {
      const distance = Math.min(u, 1 - u, v * 2, (1 - v) * 2);
      const ash = Math.max(0, Math.min(1, ( .16 + .025 * Math.sin(v * 59 + u * 21) - distance) * 15));
      return color.map((c, k) => (c + d - crease(u, v) * 15) * (1 - ash) + [151, 149, 144][k]! * ash + grain * ash * 25);
    }
    if (id === 'bramble_hide') return color.map(c => c + d - crease(u, v) * 34);
    if (id === 'tapir_leather') return [113, 103, 96].map(c => c + d - crease(u, v) * 12);
    if (id === 'coarse_hide') return color.map((c, k) => c + d + edge * [32, 44, 57][k]!);
    return color.map(c => c + d);
  });
  const normalMap = tex(`${id} subtle independent physical grain`, (u, v) => {
    const e = 1 / 1024, dx = height(u + e, v) - height(u - e, v), dy = height(u, v + e) - height(u, v - e);
    const n = new THREE.Vector3(-dx * .3, -dy * .3, 1).normalize(); return [128 + 127 * n.x, 128 + 127 * n.y, 128 + 127 * n.z];
  }, true);
  const m = new THREE.MeshStandardMaterial({ name: `${id} ${underside ? 'rough suede reverse' : 'supple outer surface'}`, map, normalMap, roughness: underside ? .97 : scaled ? .46 : .76, metalness: id === 'starhide' && !underside ? .15 : 0 });
  return m;
}
function geometry(p: number[], uv: number[], idx: number[], colors?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); return g;
}
function add(root: THREE.Group, name: string, geo: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const m = new THREE.Mesh(geo, material); m.name = name; m.castShadow = true; m.receiveShadow = true; root.add(m); return m;
}
type Surface = { point: (u: number, v: number) => THREE.Vector3; normal: (u: number, v: number) => THREE.Vector3 };
type Fold = { width: number; thick: number; rag: number; path: number[][]; shift?: number; tilt?: number; flip?: boolean; natural?: 'bramble' | 'char'; rolled?: boolean };
// A continuous bent sheet, with distinct grain, flesh, and closed cut-edge faces.
// The path travels around genuine U bends, leaving inspectable air between folds.
function sheet(root: THREE.Group, name: string, f: Fold, front: THREE.Material, back: THREE.Material, edge: THREE.Material): Surface {
  const curve = new THREE.CatmullRomCurve3(f.path.map(p => new THREE.Vector3(0, p[1]!, p[0]!)), false, 'centripetal');
  const point = (u: number, v: number): THREE.Vector3 => {
    const p = curve.getPoint(Math.max(0, Math.min(1, v))), t = u * 2 - 1;
    const rag = f.rag * (Math.sin(v * 39 + 1) + .52 * Math.sin(v * 91) + .23 * Math.sin(v * 193));
    p.x = t * (f.width / 2 + rag) + (f.shift ?? 0) + .01 * Math.sin(v * 7);
    p.y += .014 * Math.sin(u * 7 + v * 12) + .008 * Math.sin(u * 18 - v * 25) * t * t + (f.tilt ?? 0) * t;
    p.z += .016 * Math.sin(u * 10 + v * 4) * (Math.abs(v - .5) * 2) ** 5;
    if (f.natural) {
      const side = Math.sign(t), end = Math.abs(v - .5) * 2;
      const lobe = .04 * Math.sin(v * 15 + side * 1.2) + .023 * Math.sin(v * 29 - side * .7);
      p.x += t * lobe + .014 * Math.sin(v * 9);
      p.z += end ** 7 * (.041 * Math.sin(u * 14 + v * 2) + .023 * Math.sin(u * 27 + 1));
      p.y += .033 * Math.sin(v * 22 + u * 4) * Math.abs(t) ** 4;
      // Broad diagonal pressure folds reach the lobed free perimeter.
      p.y += .018 * Math.exp(-(((v - .79 + .13 * t) / .042) ** 2)) - .013 * Math.exp(-(((v - .84 + .13 * t) / .019) ** 2));
      if (f.natural === 'char') p.y += .015 * Math.sin(u * 12) * end ** 5;
    }
    if (f.rolled) {
      p.y += .011 * Math.cos(u * 5 + v * 3);
      p.z += .025 * t * t * Math.sin(v * Math.PI * 2);
    }
    return p;
  };
  const normal = (u: number, v: number) => point(Math.min(1, u + .001), v).sub(point(Math.max(0, u - .001), v)).cross(point(u, Math.min(1, v + .001)).sub(point(u, Math.max(0, v - .001)))).normalize().multiplyScalar(f.flip ? -1 : 1);
  const p: number[] = [], uv: number[] = [], idx: number[] = [], nu = 26, nv = 120, count = (nu + 1) * (nv + 1);
  for (let side = 0; side < 2; side++) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, q = point(u, v).addScaledVector(normal(u, v), (side === 0 ? 1 : -1) * f.thick / 2);
    p.push(q.x, q.y, q.z); uv.push(u, v);
  }
  for (let side = 0; side < 2; side++) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = side * count + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (side === 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
  }
  const edgeStart = idx.length;
  const rim: number[] = [];
  for (let i = 0; i <= nu; i++) rim.push(i);
  for (let j = 1; j <= nv; j++) rim.push(j * (nu + 1) + nu);
  for (let i = nu - 1; i >= 0; i--) rim.push(nv * (nu + 1) + i);
  for (let j = nv - 1; j > 0; j--) rim.push(j * (nu + 1));
  for (let k = 0; k < rim.length; k++) { const a = rim[k]!, b = rim[(k + 1) % rim.length]!; idx.push(a, a + count, b + count, a, b + count, b); }
  if (f.flip) for (let k = 0; k < idx.length; k += 3) { const b = idx[k + 1]!; idx[k + 1] = idx[k + 2]!; idx[k + 2] = b; }
  const g = geometry(p, uv, idx); g.addGroup(0, nu * nv * 6, 0); g.addGroup(nu * nv * 6, nu * nv * 6, 1); g.addGroup(edgeStart, idx.length - edgeStart, 2);
  add(root, name, g, [front, back, edge]); return { point, normal };
}
function fur(root: THREE.Group, s: Surface, id: Id, edgeOnly: boolean): void {
  const p: number[] = [], uv: number[] = [], idx: number[] = [], colors: number[] = [];
  const count = edgeOnly ? 1250 : 4200;
  for (let i = 0; i < count; i++) {
    let u = hash(i * 11 + 3), v = hash(i * 17 + 9);
    if (edgeOnly) { if (i % 2 === 0) u = i % 4 === 0 ? u * .045 : 1 - u * .045; else v = i % 4 === 1 ? v * .025 : 1 - v * .025; }
    const n = s.normal(u, v), q = s.point(u, v).addScaledVector(n, .004);
    const length = (edgeOnly ? .009 : .018) * (.6 + hash(i + 43));
    const along = s.point(u, Math.min(1, v + .005)).sub(s.point(u, Math.max(0, v - .005))).normalize();
    const across = new THREE.Vector3(1, 0, 0), width = edgeOnly ? .0008 : .0017;
    const tip = q.clone().addScaledVector(n, length * .6).addScaledVector(along, length);
    const verts = [q.clone().addScaledVector(across, -width), q.clone().addScaledVector(across, width), q.clone().addScaledVector(n, width), tip];
    const offset = p.length / 3, patch = Math.max(0, Math.sin(u * 11 + 1.1 * Math.sin(v * 9)));
    const c = new THREE.Color(id === 'cairn_pelt' ? '#e0d9c9' : '#c7aa7b');
    if (id === 'cairn_pelt') c.lerp(new THREE.Color('#646362'), patch * .87);
    c.multiplyScalar(.82 + hash(i + 21) * .28);
    for (const a of verts) { p.push(a.x, a.y, a.z); uv.push(u, v); colors.push(c.r, c.g, c.b); }
    idx.push(offset, offset + 1, offset + 3, offset + 1, offset + 2, offset + 3, offset + 2, offset, offset + 3, offset + 2, offset + 1, offset);
  }
  add(root, edgeOnly ? 'Individual torn edge fibers' : 'Directional silver and cream guardhair tufts', geometry(p, uv, idx, colors), new THREE.MeshStandardMaterial({ name: 'Matte tapered natural hair', vertexColors: true, roughness: 1 }));
}
function scales(root: THREE.Group, s: Surface, star: boolean, material: THREE.Material): void {
  const p: number[] = [], uv: number[] = [], idx: number[] = [];
  const rows = star ? 12 : 20, cols = star ? 2 : 4;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = .78 + c * .055 + (r % 2) * .018, v = .47 + r / rows * .49;
    const du = star ? .082 : .044, dv = star ? .057 : .035;
    const outline = [[-du, -dv * .4], [-du * .87, dv * .36], [0, dv], [du * .87, dv * .36], [du, -dv * .4]];
    const start = p.length / 3;
    for (let side = 0; side < 2; side++) {
      for (const [a, b] of outline) {
        const x = Math.min(.998, Math.max(.002, u + a!)), y = Math.min(.998, v + b!);
        const q = s.point(x, y).addScaledVector(s.normal(x, y), .006 + side * .002 + Math.max(0, b!) * .12);
        p.push(q.x, q.y, q.z); uv.push(x, y);
      }
      const q = s.point(u, v).addScaledVector(s.normal(u, v), .006 + side * .008); p.push(q.x, q.y, q.z); uv.push(u, v);
      for (let k = 0; k < 5; k++) { const a = start + side * 6 + k, b = start + side * 6 + (k + 1) % 5, mid = start + side * 6 + 5; if (side) idx.push(a, mid, b); else idx.push(a, b, mid); }
    }
    for (let k = 0; k < 5; k++) { const a = start + k, b = start + (k + 1) % 5; idx.push(a, a + 6, b + 6, a, b + 6, b); }
  }
  add(root, star ? 'Large overlapping violet dorsal scutes' : 'Overlapping copper dragon flank scales', geometry(p, uv, idx), material);
}
function fleece(root: THREE.Group): void {
  const woolMap = tex('Natural cream fleece fine crimped fibers', (u, v) => {
    const strand = Math.sin(v * 870 + Math.sin(u * 52) * 3) * 7;
    const grain = hash(Math.floor(u * 512) * 31 + Math.floor(v * 512)) * 16;
    return [215 + strand + grain, 200 + strand + grain, 173 + strand + grain];
  });
  const wool = new THREE.MeshStandardMaterial({ name: 'Cream wool fiber bundles', map: woolMap, roughness: 1 });
  const p: number[] = [], uv: number[] = [], idx: number[] = [];
  const lock = (points: THREE.Vector3[], radius: number, seed: number, steps: number, sides: number) => {
    const curve = new THREE.CatmullRomCurve3(points), frames = curve.computeFrenetFrames(steps, false), start = p.length / 3;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, center = curve.getPoint(t), n = frames.normals[j]!, b = frames.binormals[j]!;
      const taper = .12 + .88 * Math.sin(Math.PI * t) ** .48;
      for (let k = 0; k < sides; k++) {
        const a = k / sides * TAU, irregular = 1 + .14 * Math.sin(t * 21 + a * 3 + seed) + .055 * Math.sin(t * 57 - a * 5);
        const q = center.clone().addScaledVector(n, Math.cos(a) * radius * taper * irregular).addScaledVector(b, Math.sin(a) * radius * taper * irregular * .83);
        p.push(q.x, q.y, q.z); uv.push(t, k / sides);
      }
    }
    for (let j = 0; j < steps; j++) for (let k = 0; k < sides; k++) {
      const a = start + j * sides + k, b = start + j * sides + (k + 1) % sides; idx.push(a, b, b + sides, a, b + sides, a + sides);
    }
    for (let k = 1; k < sides - 1; k++) { idx.push(start, start + k + 1, start + k); const end = start + steps * sides; idx.push(end, end + k, end + k + 1); }
  };
  // Overlapping long, bent fiber bundles form the volume. There is no egg shell.
  const centers: THREE.Vector3[] = [], directions: THREE.Vector3[] = [];
  for (let k = 0; k < 44; k++) {
    const a = k * 2.39996, radial = Math.sqrt((k + .5) / 44), z = Math.sin(a) * .22 * radial;
    const center = new THREE.Vector3(Math.cos(a) * .16 * radial + .038 * Math.sin(z * 15), .074 + .035 * hash(k + 31) + .032 * (1 - radial), z);
    const angle = .3 + hash(k + 99) * 1.7, dir = new THREE.Vector3(Math.cos(angle), .1 * Math.sin(k), Math.sin(angle));
    const length = .095 + .12 * hash(k + 151), radius = .024 + .023 * hash(k + 173);
    centers.push(center); directions.push(dir);
    const points: THREE.Vector3[] = [];
    for (let j = 0; j <= 7; j++) {
      const t = j / 7, q = center.clone().addScaledVector(dir, (t - .5) * length);
      q.y += .027 * Math.sin(t * Math.PI) + .012 * Math.sin(t * TAU + k); q.x += .013 * Math.sin(t * TAU + k); points.push(q);
    }
    lock(points, radius, k, 14, 10);
  }
  // Shorter loose corkscrews lie across the bundles at varied angles and pitches.
  for (let k = 0; k < 135; k++) {
    const index = k % centers.length, center = centers[index]!.clone(), dir = directions[index]!;
    const side = new THREE.Vector3(-dir.z, 0, dir.x), low = k % 6 === 0;
    center.addScaledVector(dir, (hash(k + 7) - .5) * .11).addScaledVector(side, (hash(k + 15) - .5) * .066);
    center.y += low ? -.046 : .035;
    const points: THREE.Vector3[] = [], length = .033 + hash(k + 321) * .091, loops = .4 + hash(k + 451) * 1.65, rad = .005 + hash(k + 511) * .009;
    for (let j = 0; j <= 18; j++) {
      const t = j / 18, phase = t * TAU * loops + k, q = center.clone().addScaledVector(dir, (t - .5) * length).addScaledVector(side, Math.sin(phase) * rad * (1 - t * .3));
      q.y += Math.cos(phase) * rad + .006 * Math.sin(t * Math.PI); points.push(q);
    }
    lock(points, .003 + hash(k + 691) * .004, k + 80, 20, 5);
  }
  // Loose thin wisps break the border and continue onto the underside.
  for (let k = 0; k < 230; k++) {
    const center = centers[k % centers.length]!.clone(), dir = directions[k % directions.length]!, side = new THREE.Vector3(-dir.z, 0, dir.x);
    center.addScaledVector(dir, (hash(k + 92) - .5) * .13).addScaledVector(side, (hash(k + 253) - .5) * .073); center.y += k % 5 === 0 ? -.04 : .043;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 4; j++) { const t = j / 4, q = center.clone().addScaledVector(dir, t * (.018 + hash(k) * .027)).addScaledVector(side, .004 * Math.sin(t * TAU + k)); q.y += .012 * Math.sin(t * Math.PI); pts.push(q); }
    lock(pts, .0007, k, 7, 3);
  }
  add(root, 'Loose fleece clumps with varied crimp and stray fibers', geometry(p, uv, idx), wool);
}
export const author: ItemModelAuthor = {
  ids,
  build(itemId: string): THREE.Group {
    if (!ids.includes(itemId as Id)) throw new Error(`Unknown raw hide ${itemId}`);
    const id = itemId as Id, root = new THREE.Group(); root.name = `${id} folded natural material`;
    root.userData.itemModel = { itemId, author: 'raw-hides', reference: `art/item-icons/generated/${itemId}.png`, description: descriptions[id] };
    if (id === 'bighorn_fleece') { fleece(root); return root; }
    const front = mat(id), back = mat(id, true), edge = new THREE.MeshStandardMaterial({ name: `${id} exposed cut fibers`, color: id === 'charhide' ? '#8b8071' : id === 'starhide' ? '#77718b' : '#b89b76', roughness: .95 });
    if (id === 'tapir_leather') {
      for (let i = 0; i < 3; i++) {
        const y = i * .075, z = i * -.026;
        const s = sheet(root, `Separate thick rolled flank strip ${i + 1}`, { width: .42 - i * .012, thick: .0075, rag: .0018, rolled: true, shift: (i - 1) * .019, tilt: i === 1 ? -.007 : .005, path: [[.125 + z, .041 + y], [.18 + z, .023 + y], [.23 + z, .049 + y], [.21 + z, .095 + y], [.11 + z, .102 + y], [-.15 + z, .094 + y], [-.21 + z, .073 + y], [-.208 + z, .029 + y], [-.155 + z, .016 + y], [.12 + z, .009 + y]] }, front, back, edge);
        fur(root, s, id, true);
      }
      return root;
    }
    const configs: Record<Exclude<Id, 'tapir_leather' | 'bighorn_fleece'>, Fold> = {
      coarse_hide: { flip: true, width: .53, thick: .004, rag: .014, path: [[.23, .02], [-.19, .025], [-.25, .075], [-.18, .115], [.22, .14], [.27, .104]] },
      bramble_hide: { natural: 'bramble', width: .48, thick: .007, rag: .007, path: [[.19, .025], [-.13, .023], [-.23, .05], [-.235, .091], [-.18, .121], [.12, .118], [.225, .128], [.25, .175], [.18, .204], [.01, .198], [-.21, .17], [-.27, .116]] },
      cairn_pelt: { flip: true, width: .56, thick: .005, rag: .011, path: [[.20, .022], [-.22, .035], [-.24, .09], [-.19, .147], [.23, .16], [.27, .125]] },
      charhide: { natural: 'char', width: .51, thick: .008, rag: .014, tilt: .012, path: [[.12, .072], [.16, .052], [.197, .078], [.186, .122], [.132, .139], [.078, .10], [.094, .043], [.19, .027], [.256, .084], [.223, .177], [.13, .203], [-.12, .176], [-.25, .115]] },
      dragonhide: { width: .49, thick: .005, rag: .004, path: [[.23, .019], [-.18, .021], [-.235, .057], [-.19, .091], [.17, .096], [.22, .126], [.17, .159], [-.18, .173]] },
      starhide: { flip: true, width: .49, thick: .005, rag: .0027, tilt: -.006, path: [[.20, .02], [-.18, .026], [-.22, .053], [-.18, .08], [.17, .081], [.215, .11], [.17, .136], [-.17, .139], [-.22, .165], [-.17, .19], [.20, .196]] },
    };
    const s = sheet(root, 'Continuous folded hide with enclosed flesh thickness', configs[id], front, back, edge);
    if (id === 'coarse_hide' || id === 'bramble_hide' || id === 'cairn_pelt') fur(root, s, id, id !== 'cairn_pelt');
    if (id === 'dragonhide' || id === 'starhide') {
      const scute = front.clone(); scute.name = `${id} raised polished scutes`; scute.color.set(id === 'starhide' ? '#ada0d4' : '#dfaa83'); scute.roughness = .4;
      scales(root, s, id === 'starhide', scute);
    }
    if (id === 'bramble_hide') {
      const thorn = new THREE.MeshStandardMaterial({ name: 'Old ochre bramble thorns', color: '#7e6c3e', roughness: .78 });
      for (let i = 0; i < 2; i++) {
        const v = .69 + i * .23, p = s.point(.985, v), n = new THREE.Vector3(.9, .05, .3 - i * .4).normalize();
        const m = add(root, `Embedded thorn ${i + 1}`, new THREE.ConeGeometry(.009, .072, 9), thorn); m.position.copy(p).addScaledVector(n, .024); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      }
    }
    if (id === 'coarse_hide') {
      const salt = new THREE.MeshStandardMaterial({ name: 'Dry irregular salt crystals', color: '#e7decb', roughness: .86 });
      const crystal = new THREE.OctahedronGeometry(.0016, 0);
      for (let i = 0; i < 180; i++) {
        const u = hash(i + 111), v = .55 + hash(i + 331) * .43;
        if (u > .16 && u < .86 && i % 4 !== 0) continue;
        const m = add(root, `Salt flake ${i}`, crystal, salt); m.position.copy(s.point(u, v)).addScaledVector(s.normal(u, v), .004); m.rotation.set(i * .7, i * .2, i * .9); m.scale.setScalar(.6 + hash(i + 88));
      }
    }
    return root;
  },
};


