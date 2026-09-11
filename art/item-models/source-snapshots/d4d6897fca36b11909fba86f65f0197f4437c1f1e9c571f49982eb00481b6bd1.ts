import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type P = readonly [number, number, number];
type Surface = (u: number, v: number) => THREE.Vector3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ids = ['emberite_helm', 'emberite_plate', 'emberite_greaves', 'emberite_boots', 'emberite_gauntlets'] as const;

function texture(kind: 'metal' | 'leather' | 'normal' | 'rough'): THREE.DataTexture {
  const n = 256, data = new Uint8Array(n * n * 4);
  const rand = (x: number, y: number) => { const f = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return f - Math.floor(f); };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, grain = rand(x, y), wave = Math.sin(x * .028 + Math.sin(y * .034) * 2.3);
    const heat = Math.pow(Math.max(0, wave), 5), scratch = Math.abs(Math.sin(x * .47 + y * .79 + Math.sin(y * .037) * 4)) < .018;
    let c: number[];
    if (kind === 'normal') c = [128 + 4 * Math.sin(x * .22) * Math.cos(y * .18), 128 + 4 * Math.cos(x * .22) * Math.sin(y * .18), 255];
    else if (kind === 'rough') c = [170 + grain * 25, 170 + grain * 25, 170 + grain * 25];
    else if (kind === 'leather') c = [43 + grain * 15, 29 + grain * 11, 22 + grain * 9];
    else { const k = .9 + grain * .15 + (scratch ? .14 : 0); c = [(105 + heat * 55) * k, (128 - heat * 8) * k, (151 - heat * 37) * k]; }
    for (let j = 0; j < 3; j++) data[i + j] = Math.round(c[j]!); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.name = `titanium-${kind}-fine-forging`;
  t.colorSpace = kind === 'metal' || kind === 'leather' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}

