/** Original leafless tree architecture. All forks attach to their parent's swept centreline. */
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from 'three';

export type V = [number, number, number];
export type TreeId = 'corealm_deadwood_hollow' | 'corealm_deadwood_claw' | 'corealm_deadwood_crown' | 'corealm_deadwood_fallen';
export interface Ring { p: V; radius: number }
export interface Axis { id: number; parent: number | null; at: number; rings: Ring[]; broken: boolean; root: boolean }
export interface Skin { position: number[]; normal: number[]; uv: number[]; colour: number[]; indices: number[] }
export interface TreeGeometry { id: TreeId; axes: Axis[]; skins: Record<'bark' | 'heartwood' | 'cavity', Skin>; openingFaces: number; min: V; max: V; triangles: number }
const TAU = Math.PI * 2;
const blank = (): Skin => ({ position: [], normal: [], uv: [], colour: [], indices: [] });
const vector = (p: V): Vector3 => new Vector3(...p);
const tuple = (p: Vector3): V => [p.x, p.y, p.z];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
function random(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function pointOn(axis: Axis, t: number): Ring {
  const f = Math.max(0, Math.min(1, t)) * (axis.rings.length - 1), i = Math.min(axis.rings.length - 2, Math.floor(f));
  const a = axis.rings[i]!, b = axis.rings[i + 1]!, u = f - i;
  return { p: a.p.map((v, n) => mix(v, b.p[n]!, u)) as V, radius: mix(a.radius, b.radius, u) };
}

class Tree {
  axes: Axis[] = [];
  readonly rand: () => number;
  constructor(readonly id: TreeId, seed: number) { this.rand = random(seed); }
  axis(parent: Axis | null, at: number, controls: V[], radii: number[], broken = false, root = false): Axis {
    if (parent) controls[0] = pointOn(parent, at).p;
    const curve = new CatmullRomCurve3(controls.map(vector), false, 'centripetal');
    const steps = Math.max(8, Math.ceil(curve.getLength() / .22));
    const rings = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps, f = t * (radii.length - 1), j = Math.min(radii.length - 2, Math.floor(f));
      return { p: tuple(curve.getPoint(t)), radius: mix(radii[j]!, radii[j + 1]!, f - j) };
    });
    const axis: Axis = { id: this.axes.length, parent: parent?.id ?? null, at, rings, broken, root };
    this.axes.push(axis); return axis;
  }
  child(parent: Axis, at: number, offsets: V[], radius: number, broken = false): Axis {
    const joint = pointOn(parent, at), base = joint.p;
    const start = Math.min(radius, joint.radius * .76);
    // Follow the parent briefly through a flared collar before the lateral opens out.
    const tangent = vector(pointOn(parent, Math.min(1, at + .035)).p).sub(vector(pointOn(parent, Math.max(0, at - .035)).p)).normalize();
    const departure = vector(offsets[0]!).normalize();
    const collar = tangent.multiplyScalar(.6).addScaledVector(departure, .4).normalize().multiplyScalar(start * 1.6);
    const axis = this.axis(parent, at, [base, add(base, tuple(collar)), ...offsets.map(p => add(base, p))], [start, start * .78, start * .39, broken ? start * .23 : Math.min(.009, start * .12)], broken, parent.root);
    return axis;
  }
  roots(parent: Axis, count: number, reach: number): void {
    let theta = this.rand();
    for (let i = 0; i < count; i++) {
      theta += .55 + this.rand() * .55;
      const span = reach * (.55 + this.rand() * .55), bend = (this.rand() - .5) * .8;
      const radius = pointOn(parent, .015).radius * (.28 + this.rand() * .16);
      const root = this.axis(parent, .012 + this.rand() * .027, [[0, 0, 0],
        [Math.cos(theta) * span * .24, .22, Math.sin(theta) * span * .24],
        [Math.cos(theta + bend * .4) * span * .61, .09, Math.sin(theta + bend * .4) * span * .61],
        [Math.cos(theta + bend) * span, .015, Math.sin(theta + bend) * span]], [radius, radius * .73, radius * .25, .009], false, true);
      for (let j = 0; j < 2; j++) {
        const at = .46 + j * .24, joint = pointOn(root, at), angle = theta + bend + (j ? -.65 : .8);
        const tip: V = [Math.cos(angle) * span * .32, -.04, Math.sin(angle) * span * .32];
        this.child(root, at, [[tip[0] * .48, -.01, tip[2] * .48], tip], joint.radius * .48);
      }
    }
  }
  twigs(parent: Axis, count: number, habit: 'crown' | 'claw' | 'hollow'): void {
    for (let i = 0; i < count; i++) {
      const at = .28 + (i + this.rand() * .5) / count * .57;
      const tangent = vector(pointOn(parent, Math.min(.98, at + .1)).p).sub(vector(pointOn(parent, at - .08).p)).normalize();
      const side = new Vector3(-tangent.z, .12, tangent.x).normalize().multiplyScalar(i % 2 ? -1 : 1);
      const length = .55 + this.rand() * 1.15;
      const direction = tangent.multiplyScalar(.6).addScaledVector(side, .55 + this.rand() * .35);
      direction.y += habit === 'claw' ? .08 : .28;
      direction.normalize().multiplyScalar(length);
      const d = tuple(direction), elbow = this.rand() * .24 - .12;
      const child = this.child(parent, at, [[d[0] * .37, d[1] * .43, d[2] * .4], [d[0] * .76 + elbow, d[1] * .8, d[2] * .73], d], Math.min(.085, pointOn(parent, at).radius * .55), this.rand() < .22);
      if (i % 3 !== 1) {
        const end = direction.clone().multiplyScalar(.42).addScaledVector(side, -.24);
        this.child(child, .47 + this.rand() * .22, [tuple(end.clone().multiplyScalar(.45)), tuple(end)], .022, this.rand() < .2);
      }
    }
  }
}

