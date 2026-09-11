import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Kind = 'air' | 'earth' | 'water' | 'fire';
type P = readonly [number, number, number];
const ids = ['air_staff', 'earth_staff', 'water_staff', 'fire_staff'] as const;
const palettes: Record<Kind, { wood: number; grain: number; metal: number; leather: number; orb: number; light: number; base: string }> = {
  air: { wood: 0xb98a4d, grain: 0xe2bc77, metal: 0xb7ada0, leather: 0x493026, orb: 0x96bbd6, light: 0xe5f5ff, base: 'Pine' },
  earth: { wood: 0x98836a, grain: 0xd0baa0, metal: 0xa68849, leather: 0x30231c, orb: 0x397e20, light: 0xaff465, base: 'Ash' },
  water: { wood: 0xa5662c, grain: 0xcf934b, metal: 0xc4c7c3, leather: 0x142b49, orb: 0x034d89, light: 0x3ccde9, base: 'Oak' },
  fire: { wood: 0x302018, grain: 0x75513b, metal: 0xdba15c, leather: 0x501a1c, orb: 0x8b0801, light: 0xffa41b, base: 'Walnut' },
};
function tex(kind: Kind, mode: 'wood' | 'orb' | 'leather'): THREE.DataTexture {
  const n = 256, a = new Uint8Array(n * n * 4), p = palettes[kind];
  const low = new THREE.Color(mode === 'orb' ? p.orb : mode === 'wood' ? p.wood : p.leather);
  const high = new THREE.Color(mode === 'orb' ? p.light : mode === 'wood' ? p.grain : p.leather).multiplyScalar(mode === 'leather' ? 1.6 : 1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n * Math.PI * 2, v = y / n * Math.PI * 2;
    const grain = Math.sin(u * 21 + Math.sin(v * 3 + u) * 1.4 + Math.sin(v * 8) * .35);
    let f = .4 + .27 * grain + .12 * Math.sin(u * 61 + Math.sin(v * 5));
    if (mode === 'leather') f = .12 + .35 * Math.pow(Math.sin(u * 51) * Math.sin(v * 49), 2);
    if (mode === 'orb') {
      const curl = u * 4 + v * 3 + 3 * Math.sin(u + Math.sin(v * 2)) + 1.3 * Math.sin(v * 4 - u * 2);
      const fine = Math.sin(curl * 4 + Math.sin(u * 19 + v * 13));
      f = kind === 'earth' ? Math.pow(Math.max(0, Math.sin(curl * 2)), 18) * .75 + .22 * (1 + fine) : .14 + .38 * (1 + Math.sin(curl)) + .14 * fine;
      if (kind === 'fire') f = Math.pow(Math.max(0, f), 1.8);
    }
    let c = low.clone().lerp(high, THREE.MathUtils.clamp(f, 0, 1));
    if (kind === 'earth' && mode === 'orb') {
      // Periodic cellular mineral inclusions, with thin gold fracture boundaries.
      // This replaces the liquid swirl used by the other elemental orbs.
      const px = x / n * 15 + .23 * Math.sin(v * 4), py = y / n * 9 + .22 * Math.sin(u * 5);
      const hash = (a: number, b: number) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };
      let nearest = 10, second = 10, cell = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ix = Math.floor(px) + dx, iy = Math.floor(py) + dy, hx = (ix + 30) % 15, hy = (iy + 18) % 9;
        const d = Math.hypot(px - ix - hash(hx, hy), py - iy - hash(hx + 29, hy + 13));
        if (d < nearest) { second = nearest; nearest = d; cell = hash(hx + 71, hy + 97); } else second = Math.min(second, d);
      }
      c = new THREE.Color(0x173f18).lerp(new THREE.Color(0x8ac847), cell * .83 + .1);
      c.multiplyScalar(.83 + .28 * Math.sin(u * 31 + Math.sin(v * 23)) ** 2);
      const fracture = Math.max(0, 1 - (second - nearest) / .058);
      c.lerp(new THREE.Color(0xe9c16b), fracture * .94);
    }
    c.convertLinearToSRGB();
    a.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(a, n, n); t.name = `${kind}-${mode}-grain`; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true; return t;
}
function build(id: string): THREE.Group {
  if (!ids.includes(id as typeof ids[number])) throw new Error(`Unsupported elemental staff ${id}`);
  const kind = id.split('_')[0] as Kind, p = palettes[kind], g = new THREE.Group(); g.name = id;
  const mat = (name: string, color: number, roughness: number, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); m.name = `${kind}-${name}`; return m; };
  const wood = mat('carved-wood', 0xffffff, .62); wood.map = tex(kind, 'wood');
  const ridge = mat('raised-wood-fibres', p.grain, .63);
  const dark = mat('grain-recesses', p.wood, .78); dark.color.multiplyScalar(.47);
  const metal = mat('engraved-metal', p.metal, .3, .8);
  const leather = mat('leather-wrap', 0xffffff, .75); leather.map = tex(kind, 'leather');
  const stitch = mat('leather-seam', p.leather, .65); stitch.color.multiplyScalar(1.45);
  const orbMap = tex(kind, 'orb');
  const orb = new THREE.MeshPhysicalMaterial({ map: orbMap, color: 0xffffff, roughness: .13, metalness: .03, clearcoat: 1, clearcoatRoughness: .08, emissive: p.light, emissiveMap: orbMap, emissiveIntensity: kind === 'fire' ? .62 : .19 }); orb.name = `${kind}-elemental-orb`;
  if (kind === 'earth') { orb.emissive.set(0xffffff); orb.emissiveIntensity = .56; orb.roughness = .19; }
  const jewel = mat('inlaid-element', p.orb, .17, .18);
  function mesh(name: string, geo: THREE.BufferGeometry, material: THREE.Material, pos: P = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, material); m.name = name; m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function tube(name: string, points: P[], r: number, material: THREE.Material, end = r, steps = 48, sides = 8) {
    const c = new THREE.CatmullRomCurve3(points.map(a => new THREE.Vector3(...a)));
    const geo = new THREE.TubeGeometry(c, steps, r, sides, false), pos = geo.getAttribute('position');
    for (let i = 0; i <= steps; i++) { const center = c.getPointAt(i / steps), scale = 1 + (end / r - 1) * i / steps;
      for (let j = 0; j <= sides; j++) { const k = i * (sides + 1) + j; const v = new THREE.Vector3().fromBufferAttribute(pos, k).sub(center).multiplyScalar(scale).add(center); pos.setXYZ(k, v.x, v.y, v.z); }
    }
    geo.computeVertexNormals(); return mesh(name, geo, material);
  }
  function collar(y: number, radius: number, height: number, name: string) {
    mesh(name, new THREE.CylinderGeometry(radius, radius * 1.015, height, 24), metal, [0, y, 0]);
    for (const dy of [-height * .42, height * .42]) { const m = mesh(`${name}-beaded-edge`, new THREE.TorusGeometry(radius, .0021, 6, 24), metal, [0, y + dy, 0]); m.rotation.x = Math.PI / 2; }
  }
  function spiral(name: string, x: number, y: number, z: number, radius: number, material: THREE.Material) {
    const pts: P[] = []; for (let i = 0; i <= 44; i++) { const a = i / 44 * Math.PI * 3.8, r = radius * (1 - i / 48); pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r, z]); }
    tube(name, pts, .0017, material, .001, 44, 6);
  }
  function diamond(name: string, y: number, z: number, w: number, h: number) {
    const s = new THREE.Shape(); s.moveTo(0, h / 2); s.lineTo(w / 2, 0); s.lineTo(0, -h / 2); s.lineTo(-w / 2, 0); s.closePath();
    mesh(name, new THREE.ExtrudeGeometry(s, { depth: .009, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 1, steps: 1 }), metal, [0, y, z]);
    const gem = mesh(`${name}-stone`, new THREE.OctahedronGeometry(w * .31), jewel, [0, y, z + .012]); gem.scale.set(1, h / w, .37);
  }
  // Longitudinal solid core carries all forks and full-circumference relief.
  tube('solid-tapered-shaft', kind === 'earth' ? [[0,-.65,0],[.006,-.54,-.004],[0,-.40,0],[-.008,-.22,.005],[0,0,0],[.009,.25,-.004],[-.008,.46,.005],[.01,.65,-.003],[0,.84,0]] : [[0,-.65,0],[-.002,-.3,0],[0,0,0],[.002,.4,0],[0,.84,0]], kind === 'earth' ? .012 : .019, wood, kind === 'earth' ? .015 : .026, 90, 16);
  const roots = kind === 'earth' ? 5 : 3;
  for (let k = 0; k < roots; k++) {
    const pts: P[] = [];
    for (let i = 0; i <= 90; i++) { const t = i / 90, y = -.64 + t * 1.48, a = t * Math.PI * (kind === 'earth' ? 6 : 4) + k * Math.PI * 2 / roots + (kind === 'earth' ? .47 * Math.sin(t * 22 + k * 2) : 0); let r = .019 + t * .005;
      if (kind === 'earth') r = Math.abs(y) < .115 || Math.abs(y + .4) < .095 ? .012 : .023 + .006 * Math.sin(t * 25 + k);
      pts.push([Math.cos(a) * r + (kind === 'earth' ? .007 * Math.sin(t * 16) : 0), y, Math.sin(a) * r]); }
    tube(`winding-${kind}-root-${k}`, pts, kind === 'earth' ? .009 : .004, wood, kind === 'earth' ? .010 : .004, 100, 7);
    if (kind === 'earth' || kind === 'fire') tube(`root-light-ridge-${k}`, pts.map(a => [a[0] * 1.16, a[1], a[2] * 1.16]), .0014, ridge, .0012, 100, 5);
  }
  // Carved grain cuts continue across the rear, independently of the colour map.
  if (kind !== 'earth') for (let k = 0; k < 12; k++) { const pts: P[] = []; for (let j = 0; j <= 35; j++) { const t = j / 35, a = k * Math.PI / 6 + .11 * Math.sin(t * 19 + k); const r = .0195 + t * .005; pts.push([Math.cos(a) * r, -.63 + t * 1.46, Math.sin(a) * r]); } tube(`cut-grain-${k}`, pts, .00065, dark, .0005, 44, 4); }
  for (const [index, y, h] of [[0, 0, .18], [1, -.40, .14]]) {
    mesh(`leather-grip-${index}`, new THREE.CylinderGeometry(.024, .023, h!, 24), leather, [0,y!,0]);
    for (const direction of [-1, 1]) { const pts: P[] = []; for (let i = 0; i <= 120; i++) { const t = i / 120, a = direction * t * Math.PI * 2 * 7; pts.push([Math.sin(a) * .0242, y! - h! / 2 + h! * t, Math.cos(a) * .0242]); } tube(`cross-laced-grip-${index}-${direction}`, pts, .00085, stitch, .00085, 120, 5); }
    for (const edge of [-1,1]) collar(y! + edge * (h! / 2 + .006), .0255, .014, `grip-${index}-binding-${edge}`);
  }
  collar(-.645,.026,.065,'heel-ferrule'); collar(.823,.033,.045,'orb-seat-band');
  if (kind === 'earth' || kind === 'fire') {
    const cap = mesh('pointed-metal-heel', new THREE.ConeGeometry(.029,.071,kind === 'earth' ? 5 : 4),metal,[0,-.705,0]); cap.rotation.z = Math.PI;
    for (const z of [-.028,.028]) { diamond('heel-gem',-.654,z,.019,.035); diamond('fork-diamond',.887,z > 0 ? .047 : -.057,.039,.093); }
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; tube(`neck-chevron-${k}`, [[Math.sin(a-.2)*.034,.842,Math.cos(a-.2)*.034],[Math.sin(a)*.035,.818,Math.cos(a)*.035],[Math.sin(a+.2)*.034,.842,Math.cos(a+.2)*.034]],.0018,metal,.0018,12,5); }
  } else { for (const z of [-.030,.030]) { spiral('heel-scroll',0,-.645,z,.018,metal); spiral('neck-scroll',0,.823,z > 0 ? .035 : -.035,.018,metal); } }
  const cy = 1.015, radius = kind === 'water' ? .112 : .104;
  mesh('spherical-elemental-focus', new THREE.SphereGeometry(radius, 48, 32),orb,[0,cy,0]);
  // Each setting has its own authored branch paths and a third rear support.
  const forks: P[][] = kind === 'water' ? [
    [[-.01,.837,0],[-.077,.919,.007],[-.124,1.019,0],[-.104,1.106,0],[-.073,1.125,0]],
    [[.014,.835,0],[.071,.885,.016],[.132,.946,.009],[.136,.991,.01],[.117,1.001,.013],[.111,.985,.016]],
    [[0,.85,-.018],[.095,.96,-.06],[.121,1.078,-.035],[.092,1.139,-.018],[.066,1.139,-.008],[.066,1.120,-.004],[.08,1.121,0]],
    [[0,.853,.018],[-.029,.92,.07],[.016,.958,.093],[.043,.95,.095],[.037,.932,.096]],
  ] : kind === 'earth' ? [
    [[-.008,.836,0],[-.037,.879,.008],[-.071,.923,.032],[-.109,.967,.026],[-.099,1.018,.032],[-.122,1.061,.006],[-.083,1.105,.006],[-.058,1.145,0]],
    [[.013,.836,0],[.056,.865,.007],[.069,.896,.025],[.11,.935,.035],[.108,.973,.032],[.136,1.02,.011],[.126,1.057,0]],
    [[0,.845,-.01],[.042,.908,-.077],[.018,.955,-.106],[.065,1.007,-.091],[.061,1.086,-.064],[.04,1.123,-.018]],
    [[0,.848,.012],[-.012,.894,.047],[-.027,.926,.076],[.009,.96,.098],[.043,.99,.078]],
  ] : kind === 'fire' ? [
    [[-.01,.834,0],[-.079,.925,.015],[-.124,1.005,.006],[-.103,1.081,0],[-.041,1.145,0]],
    [[.014,.841,0],[.085,.908,.013],[.125,.982,0],[.118,1.088,0]],
    [[0,.841,-.018],[-.02,.94,-.094],[.033,1.051,-.084],[.057,1.111,-.02]],
    [[0,.841,.014],[-.037,.914,.074],[.007,.998,.092]],
  ] : [
    [[-.013,.838,0],[-.07,.913,.01],[-.117,.996,0],[-.095,1.084,0],[-.037,1.139,0]],
    [[.015,.838,0],[.086,.898,.012],[.122,.97,0],[.114,1.052,0],[.091,1.088,0]],
    [[0,.841,-.01],[.055,.934,-.076],[.071,1.035,-.08]],
    [[0,.841,.014],[-.043,.909,.075],[-.021,.975,.089]],
  ];
  forks.forEach((pts,i) => {
    tube(`orb-retaining-branch-${i}`,pts,kind === 'earth' ? .023 : .025,wood,.002,44,12);
    for (let j = 0; j < 3; j++) tube(`branch-carved-ridge-${i}-${j}`,pts.map((a,k) => [a[0] + (j-1)*.007*(1-k/(pts.length)),a[1],a[2]+.015*(1-k/pts.length)]),.002,ridge,.0004,38,5);
    if (kind === 'fire') tube(`gold-flame-edge-${i}`,pts.map(a => [a[0] + .009,a[1],a[2]+.015]),.004,metal,.0008,40,6);
    if (kind === 'earth') {
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
      // Independent roots weave around the larger limb instead of a smooth U socket.
      for (let strand = 0; strand < 3; strand++) {
        const strandPoints: P[] = [], groovePoints: P[] = [];
        for (let j = 0; j <= 48; j++) {
          const t = j / 48, center = curve.getPoint(t), tangent = curve.getTangent(t);
          const axis = new THREE.Vector3(0,0,1).cross(tangent).normalize(), other = tangent.clone().cross(axis).normalize();
          const a = strand * Math.PI * 2 / 3 + t * Math.PI * 3.1, radius = .019 * (1 - t * .85);
          const direction = axis.multiplyScalar(Math.cos(a)).addScaledVector(other,Math.sin(a));
          const p = center.clone().addScaledVector(direction,radius); strandPoints.push([p.x,p.y,p.z]);
          const cut = center.clone().addScaledVector(direction,radius+.005*(1-t)); groovePoints.push([cut.x,cut.y,cut.z]);
        }
        tube(`socket-entwined-root-${i}-${strand}`,strandPoints,.007,wood,.0007,48,8);
        tube(`socket-root-groove-${i}-${strand}`,groovePoints,.0012,dark,.0002,48,5);
      }
    }
  });
  if (kind === 'water') {
    for (const side of [-1,1]) {
      tube('silver-wave-neck', [[-.039,.852,side*.026],[-.014,.814,side*.036],[.015,.806,side*.036],[.054,.861,side*.018]],.006,metal,.004,36,8);
      for (const offset of [.23,.5,-.53]) {
        const pts: P[] = []; for(let i=0;i<=30;i++){const t=i/30;pts.push([Math.sin(t*5)*.018,offset+t*.21,side*(.022+Math.cos(t*5)*.003)]);} tube('inlaid-silver-water-trail',pts,.0023,metal,.001,35,6);
      }
      const gem = mesh('blue-water-drop',new THREE.SphereGeometry(.006,12,8),jewel,[.013,.61,side*.027]);gem.scale.y=1.7;
    }
  }
  if(kind === 'air') for(const y of [.34,.68]) for(const z of [-.027,.027]) spiral('carved-air-knot',0,y,z,.011,ridge);
  if(kind === 'fire') for(const y of [-.58,-.30,.13,.52,.76]) for(const side of [-1,1]) tube('gold-flame-shaft-inlay',[[.012,y-.045,side*.021],[-.013,y,side*.025],[.007,y+.08,side*.024]],.003,metal,.0004,26,6);
  g.userData.itemModel = { itemId:id, author:'elemental-staves', reference:`art/item-icons/generated/${id}.png`, description:`${p.base} Staff fitted with a ${kind[0]!.toUpperCase()+kind.slice(1)} Orb. Its charge pays for matching spells before carried Essence.`, grip:[0,0,0], focus:[0,cy,0] };
  return g;
}
export const author: ItemModelAuthor = { ids, build };
