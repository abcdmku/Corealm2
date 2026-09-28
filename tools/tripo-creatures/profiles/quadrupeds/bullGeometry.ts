import { Accessor, type Document } from '@gltf-transform/core';
import { ShapeUtils, Vector2 } from 'three';

type V3 = [number, number, number];
type Vertex = Record<string, number[]>;
type Triangle = [Vertex, Vertex, Vertex];

const lateral: V3 = [.843250789488839, 0, .5375203308028914];
const forward: V3 = [-lateral[2], 0, lateral[0]];
const center = .042539938215808246;
const cutY = .30;
const copyCutY = .29;
const rearF = -.25;
const medialJoinY = .235;
const medialOffset = .230;
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const local = (p: number[]): V3 => [dot(p, lateral) - center, p[1]!, dot(p, forward)];
const native = (l: number, y: number, f: number): V3 => [
  lateral[0] * (l + center) + forward[0] * f, y,
  lateral[2] * (l + center) + forward[2] * f,
];
const key = (v: Vertex) => v.POSITION!.map(x => x.toFixed(6)).join(',');
const clone = (v: Vertex): Vertex => Object.fromEntries(Object.entries(v).map(([name, value]) => [name, [...value]]));
const average = (vs: Vertex[]): V3 => [0, 1, 2].map(axis => vs.reduce((sum, v) => sum + v.POSITION![axis]!, 0) / vs.length) as V3;
const cross = (a: number[], b: number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const minus = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);

function mix(a: Vertex, b: Vertex, t: number): Vertex {
  const out: Vertex = {};
  for (const name of Object.keys(a)) {
    out[name] = name.startsWith('JOINTS_') ? [...(t < .5 ? a[name]! : b[name]!)]
      : a[name]!.map((value, i) => value + (b[name]![i]! - value) * t);
    if (name === 'NORMAL') {
      const size = Math.hypot(...out[name]!);
      out[name] = out[name]!.map(value => value / size);
    }
  }
  return out;
}

function clipPolygon(vertices: Vertex[], distance: (v: Vertex) => number): Vertex[] {
  const out: Vertex[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!, b = vertices[(i + 1) % vertices.length]!;
    const da = distance(a), db = distance(b), insideA = da >= -1e-10, insideB = db >= -1e-10;
    if (insideA) out.push(a);
    if (insideA !== insideB) out.push(mix(a, b, da / (da - db)));
  }
  return out.filter((v, i) => key(v) !== key(out[(i + out.length - 1) % out.length]!));
}

function triangulate(vertices: Vertex[]): Triangle[] {
  const out: Triangle[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    const tri: Triangle = [vertices[0]!, vertices[i]!, vertices[i + 1]!];
    if (Math.hypot(...cross(minus(tri[1].POSITION!, tri[0].POSITION!), minus(tri[2].POSITION!, tri[0].POSITION!))) > 1e-12) out.push(tri);
  }
  return out;
}

function clip(triangles: Triangle[], ...planes: ((v: Vertex) => number)[]): Triangle[] {
  return triangles.flatMap(triangle => {
    let polygon: Vertex[] = triangle;
    for (const plane of planes) polygon = clipPolygon(polygon, plane);
    return triangulate(polygon);
  });
}

/** Geometric edge matching includes the source's separate UV-seam vertices. */
function boundaryLoops(triangles: Triangle[]): Vertex[][] {
  const edges = new Map<string, { a: Vertex; b: Vertex; count: number }>();
  for (const triangle of triangles) for (let i = 0; i < 3; i++) {
    const a = triangle[i]!, b = triangle[(i + 1) % 3]!, edge = [key(a), key(b)].sort().join('|');
    const old = edges.get(edge);
    if (old) old.count++;
    else edges.set(edge, { a, b, count: 1 });
  }
  const open = [...edges.values()].filter(edge => edge.count === 1);
  const neighbors = new Map<string, { vertex: Vertex; next: Vertex[] }>();
  for (const { a, b } of open) for (const [u, v] of [[a, b], [b, a]]) {
    const k = key(u!);
    if (!neighbors.has(k)) neighbors.set(k, { vertex: u!, next: [] });
    neighbors.get(k)!.next.push(v!);
  }
  for (const [at, links] of neighbors) if (links.next.length !== 2) throw new Error(`Bull surgery boundary branches at ${at}: ${links.next.length}`);
  const visited = new Set<string>(), loops: Vertex[][] = [];
  for (const [start, entry] of neighbors) {
    if (visited.has(start)) continue;
    const loop: Vertex[] = [], startVertex = entry.vertex;
    let previous = '', current = startVertex;
    for (;;) {
      const k = key(current);
      if (visited.has(k)) {
        if (k !== start) throw new Error('Bull surgery boundary intersects another loop');
        break;
      }
      visited.add(k); loop.push(current);
      const next = neighbors.get(k)!.next.find(v => key(v) !== previous)!;
      previous = k; current = next;
    }
    loops.push(loop);
  }
  return loops;
}

