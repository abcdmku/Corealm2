import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Station = readonly [number, number, number, number]; // x, y, half-height, half-depth
type Spec = { metal: string; edge: string; wood: string; leather: string; length: number; point: number; poll: number; drop: number; description: string };
const specs: Record<string, Spec> = {
  worn_pickaxe: { metal: '#6d6256', edge: '#aca391', wood: '#92724b', leather: '#453428', length: .82, point: .36, poll: .26, drop: .15, description: "The head is loose and the haft is somebody's fence post. One effective Mining level." },
  grithe_pickaxe: { metal: '#d77b43', edge: '#f3ac6e', wood: '#d09b55', leather: '#392116', length: .85, point: .37, poll: .235, drop: .075, description: 'A bar of Copper on an pine haft. Adds two effective Mining levels.' },
  corven_pickaxe: { metal: '#696969', edge: '#c6c5bd', wood: '#b99b6f', leather: '#392b22', length: .88, point: .395, poll: .25, drop: .093, description: 'Iron head, ash haft. Five effective Mining levels.' },
  kaldite_pickaxe: { metal: '#355a85', edge: '#9cbbd7', wood: '#9c6935', leather: '#30231d', length: .9, point: .405, poll: .26, drop: .105, description: 'Cobalt on oak. Nine effective Mining levels, and it will outlive you.' },
  emberite_pickaxe: { metal: '#a3a3a0', edge: '#deded6', wood: '#654128', leather: '#39261c', length: .91, point: .405, poll: .265, drop: .11, description: 'An Titanium head on walnut. Seventeen effective Mining levels.' },
  cindersteel_pickaxe: { metal: '#514b46', edge: '#b5afa3', wood: '#a66c32', leather: '#2c201a', length: .92, point: .44, poll: .30, drop: .145, description: 'Cindersteel on a teak handle. Adds 39 effective gathering levels; resource requirements still apply.' },
  nightglass_pickaxe: { metal: '#20172f', edge: '#7a638e', wood: '#393047', leather: '#19181c', length: .96, point: .43, poll: .285, drop: .10, description: 'Nightglass on a magic handle. Adds 40 effective gathering levels; resource requirements still apply.' },
};
function noise(x: number, y: number): number { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }
function maps(kind: 'wood' | 'metal' | 'leather' | 'glass', base: string, rust = false) {
  const n = 128, albedo = new Uint8Array(n * n * 4), rough = new Uint8Array(n * n * 4), normals = new Uint8Array(n * n * 4);
  const color = new THREE.Color(base).convertLinearToSRGB();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const grain = Math.sin(x * 1.3 + Math.sin(y * .055 + x * .12) * 2.8);
    const fine = noise(x, y), broad = Math.sin(x * .31) * Math.cos(y * .23);
    const v = kind === 'wood' ? .77 + .13 * grain + .12 * fine : kind === 'leather' ? .82 + .13 * fine + .04 * broad : .86 + .09 * broad + .09 * fine;
    const oxidized = rust && noise(Math.floor(x / 4), Math.floor(y / 4)) > .74;
    const i = (y * n + x) * 4;
    albedo.set([Math.min(255, color.r * 255 * v + (oxidized ? 38 : 0)), color.g * 255 * v, color.b * 255 * v * (oxidized ? .73 : 1), 255], i);
    const r = kind === 'wood' ? 205 + fine * 35 : kind === 'leather' ? 185 + fine * 40 : kind === 'glass' ? 55 + fine * 25 : 115 + fine * 40;
    rough.set([r, r, r, 255], i);
    // Small physical grain and shallow hammering, independent of oxide color.
    normals.set([128 + (kind === 'wood' ? Math.cos(x * 1.3 + Math.sin(y * .055 + x * .12) * 2.8) * 11 : Math.cos(x * .31) * Math.cos(y * .23) * 5), 128 + (kind === 'wood' ? Math.sin(y * .055) * 2 : Math.sin(x * .31) * Math.sin(y * .23) * 5), 255, 255], i);
  }
  const texture = (data: Uint8Array, suffix: string, srgb = false) => { const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.name = `${kind}-${base}-${suffix}`; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return { map: texture(albedo, 'color', true), roughnessMap: texture(rough, 'roughness'), normalMap: texture(normals, 'normal') };
}

