import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type P = readonly [number, number, number];
type Ring = readonly [number, number, number, number?];
const V = (p: P) => new THREE.Vector3(...p);

function materials() {
  const n = 256, data = new Uint8Array(n * n * 4), rough = new Uint8Array(n * n * 4);
  let seed = 9373;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = (seed >>> 24) / 255;
    const scratch = Math.pow(Math.max(0, Math.sin(x * .81 + Math.sin(y * .087) * 3)), 70) * (grain > .61 ? 1 : 0);
    const k = (y * n + x) * 4, f = .88 + grain * .19;
    data[k] = 63 * f + scratch * 50; data[k + 1] = 91 * f + scratch * 43;
    data[k + 2] = 135 * f + scratch * 29; data[k + 3] = 255;
    rough[k] = rough[k + 1] = rough[k + 2] = 140 + grain * 37; rough[k + 3] = 255;
  }
  const texture = (bytes: Uint8Array, name: string, color = false) => {
    const t = new THREE.DataTexture(bytes, n, n); t.name = name;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.needsUpdate = true; return t;
  };
  const blue = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture(data, 'Cobalt fine crossed abrasion', true), roughnessMap: texture(rough, 'Independent forged cobalt roughness'), metalness: .82, roughness: .76 });
  blue.name = 'Deep cobalt forged plate';
  const steel = new THREE.MeshStandardMaterial({ color: 0xb0b2b5, metalness: .88, roughness: .36 }); steel.name = 'Exposed polished steel bevels';
  const leather = new THREE.MeshStandardMaterial({ color: 0x241c18, roughness: .93 }); leather.name = 'Brown black leather lining and straps';
  const bronze = new THREE.MeshStandardMaterial({ color: 0x71614b, metalness: .74, roughness: .49 }); bronze.name = 'Aged buckle metal';
  const thread = new THREE.MeshStandardMaterial({ color: 0x776048, roughness: 1 }); thread.name = 'Waxed seam thread';
  const gem = new THREE.MeshPhysicalMaterial({ color: 0x850716, metalness: .15, roughness: .17, clearcoat: 1 }); gem.name = 'Garnet rivet cabochons';
  return { blue, steel, leather, bronze, thread, gem };
}
type Mats = ReturnType<typeof materials>;
function mesh(g: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], p: P = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(...p); g.add(m); return m;
}
function line(g: THREE.Group, name: string, a: P, b: P, r: number, mat: THREE.Material) {
  const d = V(b).sub(V(a)), m = mesh(g, name, new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(V(a).add(V(b)).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
function rivet(g: THREE.Group, name: string, p: P, mat: THREE.Material, r = .005, normal: P = [0, 0, 1]) {
  const m = mesh(g, name, new THREE.SphereGeometry(r, 10, 6), mat, p); m.scale.set(1, 1, .48);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(normal).normalize());
}

/** Closed cross-section metal shell, with separate inward skin and solid edge returns. */
function shell(g: THREE.Group, name: string, rows: readonly Ring[], mat: THREE.Material, start = 0, end = Math.PI * 2, segments = 24, thick = .004) {
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let inner = 0; inner < 2; inner++) for (let j = 0; j < rows.length; j++) {
    const [y, rx, rz, z = 0] = rows[j]!;
    for (let i = 0; i <= segments; i++) {
      const a = start + (end - start) * i / segments;
      pos.push(Math.sin(a) * Math.max(.0001, rx - inner * thick), y, z + Math.cos(a) * Math.max(.0001, rz - inner * thick));
      uv.push(i / segments, j / (rows.length - 1));
    }
  }
  const stride = segments + 1, skin = rows.length * stride;
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, d, b, c, d);
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * stride + i; quad(a, a + stride, a + stride + 1, a + 1);
    quad(a + skin + 1, a + skin + stride + 1, a + skin + stride, a + skin);
  }
  for (let i = 0; i < segments; i++) {
    quad(i + 1, i + 1 + skin, i + skin, i);
    const a = (rows.length - 1) * stride + i; quad(a, a + skin, a + skin + 1, a + 1);
  }
  for (let j = 0; j < rows.length - 1; j++) for (const i of [0, segments]) {
    const a = j * stride + i; if (i === 0) quad(a, a + skin, a + stride + skin, a + stride); else quad(a + stride, a + stride + skin, a + skin, a);
  }
  for (let i = 0; i < indices.length; i += 3) { const b = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = b; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals();
  return mesh(g, name, geo, mat);
}
/** Hand-shaped convex plate: front facet fan, bevel ring, thickness, and real rear face. */
function plate(g: THREE.Group, name: string, contour: readonly P[], mat: Mats, ridge = .009, trim = .0014) {
  const c = contour.reduce((a, p) => a.add(V(p)), new THREE.Vector3()).multiplyScalar(1 / contour.length);
  const positions: number[] = [], uvs: number[] = [], groups: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, material: number) => {
    for (const p of [a, b, d]) { positions.push(p.x, p.y, p.z); uvs.push(p.x * 5, p.y * 5); } groups.push(material);
  };
  const rim = contour.map(p => V(p));
  const area = rim.reduce((sum, p, i) => { const q = rim[(i + 1) % rim.length]!; return sum + p.x * q.y - q.x * p.y; }, 0);
  if (area < 0) rim.reverse();
  const inner = rim.map(p => p.clone().lerp(c, .045).add(new THREE.Vector3(0, 0, trim)));
  const top = c.clone().add(new THREE.Vector3(0, 0, ridge));
  const back = rim.map(p => p.clone().add(new THREE.Vector3(0, 0, -.004)));
  for (let i = 0; i < rim.length; i++) {
    const k = (i + 1) % rim.length;
    tri(inner[i]!, inner[k]!, top, 0); tri(rim[i]!, rim[k]!, inner[k]!, 1); tri(rim[i]!, inner[k]!, inner[i]!, 1);
    tri(rim[k]!, rim[i]!, back[i]!, 1); tri(rim[k]!, back[i]!, back[k]!, 1);
    tri(back[k]!, back[i]!, c.clone().add(new THREE.Vector3(0, 0, -.004)), 0);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (let i = 0; i < groups.length; i++) geo.addGroup(i * 3, 3, groups[i]!);
  geo.computeVertexNormals(); return mesh(g, name, geo, [mat.blue, mat.steel]);
}
function band(g: THREE.Group, name: string, y: number, rx: number, rz: number, width: number, mat: THREE.Material, z = 0) {
  return shell(g, name, [[y - width / 2, rx, rz, z], [y + width / 2, rx, rz, z]], mat);
}
function buckle(g: THREE.Group, name: string, x: number, y: number, z: number, m: Mats, size = .022) {
  mesh(g, name + ' leather tab', new THREE.BoxGeometry(size * 2.3, size * .67, .004), m.leather, [x, y, z]);
  for (const s of [-1, 1]) {
    line(g, name + ' frame vertical', [x + s * size / 2, y - size * .36, z + .004], [x + s * size / 2, y + size * .36, z + .004], .0018, m.bronze);
    line(g, name + ' frame horizontal', [x - size / 2, y + s * size * .36, z + .004], [x + size / 2, y + s * size * .36, z + .004], .0018, m.bronze);
  }
  line(g, name + ' tongue', [x, y, z + .006], [x + size * .5, y, z + .006], .0013, m.steel);
  for (let i = 0; i < 3; i++) rivet(g, name + ' punched hole', [x - size * (.66 + i * .19), y, z + .0025], m.leather, .0013);
}
function helm(g: THREE.Group, m: Mats) {
  shell(g, 'Closed rounded six course crown', [[1.665, .106, .123, -.012], [1.728, .108, .12, -.017], [1.782, .091, .104, -.022], [1.818, .06, .071, -.024], [1.835, .003, .004, -.025]], m.blue, 0, Math.PI * 2, 32);
  shell(g, 'Back and cheek wrap open under chin', [[1.54, .111, .119, -.012], [1.59, .105, .115, -.014], [1.67, .107, .12, -.012]], m.blue, .93, Math.PI * 2 - .93, 26);
  band(g, 'Leather neck opening', 1.541, .107, .115, .027, m.leather, -.012);
  band(g, 'Flared steel gorget rim', 1.525, .118, .126, .007, m.steel, -.012);
  plate(g, 'Massive angular stone cutter brow visor', [[-.105, 1.68, .087], [-.109, 1.726, .085], [0, 1.748, .153], [.109, 1.726, .085], [.105, 1.68, .087], [0, 1.676, .163]], m, .008);
  plate(g, 'Ridged closed chin and lower face', [[-.092, 1.655, .093], [0, 1.65, .15], [.092, 1.655, .093], [.09, 1.554, .099], [0, 1.533, .167], [-.09, 1.554, .099]], m, .011);
  // The visor and chin do not meet: their gap is the real horizontal eye aperture.
  for (const s of [-1, 1]) {
    plate(g, 'Angular hinged cheek strap', [[s * .101, 1.706, .082], [s * .113, 1.704, .048], [s * .113, 1.57, .045], [s * .103, 1.55, .082]], m, .002);
    for (const y of [1.582, 1.63, 1.704]) rivet(g, 'Cheek steel fastener', [s * .111, y, .084], m.steel, .005);
    const hinge = mesh(g, 'Circular visor pivot', new THREE.CylinderGeometry(.013, .013, .009, 16), m.steel, [s * .113, 1.696, .035]); hinge.rotation.z = Math.PI / 2;
    const cap = mesh(g, 'Pivot dark center', new THREE.CylinderGeometry(.008, .008, .011, 12), m.bronze, [s * .116, 1.696, .035]); cap.rotation.z = Math.PI / 2;
  }
  const path: P[] = [[0, 1.735, .11], [0, 1.79, .075], [0, 1.834, .004], [0, 1.828, -.072], [0, 1.783, -.12], [0, 1.68, -.136]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!;
    for (const s of [-1, 1]) line(g, 'Crown raised strip polished edge', [s * .014, a[1], a[2]], [s * .014, b[1], b[2]], .0023, m.steel);
    line(g, 'Crown reinforcing cobalt ridge', a, b, .012, m.blue);
  }
}
function torso(g: THREE.Group, m: Mats) {
  shell(g, 'Fitted leather cuirass lower lining', [[1.04, .15, .113], [1.16, .153, .121], [1.34, .191, .133]], m.leather);
  shell(g, 'Cobalt fitted cuirass body', [[1.06, .157, .12], [1.17, .159, .134], [1.32, .196, .147], [1.365, .185, .14]], m.blue, 0, Math.PI * 2, 16);
  for (const back of [false, true]) {
    const part = new THREE.Group(); part.name = back ? 'Articulated rear cuirass' : 'Faceted breastplate'; g.add(part); if (back) part.rotation.y = Math.PI;
    plate(part, 'Breast main pointed facets', [[-.167, 1.362, .075], [-.117, 1.445, .088], [0, 1.468, .12], [.117, 1.445, .088], [.167, 1.362, .075], [.143, 1.106, .083], [0, 1.065, .157], [-.143, 1.106, .083]], m, .026);
    plate(part, 'Upper overlapping breast chevron', [[-.149, 1.376, .111], [-.113, 1.437, .102], [0, 1.454, .133], [.113, 1.437, .102], [.149, 1.376, .111], [0, 1.329, .175]], m, .008);
    line(part, 'Central polished sternum arris', [0, 1.073, .162], [0, 1.451, .14], .0025, m.steel);
    for (const s of [-1, 1]) for (const y of [1.14, 1.25, 1.368]) rivet(part, 'Cuirass edge rivet', [s * .148, y, .116], m.steel);
    for (let k = 0; k < 3; k++) {
      const y = 1.077 - k * .035;
      plate(part, 'Overlapping fauld lame ' + k, [[-.159 - k * .008, y + .024, .08], [0, y, .151], [.159 + k * .008, y + .024, .08], [.167 + k * .008, y - .017, .086], [0, y - .041, .158], [-.167 - k * .008, y - .017, .086]], m, .004);
      for (const s of [-1, 1]) rivet(part, 'Fauld articulation rivet', [s * .139, y - .01, .108], m.steel, .004);
    }
  }
  shell(g, 'High hollow cobalt gorget', [[1.448, .094, .094, -.02], [1.495, .083, .083, -.024]], m.blue);
  band(g, 'Collar leather inner return', 1.492, .078, .078, .021, m.leather, -.024);
  band(g, 'Collar rolled silver rim', 1.497, .084, .084, .004, m.steel, -.024);
  for (const s of [-1, 1]) {
    for (const y of [1.14, 1.231]) buckle(g, 'Cuirass side closure', s * .167, y, .082, m, .028);
    const shoulder = new THREE.Group(); shoulder.name = 'Layered open shoulder ' + s; shoulder.position.set(s * .174, 1.451, -.05); shoulder.rotation.z = -s * Math.PI / 2; g.add(shoulder);
    for (let k = 0; k < 3; k++) {
      shell(shoulder, 'Overlapping curved shoulder lame ' + k, [[k * .04, .103 - k * .009, .118 - k * .008], [k * .04 + .058, .094 - k * .01, .105 - k * .007]], m.blue, -Math.PI * .57, Math.PI * .57, 16);
      shell(shoulder, 'Shoulder silver rolled end ' + k, [[k * .04 + .054, .096 - k * .01, .107 - k * .007], [k * .04 + .059, .096 - k * .01, .107 - k * .007]], m.steel, -Math.PI * .57, Math.PI * .57, 16);
      for (const a of [-1.3, 1.3]) rivet(shoulder, 'Shoulder fixing', [Math.sin(a) * (.1 - k * .009), k * .04 + .035, Math.cos(a) * (.118 - k * .008)], m.steel, .005, [Math.sin(a), 0, Math.cos(a)]);
    }
  }
}
function legs(g: THREE.Group, m: Mats) {
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.name = 'Hinged full leg ' + s; leg.position.set(s * .1143, 0, -.0361); g.add(leg);
    shell(leg, 'Open thigh leather lining', [[.61, .073, .077], [.77, .095, .093], [.92, .106, .105]], m.leather);
    shell(leg, 'Thigh wrap plate', [[.615, .076, .081], [.77, .098, .099], [.919, .109, .11]], m.blue, 0, Math.PI * 2, 16);
    plate(leg, 'Thigh pointed front shield', [[-.065, .914, .089], [0, .926, .116], [.065, .914, .089], [.064, .652, .081], [0, .603, .097], [-.064, .652, .081]], m, .013);
    shell(leg, 'Tapered calf lined clamshell', [[.17, .052, .062], [.285, .056, .064], [.42, .076, .078], [.482, .069, .078]], m.leather);
    shell(leg, 'Calf rear cobalt return', [[.176, .056, .066], [.29, .06, .069], [.421, .081, .083], [.48, .074, .083]], m.blue, 0, Math.PI * 2, 16);
    plate(leg, 'Long ridged shin plate', [[-.06, .481, .075], [0, .455, .104], [.06, .481, .075], [.047, .208, .06], [.037, .162, .071], [0, .188, .09], [-.037, .162, .071], [-.047, .208, .06]], m, .015);
    line(leg, 'Shin bright central arris', [0, .192, .094], [0, .455, .109], .002, m.steel);
    for (const [y, w, z] of [[.586, .064, .094], [.541, .071, .102], [.496, .061, .091]]) {
      plate(leg, 'Overlapping pointed knee lame', [[-w!, y! + .04, z! - .025], [0, y! + .053, z!], [w!, y! + .04, z! - .025], [w! * .8, y! - .01, z!], [0, y! - .047, z! + .016], [-w! * .8, y! - .01, z!]], m, .013);
    }
    for (const side of [-1, 1]) {
      const hinge = mesh(leg, 'Knee circular joint boss', new THREE.CylinderGeometry(.024, .024, .013, 20), m.steel, [side * .079, .544, .003]); hinge.rotation.z = Math.PI / 2;
      const disk = mesh(leg, 'Knee inset pivot', new THREE.CylinderGeometry(.015, .015, .015, 16), m.blue, [side * .08, .544, .003]); disk.rotation.z = Math.PI / 2;
    }
    for (const [y, r] of [[.842, .108], [.711, .094], [.415, .081], [.256, .06]]) {
      band(leg, 'Leather clamshell fastening strap', y!, r! + .002, r! + .003, .022, m.leather);
      buckle(leg, 'Leg side buckle', s * (r! * .68), y!, r! * .78 + .004, m, .018);
      rivet(leg, 'Front shell fastening', [-s * (r! * .63), y!, r! * .85], m.steel, .004);
    }
    band(leg, 'Thigh lip silver edge', .921, .11, .111, .005, m.steel);
  }
}
function boots(g: THREE.Group, m: Mats) {
  for (const s of [-1, 1]) {
    const boot = new THREE.Group(); boot.name = 'Cleated boot ' + s; boot.position.x = s * .1143; g.add(boot);
    // A swept foot volume with a closed toe and a separate open ankle shaft.
    const foot = shell(boot, 'Leather shaped foot and sole', [[.02, .055, .105], [.025, .067, .123], [.057, .067, .128], [.09, .061, .115], [.113, .045, .072], [.122, .001, .001]], m.leather, 0, Math.PI * 2, 24);
    foot.position.z = .005;
    band(boot, 'Thick black sole welt', .028, .07, .135, .022, m.leather, .007);
    const sole = mesh(boot, 'Closed leather outsole underside', new THREE.CylinderGeometry(1, 1, .012, 24), m.leather, [0, .02, .007]); sole.scale.set(.069, 1, .134);
    band(boot, 'Steel sole perimeter', .043, .071, .136, .005, m.steel, .007);
    shell(boot, 'Hollow ankle leather upper', [[.072, .052, .064, -.068], [.17, .056, .064, -.067], [.278, .062, .068, -.066]], m.leather);
    shell(boot, 'Cobalt heel counter', [[.049, .06, .065, -.068], [.126, .058, .064, -.068], [.177, .054, .063, -.068]], m.blue, 1.25, Math.PI * 2 - 1.25, 16);
    shell(boot, 'Flared cobalt ankle cuff', [[.202, .058, .067, -.066], [.28, .066, .074, -.066]], m.blue);
    band(boot, 'Ankle silver opening lip', .281, .067, .075, .005, m.steel, -.066);
    band(boot, 'Leather inner cuff return', .277, .061, .069, .012, m.leather, -.066);
    plate(boot, 'Faceted broad toe cap', [[-.059, .047, .093], [-.05, .077, .123], [0, .088, .14], [.05, .077, .123], [.059, .047, .093], [.052, .047, .051], [0, .09, .056], [-.052, .047, .051]], m, .002);
    for (let k = 0; k < 3; k++) {
      const lame = shell(boot, 'Overlapping instep sabaton lame ' + k, [[0, .061 - k * .002, .055], [.045, .057 - k * .002, .054]], m.blue, -Math.PI / 2, Math.PI / 2, 16);
      lame.rotation.x = Math.PI / 2 - .34; lame.position.set(0, .074 + k * .03, .072 - k * .042);
      const edge = shell(boot, 'Instep silver edge ' + k, [[-.002, .062 - k * .002, .056], [.001, .062 - k * .002, .056]], m.steel, -Math.PI / 2, Math.PI / 2, 16); edge.rotation.copy(lame.rotation); edge.position.copy(lame.position);
      for (const side of [-1, 1]) rivet(boot, 'Instep lateral rivet', [side * .052, .093 + k * .026, .075 - k * .042], m.steel, .005);
    }
    band(boot, 'Cuff leather buckle belt', .249, .068, .075, .026, m.leather, -.066);
    buckle(boot, 'Ankle buckle', s * .044, .249, -.005, m, .023);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, x = Math.sin(a) * .058, z = .007 + Math.cos(a) * .119;
      const cleat = mesh(boot, 'Stone gripping steel cleat ' + k, new THREE.BoxGeometry(.018, .023, .022), m.steel, [x, .0115, z]); cleat.rotation.y = a;
    }
    for (let k = 0; k < 12; k++) for (const side of [-1, 1]) line(boot, 'Leather ankle seam stitch', [side * .052, .095 + k * .011, -.022], [side * .052, .099 + k * .011, -.025], .0006, m.thread);
  }
}
function gloves(g: THREE.Group, m: Mats) {
  for (const s of [-1, 1]) {
    const hand = new THREE.Group(); hand.name = 'Garnet gauntlet native T pose ' + s; hand.position.set(s * .7065, 1.4555, -.0654); hand.rotation.z = -s * Math.PI / 2; g.add(hand);
    // Local +Y runs from wrist toward fingers; +Z is the back plate normal.
    shell(hand, 'Open leather wrist and flared cuff', [[-.134, .061, .05], [-.087, .052, .043], [-.028, .038, .032], [.006, .035, .027]], m.leather);
    shell(hand, 'Fluted cobalt vambrace', [[-.137, .064, .053], [-.102, .058, .048], [-.043, .041, .036], [-.025, .042, .035]], m.blue, 0, Math.PI * 2, 16);
    for (const [y, rx, rz] of [[-.134, .065, .054], [-.03, .043, .036]]) {
      band(hand, 'Silver cuff rolled edge', y!, rx!, rz!, .004, m.steel);
      for (let k = 0; k < 5; k++) {
        const a = (k - 2) * .62, p: P = [Math.sin(a) * rx!, y!, Math.cos(a) * rz!];
        rivet(hand, 'Garnet silver cuff bezel', p, m.steel, .007, [Math.sin(a), 0, Math.cos(a)]);
        rivet(hand, 'Set red cuff garnet', [p[0] + Math.sin(a) * .002, p[1], p[2] + Math.cos(a) * .002], m.gem, .0054, [Math.sin(a), 0, Math.cos(a)]);
      }
    }
    const palm = mesh(hand, 'Solid leather palm', new THREE.SphereGeometry(1, 16, 12), m.leather, [0, .029, 0]); palm.scale.set(.041, .057, .022);
    plate(hand, 'Angular back of hand shield', [[-.038, .009, .022], [-.03, -.016, .031], [.03, -.016, .031], [.04, .027, .026], [.034, .071, .026], [-.035, .071, .026]], m, .006);
    for (let finger = 0; finger < 4; finger++) {
      const x = (finger - 1.5) * .02, length = [.06, .079, .082, .067][finger]!;
      plate(hand, 'Faceted knuckle shield ' + finger, [[x - .01, .046, .03], [x, .036, .04], [x + .01, .047, .03], [x + .009, .075, .027], [x, .085, .032], [x - .009, .075, .027]], m, .004);
      rivet(hand, 'Knuckle silver garnet bezel', [x, .069, .04], m.steel, .006);
      rivet(hand, 'Red garnet knuckle rivet', [x, .069, .043], m.gem, .0048);
      for (let part = 0; part < 3; part++) {
        const y = .075 + part * length / 3, len = length / 3 - .002;
        const skin = mesh(hand, 'Separate leather finger ' + finger + ' phalanx ' + part, new THREE.CapsuleGeometry(.009, len - .008, 3, 8), m.leather, [x, y + len / 2, -.002 - part * .002]); skin.rotation.x = -.06 * part;
        plate(hand, 'Articulated cobalt finger scale ' + finger + '/' + part, [[x - .009, y, .014 - part * .002], [x + .009, y, .014 - part * .002], [x + .008, y + len, .013 - part * .002], [x, y + len + .004, .016 - part * .002], [x - .008, y + len, .013 - part * .002]], m, .004);
      }
    }
    const thumb = new THREE.Group(); thumb.name = 'Separate opposed armored thumb'; hand.add(thumb); thumb.position.set(-s * .039, .019, -.008); thumb.rotation.z = s * .66;
    for (let i = 0; i < 3; i++) {
      mesh(thumb, 'Leather thumb joint ' + i, new THREE.CapsuleGeometry(.012, .013, 3, 8), m.leather, [0, .011 + i * .024, 0]);
      plate(thumb, 'Thumb overlapping cobalt scale ' + i, [[-.012, i * .024, .009], [.012, i * .024, .009], [.011, i * .024 + .023, .011], [0, i * .024 + .03, .014], [-.011, i * .024 + .023, .011]], m, .004);
    }
    rivet(thumb, 'Thumb garnet silver bezel', [0, .012, .017], m.steel, .006); rivet(thumb, 'Thumb red garnet', [0, .012, .02], m.gem, .0045);
  }
}
const descriptions: Record<string, string> = {
  kaldite_helm: "A closed helm with a stone-cutter's brow ridge.",
  kaldite_plate: 'Three bars of Cobalt. Quarry crews were buried in these, which is not a selling point.',
  kaldite_greaves: 'Full leg plate, hinged at the knee.',
  kaldite_boots: 'Cleated for wet cairn stone.',
  kaldite_gauntlets: 'Cobalt over the knuckle, garnet rivets. Loud.',
};
export const author: ItemModelAuthor = {
  ids: ['kaldite_helm', 'kaldite_plate', 'kaldite_greaves', 'kaldite_boots', 'kaldite_gauntlets'],
  build(id) {
    if (!this.ids.includes(id)) throw new Error('Unknown Kaldite armor: ' + id);
    const g = new THREE.Group(); g.name = id; const m = materials();
    ({ kaldite_helm: helm, kaldite_plate: torso, kaldite_greaves: legs, kaldite_boots: boots, kaldite_gauntlets: gloves }[id]!)(g, m);
    g.userData.itemModel = { itemId: id, author: 'armor-kaldite', reference: `art/item-icons/generated/${id}.png`, description: descriptions[id]!, wearable: true };
    return g;
  },
};
