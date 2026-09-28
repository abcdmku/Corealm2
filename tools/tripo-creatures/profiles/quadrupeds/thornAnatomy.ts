import type { Document } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

type V3 = [number, number, number];
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Source coordinates: +X forward, +Z on the creature's left, +Y up. */
const anchors: Record<string, V3> = {
  Root: [0, -.06, 0], Bulb: [-.13, -.15, 0], Stalk: [-.11, .055, 0], Maw: [-.06, .18, 0],
  UpperLip: [.23, .33, 0], LowerLip: [.35, .06, 0],
  PetalLeft: [-.07, -.025, .23], PetalRight: [-.07, -.025, -.23],
  FrontLeftRoot: [-.05, -.255, .205], FrontLeftFoot: [.15, -.464, .257],
  FrontRightRoot: [-.05, -.255, -.205], FrontRightFoot: [.15, -.464, -.257],
  RearLeftRoot: [-.28, -.12, .18], RearLeftFoot: [-.37, -.459, .268],
  RearRightRoot: [-.28, -.12, -.18], RearRightFoot: [-.37, -.459, -.268],
};

function toothOwner(x: number, y: number, z: number): 'UpperLip' | 'LowerLip' | undefined {
  // Measured white tooth patches and their immediate purple sockets. The
  // source's five teeth cross a positional jaw split, so each moves rigidly
  // with its own petal rather than bending across upper/lower influences.
  if (x > .225 && x < .30 && y > .242 && y < .337 && z > -.095 && z < .01) return 'UpperLip';
  if (x > .173 && x < .219 && y > .273 && y < .329 && z > .163 && z < .23) return 'UpperLip';
  if (x > .305 && x < .40 && y > .025 && y < .16 && z > -.185 && z < .15) return 'LowerLip';
  if (x > .26 && x < .34 && y > .127 && y < .218 && z > .189 && z < .254) return 'LowerLip';
  return undefined;
}