function orient(triangle: Triangle, normal: number[]): Triangle {
  return dot(cross(minus(triangle[1].POSITION!, triangle[0].POSITION!), minus(triangle[2].POSITION!, triangle[0].POSITION!)), normal) >= 0
    ? triangle : [triangle[0], triangle[2], triangle[1]];
}

type UVChart = { map: (s: number, t: number) => number[]; sourcePosition: V3; sourceUV: number[][] };

function sourceUVChart(source: Triangle[], yMin: number, yMax: number, band: boolean): UVChart {
  // Every new chart fits strictly inside one source thigh texture triangle.
  // Its affine UV map stays continuous and has nonzero area, including across
  // the source mesh's numerous UV seams. No atlas pixels outside that island
  // can enter the new cap or the stitch band.
  const candidates = source.filter(triangle => triangle.every(v => {
    const [l, y, f] = local(v.POSITION!);
    return (band ? l < .05 : l > .075) && y > yMin && y < yMax && f < -.28;
  }));
  const area = (triangle: Triangle) => {
    const [a, b, c] = triangle.map(v => v.TEXCOORD_0!);
    return Math.abs((b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!));
  };
  if (band) {
    // Use the retained opposite thigh's posterior hide beside the seam. The
    // larger UV patch on its anterior side is visibly lighter than this skin.
    const distance = (triangle: Triangle) => {
      const [l, y, f] = local(average(triangle));
      return (l + .06) ** 2 + (y - .30) ** 2 + (f + .42) ** 2;
    };
    candidates.sort((a, b) => distance(a) - distance(b));
  } else candidates.sort((a, b) => area(b) - area(a));
  const donor = candidates[0];
  if (!donor || area(donor) < 1e-7) throw new Error('No usable continuous healthy-thigh texture chart');
  const uv = donor.map(v => [...v.TEXCOORD_0!]);
  return {
    map: (s, t) => {
      const a = .04 + (band ? .72 : .48) * s, b = .04 + (band ? .08 : .40) * t;
      return [0, 1].map(axis => uv[0]![axis]! * (1 - a - b) + uv[1]![axis]! * a + uv[2]![axis]! * b);
    },
    sourcePosition: average(donor), sourceUV: uv,
  };
}

function capMedialOpening(loop: Vertex[], chart: UVChart): Triangle[] {
  const polygon = loop.map(v => new Vector2(v.POSITION![1]!, local(v.POSITION!)[2]));
  const faces = ShapeUtils.triangulateShape(polygon, []);
  if (faces.length !== loop.length - 2) throw new Error('Bull medial hock opening did not triangulate as one simple polygon');
  const triangles = faces.map(face => face.map(i => clone(loop[i]!)) as Triangle);
  // The cut is two planes meeting at medialJoinY. Split the cap there so
  // its new points follow the same surface and do not bulge across the join.
  const result = [
    ...clip(triangles, v => medialJoinY - v.POSITION![1]!).map(triangle => {
      for (const v of triangle) {
        const [, y, f] = local(v.POSITION!); v.POSITION = native(1.2 * y - medialOffset, y, f);
        const normal = lateral.map((x, i) => -x + (i === 1 ? 1.2 : 0));
        const len = Math.hypot(...normal); v.NORMAL = normal.map(x => x / len);
      }
      return orient(triangle, triangle[0].NORMAL!);
    }),
    ...clip(triangles, v => v.POSITION![1]! - medialJoinY).map(triangle => {
      for (const v of triangle) {
        const [, y, f] = local(v.POSITION!); v.POSITION = native(.052, y, f); v.NORMAL = lateral.map(x => -x);
      }
      return orient(triangle, triangle[0].NORMAL!);
    }),
  ];
  const ys = loop.map(v => v.POSITION![1]!), fs = loop.map(v => local(v.POSITION!)[2]);
  const minY = Math.min(...ys), height = Math.max(...ys) - minY, minF = Math.min(...fs), depth = Math.max(...fs) - minF;
  for (const triangle of result) for (const vertex of triangle) {
    const [, y, f] = local(vertex.POSITION!);
    vertex.TEXCOORD_0 = chart.map((f - minF) / depth, (y - minY) / height);
  }
  return result;
}

