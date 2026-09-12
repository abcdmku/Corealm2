import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { NodeIO, getBounds, Logger } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
const directory = process.argv[2] ?? '.asset-cache/fairy-terraces/fey';
const output = 'test-results/fairy-terraces-assets/fey/source-audit.json';
const reports = [];
for (const id of ['fey_opaline', 'fey_nightshade', 'fey_autumn', 'fey_frostbloom', 'idle', 'travel']) {
  const bytes = await readFile(`${directory}/${id}.glb`);
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  const report = {
    id, bytes: bytes.length, bounds: getBounds(root.listScenes()[0]),
    roots: root.listScenes()[0].listChildren().map(node => ({ name: node.getName(), translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale() })),
    nodes: root.listNodes().map(n => ({name:n.getName(), parent:n.getParentNode()?.getName(), mesh:n.getMesh()?.getName(), translation:n.getTranslation(), rotation:n.getRotation(), scale:n.getScale()})),
    meshes: root.listMeshes().map(mesh => ({name:mesh.getName(), primitives:mesh.listPrimitives().map(p => ({vertices:p.getAttribute('POSITION')?.getCount(), triangles:(p.getIndices()?.getCount()??0)/3, material:p.getMaterial()?.getName()}))})),
    skins:root.listSkins().map(s => ({name:s.getName(), joints:s.listJoints().map(n=>n.getName())})),
    animations:root.listAnimations().map(a => ({name:a.getName(),channels:a.listChannels().length,targets:a.listChannels().map(c=>[c.getTargetNode()?.getName(),c.getTargetPath()]),duration:Math.max(...a.listSamplers().map(s => s.getInput()?.getMax([])[0]??0))})),
    textures:root.listTextures().map(t=>({name:t.getName(), size:t.getSize(), mime:t.getMimeType(), bytes:t.getImage()?.byteLength})),
    materials:root.listMaterials().map(m=>({name:m.getName(), alphaMode:m.getAlphaMode(), base:m.getBaseColorFactor(), baseTexture:m.getBaseColorTexture()?.getName(), normal:m.getNormalTexture()?.getName(), emissive:m.getEmissiveFactor()})),
  };
  reports.push(report);
  console.log(JSON.stringify({...report,nodes:report.nodes.slice(0,8), skins:report.skins.map(s=>({...s,joints:s.joints.length})), animations:report.animations.map(a=>({...a,targets:a.targets.slice(0,6)}))}));
}
await mkdir('test-results/fairy-terraces-assets/fey',{recursive:true});
await writeFile(output, JSON.stringify(reports,null,2));
