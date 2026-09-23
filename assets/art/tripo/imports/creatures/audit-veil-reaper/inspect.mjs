import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const source = 'assets/art/tripo/exports/corealm_veil_reaper_6fadb584_8k_rigged.glb';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(source));
const root = doc.getRoot();
const meshes = root.listMeshes().map(mesh => ({
  name: mesh.getName(),
  primitives: mesh.listPrimitives().map(primitive => {
    const positions = primitive.getAttribute('POSITION')?.getArray();
    const joints = primitive.getAttribute('JOINTS_0')?.getArray();
    const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const firstJoint = new Map(), weighted = new Map();
    for (let i = 0; i < positions.length / 3; i++) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], positions[i * 3 + a]);
        max[a] = Math.max(max[a], positions[i * 3 + a]);
      }
      if (joints && weights) {
        firstJoint.set(joints[i * 4], (firstJoint.get(joints[i * 4]) ?? 0) + 1);
        for (let s = 0; s < 4; s++) weighted.set(joints[i * 4 + s], (weighted.get(joints[i * 4 + s]) ?? 0) + weights[i * 4 + s]);
      }
    }
    return { vertices: positions.length / 3, triangles: primitive.getIndices()?.getCount() / 3,
      min, max, hasNormals: !!primitive.getAttribute('NORMAL'), hasUV: !!primitive.getAttribute('TEXCOORD_0'),
      firstJoint: [...firstJoint.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      weighted: [...weighted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      material: primitive.getMaterial()?.getName() };
  }),
}));
console.log(JSON.stringify({ meshes, nodes: root.listNodes().map(n => ({ name: n.getName(), translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale(), skin: n.getSkin()?.getName(), mesh: n.getMesh()?.getName() })).slice(0, 80), skins: root.listSkins().map(s => ({name: s.getName(), joints: s.listJoints().map(j=>j.getName())})), materials: root.listMaterials().map(m => ({name:m.getName(),metallic:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),base:m.getBaseColorTexture()?.getName(),normal:m.getNormalTexture()?.getName(),rm:m.getMetallicRoughnessTexture()?.getName()})), textures: root.listTextures().map(t=>({name:t.getName(),mime:t.getMimeType(),bytes:t.getImage()?.length,size:t.getSize()})), animations: root.listAnimations().map(a=>a.getName()) },null,2));
