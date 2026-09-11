import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type P = readonly [number, number];
type Station = readonly [number, number, number, number]; // height, half-width, ridge depth, lateral sweep
type Finish = 'metal' | 'leather' | 'wood' | 'glass';

function noise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + 63.21) * 43758.5453;
  return n - Math.floor(n);
}
function field(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(noise(ix, iy), noise(ix + 1, iy), u), THREE.MathUtils.lerp(noise(ix, iy + 1), noise(ix + 1, iy + 1), u), v);
}

/** Restrained drawn metal, fine leather pores, longitudinal timber grain, and glass flow. */
function maps(name: string, hex: string, finish: Finish, roughness: number, metalness: number) {
  const size = 256, heights = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4), packed = new Uint8Array(size * size * 4);
  const c = new THREE.Color(hex).convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = field(x / 26, y / 33), fine = field(x / 2.1, y / 2.1);
    const drawn = field(x / 1.6 + field(x / 30, y / 60), y / 46);
    const grain = Math.pow(Math.abs(Math.sin(x * 0.29 + field(x / 28, y / 90) * 5)), 9);
    const flow = field(x / 9 + field(x / 48, y / 60) * 7, y / 38);
    const h = finish === 'wood' ? grain * .5 + drawn * .3 + broad * .2 : finish === 'leather' ? fine * .6 + broad * .4 : finish === 'glass' ? flow * .9 + fine * .1 : broad * .45 + drawn * .4 + fine * .15;
    const modulation = finish === 'wood' ? .63 + .32 * h : finish === 'leather' ? .77 + .22 * h : finish === 'glass' ? .68 + .31 * h : .9 + .1 * h;
    const i = (y * size + x) * 4; heights[y * size + x] = h;
    color.set([Math.round(c.r * 255 * modulation), Math.round(c.g * 255 * modulation), Math.round(c.b * 255 * modulation), 255], i);
    packed.set([255, Math.round(255 * THREE.MathUtils.clamp(roughness + (h - .5) * .13, .08, .95)), Math.round(255 * metalness), 255], i);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (xx: number, yy: number) => heights[((yy + size) % size) * size + ((xx + size) % size)]!;
    const strength = finish === 'leather' ? 1.25 : finish === 'wood' ? .8 : .33;
    const v = new THREE.Vector3((at(x - 1, y) - at(x + 1, y)) * strength, (at(x, y - 1) - at(x, y + 1)) * strength, 1).normalize();
    normal.set([Math.round((v.x * .5 + .5) * 255), Math.round((v.y * .5 + .5) * 255), Math.round((v.z * .5 + .5) * 255), 255], (y * size + x) * 4);
  }
  function texture(data: Uint8Array, suffix: string, srgb = false) {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.name = `${name}-${suffix}`; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; return t;
  }
  const orm = texture(packed, 'roughness-metalness');
  return { map: texture(color, 'color', true), normalMap: texture(normal, 'normal'), roughnessMap: orm, metalnessMap: orm };
}

function material(name: string, color: string, finish: Finish, roughness: number, metalness: number) {
  const m = new THREE.MeshPhysicalMaterial({ ...maps(name, color, finish, roughness, metalness), roughness: 1, metalness: 1,
    clearcoat: finish === 'glass' ? .9 : finish === 'wood' ? .32 : .12, clearcoatRoughness: finish === 'glass' ? .08 : .3,
    normalScale: new THREE.Vector2(finish === 'glass' ? .28 : .55, finish === 'glass' ? .28 : .55) });
  m.name = name; return m;
}

function mesh(root: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) {
  const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = m.receiveShadow = true; root.add(m); return m;
}

