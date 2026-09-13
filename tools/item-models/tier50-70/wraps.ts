import * as THREE from 'three';
import type { ArmorTheme, ArmorMaterials, Surface } from './contracts.js';
import { addScaleField } from './scale-field.js';
import profile from '../core/body-profile.json' with { type: 'json' };
import { createWrapHandShell } from '../starhide/wrap-hand-source.js';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const lerp = THREE.MathUtils.lerp;
type Path = (t: number) => readonly [number, number];

function normal(f: Surface, u: number, v: number) {
  return f(u + .0001, v).sub(f(u - .0001, v)).cross(f(u, v + .0001).sub(f(u, v - .0001))).normalize();
}

function mesh(g: THREE.Group, name: string, geo: THREE.BufferGeometry, material: THREE.Material, bone?: string) {
  const m = new THREE.Mesh(geo, material); m.name = name;
  if (bone) m.userData.itemModelBone = bone;
  m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}

function patch(g: THREE.Group, name: string, f: Surface, material: THREE.Material, bone?: string, nu = 32, nv = 20, inward = false) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const q = f(i / nu, j / nv); p.push(q.x, q.y, q.z); uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (inward) ix.push(a, c, b, b, c, d); else ix.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  return mesh(g, name, geo, material, bone);
}

/** Forearm rings measured from the production male, with clearance for between-ring skin curvature. */
function armPoint(x: number, angle: number, offset = .0050) {
  const rows = profile.leftArm;
  let hi = rows.findIndex(row => row.level >= x); if (hi < 0) hi = rows.length - 1;
  const lo = Math.max(0, hi - 1), a = rows[lo]!, b = rows[hi]!;
  const t = hi === lo ? 0 : THREE.MathUtils.clamp((x - a.level) / (b.level - a.level), 0, 1);
  const u = ((angle / TAU) % 1 + 1) % 1 * a.outline.length, i = Math.floor(u), f = u - i;
  const ap = a.outline[i]!, aq = a.outline[(i + 1) % a.outline.length]!;
  const bp = b.outline[i]!, bq = b.outline[(i + 1) % b.outline.length]!;
  const cy = lerp(a.center[0]!, b.center[0]!, t), cz = lerp(a.center[1]!, b.center[1]!, t);
  const y = lerp(lerp(ap[0]!, aq[0]!, f), lerp(bp[0]!, bq[0]!, f), t);
  const z = lerp(lerp(ap[1]!, aq[1]!, f), lerp(bp[1]!, bq[1]!, f), t);
  return V(x, y, z).addScaledVector(V(0, y - cy, z - cz).normalize(), offset);
}