/** Forged volume, with separate broad faces and narrow bright longitudinal bevels. */
function head(stations: readonly Station[], crystal: boolean): THREE.BufferGeometry {
  const section = [[1, 0], [.77, .70], [0, 1], [-.77, .70], [-1, 0], [-.77, -.70], [0, -1], [.77, -.70]] as const;
  const p: number[] = [], uv: number[] = [], indices: number[] = [];
  const g = new THREE.BufferGeometry();
  for (let s = 0; s < stations.length - 1; s++) for (let f = 0; f < 8; f++) {
    const start = indices.length, base = p.length / 3;
    for (const [si, fi] of [[s, f], [s + 1, f], [s + 1, (f + 1) % 8], [s, (f + 1) % 8]]) {
      const [x, y, h, d] = stations[si!]!, [yy, zz] = section[fi!]!;
      p.push(x, y + yy * h, zz * d); uv.push(x * 3, (yy + 1) * .5);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    g.addGroup(start, 6, crystal ? ((s + f) % 5 === 0 ? 1 : 0) : ([0, 3, 4, 7].includes(f) ? 1 : 0));
  }
  for (const end of [0, stations.length - 1]) {
    const [x, y, h, d] = stations[end]!, base = p.length / 3, start = indices.length;
    p.push(x, y, 0); uv.push(.5, .5);
    for (const [yy, zz] of section) { p.push(x, y + yy * h, zz * d); uv.push((yy + 1) / 2, (zz + 1) / 2); }
    for (let f = 0; f < 8; f++) { const a = base + f + 1, b = base + (f + 1) % 8 + 1; indices.push(base, ...(end === 0 ? [b, a] : [a, b])); }
    g.addGroup(start, 24, 1);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
function bandGeometry(radius: number, height: number, sides = 12): THREE.BufferGeometry {
  return new THREE.LatheGeometry([new THREE.Vector2(radius - .007, -height / 2), new THREE.Vector2(radius - .0015, -height / 2), new THREE.Vector2(radius, -height / 2 + .003), new THREE.Vector2(radius, height / 2 - .003), new THREE.Vector2(radius - .0015, height / 2), new THREE.Vector2(radius - .007, height / 2)], sides);
}
function shaftGeometry(length: number, worn: boolean, magic: boolean): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; const r = .035 + .005 * Math.cos(t * Math.PI * 2) + (worn ? .005 * Math.sin(t * 23) : 0); pts.push(new THREE.Vector2(r * (i === 0 || i === 40 ? .89 : 1), -.18 + t * length)); }
  pts.unshift(new THREE.Vector2(0, -.18)); pts.push(new THREE.Vector2(0, -.18 + length));
  const g = new THREE.LatheGeometry(pts, worn ? 12 : 20); const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), t = THREE.MathUtils.clamp((y - .15) / (length - .40), 0, 1); const offset = magic ? .025 * Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) : worn ? .009 * Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) : 0; pos.setX(i, pos.getX(i) + offset); }
  g.computeVertexNormals(); return g;
}
function helix(root: THREE.Group, name: string, radius: number, low: number, high: number, turns: number, mat: THREE.Material, tube = .0015) {
  const p: THREE.Vector3[] = []; const count = Math.ceil(turns * 48);
  for (let i = 0; i <= count; i++) { const t = i / count, a = t * turns * Math.PI * 2; p.push(new THREE.Vector3(Math.cos(a) * radius, low + (high - low) * t, Math.sin(a) * radius)); }
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), count, tube, 5, false), mat); mesh.name = name; mesh.castShadow = true; root.add(mesh);
}

