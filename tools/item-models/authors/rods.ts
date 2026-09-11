import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Spec = { wood: number; leather: number; metal: number; float: number; guides: number; reel: number; holes: number; bend: number; description: string };
const specs: Record<string, Spec> = {
  worn_rod: { wood: 0x77704b, leather: 0x423128, metal: 0x92764a, float: 0x969085, guides: 3, reel: .081, holes: 8, bend: .14, description: 'A green stick and a length of gut. One effective Fishing level, on a good day.' },
  palewood_rod: { wood: 0xc1985d, leather: 0x9b724a, metal: 0xb39548, float: 0xe0d1b5, guides: 3, reel: .072, holes: 9, bend: .15, description: 'A shaft, a hide line, and a bent pin. Two effective Fishing levels.' },
  duskoak_rod: { wood: 0x493329, leather: 0x354957, metal: 0xa1a7aa, float: 0xc58318, guides: 5, reel: .095, holes: 13, bend: .19, description: 'Springy enough for a trout. Five effective Fishing levels.' },
  cairnpine_rod: { wood: 0x9a6534, leather: 0x302621, metal: 0xa4a39c, float: 0x581b17, guides: 4, reel: .084, holes: 9, bend: .17, description: 'Built for perch, which fight like something with a grudge. Nine effective Fishing levels.' },
  cinderpine_rod: { wood: 0x503020, leather: 0x4c281b, metal: 0xc18351, float: 0xc74b0b, guides: 4, reel: .103, holes: 14, bend: .21, description: 'A flexible walnut rod built for heavy bass. Seventeen effective Fishing levels.' },
};
const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function material(name: string, color: number, kind: 'wood' | 'leather' | 'metal' | 'line' | 'float'): THREE.MeshStandardMaterial {
  const size = 128, data = new Uint8Array(size * size * 4), rough = new Uint8Array(data.length);
  const base = new THREE.Color(color);
  // Color is converted back to sRGB bytes because the map has an explicit sRGB color space.
  base.convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = Math.sin(x * 37.2 + y * 129.6) * 43758.5;
    const n = noise - Math.floor(noise);
    const grain = Math.sin(x * .67 + Math.sin(y * .045) * 1.8 + Math.sin(x * .13 + y * .035));
    const factor = kind === 'wood' ? .78 + .17 * grain + n * .13 : .87 + .13 * n;
    const i = (y * size + x) * 4;
    data.set([base.r * 255 * factor, base.g * 255 * factor, base.b * 255 * factor, 255], i);
    const r = kind === 'metal' ? 96 + n * 48 : kind === 'float' ? 78 + n * 23 : 170 + n * 47;
    rough.set([r, r, r, 255], i);
  }
  const tex = (bytes: Uint8Array, label: string, srgb: boolean) => {
    const t = new THREE.DataTexture(bytes, size, size); t.name = `${name}-${label}`;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; return t;
  };
  const m = new THREE.MeshStandardMaterial({ map: tex(data, 'color', true), roughnessMap: tex(rough, 'roughness', false), roughness: 1, metalness: kind === 'metal' ? .82 : 0 });
  m.name = name; return m;
}