export const author: ItemModelAuthor = {
  ids,
  build(id) {
    if (!(ids as readonly string[]).includes(id)) throw new Error(`Unsupported titanium armor ${id}`);
    const root = new THREE.Group(); root.name = `${id}-native-male-tpose`;
    root.userData.itemModel = { itemId: id, author: 'armor-emberite', reference: `art/item-icons/generated/${id}.png`, wearable: true,
      description: 'Smoke-blue tempered titanium plate with silver bevels, heat-stained forging, hollow leather-lined openings, articulated lames and riveted buckled fastenings. Gauntlets carry inset fire opals.' };
    const metal = new THREE.MeshPhysicalMaterial({ name: 'smoke-blued-heat-tempered-titanium', map: texture('metal'), normalMap: texture('normal'), roughnessMap: texture('rough'), metalness: .87, roughness: .46, clearcoat: .19, clearcoatRoughness: .3 });
    const trim = new THREE.MeshStandardMaterial({ name: 'worn-bright-silver-titanium-bevels', color: '#b6b3aa', metalness: .9, roughness: .3 });
    const inner = new THREE.MeshStandardMaterial({ name: 'dark-forged-inner-plate', color: '#272c32', metalness: .62, roughness: .63 });
    const leather = new THREE.MeshStandardMaterial({ name: 'dark-brown-pebbled-hide', map: texture('leather'), roughness: .86 });
    const brass = new THREE.MeshStandardMaterial({ name: 'warm-titanium-rivet-and-buckle', color: '#a89a7c', metalness: .83, roughness: .31 });
    const opal = new THREE.MeshPhysicalMaterial({ name: 'orange-fire-opal-cabochon', color: '#ff610a', emissive: '#a71e00', emissiveIntensity: .12, metalness: .12, roughness: .17, clearcoat: 1 });
    const stitch = new THREE.MeshStandardMaterial({ name: 'waxed-tan-saddle-thread', color: '#a98558', roughness: .9 });
    const sole = new THREE.MeshStandardMaterial({ name: 'compressed-dark-hide-sole', color: '#251e19', roughness: .95 });
    function mesh(name: string, g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]) { const a = new THREE.Mesh(g, m); a.name = name; a.castShadow = a.receiveShadow = true; root.add(a); return a; }
    function line(name: string, points: THREE.Vector3[], r = .002, mat: THREE.Material = trim, smooth = false) {
      const curve = smooth ? new THREE.CatmullRomCurve3(points) : new THREE.CurvePath<THREE.Vector3>();
      if (curve instanceof THREE.CurvePath) for (let i = 1; i < points.length; i++) curve.add(new THREE.LineCurve3(points[i - 1]!, points[i]!));
      return mesh(name, new THREE.TubeGeometry(curve, Math.max(3, points.length * 2), r, 5, false), mat);
    }
    function stud(name: string, p: P, r = .004, gem = false, normal = V(0, 0, 1)) {
      const m = mesh(name, new THREE.SphereGeometry(r, 10, 6), gem ? opal : brass); m.scale.z = .52; m.quaternion.setFromUnitVectors(V(0, 0, 1), normal); m.position.set(...p);
      if (gem) { const t = mesh(`${name}-silver-bezel`, new THREE.TorusGeometry(r * 1.13, r * .2, 5, 12), brass); t.position.set(...p); t.quaternion.copy(m.quaternion); }
    }
    // Thin closed walls following a curved sheet. Holes are genuinely omitted cells,
    // with inner faces and cut-edge walls, rather than black overlays.
    function shell(name: string, s: Surface, nx = 24, ny = 6, thickness = .003, mat: THREE.Material = metal, omit?: (i: number, j: number) => boolean) {
      const pos: number[] = [], uv: number[] = [], index: number[] = [], count = (nx + 1) * (ny + 1);
      for (let l = 0; l < 2; l++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const u = i / nx, v = j / ny, p = s(u, v);
        const du = s(Math.min(1, u + .001), v).sub(s(Math.max(0, u - .001), v));
        const dv = s(u, Math.min(1, v + .001)).sub(s(u, Math.max(0, v - .001)));
        p.addScaledVector(du.cross(dv).normalize(), -l * thickness); pos.push(p.x, p.y, p.z); uv.push(u, v);
      }
      const absent = (i: number, j: number) => i < 0 || j < 0 || i >= nx || j >= ny || !!omit?.(i, j);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!absent(i, j)) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; index.push(a, b, c, b, d, c); }
      const outerCount = index.length;
      for (let i = 0; i < outerCount; i += 3) index.push(index[i]! + count, index[i + 2]! + count, index[i + 1]! + count);
      const wall = (a: number, b: number) => index.push(a, a + count, b, b, a + count, b + count);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!absent(i, j)) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        if (absent(i, j - 1)) wall(b, a); if (absent(i, j + 1)) wall(c, d); if (absent(i - 1, j)) wall(a, c); if (absent(i + 1, j)) wall(d, b);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeVertexNormals();
      g.addGroup(0, outerCount, 0); g.addGroup(outerCount, outerCount, 1); g.addGroup(outerCount * 2, index.length - outerCount * 2, 2); return mesh(name, g, [mat, mat === metal ? inner : mat, mat === metal ? trim : mat]);
    }
    function edgedShell(name: string, s: Surface, nx = 24, ny = 6, mat: THREE.Material = metal, radius = .002) {
      shell(name, s, nx, ny, .003, mat);
      for (const v of [0, 1]) line(`${name}-rolled-${v}`, Array.from({ length: nx + 1 }, (_, i) => s(i / nx, v)), radius, mat === metal ? trim : stitch);
    }
    function ring(name: string, x: number, y: number, z: number, rx: number, rz: number, h: number, mat: THREE.Material = leather) {
      const s: Surface = (u, v) => V(x + Math.sin(u * Math.PI * 2) * rx, y + (v - .5) * h, z + Math.cos(u * Math.PI * 2) * rz);
      shell(name, s, 32, 1, .003, mat); return s;
    }
    function buckle(name: string, x: number, y: number, z: number, w = .029, h = .034) {
      line(`${name}-frame`, [V(x - w / 2, y - h / 2, z), V(x + w / 2, y - h / 2, z), V(x + w / 2, y + h / 2, z), V(x - w / 2, y + h / 2, z), V(x - w / 2, y - h / 2, z)], .0025, brass);
      line(`${name}-tongue`, [V(x, y, z + .001), V(x + w * .55, y, z + .001)], .0015, brass);
    }
    // Convex forged polygon: a broad silver bevel surrounds the inset faceted face.
    function plate(name: string, boundary: P[], center: P, bevel = .009, mat: THREE.Material = metal) {
      const c = V(...center), vertices = boundary.map(p => V(...p));
      const area = vertices.reduce((sum, p, i) => { const q = vertices[(i + 1) % vertices.length]!; return sum + p.x * q.y - q.x * p.y; }, 0);
      if (area < 0) vertices.reverse();
      const inside = vertices.map(p => p.clone().lerp(c, bevel / Math.max(.02, p.distanceTo(c))));
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      const add = (p: THREE.Vector3) => { positions.push(p.x, p.y, p.z); uvs.push(p.x * 4, p.y * 4); };
      add(c); inside.forEach(add); vertices.forEach(add); vertices.forEach(p => add(p.clone().add(V(0, 0, -.004))));
      const n = vertices.length;
      for (let i = 0; i < n; i++) indices.push(0, i + 1, (i + 1) % n + 1);
      const faceCount = indices.length;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(i + 1, n + i + 1, n + j + 1, i + 1, n + j + 1, j + 1); }
      const trimCount = indices.length - faceCount;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(n + i + 1, 2 * n + i + 1, 2 * n + j + 1, n + i + 1, 2 * n + j + 1, n + j + 1); if (i > 0 && i < n - 1) indices.push(2 * n + 1, 2 * n + j + 1, 2 * n + i + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(indices); g.computeVertexNormals(); g.addGroup(0, faceCount, 0); g.addGroup(faceCount, trimCount, 1); g.addGroup(faceCount + trimCount, indices.length - faceCount - trimCount, 2); return mesh(name, g, [mat, trim, inner]);
    }
    function limb(name: string, x: number, low: number, high: number, r0: number, r1: number, z = -.036) {
      const s: Surface = (u, v) => { const a = -.92 * Math.PI + u * 1.84 * Math.PI, r = r0 + (r1 - r0) * v; return V(x + Math.sin(a) * r, low + (high - low) * v, z + Math.cos(a) * r * .94); };
      edgedShell(`${name}-hollow-wrap`, s, 32, 7);
      for (const u of [0, 1]) line(`${name}-rear-seam-${u}`, Array.from({ length: 8 }, (_, j) => s(u, j / 7)), .002);
      return s;
    }

    if (id === 'emberite_helm') {
      const dome: Surface = (u, v) => { const a = u * Math.PI * 2, phi = 1.485 - v * 1.44; return V(Math.sin(a) * Math.sin(phi) * .108, 1.683 + Math.cos(phi) * .155, -.012 + Math.cos(a) * Math.sin(phi) * .132); };
      const hole = (i: number, j: number) => j >= 4 && j <= 8 && [3, 4, 8, 9, 14, 15, 44, 45, 50, 51, 55, 56].includes(i);
      shell('vented-rounded-smoke-crown', dome, 60, 15, .004, metal, hole);
      for (const start of [3, 8, 14, 44, 50, 55]) {
        const pts = [dome(start / 60, 4 / 15), dome((start + 2) / 60, 4 / 15), dome((start + 2) / 60, 9 / 15), dome(start / 60, 9 / 15), dome(start / 60, 4 / 15)];
        line(`smoke-vent-${start}-cut-rim`, pts, .0014);
      }
      // Rear skull and cheek enclosure leaves the eye slit and underside open.
      edgedShell('rear-skull-neck-shell', (u, v) => { const a = .94 + u * (Math.PI * 2 - 1.88); return V(Math.sin(a) * (.112 + .006 * (1 - v)), 1.548 + v * .163, -.016 + Math.cos(a) * .126); }, 40, 9);
      plate('brow-ridged-visor', [[-.106, 1.706, .076], [-.079, 1.766, .107], [0, 1.789, .12], [.079, 1.766, .107], [.106, 1.706, .076], [0, 1.691, .162]], [0, 1.738, .16], .007);
      for (const side of [-1, 1]) {
        plate(`visor-cheek-${side}`, [[side * .004, 1.671, .163], [side * .099, 1.69, .088], [side * .113, 1.588, .075], [side * .008, 1.543, .145]], [side * .053, 1.625, .143], .006);
        line(`eye-slit-upper-${side}`, [V(0, 1.691, .163), V(side * .101, 1.71, .082)], .0028);
        line(`eye-slit-lower-${side}`, [V(.004 * side, 1.671, .165), V(side * .1, 1.69, .09)], .0028);
        stud(`temple-pivot-${side}`, [side * .113, 1.713, .042], .009, false, V(side, 0, .15).normalize());
        for (const y of [1.581, 1.609]) stud(`cheek-rivet-${side}-${y}`, [side * .09, y, .1], .0045);
      }
      line('central-visor-spine', [V(0, 1.788, .121), V(0, 1.74, .166), V(0, 1.691, .164), V(0, 1.672, .164), V(0, 1.542, .148)], .003);
      plate('brow-silver-lozenge', [[0, 1.793, .132], [.016, 1.756, .163], [0, 1.724, .169], [-.016, 1.756, .163]], [0, 1.753, .175], .007, trim);
      edgedShell('flared-articulated-neck-skirt', (u, v) => { const a = u * Math.PI * 2; return V(Math.sin(a) * (.133 - .017 * v), 1.522 + .039 * v, -.013 + Math.cos(a) * (.143 - .019 * v)); }, 40, 3);
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; stud(`skirt-rivet-${i}`, [Math.sin(a) * .129, 1.538, -.013 + Math.cos(a) * .139], .0038, false, V(Math.sin(a), 0, Math.cos(a))); }
      line('crown-raised-center-ridge', Array.from({ length: 20 }, (_, i) => { const a = -.1 + i / 19 * 2.9; return V(0, 1.683 + Math.sin(a) * .16, -.012 + Math.cos(a) * .134); }), .0035);
    }

    if (id === 'emberite_plate') {
      const torso: Surface = (u, v) => { const a = u * Math.PI * 2, rx = .141 + .045 * Math.sin(v * Math.PI * .68), rz = .114 + .043 * Math.sin(v * Math.PI * .8); return V(Math.sin(a) * rx, 1.025 + v * .357, -.014 + Math.cos(a) * rz); };
      edgedShell('cuirass-fitted-hollow-waist-and-chest', torso, 48, 12);
      plate('anatomical-ridged-breastplate', [[-.17, 1.354, .084], [-.102, 1.46, .087], [0, 1.423, .14], [.102, 1.46, .087], [.17, 1.354, .084], [.139, 1.19, .103], [0, 1.118, .137], [-.139, 1.19, .103]], [0, 1.323, .19], .012);
      plate('sternum-silver-spear', [[0, 1.446, .139], [.025, 1.405, .167], [.016, 1.344, .19], [0, 1.29, .197], [-.016, 1.344, .19], [-.025, 1.405, .167]], [0, 1.368, .197], .007, trim);
      plate('lower-plackart', [[-.14, 1.209, .107], [0, 1.138, .151], [.14, 1.209, .107], [.137, 1.076, .1], [0, 1.023, .129], [-.137, 1.076, .1]], [0, 1.102, .159], .009);
      const back = plate('shaped-full-backplate', [[-.157, 1.36, .12], [-.1, 1.463, .09], [.1, 1.463, .09], [.157, 1.36, .12], [.137, 1.071, .104], [0, 1.045, .123], [-.137, 1.071, .104]], [0, 1.28, .157], .01); back.scale.z = -1; back.position.z = -.025;
      edgedShell('open-throat-gorget', (u, v) => { const a = u * Math.PI * 2; return V(Math.sin(a) * (.112 - v * .012), 1.428 + v * .061 - .025 * Math.cos(a), -.024 + Math.cos(a) * (.105 - v * .017)); }, 40, 5);
      for (const side of [-1, 1]) {
        for (let j = 0; j < 4; j++) {
          const start = .162 + j * .041, length = j === 0 ? .103 : .069, radius = .109 - j * .014;
          // The pauldrons follow sideways upper arms in the native T-pose.
          const s: Surface = (u, v) => { const a = -.12 * Math.PI + (side > 0 ? 1 - u : u) * 1.24 * Math.PI; return V(side * (start + v * length), 1.45 + Math.sin(a) * radius + .012 * (1 - v), -.065 + Math.cos(a) * radius); };
          edgedShell(`pauldron-${side}-articulated-lame-${j}`, s, 24, 4);
          for (const u of [.13, .85]) { const p = s(u, .86); stud(`shoulder-${side}-${j}-${u}`, [p.x, p.y, p.z], .004, false, V(0, Math.sin(-.12 * Math.PI + u * 1.24 * Math.PI), Math.cos(-.12 * Math.PI + u * 1.24 * Math.PI))); }
        }
        for (const y of [1.11, 1.2, 1.3]) {
          const strap = mesh(`side-leather-strap-${side}-${y}`, new THREE.BoxGeometry(.047, .027, .007), leather); strap.position.set(side * .147, y, .095); buckle(`side-buckle-${side}-${y}`, side * .148, y, .104, .027, .032);
          stud(`side-fastener-${side}-${y}`, [side * .123, y, .116], .004);
        }
        const strap = mesh(`shoulder-bridge-hide-${side}`, new THREE.BoxGeometry(.032, .009, .18), leather); strap.position.set(side * .121, 1.457, -.017);
        buckle(`collar-strap-buckle-${side}`, side * .12, 1.443, .083, .027, .032);
        for (let j = 0; j < 4; j++) {
          const top = 1.043 - j * .044;
          plate(`fauld-${side}-overlapping-tasset-${j}`, [[side * .022, top, .127], [side * .153, top + .02, .096], [side * (.169 + j * .005), top - .055, .106], [side * .026, top - .07, .148]], [side * .09, top - .028, .146], .006);
          stud(`fauld-rivet-${side}-${j}`, [side * .146, top - .032, .119], .004);
          const rear = plate(`rear-fauld-${side}-${j}`, [[side * .018, top, .13], [side * .151, top + .01, .1], [side * .17, top - .058, .106], [side * .021, top - .065, .139]], [side * .08, top - .03, .143], .005); rear.scale.z = -1; rear.position.z = -.028;
        }
      }
    }

    if (id === 'emberite_greaves') {
      for (const side of [-1, 1]) {
        const x = side * .1143;
        limb(`thigh-${side}`, x, .601, .927, .077, .094);
        plate(`thigh-${side}-pointed-front`, [[x - .065, .87, .031], [x, .914, .057], [x + .065, .87, .031], [x + .059, .664, .031], [x, .608, .054], [x - .059, .664, .031]], [x, .759, .071], .008);
        for (let j = 0; j < 2; j++) {
          edgedShell(`thigh-${side}-diagonal-crown-lame-${j}`, (u, v) => { const a = -.95 + u * 1.9; return V(x + Math.sin(a) * .094, .884 - j * .069 + v * .042 + Math.sin(a) * side * .029, -.036 + Math.cos(a) * .091); }, 20, 2);
        }
        for (const y of [.698, .846]) { ring(`thigh-${side}-wrap-strap-${y}`, x, y, -.036, .096, .092, .025); buckle(`thigh-${side}-buckle-${y}`, x + side * .063, y, .039, .026, .032); }
        limb(`shin-${side}`, x, .157, .495, .046, .073);
        plate(`shin-${side}-ridge-front`, [[x - .06, .479, .015], [x, .508, .045], [x + .06, .479, .015], [x + .038, .194, .007], [x, .159, .041], [x - .038, .194, .007]], [x, .332, .058], .006);
        for (const y of [.228, .385]) { ring(`calf-${side}-leather-strap-${y}`, x, y, -.036, y < .3 ? .053 : .07, y < .3 ? .053 : .068, .022); buckle(`calf-${side}-buckle-${y}`, x + side * .035, y, y < .3 ? .013 : .029, .021, .027); }
        for (const offset of [-.044, .047]) plate(`knee-${side}-sliding-lame-${offset}`, [[x - .062, .542 + offset + .025, .025], [x, .542 + offset + .04, .047], [x + .062, .542 + offset + .025, .025], [x + .05, .542 + offset - .018, .037], [x, .542 + offset - .038, .063], [x - .05, .542 + offset - .018, .037]], [x, .542 + offset, .071], .005);
        plate(`knee-${side}-faceted-poleyn`, [[x, .592, .045], [x + .067, .559, .025], [x + .057, .514, .035], [x, .487, .064], [x - .057, .514, .035], [x - .067, .559, .025]], [x, .545, .091], .006);
        for (const d of [-1, 1]) stud(`knee-${side}-hinge-${d}`, [x + d * .074, .542, -.013], .012, false, V(d, 0, 0));
        edgedShell(`ankle-${side}-flared-lame`, (u, v) => { const a = -1.24 + u * 2.48; return V(x + Math.sin(a) * (.055 - v * .007), .117 + .052 * v + .012 * Math.cos(a), -.031 + Math.cos(a) * (.075 - v * .02)); }, 24, 3);
      }
    }

    if (id === 'emberite_boots') {
      for (const side of [-1, 1]) {
        const x = side * .1143;
        // Profiled foot shells form a real rounded toe and raised heel, pointing +Z.
        const foot: Surface = (u, v) => { const a = -u * Math.PI * 2, z = -.132 + v * .339, width = .049 + .017 * Math.sin(v * Math.PI) - .012 * Math.pow(v, 8), height = .064 + .057 * Math.exp(-Math.pow((v - .19) / .25, 2)); return V(x + Math.sin(a) * width, .023 + (Math.cos(a) + 1) * height * .5, z); };
        shell(`boot-${side}-leather-foot`, foot, 28, 16, .004, leather);
        const soleShape = new THREE.Shape(); soleShape.moveTo(-.05, -.13); soleShape.bezierCurveTo(-.068, -.10, -.069, .14, -.052, .191); soleShape.bezierCurveTo(-.038, .222, .038, .222, .052, .191); soleShape.bezierCurveTo(.069, .14, .068, -.10, .05, -.13); soleShape.quadraticCurveTo(0, -.152, -.05, -.13);
        const g = new THREE.ExtrudeGeometry(soleShape, { depth: .021, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 1, steps: 1, curveSegments: 12 }); g.rotateX(Math.PI / 2); g.translate(x, .025, 0); mesh(`boot-${side}-thick-shaped-hide-outsole`, g, sole);
        const heel = mesh(`boot-${side}-stacked-heel`, new THREE.BoxGeometry(.1, .018, .082), sole); heel.position.set(x, .008, -.09);
        const shaft: Surface = (u, v) => { const a = u * Math.PI * 2, r = .051 + v * .016; return V(x + Math.sin(a) * r, .083 + v * .233, -.07 + Math.cos(a) * r * 1.03); };
        edgedShell(`boot-${side}-open-leather-shaft`, shaft, 32, 9, leather);
        limb(`boot-${side}-titanium-cuff`, x, .214, .329, .062, .071, -.068);
        plate(`boot-${side}-pointed-cuff-face`, [[x - .055, .32, -.023], [x, .333, .009], [x + .055, .32, -.023], [x + .051, .247, -.023], [x, .214, .014], [x - .051, .247, -.023]], [x, .277, .016], .006);
        for (const y of [.108, .216]) { ring(`boot-${side}-ankle-strap-${y}`, x, y, -.06, .068, .075, .025); buckle(`boot-${side}-buckle-${y}`, x + side * .035, y, .013, .028, .032); }
        // The overlapping instep plates wrap across the boot instead of flat cards.
        for (let j = 0; j < 5; j++) {
          const z0 = -.029 + j * .044, y0 = .118 - j * .013, rad = .059 + .004 * Math.sin(j);
          edgedShell(`boot-${side}-instep-articulation-${j}`, (u, v) => { const a = .49 * Math.PI - u * .98 * Math.PI; return V(x + Math.sin(a) * rad, .034 + Math.cos(a) * (y0 - .034) - v * .009, z0 + v * .061); }, 24, 3);
          for (const d of [-1, 1]) stud(`boot-${side}-lame-rivet-${j}-${d}`, [x + d * rad * .82, .034 + (y0 - .034) * .57, z0 + .039], .0035, false, V(d * .7, .7, .1).normalize());
        }
        // Rounded terminal toe cap closes the end of the foot shell.
        const toe = mesh(`boot-${side}-rounded-divided-toecap`, new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal); toe.scale.set(.058, .045, .068); toe.position.set(x, .028, .153);
        for (const d of [-.55, 0, .55]) line(`boot-${side}-toe-fluting-${d}`, [V(x + d * .045, .073 - Math.abs(d) * .006, .145), V(x + d * .045, .06 - Math.abs(d) * .004, .197), V(x + d * .038, .03, .213)], .0018);
        const outline = soleShape.getPoints(60);
        line(`boot-${side}-welt-piping`, outline.map(p => V(x + p.x, .028, p.y)), .0024, stitch);
        for (let j = 1; j < outline.length; j += 2) { const p = outline[j]!, q = outline[j - 1]!; line(`boot-${side}-welt-stitch-${j}`, [V(x + p.x * .988, .03, p.y), V(x + q.x * .988, .03, q.y)], .0011, stitch); }
      }
    }

    if (id === 'emberite_gauntlets') {
      for (const side of [-1, 1]) {
        const local = new THREE.Group(); local.name = `gauntlet-${side}-native-arm-axis`; const before = new Set(root.children);
        // Temporary local coordinates: +Y runs toward fingertips, +Z is the back
        // of the hand. Transformed to the native sideways arms at the end.
        const cuff: Surface = (u, v) => { const a = u * Math.PI * 2, r = .054 - v * .019; return V(Math.sin(a) * r, -.13 + v * .145, Math.cos(a) * r * .79); };
        edgedShell(`gauntlet-${side}-flared-open-cuff`, cuff, 32, 7);
        plate(`gauntlet-${side}-pointed-cuff-panel`, [[-.042, -.124, .03], [0, -.142, .041], [.042, -.124, .03], [.029, .014, .026], [0, .035, .037], [-.029, .014, .026]], [0, -.051, .051], .004);
        for (const d of [-1, 1]) for (const y of [-.111, -.005]) stud(`gauntlet-${side}-cuff-opal-${d}-${y}`, [d * (y < -.05 ? .04 : .026), y, .037], .0036, true);
        const palm: Surface = (u, v) => { const a = u * Math.PI * 2; return V(Math.sin(a) * (.032 + .008 * Math.sin(v * Math.PI)), -.007 + v * .094, Math.cos(a) * .02); };
        shell(`gauntlet-${side}-leather-palm`, palm, 24, 6, .003, leather);
        for (let j = 0; j < 3; j++) { const y = -.008 + j * .028; plate(`gauntlet-${side}-metacarpal-overlap-${j}`, [[-.031, y, .021], [0, y - .012, .032], [.031, y, .021], [.036, y + .033, .021], [0, y + .046, .034], [-.036, y + .033, .021]], [0, y + .016, .036], .003); }
        for (let f = 0; f < 4; f++) {
          const fx = -.0285 + f * .019, len = [.071, .088, .083, .066][f]!, start = .077;
          const fingers: Surface = (u, v) => { const a = u * Math.PI * 2; return V(fx + Math.sin(a) * .009, start + v * len, Math.cos(a) * .011 - v * .005); };
          shell(`gauntlet-${side}-finger-${f}-leather`, fingers, 12, 5, .002, leather);
          for (let j = 0; j < 3; j++) {
            const ya = start + j * len / 3, segment = len / 3;
            edgedShell(`gauntlet-${side}-finger-${f}-phalanx-${j}`, (u, v) => { const a = -1.72 + u * 3.44; return V(fx + Math.sin(a) * .0105, ya + v * segment * .94, Math.cos(a) * .013 - (j + v) / 3 * .005); }, 12, 3, metal, .0009);
          }
          plate(`gauntlet-${side}-knuckle-${f}`, [[fx - .009, .075, .022], [fx, .069, .03], [fx + .009, .075, .022], [fx + .008, .092, .02], [fx, .099, .023], [fx - .008, .092, .02]], [fx, .084, .031], .002);
          stud(`gauntlet-${side}-fire-opal-knuckle-${f}`, [fx, .083, .032], .0036, true);
          const tip = mesh(`gauntlet-${side}-finger-${f}-closed-tip`, new THREE.SphereGeometry(.0102, 12, 8), metal); tip.scale.set(1, 1.05, .95); tip.position.set(fx, start + len - .004, -.005);
        }
        for (let j = 0; j < 3; j++) {
          const y = .026 + j * .018, x = -.036 - j * .01;
          const t = mesh(`gauntlet-${side}-thumb-articulated-${j}`, new THREE.CapsuleGeometry(.012 - j * .001, .015, 3, 10), metal); t.position.set(x, y, -.007); t.rotation.z = .5;
          line(`gauntlet-${side}-thumb-joint-rim-${j}`, Array.from({ length: 13 }, (_, i) => { const a = i / 12 * Math.PI * 2; return V(x + Math.sin(a) * .012, y - .012, -.007 + Math.cos(a) * .012); }), .001);
        }
        for (const child of root.children.slice()) if (!before.has(child)) local.add(child);
        // Native hands extend along ±X; backs face +Z. This is pure bind geometry.
        local.rotation.z = -side * Math.PI / 2; local.position.set(side * .7065, 1.4555, -.0654); root.add(local);
      }
    }
    return root;
  },
};
