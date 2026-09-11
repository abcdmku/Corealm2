import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const ids = ['worn_hatchet', 'grithe_hatchet', 'corven_hatchet', 'kaldite_hatchet', 'emberite_hatchet', 'cindersteel_hatchet', 'nightglass_hatchet'] as const;
const descriptions = [
  'More wedge than edge. It will get through pine if you are patient.',
  'Light, blunt-ish, and enough for pine. Two effective Woodcutting levels.',
  'Iron bit, deep bevel. Five effective Woodcutting levels.',
  'Goes through oak resin without gumming. Nine effective Woodcutting levels.',
  'Bites through scorched bark without a second swing. Seventeen effective Woodcutting levels.',
  'Mastercrafted heavy charcoal cindersteel head with russet forge temper, silver bevel, riveted socket and curved teak haft.',
  'Faceted midnight violet-black volcanic glass wedge, lavender bevel, silver fitted socket and indigo twisting-grain hardwood haft.',
];
const hash = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
function material(name: string, color: number, kind: 'wood' | 'metal' | 'leather', worn = false): THREE.MeshStandardMaterial {
  const size = 256, c = new THREE.Color(color), bytes = new Uint8Array(size * size * 4), rough = new Uint8Array(bytes.length), normal = new Uint8Array(bytes.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const grain = Math.sin(x * .47 + Math.sin(y * .037) * 2.8 + Math.sin(x * .05 + y * .013) * 4);
    const noise = hash(x, y), temper = Math.sin(x * .067 + Math.sin(y * .047) * 3) * Math.sin(y * .08);
    const shade = kind === 'wood' ? .76 + .17 * grain + .12 * noise : kind === 'leather' ? .8 + noise * .2 : .89 + noise * .1 + temper * .05;
    const rust = worn && noise > .78 && temper > .15;
    const channels = rust ? [.34, .16, .07] : [c.r * shade, c.g * shade, c.b * shade];
    const rgb = new THREE.Color().setRGB(channels[0]!, channels[1]!, channels[2]!).convertLinearToSRGB();
    bytes.set([rgb.r * 255, rgb.g * 255, rgb.b * 255, 255], i);
    const r = kind === 'metal' ? 100 + noise * 40 + (rust ? 55 : 0) : kind === 'wood' ? 150 + noise * 40 : 180 + noise * 35;
    rough.set([r, r, r, 255], i);
    normal.set([128 + (kind === 'wood' ? Math.cos(x * .47 + Math.sin(y * .037) * 2.8) * 10 : Math.sin(x * .24) * Math.cos(y * .26) * 5), 128 + Math.sin(y * .27) * 3, 254, 255], i);
  }
  const tex = (data: Uint8Array, suffix: string, srgb = false) => { const t = new THREE.DataTexture(data, size, size); t.name = name + suffix; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return new THREE.MeshStandardMaterial({ name, map: tex(bytes, '-albedo', true), roughnessMap: tex(rough, '-roughness'), normalMap: tex(normal, '-gentle-normal'), roughness: 1, metalness: kind === 'metal' ? .88 : 0 });
}
function mesh(root: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material) { const m = new THREE.Mesh(geo, mat); m.name = name; root.add(m); return m; }
function line(root: THREE.Group, name: string, points: THREE.Vector3[], r: number, mat: THREE.Material) { return mesh(root, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(16, points.length * 4), r, 6, false), mat); }
function solid(root: THREE.Group, name: string, points: THREE.Vector2[], thickness: number, mat: THREE.Material) {
  const s = new THREE.Shape(points); const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelThickness: .0016, bevelSize: .0016, bevelSegments: 2, steps: 1, curveSegments: 16 });
  g.translate(0, 0, -thickness / 2); return mesh(root, name, g, mat);
}
function shaftX(y: number, tier: number) { return .012 * Math.sin((y + .12) * 12) + (tier === 6 ? .008 * Math.sin(y * 23) : 0); }
function radius(y: number) { return .019 + .008 * Math.exp(-Math.pow((y + .113) / .055, 2)) + .004 * Math.exp(-Math.pow((y - .32) / .12, 2)); }
function haft(root: THREE.Group, tier: number, mat: THREE.Material) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [], rings = 80, sides = 32;
  for (let j = 0; j <= rings; j++) { const y = -.135 + j / rings * .66; for (let i = 0; i <= sides; i++) { const a = i / sides * Math.PI * 2, r = radius(y) * (tier === 0 ? 1 + Math.sin(j * .41 + i) * .035 : 1); p.push(shaftX(y, tier) + Math.cos(a) * r, y, Math.sin(a) * r * .82); uv.push(i / sides, j / rings); if (j < rings && i < sides) { const k = j * (sides + 1) + i; ix.push(k, k + sides + 1, k + 1, k + 1, k + sides + 1, k + sides + 2); } } }
  for (const j of [0, rings]) { const center = p.length / 3; const y = -.135 + j / rings * .66; p.push(shaftX(y, tier), y, 0); uv.push(.5, .5); for (let i = 0; i < sides; i++) { const a = j * (sides + 1) + i; if (j === 0) ix.push(center, a + 1, a); else ix.push(center, a, a + 1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals(); mesh(root, 'continuous-curved-carved-haft-with-endgrain', g, mat);
}
function band(root: THREE.Group, name: string, tier: number, y: number, h: number, mat: THREE.Material, extra = .0017) { const m = mesh(root, name, new THREE.CylinderGeometry(radius(y + h / 2) + extra, radius(y - h / 2) + extra, h, 32), mat); m.position.set(shaftX(y, tier), y, 0); m.scale.z = .84; return m; }
function wrap(root: THREE.Group, tier: number, low: number, high: number, turns: number, mat: THREE.Material, trim: THREE.Material, reverse = false) {
  const p: number[] = [], uv: number[] = [], idx: number[] = [], segments = 240, width = (high - low) / turns * .92;
  for (let i = 0; i <= segments; i++) { const t = i / segments, y = low + t * (high - low), a = t * turns * Math.PI * 2 * (reverse ? -1 : 1); for (const s of [-1, 1]) { const yy = y + s * width / 2, r = radius(yy) + .0028; p.push(shaftX(yy, tier) + Math.cos(a) * r, yy, Math.sin(a) * r * .86); uv.push(t * turns, (s + 1) / 2); } if (i < segments) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); mesh(root, 'overlapping-helical-grip-strap', g, mat);
  const pts: THREE.Vector3[] = []; for (let i = 0; i <= 220; i++) { const t = i / 220, y = low + t * (high - low) + width / 2, a = t * turns * Math.PI * 2 * (reverse ? -1 : 1), r = radius(y) + .0032; pts.push(new THREE.Vector3(shaftX(y, tier) + Math.cos(a) * r, y, Math.sin(a) * r * .86)); } line(root, 'raised-strap-edge', pts, .0007, trim);
}
function rivet(root: THREE.Group, name: string, x: number, y: number, z: number, mat: THREE.Material) { const m = mesh(root, name, new THREE.SphereGeometry(.006, 12, 8), mat); m.position.set(x, y, z); m.scale.z = .42; }

export const author: ItemModelAuthor = { ids, build(id) {
  const tier = ids.indexOf(id as typeof ids[number]); if (tier < 0) throw new Error(`Unknown hatchet ${id}`);
  const root = new THREE.Group(); root.name = id;
  root.userData.itemModel = { itemId: id, author: 'hatchets', reference: `art/item-icons/generated/${id}.png`, description: descriptions[tier]!, grip: [0, 0, 0] };
  const wood = material('longitudinal-' + ['weathered-wood', 'pine', 'ash', 'oak', 'walnut', 'teak', 'indigo-hardwood'][tier], [0x96744d, 0xc69958, 0xa98454, 0x95541f, 0x57351f, 0xad6928, 0x29283f][tier]!, 'wood');
  const metal = material(['pitted-old-iron', 'hammered-copper', 'forged-dark-iron', 'cobalt-steel', 'satin-titanium', 'russet-cindersteel', 'midnight-volcanic-glass'][tier]!, [0x686260, 0xbf632f, 0x41434a, 0x31567f, 0x999a9b, 0x393735, 0x160f27][tier]!, 'metal', tier === 0 || tier === 5);
  if (tier === 6) { metal.metalness = .35; metal.roughness = .45; }
  const edge = new THREE.MeshStandardMaterial({ name: 'honed-' + id, color: tier === 1 ? 0xe29d62 : tier === 6 ? 0x9c80d2 : 0xbdc2ca, metalness: .9, roughness: tier === 0 ? .48 : .25 });
  const leather = material('dark-brown-grip-leather', 0x342219, 'leather'); leather.side = THREE.DoubleSide;
  const trim = new THREE.MeshStandardMaterial({ name: 'strap-edge-and-inlay', color: tier === 6 ? 0xa5a2ae : 0x735138, metalness: tier === 6 ? .85 : .15, roughness: .48 });
  haft(root, tier, wood);
  const lower = tier === 0 ? .27 : -.094, upper = tier === 0 ? .33 : .065;
  if (tier !== 6) { for (let j = 0; j < 12; j++) band(root, 'leather-underwrap-' + j, tier, lower + (upper - lower) * j / 11, (upper - lower) / 11 + .001, leather); wrap(root, tier, lower, upper, tier === 0 ? 3 : 5, leather, trim); }
  if (tier === 5) wrap(root, tier, -.075, .045, 1.3, leather, trim, true);
  if (tier === 6) wrap(root, tier, -.065, .08, 1.4, edge, trim);
  if (tier >= 3) band(root, 'fitted-flared-butt-cap', tier, -.115, .037, tier === 6 ? edge : metal, .003);
  if (tier === 5) band(root, 'riveted-butt-binding', tier, -.09, .021, metal, .003);
  if (tier >= 2) band(root, 'socket-lower-ferrule', tier, .391, tier >= 4 ? .053 : .029, metal, .006);
  // The bit has a broad crescent edge and a concave beard. Each tier has its own measured profile.
  const width = [.235, .235, .246, .245, .239, .275, .258][tier]!;
  const bottom = [.287, .31, .279, .27, .295, .228, .261][tier]!;
  const outer: THREE.Vector2[] = [], inner: THREE.Vector2[] = [];
  for (let j = 0; j <= 24; j++) { const t = j / 24; let x = width - .124 * t * t, y = .515 + (bottom - .515) * t; if (tier === 0 && [7, 14, 20].includes(j)) x -= .008; outer.push(new THREE.Vector2(x, y)); inner.push(new THREE.Vector2(x - .024 * Math.sin(.3 + t * 1.7), y + .011 * t)); }
  const start = [new THREE.Vector2(-.041, .515), new THREE.Vector2(.035, .515), new THREE.Vector2(.087, .49), new THREE.Vector2(.151, .486)];
  const tail = [new THREE.Vector2(.104, bottom + .056), new THREE.Vector2(.099, .36), new THREE.Vector2(.078, .401), new THREE.Vector2(.037, .426), new THREE.Vector2(-.041, .426)];
  solid(root, 'solid-forged-head-cheeks-and-poll', [...start, ...inner, ...tail], .034, metal);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= 24; j++) { const a = inner[j]!, b = outer[j]!; for (const s of [1, -1]) { positions.push(a.x, a.y, .017 * s, b.x, b.y, .0012 * s); uvs.push(j / 24, 0, j / 24, 1); } if (j < 24) { const k = j * 4; indices.push(k, k + 1, k + 4, k + 1, k + 5, k + 4, k + 2, k + 6, k + 3, k + 3, k + 6, k + 7, k + 1, k + 3, k + 5, k + 3, k + 7, k + 5); } }
  indices.push(0, 2, 1, 1, 2, 3, 96, 97, 98, 97, 99, 98);
  for (let i = 0; i < indices.length; i += 3) { const swap = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = swap; }
  const bevel = new THREE.BufferGeometry(); bevel.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); bevel.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); bevel.setIndex(indices); bevel.computeVertexNormals(); mesh(root, 'solid-tapered-cutting-bevel', bevel, edge);
  band(root, 'oval-head-eye-socket', tier, .469, .089, metal, .009);
  const wedge = mesh(root, 'steel-wedge-in-exposed-haft-end', new THREE.BoxGeometry(.0025, .003, .028), edge); wedge.position.set(shaftX(.525, tier), .526, 0);
  if (tier >= 4) for (const s of [-1, 1]) { rivet(root, 'socket-through-rivet', shaftX(.39, tier), .39, s * .024, edge); if (tier === 5) { rivet(root, 'head-cheek-rivet', .014, .493, s * .027, edge); rivet(root, 'butt-band-rivet', shaftX(-.09, tier), -.09, s * .025, edge); } }
  if (tier === 4) for (const s of [-1, 1]) {
    const inset = [new THREE.Vector2(.053, .469), new THREE.Vector2(.083, .469), new THREE.Vector2(.183, .481), new THREE.Vector2(.205, .49), new THREE.Vector2(.16, .365), new THREE.Vector2(.109, .326), new THREE.Vector2(.091, .413)];
    const m = solid(root, 'recessed-satin-cheek-panel', inset, .001, metal); m.position.z = s * .019;
    line(root, 'machined-panel-border', [...inset, inset[0]!].map(v => new THREE.Vector3(v.x, v.y, s * .020)), .0012, edge);
    for (let j = 0; j < 7; j++) { const y = -.083 + j * .022; line(root, 'cross-laced-grip-seam', [new THREE.Vector3(-.01, y, s * .020), new THREE.Vector3(.009, y + .013, s * .023), new THREE.Vector3(-.009, y + .019, s * .020)], .0014, trim); }
  }
  if (tier === 5 || tier === 6) for (const s of [-1, 1]) {
    const path = [[.01, .512], [.043, .489], [.054, .447], [.079, .399], [.114, .361], [.115, .306]];
    line(root, 'silver-socket-scroll-spine', path.map(([x, y]) => new THREE.Vector3(x!, y!, s * .021)), tier === 6 ? .0025 : .0013, tier === 6 ? edge : trim);
    if (tier === 5) for (const [cx, cy, r] of [[.07, .466, .016], [.133, .371, .021]]) { const points: THREE.Vector3[] = []; for (let i = 0; i <= 44; i++) { const t = i / 44 * Math.PI * 2.1, rr = r! * (1 - i / 55); points.push(new THREE.Vector3(cx! + Math.cos(t) * rr, cy! + Math.sin(t) * rr, s * .020)); } line(root, 'restrained-forged-scroll', points, .0013, trim); }
    if (tier === 6) { const gemMat = new THREE.MeshStandardMaterial({ name: 'violet-inlay', color: 0x6233a0, metalness: .48, roughness: .21 }); for (const [x, y, z] of [[.021, .463, .027], [shaftX(.014, tier), .014, .020]]) { const g = mesh(root, 'flush-faceted-violet-inlay', new THREE.OctahedronGeometry(.011, 0), gemMat); g.position.set(x!, y!, s * z!); g.scale.set(.65, 1.6, .35); } }
  }
  if (tier === 6) {
    // Actual broken glass planes, separately triangulated across the broad cheek on both sides.
    const facets = [[.062, .458, .113, .466, .12, .408], [.113, .466, .174, .48, .12, .408], [.174, .48, .203, .452, .156, .399], [.12, .408, .174, .48, .156, .399], [.12, .408, .156, .399, .113, .331], [.156, .399, .203, .452, .165, .363]];
    const glass = new THREE.MeshStandardMaterial({ name: 'violet-glass-fracture-planes', color: 0x302340, metalness: .55, roughness: .24 });
    for (const s of [-1, 1]) facets.forEach((f, i) => { const p = [f[0]!, f[1]!, s * .019, f[2]!, f[3]!, s * (.020 + (i % 3) * .002), f[4]!, f[5]!, s * .019]; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(s > 0 ? [0, 2, 1] : [0, 1, 2]); g.computeVertexNormals(); mesh(root, 'glass-cleavage-' + s + '-' + i, g, glass); });
  }
  // The grip center is the centerline at the middle of the wrapped lower hand position.
  const gripOffset = shaftX(0, tier); for (const child of root.children) child.position.x -= gripOffset;
  return root;
} };
