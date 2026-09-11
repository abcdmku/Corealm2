import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type P = readonly [number, number, number];
const TAU = Math.PI * 2;
const ids = ['galeskin_staff', 'mossbound_staff', 'tideworn_staff', 'cinderwake_staff', 'regent_staff', 'hollowstar_staff'] as const;
const descriptions = [
  'Pine scoured silver by wind. The empty socket hums in weather.',
  'Ash with a living green seam. Warm at the grip like a root in summer.',
  'Oak bleached and salt-cured. The cage weeps a little in the cold.',
  'Walnut the fire chose not to eat. The empty cage sheds a slow drift of sparks.',
  "Three pieces of the Furnace Regent's crown brace a Teak Staff. Casts through carried Essence.",
  'Three fragments of the Hollow Star turn above a magic-wood shaft. Casts through carried Essence.',
];
function hash(x: number): number { return (Math.sin(x * 127.13 + 7.8) * 43758.54 % 1 + 1) % 1; }
function map(name: string, rgb: P, style: 'wood' | 'metal' | 'leather' | 'moss'): THREE.DataTexture {
  const n = 256, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    const grain = Math.sin(u * 155 + Math.sin(v * 20) * 2 + Math.sin(v * 43) * .6);
    const fine = Math.sin(u * 730 + Math.sin(v * 35) * 3);
    const noise = hash(x + y * n);
    const shade = style === 'wood' ? 1 + .17 * grain + .08 * fine - .36 * Math.pow(Math.max(0, grain), 15) + noise * .1
      : style === 'metal' ? .82 + noise * .23 + .13 * Math.sin(x * .12) * Math.sin(y * .18)
      : style === 'moss' ? .55 + noise * .8 + .14 * Math.sin(x * .8) * Math.sin(y * .3)
      : .83 + noise * .19 + .07 * Math.sin(x * .55 + y * .41);
    const k = (x + y * n) * 4;
    for (let c = 0; c < 3; c++) data[k + c] = Math.min(255, rgb[c]! * shade);
    data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n); t.name = name; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; return t;
}
function material(name: string, rgb: P, style: 'wood' | 'metal' | 'leather' | 'moss', metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, map: map(name + ' surface', rgb, style), roughness: style === 'wood' ? .78 : style === 'metal' ? .36 : .93, metalness });
}
function mesh(g: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = m.receiveShadow = true; g.add(m); return m;
}
function ball(g: THREE.Group, name: string, p: P, scale: P, mat: THREE.Material): void {
  const m = mesh(g, name, new THREE.SphereGeometry(1, 10, 7), mat); m.position.set(...p); m.scale.set(...scale);
}
/** Closed swept timber, with changing section, shallow longitudinal bark ridges and capped broken tips. */
function branch(g: THREE.Group, name: string, points: readonly P[], radii: readonly number[], mat: THREE.Material, steps = 40, sides = 16): void {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(steps, false), pos: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, center = curve.getPointAt(t), f = t * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(f));
    const r = THREE.MathUtils.lerp(radii[k]!, radii[k + 1]!, f - k);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * TAU, rr = r * (1 + .035 * Math.sin(a * 7 + t * 6) + .025 * Math.sin(a * 11 - t * 8));
      const p = center.clone().addScaledVector(frames.normals[i]!, Math.cos(a) * rr).addScaledVector(frames.binormals[i]!, Math.sin(a) * rr);
      pos.push(p.x, p.y, p.z); uv.push(j / sides, t * 2);
      if (i < steps && j < sides) { const a0 = i * (sides + 1) + j, b = a0 + sides + 1; ix.push(a0, b, a0 + 1, b, b + 1, a0 + 1); }
    }
  }
  for (const end of [0, steps]) { const c = curve.getPointAt(end / steps), ci = pos.length / 3; pos.push(c.x, c.y, c.z); uv.push(.5, .5); for (let j = 0; j < sides; j++) { const a = end * (sides + 1) + j; if (end === 0) ix.push(ci, a + 1, a); else ix.push(ci, a, a + 1); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals(); mesh(g, name, geo, mat);
}
function line(g: THREE.Group, name: string, points: readonly P[], r: number, mat: THREE.Material): void { branch(g, name, points, [r, r], mat, Math.min(180, Math.max(8, points.length * 2)), 7); }
function cuff(g: THREE.Group, y: number, r: number, h: number, mat: THREE.Material, rivet: THREE.Material, ornate = false): void {
  const m = mesh(g, 'Complete fitted collar', new THREE.CylinderGeometry(r, r * .98, h, 24), mat); m.position.y = y;
  for (const yy of [y - h * .48, y + h * .48]) { const rim = mesh(g, 'Rolled collar edge', new THREE.TorusGeometry(r, .0024, 6, 24), rivet); rim.rotation.x = Math.PI / 2; rim.position.y = yy; }
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ball(g, 'Peened through rivet', [Math.sin(a) * r, y, Math.cos(a) * r], [.004, .004, .004], rivet); }
  if (ornate) for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, rr = r + .002;
    const pts: P[] = [[Math.sin(a) * rr, y - h * .35, Math.cos(a) * rr], [Math.sin(a + .22) * rr, y, Math.cos(a + .22) * rr], [Math.sin(a) * rr, y + h * .35, Math.cos(a) * rr], [Math.sin(a - .22) * rr, y, Math.cos(a - .22) * rr], [Math.sin(a) * rr, y - h * .35, Math.cos(a) * rr]];
    line(g, 'Raised collar sigil', pts, .0019, rivet);
  }
}
function wrap(g: THREE.Group, start: number, end: number, r: number, leather: THREE.Material, edge: THREE.Material, braid = false): void {
  const body = mesh(g, 'Leather grip foundation', new THREE.CylinderGeometry(r, r, end - start, 24), leather); body.position.y = (start + end) / 2;
  for (let d = 0; d < (braid ? 2 : 1); d++) {
    const pts: P[] = [], turns = (end - start) / .027;
    for (let i = 0; i <= 200; i++) { const t = i / 200, a = t * turns * TAU * (d ? -1 : 1); pts.push([Math.sin(a) * (r + .001), start + (end - start) * t, Math.cos(a) * (r + .001)]); }
    line(g, braid ? 'Cross woven leather cord' : 'Overlapping diagonal leather edge', pts, braid ? .0038 : .0016, edge);
  }
}
/** Thick beveled, dished forged fragment. Same structural detail on front and back. */
function plate(g: THREE.Group, name: string, pts: readonly (readonly [number, number])[], z: number, mat: THREE.Material, trim: THREE.Material): void {
  const shape = new THREE.Shape(); shape.moveTo(...pts[0]!); for (const p of pts.slice(1)) shape.lineTo(...p); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: .022, bevelEnabled: true, bevelThickness: .006, bevelSize: .004, bevelSegments: 2, steps: 1 }); geo.translate(0, 0, z - .011); mesh(g, name, geo, mat);
  for (const side of [-1, 1]) {
    const edge = pts.map(p => [p[0], p[1], z + side * .017] as P); edge.push(edge[0]!); line(g, name + ' raised edge', edge, .0024, trim);
    const centerX = pts.reduce((s, p) => s + p[0], 0) / pts.length, centerY = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (let i = 0; i < pts.length; i += 2) line(g, name + ' branching metal rib', [[centerX, centerY, z + side * .024], [THREE.MathUtils.lerp(centerX, pts[i]![0], .5), THREE.MathUtils.lerp(centerY, pts[i]![1], .5), z + side * .026], [pts[i]![0], pts[i]![1], z + side * .017]], .0032, trim);
  }
}