function orderedRing(ring: Vertex[]): Vertex[] {
  let ordered = [...ring];
  const points = ordered.map(v => local(v.POSITION!));
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]!; return sum + p[0] * q[2] - q[0] * p[2]; }, 0);
  if (area < 0) ordered.reverse();
  let first = 0;
  for (let i = 1; i < ordered.length; i++) if (local(ordered[i]!.POSITION!)[2] > local(ordered[first]!.POSITION!)[2]) first = i;
  return [...ordered.slice(first), ...ordered.slice(0, first)];
}

/** A zipper keeps both existing boundary vertex sequences; no T junctions. */
function bridgeRings(top: Vertex[], bottom: Vertex[], chart: UVChart): Triangle[] {
  const a = orderedRing(top), b = orderedRing(bottom);
  const progress = (ring: Vertex[]) => {
    const values = [0];
    for (let i = 0; i < ring.length; i++) values.push(values.at(-1)! + Math.hypot(...minus(ring[i]!.POSITION!, ring[(i + 1) % ring.length]!.POSITION!)));
    return values.map(value => value / values.at(-1)!);
  };
  const pa = progress(a), pb = progress(b), triangles: Triangle[] = [], middle = average([...a, ...b]);
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    let triangle: Triangle;
    let parameters: [number, number][];
    if (j === b.length || i < a.length && pa[i + 1]! <= pb[j + 1]!) {
      triangle = [a[i % a.length]!, a[(i + 1) % a.length]!, b[j % b.length]!];
      parameters = [[pa[i]!, 1], [pa[i + 1]!, 1], [pb[j]!, 0]]; i++;
    } else {
      triangle = [a[i % a.length]!, b[(j + 1) % b.length]!, b[j % b.length]!];
      parameters = [[pa[i]!, 1], [pb[j + 1]!, 0], [pb[j]!, 0]]; j++;
    }
    // The two thigh rings occupy different source texture islands. A triangle
    // interpolating between their UVs would draw a stripe of unrelated atlas
    // pixels. The narrow stitch band continues the copied lower-leg island.
    triangle = triangle.map(clone) as Triangle;
    triangle.forEach((vertex, index) => { vertex.TEXCOORD_0 = chart.map(...parameters[index]!); });
    const normal = minus(average(triangle), middle); normal[1] = 0;
    triangles.push(orient(triangle, normal));
  }
  return triangles;
}

function patchNormals(triangles: Triangle[]): Triangle[] {
  const sums = new Map<string, V3>();
  for (const triangle of triangles) {
    const normal = cross(minus(triangle[1].POSITION!, triangle[0].POSITION!), minus(triangle[2].POSITION!, triangle[0].POSITION!));
    for (const vertex of triangle) {
      const k = key(vertex), sum = sums.get(k) ?? [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) sum[axis]! += normal[axis]!;
      sums.set(k, sum);
    }
  }
  return triangles.map(triangle => {
    const copied = triangle.map(vertex => {
      const out = clone(vertex), sum = sums.get(key(vertex))!, length = Math.hypot(...sum);
      out.NORMAL = sum.map(value => value / length); return out;
    }) as Triangle;
    const face = cross(minus(copied[1].POSITION!, copied[0].POSITION!), minus(copied[2].POSITION!, copied[0].POSITION!));
    if (copied.some(vertex => dot(vertex.NORMAL!, face) <= 0)) {
      const length = Math.hypot(...face);
      for (const vertex of copied) vertex.NORMAL = face.map(value => value / length);
    }
    return copied;
  });
}

/**
 * Redmane's source has two hind thighs welded to one hoof. The front pair
 * establishes its diagonal sagittal plane. Repair only the posterior mesh
 * below .30 source units; source positions, texture maps and UVs above the
 * cut remain unchanged. No reference skeleton participates in this decision.
 */
