import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// The eight approved icons were inspected individually. Empty crowns stay empty.
const ids = ['cairnpine_wand', 'cairnpine_staff', 'cinderpine_wand', 'cinderpine_staff', 'teak_wand', 'teak_staff', 'magic_wand', 'magic_staff'] as const;
const TAU = Math.PI * 2;
type V = [number, number, number];
type Kind = 'oak' | 'walnut' | 'teak' | 'magic';
function mesh(root: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material); m.name = name; m.castShadow = true; m.receiveShadow = true; root.add(m); return m;
}
function tex(name: string, fn: (u: number, v: number) => number[], srgb = true): THREE.DataTexture {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn(x / size, y / size), q = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) data[q + k] = Math.max(0, Math.min(255, c[k]!)); data[q + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.name = name; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
function materials(kind: Kind) {
  const base: Record<Kind, V> = { oak: [117, 67, 30], walnut: [100, 57, 32], teak: [166, 98, 42], magic: [87, 64, 58] };
  const c = base[kind];
  const woodMap = tex(`${kind} lengthwise grain and small pores`, (u, v) => {
    const warp = u * 32 + .32 * Math.sin(v * 16 + u * 7) + .16 * Math.sin(v * 35 + u * 12);
    const stripe = Math.pow(.5 + .5 * Math.sin(warp * TAU), 12);
    const fine = Math.sin(u * 930 + Math.sin(v * 41) * 3) * 5;
    const pore = Math.pow(Math.max(0, Math.sin(u * 1411 + v * 113) * Math.sin(v * 571)), 9) * 28;
    const burl = kind === 'magic' ? Math.sin(Math.hypot((u % .2) - .1, (v % .25) - .125) * 290) * 9 : 0;
    return c.map(n => n + fine + burl - stripe * 25 - pore + 12);
  });
  const roughMap = tex(`${kind} independent satin roughness`, (u, v) => { const n = 148 + 14 * Math.sin(u * 129 + Math.sin(v * 21)); return [n, n, n]; }, false);
  const wood = new THREE.MeshStandardMaterial({ name: `${kind} oiled carved wood`, map: woodMap, roughnessMap: roughMap, roughness: .83 });
  const metalColor = { oak: '#465666', walnut: '#a49a87', teak: '#393c40', magic: '#182539' }[kind];
  const metal = new THREE.MeshStandardMaterial({ name: `${kind === 'oak' ? 'Cobalt' : kind === 'walnut' ? 'Titanium' : kind === 'teak' ? 'Cindersteel' : 'Nightglass'} fittings`, color: metalColor, metalness: .83, roughness: kind === 'magic' ? .23 : .36 });
  const edge = new THREE.MeshStandardMaterial({ name: `${kind} worn fitting edges`, color: kind === 'teak' ? '#bb7750' : kind === 'magic' ? '#7f8ba5' : '#bdc0b8', metalness: .8, roughness: .29 });
  const leather = new THREE.MeshStandardMaterial({ name: `${kind} dark hand binding`, color: kind === 'walnut' ? '#38251e' : '#161619', roughness: .85,
    map: tex('Thread fibers', (u, v) => { const n = 160 + Math.sin(u * 900 + v * 30) * 22 + Math.sin(v * 800 - u * 21) * 12; return [n, n, n]; }) });
  const accent = new THREE.MeshStandardMaterial({ name: kind === 'magic' ? 'Muted violet Void Thread' : 'Brass attachment rivets', color: kind === 'magic' ? '#514263' : '#9c8b58', metalness: kind === 'magic' ? .1 : .75, roughness: .48 });
  return { wood, metal, edge, leather, accent };
}
// Closed, locally elliptical carved shaft. Continuous geometry underneath all bindings.
function shaft(root: THREE.Group, name: string, material: THREE.Material, lo: number, hi: number, radius: (t: number, a: number) => number, bend = 0, sides = 40): void {
  const rows = 100, p: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= sides; i++) {
    const t = j / rows, a = i / sides * TAU, r = radius(t, a);
    p.push(Math.cos(a) * r + bend * Math.sin(t * 12) * Math.sin(t * Math.PI), lo + (hi - lo) * t, Math.sin(a) * r * .94);
    uv.push(i / sides, t);
    if (i < sides && j < rows) { const q = j * (sides + 1) + i; ix.push(q, q + sides + 1, q + 1, q + 1, q + sides + 1, q + sides + 2); }
  }
  const bottom = p.length / 3; p.push(0, lo, 0, 0, hi, 0); uv.push(.5, 0, .5, 1);
  for (let i = 0; i < sides; i++) { ix.push(bottom, i, i + 1); const q = rows * (sides + 1) + i; ix.push(bottom + 1, q + 1, q); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals(); mesh(root, name, g, material);
}
function tube(root: THREE.Group, name: string, pts: V[], r: number, material: THREE.Material, segments = 64): void {
  mesh(root, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), segments, r, 6, false), material);
}
function ring(root: THREE.Group, name: string, y: number, r: number, width: number, mat: THREE.Material): void {
  const g = new THREE.TorusGeometry(r, width, 8, 40); g.rotateX(Math.PI / 2); g.translate(0, y, 0); mesh(root, name, g, mat);
}
function band(root: THREE.Group, y: number, r: number, h: number, mats: ReturnType<typeof materials>, ornate = false): void {
  const g = new THREE.CylinderGeometry(r, r, h, 40); g.translate(0, y, 0); mesh(root, 'Solid fitted metal collar', g, mats.metal);
  ring(root, 'Collar upper rolled edge', y + h / 2, r, .0014, mats.edge); ring(root, 'Collar lower rolled edge', y - h / 2, r, .0014, mats.edge);
  if (ornate) {
    for (const sign of [-1, 1]) {
      const pts: V[] = []; for (let i = 0; i <= 120; i++) { const a = i / 120 * TAU; pts.push([(r + .0007) * Math.cos(a), y + Math.sin(a * 6) * h * .32 * sign, (r + .0007) * Math.sin(a)]); }
      tube(root, 'Interlaced collar relief around front and rear', pts, .0009, mats.edge, 120);
    }
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4; const m = mesh(root, 'Peened collar fastening', new THREE.SphereGeometry(.0022, 10, 6), mats.accent); m.position.set(Math.cos(a) * r, y, Math.sin(a) * r); }
  }
}
function wrap(root: THREE.Group, lo: number, hi: number, r: number, mats: ReturnType<typeof materials>, braid = false, purple = false): void {
  const g = new THREE.CylinderGeometry(r, r, hi - lo, 32); g.translate(0, (lo + hi) / 2, 0); mesh(root, 'Continuous wrapped grip beneath crossing threads', g, mats.leather);
  const turns = Math.max(5, Math.round((hi - lo) / .006));
  for (let strand = 0; strand < (braid ? 3 : 1); strand++) {
    const pts: V[] = [], segments = turns * 10;
    for (let i = 0; i <= segments; i++) { const t = i / segments, a = t * turns * TAU + strand * .14; pts.push([Math.cos(a) * (r + .0009), lo + t * (hi - lo), Math.sin(a) * (r + .0009)]); }
    tube(root, 'Individual helical binding fiber', pts, braid ? .0011 : .0014, mats.leather, segments);
  }
  if (braid || purple) for (const sign of [-1, 1]) {
    const pts: V[] = []; for (let i = 0; i <= 180; i++) { const t = i / 180, a = sign * t * TAU * 3; pts.push([Math.cos(a) * (r + .0021), lo + t * (hi - lo), Math.sin(a) * (r + .0021)]); }
    tube(root, 'Cross laced grip thread', pts, .0011, purple ? mats.accent : mats.leather, 180);
  }
}
// A real closed, tapering blade/rib with a diamond section, not a flat silhouette.
function rib(root: THREE.Group, name: string, path: V[], widths: number[], thickness: number, mat: THREE.Material): void {
  const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p))), p: number[] = [], uv: number[] = [], ix: number[] = [], rows = 36;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, pos = curve.getPoint(t), q = t * (widths.length - 1), k = Math.min(widths.length - 2, Math.floor(q)), f = q - k, w = widths[k]! * (1 - f) + widths[k + 1]! * f;
    const tan = curve.getTangent(t), across = new THREE.Vector3(tan.y, -tan.x, 0).normalize();
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4, point = pos.clone().addScaledVector(across, Math.cos(a) * w); point.z += Math.sin(a) * thickness * Math.max(.06, Math.sin(Math.PI * (t * .9 + .07))); p.push(point.x, point.y, point.z); uv.push(i / 4, t); }
    if (j < rows) for (let i = 0; i < 4; i++) { const a = j * 4 + i, b = j * 4 + (i + 1) % 4; ix.push(a, b, a + 4, b, b + 4, a + 4); }
  }
  ix.push(0, 2, 1, 0, 3, 2); const e = rows * 4; ix.push(e, e + 1, e + 2, e, e + 2, e + 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals(); mesh(root, name, g, mat);
}
function cup(root: THREE.Group, y: number, height: number, radius: number, mats: ReturnType<typeof materials>): void {
  const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(radius * .64, 0), new THREE.Vector2(radius * .8, height * .35), new THREE.Vector2(radius, height), new THREE.Vector2(radius - .003, height), new THREE.Vector2(radius * .62, height * .22), new THREE.Vector2(0, height * .22)];
  const g = new THREE.LatheGeometry(profile, 48); g.translate(0, y, 0); mesh(root, 'Deep empty socket with wall thickness and closed inner floor', g, mats.metal);
  ring(root, 'Empty socket lip', y + height, radius - .0015, .0015, mats.edge);
}
function carving(root: THREE.Group, lo: number, hi: number, r: number, mat: THREE.Material, count = 4, turns = 1.8): void {
  for (let k = 0; k < count; k++) {
    const pts: V[] = []; for (let i = 0; i <= 100; i++) { const t = i / 100, a = k / count * TAU + t * TAU * turns; const rad = r + Math.sin(t * Math.PI) * .0015; pts.push([Math.cos(a) * rad, lo + t * (hi - lo), Math.sin(a) * rad * .94]); }
    tube(root, 'Raised continuous carved vine', pts, .0019, mat, 100);
  }
}

