import * as THREE from "three";
import {MeshoptSimplifier} from "meshoptimizer/simplifier";

let ready = false;
let initialized = false;
export const crowdGeometryReady = (MeshoptSimplifier.ready ?? Promise.resolve()).then(() => {
  ready = MeshoptSimplifier.supported; initialized = true;
}, () => { initialized = true; });
export function canSimplifyCrowd(): boolean { return initialized; }

/** Reduce each material region independently. Surviving vertices retain all original attributes. */
export function simplifyCrowdGeometry(source: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.clearGroups();
  geometry.setDrawRange(start, count);
  if (!ready || count < 192 || Object.values(source.morphAttributes).some(values => values.length)) return geometry;
  const position = source.getAttribute("position"), normal = source.getAttribute("normal"), uv = source.getAttribute("uv");
  const joints = source.getAttribute("skinIndex"), weights = source.getAttribute("skinWeight");
  const bones = new Set<number>();
  if (joints && weights) for (let v = 0; v < position.count; v++) for (let c = 0; c < 4; c++) {
    if (weights.getComponent(v, c) > 0) bones.add(joints.getComponent(v, c));
  }
  // Skin influences are continuous attributes per bone, never interpolated joint IDs.
  // Keep unusually complex skins unchanged rather than discard deformation constraints.
  const boneList = [...bones], stride = (normal ? 3 : 0) + (uv ? 2 : 0) + boneList.length;
  if (stride > 32) return geometry;
  const positions = new Float32Array(position.count * 3), attributes = new Float32Array(position.count * stride);
  for (let v = 0; v < position.count; v++) {
    for (let c = 0; c < 3; c++) positions[v * 3 + c] = position.getComponent(v, c);
    let offset = v * stride;
    if (normal) for (let c = 0; c < 3; c++) attributes[offset++] = normal.getComponent(v, c);
    if (uv) for (let c = 0; c < 2; c++) attributes[offset++] = uv.getComponent(v, c);
    for (const bone of boneList) {
      let weight = 0;
      for (let c = 0; c < 4; c++) if (joints!.getComponent(v, c) === bone) weight += weights!.getComponent(v, c);
      attributes[offset++] = weight;
    }
  }
  const indices = Uint32Array.from({length: count}, (_, i) => source.index?.getX(start + i) ?? start + i);
  const attributeWeights = [...(normal ? [.5,.5,.5] : []), ...(uv ? [1,1] : []), ...boneList.map(() => 2)];
  const target = Math.max(96, Math.floor(count * .4 / 3) * 3);
  const [reduced] = stride
    ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, stride, attributeWeights, null, target, .015, ["LockBorder"])
    : MeshoptSimplifier.simplify(indices, positions, 3, target, .015, ["LockBorder"]);
  // Compact every stream together, including skin weights, UVs, colours and tangents.
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(reduced);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new Float32Array(vertexCount * attribute.itemSize);
    for (let v = 0; v < remap.length; v++) {
      const next = remap[v]!;
      if (next === 0xffffffff) continue;
      for (let c = 0; c < attribute.itemSize; c++) values[next * attribute.itemSize + c] = attribute.getComponent(v, c);
    }
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
  }
  geometry.setIndex(new THREE.BufferAttribute(reduced, 1));
  geometry.setDrawRange(0, reduced.length);
  return geometry;
}
