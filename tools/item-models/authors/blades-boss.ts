import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Pt = readonly [number, number];
type Station = readonly [number, number];
const ids = ['galeskin_sword', 'mossbound_sword', 'tideworn_sword', 'cinderwake_sword', 'chainbound_sword'] as const;
const hash = (x: number, y: number) => { const f = Math.sin(x * 127.1 + y * 311.7 + 43.2) * 43758.5453; return f - Math.floor(f); };
function noise(x: number, y: number): number {
  const a = Math.floor(x), b = Math.floor(y), u = x - a, v = y - b;
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(a, b), hash(a + 1, b), u * u * (3 - 2 * u)), THREE.MathUtils.lerp(hash(a, b + 1), hash(a + 1, b + 1), u * u * (3 - 2 * u)), v * v * (3 - 2 * v));
}
/** Restrained broad hammer marks, fine longitudinal wear, and correlated roughness. */
function finish(name: string, base: string, metal: number, roughness: number, kind: 'metal' | 'leather' | 'glass' | 'moss' = 'metal'): THREE.MeshStandardMaterial {
  const n = 128, col = new Uint8Array(n * n * 4), nor = new Uint8Array(n * n * 4), orm = new Uint8Array(n * n * 4), heights = new Float32Array(n * n);
  const c = new THREE.Color(base).convertLinearToSRGB();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const broad = noise(x / 16, y / 16), fine = noise(x / 2.4, y / 2.4);
    const grain = Math.pow(Math.max(0, Math.sin(x * .42 + noise(x / 20, y / 30) * 5)), 18);
    const h = broad * .78 + fine * .12 - grain * (kind === 'leather' ? .14 : .035);
    const k = .86 + h * .22;
    const i = (y * n + x) * 4; heights[y * n + x] = h;
    col.set([Math.round(c.r * 255 * k), Math.round(c.g * 255 * k), Math.round(c.b * 255 * k), 255], i);
    orm.set([255, Math.round(190 + (1 - h) * 55), Math.round(225 + h * 30), 255], i);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const h = (a: number, b: number) => heights[((b + n) % n) * n + ((a + n) % n)]!;
    const v = new THREE.Vector3((h(x - 1, y) - h(x + 1, y)) * .9, (h(x, y - 1) - h(x, y + 1)) * .9, 1).normalize();
    nor.set([(v.x * .5 + .5) * 255, (v.y * .5 + .5) * 255, (v.z * .5 + .5) * 255, 255], (y * n + x) * 4);
  }
  const tex = (data: Uint8Array, suffix: string, srgb = false) => { const t = new THREE.DataTexture(data, n, n); t.name = `${name}-${suffix}`; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const map = tex(col, 'albedo', true), normalMap = tex(nor, 'normal'), roughnessMap = tex(orm, 'rough-metal');
  const mat = new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, metalnessMap: roughnessMap, metalness: metal, roughness, normalScale: new THREE.Vector2(kind === 'glass' ? .16 : .42, kind === 'glass' ? .16 : .42), clearcoat: kind === 'glass' ? .6 : .06, clearcoatRoughness: .22 }); mat.name = name; return mat;
}
function solid(shape: THREE.Shape, depth: number, bevel = .003): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, steps: 1, curveSegments: 20 }); g.translate(0, 0, -depth / 2);
  const uv = g.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4); return g;
}
function polygon(points: readonly Pt[]): THREE.Shape { const s = new THREE.Shape(); s.moveTo(...points[0]!); for (const p of points.slice(1)) s.lineTo(...p); s.closePath(); return s; }
function tube(points: THREE.Vector3[], radius: number, segments = 80, radial = 8, closed = false): THREE.TubeGeometry { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), segments, radius, radial, closed); }