/** Every transverse ring has an actual back and sharpened bevels. Flat facet normals stay split. */
function blade(stations: readonly Station[], fuller: boolean): THREE.BufferGeometry {
  const front: P[] = fuller ? [[-1, 0], [-.77, .43], [-.16, .99], [-.063, .73], [.063, .73], [.16, .99], [.77, .43], [1, 0]]
    : [[-1, 0], [-.81, .26], [-.025, 1], [.025, 1], [.81, .26], [1, 0]];
  const section: P[] = [...front, ...front.slice(1, -1).reverse().map(([x, z]): P => [x, -z])];
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const geo = new THREE.BufferGeometry();
  for (let face = 0; face < section.length; face++) {
    const start = indices.length;
    for (let j = 0; j < stations.length - 1; j++) {
      const base = positions.length / 3;
      for (const [si, fi] of [[j, face], [j, (face + 1) % section.length], [j + 1, face], [j + 1, (face + 1) % section.length]]) {
        const [y, w, d, cx] = stations[si!]!, [sx, sz] = section[fi!]!;
        positions.push(cx + sx * w, y, sz * d); uv.push((sx + 1) * .5, y * 2.5);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const a = section[face]!, b = section[(face + 1) % section.length]!;
    const edge = Math.abs(a[0]) > .76 && Math.abs(b[0]) > .76;
    const recess = fuller && Math.abs(a[0]) < .17 && Math.abs(b[0]) < .17;
    geo.addGroup(start, indices.length - start, edge ? 1 : recess ? 2 : 0);
  }
  // Tang-end closure, hidden inside the guard but still a closed volume.
  const capStart = indices.length, [y, w, d, cx] = stations[0]!;
  const cb = positions.length / 3; positions.push(cx, y, 0); uv.push(.5, 0);
  for (const [sx, sz] of section) { positions.push(cx + sx * w, y, sz * d); uv.push((sx + 1) * .5, (sz + 1) * .5); }
  for (let i = 0; i < section.length; i++) indices.push(cb, cb + 1 + (i + 1) % section.length, cb + 1 + i);
  geo.addGroup(capStart, indices.length - capStart, 2);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

function solid(root: THREE.Group, name: string, shape: THREE.Shape, depth: number, bevel: number, mat: THREE.Material, z = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: bevel, bevelThickness: bevel * .8, curveSegments: 20 });
  geo.translate(0, 0, z - depth / 2);
  const uv = geo.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
  return mesh(root, name, geo, mat);
}
function polygon(points: readonly P[]) {
  const shape = new THREE.Shape(); shape.moveTo(...points[0]!); for (const p of points.slice(1)) shape.lineTo(...p); shape.closePath(); return shape;
}
function wire(root: THREE.Group, name: string, points: THREE.Vector3[], radius: number, mat: THREE.Material, smooth = true) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  if (!smooth) curve.curveType = 'catmullrom', curve.tension = 0;
  return mesh(root, name, new THREE.TubeGeometry(curve, Math.max(12, points.length * 5), radius, 6, false), mat);
}
function trim(root: THREE.Group, name: string, points: readonly P[], z: number, radius: number, mat: THREE.Material, smooth = true) {
  for (const side of [-1, 1]) wire(root, `${name}-${side > 0 ? 'front' : 'back'}`, points.map(([x, y]) => new THREE.Vector3(x, y, z * side)), radius, mat, smooth);
}
function band(root: THREE.Group, name: string, y: number, r: number, h: number, mat: THREE.Material) {
  const profile: P[] = [[0, y - h / 2], [r - .002, y - h / 2], [r, y - h / 2 + .002], [r, y + h / 2 - .002], [r - .002, y + h / 2], [0, y + h / 2]];
  const m = mesh(root, name, new THREE.LatheGeometry(profile.map(([r0, y0]) => new THREE.Vector2(r0, y0)), 40), mat); m.scale.z = .79; return m;
}
function jewel(root: THREE.Group, name: string, x: number, y: number, z: number, width: number, height: number, depth: number, mat: THREE.Material) {
  const geo = new THREE.OctahedronGeometry(1, 0); geo.scale(width, height, depth);
  const m = mesh(root, name, geo, mat); m.position.set(x, y, z); return m;
}
function diamondSetting(root: THREE.Group, name: string, y: number, w: number, h: number, metal: THREE.Material, inset: THREE.Material) {
  solid(root, `${name}-solid-beveled-setting`, polygon([[0, y + h], [w, y], [0, y - h], [-w, y]]), .036, .0025, metal);
  for (const s of [-1, 1]) jewel(root, `${name}-faceted-inset-${s}`, 0, y, .024 * s, w * .77, h * .77, .013, inset);
  trim(root, `${name}-silver-setting-outline`, [[0, y + h * .89], [w * .89, y], [0, y - h * .89], [-w * .89, y], [0, y + h * .89]], .023, .0018, metal, false);
}

