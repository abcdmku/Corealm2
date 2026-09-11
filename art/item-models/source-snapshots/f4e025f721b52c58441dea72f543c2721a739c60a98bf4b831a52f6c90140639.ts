import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ItemModelAuthor } from '../contracts';

type V = [number, number, number];
const TAU = Math.PI * 2;
const ids = ['marchhide_hood', 'marchhide_robe', 'marchhide_leggings', 'marchhide_boots', 'marchhide_wraps'] as const;
const descriptions = ['Cured wolf hide, hood up against the march wind.', 'Three hides stitched into something between a coat and a tent.', 'Hide leggings, laced at the calf.', 'Soft-soled. Quiet, which matters more than it sounds.', 'Hide strips wound to the knuckle, fingertips left bare.'];
function palette() {
  const size = 256, pixels = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  let seed = 34183;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed / 4294967296 - .5), cloud = Math.sin(x * .061 + Math.sin(y * .081)) * Math.cos(y * .043) * .13;
    const f = .82 + cloud + grain * .20;
    const i = (y * size + x) * 4;
    pixels[i] = 255 * f; pixels[i + 1] = 245 * f; pixels[i + 2] = 222 * f; pixels[i + 3] = 255;
    normal[i] = 128 + grain * 12; normal[i + 1] = 128 + Math.sin(x * 2.1 + y * 1.7) * 4; normal[i + 2] = 255; normal[i + 3] = 255;
  }
  const map = new THREE.DataTexture(pixels, size, size); map.colorSpace = THREE.SRGBColorSpace;
  const n = new THREE.DataTexture(normal, size, size);
  for (const t of [map, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.needsUpdate = true; }
  const mat = (name: string, color: number, roughness = .9) => { const m = new THREE.MeshStandardMaterial({ color, roughness, map, normalMap: n, normalScale: new THREE.Vector2(.32, .32) }); m.name = name; return m; };
  return [mat('ochre cured wolf leather', 0x93643d), mat('dark smoked hide panels', 0x60452f), mat('pale rawhide patches', 0xb18a5c), mat('suede garment lining', 0x4c3524), mat('undyed sinew cord', 0xd0b78b), mat('gray taupe wolf underfur', 0x8e8270), mat('silver tan fur tips', 0xbeb09a), mat('dark compressed hide soles', 0x503827)] as const;
}
type Mats = ReturnType<typeof palette>;
function mesh(g: THREE.Group, name: string, geom: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) { const m = new THREE.Mesh(geom, material); m.name = name; g.add(m); return m; }
function cord(g: THREE.Group, p: V[], radius: number, mat: THREE.Material, name: string) {
  const curve = new THREE.CatmullRomCurve3(p.map(v => new THREE.Vector3(...v)));
  return mesh(g, name, new THREE.TubeGeometry(curve, Math.max(4, p.length * 2), radius, 5, false), mat);
}
// Closed thickness at the edges, continuous inner lining, and deliberate panel color changes.
function shell(g: THREE.Group, name: string, fn: (a: number, t: number, inner: boolean) => V, mats: Mats, segments = 48, rows = 14, panel = false) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let layer = 0; layer < 2; layer++) for (let j = 0; j <= rows; j++) for (let i = 0; i <= segments; i++) {
    pos.push(...fn(i / segments * TAU, j / rows, layer === 1)); uv.push(i / segments, j / rows);
  }
  const geo = new THREE.BufferGeometry(), stride = segments + 1, offset = stride * (rows + 1);
  for (let layer = 0; layer < 2; layer++) for (let j = 0; j < rows; j++) for (let i = 0; i < segments; i++) {
    const a = layer * offset + j * stride + i, b = a + stride, start = idx.length;
    const center = new THREE.Vector3();
    for (let k = 0; k < segments; k++) center.add(new THREE.Vector3().fromArray(pos, (layer * offset + j * stride + k) * 3));
    center.divideScalar(segments);
    const p = new THREE.Vector3().fromArray(pos, a * 3), along = new THREE.Vector3().fromArray(pos, b * 3).sub(p), around = new THREE.Vector3().fromArray(pos, (a + 1) * 3).sub(p);
    const outward = along.cross(around).dot(p.clone().sub(center)) >= 0;
    if (outward !== Boolean(layer)) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
    geo.addGroup(start, 6, layer ? 3 : panel ? (Math.floor(i / segments * 7) % 3) : 0);
  }
  for (const j of [0, rows]) for (let i = 0; i < segments; i++) { const a = j * stride + i, b = a + offset, s = idx.length; idx.push(a, a + 1, b, a + 1, b + 1, b); geo.addGroup(s, 6, 1); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  return mesh(g, name, geo, [...mats]);
}
function stitches(g: THREE.Group, path: V[], mats: Mats, name: string, cross = false) {
  const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p))), len = curve.getLength(), count = Math.ceil(len / .023);
  for (let i = 0; i < count; i++) { const p = curve.getPoint((i + .5) / count), t = curve.getTangent((i + .5) / count), side = new THREE.Vector3(-t.y, t.x, .08).normalize().multiplyScalar(.007);
    for (let k = 0; k < (cross ? 2 : 1); k++) { const d = t.clone().multiplyScalar(k ? -.005 : .005); const a = p.clone().sub(side).sub(d), b = p.clone().add(side).add(d); cord(g, [a.toArray(), p.clone().add(new THREE.Vector3(0, 0, .003)).toArray(), b.toArray()], .0017, mats[4], name); }
  }
}
function fur(g: THREE.Group, points: V[], mats: Mats, name: string, radius = .012) {
  cord(g, points, radius * .72, mats[5], name + ' dense base');
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), count = Math.ceil(curve.getLength() / .0038), geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { const p = curve.getPoint(i / count), a = i * 2.399 + k * 2.09;
    const direction = new THREE.Vector3(Math.cos(a), -.55 + Math.sin(i * 1.79) * .25, Math.sin(a)).normalize();
    const geo = new THREE.ConeGeometry(radius * .19, radius * (1.4 + .4 * Math.sin(i * 7)), 4); geo.rotateZ(Math.PI); geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction)); geo.translate(p.x + direction.x * radius * .75, p.y + direction.y * radius * .75, p.z + direction.z * radius * .75); geos.push(geo);
  }
  if (geos.length) mesh(g, name + ' tapered fur locks', mergeGeometries(geos), mats[6]);
}
function ring(x: number, y: number, z: number, rx: number, rz: number): V[] { return Array.from({ length: 65 }, (_, i) => [x + Math.sin(i / 64 * TAU) * rx, y, z + Math.cos(i / 64 * TAU) * rz]); }
function bow(g: THREE.Group, x: number, y: number, z: number, mats: Mats, scale = 1) {
  const p = (a: number, b: number, c = 0): V => [x + a * scale, y + b * scale, z + c * scale];
  cord(g, [p(-.008, 0), p(-.04, .007), p(-.035, -.028), p(0, 0), p(.035, .005), p(.032, -.032), p(0, 0), p(-.006, .009), p(.008, -.004)], .004 * scale, mats[4], 'tied rawhide bow');
  for (const s of [-1, 1]) cord(g, [p(s * .008, 0), p(s * .017, -.035, .006), p(s * .024, -.092, .003)], .0032 * scale, mats[4], 'hanging knot tail');
}
function hood(g: THREE.Group, m: Mats) {
  // Front opening is a pointed arch. Back converges into a rounded sewn crown.
  const edge = (a: number): V => [Math.sin(a) * (.104 - .02 * Math.max(0, -Math.cos(a))), 1.667 + .177 * Math.cos(a), .132 - .035 * Math.cos(a)];
  shell(g, 'hollow pointed hood with suede interior', (a, t, inner) => { const e = edge(a), f = Math.sin(t * Math.PI / 2), r = 1 - .96 * f; return [e[0] * r * (inner ? .94 : 1), 1.697 + (e[1] - 1.697) * r - t * .012, e[2] * (1 - f) - .139 * f + (inner ? .007 : 0)]; }, m, 64, 22);
  const opening = Array.from({ length: 65 }, (_, i) => edge(i / 64 * TAU)); fur(g, opening, m, 'face opening wolf fur', .017);
  stitches(g, [[0, 1.84, .098], [0, 1.835, .02], [0, 1.79, -.09], [0, 1.692, -.142]], m, 'crown whip stitch');
  shell(g, 'flared shoulder cape', (a, t, inner) => { const rx = .082 + .166 * t, rz = .077 + .10 * t; return [Math.sin(a) * (rx - (inner ? .004 : 0)), 1.538 - .128 * t + Math.abs(Math.sin(a)) * .043 * t, -.021 + Math.cos(a) * (rz - (inner ? .004 : 0))]; }, m, 64, 8, true);
  fur(g, Array.from({ length: 65 }, (_, i) => { const a = i / 64 * TAU; return [Math.sin(a) * .248, 1.41 + Math.abs(Math.sin(a)) * .043, -.021 + Math.cos(a) * .177]; }), m, 'cape hem fur');
  stitches(g, [[-.2, 1.45, .10], [-.10, 1.47, .14], [0, 1.48, .155], [.10, 1.47, .14], [.2, 1.45, .10]], m, 'cape collar stitches'); bow(g, 0, 1.492, .161, m, .7);
}
function robe(g: THREE.Group, m: Mats) {
  shell(g, 'three-hide belted coat body and long flared skirt', (a, t, inner) => {
    const front = Math.max(0, Math.cos(a)), top = 1.475 - .19 * front ** 8, y = .22 + t * (top - .22) + (1 - t) ** 7 * .017 * Math.sin(a * 9);
    const waist = Math.exp(-(((y - 1.11) / .105) ** 2)), flare = Math.max(0, 1.04 - y), rx = .19 - .03 * waist + flare * .125, rz = .129 - .018 * waist + flare * .065;
    const fold = (.003 + .008 * Math.max(0, 1.12 - y)) * Math.sin(a * 13 + y * 2) + .002 * Math.sin(y * 43 + a * 4);
    return [Math.sin(a) * (rx + fold - (inner ? .006 : 0)), y, -.013 + Math.cos(a) * (rz + fold - (inner ? .006 : 0))];
  }, m, 64, 30, true);
  fur(g, [[-.085, 1.472, -.07], [-.082, 1.47, .025], [-.07, 1.40, .105], [0, 1.285, .131], [.07, 1.40, .105], [.082, 1.47, .025], [.085, 1.472, -.07], [0, 1.48, -.098], [-.085, 1.472, -.07]], m, 'deep V wolf fur collar', .014);
  for (const s of [-1, 1]) {
    shell(g, 'loose ' + s + ' T-pose sleeve', (a, t, inner) => { const r = .073 + .022 * t + .004 * Math.sin(t * 16 + a * 3) - (inner ? .006 : 0); return [s * (.17 + .455 * t), 1.443 + Math.sin(a) * r, -.063 + Math.cos(a) * r]; }, m, 40, 16, true);
    fur(g, Array.from({ length: 65 }, (_, i) => { const a = i / 64 * TAU; return [s * .625, 1.443 + Math.sin(a) * .095, -.063 + Math.cos(a) * .095]; }), m, 'sleeve fur cuff', .013);
    stitches(g, [[s * .205, 1.49, .015], [s * .33, 1.49, .019], [s * .46, 1.482, .024], [s * .6, 1.474, .032]], m, 'sleeve cross seams', true);
    stitches(g, [[s * .08, 1.27, .12], [s * .063, 1.1, .105], [s * .09, .85, .143], [s * .12, .55, .164], [s * .14, .24, .184]], m, 'skirt panel cross seams', true);
    stitches(g, [[s * .12, 1.45, -.12], [s * .085, 1.13, -.12], [s * .13, .72, -.151], [s * .17, .24, -.17]], m, 'rear panel seams');
  }
  for (const y of [1.103, 1.116]) cord(g, ring(0, y, -.013, .167, .118), .004, m[4], 'twisted double waist cord'); bow(g, .059, 1.109, .111, m, 1.1);
}
function leggings(g: THREE.Group, m: Mats) {
  shell(g, 'hollow joined hip waistband', (a, t, inner) => [Math.sin(a) * (.18 + .02 * Math.sin(t * Math.PI) - (inner ? .005 : 0)), .835 + .188 * t + .058 * Math.cos(a) ** 2 * (1 - t), -.034 + Math.cos(a) * (.119 - (inner ? .005 : 0))], m, 64, 10, true);
  fur(g, ring(0, .987, -.034, .187, .123), m, 'waist narrow fur band', .013);
  cord(g, ring(0, 1.016, -.034, .183, .121), .004, m[1], 'rolled waistband edge'); bow(g, 0, 1.002, .094, m, .6);
  for (const s of [-1, 1]) {
    shell(g, 'separate ' + s + ' folded hide trouser leg', (a, t, inner) => { const y = .135 + .785 * t, r = .056 + .036 * t + .008 * Math.sin(t * Math.PI), fold = .004 * Math.sin(t * 37 + a * 3) * Math.sin(t * Math.PI); return [s * .1143 + Math.sin(a) * (r + fold - (inner ? .004 : 0)), y, -.036 + Math.cos(a) * (r * 1.08 + fold - (inner ? .004 : 0))]; }, m, 48, 32, true);
    const pad = new THREE.SphereGeometry(1, 24, 14); pad.scale(.066, .083, .023); pad.translate(s * .1143, .544, .046); mesh(g, 'shaped dark hide knee reinforcement', pad, m[1]);
    stitches(g, [[s * .056, .56, .061], [s * .08, .613, .06], [s * .14, .62, .06], [s * .178, .56, .06], [s * .153, .479, .061], [s * .085, .475, .061], [s * .056, .56, .061]], m, 'knee patch sewing');
    stitches(g, [[s * .16, .91, .053], [s * .19, .77, .041], [s * .17, .65, .04]], m, 'upper patch seam');
    for (let i = 0; i < 9; i++) { const y = .18 + i * .03, x = s * .157; cord(g, [[x - .013, y, .005], [x, y + .014, .03], [x + .013, y + .028, .005]], .0028, m[4], 'calf crossed rawhide lace'); cord(g, [[x + .013, y, .005], [x, y + .014, .033], [x - .013, y + .028, .005]], .0028, m[4], 'calf returning lace'); }
    stitches(g, [[s * .113, .18, -.098], [s * .112, .5, -.117], [s * .113, .84, -.14]], m, 'rear trouser seam');
  }
}
function boots(g: THREE.Group, m: Mats) {
  for (const s of [-1, 1]) {
    const x = s * .1143;
    shell(g, 'hollow gathered boot shaft ' + s, (a, t, inner) => { const r = .057 + .012 * t + .006 * Math.sin(t * 31 + Math.sin(a) * 2) * Math.sin(t * Math.PI); return [x + Math.sin(a) * (r - (inner ? .005 : 0)), .055 + .28 * t, -.065 + Math.cos(a) * (r * 1.17 - (inner ? .005 : 0))]; }, m, 56, 28);
    // Moccasin upper encloses toe and heel, with an open ankle supplied by the shaft.
    shell(g, 'moccasin toe vamp ' + s, (a, t, inner) => { const r = Math.sin(t * Math.PI / 2), y = .022 + .089 * Math.cos(t * Math.PI / 2); return [x + Math.sin(a) * .067 * r, y + (inner ? -.005 : 0), .018 + Math.cos(a) * .159 * r]; }, m, 56, 16);
    const sole = new THREE.SphereGeometry(1, 40, 12); sole.scale(.071, .015, .166); sole.translate(x, .019, .018); mesh(g, 'soft stitched leather sole ' + s, sole, m[7]);
    const perimeter = ring(x, .039, .018, .066, .156); cord(g, perimeter, .003, m[1], 'raised moccasin welt'); stitches(g, perimeter, m, 'sole blanket stitches');
    fur(g, ring(x, .329, -.065, .072, .085), m, 'rolled shaggy boot top', .020);
    for (const sign of [-1, 1]) cord(g, Array.from({ length: 65 }, (_, i) => { const a = i / 64 * TAU; return [x + Math.sin(a) * .067, .248 + sign * Math.cos(a) * .036, -.065 + Math.cos(a) * .08]; }), .0036, m[4], 'cross wound boot thong');
    bow(g, x, .248, .024, m, .52);
    stitches(g, [[x - .06, .065, -.05], [x - .064, .19, -.065], [x - .07, .302, -.065]], m, 'outer boot seam');
    stitches(g, [[x, .07, -.135], [x, .18, -.142], [x, .302, -.145]], m, 'rear heel seam');
  }
}
function wraps(g: THREE.Group, m: Mats) {
  for (const s of [-1, 1]) {
    const thumbRoot = new THREE.Vector3(s * .715, 1.434, -.046), thumbAxis = new THREE.Vector3(0, -.8, .6);
    const openThumbRoot = (piece: THREE.Mesh) => {
      const geometry = piece.geometry, index = geometry.index!, positions = geometry.getAttribute('position'), kept: number[] = [], groups = [...geometry.groups];
      geometry.clearGroups();
      for (const group of groups) {
        const start = kept.length;
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)], center = new THREE.Vector3();
          for (const v of indices) center.add(new THREE.Vector3().fromBufferAttribute(positions, v));
          center.divideScalar(3).sub(thumbRoot);
          const along = center.dot(thumbAxis), across = center.clone().addScaledVector(thumbAxis, -along).length();
          if (across >= .014 || along < -.018) kept.push(...indices);
        }
        if (kept.length > start) geometry.addGroup(start, kept.length - start, group.materialIndex);
      }
      geometry.setIndex(kept);
    };
    openThumbRoot(shell(g, 'fingerless hollow hide gauntlet ' + s, (a, t, inner) => { const r = .04 + .009 * Math.cos(t * TAU) - (inner ? .0035 : 0); return [s * (.598 + .169 * t), 1.4555 + Math.sin(a) * r, -.0654 + Math.cos(a) * r * .74]; }, m, 64, 32));
    // Spiral wraps are actual broad hide bands with front and rear surfaces.
    for (let k = 0; k < 4; k++) openThumbRoot(shell(g, 'overlapping spiral rawhide strip ' + s + ' ' + k, (a, t, inner) => { const x = .609 + k * .036 + a / TAU * .027 + (t - .5) * .022, r = .046 + .003 * Math.cos((x - .598) / .169 * TAU) - (inner ? .002 : 0); return [s * x, 1.4555 + Math.sin(a) * r, -.0654 + Math.cos(a) * r * .78]; }, m, 48, 4, k % 2 === 0));
    openThumbRoot(shell(g, 'opposing diagonal hide binding ' + s, (a, t, inner) => { const x = .752 - a / TAU * .105 + (t - .5) * .017, r = .051 - (inner ? .002 : 0); return [s * x, 1.4555 + Math.sin(a) * r, -.0654 + Math.cos(a) * r * .78]; }, m, 64, 4));
    fur(g, Array.from({ length: 65 }, (_, i) => { const a = i / 64 * TAU; return [s * .614, 1.4555 + Math.sin(a) * .049, -.0654 + Math.cos(a) * .038]; }), m, 'gauntlet wrist fur edge', .009);
    shell(g, 'open thumb sleeve ' + s, (a, t, inner) => { const r = .017 - (inner ? .003 : 0); return [s * (.715 + Math.sin(a) * r), 1.434 - .8 * .038 * t + Math.cos(a) * r * .6, -.046 + .6 * .038 * t + Math.cos(a) * r * .8]; }, m, 32, 5);
    stitches(g, [[s * .601, 1.484, -.03], [s * .65, 1.484, -.034], [s * .70, 1.485, -.032], [s * .763, 1.486, -.03]], m, 'wrap longitudinal stitching');
    bow(g, s * .63, 1.448, -.019, m, .35);
  }
}
export const author: ItemModelAuthor = {
  ids,
  build(id) {
    const index = ids.indexOf(id as typeof ids[number]); if (index < 0) throw new Error('Unknown marchhide item ' + id);
    const g = new THREE.Group(); g.name = id; const m = palette();
    [hood, robe, leggings, boots, wraps][index]!(g, m);
    g.userData.itemModel = { itemId: id, author: 'armor-marchhide', reference: `art/item-icons/generated/${id}.png`, description: descriptions[index], wearable: true };
    return g;
  },
};
