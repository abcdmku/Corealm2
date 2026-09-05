import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Overlapping flattened locks, each with a curved root and a loose tapered end. */
export function horseMane(s, p) {
  const dark = new THREE.Color(p.dark);
  const hairColor = (lock, sides) => (_point, index) => {
    const a = (index % sides) / sides * Math.PI * 2;
    const t = Math.floor(index / sides) / 15;
    return dark.clone().lerp(new THREE.Color(0x70513a), .09 + .035 * (lock % 3))
      .multiplyScalar(.87 + .12 * Math.cos(a * 5 + t * .9) + .04 * Math.cos(a * 9 - t * 2));
  };
  const rootCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.735, .415),
    new THREE.Vector3(0, 1.905, .535),
    new THREE.Vector3(0, 2.130, .770),
    new THREE.Vector3(0, 2.258, 1.055),
  ], false, 'centripetal');

  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const root = rootCurve.getPoint(t);
    const length = .29 + .095 * Math.sin(t * Math.PI) + .035 * Math.sin(i * 1.9);
    const sweep = .050 + .055 * Math.sin(t * Math.PI);
    const curl = .017 * Math.sin(i * 2.2);
    const width = .038 + .016 * Math.sin(t * Math.PI);
    const neckWeight = smooth(.03, .46, t);
    const weights = () => [[s.rig.index.Body, 1 - neckWeight], [s.rig.index.Neck, neckWeight]];
    s.loft([
      [root.x - .011, root.y - .012, root.z, width * .72, .012],
      [.055, root.y + .008, root.z - .006, width, .023],
      [.128 + .012 * Math.sin(i), root.y - length * .25, root.z - sweep * .35, width * 1.04, .026],
      [.182 + curl, root.y - length * .62, root.z - sweep, width * .81, .018],
      [.178 + curl * 1.8, root.y - length * .88, root.z - sweep * 1.08, width * .42, .011],
      [.140 + curl * 2, root.y - length, root.z - sweep * .86, .0025, .0025],
    ], 'Neck', hairColor(i, 10), {
      rings: 15, sides: 10, axis: [0, .56, .83], weights,
      detail: (v, a) => 1 + .065 * Math.cos(a * 5 + v * .9) + .025 * Math.cos(a * 9 - v * 2),
    });
  }

  // A few narrower locks escape on the opposite side. Their roots remain buried
  // among the main locks, so there is no continuous blade along the crest.
  for (let i = 0; i < 4; i++) {
    const t = .24 + i * .20;
    const root = rootCurve.getPoint(t);
    const neckWeight = smooth(.03, .46, t);
    s.loft([
      [-.01, root.y - .008, root.z, .028, .011],
      [-.056, root.y - .012, root.z - .018, .035, .016],
      [-.104, root.y - .10, root.z - .060, .025, .014],
      [-.110, root.y - .185 - .018 * (i % 2), root.z - .065, .010, .007],
      [-.086, root.y - .215, root.z - .045, .002, .002],
    ], 'Neck', hairColor(i + 1, 8), {
      rings: 10, sides: 8, axis: [0, .5, .86],
      weights: () => [[s.rig.index.Body, 1 - neckWeight], [s.rig.index.Neck, neckWeight]],
      detail: (v, a) => 1 + .06 * Math.cos(a * 5 + v),
    });
  }

  // The forelock bends forward between the ears and curls onto the forehead.
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * .027;
    const end = .015 * Math.sin(i * 1.7);
    const length = .18 + .035 * Math.cos(i * 1.4);
    s.loft([
      [x * .65, p.head[1] + .205, p.head[2] - .035, .025, .012],
      [x + .013, p.head[1] + .229, p.head[2] + .057, .034, .019],
      [x + .029, p.head[1] + .165, p.head[2] + .161, .032, .017],
      [x + .021, p.head[1] + .23 - length, p.head[2] + .204, .020, .011],
      [x + end, p.head[1] + .205 - length, p.head[2] + .207, .002, .002],
    ], 'Head', hairColor(i, 10), {
      rings: 12, sides: 10, axis: [1, 0, 0],
      detail: (v, a) => 1 + .055 * Math.cos(a * 5 + v * 1.5),
    });
  }
}

