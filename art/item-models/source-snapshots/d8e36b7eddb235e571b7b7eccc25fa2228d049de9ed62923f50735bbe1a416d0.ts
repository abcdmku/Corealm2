import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type XY = [number, number];
const ids = ['palewood_shield', 'duskoak_shield', 'cairnpine_shield', 'cinderpine_shield', 'teak_shield', 'magic_shield', 'ashseal_guard'] as const;
const descriptions = [
  'Planks of pale march wood banded at the rim. It stops a claw once.',
  'Laminated ash over an Iron boss. Heavy enough to lean on.',
  'Oak faced in Cobalt. It rings when a bear hits it, and the bear stops.',
  'Layered walnut faced in Titanium. Built to withstand heavy blows.',
  'Layered teak faced in Cindersteel.',
  'Layered magic wood faced in Nightglass.',
  "The Ashseal Warden's iron spread across a Teak Shield. A heavy guard for close fighting.",
];
const hash = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };

function material(name: string, color: number, metal: number, wood = false): THREE.MeshStandardMaterial {
  const n = 256, a = new Uint8Array(n * n * 4), r = new Uint8Array(n * n * 4), normal = new Uint8Array(n * n * 4);
  const base = new THREE.Color(color);
  // Grain meanders around elliptical knots; roughness and gentle normals are independent of albedo.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    const knot = Math.exp(-((x - 83) ** 2 / 320 + (y - 168) ** 2 / 1600));
    const phase = x * .46 + Math.sin(y * .023) * 1.5 + knot * 13;
    const grain = Math.sin(phase) * .07 + Math.sin(phase * 3.1) * .04;
    const dent = Math.sin(x * .18 + Math.sin(y * .11)) * Math.cos(y * .2 + Math.cos(x * .08));
    const v = wood ? .84 + grain - knot * .22 + hash(x, y) * .08 : .85 + dent * .055 + hash(x, y) * .13;
    const rgb = base.clone().multiplyScalar(v).convertLinearToSRGB();
    a.set([rgb.r * 255, rgb.g * 255, rgb.b * 255, 255], i);
    const rough = wood ? 181 + hash(x, y) * 28 : 116 + dent * 15 + hash(x, y) * 20;
    r.set([rough, rough, rough, 255], i);
    normal.set([128 + (wood ? Math.cos(phase) * 9 : Math.cos(x * .18) * 5), 128 + (wood ? Math.sin(y * .06) * 2 : Math.sin(y * .2) * 5), 254, 255], i);
  }
  const tex = (data: Uint8Array, suffix: string, srgb = false) => {
    const t = new THREE.DataTexture(data, n, n); t.name = name + suffix;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; return t;
  };
  const m = new THREE.MeshStandardMaterial({ map: tex(a, '-color', true), roughnessMap: tex(r, '-roughness'), normalMap: tex(normal, '-normal'), metalness: metal, roughness: 1 });
  m.name = name; return m;
}

