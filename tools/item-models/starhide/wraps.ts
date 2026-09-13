import * as THREE from 'three';
import type { StarhideMaterials } from './contracts.js';
import profile from '../core/body-profile.json' with { type: 'json' };
import { createWrapHandShell } from './wrap-hand-source.js';

type Surface = (u: number, v: number) => THREE.Vector3;
type Side = 1 | -1;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const lerp = THREE.MathUtils.lerp;

function mesh(g: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, bone?: string) {
  const result = new THREE.Mesh(geometry, material); result.name = name;
  if (bone) result.userData.itemModelBone = bone;
  g.add(result); return result;
}

/** All surface inputs follow the left hand; final mirroring reverses indices. */
function surface(g: THREE.Group, name: string, f: Surface, material: THREE.Material, side: Side, bone?: string,
  nu = 32, nv = 12, uvScale: readonly [number, number] = [1, 1], inward = false) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = f(i / nu, j / nv); positions.push(p.x * side, p.y, p.z); uvs.push(i / nu * uvScale[0], j / nv * uvScale[1]);
  }
  const reverse = (side === -1) !== inward;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (reverse) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
  return mesh(g, name, geo, material, bone);
}

/** Actual forearm cross sections keep the long cuff close to the anatomy. */
function armPoint(x: number, angle: number, offset = .0032) {
  const rows = profile.leftArm, last = rows.length - 1;
  let hi = rows.findIndex(row => row.level >= x); if (hi < 0) hi = last;
  const lo = Math.max(0, hi - 1), a = rows[lo]!, b = rows[hi]!;
  const t = hi === lo ? 0 : THREE.MathUtils.clamp((x - a.level) / (b.level - a.level), 0, 1);
  const u = ((angle / TAU) % 1 + 1) % 1 * a.outline.length, index = Math.floor(u), f = u - index;
  const ap = a.outline[index]!, aq = a.outline[(index + 1) % a.outline.length]!;
  const bp = b.outline[index]!, bq = b.outline[(index + 1) % b.outline.length]!;
  const cy = lerp(a.center[0]!, b.center[0]!, t), cz = lerp(a.center[1]!, b.center[1]!, t);
  const y = lerp(lerp(ap[0]!, aq[0]!, f), lerp(bp[0]!, bq[0]!, f), t);
  const z = lerp(lerp(ap[1]!, aq[1]!, f), lerp(bp[1]!, bq[1]!, f), t);
  const radial = V(0, y - cy, z - cz).normalize(); return V(x, y, z).addScaledVector(radial, offset);
}

function normalAt(f: Surface, u: number, v: number) {
  return f(Math.min(1,u + .0001), v).sub(f(Math.max(0,u - .0001), v)).cross(f(u, Math.min(1,v + .0001)).sub(f(u, Math.max(0,v - .0001)))).normalize();
}

/** A flattened, softly ridged metal ribbon instead of round heavy piping. */
function ribbon(g: THREE.Group, name: string, points: THREE.Vector3[], normals: THREE.Vector3[], width: number,
  material: THREE.Material, side: Side, bone: string, ridge = .00105) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const q = points[i]!, n = normals[i]!.clone().normalize();
    const tangent = points[Math.min(i + 1, points.length - 1)]!.clone().sub(points[Math.max(0, i - 1)]!).normalize();
    const cross = tangent.clone().cross(n).normalize();
    for (const s of [-1, 0, 1]) { const a = q.clone().addScaledVector(cross, s * width * .5).addScaledVector(n, s === 0 ? ridge : .00035); p.push(a.x * side, a.y, a.z); uv.push((s + 1) * .5, i / 5); }
  }
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < 2; j++) {
    const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
    if (side === 1) ix.push(a, b, c, b, d, c); else ix.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  return mesh(g, name, geo, material, bone);
}

function curvedRibbon(g: THREE.Group, name: string, f: Surface, path: (t: number) => readonly [number, number], width: number,
  material: THREE.Material, side: Side, bone: string, steps = 60, ridge = .00105) {
  const points: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) { const [u, v] = path(i / steps); points.push(f(u, v)); normals.push(normalAt(f, u, v)); }
  return ribbon(g, name, points, normals, width, material, side, bone, ridge);
}