function architecture(id: TreeId): Tree {
  const tree = new Tree(id, { corealm_deadwood_hollow: 19311, corealm_deadwood_claw: 22909, corealm_deadwood_crown: 40861, corealm_deadwood_fallen: 61393 }[id]);
  if (id === 'corealm_deadwood_hollow') {
    const trunk = tree.axis(null, 0, [[0, 0, 0], [.12, 1.25, .08], [-.07, 2.85, -.03], [-.34, 4.3, .18], [-1.1, 5.7, .02], [-1.55, 7.3, -.32], [-1.3, 8.8, -.55]], [.87, .72, .62, .48, .34, .18, .045], true);
    tree.roots(trunk, 7, 2.25);
    const left = tree.child(trunk, .47, [[-.65, .6, -.2], [-1.7, 1.2, -.7], [-2.25, 2.1, -.52]], .29, true);
    const right = tree.child(trunk, .43, [[.4, .65, .14], [1.18, 1.7, .5], [1.85, 3.5, .76]], .38, true);
    for (const [parent, side] of [[left, -1], [right, 1]] as const) for (let i = 0; i < 4; i++) {
      const at = .26 + i * .17, z = (i % 2 ? -1 : 1) * (.7 + tree.rand());
      const b = tree.child(parent, at, [[side * .55, .1, z * .25], [side * (1.3 + tree.rand() * .6), .45, z * .9], [side * (1.4 + tree.rand() * .8), 1.4, z]], .16 - i * .023, i === 2);
      tree.twigs(b, 3, 'hollow');
    }
  } else if (id === 'corealm_deadwood_claw') {
    const trunk = tree.axis(null, 0, [[0, 0, 0], [-.15, 1.55, .07], [.6, 3.3, -.18], [2.4, 4.55, -.12], [4.1, 4.75, .15], [5.7, 4.45, .32]], [.63, .48, .36, .25, .13, .025]);
    tree.roots(trunk, 6, 2.05);
    for (let i = 0; i < 7; i++) {
      const at = .25 + i * .083 + tree.rand() * .03, sign = i % 2 ? -1 : 1, reach = 1.25 + tree.rand() * .7;
      const limb = tree.child(trunk, at, [[.15, .6, sign * .6], [.7, 1.25, sign * reach], [1.7, 1.65, sign * (reach + .3)], [2.55, 1.2, sign * (reach + .45)]], .2 - i * .014, i === 0);
      tree.twigs(limb, 4, 'claw');
    }
    const windward = tree.child(trunk, .2, [[-.68, .6, .1], [-1.2, .85, .2], [-1.65, .72, .27]], .2, true);
    tree.child(windward, .56, [[-.12, .6, .3], [-.35, .98, .4]], .06, true);
  } else if (id === 'corealm_deadwood_crown') {
    const trunk = tree.axis(null, 0, [[0, 0, 0], [.1, 1.8, .12], [-.18, 3.25, .07], [.15, 4.55, -.2], [.5, 6.2, -.43], [.3, 7.3, -.38]], [.85, .59, .47, .35, .21, .07], true);
    tree.roots(trunk, 8, 2.7);
    // Old broadleaf scaffold: a few heavy unequal limbs, each with its own smaller crown.
    const scaffolds = [
      { at: .28, angle: .3, reach: 4.3, rise: 1.2 },
      { at: .39, angle: 2.5, reach: 3.8, rise: 2.8 },
      { at: .48, angle: 4.65, reach: 4.8, rise: 1.7 },
      { at: .62, angle: 1.5, reach: 3.6, rise: 2.9 },
      { at: .74, angle: 3.4, reach: 2.8, rise: 2.0 },
      { at: .85, angle: 5.5, reach: 2.4, rise: 2.2 },
    ];
    for (const [i, spec] of scaffolds.entries()) {
      const { at, angle, reach, rise } = spec;
      const x = Math.cos(angle) * reach, z = Math.sin(angle) * reach;
      const limb = tree.child(trunk, at, [[x * .22, rise * .34, z * .16],
        [x * .5, rise * .53, z * .61], [x * .81, rise * .68, z * .87],
        [x, rise, z]], .35 - i * .033, i === 4);
      tree.twigs(limb, 5, 'crown');
      const side = i % 2 ? -1 : 1;
      const spur = tree.child(limb, .39 + tree.rand() * .18,
        [[x * .07 + side * .32, .4, z * .08], [x * .15 + side * .75, 1.2, z * .24], [x * .25 + side * .9, 1.65 + tree.rand() * .8, z * .45]], .13 - i * .009);
      tree.twigs(spur, 3, 'crown');
    }
  } else {
    const trunk = tree.axis(null, 0, [[-3.8, .78, -.3], [-2.25, .55, -.12], [0, .42, .17], [2.6, .3, -.16], [4.45, .22, -.63]], [.72, .5, .39, .24, .08], true);
    // Uneven structural roots sweep back from the butt, then split into smaller torn roots.
    // Their attachment spans the butt collar instead of converging in a flat fan.
    const rootDirections: V[] = [[-.95, 1.75, -.75], [-1.4, .85, -1.5], [-.65, 1.95, .42], [-1.55, .65, 1.4], [-.9, -.45, 1.5], [-1.2, -.5, -.95]];
    for (const [i, d] of rootDirections.entries()) {
      const at = .004 + i * .012, base = pointOn(trunk, at).p, radius = .29 - i * .018;
      const root = tree.axis(trunk, at, [base, add(base, [d[0] * .22, d[1] * .28, d[2] * .25]),
        add(base, [d[0] * .55, d[1] * .78, d[2] * .62]), add(base, d)], [radius, radius * .8, radius * .38, .028], true, true);
      for (let j = 0; j < 3; j++) {
        const sign = (i + j) % 2 ? -1 : 1, at = .38 + j * .19;
        const lateral = tree.child(root, at, [[-.16, sign * .16, sign * .22], [-.38 - tree.rand() * .3, sign * (.2 + tree.rand() * .2), sign * (.38 + tree.rand() * .22)]], pointOn(root, at).radius * .48, true);
        if (j === 1) tree.child(lateral, .61, [[-.15, -.08, sign * .14], [-.34, -.17, sign * .2]], .023, true);
      }
    }
    for (let i = 0; i < 6; i++) {
      const sign = i % 2 ? -1 : 1, limb = tree.child(trunk, .24 + i * .11, [[.2, .3, sign * .58], [.5, .45 + (i % 3) * .18, sign * 1.35], [.8, .55 + (i % 3) * .35, sign * 1.8]], .18 - i * .018, true);
      if (i % 2 === 0) tree.child(limb, .6, [[-.08, .6, sign * .12], [.1, .93, sign * .23]], .055, true);
    }
  }
  return tree;
}