export function repairBullGeometry(doc: Document): {
  changes: string[];
  provenance: Record<string, unknown>;
  frame: { lateral: V3; forward: V3; center: number };
  landmarks: Record<string, V3>;
} {
  const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  if (primitives.length !== 1) throw new Error('Bull reconstruction requires the audited single source primitive');
  const primitive = primitives[0]!, positions = primitive.getAttribute('POSITION')!, indices = primitive.getIndices()!;
  if (positions.getCount() !== 7896 || indices.getCount() !== 15507) throw new Error('Bull source topology differs from the audited three-hoof sculpt');
  const semantics = primitive.listSemantics();
  const vertices = Array.from({ length: positions.getCount() }, (_, i) => Object.fromEntries(semantics.map(name => [name, primitive.getAttribute(name)!.getElement(i, [])])));
  const source: Triangle[] = [];
  const index = indices.getArray()!;
  for (let i = 0; i < index.length; i += 3) source.push([vertices[index[i]!]!, vertices[index[i + 1]!]!, vertices[index[i + 2]!]!]);
  const lowerRear = clip(source, v => cutY - v.POSITION![1]!, v => rearF - local(v.POSITION!)[2]);
  const upperRings = boundaryLoops(lowerRear).filter(loop => loop.every(v => Math.abs(v.POSITION![1]! - cutY) < 1e-7));
  if (upperRings.length !== 2) throw new Error(`Expected two separate posterior thigh rings at y=.30, found ${upperRings.length}`);
  upperRings.sort((a, b) => local(average(a))[0] - local(average(b))[0]);
  const negativeRing = upperRings[0]!, positiveRing = upperRings[1]!;
  const preserved = [
    ...clip(source, v => v.POSITION![1]! - cutY),
    ...clip(source, v => cutY - v.POSITION![1]!, v => local(v.POSITION!)[2] - rearF),
  ];
  let healthy = [
    ...clip(lowerRear, v => medialJoinY - v.POSITION![1]!, v => local(v.POSITION!)[0] - 1.2 * v.POSITION![1]! + medialOffset),
    ...clip(lowerRear, v => v.POSITION![1]! - medialJoinY, v => local(v.POSITION!)[0] - .052),
  ];
  const healthyBoundaries = boundaryLoops(healthy);
  const openings = healthyBoundaries.filter(loop => !loop.every(v => Math.abs(v.POSITION![1]! - cutY) < 1e-7));
  if (openings.length !== 1) throw new Error(`Expected one small medial hock opening, found ${openings.length}`);
  const capChart = sourceUVChart(source, .18, .32, false), seamChart = sourceUVChart(source, .24, .35, true);
  const cap = capMedialOpening(openings[0]!, capChart);
  healthy = [...healthy, ...cap];
  const healthyAfterCap = boundaryLoops(healthy);
  if (healthyAfterCap.length !== 1 || !healthyAfterCap[0]!.every(v => Math.abs(v.POSITION![1]! - cutY) < 1e-7)) throw new Error('Healthy posterior patch is not closed below its thigh seam');

  const positiveCenter = local(average(positiveRing)), negativeCenter = local(average(negativeRing));
  const deltaL = negativeCenter[0] + positiveCenter[0], deltaF = negativeCenter[2] - positiveCenter[2];
  const mirrored = patchNormals(clip(healthy, v => copyCutY - v.POSITION![1]!).map(triangle => {
    const copied = triangle.map(original => {
      const v = clone(original), [l, y, f] = local(v.POSITION!);
      const t = Math.max(0, Math.min(1, (y - .20) / .10)), blend = t * t * (3 - 2 * t), derivative = 6 * t * (1 - t) / .10;
      v.POSITION = native(-l + deltaL * blend, y, f + deltaF * blend);
      if (v.NORMAL) {
        const nl = -dot(v.NORMAL, lateral), nf = dot(v.NORMAL, forward);
        const ny = v.NORMAL[1]! - derivative * (deltaL * nl + deltaF * nf);
        const normal = [lateral[0] * nl + forward[0] * nf, ny, lateral[2] * nl + forward[2] * nf];
        const length = Math.hypot(...normal); v.NORMAL = normal.map(x => x / length);
      }
      if (v.TANGENT) {
        const tangent = v.TANGENT, tl = -dot(tangent.slice(0, 3), lateral), tf = dot(tangent.slice(0, 3), forward);
        const ty = tangent[1]!, out = [lateral[0] * (tl + deltaL * derivative * ty) + forward[0] * (tf + deltaF * derivative * ty), ty,
          lateral[2] * (tl + deltaL * derivative * ty) + forward[2] * (tf + deltaF * derivative * ty)];
        const length = Math.hypot(...out); v.TANGENT = [...out.map(x => x / length), -tangent[3]!];
      }
      return v;
    }) as Triangle;
    return [copied[0], copied[2], copied[1]] as Triangle;
  }));
  const mirrorRings = boundaryLoops(mirrored);
  if (mirrorRings.length !== 1 || !mirrorRings[0]!.every(v => Math.abs(v.POSITION![1]! - copyCutY) < 1e-7)) throw new Error('Reflected posterior lower limb is not one closed patch');
  // Keep each seam endpoint's adjacent surface normal. Recomputing normals
  // from only this narrow band would create a visible circular shading edge.
  const bridge = bridgeRings(negativeRing, mirrorRings[0]!, seamChart);
  const output = [...preserved, ...healthy, ...mirrored, ...bridge];
  const outputVertices: Vertex[] = [], outputIndex: number[] = [], dedupe = new Map<string, number>();
  for (const triangle of output) for (const vertex of triangle) {
    const signature = semantics.map(name => vertex[name]!.map(x => x.toPrecision(10)).join(',')).join('|');
    if (!dedupe.has(signature)) { dedupe.set(signature, outputVertices.length); outputVertices.push(vertex); }
    outputIndex.push(dedupe.get(signature)!);
  }
  const buffer = doc.getRoot().listBuffers()[0]!;
  for (const name of semantics) {
    const original = primitive.getAttribute(name)!;
    const values = outputVertices.flatMap(v => v[name]!);
    const array = name.startsWith('JOINTS_') ? Uint16Array.from(values) : Float32Array.from(values);
    primitive.setAttribute(name, doc.createAccessor(`RedmaneRepaired_${name}`).setType(original.getType()!).setArray(array).setBuffer(buffer));
  }
  primitive.setIndices(doc.createAccessor('RedmaneRepaired_indices').setType(Accessor.Type.SCALAR!).setArray(Uint32Array.from(outputIndex)).setBuffer(buffer));
  const healthyHoof: V3 = [.3736, .0125, -.3430], [hoofL, hoofY, hoofF] = local(healthyHoof);
  const landmarks: Record<string, V3> = {
    BullRoot: native(0, .44, -.12), BullRump: native(0, .43, -.32), BullShoulders: native(0, .51, .015),
    BullNeck: native(0, .59, .13), BullHead: native(0, .60, .29),
    FrontLeftUpper: native(.20, .46, .015), FrontLeftLower: [.2571, .2743, .1934], FrontLeftHoof: [.2061, .0253, .3690],
    FrontRightUpper: native(-.20, .46, .015), FrontRightLower: [-.2123, .2748, -.1080], FrontRightHoof: [-.3428, .0262, .0147],
    HindLeftUpper: native(.10, .43, -.365), HindLeftLower: average(positiveRing), HindLeftHoof: healthyHoof,
    HindRightUpper: native(-.10, .43, -.365), HindRightLower: average(negativeRing), HindRightHoof: native(-hoofL, hoofY, hoofF),
  };
  return {
    changes: ['Corrected the diagonal anatomical frame from matching front limbs.',
      'Separated the malformed shared hind hock, retained the healthy hoof and mirrored its textured lower limb to restore the missing fourth hoof.',
      'Joined the reconstructed limb to the original opposite thigh; kept the upper sculpture and embedded textures unchanged.'],
    provenance: { method: 'source posterior cut, medial hock closure, mirrored healthy lower limb, original thigh-ring stitch',
      sourceVertices: positions.getCount(), sourceTriangles: source.length, outputVertices: outputVertices.length, outputTriangles: output.length,
      cutY, mirroredCutY: copyCutY, rearForwardLimit: rearF, positiveThighCenter: average(positiveRing), negativeThighCenter: average(negativeRing),
      medialCapTriangles: cap.length, seamTriangles: bridge.length, originalTextureAndUVsRetained: true,
      newUVCharts: { cap: { sourcePosition: capChart.sourcePosition, sourceUV: capChart.sourceUV }, seam: { sourcePosition: seamChart.sourcePosition, sourceUV: seamChart.sourceUV } },
      preservedAboveY: cutY, mirroredUpperTransition: { startsY: .20, endsY: .30, lateralOffset: deltaL, forwardOffset: deltaF },
      frameEvidence: '217 welded vertices on each front limb; reflected matching RMS .014235 source units',
      landmarkEvidence: 'Hooves, front elbows and posterior knee seams measured from source sections; internal torso and upper joint pivots estimated within the sculpt.',
      acceptance: 'Requires production devdocs review, including posterior and underside views in all motion states.' },
    frame: { lateral, forward, center }, landmarks,
  };
}
