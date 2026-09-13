import * as THREE from 'three';
import { bodyProfile } from '../core/profile.js';
import type { ArmorMaterials, ArmorTheme } from './contracts.js';
import { addScaleField } from './scale-field.js';
import { TAU, V, lerp, smoothFit, shell, ribbon, border, diamond, mirror, mesh, type Surface } from './lower-shapes.js';

/** Remove complete sewn plates where a later garment layer covers their footprint. */
function trimCoveredScutes(group: THREE.Group, firstChild: number, field: Surface,
  covered: (u: number, v: number, raisedY: number) => boolean, name: string) {
  // Scale UVs encode the field's two 24-sample centreline lengths. Recover the
  // footprint without changing any surviving positions, normals or texture UVs.
  const length = (across: boolean) => {
    let prior = field(across ? 0 : .5, across ? .5 : 0), total = 0;
    for (let i = 1; i <= 24; i++) {
      const point = field(across ? i / 24 : .5, across ? .5 : i / 24);
      total += point.distanceTo(prior); prior = point;
    }
    return total;
  };
  const uvWidth = length(true) * 4, uvHeight = length(false) * 4;
  type Plate = { covered: boolean; faceArea: number; };
  const plates = new Map<string, Plate>();
  const batches: { mesh: THREE.Mesh; edges: boolean; spans: { start: number; count: number; key: string; }[]; }[] = [];
  for (const node of group.children.slice(firstChild)) {
    if (!(node instanceof THREE.Mesh)) continue;
    const geometry = node.geometry, indices = geometry.getIndex()!, position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    const edges = node.name.endsWith('dark cut-hide scute bevels'), spans: typeof batches[number]['spans'] = [];
    // Each face is a centre fan. The matching lining batch stores its centre
    // fan followed by two closed-wall triangles per edge. Both share centre UVs.
    for (let start = 0; start < indices.count;) {
      const center = indices.getX(start);
      let corners = 0;
      while (start + corners * 3 < indices.count && indices.getX(start + corners * 3) === center) corners++;
      const count = corners * (edges ? 9 : 3);
      if (corners < 3 || start + count > indices.count) throw new Error(`${name}: unexpected scute fan layout`);
      const key = `${uv.getX(center)},${uv.getY(center)}`;
      const plate = plates.get(key) ?? { covered: false, faceArea: 0 };
      for (let offset = start; offset < start + corners * 3; offset += 3) {
        const a = V(0, 0, 0).fromBufferAttribute(position, indices.getX(offset));
        const b = V(0, 0, 0).fromBufferAttribute(position, indices.getX(offset + 1));
        const c = V(0, 0, 0).fromBufferAttribute(position, indices.getX(offset + 2));
        if (!edges) plate.faceArea += b.sub(a).cross(c.sub(a)).length() * .5;
        for (let corner = 0; corner < 3; corner++) {
          const vertex = indices.getX(offset + corner);
          plate.covered ||= covered(uv.getX(vertex) / uvWidth, uv.getY(vertex) / uvHeight, position.getY(vertex));
        }
      }
      plates.set(key, plate); spans.push({ start, count, key }); start += count;
    }
    batches.push({ mesh: node, edges, spans });
  }
  for (const { mesh: node, edges, spans } of batches) {
    const geometry = node.geometry, oldIndices = geometry.getIndex()!, retained = spans.filter(span => !plates.get(span.key)!.covered);
    if (!retained.length) { group.remove(node); geometry.dispose(); continue; }
    if (retained.length === spans.length) continue;
    const replacement = new THREE.BufferGeometry(), remap = new Map<number, number>(), vertices: number[] = [], indices: number[] = [];
    for (const span of retained) for (let i = span.start; i < span.start + span.count; i++) {
      const old = oldIndices.getX(i);
      if (!remap.has(old)) { remap.set(old, vertices.length); vertices.push(old); }
      indices.push(remap.get(old)!);
    }
    for (const [attributeName, attribute] of Object.entries(geometry.attributes)) {
      if (!(attribute instanceof THREE.BufferAttribute) || !(attribute.array instanceof Float32Array)) throw new Error(`${name}: unexpected scute attribute`);
      const values: number[] = [];
      for (const old of vertices) for (let component = 0; component < attribute.itemSize; component++) values.push(attribute.array[old * attribute.itemSize + component]!);
      replacement.setAttribute(attributeName, new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized));
    }
    replacement.setIndex(indices); replacement.computeBoundingBox(); replacement.computeBoundingSphere();
    node.geometry = replacement; geometry.dispose();
    node.userData.scaleField = { ...node.userData.scaleField, ...(!edges ? { plates: retained.length } : {}),
      triangles: indices.length / 3, coveredPlatesRemoved: spans.length - retained.length };
  }
  const all = [...plates.values()], visible = all.filter(plate => !plate.covered);
  return { name, platesBefore: all.length, platesAfter: visible.length, removed: all.length - visible.length,
    faceAreaBefore: all.reduce((sum, plate) => sum + plate.faceArea, 0), faceAreaAfter: visible.reduce((sum, plate) => sum + plate.faceArea, 0),
    units: 'square metres; actual raised face triangles', verticalGuard: .005, angularGuard: .020 };
}