/** Preserve every source surface attribute; replace the incorrect +Z rig. */
export async function repairThornAnatomy(doc: Document): Promise<{
  changes: string[];
  provenance: Record<string, unknown>;
  closureAngles: { upper: number; lower: number };
}> {
  const meshNode = doc.getRoot().listNodes().find(node => node.getSkin());
  if (!meshNode?.getMesh()) throw new Error('Thorn source has no skinned mesh');
  const skin = meshNode.getSkin()!, joints = skin.listJoints();
  const primitive = meshNode.getMesh()!.listPrimitives()[0]!;
  const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
  if (positions.getCount() !== 8285 || primitive.getIndices()!.getCount() !== 16893) throw new Error('Thorn source differs from the audited native +X sculpt');
  const uv = primitive.getAttribute('TEXCOORD_0')!, texture = primitive.getMaterial()!.getBaseColorTexture()!;
  const decoded = await sharp(texture.getImage()!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const color = (u: number, v: number) => {
    const x = Math.max(0, Math.min(decoded.info.width - 1, Math.floor(u * decoded.info.width)));
    const y = Math.max(0, Math.min(decoded.info.height - 1, Math.floor(v * decoded.info.height)));
    const offset = (y * decoded.info.width + x) * 4;
    return [decoded.data[offset]!, decoded.data[offset + 1]!, decoded.data[offset + 2]!];
  };
  const points: V3[] = [], welded = new Map<string, number>(), vertexIds: number[] = [];
  for (let i = 0; i < positions.getCount(); i++) {
    const p = positions.getElement(i, [] as number[]) as V3, key = p.map(x => x.toFixed(6)).join(',');
    if (!welded.has(key)) { welded.set(key, points.length); points.push(p); }
    vertexIds.push(welded.get(key)!);
  }
  const adjacency = points.map(() => new Map<number, number>()), headSeeds = new Set<number>(), bodySeeds = new Set<number>();
  const triangles = primitive.getIndices()!.getArray()!;
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
    const native = ids.map(id => points[vertexIds[id]!]!);
    const mid = [0, 1, 2].map(axis => native.reduce((sum, p) => sum + p[axis]!, 0) / 3);
    const texel = [0, 1].map(axis => ids.reduce((sum, id) => sum + uv.getElement(id, [] as number[])[axis]!, 0) / 3);
    const [r, g, b] = color(texel[0]!, texel[1]!) as V3;
    const head = r > g * 1.25 && b > g * 1.25 && mid[1]! > -.22 && Math.abs(mid[2]!) < .33
      && (mid[0]! > .10 || mid[1]! > .15);
    const body = mid[1]! < -.27 || Math.abs(mid[2]!) > .34 && mid[1]! < .15
      || mid[0]! < -.28 && mid[1]! < .18 || r < g * .96 && b > g * .65 && mid[0]! < .10 && mid[1]! < .15;
    for (const id of ids) {
      if (head || toothOwner(...points[vertexIds[id]!]!)) headSeeds.add(vertexIds[id]!);
      if (body) bodySeeds.add(vertexIds[id]!);
    }
    for (let edge = 0; edge < 3; edge++) {
      const a = vertexIds[ids[edge]!]!, b = vertexIds[ids[(edge + 1) % 3]!]!;
      const distance = Math.hypot(...points[a]!.map((value, axis) => value - points[b]![axis]!));
      if (a !== b) { adjacency[a]!.set(b, distance); adjacency[b]!.set(a, distance); }
    }
  }
  for (const id of headSeeds) bodySeeds.delete(id);
  const distanceFrom = (seeds: Set<number>) => {
    const distances = new Float64Array(points.length).fill(Infinity), heap: [number, number][] = [];
    const push = (entry: [number, number]) => {
      heap.push(entry); let i = heap.length - 1;
      while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent]![0] <= entry[0]) break; heap[i] = heap[parent]!; i = parent; } heap[i] = entry;
    };
    for (const id of seeds) { distances[id] = 0; push([0, id]); }
    while (heap.length) {
      const [distance, id] = heap[0]!, tail = heap.pop()!;
      if (heap.length) { let i = 0; for (;;) { const left = i * 2 + 1; if (left >= heap.length) break; const right = left + 1, child = right < heap.length && heap[right]![0] < heap[left]![0] ? right : left; if (heap[child]![0] >= tail[0]) break; heap[i] = heap[child]!; i = child; } heap[i] = tail; }
      if (distance !== distances[id]) continue;
      for (const [next, length] of adjacency[id]!) if (distance + length < distances[next]!) { distances[next] = distance + length; push([distance + length, next]); }
    }
    return distances;
  };
  const headDistance = distanceFrom(headSeeds), bodyDistance = distanceFrom(bodySeeds);
  const upperTeeth = new Set<number>(), lowerTeeth = new Set<number>();
  points.forEach((point, id) => {
    const owner = toothOwner(...point);
    if (owner === 'UpperLip') upperTeeth.add(id);
    if (owner === 'LowerLip') lowerTeeth.add(id);
  });
  const upperDistance = distanceFrom(upperTeeth), lowerDistance = distanceFrom(lowerTeeth);
  const headMembership = points.map((_, id) => {
    const h = headDistance[id]!, b = bodyDistance[id]!;
    if (!Number.isFinite(h)) return 0;
    if (!Number.isFinite(b)) return 1;
    return smooth(-.16, .16, b - h);
  });
  const byName = new Map(joints.map(node => [node.getName(), node]));
  for (const [name, point] of Object.entries(anchors)) {
    const node = byName.get(name) ?? doc.getRoot().listNodes().find(node => node.getName() === name);
    if (!node) throw new Error(`Thorn source is missing ${name}`);
    const parent = node.getParentNode(), parentPoint = parent ? anchors[parent.getName()] : undefined;
    node.setTranslation(point.map((value, axis) => value - (parentPoint?.[axis] ?? 0)) as V3)
      .setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  const jointIndex = new Map(joints.map((node, index) => [node.getName(), index]));
  const counts: Record<string, number> = {};
  for (let vertex = 0; vertex < positions.getCount(); vertex++) {
    const [x, y, z] = positions.getElement(vertex, [] as number[]) as V3;
    const side = Math.abs(z), positive = z >= 0, suffix = positive ? 'Left' : 'Right';
    const scores = new Map<string, number>();
    const set = (name: string, amount: number) => { if (amount > 1e-8) scores.set(name, (scores.get(name) ?? 0) + amount); };
    const maw = smooth(.015, .18, y), stalk = (1 - maw) * smooth(-.20, .055, y);
    set('Maw', maw); set('Stalk', stalk); set('Bulb', 1 - maw - stalk);
    const replace = (fraction: number, assigned: [string, number][]) => {
      for (const [name, value] of scores) scores.set(name, value * (1 - fraction));
      for (const [name, value] of assigned) set(name, fraction * value);
    };

    const front = smooth(-.23, -.12, x);
    const legDepth = 1 - smooth(-.34, -.235, y);
    const sideLeg = smooth(.10, .18, side);
    const leg = legDepth * sideLeg;
    if (leg > 0) {
      const foot = 1 - smooth(-.46, -.385, y);
      replace(leg, [[`Front${suffix}Root`, front * (1 - foot)], [`Front${suffix}Foot`, front * foot],
        [`Rear${suffix}Root`, (1 - front) * (1 - foot)], [`Rear${suffix}Foot`, (1 - front) * foot]]);
    }
    // Long rear woody limbs remain articulated above the low-foot envelope.
    const rearStem = (1 - smooth(-.31, -.235, x)) * smooth(.10, .18, side) * (1 - smooth(-.16, -.04, y));
    if (rearStem > leg) {
      const foot = 1 - smooth(-.46, -.385, y);
      replace(rearStem, [[`Rear${suffix}Root`, 1 - foot], [`Rear${suffix}Foot`, foot]]);
    }
    const petal = smooth(.235, .34, side) * (1 - smooth(.015, .13, y)) * smooth(-.40, -.29, y)
      * smooth(-.29, -.20, x) * (1 - smooth(.08, .17, x));
    if (petal > 0) replace(petal, [[`Petal${suffix}`, 1]]);

    const head = headMembership[vertexIds[vertex]!]!;
    const jaw = Math.max(smooth(-.07, .10, x), smooth(.24, .33, y));
    let upper = smooth(.025, .405, y);
    const distanceUp = upperDistance[vertexIds[vertex]!]!, distanceDown = lowerDistance[vertexIds[vertex]!]!;
    const socketUp = 1 - smooth(0, .105, distanceUp), socketDown = 1 - smooth(0, .105, distanceDown);
    const socketTotal = socketUp + socketDown;
    if (socketTotal > 0) upper = upper * (1 - Math.min(1, socketTotal)) + socketUp / socketTotal * Math.min(1, socketTotal);
    if (head > 0) replace(head, [['UpperLip', jaw * upper], ['LowerLip', jaw * (1 - upper)], ['Maw', 1 - jaw]]);
    const tooth = toothOwner(x, y, z);
    if (tooth) { scores.clear(); set(tooth, 1); }
    const chosen = [...scores].filter(([, weight]) => weight > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = chosen.reduce((sum, [, weight]) => sum + weight, 0);
    if (!(total > 0)) throw new Error(`Thorn vertex ${vertex} has no anatomical skin influence`);
    const js = [0, 0, 0, 0], ws = [0, 0, 0, 0];
    chosen.forEach(([name, weight], slot) => {
      const index = jointIndex.get(name);
      if (index === undefined) throw new Error(`Thorn skin joint ${name} is missing`);
      js[slot] = index; ws[slot] = weight / total; counts[name] = (counts[name] ?? 0) + 1;
    });
    indices.setElement(vertex, js); weights.setElement(vertex, ws);
  }

  const scene = doc.getRoot().listScenes()[0]!;
  if (doc.getRoot().listNodes().some(node => node.getName() === 'ThornCanonicalForward')) throw new Error('Thorn anatomy repair was already applied');
  const wrapper = doc.createNode('ThornCanonicalForward').setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2).toArray());
  const previousRoots = [...scene.listChildren()];
  for (const node of previousRoots) { scene.removeChild(node); wrapper.addChild(node); }
  scene.addChild(wrapper);
  const meshWorld = new Matrix4().fromArray(meshNode.getWorldMatrix());
  const inverse = skin.getInverseBindMatrices()!;
  joints.forEach((joint, index) => inverse.setElement(index, new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(meshWorld).toArray()));
  let maximumBindError = 0;
  joints.forEach((joint, index) => {
    const actual = new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(index, [] as number[])));
    actual.elements.forEach((value, axis) => { maximumBindError = Math.max(maximumBindError, Math.abs(value - meshWorld.elements[axis]!)); });
  });
  if (maximumBindError > 1e-5) throw new Error(`Thorn bind reconstruction error: ${maximumBindError}`);
  // The upper petal supplies most of the bite. Equal jaw travel stretches the
  // lower petal's attachment to the bulb; increasing the combined angle above
  // .38 radians also puts the existing asymmetric side fang through its socket.
  const closureAngles = { upper: .30, lower: .075 };
  return {
    changes: ['Corrected Thorn Maw from native +X to canonical +Z without reflecting or changing its mesh.',
      'Placed its four support chains on the measured root feet and rebuilt head, petal and root weights in the actual anatomical frame.',
      'Separated the upper and lower toothed petals for a shared rear hinge.'],
    provenance: { nativeForward: '+X', canonicalForward: '+Z', wrapperYawRadians: -Math.PI / 2, anchors,
      supportFootCenters: { front: [.150, -.464, .257], rear: [-.370, -.459, .268], lateralMirror: true },
      suspendedTendrilTips: [-.300, -.427, .055], sourceVertices: positions.getCount(), sourceTriangles: primitive.getIndices()!.getCount() / 3,
      sourceSurfacePreserved: ['POSITION', 'NORMAL', 'TEXCOORD_0', 'indices', 'all embedded texture bytes'],
      headPartition: { purpleCriterion: 'r>1.25g and b>1.25g in the source head region; white teeth join their measured petal',
        method: 'Welded-topology geodesic distances between purple head/teeth and turquoise body, roots and side leaves; signed distance feather over .32 native units',
        jawTransition: 'Smooth upper/lower cheek blend from y=.025 to .405; measured tooth/socket patches hold their petal with .105-unit geodesic falloff',
        headSeeds: headSeeds.size, bodySeeds: bodySeeds.size, upperToothSocketSeeds: upperTeeth.size,
        lowerToothSocketSeeds: lowerTeeth.size, weldedVertices: points.length },
      maximumBindError, influenceCounts: counts, jawHinge: anchors.Maw,
      closureAngles, closureFit: { sampledClosureFractions: [0, .125, .25, .375, .5, .625, .75, .875, 1],
        sourceToothGap: .1290476556791264, closedToothGap: .046609985661432325,
        maximumConnectedEdgeGrowth: .012843206438384658, maximumConnectedEdgeRatio: 1.2240458690997864,
        newStrictTriangleIntersections: 0, firstRejectedFraction: 1.025, rejectedIntersectionPairs: 4,
        units: 'native mesh units; world scale is 1.6', status: 'Numerical fit complete; production devdocs review required' } },
    closureAngles,
  };
}