function build(id: string): THREE.Group {
  const tier = ids.indexOf(id as typeof ids[number]); if (tier < 0) throw new Error('Unknown boss staff ' + id);
  const root = new THREE.Group(); root.name = id + ' approved icon model';
  const focus: P = tier === 5 ? [.02, 1.085, 0] : tier === 4 ? [0, 1.02, 0] : [0, 1.06, 0];
  root.userData.itemModel = { itemId: id, author: 'boss-staves', reference: `art/item-icons/generated/${id}.png`, description: descriptions[tier], grip: [0, 0, 0], focus };
  const woodColors: P[] = [[172, 162, 144], [111, 99, 76], [178, 177, 164], [79, 41, 26], [142, 62, 30], [41, 40, 68]];
  const wood = material(['Wind silvered pine', 'Weathered living ash', 'Salt bleached oak', 'Charred walnut', 'Polished red teak', 'Violet magic wood'][tier]!, woodColors[tier]!, 'wood');
  const metal = material(tier === 4 ? 'Black furnace iron' : tier === 5 ? 'Star pitted night metal' : 'Weathered forged iron', tier === 5 ? [42, 49, 82] : [55, 53, 49], 'metal', .8);
  const trim = material(tier === 4 ? 'Worn crown gold' : 'Worn metal edge and rivets', tier === 4 ? [194, 139, 57] : tier === 5 ? [173, 171, 165] : [115, 109, 97], 'metal', .82);
  const leather = material('Worn wrapped grip', tier === 2 ? [55, 78, 86] : tier === 5 ? [31, 30, 47] : tier === 3 ? [95, 39, 23] : [87, 53, 31], 'leather');
  const leatherEdge = material('Leather strap burnished edges', tier === 5 ? [66, 62, 92] : tier === 2 ? [108, 123, 128] : [131, 85, 48], 'leather');
  const accent = tier === 1 ? material('Dense green moss seam', [80, 107, 13], 'moss') : tier === 2 ? material('Granular salt deposits', [191, 194, 183], 'moss') : new THREE.MeshStandardMaterial({ name: tier === 3 ? 'Recessed hot ember veins' : 'Recessed violet star veins', color: tier === 3 ? 0xff690d : 0xb992ff, emissive: tier === 3 ? 0xf94300 : 0x7931e8, emissiveIntensity: 1.9, roughness: .5 });
  const bottom = tier === 0 ? -.37 : -.58, shaftTop = tier >= 4 ? .85 : .87;
  const shaft: P[] = [[0, bottom, 0], [-.012, bottom + .16, .005], [0, 0, 0], [.008, .34, -.003], [-.012, .61, .004], [0, shaftTop, 0]];
  branch(root, 'Continuous solid timber shaft', shaft, tier === 1 ? [.042, .031, .028, .04] : [.031, .025, .028, .033], wood, 90, 24);
  wrap(root, -.20, .17, .031, leather, leatherEdge, tier === 1 || tier === 4);
  cuff(root, -.21, .035, .035, tier === 1 ? leather : metal, trim, tier >= 4);
  cuff(root, .18, .035, .035, tier === 1 ? leather : metal, trim, tier >= 4);
  if (tier !== 1) cuff(root, bottom + .06, .037, .047, metal, trim, tier >= 4);
  if (tier === 0) { wrap(root, .73, .85, .039, leather, leatherEdge); cuff(root, .73, .044, .029, metal, trim); cuff(root, .88, .058, .042, metal, trim); }
  if (tier === 2 || tier === 3) cuff(root, .85, .050, .055, metal, trim);
  if (tier === 3) cuff(root, .53, .035, .04, metal, trim);
  // Grain ridges follow the actual curved timber; both rear and front retain weathering.
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * TAU, pts: P[] = [];
    for (let j = 0; j <= 22; j++) { const y = bottom + (shaftTop - bottom) * j / 22, x = .005 * Math.sin(y * 13); pts.push([x + Math.sin(a + .16 * Math.sin(y * 9 + k)) * .026, y, Math.cos(a + .16 * Math.sin(y * 9 + k)) * .026]); }
    line(root, 'Raised longitudinal timber fibre', pts, .0017, wood);
  }
  if (tier === 0) {
    branch(root, 'Left split socket horn', [[0, .85, 0], [-.087, .98, 0], [-.083, 1.14, 0], [-.03, 1.22, .005]], [.043, .035, .012], wood);
    branch(root, 'Right split socket horn', [[0, .86, 0], [.085, .98, .006], [.083, 1.16, .005], [.062, 1.205, 0]], [.04, .033, .011], wood);
    branch(root, 'Rear crooked socket fork', [[0, .86, -.012], [.052, 1.03, -.054], [.116, 1.12, -.047]], [.032, .023, .008], wood);
    branch(root, 'Socket upper natural bridge', [[-.079, 1.16, -.008], [0, 1.14, -.032], [.079, 1.17, -.007]], [.025, .025, .025], wood, 24);
    for (const [y, a] of [[.35, .5], [.49, 2], [.63, 0], [-.30, 3], [.24, 4]]) {
      const r = .028; const knot = mesh(root, 'Oval weathered branch knot', new THREE.TorusGeometry(.009, .0023, 6, 16), wood); knot.position.set(Math.sin(a!) * r, y!, Math.cos(a!) * r); knot.rotation.y = a!; knot.scale.y = 1.7;
    }
  } else if (tier === 1) {
    for (let k = 0; k < 3; k++) {
      const pts: P[] = []; for (let j = 0; j <= 30; j++) { const y = bottom + j / 30 * 1.48, a = k * TAU / 3 + y * 8; pts.push([Math.sin(a) * .025, y, Math.cos(a) * .025]); }
      branch(root, 'Spiralling live ash root', pts, [.021, .013, .019], wood, 75, 12);
      const seam = pts.map(p => [p[0] * 1.15, p[1], p[2] * 1.15] as P); line(root, 'Living green seam', seam, .008, accent);
    }
    // Hollow, bark-lined bowl, its aperture opens forward and upward.
    const bowl = new THREE.Group(); bowl.name = 'Hollow grown root socket'; bowl.position.set(0, 1.02, 0); bowl.rotation.x = .86; root.add(bowl);
    const profile = [[.027, -.13], [.065, -.09], [.085, 0], [.09, .08], [.077, .091], [.065, .01], [.043, -.07], [.005, -.095]].map(p => new THREE.Vector2(p[0]!, p[1]!));
    mesh(bowl, 'Thick hollow bark bowl with inner wall', new THREE.LatheGeometry(profile, 28), wood);
    for (let k = 0; k < 7; k++) { const a = k * TAU / 7; branch(root, 'Curled living crown root', [[Math.sin(a) * .025, .79, Math.cos(a) * .025], [Math.sin(a) * .11, 1.0, Math.cos(a) * .06], [Math.sin(a + .25) * .125, 1.15 + .06 * Math.sin(k), Math.cos(a + .25) * .065], [Math.sin(a + .5) * .084, 1.22 + .05 * Math.sin(k), Math.cos(a + .5) * .06]], [.023, .021, .002], wood); }
    for (let k = 0; k < 48; k++) { const y = .22 + hash(k) * .85, a = y * 8 + Math.floor(hash(k + 30) * 3) * TAU / 3; ball(root, 'Moss cushion on root seam', [Math.sin(a) * .042, y, Math.cos(a) * .042], [.006, .009, .006], accent); }
  } else if (tier === 2 || tier === 3) {
    if (tier === 2) {
      metal.color.setRGB(1.35, 1.38, 1.40);
      const prongs: P[][] = [
        [[-.012,.83,0],[-.084,.94,.016],[-.145,1.09,.014],[-.132,1.225,.003],[-.094,1.285,.002]],
        [[-.006,.84,.018],[-.021,.975,.063],[-.037,1.125,.072],[-.007,1.253,.037],[.028,1.285,.026]],
        [[.015,.83,.005],[.102,.945,.024],[.152,1.083,.028],[.135,1.205,.016],[.118,1.276,.004]],
        [[.015,.84,-.016],[.07,.94,-.072],[.12,1.076,-.078],[.148,1.19,-.042],[.163,1.24,-.015]],
        [[-.008,.86,-.022],[-.062,.97,-.065],[-.058,1.11,-.087],[-.035,1.23,-.046],[.0,1.27,-.014]],
      ];
      prongs.forEach((pts,k) => {
        branch(root, 'Tideworn separate weather split prong ' + k, pts, [.031,.028,.031,.019,.010], wood, 52, 18);
        // Long torn fibres and broken bark lips interrupt the smooth sweep on every side.
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
        for (let j = 0; j < 7; j++) {
          const a = j / 7 * TAU, grain: P[] = [];
          for (let n = 0; n <= 12; n++) { const t = n / 12, p = curve.getPointAt(t), rr = .023 * (1 - .55 * t); grain.push([p.x + Math.sin(a + .14 * Math.sin(t * 16)) * rr,p.y,p.z + Math.cos(a + .14 * Math.sin(t * 16)) * rr]); }
          line(root, 'Raised split grain on cage prong', grain, .0023, wood);
        }
      });
      // A thin, solid rectangular-section strap follows the actual broad cage contour.
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * TAU, x = Math.sin(a) * .145, z = Math.cos(a) * .082, y = 1.187 - x * .27;
        for (const [dr,dy] of [[0,-.014],[0,.014],[.005,.014],[.005,-.014]]) { positions.push(x + Math.sin(a) * dr!, y + dy!, z + Math.cos(a) * dr!); uvs.push(i / 48, dy! > 0 ? 1 : 0); }
        if (i < 48) for (let j = 0; j < 4; j++) { const a0 = i * 4 + j, b = i * 4 + (j + 1) % 4; indices.push(a0,b,a0+4,b,b+4,a0+4); }
      }
      const strap = new THREE.BufferGeometry(); strap.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); strap.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); strap.setIndex(indices); strap.computeVertexNormals(); mesh(root,'Sloping iron cage strap with real thickness',strap,metal);
      for (let k = 0; k < 14; k++) { const a = k * TAU / 14, x = Math.sin(a) * .151; ball(root,'Peened cage strap fixing',[x,1.187 - x * .27,Math.cos(a) * .088],[.005,.005,.005],trim); }
      // Broad crusts sit above the wood instead of disappearing inside its varying radius.
      const salt = (center: THREE.Vector3, a: number, seed: number): void => {
        for (let j = 0; j < 13; j++) {
          const dy = (hash(seed+j) - .5) * .069, da = (hash(seed+j+31) - .5) * .7;
          const crystal = mesh(root,'Attached angular salt crystal crust',new THREE.IcosahedronGeometry(1,0),accent);
          crystal.position.set(center.x + Math.sin(a + da) * .031,center.y + dy,center.z + Math.cos(a + da) * .031);
          crystal.scale.set(.006 + hash(seed+j+4)*.006,.007 + hash(seed+j+8)*.009,.004 + hash(seed+j+17)*.005); crystal.rotation.set(hash(j)*2,hash(j+8)*3,hash(j+9)*2);
        }
      };
      for (const [y,a] of [[-.47,1.4],[-.35,2.3],[-.29,.2],[.3,1.0],[.47,-.5],[.56,2.7],[.73,.3],[.79,4.3]]) salt(new THREE.Vector3(.005*Math.sin(y!*13),y!,0),a!,Math.round((y!+1)*200));
      for (let k = 0; k < prongs.length; k++) { const curve = new THREE.CatmullRomCurve3(prongs[k]!.map(p=>new THREE.Vector3(...p))); salt(curve.getPointAt(.26 + .12*(k%3)),k*1.4,k*100+800); }
    } else for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU + .3, r = .116;
      const pts: P[] = [[0, .83, 0], [Math.sin(a) * r * .82, .94, Math.cos(a) * r * .68], [Math.sin(a) * r, 1.12, Math.cos(a) * r * .73], [Math.sin(a + .25) * .061, 1.255 + .016 * Math.sin(k), Math.cos(a + .25) * .037]];
      branch(root, 'Open cage split timber rib ' + k, pts, [.03, .03, .006], wood, 48, 18);
      if (tier === 3) { const hot = pts.map(p => [p[0] * 1.05, p[1], p[2] * 1.12] as P); line(root, 'Ember fissure within cage rib', hot, .0028, accent); }
    }
    if (tier === 3) {
      branch(root, 'Fire sharpened butt', [[0, bottom + .06, 0], [-.006, bottom - .025, .004], [0, bottom - .10, 0]], [.036, .023, .001], wood);
      for (let k = 0; k < 5; k++) { const a = k * TAU / 5; line(root, 'Low ember fissure', [[Math.sin(a) * .027, bottom + .1, Math.cos(a) * .027], [Math.sin(a + .12) * .026, bottom + .18, Math.cos(a + .12) * .026], [Math.sin(a) * .025, bottom + .23, Math.cos(a) * .025]], .0018, accent); }
    }
  } else if (tier === 4) {
    cuff(root, .82, .046, .095, metal, trim, true); cuff(root, .89, .059, .024, trim, trim);
    for (const s of [-1, 1]) {
      branch(root, 'Crown side blackened arm', [[s * .015, .86, 0], [s * .106, .94, 0], [s * .134, 1.06, 0]], [.027, .027, .032], metal);
      plate(root, 'Furnace crown side fragment', [[s * .10, .96], [s * .16, 1.03], [s * .178, 1.22], [s * .126, 1.16], [s * .079, 1.21], [s * .09, 1.07]], 0, trim, trim);
    }
    plate(root, 'Central pointed crown fragment', [[-.045, .93], [-.045, 1.035], [0, 1.18], [.045, 1.035], [.043, .93], [0, .96]], .008, metal, trim);
    cuff(root, bottom + .055, .042, .12, metal, trim, true);
    branch(root, 'Crown golden butt spike', [[0, bottom + .01, 0], [0, bottom - .055, 0], [0, bottom - .095, 0]], [.035, .018, .001], trim);
  } else {
    cuff(root, .81, .043, .052, metal, trim, true);
    plate(root, 'Star cradle lower socket', [[-.038, .82], [-.085, .91], [-.064, .99], [-.025, .95], [0, .98], [.034, .945], [.073, .97], [.078, .90], [.034, .82]], 0, metal, trim);
    // Three separate star fragments carried on slender rear metal braces, preserving central aperture.
    const pieces: (readonly (readonly [number, number])[])[] = [
      [[-.035, 1.015], [-.145, 1.02], [-.23, 1.075], [-.143, 1.078], [-.10, 1.135], [-.059, 1.19], [-.044, 1.12]],
      [[.019, 1.14], [.035, 1.245], [.008, 1.355], [.08, 1.295], [.133, 1.18], [.145, 1.10], [.09, 1.14]],
      [[.043, .982], [.103, 1.059], [.15, 1.01], [.207, .875], [.125, .921], [.057, .938], [-.002, .998]],
    ];
    pieces.forEach((p, i) => { plate(root, 'Hollow star fragment ' + (i + 1), p, i === 1 ? -.014 : .009, metal, trim); });
    branch(root, 'Rear star mounting left arm', [[-.019, .85, -.025], [-.072, .95, -.045], [-.108, 1.06, -.04]], [.012, .007, .01], trim);
    branch(root, 'Rear star mounting upper arm', [[0, .86, -.031], [.079, .99, -.065], [.109, 1.12, -.049], [.065, 1.22, -.045]], [.009, .006, .01], trim);
    branch(root, 'Rear star mounting right arm', [[.018, .85, -.021], [.065, .92, -.035], [.104, .971, -.032]], [.011, .008, .008], trim);
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3; const pts: P[] = []; for (let j = 0; j <= 15; j++) { const y = .21 + j / 15 * .57; pts.push([Math.sin(a + y * 5) * .027, y, Math.cos(a + y * 5) * .027]); } line(root, 'Luminous magic wood split', pts, .0017, accent); }
    plate(root, 'Pointed star pommel', [[-.033, bottom + .02], [-.045, bottom - .025], [0, bottom - .13], [.045, bottom - .025], [.033, bottom + .02]], 0, metal, trim);
  }
  return root;
}
export const author: ItemModelAuthor = { ids, build };