/** Small four-point silver motifs with sharp tips and engraved dark inset ridges. */
function star(g: THREE.Group, name: string, center: THREE.Vector3, length: number, width: number, normal: THREE.Vector3,
  direction: THREE.Vector3, m: StarhideMaterials, side: Side, bone: string) {
  const n = normal.clone().normalize(), along = direction.clone().normalize(), across = n.clone().cross(along).normalize();
  const outline = [[-length / 2, 0], [-length * .14, width * .14], [0, width / 2], [length * .14, width * .14], [length / 2, 0], [length * .14, -width * .14], [0, -width / 2], [-length * .14, -width * .14]];
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  const middle = center.clone().addScaledVector(n, .0018); p.push(middle.x * side, middle.y, middle.z); uv.push(.5, .5);
  for (const [x, y] of outline) { const q = center.clone().addScaledVector(along, x!).addScaledVector(across, y!).addScaledVector(n, .00035); p.push(q.x * side, q.y, q.z); uv.push(x! / length + .5, y! / width + .5); }
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; if (side === 1) ix.push(0, j + 1, i + 1); else ix.push(0, i + 1, j + 1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals(); mesh(g, name, geo, m.silver, bone);
  // A narrow dark groove down one ray reads as engraved silver at close range.
  ribbon(g, name + ' fine engraved ray', [center.clone().addScaledVector(along, -length * .36).addScaledVector(n, .0012), center.clone().addScaledVector(n, .0019)], [n, n], .00035, m.lining, side, bone);
}

function bracer(g: THREE.Group, m: StarhideMaterials, side: Side) {
  const suffix = side === 1 ? 'l' : 'r', bone = `lowerarm_${suffix}`;
  const start = (angle: number) => .562 - .06 * Math.pow(Math.max(0, Math.cos(angle)), 8) - .018 * Math.pow(Math.max(0, -Math.cos(angle)), 4);
  const cuff: Surface = (u, v) => { const a = u * TAU; return armPoint(lerp(start(a), .711, v), a); };
  surface(g, 'Starhide ' + suffix + ' slim pointed indigo bracer shell', cuff, m.cloth, side, bone, 80, 24, [3.5, 2.5]);
  const inside: Surface = (u, v) => { const a = u * TAU; return armPoint(lerp(start(a), .711, v), a, .0014); };
  surface(g, 'Starhide ' + suffix + ' open cuff indigo lining', inside, m.lining, side, bone, 80, 20, [2, 2], true);
  for (const end of [0, 1]) {
    const lip: Surface = (u, v) => cuff(u, end).lerp(inside(u, end), v);
    surface(g, 'Starhide ' + suffix + ' thin open cuff bound edge ' + end, lip, m.cloth, side, bone, 80, 1);
    curvedRibbon(g, 'Starhide ' + suffix + ' silver cuff ribbon ' + end, cuff, t => [t, end], .0040, m.silver, side, bone, 96, .0008);
    curvedRibbon(g, 'Starhide ' + suffix + ' parallel cuff stitched welt ' + end, cuff, t => [t, end ? .97 : .025], .00075, m.thread, side, bone, 96);
  }
  // The front scale field narrows to a long tip toward the elbow and a second point at the wrist.
  const panelWidth = (v: number) => .095 + .94 * Math.pow(Math.max(0, Math.sin(Math.PI * v)), .48);
  const panel: Surface = (u, v) => {
    const a = (u - .5) * 2 * panelWidth(v); const x = lerp(.504, .724, v);
    return armPoint(x, a, .0049);
  };
  // Scale-map tips face decreasing V, so negative V points the leaves toward the fingers.
  surface(g, 'Starhide ' + suffix + ' dorsal iridescent overlapping scale inset', panel, m.scales, side, bone, 38, 44, [.625, -.75]);
  for (const edge of [0, 1]) curvedRibbon(g, 'Starhide ' + suffix + ' swept scale field silver frame ' + edge, panel, t => [edge, t], .0057, m.silver, side, bone, 84, .0008);
  // One conforming pointed cloth chevron joins the wrist scrolls. A wide planar ribbon
  // would cut into the curved scale field and leave isolated dark oval fragments.
  const chevronUpper = (u: number) => .754 + .068 * (1 - Math.pow(Math.abs(u - .5) * 2, .72));
  const chevronLower = (u: number) => .821 + .136 * (1 - Math.pow(Math.abs(u - .5) * 2, .72));
  const chevron: Surface = (u, v) => {
    const pv = lerp(chevronUpper(u), chevronLower(u), v);
    return panel(u, pv).addScaledVector(normalAt(panel,u,pv), .00065);
  };
  surface(g, 'Starhide ' + suffix + ' conforming pointed indigo wrist chevron', chevron, m.cloth, side, bone, 44, 12, [.45,.25]);
  for (const edge of [0,1]) curvedRibbon(g, 'Starhide ' + suffix + ' wrist chevron silver scroll edge ' + edge, chevron, t=>[t,edge], .0050, m.silver, side, bone, 88, .0008);
  // Narrow silver crown scrolls complete the reference's swept ribbon frame.
  for (const direction of [-1, 1]) {
    curvedRibbon(g, 'Starhide ' + suffix + ' crown scroll silver ribbon ' + direction, panel, t => [lerp(.5, direction < 0 ? .06 : .94, t), .07 + .13 * Math.sin(Math.PI * t * .58)], .0043, m.silver, side, bone, 60, .0008);
    // Secondary side panel wraps around the forearm, leaving a thin cloth seam behind.
    const sidePanel: Surface = (u, v) => {
      const a = direction * (1.02 + u * 1.24), x = lerp(.57 + .021 * Math.sin(u * Math.PI), .694 - .012 * Math.sin(u * Math.PI), v);
      return armPoint(x, a, .0047);
    };
    surface(g, 'Starhide ' + suffix + ' side scale inset ' + direction, sidePanel, m.scales, side, bone, 24, 20, [.45, -.60], direction < 0);
    // For the mirrored parameterization the true radial normal still points outward.
    const edgePoints = Array.from({ length: 55 }, (_, i) => sidePanel(1, i / 54));
    ribbon(g, 'Starhide ' + suffix + ' side inset silver seam ' + direction, edgePoints, edgePoints.map(p => V(0, p.y - 1.446, p.z + .075).normalize()), .0039, m.silver, side, bone, .0008);
  }
  const crown = panel(.5, .115), wrist = panel(.5, .84);
  star(g, 'Starhide ' + suffix + ' long crown star', crown.add(V(0,.0009,0)), .036, .018, V(0,1,0), V(1,0,0), m, side, bone);
  star(g, 'Starhide ' + suffix + ' wrist four point silver seal', wrist.add(V(0,.001,0)), .039, .020, V(0,1,0), V(1,0,0), m, side, bone);
}

const digitData = [
  { name: 'index', points: [[.8238899,1.44834049,-.02475669],[.85647522,1.44709392,-.02521842],[.88436293,1.44602706,-.02564335],[.90845244,1.44510558,-.02601935]], radius: .011 },
  { name: 'middle', points: [[.82192611,1.45081742,-.05028665],[.85941408,1.44938335,-.05118248],[.88950283,1.44823245,-.05177781],[.9199924,1.44706591,-.05246776]], radius: .0103 },
  { name: 'ring', points: [[.81588793,1.45074816,-.0777702],[.85186238,1.44937197,-.0775863],[.88014049,1.44829033,-.07730592],[.90922073,1.44717785,-.07721474]], radius: .0096 },
  { name: 'pinky', points: [[.80502874,1.44946224,-.10001741],[.83662164,1.448254,-.10099256],[.8640166,1.44720585,-.10192415],[.88551245,1.44638346,-.10263508]], radius: .0085 },
  { name: 'thumb', points: [[.74030088,1.42801864,-.0243369],[.77140741,1.40881526,-.00932224],[.79934265,1.39156973,.00416175],[.8265436,1.37477728,.01729126]], radius: .0116 },
] as const;

function handDetails(g: THREE.Group, m: StarhideMaterials, side: Side) {
  const suffix = side === 1 ? 'l' : 'r';
  // The hand is soft indigo cloth. Only a narrow pointed scale insert runs from wrist to mid-hand.
  const handPlate: Surface = (u, v) => {
    const width = .005 + .026 * Math.pow(Math.sin(Math.PI * v), .6), x = lerp(.701, .799, v), z = -.059 + (u - .5) * width * 2;
    return V(x, 1.4782 - v * .0066 - Math.pow((u - .5) * 2, 2) * .003, z);
  };
  surface(g, 'Starhide ' + suffix + ' pointed dorsal hand scale inset', handPlate, m.scales, side, `hand_${suffix}`, 20, 24, [.375, -.42]);
  for (const edge of [0, 1]) curvedRibbon(g, 'Starhide ' + suffix + ' hand inset narrow silver border ' + edge, handPlate, t => [edge, t], .0039, m.silver, side, `hand_${suffix}`, 60, .0008);
  for (const digit of digitData) {
    const pts = digit.points.map(p => V(p[0],p[1],p[2])), first = pts[0]!, lastStart = pts[2]!, end = pts[3]!;
    const axis = end.clone().sub(lastStart).normalize();
    const n = digit.name === 'thumb' ? V(.27,.78,.56).addScaledVector(axis,-V(.27,.78,.56).dot(axis)).normalize() : V(0,1,0).addScaledVector(axis, -axis.y).normalize();
    const cross = axis.clone().cross(n).normalize(), bone = `${digit.name}_03_${suffix}`;
    const start = lastStart.clone().addScaledVector(axis, -.0025), length = end.distanceTo(lastStart) + .0035;
    const cap: Surface = (u, v) => {
      const w = digit.radius * .86 * Math.pow(Math.sin(Math.PI * (v * .84 + .06)), .58);
      const z = (u - .5) * w * 2;
      const nativeDorsalLift = digit.name === 'middle' ? .0035 : digit.name === 'ring' ? .0028 : 0;
      return start.clone().addScaledVector(axis, length * v).addScaledVector(cross, z).addScaledVector(n, digit.radius * .85 + .0023 + nativeDorsalLift - z * z / (digit.radius * 2.5));
    };
    // This winding is cross then axis, so its normal points outward.
    surface(g, 'Starhide ' + suffix + ' ' + digit.name + ' fingertip scale panel', cap, m.scales, side, bone, 12, 14, [.25,-.33]);
    for (const edge of [0,1]) curvedRibbon(g, 'Starhide ' + suffix + ' ' + digit.name + ' scale tip silver outline ' + edge, cap, t => [edge,t], .00145, m.silver, side, bone, 28);
    curvedRibbon(g, 'Starhide ' + suffix + ' ' + digit.name + ' tip panel angled top silver border', cap, t => [t,0], .00145, m.silver, side, bone, 12);
    const knuckleLift = digit.name === 'middle' ? .0047 : digit.name === 'ring' ? .005 : 0;
    const knuckle = (digit.name === 'thumb' ? pts[1]!.clone().lerp(pts[2]!, .5) : first.clone().lerp(pts[1]!, .20)).addScaledVector(n, digit.radius + .0017 + knuckleLift);
    star(g, 'Starhide ' + suffix + ' ' + digit.name + ' four-point knuckle motif', knuckle, digit.name === 'index' || digit.name === 'pinky' ? .020 : .012, digit.radius * 1.05, n, axis, m, side, `${digit.name}_0${digit.name==='thumb'?2:1}_${suffix}`);
    // Fine twin stitching follows the dorsal finger seams; each section follows its own phalanx.
    for (let phalanx = 0; phalanx < 3; phalanx++) for (const edge of [-1,1]) {
      const a = pts[phalanx]!, b = pts[phalanx+1]!;
      const seam = Array.from({ length: 9 }, (_, i) => a.clone().lerp(b, i / 8).addScaledVector(n, digit.radius * .63 + .0017).addScaledVector(cross, digit.radius * .69 * edge));
      ribbon(g, 'Starhide ' + suffix + ' ' + digit.name + ' fine seam ' + phalanx + ' ' + edge, seam, seam.map(() => n), .00045, m.thread, side, `${digit.name}_0${phalanx+1}_${suffix}`);
    }
  }
}

export function buildWraps(m: StarhideMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = 'Starhide full-finger gloves and fitted pointed bracers';
  for (const side of [1,-1] as const) {
    g.add(createWrapHandShell(side, m.cloth)); bracer(g,m,side); handDetails(g,m,side);
  }
  return g;
}