function mesh(g: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.name = name; g.add(m); return m;
}
// The curved laminate is 32 mm thick. Its rear centre sits 72 mm in front of the grip.
const bow = (x: number, y: number) => .104 - .36 * x * x - .028 * y * y;
function solid(g: THREE.Group, name: string, p: XY[], mat: THREE.Material, offset = 0, depth = .032): void {
  const v: number[] = [], uv: number[] = [];
  const vertex = (q: XY, z: number) => { v.push(q[0], q[1], bow(...q) + z); uv.push(q[0] * 2 + .5, q[1] + .5); };
  const tri = (a: XY, b: XY, c: XY, z: number, back: boolean, level: number) => {
    if (level) {
      const ab: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc: XY = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca: XY = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      tri(a, ab, ca, z, back, level - 1); tri(ab, b, bc, z, back, level - 1); tri(ca, bc, c, z, back, level - 1); tri(ab, bc, ca, z, back, level - 1); return;
    }
    vertex(a, z); vertex(back ? c : b, z); vertex(back ? b : c, z);
  };
  const pts = p.map(q => new THREE.Vector2(...q));
  if (THREE.ShapeUtils.isClockWise(pts)) p = [...p].reverse();
  const faces = THREE.ShapeUtils.triangulateShape(p.map(q => new THREE.Vector2(...q)), []);
  for (const f of faces) { tri(p[f[0]!]!, p[f[1]!]!, p[f[2]!]!, offset, false, 2); tri(p[f[0]!]!, p[f[1]!]!, p[f[2]!]!, offset - depth, true, 2); }
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    vertex(a, offset); vertex(a, offset - depth); vertex(b, offset);
    vertex(b, offset); vertex(a, offset - depth); vertex(b, offset - depth);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals(); mesh(g, name, geo, mat);
}
function line(g: THREE.Group, name: string, p: THREE.Vector3[], radius: number, mat: THREE.Material): void {
  mesh(g, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), Math.max(12, p.length * 4), radius, 7, false), mat);
}
function trim(g: THREE.Group, name: string, p: XY[], mat: THREE.Material, offset = .007, radius = .002): void {
  line(g, name, p.map(q => new THREE.Vector3(q[0], q[1], bow(...q) + offset)), radius, mat);
}
function ring(g: THREE.Group, p: XY[], scale: number, mat: THREE.Material, edge: THREE.Material): void {
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    solid(g, 'rim-forged-segment-' + i, [a, b, [b[0] * scale, b[1] * scale], [a[0] * scale, a[1] * scale]], mat, .008, .047);
  }
  trim(g, 'rim-outer-rolled-edge', [...p, p[0]!], edge, .01, .0028);
  trim(g, 'rim-inner-beveled-edge', [...p, p[0]!].map(q => [q[0] * scale, q[1] * scale]), edge, .01, .002);
}
function rivet(g: THREE.Group, name: string, x: number, y: number, mat: THREE.Material, size = .009, offset = .017): void {
  const m = mesh(g, name, new THREE.SphereGeometry(size, 12, 7), mat); m.scale.z = .65; m.position.set(x, y, bow(x, y) + offset);
}
function clip(p: XY[], x: number, keepRight: boolean): XY[] {
  const out: XY[] = []; for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!, ia = keepRight ? a[0] >= x : a[0] <= x, ib = keepRight ? b[0] >= x : b[0] <= x;
    if (ia) out.push(a); if (ia !== ib) out.push([x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])]);
  } return out;
}
function outline(kind: number, w: number, h: number): XY[] {
  if (kind < 2) return Array.from({ length: 64 }, (_, i) => [Math.cos(i * Math.PI / 32) * w, Math.sin(i * Math.PI / 32) * h]);
  const s = new THREE.Shape();
  if (kind === 6) { s.moveTo(-.72, 1); s.lineTo(.72, 1); s.lineTo(1, .78); s.lineTo(1, -.42); s.bezierCurveTo(.95, -.73, .5, -.97, 0, -1.09); s.bezierCurveTo(-.5, -.97, -.95, -.73, -1, -.42); s.lineTo(-1, .78); s.closePath(); }
  else if (kind === 5) { s.moveTo(0, 1.06); s.bezierCurveTo(.23, .58, .82, .62, 1, 1); s.bezierCurveTo(1.18, .35, .92, -.56, 0, -1.05); s.bezierCurveTo(-.92, -.56, -1.18, .35, -1, 1); s.bezierCurveTo(-.82, .62, -.23, .58, 0, 1.06); }
  else { s.moveTo(0, 1); if (kind === 3) s.lineTo(1, .73); else s.quadraticCurveTo(.45, .78, 1, .72); s.bezierCurveTo(1.02, -.08, .79, -.62, 0, -1); s.bezierCurveTo(-.79, -.62, -1.02, -.08, -1, .72); if (kind === 3) s.lineTo(0, 1); else s.quadraticCurveTo(-.45, .78, 0, 1); }
  const points = s.getPoints(10); if (points[0]!.distanceTo(points[points.length - 1]!) < .001) points.pop();
  return points.map(p => [p.x * w, p.y * h]);
}
function back(g: THREE.Group, w: number, h: number, wood: THREE.Material, iron: THREE.Material, leather: THREE.Material, edge: THREE.Material): void {
  for (const y of [-h * .43, h * .43]) {
    solid(g, 'rear-crossgrain-batten', [[-w * .72, y - .022], [w * .72, y - .022], [w * .72, y + .022], [-w * .72, y + .022]], wood, -.032, .015);
    for (const x of [-w * .61, w * .61]) rivet(g, 'rear-batten-peened-rivet', x, y, iron, .007, -.05);
  }
  // A forged bridge joins two through-bolted shoes; the leather-covered span is the measured grip.
  for (const x of [-.085, .085]) {
    solid(g, 'handle-through-bolted-shoe', [[x - .021, -.037], [x + .021, -.037], [x + .021, .037], [x - .021, .037]], iron, -.035, .012);
    for (const y of [-.024, .024]) rivet(g, 'handle-shoe-rivet', x, y, edge, .006, -.049);
  }
  line(g, 'rear-attached-forged-grip-bridge', [new THREE.Vector3(-.085, 0, bow(-.085, 0) - .046), new THREE.Vector3(-.081, 0, .017), new THREE.Vector3(-.055, 0, 0), new THREE.Vector3(.055, 0, 0), new THREE.Vector3(.081, 0, .017), new THREE.Vector3(.085, 0, bow(.085, 0) - .046)], .01, iron);
  const handle = mesh(g, 'leather-hand-grip-centered-at-origin', new THREE.CylinderGeometry(.014, .014, .112, 14), leather); handle.rotation.z = Math.PI / 2;
  for (let i = 0; i < 13; i++) {
    const wrap = mesh(g, 'grip-leather-wrap-seam-' + i, new THREE.TorusGeometry(.0142, .0008, 4, 14), leather); wrap.rotation.y = Math.PI / 2; wrap.position.x = -.05 + i * .0083;
  }
  // Thick flat enarme loop, both ends bolted to the laminate, with a real air gap for the forearm.
  const x = w * .48, nodes = 28, verts: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nodes; i++) {
    const t = i / nodes, y = -.13 + t * .26, z = bow(x, y) - .047 - Math.sin(t * Math.PI) * .077;
    for (const [dx, dz] of [[-.019, 0], [.019, 0], [-.019, -.006], [.019, -.006]]) verts.push(x + dx!, y, z + dz!);
  }
  for (let i = 0; i < nodes; i++) { const a = i * 4, b = a + 4; for (const [j, k] of [[0, 1], [1, 3], [3, 2], [2, 0]]) idx.push(a + j!, b + j!, a + k!, a + k!, b + j!, b + k!); }
  idx.push(0, 1, 2, 1, 3, 2, nodes * 4, nodes * 4 + 2, nodes * 4 + 1, nodes * 4 + 1, nodes * 4 + 2, nodes * 4 + 3);
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2]!, idx[i + 1]!];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx); geo.computeVertexNormals(); mesh(g, 'rear-leather-enarme-solid-loop', geo, leather);
  for (const y of [-.13, .13]) rivet(g, 'enarmee-through-rivet', x, y, edge, .008, -.055);
  const buckle = [[x - .023, -.09], [x + .023, -.09], [x + .023, -.064], [x - .023, -.064], [x - .023, -.09]].map(q => new THREE.Vector3(q[0]!, q[1]!, bow(x, q[1]!) - .055 - Math.sin((q[1]! + .13) / .26 * Math.PI) * .077));
  line(g, 'rear-enarme-buckle', buckle, .0025, iron);
}
function boss(g: THREE.Group, mat: THREE.Material, edge: THREE.Material, radius: number): void {
  const points: XY[] = Array.from({ length: 48 }, (_, i) => [Math.cos(i / 48 * Math.PI * 2) * radius, Math.sin(i / 48 * Math.PI * 2) * radius]);
  solid(g, 'boss-riveted-flange', points, mat, .017, .012);
  const dome = mesh(g, 'hollow-hammered-boss-dome', new THREE.SphereGeometry(radius * .76, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.rotation.x = Math.PI / 2; dome.scale.y = .62; dome.position.z = .127;
  // Closed backing cup is visible on the reverse of the laminated shield.
  for (let i = 0; i < 8; i++) rivet(g, 'boss-flange-rivet-' + i, Math.cos(i * Math.PI / 4) * radius * .89, Math.sin(i * Math.PI / 4) * radius * .89, edge, .007, .025);
  trim(g, 'boss-flange-edge', [...points, points[0]!], edge, .019, .002);
}

export const author: ItemModelAuthor = {
  ids,
  build(id) {
    const k = ids.indexOf(id as typeof ids[number]); if (k < 0) throw new Error('Unknown shield ' + id);
    const g = new THREE.Group(); g.name = id;
    g.userData.itemModel = { itemId: id, author: 'shields', reference: `art/item-icons/generated/${id}.png`, description: descriptions[k]!, grip: [0, 0, 0] };
    const w = [ .29, .275, .31, .30, .31, .32, .31 ][k]!, h = [.325, .43, .45, .47, .45, .46, .43][k]!;
    const wood = material(['pale-pine', 'grey-ash', 'golden-oak', 'dark-walnut', 'oiled-teak', 'purple-magic-wood', 'scarred-teak'][k]!, [0xc3a16b, 0x867660, 0x96632e, 0x493025, 0x9e642b, 0x633b89, 0x955f28][k]!, 0, true);
    // The oxide-coated faces retain diffuse colour under outdoor hemisphere light.
    // Texture bytes are already sRGB; converting them a second time would wash out the grain.
    const revised = k === 2 || k === 3 || k === 5;
    const iron = material('forged-shield-metal', [0x373636, 0x444343, 0x367ac6, 0xd7d9d8, 0x38342f, 0x35364f, 0x393632][k]!, revised ? (k === 5 ? .42 : .35) : .88);
    const edge = material('worn-polished-edges', revised ? 0xd2d5df : k === 4 ? 0x786347 : 0x8b8983, revised ? .42 : .9);
    const leather = material('rear-oiled-leather', 0x291910, 0, true);
    const brass = material('rivet-bronze', 0x8a7554, .82);
    const p = outline(k, w, h);
    for (let i = 0; i < 7; i++) {
      const left = -w * 1.2 + i * w * 2.4 / 7, right = -w * 1.2 + (i + 1) * w * 2.4 / 7;
      const plank = clip(clip(p, left + .0008, true), right - .0008, false);
      if (plank.length > 2) solid(g, 'separate-laminated-plank-' + i, plank, wood);
    }
    ring(g, p, k < 2 ? .88 : .89, iron, edge);
    // Rivets follow the actual perimeter at roughly equal arc-length intervals.
    let distance = 0; const spacing = k < 2 ? .14 : .135;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!, b = p[(i + 1) % p.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (distance < len) { const t = distance / len; if (k !== 5) rivet(g, 'rim-domed-rivet', (a[0] + (b[0] - a[0]) * t) * .945, (a[1] + (b[1] - a[1]) * t) * .945, k === 2 ? brass : edge); distance += spacing; } distance -= len;
    }
    if (k === 1) {
      for (const x of [-w * .43, w * .43]) { const y = h * .84; solid(g, 'vertical-iron-binding', [[x - .018, -y], [x + .018, -y], [x + .018, y], [x - .018, y]], iron, .008, .012); for (const yy of [-y * .78, y * .78]) rivet(g, 'binding-rivet', x, yy, edge); }
      boss(g, iron, edge, .103);
    }
    if (k === 2 || k === 3) {
      for (const side of [-1, 1]) {
        const panel: XY[] = k === 2 ? [[.055, .79], [.76, .59], [.75, .12], [.64, -.39], [.40, -.64], [.07, -.83]] : [[.17, .80], [.78, .62], [.79, .10], [.64, -.10], [.49, -.47], [.09, -.79], [.09, .66]];
        const q: XY[] = panel.map(([x, y]) => [x * w * side, y * h]); solid(g, 'raised-metal-facing-' + side, q, iron, .012, .016); trim(g, 'facing-beveled-border-' + side, [...q, q[0]!], edge, .015, .0025);
        if (k === 2) {
          const inset: XY[] = q.map(([x, y]) => [x * .93 + side * .005, y * .955]);
          trim(g, 'cobalt-inner-engraved-border', [...inset, inset[0]!], edge, .016, .0014);
          for (const yy of [.48, -.54]) { const filigree: XY[] = []; for (let j = 0; j <= 32; j++) { const a = j / 32 * Math.PI * 2.4, r = .025 * (1 - j / 40); filigree.push([side * (.19 + Math.cos(a) * r), yy * h + Math.sin(a) * r]); } trim(g, 'cobalt-silver-scroll', filigree, edge, .018, .0022); }
        }
      }
      solid(g, 'central-ridged-spine', [[0, h * .93], [.02, h * .77], [.017, -h * .82], [0, -h * .94], [-.017, -h * .82], [-.02, h * .77]], iron, .024, .022);
      trim(g, 'spine-highlight', [[0, h * .92], [0, -h * .93]], edge, .026, .002);
      if (k === 2) for (const y of [-.86, -.31, .30, .82]) { solid(g, 'diamond-rivet-seat', [[0, y * h + .028], [.021, y * h], [0, y * h - .028], [-.021, y * h]], edge, .026, .006); rivet(g, 'spine-bronze-stud', 0, y * h, brass, .009, .034); }
    }
    if (k === 4) {
      for (const side of [-1, 1]) {
        const q: XY[] = [[.27, .61], [.78, .39], [.81, .18], [.43, -.01], [.34, -.40], [.15, -.48], [.15, .45]].map(([x, y]) => [x! * w * side, y! * h]);
        solid(g, 'angular-cindersteel-wing', q, iron, .018, .021); trim(g, 'wing-beveled-edge', [...q, q[0]!], edge, .021, .002);
        const lower: XY[] = [[.81, .10], [.45, -.07], [.44, -.30], [.76, -.19]].map(([x, y]) => [x! * w * side, y! * h]); solid(g, 'separate-side-cheek', lower, iron, .015, .014); trim(g, 'cheek-edge', [...lower, lower[0]!], edge, .018, .002);
      }
      solid(g, 'broad-central-spine', [[0, h * .87], [.053, h * .72], [.043, -h * .68], [0, -h * .9], [-.043, -h * .68], [-.053, h * .72]], iron, .031, .036);
      trim(g, 'central-spine-ridge', [[0, h * .86], [0, -h * .89]], edge, .035, .003);
      for (const x of [-.037, .037]) for (const y of [-.19, .02, .32]) rivet(g, 'spine-rivet', x, y, edge, .007, .038);
    }
    if (k === 6) {
      solid(g, 'ashseal-vertical-iron-cross', [[-.032, h * .97], [.032, h * .97], [.032, .22], [.062, .17], [.07, -.17], [.034, -.22], [.034, -h], [-.034, -h], [-.034, -.22], [-.07, -.17], [-.062, .17], [-.032, .22]], iron, .015, .021);
      solid(g, 'ashseal-horizontal-iron-cross', [[-w * .90, .072], [-.13, .088], [0, .145], [.13, .088], [w * .90, .072], [w * .90, -.065], [.13, -.083], [0, -.143], [-.13, -.083], [-w * .90, -.065]], iron, .013, .022);
      for (const y of [-.30, -.18, .20, .34]) rivet(g, 'cross-vertical-rivet', 0, y, edge, .011, .025);
      for (const x of [-.18, .18]) rivet(g, 'cross-horizontal-rivet', x, 0, edge, .011, .025);
      boss(g, iron, edge, .129);
    }
    if (k === 5) {
      // Layered nightglass lobes leave narrow purple heartwood channels between silver ribs.
      for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
        const y = .65 - row * .49;
        const q: XY[] = [[.09, y + .02], [.47, y - .14], [.92 - row * .13, y + .13], [.87 - row * .10, y - .16], [.19, y - .67]].map(([x, yy]) => [x! * w * side, yy! * h]);
        solid(g, 'nightglass-swept-lobe-' + side + '-' + row, q, iron, .018, .021);
        trim(g, 'silver-swept-lobe-rib', [...q, q[0]!], edge, .022, .004);
      }
      const central: XY[] = [[0, h * .98], [w * .35, h * .55], [w * .20, -h * .21], [0, -h * .79], [-w * .20, -h * .21], [-w * .35, h * .55]];
      // Triangular facets create the prominent raised black crystal keel.
      const apex: THREE.Vector3 = new THREE.Vector3(0, .20, .195);
      const brightFacet = material('nightglass-silver-crystal-cleavage', 0xb9c4e0, .42);
      const violetFacet = material('nightglass-violet-crystal-cleavage', 0x676385, .38);
      for (let i = 0; i < central.length; i++) {
        const vv: number[] = [], uvs: number[] = [];
        for (const v of [new THREE.Vector3(...central[(i + 1) % central.length]!, bow(...central[(i + 1) % central.length]!) + .027), new THREE.Vector3(...central[i]!, bow(...central[i]!) + .027), apex]) { vv.push(v.x, v.y, v.z); uvs.push(v.x + .5, v.y + .5); }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vv, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.computeVertexNormals();
        mesh(g, 'faceted-nightglass-central-keel-' + i, geo, i >= 4 ? brightFacet : i === 0 ? violetFacet : iron);
      }
      solid(g, 'solid-nightglass-keel-backing', central, iron, .027, .02); trim(g, 'central-keel-silver-frame', [...central, central[0]!], edge, .031, .0035);
    }
    back(g, w, h, wood, iron, leather, edge);
    if (k === 3) {
      // Production batches by material and texture names. Titanium must not share
      // the cobalt shield's batch despite their equal roughness/metalness values.
      const named = new Set<THREE.Material>();
      g.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        const m = node.material as THREE.MeshStandardMaterial;
        if (named.has(m)) return;
        named.add(m); m.name = `${id}-${m.name}`;
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) {
          if (t) t.name = `${id}-${t.name}`;
        }
      });
    }
    return g;
  },
};