function grip(root: THREE.Group, mat: THREE.Material, seam: THREE.Material, metal: THREE.Material, kind: 'wrap' | 'stitched' | 'wood' | 'twist', half = .108, radius = .025) {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 64; i++) { const t = i / 64; profile.push(new THREE.Vector2(radius * (.92 + .13 * Math.sin(t * Math.PI)), -half + 2 * half * t)); }
  profile.unshift(new THREE.Vector2(0, -half)); profile.push(new THREE.Vector2(0, half));
  const geo = new THREE.LatheGeometry(profile, 48);
  if (kind === 'twist') {
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(x, z), r = Math.hypot(x, z);
      const f = r > .0001 ? 1 + .07 * Math.cos(a * 5 - y / half * 9) : 1;
      pos.setXYZ(i, x * f, y, z * f);
    }
    geo.computeVertexNormals();
  }
  const handle = mesh(root, `${kind}-oval-grip`, geo, mat); handle.scale.z = .79;
  if (kind === 'wrap' || kind === 'stitched') {
    const turns = kind === 'wrap' ? 8 : 3.4, points: THREE.Vector3[] = [];
    for (let i = 0; i <= 360; i++) {
      const t = i / 360, a = t * Math.PI * 2 * turns, r = radius * (.92 + .13 * Math.sin(t * Math.PI));
      points.push(new THREE.Vector3(Math.sin(a) * (r + .0004), -half + t * 2 * half, Math.cos(a) * (r * .79 + .0004)));
    }
    wire(root, 'continuous-leather-overlap', points, kind === 'wrap' ? .00115 : .00065, seam);
    if (kind === 'stitched') for (let i = 0; i < 39; i++) {
      const y = -half + .005 + i * (half * 2 - .01) / 39;
      const r = radius * (.92 + .13 * Math.sin((y + half) / (half * 2) * Math.PI));
      for (const s of [-1, 1]) wire(root, `cross-stitch-${i}-${s}`, [new THREE.Vector3(-.004, y, r * .79 * s), new THREE.Vector3(.004, y + .003, r * .79 * s)], .00065, seam);
    }
  }
  if (kind === 'wood') {
    band(root, 'riveted-middle-wood-retaining-band', -.025, radius * 1.1, .024, metal);
    for (const y of [-half + .007, -.025, half - .007]) for (const side of [-1, 1]) {
      const r = mesh(root, `wood-band-rivet-${y}-${side}`, new THREE.SphereGeometry(.0042, 12, 8), metal); r.scale.z = .44; r.position.set(side * .013, y, side * radius * .75);
    }
  }
  for (const y of [-half, half]) {
    band(root, `grip-end-ferrule-${y}`, y, radius * 1.08, .014, metal);
    band(root, `grip-ferrule-fine-rim-${y}`, y + (y > 0 ? -.009 : .009), radius * 1.08, .003, metal);
  }
}