/** Heavy overlapping tail locks with engraved fibres and swept, uneven ends. */
export function horseTail(s, p) {
  const tailWeight = point => {
    const tip = 1 - smooth(.78, 1.28, point[1]);
    return [[s.rig.index.Tail, 1 - tip], [s.rig.index.TailTip, tip]];
  };
  // The short dock is almost entirely enclosed by the roots of the hair.
  s.loft([
    [0, p.tail[1] + .035, p.tail[2] + .025, .048, .052],
    [0, p.tail[1] - .055, p.tail[2] - .075, .057, .063],
    [0, p.tail[1] - .210, p.tail[2] - .225, .031, .041],
  ], 'Tail', p.dark, { rings: 10, sides: 12, weights: tailWeight });

  const dark = new THREE.Color(p.dark), warm = new THREE.Color(0x6b4934);
  const sides = 16, rings = 18;
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2;
    const x = Math.cos(a), z = Math.sin(a);
    const offset = .009 * Math.sin(i * 2.4);
    const endY = .405 + .10 * (.5 + .5 * Math.sin(i * 2.13));
    const curl = .023 * Math.sin(i * 1.8);
    const width = .044 + .008 * Math.sin(i * 2.6) ** 2;
    const hairColor = (_point, index) => {
      const angle = (index % sides) / sides * Math.PI * 2;
      const along = Math.floor(index / sides) / rings;
      const fibres = Math.cos(angle * 7 + along * .55 + i * .4);
      return dark.clone().lerp(warm, .09 + .025 * (i % 3))
        .multiplyScalar(.96 + .085 * fibres + .025 * Math.cos(angle * 3 - along));
    };
    s.loft([
      [x * .014, p.tail[1] - .008, p.tail[2] - .026 + z * .015, width * .62, .021],
      [x * .040, 1.350, -1.174 + z * .025, width * .93, .028],
      [x * .060 + .005, 1.115, -1.341 + z * .040, width * 1.10, .029],
      [x * .059 + .014, .867, -1.446 + z * .042, width * .94, .027],
      [x * .047 + .009 + curl * .3, .650, -1.478 + z * .038, width * .73, .022],
      [x * .029 + curl, endY + .074, -1.450 + z * .031 + offset, width * .37, .013],
      [x * .017 + curl * 1.7, endY, -1.406 + z * .020 + offset, .0025, .003],
    ], 'Tail', hairColor, {
      rings, sides, axis: [-z, .04, x], weights: tailWeight,
      detail: (along, angle) => 1 + .078 * Math.cos(angle * 7 + along * .55 + i * .4)
        + .025 * Math.cos(angle * 3 - along),
    });
  }
}

// The contour is the whole antler, including its brow branch and crown tines.
// Each tine has two curved flanks meeting at a narrow, rounded end. Deep valleys
// never cut through the broad palm beneath them. The last component controls how
// much of a corner is rounded; small values preserve the pointed tips.
const ANTLER_OUTLINE = [
  [.135, 2.197, 1.092, .25], [.244, 2.211, 1.105, .28],
  [.334, 2.259, 1.151, .32], [.411, 2.272, 1.244, .30],
  [.488, 2.303, 1.365, .20], [.552, 2.372, 1.422, .055],
  [.526, 2.371, 1.347, .18], [.472, 2.335, 1.249, .30],
  [.487, 2.379, 1.100, .36], [.642, 2.390, .952, .35],
  [.829, 2.402, .840, .34], [.998, 2.461, .743, .28],
  [1.112, 2.572, .664, .27], [1.206, 2.734, .583, .045],
  [1.144, 2.696, .628, .20], [1.037, 2.575, .704, .33],
  [1.045, 2.692, .685, .27], [1.086, 2.880, .636, .045],
  [1.026, 2.827, .686, .20], [.959, 2.667, .738, .27],
  [.907, 2.602, .785, .34], [.898, 2.744, .777, .25],
  [.922, 2.903, .744, .045], [.864, 2.859, .799, .22],
  [.807, 2.649, .844, .32], [.766, 2.587, .885, .33],
  [.748, 2.763, .897, .25], [.689, 2.877, .937, .045],
  [.684, 2.793, .949, .20], [.683, 2.647, .957, .29],
  [.629, 2.557, 1.007, .33], [.581, 2.682, 1.034, .27],
  [.516, 2.759, 1.086, .045], [.526, 2.652, 1.092, .25],
  [.537, 2.553, 1.071, .30], [.452, 2.458, 1.124, .32],
  [.381, 2.578, 1.189, .045], [.367, 2.492, 1.188, .24],
  [.370, 2.399, 1.145, .30], [.278, 2.315, 1.114, .32],
  [.133, 2.266, 1.085, .25],
];

function roundedContour(nodes) {
  const points = [];
  for (let i = 0; i < nodes.length; i++) {
    const prev = new THREE.Vector3(...nodes[(i + nodes.length - 1) % nodes.length]);
    const point = new THREE.Vector3(...nodes[i]);
    const next = new THREE.Vector3(...nodes[(i + 1) % nodes.length]);
    const radius = nodes[i][3];
    const incoming = point.clone().lerp(prev, radius);
    const outgoing = point.clone().lerp(next, radius);
    points.push(incoming.toArray());
    points.push(incoming.clone().multiplyScalar(.25).addScaledVector(point, .5).addScaledVector(outgoing, .25).toArray());
    points.push(outgoing.toArray());
  }
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  return area < 0 ? points.reverse() : points;
}