/** Circular sweep with transported frames, longitudinal fluting and a genuinely open hollow bole. */
export function generateTree(id: TreeId): TreeGeometry {
  const tree = architecture(id), skins = { bark: blank(), heartwood: blank(), cavity: blank() };
  let openingFaces = 0;
  const vertex = (skin: Skin, p: Vector3, u: number, v: number, shade: number): number => {
    const index = skin.position.length / 3; skin.position.push(p.x, Math.max(0, p.y), p.z); skin.uv.push(u, v); skin.colour.push(shade, shade, shade); return index;
  };
  const triangle = (skin: Skin, a: number, b: number, c: number): void => {
    const p = (i: number) => new Vector3(skin.position[i * 3], skin.position[i * 3 + 1], skin.position[i * 3 + 2]);
    if (p(b).sub(p(a)).cross(p(c).sub(p(a))).lengthSq() > 1e-14) skin.indices.push(a, b, c);
  };
  for (const axis of tree.axes) {
    const hollow = id === 'corealm_deadwood_hollow' && axis.id === 0;
    const sides = hollow ? 48 : axis.rings[0]!.radius > .4 ? 24 : axis.rings[0]!.radius > .17 ? 14 : axis.rings[0]!.radius > .05 ? 9 : 6;
    const tearAngles = (y: number): [number, number] => {
      const t = Math.max(0, Math.min(1, (y - .25) / 3.25));
      const centre = 18 + .22 * Math.sin(y * 2.8) - .15 * Math.cos(y * 5);
      const halfWidth = .15 + 2.8 * Math.sin(Math.PI * t) ** .6 * (1 + .15 * Math.sin(y * 4));
      return [(centre - halfWidth) / 24 * TAU, (centre + halfWidth) / 24 * TAU];
    };
    const outside: number[][] = [], inside: number[][] = [], centres = axis.rings.map(r => vector(r.p));
    let u = new Vector3(1, 0, 0), arc = 0;
    for (let i = 0; i < axis.rings.length; i++) {
      if (i) arc += centres[i]!.distanceTo(centres[i - 1]!);
      const tangent = centres[Math.min(i + 1, centres.length - 1)]!.clone().sub(centres[Math.max(0, i - 1)]!).normalize();
      if (Math.abs(u.dot(tangent)) > .96) u = new Vector3(0, 0, 1);
      u.sub(tangent.clone().multiplyScalar(u.dot(tangent))).normalize();
      const v = tangent.clone().cross(u).normalize(), ring = axis.rings[i]!;
      outside.push([]); inside.push([]);
      for (let j = 0; j <= sides; j++) {
        // The same two boundary columns follow the curved tear at every height. A changing
        // integer face mask would leave a staircase of identical rectangular cut marks.
        const [left, right] = tearAngles(ring.p[1]);
        const a = hollow ? j <= 30 ? j / 30 * left : j <= 42 ? mix(left, right, (j - 30) / 12) : mix(right, TAU, (j - 42) / 6) : j / sides * TAU;
        const flute = 1 + .055 * Math.sin(a * 5 + arc * .38) + .035 * Math.sin(a * 9 - arc * .6);
        const radial = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
        const terminal = axis.broken && i === axis.rings.length - 1 ? tangent.clone().multiplyScalar((.05 + ring.radius * .5) * Math.sin(a * 3 + .7)) : new Vector3();
        const point = centres[i]!.clone().addScaledVector(radial, ring.radius * flute).add(terminal);
        outside[i]!.push(vertex(skins.bark, point, a * axis.rings[0]!.radius / 1.2, arc / 1.2, .88 + .1 * Math.cos(a * 3 + axis.id)));
        if (hollow) inside[i]!.push(vertex(skins.cavity, centres[i]!.clone().addScaledVector(radial, ring.radius * flute * .7).add(terminal), a / TAU * 3, arc / 1.2, .5));
      }
    }
    const isOpening = (i: number, j: number): boolean => {
      if (!hollow || i < 0 || i >= outside.length - 1 || j < 0 || j >= sides) return false;
      const y = (axis.rings[i]!.p[1] + axis.rings[i + 1]!.p[1]) / 2;
      return y > .25 && y < 3.5 && j >= 30 && j < 42;
    };
    for (let i = 0; i < outside.length - 1; i++) for (let j = 0; j < sides; j++) {
      // A high narrow rip at +Z opens into a full thickness dark cavity, no black decal.
      const open = isOpening(i, j);
      const a = outside[i]![j]!, b = outside[i]![j + 1]!, c = outside[i + 1]![j]!, d = outside[i + 1]![j + 1]!;
      if (!open) { triangle(skins.bark, a, b, c); triangle(skins.bark, b, d, c); }
      else openingFaces += 2;
      if (hollow) {
        const ia = inside[i]![j]!, ib = inside[i]![j + 1]!, ic = inside[i + 1]![j]!, ix = inside[i + 1]![j + 1]!;
        if (!open) { triangle(skins.cavity, ia, ic, ib); triangle(skins.cavity, ib, ic, ix); }
        // Only the perimeter receives a lip: internal edges stay open into the hollow.
        const edges = [[a, b, ia, ib, i - 1, j], [b, d, ib, ix, i, j + 1], [d, c, ix, ic, i + 1, j], [c, a, ic, ia, i, j - 1]];
        if (open) for (const [outer0, outer1, inner0, inner1, neighbourI, neighbourJ] of edges) {
          if (isOpening(neighbourI!, neighbourJ!)) continue;
          const get = (skin: Skin, n: number): Vector3 => new Vector3(...skin.position.slice(n * 3, n * 3 + 3) as V);
          const s = skins.heartwood, ids = [get(skins.bark, outer0!), get(skins.bark, outer1!), get(skins.cavity, inner0!), get(skins.cavity, inner1!)].map(p => vertex(s, p, (p.x + p.z) / 1.2, p.y / 1.2, .7));
          triangle(s, ids[0]!, ids[1]!, ids[2]!); triangle(s, ids[1]!, ids[3]!, ids[2]!);
        }
      }
    }
    const last = outside.length - 1;
    if (!hollow) {
      const s = axis.broken ? skins.heartwood : skins.bark, centre = vertex(s, centres[last]!, .5, .5, .9), perimeter = outside[last]!.map((n, j) => vertex(s, new Vector3(...skins.bark.position.slice(n * 3, n * 3 + 3) as V), .5 + Math.cos(j / sides * TAU) * .5, .5 + Math.sin(j / sides * TAU) * .5, .9));
      for (let j = 0; j < sides; j++) triangle(s, centre, perimeter[j]!, perimeter[j + 1]!);
    } else {
      const s = skins.heartwood;
      for (let j = 0; j < sides; j++) {
        const points = [outside[last]![j]!, outside[last]![j + 1]!].map(n => new Vector3(...skins.bark.position.slice(n * 3, n * 3 + 3) as V));
        points.push(...[inside[last]![j]!, inside[last]![j + 1]!].map(n => new Vector3(...skins.cavity.position.slice(n * 3, n * 3 + 3) as V)));
        const ids = points.map((p, k) => vertex(s, p, k % 2, k < 2 ? 0 : 1, .72));
        triangle(s, ids[0]!, ids[1]!, ids[2]!); triangle(s, ids[1]!, ids[3]!, ids[2]!);
      }
    }
    if (id === 'corealm_deadwood_fallen' && axis.parent === null) {
      const s = skins.heartwood, centre = vertex(s, centres[0]!, .5, .5, .83);
      const edge = outside[0]!.map((n, j) => vertex(s, new Vector3(...skins.bark.position.slice(n * 3, n * 3 + 3) as V), .5 + Math.cos(j / sides * TAU) * .5, .5 + Math.sin(j / sides * TAU) * .5, .83));
      for (let j = 0; j < sides; j++) triangle(s, centre, edge[j + 1]!, edge[j]!);
    }
  }
  const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const skin of Object.values(skins)) {
    if (!skin.indices.length) continue;
    const used = [...new Set(skin.indices)], remap = new Map(used.map((old, index) => [old, index]));
    skin.position = used.flatMap(index => skin.position.slice(index * 3, index * 3 + 3));
    skin.colour = used.flatMap(index => skin.colour.slice(index * 3, index * 3 + 3));
    skin.uv = used.flatMap(index => skin.uv.slice(index * 2, index * 2 + 2));
    skin.indices = skin.indices.map(index => remap.get(index)!);
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(skin.position), 3)).setIndex(skin.indices);
    geometry.computeVertexNormals(); skin.normal = Array.from(geometry.getAttribute('normal').array); geometry.dispose();
    for (let i = 0; i < skin.position.length; i++) { const a = i % 3; min[a] = Math.min(min[a]!, skin.position[i]!); max[a] = Math.max(max[a]!, skin.position[i]!); }
    triangles += skin.indices.length / 3;
  }
  if (min[1] > 0) {
    const lift = min[1];
    for (const skin of Object.values(skins)) for (let i = 1; i < skin.position.length; i += 3) skin.position[i] = skin.position[i]! - lift;
    for (const axis of tree.axes) for (const ring of axis.rings) ring.p[1] -= lift;
    max[1] -= lift; min[1] = 0;
  }
  return { id, axes: tree.axes, skins, openingFaces, min, max, triangles };
}