/** A physical concave fuller between the thick shoulder facets, with sharpened perimeter. */
function blade(stations: readonly Station[], fullered: boolean, thickness: number): THREE.BufferGeometry {
  const section = fullered ? [[-1, 0], [-.83, .66], [-.25, 1], [-.12, .48], [.12, .48], [.25, 1], [.83, .66], [1, 0], [.83, -.66], [.25, -1], [.12, -.48], [-.12, -.48], [-.25, -1], [-.83, -.66]] : [[-1, 0], [-.76, .55], [0, 1], [.76, .55], [1, 0], [.76, -.55], [0, -1], [-.76, -.55]];
  const p: number[] = [], uv: number[] = [], index: number[] = [];
  const geo = new THREE.BufferGeometry();
  for (let f = 0; f < section.length; f++) {
    const start = index.length;
    for (let j = 0; j < stations.length - 1; j++) {
      const k = p.length / 3;
      for (const [si, fi] of [[j, f], [j, (f + 1) % section.length], [j + 1, f], [j + 1, (f + 1) % section.length]]) {
        const [y, w] = stations[si!]!, [sx, sz] = section[fi!]!;
        const taper = Math.min(1, w / .06); p.push(sx! * w, y, sz! * thickness * taper); uv.push((sx! + 1) / 2, y * 3);
      }
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    geo.addGroup(start, index.length - start, (f === 0 || f === section.length - 1 || f === section.length / 2 || f === section.length / 2 - 1) ? 1 : 0);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(index); geo.computeVertexNormals(); return geo;
}
function guardShape(kind: number): THREE.Shape {
  const s = new THREE.Shape();
  if (kind === 0) {
    s.moveTo(-.25, .095); s.bezierCurveTo(-.275, .20, -.185, .195, -.115, .166); s.quadraticCurveTo(0, .132, .115, .166); s.bezierCurveTo(.185, .195, .275, .20, .25, .095); s.bezierCurveTo(.22, .145, .205, .147, .13, .123); s.quadraticCurveTo(0, .082, -.13, .123); s.bezierCurveTo(-.205, .147, -.22, .145, -.25, .095);
  } else if (kind === 1 || kind === 4) {
    s.moveTo(-.285, .145); s.quadraticCurveTo(-.296, .235, -.224, .227); s.quadraticCurveTo(-.263, .177, -.20, .165); s.quadraticCurveTo(-.13, .125, -.058, .165); s.lineTo(0, .213); s.lineTo(.058, .165); s.quadraticCurveTo(.13, .125, .20, .165); s.quadraticCurveTo(.263, .177, .224, .227); s.quadraticCurveTo(.296, .235, .285, .145); s.quadraticCurveTo(.248, .16, .225, .132); s.quadraticCurveTo(.14, .087, .07, .11); s.lineTo(0, .08); s.lineTo(-.07, .11); s.quadraticCurveTo(-.14, .087, -.225, .132); s.quadraticCurveTo(-.248, .16, -.285, .145);
  } else if (kind === 2) {
    s.moveTo(-.285, .115); s.bezierCurveTo(-.30, .18, -.257, .23, -.21, .194); s.bezierCurveTo(-.16, .145, -.10, .126, -.04, .20); s.lineTo(0, .238); s.lineTo(.04, .20); s.bezierCurveTo(.10, .126, .16, .145, .21, .194); s.bezierCurveTo(.257, .23, .30, .18, .285, .115); s.quadraticCurveTo(.25, .157, .204, .144); s.quadraticCurveTo(.10, .07, 0, .09); s.quadraticCurveTo(-.10, .07, -.204, .144); s.quadraticCurveTo(-.25, .157, -.285, .115);
  } else {
    s.moveTo(-.242, .214); s.lineTo(-.275, .183); s.lineTo(-.237, .145); s.quadraticCurveTo(-.116, .126, -.04, .126); s.lineTo(0, .097); s.lineTo(.04, .126); s.quadraticCurveTo(.116, .126, .237, .145); s.lineTo(.275, .183); s.lineTo(.242, .214); s.quadraticCurveTo(.19, .162, .12, .162); s.quadraticCurveTo(.07, .16, 0, .202); s.quadraticCurveTo(-.07, .16, -.12, .162); s.quadraticCurveTo(-.19, .162, -.242, .214);
  }
  s.closePath(); return s;
}

export const author: ItemModelAuthor = {
  ids,
  build(itemId) {
    const kind = ids.indexOf(itemId as typeof ids[number]); if (kind < 0) throw new Error(`Unsupported boss blade ${itemId}`);
    const root = new THREE.Group(); root.name = `${itemId}-forged-weapon`;
    const descriptions = [
      'Plains Ogre copper sword with broad leaf blade, deep physical fuller, bowed copper guard, sand hide spiral grip and heavy turned acorn pommel. Edge whistles on the backswing. Reverse forging inferred.',
      'Forest Ogre iron sword grown through with living moss. Broad shouldered fullered blade, hooked crescent guard, brown wrapped grip and faceted iron pommel. Moss grows as solid branching sprigs in the fuller and fittings. Reverse inferred.',
      'Cave Ogre cobalt sword worked smooth as sea glass. Leaf blade with raised flowing silver-blue water veins, swept fish-tail guard, teal leather grip and droplet pommel. Reverse repeats flowing forged ornament.',
      'Fire Ogre titanium sword quenched in the arena spring. Long taper, heat-tempered fuller, permanent orange edge, curved guard with pyramidal ends, dark leather and faceted pommel. Reverse heat treatment inferred.',
      'Living foundry chain threaded through pierced Nightglass blade. Scalloped blue glass cutting perimeter, heavy interlocking iron links, crescent guard with diamond boss, purple leather grip and metal-capped Nightglass pommel. Reverse chain return and fittings inferred.',
    ];
    root.userData.itemModel = { itemId, author: 'blades-boss', reference: `art/item-icons/generated/${itemId}.png`, description: descriptions[kind]!, grip: [0, 0, 0] };
    const bases = ['#c98250', '#a2a8a7', '#254c8f', '#a5a5a0', '#101e36'];
    const main = finish(`${itemId}-forged-body`, bases[kind]!, kind === 4 ? .48 : .76, kind === 2 ? .35 : .6, kind === 4 ? 'glass' : 'metal');
    const edge = finish(`${itemId}-honed-edge`, ['#ecad77', '#dce0dc', '#86b9ed', '#e0ded2', '#286fc7'][kind]!, .85, .29);
    const hardware = kind === 4 ? finish('chainbound-worn-iron-hardware', '#7d7974', .85, .51) : main;
    const leather = finish(`${itemId}-grip-hide`, ['#9c8664', '#3e2b20', '#163e48', '#2d2420', '#3a243b'][kind]!, 0, .89, 'leather');
    const seam = finish(`${itemId}-wrap-overlap`, ['#65513c', '#695041', '#284c53', '#857250', '#665061'][kind]!, kind === 3 ? .55 : 0, .75, 'leather');
    const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) => { const m = new THREE.Mesh(geometry, material); m.name = name; m.castShadow = m.receiveShadow = true; root.add(m); return m; };
    const line = (name: string, coords: number[][], radius: number, mat: THREE.Material) => add(name, tube(coords.map(p => new THREE.Vector3(p[0]!, p[1]!, p[2]!)), radius), mat);
    const stations: readonly Station[][] = [
      [[.153, .125], [.235, .09], [.43, .102], [.77, .126], [.97, .127], [1.115, .086], [1.235, 0]],
      [[.155, .132], [.23, .104], [.27, .127], [.93, .107], [1.13, .075], [1.235, 0]],
      [[.15, .113], [.275, .079], [.63, .093], [.91, .109], [1.075, .087], [1.235, 0]],
      [[.153, .091], [.225, .075], [.264, .091], [.86, .067], [1.11, .038], [1.265, 0]],
      [[.155, .128], [.24, .11], [.27, .136], [.92, .105], [1.05, .125], [1.25, 0]],
    ];
    if (kind !== 4) add('continuous-thick-blade-with-cutting-facets', blade(stations[kind]!, kind !== 2, kind === 0 ? .026 : .023), [main, edge]);
    else {
      const contour = polygon([[-.12, .16], [-.096, .205], [-.13, .26], [-.113, .27], [-.105, .57], [-.122, .60], [-.10, .63], [-.091, .91], [-.116, .95], [-.106, .99], [0, 1.25], [.106, .99], [.116, .95], [.091, .91], [.10, .63], [.122, .60], [.105, .57], [.113, .27], [.13, .26], [.096, .205], [.12, .16]]);
      for (const y of [.31, .56, .81, 1.035]) { const hole = new THREE.Path(); hole.absellipse(0, y, .028, y > 1 ? .045 : .073, 0, Math.PI * 2, true); contour.holes.push(hole); }
      add('pierced-nightglass-blade-four-real-chain-apertures', solid(contour, .03, .005), [main, edge]);
      // Each oval is a continuous forged tube; alternating planes pass through the blade apertures.
      for (let i = 0; i < 19; i++) {
        const y = .205 + i * .047, x = .017 * Math.sin(i * .9), points: THREE.Vector3[] = [];
        for (let j = 0; j < 64; j++) { const a = j / 64 * Math.PI * 2; points.push(new THREE.Vector3(Math.cos(a) * .018, Math.sin(a) * .037, 0)); }
        const apertureDistance = Math.min(...[.31, .56, .81, 1.035].map(center => Math.abs(y - center)));
        const through = Math.max(0, 1 - apertureDistance / .043);
        const link = add(`interlocked-foundry-chain-link-${i + 1}`, tube(points, .008, 64, 10, true), hardware); link.position.set(x, y, .041 - .033 * through); link.rotation.y = i % 2 ? 1.3 : -.2; link.rotation.x = through * .7; link.rotation.z = Math.cos(i * .9) * .6;
      }
      for (const y of [.31, .56, .81, 1.035]) { const rear = add('chain-reverse-through-aperture-return', new THREE.TorusGeometry(.025, .0075, 8, 32), hardware); rear.scale.y = 1.5; rear.position.set(0, y, -.025); rear.rotation.y = .6; }
    }
    add('solid-curved-crossguard', solid(guardShape(kind), kind === 0 ? .046 : .036, .004), hardware);
    // The physical grip has an oval, slightly waisted section, closed by forged collars.
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; profile.push(new THREE.Vector2(.029 + .005 * Math.sin(t * Math.PI), -.145 + t * .257)); }
    const grip = add('oval-leather-grip-core', new THREE.LatheGeometry(profile, 48), leather); grip.scale.z = .81;
    const wrap: THREE.Vector3[] = [];
    for (let i = 0; i <= 384; i++) { const t = i / 384, a = t * Math.PI * 2 * (kind === 0 ? 5.8 : 8.3), r = .0295 + .005 * Math.sin(t * Math.PI); wrap.push(new THREE.Vector3(r * Math.sin(a), -.141 + t * .25, r * .81 * Math.cos(a))); }
    add('continuous-spiral-hide-overlap', tube(wrap, kind === 0 ? .004 : .0018, 384, 8), seam);
    for (const y of [-.148, .108]) { const collar = add('forged-grip-ferrule', new THREE.CylinderGeometry(.0325, .034, .021, 40), kind === 2 ? edge : hardware); collar.position.y = y; collar.scale.z = .87; for (const dy of [-.008, .008]) { const ring = add('ferrule-raised-lip', new THREE.TorusGeometry(.0327, .0016, 8, 40), edge); ring.rotation.x = Math.PI / 2; ring.scale.y = .87; ring.position.y = y + dy; } }
    if (kind === 0) {
      const p: Pt[] = [[0, -.251], [.024, -.25], [.053, -.232], [.061, -.205], [.058, -.183], [.048, -.166], [.034, -.16], [0, -.16]];
      add('hammered-copper-acorn-pommel', new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 56), main);
      for (const [y, r] of [[-.181, .058], [-.236, .046]]) { const ring = add('pommel-forged-ring', new THREE.TorusGeometry(r!, .003, 8, 48), edge); ring.rotation.x = Math.PI / 2; ring.position.y = y!; }
      const cap = add('pommel-end-rivet', new THREE.CylinderGeometry(.023, .019, .006, 32), main); cap.position.y = -.254;
    } else if (kind === 2) {
      const p: Pt[] = [[0, -.277], [.025, -.266], [.049, -.233], [.052, -.209], [.039, -.178], [.028, -.16], [0, -.158]];
      const pommel = add('cobalt-droplet-pommel', new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 48), main); pommel.scale.z = .72;
      for (const z of [-1, 1]) {
        line('pommel-flowing-raised-wave', [[-.025, -.258, .026 * z], [.004, -.23, .039 * z], [.019, -.198, .029 * z], [0, -.165, .024 * z]], .0024, edge);
        line('blade-forged-tidal-s-curve', [[0, .2, .025 * z], [-.028, .36, .024 * z], [.027, .56, .023 * z], [-.028, .79, .025 * z], [.025, 1.0, .023 * z], [0, 1.22, .006 * z]], .0027, edge);
        for (const side of [-1, 1]) line('crossguard-silver-water-scroll', [[0, .128, .026 * z], [side * .08, .14, .026 * z], [side * .17, .163, .026 * z], [side * .237, .192, .024 * z], [side * .271, .154, .022 * z]], .0024, edge);
      }
    } else {
      const p: Pt[] = kind === 1 ? [[0, -.267], [.044, -.257], [.068, -.23], [.068, -.195], [.046, -.172], [.03, -.16], [0, -.16]] : [[0, -.284], [.044, -.27], [.061, -.229], [.049, -.188], [.027, -.162], [0, -.16]];
      const g = new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), kind === 1 ? 7 : 5); g.computeVertexNormals();
      const pm = add(kind === 4 ? 'faceted-nightglass-pommel' : 'forged-faceted-pommel', g.toNonIndexed(), main); pm.geometry.computeVertexNormals(); pm.scale.z = .84;
      if (kind === 4) for (const y of [-.193, -.18]) { const band = add('nightglass-pommel-iron-cap-band', new THREE.CylinderGeometry(.047, .055, .011, 8), hardware); band.position.y = y; band.scale.z = .88; }
    }
    if (kind === 1 || kind === 3 || kind === 4) {
      const boss = add('central-faceted-guard-diamond', new THREE.OctahedronGeometry(kind === 4 ? .054 : .035), edge); boss.scale.set(1, 1, .45); boss.position.set(0, .146, .031); boss.rotation.z = Math.PI / 4;
      const back = boss.clone(); back.name = 'reverse-guard-diamond'; back.position.z = -.031; root.add(back);
      if (kind === 3) for (const x of [-.244, .244]) { const terminal = add('pyramidal-guard-terminal', new THREE.OctahedronGeometry(.034), hardware); terminal.position.set(x, .18, 0); terminal.rotation.z = Math.PI / 4; terminal.scale.z = .8; }
      if (kind === 4) for (const z of [-1, 1]) for (const side of [-1, 1]) line('guard-chased-silver-rim', [[0, .18, .026 * z], [side * .09, .14, .026 * z], [side * .18, .151, .026 * z], [side * .24, .195, .026 * z]], .0025, edge);
    }
    if (kind === 3) {
      const hot = new THREE.MeshStandardMaterial({ color: '#ff9c11', emissive: '#ff5000', emissiveIntensity: 2.2, roughness: .4, metalness: .45 }); hot.name = 'permanent-orange-hot-edge';
      line('unbroken-incandescent-right-cutting-edge', [[.086, .285, 0], [.069, .8, 0], [.045, 1.065, 0], [.002, 1.26, 0]], .0027, hot);
      const temper = finish('violet-gold-titanium-temper', '#625168', .82, .5);
      for (const z of [-1, 1]) line('heat-temper-following-spine', [[-.051, .30, .017 * z], [-.047, .62, .016 * z], [-.036, .90, .014 * z], [-.02, 1.12, .009 * z]], .005, temper);
    }
    if (kind === 1) {
      const moss = finish('living-olive-moss', '#596714', 0, .98, 'moss'), tips = finish('living-moss-fresh-leaf-tips', '#8c9631', 0, .91, 'moss');
      // Dense but small solid leaves follow local growth patches, rather than a flat green strip.
      const leafGeo = new THREE.OctahedronGeometry(1, 0); const mergedP: number[][] = [[], []], mergedN: number[][] = [[], []], mergedUv: number[][] = [[], []];
      const baseGeo = leafGeo.index ? leafGeo.toNonIndexed() : leafGeo;
      for (let i = 0; i < 1500; i++) {
        const band = i % 5, t = hash(i, 7), side = i % 7 === 0 ? -1 : 1;
        let x: number, y: number, z: number;
        if (band < 3) { y = .22 + .87 * t; x = (hash(i, 1) - .5) * (.025 + .07 * Math.pow(Math.sin(y * 21), 8)); z = (.016 + hash(i, 2) * .012) * side; }
        else if (band === 3) { x = (t - .5) * .49; y = .15 + .02 * Math.sin(x * 13); z = (.023 + hash(i, 2) * .012) * side; }
        else { const a = t * Math.PI * 2; x = Math.sin(a) * .062; y = -.218 + (hash(i, 4) - .5) * .074; z = Math.cos(a) * .05; }
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(hash(i, 3) * 6, hash(i, 5) * 6, hash(i, 9) * 6)), new THREE.Vector3(.002 + hash(i, 8) * .0025, .004 + hash(i, 12) * .006, .0014));
        const g = baseGeo.clone().applyMatrix4(m), p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv'), bucket = i % 4 ? 0 : 1;
        for (let j = 0; j < p.count; j++) { mergedP[bucket]!.push(p.getX(j), p.getY(j), p.getZ(j)); mergedN[bucket]!.push(n.getX(j), n.getY(j), n.getZ(j)); mergedUv[bucket]!.push(u.getX(j), u.getY(j)); } g.dispose();
      }
      for (let b = 0; b < 2; b++) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(mergedP[b]!, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(mergedN[b]!, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(mergedUv[b]!, 2)); add(b ? 'moss-fresh-solid-leaves' : 'moss-dense-solid-leaf-growth', g, b ? tips : moss); }
      leafGeo.dispose();
    }
    return root;
  },
};