function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}

function antlerSurface() {
  const outline = roundedContour(ANTLER_OUTLINE);
  const contour = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .022));
    for (let j = 0; j < count; j++) contour.push(a.map((v, k) => lerp(v, b[k], j / count)));
  }
  const points = contour.map(p => [...p]);
  const boundary = new Set(points.map((_p, i) => i));
  let triangles = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(p[0], p[1])), []);
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const ccw = (a, b, c) => orient(points[a], points[b], points[c]) > 0 ? [a, b, c] : [c, b, a];
  triangles = triangles.map(([a, b, c]) => ccw(a, b, c));

  // Insert a triangular grid into the constrained Earcut mesh. Subdividing its
  // long thin ears alone preserves the poor aspect ratios that caused folds.
  for (let row = 0, y = 2.207; y < 2.91; row++, y += .0190525589) {
    for (let x = .14 + (row % 2) * .011; x < 1.21; x += .022) {
      let inside = false, edge = Infinity;
      for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
        const a = contour[i], b = contour[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        edge = Math.min(edge, segmentDistance(x, y, a, b));
      }
      if (!inside || edge < .0055) continue;
      const point = [x, y, 0];
      const face = triangles.findIndex(([a, b, c]) => orient(points[a], points[b], point) > 1e-10
        && orient(points[b], points[c], point) > 1e-10 && orient(points[c], points[a], point) > 1e-10);
      if (face < 0) continue;
      const [a, b, c] = triangles[face], n = points.length;
      points.push(point); triangles[face] = [a, b, n]; triangles.push([b, c, n], [c, a, n]);
    }
  }

  // Lawson flips preserve the perimeter and improve the interior triangulation.
  const inCircle = (a, b, c, d) => {
    const ax = a[0] - d[0], ay = a[1] - d[1], bx = b[0] - d[0], by = b[1] - d[1], cx = c[0] - d[0], cy = c[1] - d[1];
    return (ax * ax + ay * ay) * (bx * cy - by * cx) - (bx * bx + by * by) * (ax * cy - ay * cx)
      + (cx * cx + cy * cy) * (ax * by - ay * bx);
  };
  for (let pass = 0; pass < 70; pass++) {
    const edges = new Map(), changed = new Set();
    let flips = 0;
    triangles.forEach((face, f) => {
      for (let i = 0; i < 3; i++) {
        const a = face[i], b = face[(i + 1) % 3], c = face[(i + 2) % 3];
        const key = [a, b].sort((x, y) => x - y).join(',');
        const previous = edges.get(key);
        if (!previous) { edges.set(key, { a, b, c, f }); continue; }
        if (changed.has(f) || changed.has(previous.f)) continue;
        const d = previous.c;
        if (orient(points[c], points[d], points[a]) * orient(points[c], points[d], points[b]) >= -1e-14) continue;
        if (inCircle(points[a], points[b], points[c], points[d]) <= 1e-12) continue;
        triangles[f] = ccw(c, d, a); triangles[previous.f] = ccw(d, c, b);
        changed.add(f); changed.add(previous.f); flips++;
      }
    });
    if (!flips) break;
  }
  // Tiny terminal ears still need an interior point to give their rounded shell
  // thickness. Every front/back rim vertex is shared by both surfaces.
  triangles = triangles.flatMap(([a, b, c]) => {
    if (![a, b, c].every(i => boundary.has(i))) return [[a, b, c]];
    const n = points.length;
    points.push(points[a].map((v, k) => (v + points[b][k] + points[c][k]) / 3));
    return [[a, b, n], [b, c, n], [c, a, n]];
  });
  // An interior diagonal can join two perimeter vertices in a narrow tine.
  // Split these diagonals so the front and back never share an internal edge.
  const edgeUses = new Map();
  for (const triangle of triangles) for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3];
    const key = [a, b].sort((x, y) => x - y).join(',');
    edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
  }
  const mids = new Map();
  for (const [key, count] of edgeUses) {
    const [a, b] = key.split(',').map(Number);
    if (count !== 2 || !boundary.has(a) || !boundary.has(b)) continue;
    mids.set(key, points.length); points.push(points[a].map((v, k) => (v + points[b][k]) * .5));
  }
  const midpoint = (a, b) => mids.get([a, b].sort((x, y) => x - y).join(','));
  triangles = triangles.flatMap(([a, b, c]) => {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    const count = Number(ab !== undefined) + Number(bc !== undefined) + Number(ca !== undefined);
    if (!count) return [[a, b, c]];
    if (count === 3) return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    if (count === 1) {
      if (ab !== undefined) return [[a, ab, c], [ab, b, c]];
      if (bc !== undefined) return [[b, bc, a], [bc, c, a]];
      return [[c, ca, b], [ca, a, b]];
    }
    if (ab !== undefined && bc !== undefined) return [[b, bc, ab], [a, ab, c], [ab, bc, c]];
    if (bc !== undefined && ca !== undefined) return [[c, ca, bc], [b, bc, a], [bc, ca, a]];
    return [[a, ab, ca], [c, ca, b], [ca, ab, b]];
  });
  return { points, triangles, boundary, contour };
}

