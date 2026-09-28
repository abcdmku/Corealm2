import type { Document } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';

/** Repair the misplaced rear chains and weights crossing between separate limbs. */
export function repairCinderAnatomy(doc: Document) {
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin() && node.getMesh());
  if (!mesh || mesh.getMesh()!.listPrimitives().length !== 1) throw new Error('Cinder requires the reviewed single skinned primitive');
  const skin = mesh.getSkin()!;
  let bones = skin.listJoints(), names = bones.map(node => node.getName());
  const primitive = mesh.getMesh()!.listPrimitives()[0]!, positions = primitive.getAttribute('POSITION')!;
  const jointIndices = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
  const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix()), inverseMeshWorld = meshWorld.clone().invert();
  const localPositions = new Map(bones.map(node => [node.getName(), new Vector3()
    .setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix())).applyMatrix4(inverseMeshWorld)]));
  const vertices: Vector3[] = [], originals: number[][] = [], lookup = new Map<string, number>();
  const canonical = Array.from({ length: positions.getCount() }, (_, index) => {
    const values = positions.getElement(index, [] as number[]), key = values.map(value => value.toFixed(5)).join(',');
    let vertex = lookup.get(key);
    if (vertex === undefined) { vertex = vertices.length; lookup.set(key, vertex); vertices.push(new Vector3().fromArray(values)); originals.push([]); }
    originals[vertex]!.push(index); return vertex;
  });
  const adjacency = vertices.map(() => new Set<number>()), indices = primitive.getIndices()!.getArray()!;
  for (let index = 0; index < indices.length; index += 3) for (let side = 0; side < 3; side++) {
    const a = canonical[indices[index + side]!]!, b = canonical[indices[index + (side + 1) % 3]!]!;
    adjacency[a]!.add(b); adjacency[b]!.add(a);
  }
  const components = (include: (point: Vector3) => boolean) => {
    const seen = new Set<number>(), groups: number[][] = [];
    for (let start = 0; start < vertices.length; start++) if (!seen.has(start) && include(vertices[start]!)) {
      const group = [start]; seen.add(start);
      for (let cursor = 0; cursor < group.length; cursor++) for (const next of adjacency[group[cursor]!]!) {
        if (!seen.has(next) && include(vertices[next]!)) { seen.add(next); group.push(next); }
      }
      groups.push(group);
    }
    return groups.sort((a, b) => b.length - a.length);
  };
  const restVertices = () => {
    const matrices = bones.map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, [] as number[]))));
    return Array.from({ length: positions.getCount() }, (_, index) => {
      const point = new Vector3().fromArray(positions.getElement(index, [] as number[]));
      const joints = jointIndices.getElement(index, [] as number[]), influence = weights.getElement(index, [] as number[]);
      return influence.reduce((sum, weight, slot) => sum.add(point.clone().applyMatrix4(matrices[joints[slot]!]!).multiplyScalar(weight)), new Vector3());
    });
  };
  const beforeVertices = restVertices();
  // The raw mesh is posed asymmetrically. Each rear chain is fitted to its own
  // connected branch; neither rear ankle belongs between the front legs.
  const fitted: Record<string, [number, number, number]> = {
    HindLeftUpper: [-.16, .37, .14], HindLeftFoot: [-.16, .20, .29],
    HindRightUpper: [-.16, .40, -.14], HindRightFoot: [-.16, .26, -.31],
  };
  const joints: { name: string; before: number[] | null; after: number[] }[] = Object.entries(fitted).map(([name, local]) => {
    const node = bones.find(bone => bone.getName() === name);
    if (!node) throw new Error(`Missing Cinder anatomy joint ${name}`);
    node.setTranslation(new Vector3().fromArray(local).applyMatrix4(meshWorld)
      .applyMatrix4(new Matrix4().fromArray(node.getParentNode()!.getWorldMatrix()).invert()).toArray());
    return { name, before: localPositions.get(name)!.toArray(), after: local };
  });
  // The branch centerlines have real elbows and knees. Insert their pivots while
  // preserving each existing foot's full world bind transform.
  const bends: Record<string, [number, number, number]> = {
    FrontLeft: [.18, .16, .20], FrontRight: [.18, .17, -.245],
    HindLeft: [-.24, .30, .19], HindRight: [-.20, .34, -.21],
  };
  for (const [prefix, local] of Object.entries(bends)) {
    if (names.includes(prefix + 'Lower')) throw new Error(`Cinder lower joint already exists: ${prefix}`);
    const upper = bones.find(node => node.getName() === prefix + 'Upper')!, foot = bones.find(node => node.getName() === prefix + 'Foot')!;
    const footWorld = new Matrix4().fromArray(foot.getWorldMatrix()), lower = doc.createNode(prefix + 'Lower');
    upper.removeChild(foot); upper.addChild(lower);
    lower.setTranslation(new Vector3().fromArray(local).applyMatrix4(meshWorld)
      .applyMatrix4(new Matrix4().fromArray(upper.getWorldMatrix()).invert()).toArray());
    lower.addChild(foot); foot.setMatrix(new Matrix4().fromArray(lower.getWorldMatrix()).invert().multiply(footWorld).toArray());
    skin.addJoint(lower); joints.push({ name: lower.getName(), before: null, after: local });
  }
  bones = skin.listJoints(); names = bones.map(node => node.getName());
  const inverseBinds = doc.createAccessor('CinderAnatomicalInverseBinds').setType('MAT4')
    .setBuffer(skin.getInverseBindMatrices()!.getBuffer()).setArray(new Float32Array(bones.length * 16));
  bones.forEach((joint, index) => inverseBinds.setElement(index,
    new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(meshWorld).toArray()));
  skin.setInverseBindMatrices(inverseBinds);
  const branches = [];
  for (const end of ['Front', 'Hind']) for (const side of [-1, 1]) {
    const cap = end === 'Front' ? .15 : .30;
    const seed = components(point => point.y < cap && (end === 'Front' ? point.x > .1 : point.x < -.06) && side * point.z > .1)[0];
    if (!seed || seed.length < 100) throw new Error('Cinder limb topology differs from the reviewed source');
    const seeds = new Set(seed), name = end + (side > 0 ? 'Left' : 'Right');
    const sourceInfluence = seed.reduce((sum, index) => {
      const source = originals[index]![0]!, oldJoints = jointIndices.getElement(source, [] as number[]), oldWeights = weights.getElement(source, [] as number[]);
      return sum + oldJoints.reduce((part, joint, slot) => part + (names[joint]!.startsWith(name) ? oldWeights[slot]! : 0), 0);
    }, 0) / seed.length;
    const outside = (point: Vector3) => end === 'Front'
      ? point.y > .30 || side * point.z < .085 || point.x < .06 || point.x > .46
      : point.y > .44 || side * point.z < .095 || point.x > -.035 || point.x < -.32;
    let membership: number[] = vertices.map((_, index) => seeds.has(index) ? 1 : 0);
    for (let pass = 0; pass < 120; pass++) membership = membership.map((_, index) => {
      if (seeds.has(index)) return 1;
      if (outside(vertices[index]!)) return 0;
      const adjacent = [...adjacency[index]!];
      return adjacent.length ? adjacent.reduce((sum, next) => sum + membership[next]!, 0) / adjacent.length : 0;
    });
    const upper = names.indexOf(name + 'Upper'), lower = names.indexOf(name + 'Lower'), foot = names.indexOf(name + 'Foot');
    if (upper < 0 || lower < 0 || foot < 0) throw new Error(`Missing Cinder limb ${name}`);
    const footY = end === 'Front' ? .06 : side > 0 ? .20 : .26;
    const lowerY = bends[name]![1], upperY = end === 'Front' ? .25 : side > 0 ? .37 : .40;
    let changed = 0, crossLimbVertices = 0, transferredCrossLimbWeight = 0;
    for (let index = 0; index < vertices.length; index++) {
      const blend = membership[index]!;
      if (blend < .00001) continue;
      const footWeight = Math.max(0, Math.min(1, (lowerY - vertices[index]!.y) / (lowerY - footY)));
      const upperWeight = Math.max(0, Math.min(1, (vertices[index]!.y - lowerY) / (upperY - lowerY)));
      const lowerWeight = 1 - footWeight - upperWeight;
      for (const original of originals[index]!) {
        const oldJoints = jointIndices.getElement(original, [] as number[]), oldWeights = weights.getElement(original, [] as number[]);
        const influence = new Map<number, number>();
        let transferred = 0;
        oldJoints.forEach((joint, slot) => {
          const oldName = names[joint]!, weight = Math.max(0, oldWeights[slot]!) * (1 - blend);
          // Original distance weights confused the front limbs with the
          // misplaced hind chains. Blend their remainder into the attachment.
          const crossesLimb = (oldName.startsWith('Front') || oldName.startsWith('Hind')) && !oldName.startsWith(name);
          const destination = crossesLimb ? names.indexOf(end === 'Front' ? 'Chest' : 'Pelvis') : joint;
          influence.set(destination, (influence.get(destination) ?? 0) + weight);
          if (crossesLimb) transferred += weight;
        });
        if (transferred > .000001) { crossLimbVertices++; transferredCrossLimbWeight += transferred; }
        influence.set(upper, (influence.get(upper) ?? 0) + upperWeight * blend);
        influence.set(lower, (influence.get(lower) ?? 0) + lowerWeight * blend);
        influence.set(foot, (influence.get(foot) ?? 0) + footWeight * blend);
        const top = [...influence].sort((a, b) => b[1] - a[1]).slice(0, 4), total = top.reduce((sum, pair) => sum + pair[1], 0);
        while (top.length < 4) top.push([0, 0]);
        jointIndices.setElement(original, top.map(pair => pair[0])); weights.setElement(original, top.map(pair => pair[1] / total)); changed++;
      }
    }
    branches.push({ name, seedVertices: seed.length, changedVertices: changed, sourceAnatomicalInfluence: sourceInfluence,
      crossLimbVertices, transferredCrossLimbWeight });
  }
  const afterVertices = restVertices();
  const maximumRestVertexDifference = Math.max(...afterVertices.map((point, index) => point.distanceTo(beforeVertices[index]!)));
  if (maximumRestVertexDifference > .000001) throw new Error(`Cinder bind repair moved rest geometry by ${maximumRestVertexDifference}m`);
  return { joints, branches, maximumRestVertexDifference,
    method: 'Refit the misplaced hind chains, insert the four observed elbow/knee pivots without moving existing foot binds, rebuild inverse binds, and separate all four limbs by triangle topology. Preserve source geometry, UVs and material maps.' };
}