/** A five-section bevel. Every rail is resampled on the fitted surface, including wide corners. */
function band(g: THREE.Group, name: string, f: Surface, path: Path, width: number | ((t: number) => number),
  material: THREE.Material, bone?: string, lift = .0013, steps = 72) {
  const p: number[] = [], uv: number[] = [], ix: number[] = [];
  const sections = [-1, -.72, 0, .72, 1];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, [u, v] = path(t), [ua, va] = path(Math.max(0, t - .0001)), [ub, vb] = path(Math.min(1, t + .0001));
    const du = f(u + .0001, v).sub(f(u - .0001, v)).multiplyScalar(5000);
    const dv = f(u, v + .0001).sub(f(u, v - .0001)).multiplyScalar(5000);
    const n = du.clone().cross(dv).normalize();
    const tangent = du.clone().multiplyScalar(ub - ua).addScaledVector(dv, vb - va).normalize();
    const across = tangent.clone().cross(n).normalize();
    const aa = du.dot(du), ab = du.dot(dv), bb = dv.dot(dv), det = aa * bb - ab * ab;
    const au = det > 1e-12 ? (across.dot(du) * bb - across.dot(dv) * ab) / det : 0;
    const av = det > 1e-12 ? (across.dot(dv) * aa - across.dot(du) * ab) / det : 0;
    const w = typeof width === 'number' ? width : width(t);
    for (const s of sections) {
      const su = u + au * s * w * .5, sv = v + av * s * w * .5;
      const q = f(su, sv).addScaledVector(normal(f, su, sv), lift + (Math.abs(s) === 1 ? 0 : .00065));
      p.push(q.x, q.y, q.z); uv.push((s + 1) / 2, t * 4);
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < 4; j++) {
    const a = i * 5 + j, b = a + 1, c = a + 5, d = c + 1; ix.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(ix); geo.computeVertexNormals();
  return mesh(g, name, geo, material, bone);
}

function engravedBand(g: THREE.Group, name: string, f: Surface, path: Path, width: number | ((t: number) => number),
  m: ArmorMaterials, bone?: string, steps = 72) {
  band(g, name + ' beveled metal binding', f, path, width, m.metal, bone, .0015, steps);
  band(g, name + ' recessed engraved centerline', f, path, .00042, m.lining, bone, .00218, steps);
}

function motif(g: THREE.Group, name: string, f: Surface, center: readonly [number, number], size: readonly [number, number],
  m: ArmorMaterials, pointed: boolean, bone?: string) {
  const [u, v] = center, [w, h] = size;
  const corners = pointed ? [[0,-1],[.22,-.22],[1,0],[.22,.22],[0,1],[-.22,.22],[-1,0],[-.22,-.22]] : [[0,-1],[1,0],[0,1],[-1,0]];
  const path: Path = t => {
    const k = (t % 1) * corners.length, i = Math.floor(k), a = corners[i]!, b = corners[(i + 1) % corners.length]!;
    return [u + lerp(a[0]!, b[0]!, k - i) * w, v + lerp(a[1]!, b[1]!, k - i) * h];
  };
  engravedBand(g, name, f, path, pointed ? .0022 : .0031, m, bone, corners.length * 8);
}

function bracer(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials, suffix: string) {
  const dragon = theme === 'dragonhide', bone = `lowerarm_${suffix}`, label = `${theme} ${suffix}`;
  const start = (a: number) => .553 - (dragon ? .063 : .075) * Math.pow(Math.max(0, Math.cos(a)), dragon ? 10 : 7)
    - .016 * Math.pow(Math.max(0, -Math.cos(a)), 4);
  const cuff: Surface = (u, v) => armPoint(lerp(start(u * TAU), .711, v), u * TAU);
  const lining: Surface = (u, v) => armPoint(lerp(start(u * TAU), .711, v), u * TAU, .0033);
  patch(g, label + ' close fitted leather bracer', cuff, m.cloth, bone, 64, 20);
  patch(g, label + ' open cuff lining', lining, m.lining, bone, 64, 16, true);
  for (const end of [0, 1]) {
    patch(g, label + ' cuff bound thickness ' + end, (u, v) => cuff(u, end).lerp(lining(u, end), v), m.cloth, bone, 64, 1, end === 0);
    engravedBand(g, label + ' curved cuff rim ' + end, cuff, t => [t, end], dragon ? .0045 : .0037, m, bone, 80);
    band(g, label + ' cuff stitching ' + end, cuff, t => [t, end ? .969 : .028], .0005, m.thread, bone, .0008, 80);
  }
  const x0 = dragon ? .487 : .478, x1 = .715;
  const halfWidth = (v: number) => .08 + (dragon ? .99 : .94) * Math.pow(Math.max(0, Math.sin(Math.PI * v)), dragon ? .62 : .48);
  const inset: Surface = (u, v) => armPoint(lerp(x0, x1, v), (u - .5) * 2 * halfWidth(v), .0071);
  // The pointed inset has a steep UV shear at its tips. Build metal rails on a
  // regular forearm sheet so their width cannot jump around the circumference.
  const frameSurface: Surface = (u, v) => armPoint(lerp(x0, x1, v), (u - .5) * TAU, .0071);
  const framePath = (path: Path): Path => t => {
    const [u, v] = path(t); return [.5 + (u - .5) * 2 * halfWidth(v) / TAU, v];
  };
  patch(g, label + ' recessed dorsal scale foundation', inset, m.lining, bone, 28, 36);
  addScaleField(g, label + ' raised overlapping dorsal scales', inset, m, { columns: dragon ? 5 : 4, rows: dragon ? 12 : 10, reverse: true, bone, lift: .0007, seed: dragon ? 271 : 773 });
  for (const edge of [0, 1]) engravedBand(g, label + ' swept scale frame ' + edge, frameSurface, framePath(t => [edge, t]),
    t => (dragon ? .0083 : .0068) * (.55 + .45 * Math.pow(Math.sin(Math.PI * t), .4)), m, bone, 96);
  // Thorned crown loops on dragonhide; longer, finer open silver spears on starhide.
  for (const side of [-1, 1]) {
    const crown: Path = t => [.5 + side * (.43 * t), .018 + (dragon ? .19 : .14) * Math.sin(t * Math.PI * .64)];
    engravedBand(g, label + ' crown sweep ' + side, frameSurface, framePath(crown), t => .002 + (dragon ? .0062 : .0044) * Math.pow(Math.sin(Math.PI * t), .6), m, bone, 56);
    const flank: Surface = (u, v) => armPoint(lerp(.555 + .018 * Math.sin(u * Math.PI), .692 - .016 * Math.sin(u * Math.PI), v), side * (1.00 + u * 1.10), .0069);
    // Both parameterizations must have du cross dv facing out for real scale geometry.
    const outward: Surface = side === 1 ? flank : (u, v) => flank(1 - u, v);
    patch(g, label + ' side scale foundation ' + side, outward, m.lining, bone, 14, 18);
    addScaleField(g, label + ' raised side scales ' + side, outward, m, { columns: 3, rows: dragon ? 8 : 7, reverse: true, bone, lift: .0007, seed: 34 + side });
    engravedBand(g, label + ' side inset edge ' + side, outward, t => [side === 1 ? 1 : 0, t], dragon ? .0042 : .0034, m, bone, 48);
  }
  const top = (u: number) => .74 + .060 * (1 - Math.pow(Math.abs(u - .5) * 2, .78));
  const bottom = (u: number) => .815 + .135 * (1 - Math.pow(Math.abs(u - .5) * 2, .78));
  const chevron: Surface = (u, v) => {
    const pv = lerp(top(u), bottom(u), v); return inset(u, pv).addScaledVector(normal(inset, u, pv), .0018);
  };
  patch(g, label + ' pointed leather wrist scroll', chevron, m.cloth, bone, 36, 10);
  const wristFrame: Surface = (u,v) => frameSurface(u,v).addScaledVector(normal(frameSurface,u,v),.0018);
  for (const edge of [0, 1]) engravedBand(g, label + ' wrist scroll ' + edge, wristFrame,
    framePath(t => [t, edge ? bottom(t) : top(t)]), dragon ? .0068 : .0061, m, bone, 72);
  motif(g, label + ' wrist seal', wristFrame, [.5, lerp(top(.5),bottom(.5),.48)], [.028, .035], m, !dragon, bone);
}

const digits = [
  { name: 'index', points: [[.8238899,1.44834049,-.02475669],[.85647522,1.44709392,-.02521842],[.88436293,1.44602706,-.02564335],[.90845244,1.44510558,-.02601935]], radius: .011 },
  { name: 'middle', points: [[.82192611,1.45081742,-.05028665],[.85941408,1.44938335,-.05118248],[.88950283,1.44823245,-.05177781],[.9199924,1.44706591,-.05246776]], radius: .0103 },
  { name: 'ring', points: [[.81588793,1.45074816,-.0777702],[.85186238,1.44937197,-.0775863],[.88014049,1.44829033,-.07730592],[.90922073,1.44717785,-.07721474]], radius: .0096 },
  { name: 'pinky', points: [[.80502874,1.44946224,-.10001741],[.83662164,1.448254,-.10099256],[.8640166,1.44720585,-.10192415],[.88551245,1.44638346,-.10263508]], radius: .0085 },
  { name: 'thumb', points: [[.74030088,1.42801864,-.0243369],[.77140741,1.40881526,-.00932224],[.79934265,1.39156973,.00416175],[.8265436,1.37477728,.01729126]], radius: .0116 },
] as const;

/** Sample native shell once onto a compact patch. Jewelry follows the actual finger dorsum. */
function fittedPatch(shell: THREE.Mesh, approximate: Surface, direction: THREE.Vector3): Surface {
  const resolution = 36, samples: THREE.Vector3[] = [], ray = new THREE.Raycaster();
  for (let j = 0; j <= resolution; j++) for (let i = 0; i <= resolution; i++) {
    const q = approximate(i / resolution, j / resolution);
    ray.set(q.clone().addScaledVector(direction, .05), direction.clone().negate());
    const hits = ray.intersectObject(shell, false);
    const hit = hits.find(h => h.point.distanceTo(q) < .04);
    samples.push(hit ? hit.point.clone().addScaledVector(direction, .0008) : q);
  }
  return (u, v) => {
    const x = THREE.MathUtils.clamp(u, 0, 1) * resolution, y = THREE.MathUtils.clamp(v, 0, 1) * resolution;
    const i = Math.min(resolution - 1, Math.floor(x)), j = Math.min(resolution - 1, Math.floor(y));
    const at = (a: number, b: number) => samples[b * (resolution + 1) + a]!.clone();
    const p = at(i, j).lerp(at(i + 1, j), x - i).lerp(at(i, j + 1).lerp(at(i + 1, j + 1), x - i), y - j);
    // Borders evaluate beyond the patch to preserve tangent directions and a smooth bevel.
    if (u < 0 || u > 1 || v < 0 || v > 1) p.add(approximate(u, v).sub(approximate(THREE.MathUtils.clamp(u,0,1), THREE.MathUtils.clamp(v,0,1))));
    return p;
  };
}

function hand(g: THREE.Group, theme: ArmorTheme, m: ArmorMaterials, suffix: string) {
  const dragon = theme === 'dragonhide', label = `${theme} ${suffix}`, local = new THREE.Group();
  const shell = createWrapHandShell(1, m.cloth); shell.name = label + ' native full finger glove'; local.add(shell);
  const palmApprox: Surface = (u, v) => {
    const width = (dragon ? .034 : .006 + .025 * Math.pow(Math.max(0, Math.sin(Math.PI * v)), .65));
    return V(lerp(.704, dragon ? .806 : .803, v), 1.48 - v * .009, -.061 + (u - .5) * width * 2);
  };
  const palm = fittedPatch(shell, palmApprox, V(0,1,0));
  if (!dragon) {
    patch(local, label + ' pointed hand scale foundation', palm, m.lining, undefined, 20, 26);
    addScaleField(local, label + ' hand raised small scales', palm, m, { columns: 3, rows: 6, reverse: true, deform: 'native-hand', lift: .0007, seed: 77 });
    for (const edge of [0, 1]) engravedBand(local, label + ' hand pointed silver frame ' + edge, palm, t => [edge,t], .0038, m, undefined, 52);
  } else {
    // The burgundy hand remains exposed, with a stitched V and one gold diamond.
    engravedBand(local, label + ' knuckle V gold binding', palm, t => [t, .57 + .36 * (1 - Math.abs(t-.5)*2)], .0024, m, undefined, 56);
    motif(local, label + ' gold hand diamond', palm, [.5,.31], [.13,.105], m, false);
  }
  for (const digit of digits) {
    const pts = digit.points.map(p => V(p[0],p[1],p[2])), axis = pts[3]!.clone().sub(pts[0]!).normalize();
    const up = digit.name === 'thumb' ? V(.27,.78,.56) : V(0,1,0);
    const n = up.addScaledVector(axis,-up.dot(axis)).normalize(), across = axis.clone().cross(n).normalize();
    const begin = dragon ? pts[0]!.clone().lerp(pts[1]!, .08) : pts[2]!.clone().addScaledVector(axis,-.002);
    const end = pts[3]!.clone().addScaledVector(axis, digit.name === 'thumb' ? .001 : .003);
    const approximate: Surface = (u,v) => {
      const width = digit.radius * (dragon ? .87 : .84) * Math.pow(Math.max(.01,Math.sin(Math.PI*(v*.87+.055))),.48);
      return begin.clone().lerp(end,v).addScaledVector(across,(u-.5)*width*2).addScaledVector(n,digit.radius+.0025);
    };
    const cap = fittedPatch(shell, approximate, n);
    patch(local, label + ' ' + digit.name + ' fitted scale backing', cap, m.lining, undefined, 12, dragon ? 24 : 12);
    addScaleField(local, label + ' ' + digit.name + ' raised finger scales', cap, m, { columns: 2, rows: dragon ? 8 : 3, reverse: true, deform: 'native-hand', lift: .0005, seed: digit.name.length * 9 });
    for (const edge of [0,1]) engravedBand(local, label + ' ' + digit.name + ' scale perimeter ' + edge, cap, t => [edge,t], dragon ? .0019 : .00165, m, undefined, 40);
    engravedBand(local, label + ' ' + digit.name + ' pointed scale tip', cap, t => [t,1], .0016, m, undefined, 16);
    for (const v of dragon ? [.38,.73] : [0]) engravedBand(local, label + ' ' + digit.name + ' angular finger binding ' + v,
      cap, t => [t,v + .08*(1-Math.abs(t-.5)*2)], dragon ? .0034 : .0024, m, undefined, 24);
    if (!dragon) {
      const jointApprox: Surface = (u,v) => pts[digit.name === 'thumb' ? 1 : 0]!.clone().lerp(pts[digit.name === 'thumb' ? 2 : 1]!,v)
        .addScaledVector(across,(u-.5)*digit.radius*1.2).addScaledVector(n,digit.radius+.0025);
      const joint = fittedPatch(shell,jointApprox,n);
      motif(local,label+' '+digit.name+' silver knuckle star',joint,[.5,.4],[.30,digit.name==='index'||digit.name==='pinky'?.27:.20],m,true);
    }
  }
  local.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.userData.itemModelDeform = 'native-hand'; obj.userData.handSide = suffix === 'l' ? 'left' : 'right'; delete obj.userData.itemModelBone; } });
  g.add(local);
}

function mirror(g: THREE.Group) {
  g.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry = obj.geometry.clone(); const p = obj.geometry.getAttribute('position'), n = obj.geometry.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { p.setX(i,-p.getX(i)); if (n) n.setX(i,-n.getX(i)); }
    const ix = obj.geometry.getIndex();
    if (ix) for (let i = 0; i < ix.count; i += 3) { const b = ix.getX(i+1); ix.setX(i+1,ix.getX(i+2)); ix.setX(i+2,b); }
    obj.geometry.computeBoundingBox(); obj.geometry.computeBoundingSphere();
  });
}

export function buildWraps(theme: ArmorTheme, m: ArmorMaterials): THREE.Group {
  const g = new THREE.Group(); g.name = `${theme} fitted full finger gloves and pointed scale bracers`;
  for (const suffix of ['l','r']) {
    const side = new THREE.Group(); side.name = theme + ' ' + suffix + ' glove';
    bracer(side,theme,m,suffix); hand(side,theme,m,suffix); if (suffix === 'r') mirror(side); g.add(side);
  }
  return g;
}