function swordGuard(kind: 'cobalt' | 'titanium' | 'cinder' | 'night') {
  const s = new THREE.Shape();
  if (kind === 'cobalt') {
    s.moveTo(-.195, .139); s.lineTo(-.174, .175); s.lineTo(-.155, .157);
    s.bezierCurveTo(-.11, .131, -.065, .107, 0, .132); s.bezierCurveTo(.065, .107, .11, .131, .155, .157);
    s.lineTo(.174, .175); s.lineTo(.195, .139); s.lineTo(.178, .104);
    s.bezierCurveTo(.121, .11, .071, .081, 0, .08); s.bezierCurveTo(-.071, .081, -.121, .11, -.178, .104);
  } else if (kind === 'titanium') {
    s.moveTo(-.19, .118); s.quadraticCurveTo(-.192, .16, -.153, .177);
    s.bezierCurveTo(-.178, .132, -.099, .113, 0, .133); s.bezierCurveTo(.099, .113, .178, .132, .153, .177);
    s.quadraticCurveTo(.192, .16, .19, .118); s.quadraticCurveTo(.174, .087, .149, .071);
    s.bezierCurveTo(.153, .113, .074, .075, 0, .076); s.bezierCurveTo(-.074, .075, -.153, .113, -.149, .071);
    s.quadraticCurveTo(-.174, .087, -.19, .118);
  } else if (kind === 'night') {
    s.moveTo(-.218, .154); s.lineTo(-.167, .174); s.bezierCurveTo(-.18, .13, -.063, .104, 0, .137);
    s.bezierCurveTo(.063, .104, .18, .13, .167, .174); s.lineTo(.218, .154); s.lineTo(.18, .086);
    s.bezierCurveTo(.153, .114, .074, .074, 0, .078); s.bezierCurveTo(-.074, .074, -.153, .114, -.18, .086);
  } else {
    s.moveTo(-.2, .128); s.lineTo(-.181, .168); s.lineTo(-.15, .161);
    s.bezierCurveTo(-.138, .126, -.068, .114, 0, .123); s.bezierCurveTo(.068, .114, .138, .126, .15, .161);
    s.lineTo(.181, .168); s.lineTo(.2, .128); s.lineTo(.182, .099);
    s.bezierCurveTo(.115, .115, .065, .081, 0, .079); s.bezierCurveTo(-.065, .081, -.115, .115, -.182, .099);
  }
  s.closePath(); return s;
}

function guardDetail(root: THREE.Group, kind: string, bright: THREE.Material, dark: THREE.Material) {
  for (const side of [-1, 1]) {
    trim(root, `${kind}-guard-upper-reeded-border-${side}`, [[side * .174, .152], [side * .131, .131], [side * .076, .117], [side * .041, .119]], .024, .0015, bright);
    trim(root, `${kind}-guard-lower-reeded-border-${side}`, [[side * .181, .117], [side * .126, .114], [side * .073, .097], [side * .03, .09]], .024, .0015, bright);
    if (kind === 'night') {
      for (let i = 0; i < 5; i++) {
        const x = side * (.057 + i * .022), y = .106 + i * .0047;
        trim(root, `engraved-silver-leaf-${side}-${i}`, [[x, y], [x + side * .009, y + .008], [x + side * .016, y + .006], [x + side * .009, y + .002], [x, y]], .025, .0011, bright);
      }
      trim(root, `quillon-terminal-scroll-${side}`, [[side * .172, .149], [side * .19, .146], [side * .181, .12], [side * .174, .129], [side * .181, .139]], .025, .0011, bright);
    }
    if (kind === 'cinder') for (const back of [-1, 1]) {
      const r = mesh(root, `crossguard-peened-rivet-${side}-${back}`, new THREE.SphereGeometry(.0052, 16, 10), bright); r.scale.z = .5; r.position.set(side * .043, .104, back * .025);
      const seat = mesh(root, `rivet-recess-seat-${side}-${back}`, new THREE.TorusGeometry(.0057, .0009, 6, 16), dark); seat.position.copy(r.position); seat.position.z -= back * .001;
    }
  }
}