const ANTLER_VEINS = [
  [[.25, 2.28], [.43, 2.35], [.55, 2.37]],
  [[.28, 2.29], [.53, 2.43], [.86, 2.49], [1.06, 2.59], [1.19, 2.72]],
  [[.39, 2.37], [.65, 2.47], [.91, 2.59], [1.04, 2.86]],
  [[.40, 2.39], [.63, 2.50], [.82, 2.63], [.90, 2.89]],
  [[.38, 2.38], [.55, 2.47], [.67, 2.62], [.71, 2.85]],
  [[.34, 2.36], [.45, 2.46], [.55, 2.61], [.53, 2.73]],
];

/** A cupped palm and its branching tines share one watertight surface per side. */
export function mooseAntlers(s, _p) {
  const { points, triangles, boundary, contour } = antlerSurface();
  const browDensity = (x, y) => Math.exp(-(((x - .535) / .15) ** 2) - ((y - 2.339) / .115) ** 2);
  const centerDepth = (x, y) => 1.095 - .375 * (x - .14) - .110 * (y - 2.20) + .30 * browDensity(x, y)
    + .044 * Math.sin(clamp((x - .29) / .95, 0, 1) * Math.PI) * Math.sin(clamp((y - 2.32) / .58, 0, 1) * Math.PI);
  for (const side of [-1, 1]) {
    const positions = [], uv = [], colors = [], front = [], back = [];
    points.forEach((point, i) => {
      const [x, y] = point;
      let edge = Infinity, vein = Infinity;
      for (let j = 0; j < contour.length; j++) edge = Math.min(edge, segmentDistance(x, y, contour[j], contour[(j + 1) % contour.length]));
      for (const line of ANTLER_VEINS) for (let j = 1; j < line.length; j++) vein = Math.min(vein, segmentDistance(x, y, line[j - 1], line[j]));
      const groove = Math.exp(-((vein / .008) ** 2));
      const rim = smooth(0, .020, edge);
      const grain = Math.sin(x * 105 + y * 31 + Math.sin(y * 16) * .55);
      const thickness = boundary.has(i) ? 0 : Math.min(lerp(.045, .014, browDensity(x, y)), Math.sqrt(edge * .033)
        * (1 + .15 * (1 - smooth(.26, .49, x))) + rim * (.0005 * grain - .0012 * groove));
      // Analytic depth preserves a smooth palm independently of mesh topology.
      // The low brow branch curls forward while the main palm sweeps backward.
      const z = centerDepth(x, y), epsilon = .0005;
      const normal = new THREE.Vector3(-(centerDepth(x + epsilon, y) - centerDepth(x - epsilon, y)) / (epsilon * 2),
        -(centerDepth(x, y + epsilon) - centerDepth(x, y - epsilon)) / (epsilon * 2), 1).normalize();
      const tint = new THREE.Color(0x9c8059).lerp(new THREE.Color(0xd6c199), smooth(2.36, 2.90, y) * .79)
        .multiplyScalar(1 - groove * .10 + grain * .013);
      front[i] = positions.length;
      positions.push([side * (x + normal.x * thickness), y + normal.y * thickness, z + normal.z * thickness]);
      uv.push((x - .13) / 1.09, (y - 2.19) / .72); colors.push(tint);
      if (boundary.has(i)) back[i] = front[i];
      else {
        back[i] = positions.length;
        positions.push([side * (x - normal.x * thickness), y - normal.y * thickness, z - normal.z * thickness]);
        uv.push((x - .13) / 1.09, (y - 2.19) / .72); colors.push(tint.clone().multiplyScalar(.94));
      }
    });
    const indices = [];
    for (const [a, b, c] of triangles) {
      if (side > 0) indices.push(front[a], front[b], front[c], back[c], back[b], back[a]);
      else indices.push(front[c], front[b], front[a], back[a], back[b], back[c]);
    }
    s.add(positions, indices, 'Head', (_point, index) => colors[index], 2, undefined, uv);
  }
}
