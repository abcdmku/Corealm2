/**
 * Health of a rigged source export. A Tripo Rig-page 8k export looks rigged but is not: every joint
 * sits at the origin with identity rotation, the inverse binds disagree with the nodes and 99.5-100%
 * of the weight is on the root. A normal Tripo download of the same model is healthy. These gates
 * tell them apart (see D:/corealm-scratch/anim-audit/tripo-pipeline.md section 1).
 */
import path from "node:path";
import { accessor, mul4, readGlb, transformPoint, worldMatrix } from "./glb.mjs";

export const HEALTH_GATES = {
  maxBindError: 1e-3,
  maxRigidVertexShare: 0.6,
  maxRootWeightShare: 0.2,
  // Healthy generic ("Other") rigs park unrigged parts on neutral_bone (the red dragon d20f1d55: 30%,
  // its skull and tail tip). The pipeline re-skins with bone heat and py/crlib/labels.py reports
  // where that mesh sits, so it only fails a rig that is mostly unrigged.
  maxNeutralWeightShare: 0.35,
  minWeightedJoints: 12,
};

export function inspectRig(file) {
  const glb = readGlb(file);
  const { json } = glb;
  const skin = json.skins?.[0];
  const meshNodeIndex = (json.nodes ?? []).findIndex((node) => node.mesh !== undefined);
  const geometry = geometryOf(glb, meshNodeIndex);
  if (!skin) return { file, rigged: false, healthy: false, reasons: ["no skin"], ...geometry };

  const ibm = skin.inverseBindMatrices === undefined ? null : accessor(glb, skin.inverseBindMatrices);
  let maxBindError = 0;
  let mismatched = 0;
  const joints = skin.joints.map((nodeIndex, k) => {
    const node = json.nodes[nodeIndex];
    const inverseBind = ibm ? Array.from(ibm.slice(k * 16, k * 16 + 16)) : null;
    let error = 0;
    if (inverseBind) {
      const product = mul4(worldMatrix(glb, nodeIndex), inverseBind);
      for (let e = 0; e < 16; e += 1) error = Math.max(error, Math.abs(product[e] - (e % 5 === 0 ? 1 : 0)));
    }
    maxBindError = Math.max(maxBindError, error);
    if (error > HEALTH_GATES.maxBindError) mismatched += 1;
    const parentNode = glb.parent[nodeIndex];
    const r = node.rotation ?? [0, 0, 0, 1];
    return {
      name: node.name ?? `joint_${k}`,
      parent: parentNode !== undefined && skin.joints.includes(parentNode) ? json.nodes[parentNode].name : null,
      bindPosition: transformPoint(worldMatrix(glb, nodeIndex), [0, 0, 0]),
      restRotated: Math.abs(r[3]) < 0.9999,
    };
  });

  const share = new Float64Array(skin.joints.length);
  let vertices = 0;
  let rigid = 0;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    if (primitive.attributes.JOINTS_0 === undefined) continue;
    const J = accessor(glb, primitive.attributes.JOINTS_0);
    const W = accessor(glb, primitive.attributes.WEIGHTS_0);
    for (let v = 0; v < J.length / 4; v += 1) {
      let max = 0;
      let sum = 0;
      for (let c = 0; c < 4; c += 1) sum += W[v * 4 + c];
      for (let c = 0; c < 4; c += 1) {
        const w = sum > 0 ? W[v * 4 + c] / sum : 0;
        share[J[v * 4 + c]] += w;
        max = Math.max(max, w);
      }
      if (max > 0.95) rigid += 1;
      vertices += 1;
    }
  }
  const shareOf = (k) => (vertices ? share[k] / vertices : 0);
  const weightedJoints = joints.filter((_, k) => shareOf(k) > 1e-4).length;
  const rootShare = joints.reduce((best, joint, k) => (joint.parent === null && !/neutral/i.test(joint.name) ? Math.max(best, shareOf(k)) : best), 0);
  const neutralShare = joints.reduce((sum, joint, k) => (/neutral/i.test(joint.name) ? sum + shareOf(k) : sum), 0);
  const rigidShare = vertices ? rigid / vertices : 1;

  const reasons = [];
  if (maxBindError > HEALTH_GATES.maxBindError) reasons.push(`bind mismatch on ${mismatched}/${joints.length} joints (max ${maxBindError.toFixed(3)})`);
  if (rigidShare > HEALTH_GATES.maxRigidVertexShare) reasons.push(`${(rigidShare * 100).toFixed(1)}% single-bone vertices`);
  if (rootShare > HEALTH_GATES.maxRootWeightShare) reasons.push(`${(rootShare * 100).toFixed(1)}% of weight on a root joint`);
  if (neutralShare > HEALTH_GATES.maxNeutralWeightShare) reasons.push(`${(neutralShare * 100).toFixed(1)}% on neutral_bone`);
  if (weightedJoints < HEALTH_GATES.minWeightedJoints) reasons.push(`only ${weightedJoints} weighted joints`);
  return {
    file,
    name: path.basename(file),
    rigged: true,
    healthy: reasons.length === 0,
    reasons,
    jointCount: joints.length,
    weightedJoints,
    rigidShare,
    rootShare,
    neutralShare,
    maxBindError,
    restRotatedShare: joints.filter((joint) => joint.restRotated).length / joints.length,
    joints: joints.map((joint, k) => ({ ...joint, weightShare: shareOf(k) })),
    ...geometry,
  };
}

/** Vertex/triangle counts and bind-space bounds of the first mesh node, for source matching. */
function geometryOf(glb, meshNodeIndex) {
  const { json } = glb;
  if (meshNodeIndex < 0) return { vertexCount: 0, triangleCount: 0, bounds: null };
  const node = json.nodes[meshNodeIndex];
  const world = worldMatrix(glb, meshNodeIndex);
  let vertexCount = 0;
  let triangleCount = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of json.meshes[node.mesh].primitives) {
    const a = json.accessors[primitive.attributes.POSITION];
    vertexCount += a.count;
    triangleCount += primitive.indices === undefined ? a.count / 3 : json.accessors[primitive.indices].count / 3;
    for (let corner = 0; corner < 8; corner += 1) {
      const p = transformPoint(world, [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? a.max[axis] : a.min[axis])));
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
  }
  return { vertexCount, triangleCount, bounds: { min, max } };
}

/** Height-normalised extents, for matching a source export to the production geometry. */
export function shapeKey(bounds) {
  const size = bounds.max.map((v, axis) => v - bounds.min[axis]);
  const height = size[1] || 1;
  return size.map((v) => v / height);
}
