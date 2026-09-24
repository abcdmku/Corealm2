import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/audit-user-veilspirits';
const source = `${dir}/sources/fantasy-elf-user-original.glb`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(source);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(source);
const root = doc.getRoot();
const report = {
  source, sha256: sha256(bytes), bytes: bytes.length,
  meshes: root.listMeshes().map(mesh => ({ name: mesh.getName(), primitives: mesh.listPrimitives().map(p => ({
    material: p.getMaterial()?.getName(), vertices: p.getAttribute('POSITION')?.getCount(),
    triangles: p.getIndices()?.getCount() / 3, semantics: p.listSemantics(),
    bounds: p.getAttribute('POSITION')?.getMin([]).concat(p.getAttribute('POSITION')?.getMax([])),
  })) })),
  nodes: root.listNodes().map(n => ({ name: n.getName(), parent: n.getParentNode()?.getName(),
    mesh: n.getMesh()?.getName(), skin: n.getSkin()?.getName(),
    translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale() })),
  skins: root.listSkins().map(s => ({ name: s.getName(), joints: s.listJoints().map(n => n.getName()) })),
  materials: root.listMaterials().map(m => ({ name: m.getName(), baseColorFactor: m.getBaseColorFactor(),
    baseColorTexture: m.getBaseColorTexture()?.getName(), normalTexture: m.getNormalTexture()?.getName(),
    metallicRoughnessTexture: m.getMetallicRoughnessTexture()?.getName(),
    metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor() })),
  textures: [],
  animations: root.listAnimations().map(a => ({ name: a.getName(), channels: a.listChannels().length,
    seconds: Math.max(0, ...a.listSamplers().map(s => s.getInput().getArray().at(-1))),
    nodes: [...new Set(a.listChannels().map(c => c.getTargetNode().getName()))] })),
};
for (let i = 0; i < root.listTextures().length; i++) {
  const texture = root.listTextures()[i], data = texture.getImage(), meta = await sharp(data).metadata();
  const ext = texture.getMimeType() === 'image/png' ? 'png' : 'jpg';
  const file = `${dir}/source-texture-${i}.${ext}`;
  await writeFile(file, data);
  report.textures.push({ index: i, name: texture.getName(), mimeType: texture.getMimeType(),
    width: meta.width, height: meta.height, bytes: data.length, sha256: sha256(data), file });
}
await writeFile(`${dir}/source-inspection.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sha256: report.sha256, meshes: report.meshes, skins: report.skins,
  materials: report.materials, textures: report.textures, animations: report.animations }, null, 2));