const descriptions: Record<string, string> = {
  kaldite_sword: 'Cobalt sword with a broad blue diamond blade, silver honed edges, swept angular quillons, geometric silver blade-root inlay, wrapped navy leather and a faceted cobalt pommel. Both sides carry matching metalwork.',
  emberite_dagger: 'Warm titanium dagger with a waisted recurved blade, broad forged facets, crescent quillons set with amber cabochons, brown spiral leather and a stepped pointed pommel.',
  emberite_sword: 'Twice-quenched titanium sword with a long narrow recessed fuller, warm silver facets and a dull orange honed edge, curled quillons, hand-stitched charcoal grip and pointed faceted pommel.',
  cindersteel_sword: 'Heavy dark steel sword with broad silver bevels and a recessed fuller, riveted swept guard, longitudinal honey wood grain, three steel grip bands and an octagonal domed pommel.',
  nightglass_sword: 'Dark blue glass sword with an acute faceted blade, bright blue bevels, engraved silver crescent guard and blue diamond jewel, twisted plum grip, ornamental collars and a diamond-set pointed pommel.',
};

export const author: ItemModelAuthor = {
  ids: ['kaldite_sword', 'emberite_dagger', 'emberite_sword', 'cindersteel_sword', 'nightglass_sword'],
  build(itemId) {
    if (!descriptions[itemId]) throw new Error(`Unsupported blades-b item: ${itemId}`);
    const root = new THREE.Group(); root.name = `${itemId}-authored-solid-weapon`;
    root.userData.itemModel = { itemId, author: 'blades-b', reference: `art/item-icons/generated/${itemId}.png`, description: descriptions[itemId]!, grip: [0, 0, 0] };
    const cobalt = itemId === 'kaldite_sword', dagger = itemId === 'emberite_dagger', cinder = itemId === 'cindersteel_sword', night = itemId === 'nightglass_sword';
    const kind = cobalt ? 'cobalt' : cinder ? 'cinder' : night ? 'night' : 'titanium';
    const face = material(`${kind}-blade-facets`, cobalt ? '#3065a9' : cinder ? '#454444' : night ? '#142e52' : '#a9a399', night ? 'glass' : 'metal', night ? .19 : .34, night ? .56 : .86);
    if (night) { face.transmission = .10; face.thickness = .032; face.ior = 1.57; face.attenuationColor.set('#133569'); face.attenuationDistance = .07; }
    const edge = material(`${kind}-polished-honed-bevels`, cobalt ? '#b8cee3' : cinder ? '#a7aaa9' : night ? '#386caf' : '#d9d1c3', 'metal', .21, .91);
    const dark = material(`${kind}-recessed-metal`, cobalt ? '#1b365b' : night ? '#252832' : '#494846', 'metal', .38, .82);
    const metal = material(`${kind}-guard-and-pommel`, cobalt ? '#305080' : cinder ? '#63605a' : night ? '#979891' : '#b5aca0', 'metal', .31, .87);
    const bright = material(`${kind}-raised-metal-ornament`, cobalt ? '#c1d2e0' : night ? '#c7c4b6' : '#c1b8a7', 'metal', .22, .91);
    const handleMat = material(`${kind}-${cinder ? 'honey-wood' : night ? 'twisted-plum' : 'leather'}`, cobalt ? '#152035' : cinder ? '#b67630' : night ? '#462d44' : dagger ? '#60351f' : '#292827', cinder ? 'wood' : 'leather', cinder ? .37 : .66, 0);
    const seam = material(`${kind}-grip-seam`, cobalt ? '#0d1524' : night ? '#73515a' : dagger ? '#362016' : '#827d6f', 'leather', .64, 0);
    const gem = new THREE.MeshPhysicalMaterial({ color: dagger ? '#ed8012' : '#17499f', metalness: .25, roughness: .13, clearcoat: 1, clearcoatRoughness: .06, transmission: .13, thickness: .012, ior: 1.68 }); gem.name = dagger ? 'amber-quillon-cabochons' : 'cut-cobalt-inset';

    if (dagger) {
      const stations: Station[] = [[.057,.027,.007,0],[.073,.025,.007,0],[.101,.019,.006,0],[.13,.014,.005,.001],[.16,.018,.006,.003],[.187,.03,.008,.006],[.21,.031,.008,.009],[.237,.027,.007,.018],[.263,.018,.005,.032],[.286,.008,.0025,.047],[.302,0,0,.059]];
      mesh(root, 'recurved-waisted-titanium-dagger-solid-facets', blade(stations, false), [face, edge, dark]);
      const s = new THREE.Shape(); s.moveTo(-.075,.063); s.bezierCurveTo(-.079,.079,-.064,.09,-.047,.091);
      s.bezierCurveTo(-.065,.071,-.042,.052,-.027,.069); s.lineTo(-.024,.044); s.quadraticCurveTo(0,.051,.024,.044);
      s.lineTo(.027,.069); s.bezierCurveTo(.042,.052,.065,.071,.047,.091); s.bezierCurveTo(.064,.09,.079,.079,.075,.063);
      s.bezierCurveTo(.054,.066,.047,.039,.031,.039); s.quadraticCurveTo(0,.047,-.031,.039); s.bezierCurveTo(-.047,.039,-.054,.066,-.075,.063); s.closePath();
      solid(root, 'paired-open-crescent-dagger-quillons', s, .012, .002, metal);
      for (const x of [-.063,.063]) for (const z of [-.009,.009]) {
        const setting = mesh(root, `amber-quillon-setting-${x}-${z}`, new THREE.TorusGeometry(.0045,.001,8,24), bright); setting.position.set(x,.072,z);
        const cab = mesh(root, `amber-quillon-cabochon-${x}-${z}`, new THREE.SphereGeometry(.004,16,10), gem); cab.scale.z = .62; cab.position.set(x,.072,z);
      }
      for (const side of [-1,1]) trim(root, `dagger-crescent-raised-edge-${side}`, [[side*.07,.065],[side*.053,.057],[side*.038,.045],[side*.023,.047]], .008, .0008, bright);
      grip(root, handleMat, seam, metal, 'wrap', .042, .015);
      const pommel: P[] = [[0,-.082],[.004,-.078],[.011,-.072],[.014,-.063],[.017,-.057],[.017,-.05],[.014,-.044],[0,-.044]];
      mesh(root,'titanium-stepped-pointed-dagger-pommel',new THREE.LatheGeometry(pommel.map(([r,y])=>new THREE.Vector2(r,y)),40),metal).scale.z=.81;
      for (const [y,r] of [[-.047,.0155],[-.059,.017],[-.068,.0125]] as const) band(root,`dagger-pommel-raised-ring-${y}`,y,r,.0025,bright);
      return root;
    }

    const stations: Station[] = cobalt ? [[.119,.062,.02,0],[.162,.055,.02,0],[.205,.047,.02,0],[.254,.058,.02,0],[.286,.071,.02,0],[.835,.067,.018,0],[.944,.043,.013,0],[1.073,0,0,0]]
      : cinder ? [[.12,.064,.021,0],[.175,.048,.02,0],[.231,.06,.022,0],[.276,.071,.022,0],[.795,.067,.019,0],[.932,.047,.014,0],[1.081,0,0,0]]
      : night ? [[.122,.053,.018,0],[.19,.034,.016,0],[.246,.037,.017,0],[.313,.052,.019,0],[.326,.057,.019,0],[.914,.039,.014,0],[1.095,0,0,0]]
      : [[.12,.044,.018,0],[.181,.038,.017,0],[.255,.047,.018,0],[.296,.049,.018,0],[.852,.038,.014,0],[1.084,0,0,0]];
    mesh(root,`${kind}-closed-faceted-blade${cinder || kind==='titanium' ? '-recessed-fuller' : ''}`,blade(stations,cinder || kind==='titanium'),[face,edge,dark]);
    solid(root,`${kind}-solid-swept-crossguard`,swordGuard(kind),.036,.005,metal);
    guardDetail(root,kind,bright,dark);
    grip(root,handleMat,seam,metal,cinder?'wood':night?'twist':cobalt?'wrap':'stitched',.108,cinder?.025:.024);

    if (cobalt) {
      diamondSetting(root,'cobalt-guard-diamond',.128,.036,.041,bright,metal);
      // Long spear-shaped silver inlay follows the actual blade face on both sides.
      trim(root,'cobalt-blade-root-chevron',[[0,.162],[-.022,.213],[0,.405],[.022,.213],[0,.162]],.0185,.0016,bright,false);
      trim(root,'cobalt-blade-root-inner-chevron',[[0,.176],[-.015,.216],[0,.363],[.015,.216],[0,.176]],.02,.0009,bright,false);
      diamondSetting(root,'cobalt-pointed-pommel',-.155,.038,.05,bright,metal);
    } else if (night) {
      diamondSetting(root,'nightglass-crossguard-blue-jewel',.127,.029,.035,bright,gem);
      diamondSetting(root,'nightglass-diamond-pommel',-.158,.038,.052,bright,gem);
      for (const y of [-.103,.106]) for (const side of [-1,1]) {
        for (let i=0;i<5;i++) {
          const x=-.016+i*.008;
          trim(root,`nightglass-ferrule-engraved-scroll-${y}-${side}-${i}`,[[x,y-.004],[x+.005,y],[x,y+.004]],.022,.0008,bright);
        }
      }
      for (const s of [-1,1]) trim(root,`nightglass-pommel-leaf-${s}`,[[s*.031,-.158],[s*.023,-.146],[s*.012,-.145],[s*.021,-.152],[s*.031,-.158]],.025,.001,metal);
    } else if (cinder) {
      // The broad octagonal block has a turned dome at each face, rather than a flat coin.
      const outline: P[] = [[-.021,-.12],[.021,-.12],[.041,-.142],[.041,-.169],[.022,-.187],[-.022,-.187],[-.041,-.169],[-.041,-.142]];
      solid(root,'cindersteel-eight-sided-beveled-pommel',polygon(outline),.035,.007,metal);
      for (const side of [-1,1]) {
        const dome=mesh(root,`cindersteel-pommel-peened-dome-${side}`,new THREE.SphereGeometry(.019,32,16),metal); dome.scale.z=.47; dome.position.set(0,-.164,side*.023);
        const rim=mesh(root,`cindersteel-pommel-dome-rim-${side}`,new THREE.TorusGeometry(.020,.0015,8,32),bright);rim.position.set(0,-.164,side*.025);
      }
      for (const side of [-1,1]) trim(root,`cindersteel-faceted-blade-root-${side}`,[[side*.052,.15],[side*.029,.177],[0,.238]],.019,.001,bright,false);
    } else {
      diamondSetting(root,'titanium-star-crossguard-boss',.128,.036,.044,bright,face);
      diamondSetting(root,'titanium-spear-pommel',-.159,.034,.052,bright,face);
      // The orange line is a thin, solid portion of the honed edge on both sides.
      const heat = new THREE.MeshPhysicalMaterial({color:'#d78c4d',metalness:.8,roughness:.31,emissive:'#dd4609',emissiveIntensity:.22});
      heat.name='titanium-dull-orange-tempered-edge';
      for (const side of [-1,1]) wire(root,`titanium-integral-hot-edge-${side}`,stations.slice(3).map(([y,w,,cx])=>new THREE.Vector3(cx+side*w,y,0)),.0006,heat,false);
    }
    return root;
  },
};