function build(id: string): THREE.Group {
  if (!(ids as readonly string[]).includes(id)) throw new Error(`wood-magic-b does not own ${id}`);
  const kind: Kind = id.startsWith('cairn') ? 'oak' : id.startsWith('cinder') ? 'walnut' : id.startsWith('teak') ? 'teak' : 'magic';
  const staff = id.endsWith('_staff'), root = new THREE.Group(), m = materials(kind); root.name = id;
  const canonical: Record<Kind, [string, string]> = {
    oak: ['Resin-dark oak with an empty Cobalt socket and no light of its own.', 'A two-handed oak shaft with an empty Cobalt cage. It stays dark until upgraded.'],
    walnut: ['Polished walnut with an empty Titanium socket. It stays unlit until the altar takes it.', 'A two-handed walnut shaft crowned with an empty Titanium cage, dark until charged.'],
    teak: ['Teak wrapped with Grave Thread. A fast one-handed weapon; carried Essence pays for spells.', 'Teak crowned with Cindersteel. A heavy two-handed casting weapon; carried Essence pays for spells.'],
    magic: ['Magic wrapped with Void Thread. A fast one-handed weapon; carried Essence pays for spells.', 'Magic crowned with Nightglass. A heavy two-handed casting weapon; carried Essence pays for spells.'],
  };
  root.userData.itemModel = { itemId: id, author: 'wood-magic-b', reference: `art/item-icons/generated/${id}.png`, description: canonical[kind][staff ? 1 : 0], grip: [0, 0, 0], focus: [0, staff ? 1.03 : .43, 0] };
  if (!staff) {
    const top = kind === 'magic' ? .375 : kind === 'teak' ? .39 : kind === 'walnut' ? .401 : .415;
    shaft(root, 'Carved solid wand and rounded wooden butt', m.wood, -.105, top, (t, a) => {
      const base = .021 * (1 - t) + .011 * t;
      const handle = t < .34 ? .002 * Math.sin(t * Math.PI / .34) : 0;
      const notch = kind === 'walnut' && t < .34 ? .002 * Math.cos(t * 70) : 0;
      const facets = kind === 'magic' ? .0024 * Math.sin(a * 4 + t * 22) : .0007 * Math.sin(a * 5 + t * 10);
      return base + handle + notch + facets;
    }, kind === 'magic' ? .005 : .001, kind === 'magic' ? 12 : 40);
    if (kind === 'oak') {
      carving(root, -.088, .072, .021, m.wood, 4, 1.3); carving(root, .105, .38, .014, m.wood, 3, .9);
      band(root, -.093, .023, .024, m, true); band(root, .087, .021, .026, m, true);
      cup(root, .402, .022, .016, m);
      for (const s of [-1, 1]) rib(root, 'Cobalt crescent socket claw', [[s * .01, .405, 0], [s * .025, .431, 0], [s * .018, .459, 0], [s * .008, .466, 0]], [.008, .008, .004, .0002], .007, m.metal);
      root.userData.itemModel.focus = [0, .435, 0];
    } else if (kind === 'walnut') {
      band(root, -.095, .023, .025, m); band(root, .085, .0198, .024, m, true);
      // A tilted, deep empty socket: the shaft ends beneath its floor. The dark
      // wooden lining is physically recessed, not a disk across the mouth.
      const socket = new THREE.Group(); socket.name = 'Forward tilted empty Titanium wand socket';
      socket.position.y = .397; socket.rotation.x = .44; root.add(socket);
      const profile = [[.0105, 0], [.0132, .006], [.0167, .039], [.018, .051], [.0159, .051], [.0155, .047], [.0137, .011], [.008, .004], [.0105, 0]];
      mesh(socket, 'Titanium socket shell with thin open mouth', new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r!, y!)), 64), m.metal);
      const lining = m.wood.clone(); lining.name = 'Dark recessed walnut socket lining'; lining.color.set('#665344'); lining.roughness = 1;
      const interior = [[.0155, .049], [.0153, .046], [.0135, .014], [.0107, .006], [0, .006]];
      mesh(socket, 'Deep walnut socket walls and recessed floor', new THREE.LatheGeometry(interior.map(([r, y]) => new THREE.Vector2(r!, y!)), 64), lining);
      ring(socket, 'Thin bright elliptical socket lip', .051, .01695, .00105, m.edge);
      for (let k = 0; k < 5; k++) { const a = k * TAU / 5; tube(socket, 'Titanium flowing socket etching relief', [[Math.cos(a) * .013, .006, Math.sin(a) * .013], [Math.cos(a + .35) * .0152, .025, Math.sin(a + .35) * .0152], [Math.cos(a) * .017, .043, Math.sin(a) * .017]], .0008, m.edge, 24); }
      root.userData.itemModel.focus = [0, .397 + .051 * Math.cos(.44), .051 * Math.sin(.44)];
    } else {
      wrap(root, -.077, .071, .022, m, true, kind === 'magic'); band(root, -.085, .024, .016, m, kind === 'teak'); band(root, .082, .021, .019, m, kind === 'teak');
      for (const s of [-1, 1]) rib(root, 'Solid split wooden casting tip', [[s * .004, top - .025, 0], [s * .015, top + .014, 0], [s * .021, top + .05, 0], [s * .022, top + (s < 0 ? .082 : .068), 0]], [.012, .009, .005, .0003], .008, m.wood);
      if (kind === 'teak') { carving(root, .12, .30, .015, m.wood, 2, .45); wrap(root, .315, .398, .014, m, true); }
      root.userData.itemModel.focus = [0, top + .048, 0];
    }
  } else {
    const lo = -.83, hi = .88, r = kind === 'oak' ? .02 : .017;
    shaft(root, 'Continuous two handed wooden staff', m.wood, lo, hi, (t, a) => r * (.87 + .13 * t) + (kind === 'magic' ? .0018 * Math.sin(a * 4 + t * 30) : .00065 * Math.sin(a * 5 + t * 8)), kind === 'magic' ? .0015 : 0, kind === 'magic' ? 20 : 40);
    band(root, -.804, r + .0025, .055, m, kind === 'oak' || kind === 'walnut');
    if (kind === 'oak') {
      carving(root, -.04, .40, .0205, m.wood, 5, 1.6); carving(root, .45, .85, .02, m.wood, 3, .8);
      band(root, -.065, .024, .032, m, true); band(root, .425, .024, .033, m, true); band(root, .868, .027, .034, m, true);
      cup(root, .862, .04, .031, m);
      // Four bowed, solid cobalt straps create a genuinely see-through oval cage.
      for (let k = 0; k < 4; k++) {
        const a = k * TAU / 4 + Math.PI / 4;
        const cage = new THREE.Group();
        rib(cage, 'Bowed cobalt cage strap', [[.021, .877, 0], [.065, .94, 0], [.07, 1.035, 0], [.027, 1.10, 0]], [.011, .011, .010, .007], .006, m.metal);
        tube(cage, 'Cage raised central engraving', [[.023, .88, .006], [.065, .945, .006], [.069, 1.031, .006], [.027, 1.098, .004]], .0011, m.edge, 48);
        cage.rotation.y = a; root.add(cage);
      }
      band(root, 1.098, .03, .014, m, true); root.userData.itemModel.focus = [0, .996, 0];
    } else {
      if (kind === 'walnut') {
        for (const [a, b] of [[-.10, .055], [.15, .32]]) { wrap(root, a!, b!, .020, m); band(root, a!, .022, .02, m, true); band(root, b!, .022, .02, m, true); }
      } else {
        for (const [a, b] of [[-.57, -.36], [.57, .78]]) { wrap(root, a!, b!, .02, m, kind === 'magic', kind === 'magic'); band(root, a!, .022, .02, m); band(root, b!, .022, .02, m); }
        if (kind === 'magic') carving(root, -.78, .84, .018, m.wood, 4, 2.3);
      }
      band(root, .87, .027, .031, m, kind === 'walnut'); cup(root, .874, .118, .033, m);
      if (kind === 'walnut') {
        for (const s of [-1, 1]) rib(root, 'Titanium curling open crown branch', [[s * .013, .88, 0], [s * .072, .947, 0], [s * .076, 1.035, 0], [s * .046, 1.077, 0], [s * .040, 1.101, 0]], [.009, .009, .008, .006, .0001], .009, m.metal);
        for (const s of [-1, 1]) tube(root, 'Titanium crown edge chase', [[s * .017, .892, .01], [s * .066, .955, .008], [s * .073, 1.028, .006], [s * .047, 1.071, .003]], .0015, m.edge, 45);
      } else if (kind === 'teak') {
        for (const s of [-1, 1]) {
          rib(root, 'Angular cindersteel axe shaped crown horn', [[s * .018, .88, 0], [s * .063, .941, 0], [s * .079, 1.015, 0], [s * .069, 1.06, 0], [s * .081, 1.145, 0]], [.014, .021, .023, .013, .0002], .015, m.metal);
          tube(root, 'Copper inlaid crown border', [[s * .025, .902, .012], [s * .074, .955, .014], [s * .093, 1.015, .012], [s * .078, 1.06, .006], [s * .081, 1.14, .001]], .0017, m.edge, 55);
        }
        rib(root, 'Faceted cindersteel foot spike', [[0, -.799, 0], [0, -.841, 0], [0, -.873, 0]], [.022, .018, .001], .017, m.metal);
      } else {
        for (const z of [-.018, .018]) for (const s of [-1, 1]) {
          rib(root, 'Sweeping nightglass four prong open crown', [[s * .01, .852, z], [s * .05, .935, z], [s * .084, 1.018, z], [s * .075, 1.094, z], [s * .036, 1.156 - (z < 0 ? .025 : 0), z]], [.018, .022, .023, .015, .0001], .009, m.metal);
          tube(root, 'Nightglass crown polished ridge', [[s * .014, .869, z + .009], [s * .052, .943, z + .009], [s * .085, 1.028, z + .009], [s * .073, 1.091, z + .006], [s * .037, 1.143 - (z < 0 ? .025 : 0), z]], .0012, m.edge, 48);
        }
        for (const s of [-1, 1]) rib(root, 'Nightglass lower crown thorn', [[s * .012, .87, 0], [s * .035, .90, 0], [s * .055, .888, 0]], [.013, .014, .0001], .012, m.metal);
        rib(root, 'Nightglass pointed staff ferrule', [[0, -.782, 0], [0, -.836, 0], [0, -.875, 0]], [.022, .022, .0001], .019, m.metal);
      }
      root.userData.itemModel.focus = [0, 1.005, 0];
    }
  }
  // Place the actual lower hand binding at the equipment origin, not the shaft midpoint.
  const gripY = staff ? kind === 'oak' ? .18 : kind === 'walnut' ? -.0225 : -.465 : kind === 'oak' || kind === 'walnut' ? -.008 : -.003;
  for (const child of root.children) child.position.y -= gripY;
  root.userData.itemModel.focus[1] -= gripY;
  return root;
}

export const author: ItemModelAuthor = { ids, build };