/** Tailored gathered trousers and independent, overlapping scale-lined hip guards. */
export function buildLeggings(theme: ArmorTheme, m: ArmorMaterials): THREE.Group {
  const dragon = theme === 'dragonhide';
  const g = new THREE.Group();
  g.name = `${theme} gathered trousers and swept layered hip guards`;
  const metalWidth = dragon ? .0060 : .0052;
  const gauss = (x: number, c: number, s: number) => Math.exp(-Math.pow((x - c) / s, 2));
  const occlusion: ReturnType<typeof trimCoveredScutes>[] = [];

  const seat: Surface = (u, v) => {
    const y = lerp(.924, 1.055, v), a = u * TAU;
    return smoothFit(bodyProfile.torso, y, a, .0045 + .0004 * Math.sin(9 * a) * Math.pow(1 - v, 2));
  };
  shell(g, 'Smooth fitted waist and fully closed seat', seat, m.cloth, m.lining, 64, 8, .0030);
  ribbon(g, 'Waist inner turned hem', seat, t => [t, .986], m.thread, .00075);

  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    const legPoint = (a: number, y: number, lift = 0) => {
      // Cloth ease changes smoothly along the native leg. Diagonal folds gather at
      // the knee and ankle instead of turning the whole leg into a corrugated tube.
      const thighEase = .017 * gauss(y, .757, .125);
      const calfEase = .007 * gauss(y, .292, .135);
      const outer = .40 + .60 * Math.pow(Math.sin(a * .5 + .45), 2);
      const kneeGather = .0054 * Math.sin(y * 112 + 2.6 * Math.sin(a) + .7 * Math.sin(a * 3)) * gauss(y, .650, .064);
      const ankleGather = .0044 * Math.sin(y * 123 - 2.8 * Math.sin(a + .8)) * gauss(y, .185, .065);
      const thighDrape = .0030 * Math.sin(a * 7 + y * 9) * gauss(y, .790, .130);
      const kneeBack = .0034 * Math.sin(y * 91 + a * 2.0) * gauss(y, .500, .077) * Math.pow(Math.sin(a * .5), 4);
      const ease = Math.max(.007, .010 + thighEase + calfEase + outer * (kneeGather + ankleGather) + thighDrape + kneeBack);
      // Cloth under the hip armor is fitted closely; the visible folds resume
      // below its hem. Keep the shell at least four millimetres off the scan.
      const hipTuck = THREE.MathUtils.smoothstep(y, .675, .780);
      const fittedEase = lerp(ease, .0045 + .00035 * Math.sin(a * 6 + y * 10), hipTuck);
      const p = smoothFit(bodyProfile.leftLeg, y, a, fittedEase + lift);
      if (y > .846 && p.x < .0045) p.x = .0045;
      return p;
    };
    const trousers: Surface = (u, v) => legPoint(u * TAU, lerp(.112, .961, v));
    shell(leg, 'Tailored cloth leg with gathered knee ankle and hanging thigh folds', trousers, m.cloth, m.lining, 48, 68, .0027);
    ribbon(leg, 'Outer continuous double sewn trouser seam', trousers, t => [.247, t], m.thread, .00075, 96, .0008);
    ribbon(leg, 'Outer parallel trouser seam stitch', trousers, t => [.254, t], m.thread, .00048, 96, .0008);
    ribbon(leg, 'Inner trouser inseam', trousers, t => [.745, t], m.thread, .00050, 88, .0008);
    const cuff: Surface = (u, v) => legPoint(u * TAU, lerp(.112, .132, v), .0012);
    shell(leg, 'Turned ankle cuff', cuff, m.cloth, m.lining, 64, 3, .0013);
    ribbon(leg, 'Cuff lower bound edge', cuff, t => [t, .04], m.metal, .0022);
    ribbon(leg, 'Cuff upper sewn edge', cuff, t => [t, .90], m.thread, .0007);

    const knee: Surface = (u, v) => {
      let half = .91 * (.025 + .975 * Math.pow(Math.sin(v * Math.PI * .825), .77));
      if (dragon) half *= 1 - .095 * gauss(v, .54, .055);
      const a = (u * 2 - 1) * half;
      const crest = .025 * Math.pow(v, 8) * (dragon ? Math.max(0, 1 - Math.abs(u - .52) * 2.4) : Math.pow(Math.sin(u * Math.PI), 1.8));
      return legPoint(a, lerp(.466, .621, v) + crest, .0046);
    };
    shell(leg, dragon ? 'Angular gold framed knee shield backing' : 'Curved silver kite knee shield backing', knee, m.scales, m.lining, 24, 20, .0020);
    const kneeScales: Surface = (u, v) => knee(lerp(.046, .954, u), lerp(.056, .953, v));
    addScaleField(leg, 'Knee overlapping individual scale plates', kneeScales, m, { columns: 7, rows: 8, lift: .0015, seed: 211 });
    border(leg, 'Knee sculpted beveled frame', knee, m.metal, metalWidth);
    for (const s of [.06, .94]) ribbon(leg, 'Knee frame inset engraved edge', knee, t => [s, lerp(.13, .96, t)], m.thread, .0007, 54, .0018);
    diamond(leg, 'Knee lower long spear finial', knee, .5, .125, .19, .12, m.metal, .0040);
    diamond(leg, 'Knee upper small chased finial', knee, .5, .89, .085, .086, m.metal, .0031);
    if (!dragon) for (const s of [-1, 1]) {
      ribbon(leg, 'Knee silver curved fork below crest', knee, t => [.5 + s * .27 * Math.sin(t * Math.PI * .67), .98 - .20 * t], m.metal, .0027, 24, .0021);
    }

    const shin: Surface = (u, v) => {
      const y = lerp(.134, .481, v);
      const half = .42 + .13 * v - .095 * Math.sin(v * Math.PI);
      return legPoint((u * 2 - 1) * half + .10 * Math.sin(v * Math.PI * 1.7), y, .0015);
    };
    if (!dragon) {
      shell(leg, 'Tapered cloth shin applique between silver sweep seams', shin, m.cloth, m.lining, 18, 26, .0011);
      for (const s of [.024, .976]) ribbon(leg, 'Long curved silver shin applique binding', shin, t => [s, t], m.metal, .0025, 74);
      for (const s of [.080, .920]) ribbon(leg, 'Shin applique parallel stitch', shin, t => [s, t], m.thread, .0006, 74);
      for (const [v, h] of [[.07, .075], [.28, .079], [.50, .082], [.73, .090]] as const) {
        diamond(leg, 'Thin connected shin lozenge embroidery', shin, .5, v, .19, h, m.thread, .0010);
      }
      for (const s of [-1, 1]) ribbon(leg, 'Swept shin scrolling silver stem', shin,
        t => [.5 + s * .35 * Math.sin(t * Math.PI * 1.15), t], m.thread, .00085, 72);
    } else {
      for (const s of [.18, .82]) {
        ribbon(leg, 'Dragon calf long gold cloth seam', shin, t => [s + .09 * Math.sin(t * Math.PI * 1.4), t], m.thread, .0010, 80);
        ribbon(leg, 'Dragon calf seam fine parallel stitch', shin, t => [s + .03 + .09 * Math.sin(t * Math.PI * 1.4), t], m.thread, .00042, 80);
      }
      diamond(leg, 'Dragon shin trailing narrow gold diamond', shin, .49, .37, .12, .100, m.metal, .0021);
      ribbon(leg, 'Dragon shin pendant stem', shin, t => [.49 + .035 * Math.sin(t * Math.PI), lerp(.46, 1, t)], m.metal, .0020, 50);
    }

    const thigh: Surface = (u, v) => legPoint((u * 2 - 1) * .66, lerp(.625, .911, v), .0017);
    for (const s of [.18, .82]) {
      ribbon(leg, 'Long thigh double stitched seam', thigh, t => [s + .065 * Math.sin(t * Math.PI), t], m.thread, .0008, 72);
      ribbon(leg, 'Thigh fine second stitch', thigh, t => [s + .026 + .065 * Math.sin(t * Math.PI), t], m.thread, .00038, 72);
    }
    const ornamentU = dragon ? .55 : .5;
    diamond(leg, 'Thigh elongated hollow metal lozenge', thigh, ornamentU, .41, .105, .115, m.metal, dragon ? .0030 : .0036);
    if (!dragon) for (const s of [-1, 1]) {
      ribbon(leg, 'Thigh silver forked pendant spear', thigh, t => [ornamentU + s * .16 * (1 - t), .38 - .15 * t], m.metal, .0031, 28);
    }
    ribbon(leg, 'Thigh narrow pendant suspension', thigh, t => [ornamentU + .025 * Math.sin(t * Math.PI), lerp(.52, .93, t)], m.thread, .0011, 48);
    mirror(g, leg, side, 'Trouser');
  }

  const hipPoint = (a: number, y: number, ease: number) => {
    const baseY = Math.max(.937, y);
    // These complete layered guards sit beneath the matching robe. Preserve the
    // spacing between their cloth, scales and trim while tucking the stack in.
    const p = smoothFit(bodyProfile.torso, baseY, a, ease - .014);
    const flare = Math.max(0, .937 - y) * .12;
    return p.add(V(Math.sin(a) * flare, y - baseY, Math.cos(a) * flare * .62));
  };
  for (const side of [1, -1]) {
    const hip = new THREE.Group();
    const mainBottom = (u: number) => dragon
      ? .846 - .120 * (u < .78 ? u / .78 : (1 - u) / .22)
      : .850 - .128 * Math.pow(Math.sin(u * Math.PI * .94), 1.2) + .018 * u;
    const sweepLow = (u: number) => dragon ? .979 - .181 * Math.pow(u, .87) : .977 - .188 * Math.pow(u, .69) + .013 * Math.sin(u * Math.PI);
    const frontLow = (u: number) => dragon ? lerp(.866, .800, u) : .877 - .092 * Math.pow(u, 1.1);
    const clothCovers = (angle: number, y: number) => {
      const sweepU = THREE.MathUtils.clamp((angle - .087) / (1.88 - .087), 0, 1);
      const frontU = THREE.MathUtils.clamp((angle - .057) / (.59 - .057), 0, 1);
      return (angle <= 1.88 + .020 && y >= sweepLow(sweepU) - .005)
        || (angle <= .59 + .020 && y >= frontLow(frontU) - .005);
    };
    const main: Surface = (u, v) => {
      const a = lerp(.12, 1.98, u);
      const bottom = mainBottom(u);
      const ease = .022 + .016 * Math.pow(1 - v, 2) + .004 * Math.sin(u * Math.PI);
      return hipPoint(a, lerp(bottom, 1.018 - .012 * Math.sin(u * Math.PI), v), ease);
    };
    shell(hip, 'Long flared outer hip scale guard with dark turned lining', main, m.scales, m.lining, 24, 18, .0034);
    const field: Surface = (u, v) => main(lerp(.047, .953, u), lerp(.047, .947, v));
    const mainScuteStart = hip.children.length;
    addScaleField(hip, 'Hip guard overlapping small polished hide scutes', field, m, { columns: 12, rows: 12, deform: 'skirt', lift: .0015, seed: 315 });
    occlusion.push(trimCoveredScutes(hip, mainScuteStart, field,
      (u, _v, y) => clothCovers(lerp(.12, 1.98, lerp(.047, .953, u)), y), `main hip ${side}`));
    border(hip, 'Hip guard solid beveled metal perimeter', main, m.metal, metalWidth);
    for (const s of [.02, .98]) ribbon(hip, 'Hip guard fine chased frame groove', main, t => [s, t], m.thread, .0007, 72, .0018);

    const rear: Surface = (u, v) => {
      const a = lerp(1.63, 3.01, u);
      const bottom = .815 - .070 * Math.sin(u * Math.PI) + .014 * u;
      return hipPoint(a, lerp(bottom, 1.006, v), .021 + .014 * Math.pow(1 - v, 2) - .002 * Math.pow(v, 6));
    };
    shell(hip, 'Separate rear overlapping pointed hip guard', rear, m.cloth, m.lining, 24, 16, .0028);
    const rearInset: Surface = (u, v) => rear(lerp(.09, .91, u), lerp(.09, .86, v));
    const rearScuteStart = hip.children.length;
    addScaleField(hip, 'Rear guard inset overlapping scutes', rearInset, m, { columns: 7, rows: 8, deform: 'skirt', lift: .0017, seed: 619 });
    occlusion.push(trimCoveredScutes(hip, rearScuteStart, rearInset, (u, _v, y) => {
      const angle = lerp(1.63, 3.01, lerp(.09, .91, u));
      const mainU = THREE.MathUtils.clamp((angle - .12) / (1.98 - .12), 0, 1);
      return clothCovers(angle, y) || (angle <= 1.98 + .020 && y >= mainBottom(mainU) - .005);
    }, `rear hip ${side}`));
    border(hip, 'Rear guard narrow beveled frame', rear, m.metal, .0044);

    // The cloth sweep lies over the scale guard and exposes a diagonal field below.
    const sweep: Surface = (u, v) => {
      const a = lerp(.087, 1.88, u);
      const low = sweepLow(u);
      const p = hipPoint(a, lerp(low, 1.029 - .012 * u, v), .030 + .014 * Math.pow(1 - v, 2));
      const drape = .0025 * Math.sin(12 * u + 4 * v) * Math.sin(v * Math.PI);
      return p.add(V(Math.sin(a) * drape, 0, Math.cos(a) * drape));
    };
    shell(hip, 'Sweeping pointed cloth upper layer over scales', sweep, m.cloth, m.lining, 28, 15, .0030);
    border(hip, 'Sweeping hip layer raised sculpted metal binding', sweep, m.metal, metalWidth);
    ribbon(hip, 'Swept hip cloth inner parallel stitch', sweep, t => [t, .064], m.thread, .0007, 76);
    if (dragon) {
      diamond(hip, 'Dragon pointed outer drape gold lozenge', sweep, .78, .29, .061, .097, m.metal, .0027);
      for (const s of [.69, .87]) ribbon(hip, 'Dragon hip drape angular gold embroidered stem', sweep,
        t => [s + .07 * Math.sin(t * Math.PI * .6), lerp(.08, .77, t)], m.thread, .0010, 40);
    }

    const frontDrape: Surface = (u, v) => {
      const a = lerp(.057, .59, u);
      const low = frontLow(u);
      return hipPoint(a, lerp(low, 1.015, v), .038 + .006 * (1 - v));
    };
    shell(hip, 'Long narrow pointed front cloth drape', frontDrape, m.cloth, m.lining, 14, 18, .0030);
    border(hip, 'Front drape beveled edge', frontDrape, m.metal, .0044);
    ribbon(hip, 'Front drape inner stitched edge', frontDrape, t => [.10, t], m.thread, .00065, 56);
    ribbon(hip, 'Front drape second stitched edge', frontDrape, t => [.90, t], m.thread, .00065, 56);
    if (dragon) diamond(hip, 'Front dragon tab tiny hanging gold lozenge', frontDrape, .77, .27, .080, .064, m.thread, .0011);
    else for (const s of [-1, 1]) ribbon(hip, 'Front silver drape fork finial', frontDrape,
      t => [.83 + s * .08 * (1 - t), .15 - .12 * t], m.metal, .0026, 22);
    hip.traverse(o => { if (o instanceof THREE.Mesh) o.userData.itemModelDeform = 'skirt'; });
    mirror(g, hip, side, 'Layered hip');
  }

  const beltBand = (slope: number, layer: number): Surface => (u, v) => {
    const a = u * TAU;
    const y = 1.027 + slope * .020 * Math.sin(a) + lerp(-.018, .018, v);
    const backTuck = .008 * THREE.MathUtils.smoothstep(-Math.cos(a), .15, .65);
    return smoothFit(bodyProfile.torso, y, a, .014 + layer * .003 - backTuck);
  };
  for (const [index, slope] of (dragon ? [0] : [-1, 1]).entries()) {
    const belt = beltBand(slope, index);
    shell(g, dragon ? 'Broad dragonhide waist belt' : 'Crossed tailored starhide waist belt', belt, m.cloth, m.lining, 80, 5, .0026);
    for (const v of [.035, .965]) ribbon(g, 'Belt solid beveled border', belt, t => [t, v], m.metal, .0048, 112);
    for (let k = 0; k < 28; k++) {
      const a = k / 28, b = (k + .68) / 28;
      ribbon(g, 'Belt angular chased diagonal', belt, t => [lerp(a, b, t), lerp(.19, .81, t)], m.thread, .0008, 7);
      if (!dragon) ribbon(g, 'Belt intersecting woven diagonal', belt, t => [lerp(a, b, t), lerp(.81, .19, t)], m.thread, .00055, 7);
    }
  }

  const clasp: Surface = (u, v) => {
    const y = lerp(.963, 1.079, v);
    return smoothFit(bodyProfile.torso, y, (u * 2 - 1) * .25, .021);
  };
  const claspBacking: Surface = (u, v) => clasp(.5 + (u * 2 - 1) * .34 * Math.sin(v * Math.PI), lerp(.055, .945, v));
  shell(g, 'Solid diamond waist clasp backing', claspBacking, m.scales, m.lining, 12, 14, .0025);
  diamond(g, 'Waist long diamond sculpted metal clasp', clasp, .5, .5, .33, .485, m.metal, .0064);
  diamond(g, 'Waist clasp recessed second metal edge', clasp, .5, .53, .21, .30, m.metal, .0023);
  if (dragon) for (const s of [-1, 1]) {
    ribbon(g, 'Dragon clasp angular outward shoulder', clasp, t => [.5 + s * lerp(.21, .44, t), .53 + .08 * Math.sin(t * Math.PI)], m.metal, .0042, 20);
  } else for (const s of [-1, 1]) {
    ribbon(g, 'Star clasp curved silver shoulder', clasp, t => [.5 + s * lerp(.18, .52, t), .48 + .18 * Math.sin(t * Math.PI * .8)], m.metal, .0041, 26);
  }
  const gem = new THREE.OctahedronGeometry(1, 0);
  gem.scale(.011, .025, .0041);
  const p = clasp(.5, .55); gem.translate(p.x, p.y, p.z + .0035);
  mesh(g, 'Small polished diamond clasp jewel', gem, m.gem);
  g.userData.scuteOcclusion = { fields: occlusion,
    platesBefore: occlusion.reduce((sum, field) => sum + field.platesBefore, 0),
    platesAfter: occlusion.reduce((sum, field) => sum + field.platesAfter, 0),
    removed: occlusion.reduce((sum, field) => sum + field.removed, 0) };
  return g;
}