export const author: ItemModelAuthor = {
  ids: Object.keys(specs),
  build(itemId) {
    const spec = specs[itemId]; if (!spec) throw new Error(`Unknown pickaxe ${itemId}`);
    const worn = itemId === 'worn_pickaxe', copper = itemId === 'grithe_pickaxe', iron = itemId === 'corven_pickaxe', cobalt = itemId === 'kaldite_pickaxe', titanium = itemId === 'emberite_pickaxe', cinder = itemId === 'cindersteel_pickaxe', magic = itemId === 'nightglass_pickaxe';
    const root = new THREE.Group(); root.name = itemId;
    root.userData.itemModel = { itemId, author: 'pickaxes', reference: `art/item-icons/generated/${itemId}.png`, description: spec.description, grip: [0, 0, 0] };
    const metal = new THREE.MeshPhysicalMaterial({ ...maps(magic ? 'glass' : 'metal', spec.metal, cinder || worn), metalness: magic ? .28 : .8, roughness: magic ? .24 : .7, clearcoat: magic ? .55 : 0 }); metal.name = `${itemId}-head-material`;
    const edge = new THREE.MeshStandardMaterial({ color: spec.edge, metalness: magic ? .35 : .88, roughness: magic ? .22 : .36 }); edge.name = 'honed-head-bevels';
    const wood = new THREE.MeshStandardMaterial({ ...maps('wood', spec.wood), roughness: .9 }); wood.name = 'longitudinal-haft-grain';
    const leather = new THREE.MeshStandardMaterial({ ...maps('leather', spec.leather), roughness: .85 }); leather.name = 'creased-leather-wrap';
    const seam = new THREE.MeshStandardMaterial({ color: magic ? '#333036' : '#765236', roughness: .86 }); seam.name = 'leather-overlap-edges';
    const fitting = new THREE.MeshStandardMaterial({ ...maps('metal', magic ? '#8b8983' : spec.metal, worn || cinder), metalness: .82, roughness: .63 }); fitting.name = 'socket-and-ferrule-metal';
    const gem = new THREE.MeshPhysicalMaterial({ color: '#4f2877', roughness: .13, metalness: .18, clearcoat: .9 }); gem.name = 'violet-faceted-inlays';
    const add = (name: string, g: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, material); m.name = name; m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; root.add(m); return m; };
    const band = (name: string, y: number, h: number, r: number, material: THREE.Material = fitting, sides = 12) => add(name, bandGeometry(r, h, sides), material, 0, y);
    add('solid-grained-wood-haft-with-end-grain', shaftGeometry(spec.length, worn, magic), wood);
    const hy = spec.length - .245;
    const stations: Station[] = [[-spec.point, hy - spec.drop, .0014, .0018], [-spec.point * .84, hy - spec.drop * .52, .018, .012], [-spec.point * .61, hy - spec.drop * .16, .032, .025], [-spec.point * .34, hy + .002, .043, .032], [-.048, hy, .055, .037], [.047, hy, .055, .037], [spec.poll * .43, hy - .005, .035, .030], [spec.poll * .77, hy - spec.drop * .39, .043, .023], [spec.poll, hy - spec.drop * .79, titanium ? .058 : .051, .007]];
    if (worn) { for (let i = 0; i < stations.length; i++) { const s = stations[i]!; stations[i] = [-s[0], s[1], s[2] * (1 + .08 * Math.sin(i * 2)), s[3]]; } stations.reverse(); }
    add(magic ? 'faceted-solid-nightglass-pick-and-flared-adze' : 'solid-forged-tapered-pick-and-flared-adze', head(stations, magic), [metal, edge]);
    // Through-eye construction: wood projects above an open, thick metal sleeve.
    band('head-through-eye-socket', hy, .115, .049, fitting, magic || cobalt ? 8 : 12);
    if (iron || cinder || cobalt || titanium || magic) {
      band('upper-socket-retaining-lip', hy + .058, .018, .0505);
      band('lower-socket-retaining-lip', hy - .057, .017, .0475);
    }
    const rivet = (name: string, y: number, r: number, z: number) => { for (const side of [-1, 1]) { const m = add(`${name}-${side === 1 ? 'front' : 'rear'}`, new THREE.SphereGeometry(r, 12, 8), edge, 0, y, side * z); m.scale.z = .43; } };
    if (iron) { rivet('paired-socket-rivet-upper', hy + .025, .0105, .049); rivet('paired-socket-rivet-lower', hy - .023, .0105, .049); }
    if (cinder) { rivet('large-head-clench-rivet', hy, .015, .050); band('secondary-haft-reinforcement', hy - .103, .04, .042); rivet('reinforcement-pin', hy - .103, .009, .042); }
    if (worn) {
      helix(root, 'three-turn-rough-cord-head-lashing', .0395, hy - .112, hy - .059, 4.3, leather, .0045);
      // Split ends and scars are shallow solid dark fissures, with irregular lengths.
      for (let i = 0; i < 9; i++) { const a = i * 2.399; const y = -.105 + i * .07; const m = add(`haft-split-${i}`, new THREE.BoxGeometry(.0014, .055 + noise(i, 0) * .035, .0012), seam, Math.sin(a) * .035, y, Math.cos(a) * .035); m.rotation.y = a; m.rotation.z = .05 * Math.sin(i); }
    } else {
      band('continuous-leather-grip', 0, .285, .041, leather, 24);
      helix(root, 'spiral-leather-overlap-seam', .0413, -.137, .137, magic ? 8 : 6, seam, .0018);
      if (cinder || magic || titanium) helix(root, 'diagonal-cross-binding', .042, -.13, .13, 2.4, leather, .003);
      if (cobalt || titanium || cinder || magic) {
        band('solid-butt-ferrule', -.16, .055, .045, fitting, cobalt || magic ? 8 : 16);
        add('closed-butt-ferrule-base', new THREE.CylinderGeometry(.043, .037, .014, magic || cobalt ? 8 : 16), fitting, 0, -.191);
        band('butt-ferrule-polished-rim', -.135, .007, .0455, edge);
      }
      if (titanium || magic) { band('grip-upper-metal-cuff', .149, .025, .0415); band('grip-cuff-highlight-rim', .164, .006, .042, edge); }
      if (cinder) rivet('butt-cap-rivet', -.165, .008, .045);
    }
    if (magic) {
      // The icon's silver hourglass socket trim and violet settings continue on the back.
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape(); shape.moveTo(-.044, hy + .05); shape.quadraticCurveTo(-.018, hy, -.044, hy - .05); shape.lineTo(-.034, hy - .05); shape.quadraticCurveTo(-.010, hy, -.034, hy + .05); shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, { depth: .004, bevelEnabled: true, bevelSegments: 1, bevelSize: .001, bevelThickness: .001, steps: 1 });
        add(`silver-socket-curved-trim-left-${side}`, g, fitting, 0, 0, side * .044);
        const right = g.clone(); right.scale(-1, 1, 1); add(`silver-socket-curved-trim-right-${side}`, right, fitting, 0, 0, side * .044);
      }
      band('ornament-mid-shaft-cuff', hy - .20, .025, .041); band('ornament-mid-shaft-rim', hy - .216, .007, .042, edge);
      const diamond = (name: string, y: number, height: number, width: number, depth: number) => { for (const side of [-1, 1]) {
        const frame = add(`${name}-silver-bezel-${side}`, new THREE.OctahedronGeometry(1, 0), fitting, 0, y, side * .039); frame.scale.set(width, height, depth);
        const stone = add(`${name}-violet-stone-${side}`, new THREE.OctahedronGeometry(1, 0), gem, 0, y, side * (.039 + depth * .62)); stone.scale.set(width * .64, height * .70, depth * .6);
      } };
      diamond('long-shaft-pendant', hy - .275, .061, .019, .006);
      diamond('socket-inlay', hy - .093, .023, .012, .006);
      diamond('pommel-inlay', -.16, .017, .014, .006);
      // Raised twisted wood ridges follow the curved magical haft.
      for (let k = 0; k < 6; k++) {
        const p: THREE.Vector3[] = []; for (let i = 0; i <= 30; i++) { const y = .18 + i / 30 * (hy - .24), t = THREE.MathUtils.clamp((y - .15) / (spec.length - .40), 0, 1), a = k * Math.PI / 3 + Math.sin(t * 7) * .22; p.push(new THREE.Vector3(.025 * Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) + .035 * Math.sin(a), y, .035 * Math.cos(a))); }
        add(`twisted-magic-wood-ridge-${k}`, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), 36, .0017, 5, false), wood);
      }
    }
    // Measured local grip span, useful to inspection tooling without changing the frozen contract.
    root.userData.gripMeasurements = { center: [0, 0, 0], radius: worn ? .037 : .043, minY: -.135, maxY: .135, shaftAxis: '+Y' };
    return root;
  },
};