function build(id: string): THREE.Group {
  const s = specs[id]; if (!s) throw new Error(`Unsupported rod ${id}`);
  const g = new THREE.Group(); g.name = id;
  g.userData.itemModel = { itemId: id, author: 'rods', reference: `art/item-icons/generated/${id}.png`, description: s.description, grip: [0, 0, 0] };
  g.userData.gripMeasurements = { center: [0, 0, 0], radius: .026, length: .36, shaftAxis: '+Y' };
  const wood = material(`${id}-longitudinal-wood-grain`, s.wood, 'wood');
  const leather = material(`${id}-creased-hide-wrap`, s.leather, 'leather');
  const metal = material(`${id}-worked-reel-metal`, s.metal, 'metal');
  const dark = material(`${id}-reel-seat-iron`, 0x272624, 'metal');
  const line = material(`${id}-twisted-gut`, id === 'worn_rod' ? 0xb5a581 : 0xaca777, 'line');
  const floatMat = material(`${id}-float-body`, s.float, 'float');
  const mesh = (name: string, geometry: THREE.BufferGeometry, mat: THREE.Material, pos = v(0, 0)) => {
    const m = new THREE.Mesh(geometry, mat); m.name = name; m.position.copy(pos); g.add(m); return m;
  };
  const bar = (name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, top = radius) => {
    const m = mesh(name, new THREE.CylinderGeometry(top, radius, a.distanceTo(b), 14), mat, a.clone().add(b).multiplyScalar(.5));
    m.quaternion.setFromUnitVectors(v(0, 1), b.clone().sub(a).normalize()); return m;
  };
  const tube = (name: string, points: THREE.Vector3[], radius: number, mat: THREE.Material, segments = 40) => mesh(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false), mat);
  const ring = (name: string, p: THREE.Vector3, radius: number, thickness: number, mat: THREE.Material, rotationX = 0) => {
    const m = mesh(name, new THREE.TorusGeometry(radius, thickness, 6, 32), mat, p); m.rotation.x = rotationX; return m;
  };
  const shaftX = (y: number) => s.bend * Math.pow(Math.max(0, y - .2) / 1.45, 2) + (id === 'worn_rod' ? .011 * Math.sin(y * 12) : 0);
  const shaft = (y: number) => v(shaftX(y), y);
  // A tapered solid blank, bent toward the hanging tackle. The worn stick has uneven bark and branch scars.
  const stations = 60, sides = 14, vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let j = 0; j <= stations; j++) {
    const y = -.25 + j / stations * 1.9;
    const r = THREE.MathUtils.lerp(.025, .004, Math.max(0, y + .25) / 1.9);
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * Math.PI * 2;
      const uneven = id === 'worn_rod' ? 1 + .09 * Math.sin(j * 1.1 + k * 2.1) : 1 + .015 * Math.sin(j + k);
      vertices.push(shaftX(y) + Math.cos(a) * r * uneven, y, Math.sin(a) * r * uneven); uv.push(k / sides, j / stations * 3);
      if (j < stations && k < sides) { const a0 = j * (sides + 1) + k, b = a0 + sides + 1; indices.push(a0, b, a0 + 1, b, b + 1, a0 + 1); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals(); mesh('continuous-tapered-bent-wood-blank', geo, wood);
  bar('sealed-wood-tip', shaft(1.645), shaft(1.652), .0041, wood, .0037);
  bar('butt-end-solid-plug', shaft(-.256), shaft(-.22), .025, id === 'worn_rod' ? wood : metal);
  bar('hide-grip-core', v(0, -.18), v(0, .18), .026, leather, .023);
  const helix: THREE.Vector3[] = [];
  for (let i = 0; i <= 520; i++) { const t = i / 520, a = t * Math.PI * 2 * (id === 'worn_rod' ? 27 : 20); helix.push(v(Math.cos(a) * .0265, -.18 + t * .36, Math.sin(a) * .0265)); }
  tube('overlapping-spiral-hide-seam', helix, .0016, leather, 520);
  for (const y of [-.185, .185, .224]) bar(`grip-ferrule-${y}`, v(0, y - .006), v(0, y + .006), .026, metal);
  if (id === 'duskoak_rod') bar('exposed-cork-upper-grip', v(0, .20), v(0, .29), .0215, material(`${id}-cork`, 0x9e8057, 'leather'));
  if (id === 'worn_rod') for (const y of [.48, .84]) {
    bar(`trimmed-branch-scar-${y}`, shaft(y), shaft(y).add(v(-.028, .027, .006)), .015, wood, .009);
    ring(`branch-scar-growth-ring-${y}`, shaft(y).add(v(-.018, .018, .016)), .009, .0015, leather);
  }
  // Reel flange perforations are true through holes, with the wound spool visible behind them.
  const rx = .112, ry = .106, rz = .008, rr = s.reel;
  bar('reel-foot-clamp', v(.012, .155, 0), v(.047, .185, 0), .012, metal);
  bar('reel-curved-seat-lower', v(.018, .075, 0), v(rx - rr * .45, ry + rr * .5, rz), .012, metal);
  bar('reel-upper-support', v(.036, .18, 0), v(rx, ry + rr * .65, rz), .01, metal);
  const plate = (name: string, z: number, rear: boolean) => {
    const shape = new THREE.Shape(); shape.absarc(0, 0, rr, 0, Math.PI * 2, false);
    for (let i = 0; i < s.holes; i++) { const a = i / s.holes * Math.PI * 2, hole = new THREE.Path(); hole.absarc(Math.cos(a) * rr * .71, Math.sin(a) * rr * .71, rr * (s.holes > 10 ? .095 : .13), 0, Math.PI * 2, true); shape.holes.push(hole); }
    if (s.holes > 10) for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, hole = new THREE.Path(); hole.absarc(Math.cos(a) * rr * .43, Math.sin(a) * rr * .43, rr * .039, 0, Math.PI * 2, true); shape.holes.push(hole); }
    mesh(name, new THREE.ExtrudeGeometry(shape, { depth: .004, steps: 1, bevelEnabled: true, bevelSize: .0007, bevelThickness: .0007, bevelSegments: 1, curveSegments: 7 }), metal, v(rx, ry, z));
    ring(`${name}-raised-rim`, v(rx, ry, z + (rear ? 0 : .004)), rr * .98, .0027, metal);
  };
  plate('reel-rear-perforated-flange', rz - .026, true); plate('reel-front-perforated-flange', rz + .024, false);
  bar('reel-central-spool-drum', v(rx, ry, rz - .024), v(rx, ry, rz + .025), rr * .48, dark);
  for (let i = 0; i < 24; i++) ring(`spool-gut-winding-${i}`, v(rx, ry, rz - .022 + i * .0019), rr * .79 + .0008 * Math.sin(i), .0015, line);
  bar('reel-through-axle', v(rx, ry, rz - .038), v(rx, ry, rz + .047), .010, metal);
  bar('front-axle-boss', v(rx, ry, rz + .029), v(rx, ry, rz + .041), .022, metal, .016);
  bar('rear-bearing-cap', v(rx, ry, rz - .036), v(rx, ry, rz - .029), .019, metal);
  const crankX = rx + rr * .51, crankY = ry - rr * .17;
  bar('crank-solid-offset-arm', v(rx, ry, rz + .045), v(crankX, crankY, rz + .045), .0075, metal);
  bar('crank-handle-axle', v(crankX, crankY, rz + .042), v(crankX, crankY, rz + .084), .005, metal);
  bar('crank-turned-wood-knob', v(crankX, crankY, rz + .052), v(crankX, crankY, rz + .087), .011, wood, .009);
  bar('crank-end-rivet', v(crankX, crankY, rz + .087), v(crankX, crankY, rz + .09), .0055, metal);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; bar(`rear-seat-screw-${i}`, v(rx + Math.cos(a) * .028, ry + Math.sin(a) * .028, rz - .032), v(rx + Math.cos(a) * .028, ry + Math.sin(a) * .028, rz - .027), .0035, metal); }
  const linePoints = [v(rx, ry + rr * .8, rz), v(.07, .29, .013)];
  for (let i = 0; i < s.guides; i++) {
    const y = .40 + i / (s.guides - 1) * 1.25, r = .023 - i / (s.guides - 1) * .013;
    const root = shaft(y), p = root.clone().add(v(r + .013, -.01, .006));
    bar(`guide-${i}-seat`, shaft(y - .014), shaft(y + .014), .025 - y * .011, metal);
    ring(`guide-${i}-open-eye`, p, r, .0026, metal, .6);
    bar(`guide-${i}-brace`, root, p.clone().add(v(-r * .6, -r * .65, 0)), .0024, metal);
    for (let k = 0; k < 5; k++) ring(`guide-${i}-binding-${k}`, shaft(y - .012 + k * .005), .025 - y * .011, .0011, id === 'worn_rod' ? leather : metal, Math.PI / 2);
    linePoints.push(p);
  }
  const tip = linePoints[linePoints.length - 1]!.clone();
  const guidePointIndex = linePoints.length - 1;
  const floatPos = v(tip.x + .13, 1.19, .007);
  linePoints.push(v(tip.x + .12, tip.y - .065, .009), floatPos.clone().add(v(0, .053, 0)));
  g.userData.itemModel.fishing = {
    lineGuide: tip.toArray(),
    crankAnchor: [crankX, crankY, rz + (.052 + .087) / 2],
    line: id === 'worn_rod' ? 0xb5a581 : 0xaca777,
    bobber: s.float,
  };
  // Sample ranges of the original curve so splitting the tackle does not alter its silhouette.
  const fullLine = new THREE.CatmullRomCurve3(linePoints);
  const split = guidePointIndex / (linePoints.length - 1);
  class LineRange extends THREE.Curve<THREE.Vector3> {
    constructor(private readonly start: number, private readonly end: number) { super(); }
    override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
      return fullLine.getPoint(this.start + (this.end - this.start) * t, target);
    }
  }
  mesh('continuous-gut-from-spool-through-final-guide', new THREE.TubeGeometry(new LineRange(0, split), Math.ceil(160 * split), .0011, 6, false), line);
  const tackleStart = g.children.length;
  mesh('hanging-gut-from-final-guide-to-float', new THREE.TubeGeometry(new LineRange(split, 1), Math.ceil(160 * (1 - split)), .0011, 6, false), line);
  const body = mesh('solid-oval-fishing-float', new THREE.SphereGeometry(.028, 20, 14), floatMat, floatPos); body.scale.set(1, id === 'cairnpine_rod' ? 1 : 1.45, .85);
  ring('float-equator-band', floatPos, .028, .0017, metal, Math.PI / 2);
  for (const sign of [-1, 1]) {
    bar(`float-${sign}-cap`, floatPos.clone().add(v(0, sign * .035)), floatPos.clone().add(v(0, sign * .044)), .010, metal, .004);
    ring(`float-${sign}-attachment-eye`, floatPos.clone().add(v(0, sign * .047)), .005, .0013, metal);
  }
  tube('short-hook-leader', [floatPos.clone().add(v(0, -.05)), floatPos.clone().add(v(.005, -.07)), floatPos.clone().add(v(.014, -.078))], .0011, line, 12);
  tube('bent-pin-hook', [floatPos.clone().add(v(.014, -.078)), floatPos.clone().add(v(.019, -.091)), floatPos.clone().add(v(.008, -.096)), floatPos.clone().add(v(.005, -.085))], .0013, metal, 15);
  for (const part of g.children.slice(tackleStart)) part.userData.itemModelPart = 'tackle';
  return g;
}

export const author: ItemModelAuthor = { ids: Object.keys(specs), build };
