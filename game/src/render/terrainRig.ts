import { Bone, Matrix4, Object3D, Vector3, SkinnedMesh } from "three";

export interface TerrainPose {
  /** Maps the rig's scene coordinates into the terrain's world coordinates. */
  placement: Matrix4;
  origin: Vector3;
  heightAt: (x: number, z: number) => number;
}

interface Joint { bone: Bone; automatic: boolean; world: Matrix4; clearance: number; parent?: Joint }
const rigs = new WeakMap<Object3D, Joint[]>();
const poses = new WeakMap<Object3D, TerrainPose>();
const active = new WeakSet<Object3D>();
const inverse = new Matrix4(), world = new Matrix4(), warp = new Matrix4(), point = new Vector3();

function joints(root: Object3D): Joint[] {
  let result = rigs.get(root);
  if (!result) {
    result = [];
    root.traverse(node => {
      if ((node as Bone).isBone) result!.push({ bone: node as Bone, automatic: node.matrixAutoUpdate, world: new Matrix4(), clearance: 0 });
    });
    for (const joint of result) joint.parent = result.find(candidate => candidate.bone === joint.bone.parent);
    rigs.set(root, result);
  }
  return result;
}

/** Corrections live in matrices, leaving authored animation channels untouched. */
export function restoreTerrainRig(root: Object3D): void {
  active.delete(root);
  for (const joint of joints(root)) joint.bone.matrixAutoUpdate = joint.automatic;
}

/**
 * Bend the sampled skeleton over the surface. Each joint keeps its animated clearance;
 * the local terrain tangent also carries toes, soles and rigid segment attachments.
 * Unlike a single root tilt, this follows a crest along an arbitrarily long spine.
 * Matrix locals retain the tangent shear without a lossy TRS decomposition, and are
 * rebuilt from the authored pose every frame (never fed back into the next animation).
 */
export function conformTerrainRig(root: Object3D, pose: TerrainPose): void {
  const list = joints(root);
  if (!list.length) return;
  root.updateWorldMatrix(true, true);
  inverse.copy(pose.placement).invert();
  const base = pose.heightAt(pose.origin.x, pose.origin.z);
  if (!Number.isFinite(base)) return;
  for (const joint of list) {
    world.multiplyMatrices(pose.placement, joint.bone.matrixWorld);
    point.setFromMatrixPosition(world);
    joint.clearance = point.y - base;
    const h = pose.heightAt(point.x, point.z);
    const e = 0.04;
    const dx = (pose.heightAt(point.x + e, point.z) - pose.heightAt(point.x - e, point.z)) / (2 * e);
    const dz = (pose.heightAt(point.x, point.z + e) - pose.heightAt(point.x, point.z - e)) / (2 * e);
    if (![h, dx, dz].every(Number.isFinite)) { joint.world.copy(joint.bone.matrixWorld); continue; }
    warp.set(1, 0, 0, 0, dx, 1, dz, h - base - dx * point.x - dz * point.z, 0, 0, 1, 0, 0, 0, 0, 1);
    joint.world.multiplyMatrices(inverse, warp.multiply(world));
  }
  // All target worlds must be computed before altering any parent in the chain.
  for (const { bone, world: target, parent: parentJoint } of list) {
    const parent = bone.parent;
    if (parent) bone.matrix.copy(parentJoint?.world ?? parent.matrixWorld).invert().multiply(target);
    else bone.matrix.copy(target);
    bone.matrixAutoUpdate = false;
  }
  root.updateWorldMatrix(true, true);
  const saved = poses.get(root) ?? { ...pose, placement: new Matrix4(), origin: new Vector3() };
  saved.placement.copy(pose.placement); saved.origin.copy(pose.origin); saved.heightAt = pose.heightAt;
  poses.set(root, saved); active.add(root);
}

/** Reads actual evaluated joint matrices, rather than a second predicted contact pose. */
export function terrainRigSnapshot(root: Object3D) {
  const pose = poses.get(root);
  if (!pose || !active.has(root)) return null;
  let maxClearanceError = 0;
  const contacts = joints(root).map(joint => {
    const p = new Vector3().setFromMatrixPosition(joint.bone.matrixWorld).applyMatrix4(pose.placement);
    const clearance = p.y - pose.heightAt(p.x, p.z);
    maxClearanceError = Math.max(maxClearanceError, Math.abs(clearance - joint.clearance));
    return { name: joint.bone.name, position: p.toArray(), clearance, authoredClearance: joint.clearance };
  });
  let minVertexClearance = Infinity, maxVertexClearance = -Infinity;
  root.traverse(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 100))) {
      const p = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(pose.placement);
      const clearance = p.y - pose.heightAt(p.x, p.z);
      minVertexClearance = Math.min(minVertexClearance, clearance); maxVertexClearance = Math.max(maxVertexClearance, clearance);
    }
  });
  return { joints: contacts.length, maxClearanceError, minVertexClearance, maxVertexClearance, contacts: contacts.filter(joint => /foot|toe|trunk|hoof|paw|tarsus/i.test(joint.name)) };
}