export const TREE_DESIGNS = [
  { id: 'corealm_deadwood_hollow', name: 'Hollow griefwood', description: 'Ancient split bole with an open weathered cavity, unequal surviving stems and long crooked boughs. Pale grey wood, dark interior, broken heartwood.', colour: [.58, .58, .55], habitat: 'Cemetery edges, ruined chapels and sheltered hollows; one or two focal trees among smaller deadwood.' },
  { id: 'corealm_deadwood_claw', name: 'Rakewind snag', description: 'Wind-bent trunk carrying a one-sided comb of hooked boughs, severed windward limbs and exposed roots. Charcoal bark with bare hooked tips.', colour: [.27, .28, .29], habitat: 'Exposed moors and ridges, orienting leeward in loose groups; useful early in the northern ecotone.' },
  { id: 'corealm_deadwood_crown', name: 'Petrified crown oak', description: 'Broad, leafless crown with unequal rising limbs, fine attached forks and a grounded fluted buttress. Mineral-grey bark on a heavy dead scaffold.', colour: [.46, .49, .49], habitat: 'Dead forest interior, broad spaced groves around ruins; retain gaps under branches for mobs and sight lines.' },
  { id: 'corealm_deadwood_fallen', name: 'Windthrown gravewood', description: 'Grounded fallen bole with an attached heaved root plate, splintered butt and irregular surviving branch stubs.', colour: [.38, .35, .31], habitat: 'Off-road ruin perimeters and grove margins only; long horizontal footprint must not cross travel lanes.' },
] as const;
