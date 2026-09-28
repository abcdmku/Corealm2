import type { Document } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';

/**
 * The original Gloam coat was weighted with a z < -.35 tail gate. The curled tip
 * crosses that plane, while the right hock lies behind it. Follow the connected
 * tail surface instead. UV seams are welded only in this working graph; the
 * exported positions, triangles, UVs, normals and textures stay untouched.
 */
export function repairGloamWeights(doc: Document) {
  const mesh = doc.getRoot().listNodes().find(node => node.getMesh() && node.getSkin());
  if (!mesh) throw new Error('Gloam weight repair needs its skinned mesh');
  const skin = mesh.getSkin()!, bones = skin.listJoints();
  const joint = (name: string) => {
    const index = bones.findIndex(node => node.getName() === name);
    if (index < 0) throw new Error(`Gloam weight repair is missing ${name}`);
    return index;
  };
  const tail = ['TailBase', 'TailMid', 'TailEnd', 'TailTip'].map(joint);
  const body = ['Pelvis', 'SpineMid', 'Chest', 'Neck', 'Head'].map(joint);
  const groups = ['Fore_L', 'Fore_R', 'Hind_L', 'Hind_R'].map(group => {
    const [part, side] = group.split('_');
    return [joint(`${part}Upper_${side}`), joint(`${part}Lower_${side}`),
      joint(`${part === 'Fore' ? 'ForeWrist' : 'HindHock'}_${side}`), joint(`${part}Paw_${side}`)];
  });
  const centers = bones.map(node => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix())));
  const tailBaseY = centers[tail[0]!]!.y, splitHeight = tailBaseY - .04;
  const sigma = new Map<number, number>();
  body.forEach((index, i) => sigma.set(index, [.17, .17, .16, .13, .13][i]!));
  tail.forEach((index, i) => sigma.set(index, [.105, .105, .09, .075][i]!));
  groups.forEach((group, i) => group.forEach((index, k) => sigma.set(index,
    (i < 2 ? [.10, .085, .070, .065] : [.11, .09, .08, .07])[k]!)));
  let changedVertices = 0, tailVertices = 0, torsoSeamVertices = 0, removedLegTailInfluences = 0;

  for (const primitive of mesh.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!, indices = primitive.getIndices()?.getArray();
    const joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
    if (!indices || !joints || !weights) throw new Error('Gloam weight repair needs indexed skinned geometry');
    const vertices: Vector3[] = [], originals: number[][] = [], lookup = new Map<string, number>();
    const canonical = Array.from({ length: positions.getCount() }, (_, vertex) => {
      const point = positions.getElement(vertex, [] as number[]), key = point.map(value => value.toFixed(5)).join(',');
      let index = lookup.get(key);
      if (index === undefined) { index = vertices.length; lookup.set(key, index); vertices.push(new Vector3().fromArray(point)); originals.push([]); }
      originals[index]!.push(vertex);
      return index;
    });
    const adjacent = vertices.map(() => new Set<number>());
    for (let i = 0; i < indices.length; i += 3) for (const [a, b] of [
      [indices[i]!, indices[i + 1]!], [indices[i + 1]!, indices[i + 2]!], [indices[i + 2]!, indices[i]!],
    ]) {
      const ca = canonical[a!]!, cb = canonical[b!]!;
      if (ca !== cb) { adjacent[ca]!.add(cb); adjacent[cb]!.add(ca); }
    }
    const seed = vertices.reduce((best, vertex, index) => vertex.distanceToSquared(centers[tail[3]!]!)
      < vertices[best]!.distanceToSquared(centers[tail[3]!]!) ? index : best, 0);
    const branch = new Set<number>([seed]), queue = [seed];
    for (let cursor = 0; cursor < queue.length; cursor++) for (const neighbor of adjacent[queue[cursor]!]!) {
      if (!branch.has(neighbor) && vertices[neighbor]!.y < splitHeight) { branch.add(neighbor); queue.push(neighbor); }
    }
    if (branch.size < 30 || branch.size > vertices.length * .4
      || [...branch].some(index => vertices[index]!.y < .08)) {
      throw new Error('Gloam tail topology no longer separates from the four feet');
    }
    tailVertices += [...branch].reduce((sum, index) => sum + originals[index]!.length, 0);

    // Dirichlet boundary labels blend the tail into its pelvis attachment. The
    // hock has no path into the branch except through that attachment, so nearby
    // surfaces never exchange weights just because their positions are close.
    const pinned = vertices.map((point, index) => branch.has(index) ? point.y < splitHeight - .08
      : point.y < splitHeight || point.y > tailBaseY + .06);
    let membership: number[] = vertices.map((_, index) => branch.has(index) ? 1 : 0);
    for (let iteration = 0; iteration < 120; iteration++) {
      const next = membership.slice();
      for (let i = 0; i < vertices.length; i++) {
        if (pinned[i] || !adjacent[i]!.size) continue;
        let value = 0, mass = 0;
        for (const neighbor of adjacent[i]!) {
          const influence = 1 / Math.max(.005, vertices[i]!.distanceTo(vertices[neighbor]!));
          value += membership[neighbor]! * influence; mass += influence;
        }
        next[i] = value / mass;
      }
      membership = next;
    }

    const changedTail = vertices.map((point, index) => branch.has(index) || membership[index]! > 1e-6
      || originals[index]!.some(vertex => joints.getElement(vertex, [] as number[]).some((bone, slot) =>
        tail.includes(bone) && weights.getElement(vertex, [] as number[])[slot]! > 0)));
    // The same source assigned the sternum and belly to either leg at x=0. Find
    // those connected left/right discontinuities and transfer their attachment
    // patch to the torso, with a falloff measured along the mesh.
    const limbSide = originals.map(list => {
      const js = joints.getElement(list[0]!, [] as number[]), ws = weights.getElement(list[0]!, [] as number[]);
      const masses = groups.map(group => js.reduce((mass, bone, slot) => mass + (group.includes(bone) ? ws[slot]! : 0), 0));
      return Math.max(...masses) > .2 ? masses.indexOf(Math.max(...masses)) : -1;
    });
    const seamDistance = vertices.map(() => Infinity), seamQueue: number[] = [];
    for (let i = 0; i < vertices.length; i++) if (limbSide[i] !== -1 && [...adjacent[i]!]
      .some(neighbor => limbSide[neighbor] !== -1 && limbSide[neighbor] !== limbSide[i]
        && Math.floor(limbSide[neighbor]! / 2) === Math.floor(limbSide[i]! / 2))) {
      seamDistance[i] = 0; seamQueue.push(i);
    }
    const patchRadius = .12;
    for (let cursor = 0; cursor < seamQueue.length; cursor++) {
      const index = seamQueue[cursor]!;
      for (const neighbor of adjacent[index]!) {
        const distance = seamDistance[index]! + vertices[index]!.distanceTo(vertices[neighbor]!);
        if (distance < patchRadius && distance < seamDistance[neighbor]!) {
          seamDistance[neighbor] = distance; seamQueue.push(neighbor);
        }
      }
    }
    const changed = changedTail.map((value, index) => value || seamDistance[index]! < patchRadius);
    torsoSeamVertices += originals.reduce((sum, list, index) => sum + (seamDistance[index]! < patchRadius ? list.length : 0), 0);
    let fields = vertices.map((point, index) => {
      const dense = new Float64Array(bones.length);
      if (!changedTail[index]) {
        const vertex = originals[index]![0]!, js = joints.getElement(vertex, [] as number[]), ws = weights.getElement(vertex, [] as number[]);
        js.forEach((bone, slot) => dense[bone] = ws[slot]!);
      } else {
        const member = membership[index]!, limb = groups[(point.z > -.02 ? 0 : 2) + (point.x < 0 ? 0 : 1)]!;
        const candidates = [...body];
        if (point.y < .66 && Math.min(...limb.map(bone => point.distanceTo(centers[bone]!))) < .17) candidates.push(...limb);
        for (const bone of candidates) dense[bone] = Math.exp(-.5 * point.distanceToSquared(centers[bone]!) / sigma.get(bone)! ** 2) * (1 - member);
        for (const bone of tail) dense[bone] = Math.exp(-.5 * point.distanceToSquared(centers[bone]!) / sigma.get(bone)! ** 2) * member;
      }
      const distance = seamDistance[index]!;
      if (distance < patchRadius) {
        const t = distance / patchRadius, preserve = t * t * (3 - 2 * t);
        for (const bone of groups.flat()) dense[bone] = dense[bone]! * preserve;
      }
      const total = dense.reduce((sum, value) => sum + value, 0);
      for (let bone = 0; bone < dense.length; bone++) dense[bone] = dense[bone]! / total;
      return dense;
    });
    // Smooth the repaired attachment regions only, without suppressing clip
    // motion or blending the physically adjacent hock and tail.
    for (let iteration = 0; iteration < 8; iteration++) {
      const next = fields.map(field => field.slice());
      for (let i = 0; i < vertices.length; i++) {
        if (!changed[i] || !adjacent[i]!.size) continue;
        const average = new Float64Array(bones.length); let mass = 0;
        for (const neighbor of adjacent[i]!) {
          const influence = 1 / Math.max(.005, vertices[i]!.distanceTo(vertices[neighbor]!));
          for (let bone = 0; bone < average.length; bone++) average[bone] = average[bone]! + fields[neighbor]![bone]! * influence;
          mass += influence;
        }
        for (let bone = 0; bone < average.length; bone++) next[i]![bone] = fields[i]![bone]! * .6 + average[bone]! / mass * .4;
      }
      fields = next;
    }
    for (let i = 0; i < vertices.length; i++) {
      if (!changed[i]) continue;
      const selected = Array.from(fields[i]!, (weight, bone) => ({ bone, weight })).sort((a, b) => b.weight - a.weight).slice(0, 4);
      const total = selected.reduce((sum, influence) => sum + influence.weight, 0);
      for (const vertex of originals[i]!) {
        if (!branch.has(i) && !selected.some(influence => tail.includes(influence.bone) && influence.weight / total > 1e-6)
          && joints.getElement(vertex, [] as number[]).some((bone, slot) => tail.includes(bone)
            && weights.getElement(vertex, [] as number[])[slot]! > .05)) removedLegTailInfluences++;
        joints.setElement(vertex, selected.map(influence => influence.bone));
        weights.setElement(vertex, selected.map(influence => influence.weight / total));
        changedVertices++;
      }
    }
  }
  return { changedVertices, tailVertices, torsoSeamVertices, removedLegTailInfluences,
    method: 'Connected tail branch with welded UV seams, harmonic pelvis attachment, torso assignment at leg seams, and eight local weight diffusion passes.' };
}
