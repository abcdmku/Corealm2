import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const path = 'assets/art/tripo/imports/creatures/audit-user-crab/sources/crab+3d+model.glb';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(path));
const root = doc.getRoot();
const info = {
  scenes: root.listScenes().map((x) => x.getName()),
  nodes: root.listNodes().map((x) => ({ name: x.getName(), mesh: x.getMesh()?.getName(), skin: x.getSkin()?.getName(), translation: x.getTranslation(), scale: x.getScale() })),
  meshes: root.listMeshes().map((x) => ({ name: x.getName(), primitives: x.listPrimitives().map((p) => ({ attributes: p.listSemantics(), vertices: p.getAttribute('POSITION')?.getCount(), triangles: p.getIndices()?.getCount() / 3, material: p.getMaterial()?.getName() })) })),
  materials: root.listMaterials().map((x) => ({ name: x.getName(), baseColor: x.getBaseColorTexture()?.getName(), normal: x.getNormalTexture()?.getName(), metallicRoughness: x.getMetallicRoughnessTexture()?.getName(), occlusion: x.getOcclusionTexture()?.getName(), baseColorFactor: x.getBaseColorFactor(), roughnessFactor: x.getRoughnessFactor(), metallicFactor: x.getMetallicFactor() })),
  textures: root.listTextures().map((x) => ({ name: x.getName(), mime: x.getMimeType(), bytes: x.getImage()?.length })),
  skins: root.listSkins().map((x) => ({ name: x.getName(), joints: x.listJoints().map((j) => j.getName()) })),
  animations: root.listAnimations().map((x) => ({ name: x.getName(), channels: x.listChannels().length })),
};
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  const a = p.getAttribute('POSITION')?.getArray();
  if (!a) continue;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); }
  info.bounds ??= []; info.bounds.push({ min, max });
}
const skin = root.listSkins()[0];
const primitive = root.listMeshes()[0]?.listPrimitives()[0];
if (skin && primitive) {
  const joints = primitive.getAttribute('JOINTS_0')?.getArray();
  const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
  const influence = new Float64Array(skin.listJoints().length);
  let maxWeightError = 0, nonRootVertices = 0;
  if (joints && weights) for (let v = 0; v < joints.length / 4; v++) {
    let sum = 0, nonRoot = false;
    for (let k = 0; k < 4; k++) { const i = v * 4 + k; influence[joints[i]] += weights[i]; sum += weights[i]; if (joints[i] !== 0 && weights[i] > 0.05) nonRoot = true; }
    maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
    if (nonRoot) nonRootVertices++;
  }
  info.weights = { maxWeightError, nonRootVertices, dominant: [...influence].map((weight, index) => ({ joint: skin.listJoints()[index].getName(), weight })).filter((x) => x.weight > 1).sort((a, b) => b.weight - a.weight).slice(0, 24) };
  info.keyJoints = skin.listJoints().filter((j) => /^(Hips|Spine|Chest|UpperChest|Neck|Head|(Left|Right)_(Shoulder|UpperArm|LowerArm|Hand|UpperLeg|LowerLeg|Foot))$/.test(j.getName())).map((j) => ({ name: j.getName(), parent: j.getParentNode()?.getName(), world: j.getWorldTranslation(), rotation: j.getRotation() }));
}
info.nodes = info.nodes.filter((x) => x.mesh || x.name === 'Armature');
info.skins = info.skins.map((x) => ({ name: x.name, jointCount: x.joints.length }));
console.log(JSON.stringify(info, null, 2));

