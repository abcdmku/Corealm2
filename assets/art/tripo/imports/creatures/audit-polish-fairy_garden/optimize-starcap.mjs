import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const here = 'assets/art/tripo/imports/creatures/audit-polish-fairy_garden';
const id = 'fairy_garden_snail_faeholme';
const sourceFile = `${here}/starcap-snail-faeholme.glb`;
const outputFile = `${here}/starcap-snail-faeholme-optimized.glb`;
const hash = (b) => createHash('sha256').update(b).digest('hex');
const source = await readFile(sourceFile);
assert.equal(hash(source), '9555ad94d41ad368b94d46c6c0c960fdf29b5396e2ecdb56f638ed78f414713f');
const builderSha = hash(await readFile(import.meta.filename));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.readBinary(source);
const root = doc.getRoot();
const sourcePrim = root.listMeshes()[0].listPrimitives()[0];
const semantics = sourcePrim.listSemantics();
const originals = Object.fromEntries(semantics.map((s) => [s, sourcePrim.getAttribute(s).getArray().slice()]));
const sourceVertices = sourcePrim.getAttribute('POSITION').getCount();
assert.equal(sourceVertices, 53664);
assert.equal(sourcePrim.getIndices(), null);

let removedStaticScaleTracks = 0;
for (const clip of root.listAnimations()) {
  for (const channel of clip.listChannels()) {
    if (channel.getTargetNode()?.getName() !== 'Bone001' || channel.getTargetPath() !== 'scale') continue;
    const sampler = channel.getSampler();
    const values = sampler.getOutput().getArray();
    assert(values.every((v) => Math.abs(v - 2.54) < 1e-5));
    const rest = channel.getTargetNode().getScale();
    assert(rest.every((v) => Math.abs(v - 2.54) < 1e-5));
    channel.dispose();
    sampler.dispose();
    removedStaticScaleTracks++;
  }
}
assert.equal(removedStaticScaleTracks, 8);
const death = root.listAnimations().find((a) => a.getName() === 'Death');
const presentation = root.listNodes().find((n) => n.getName() === 'SnailPresentation');
assert(death && presentation);
assert(presentation.getScale().every((v) => Math.abs(v - 2.25) < 1e-5));
let removedDeathPresentationScaleTracks = 0;
for (const channel of death.listChannels()) {
  if (channel.getTargetNode() !== presentation || channel.getTargetPath() !== 'scale') continue;
  const sampler = channel.getSampler();
  const values = sampler.getOutput().getArray();
  assert.equal(values.length, 18);
  assert(values[0] > 4.49 && values[0] < 4.51, 'Expected inherited double-size Death track');
  channel.dispose();
  sampler.dispose();
  removedDeathPresentationScaleTracks++;
}
assert.equal(removedDeathPresentationScaleTracks, 1);
const deathFloorChannel = death.listChannels().find((c) => c.getTargetNode() === presentation && c.getTargetPath() === 'translation');
assert(deathFloorChannel);
const deathFloorSampler = deathFloorChannel.getSampler();
const floorTimes = deathFloorSampler.getInput().getArray();
const floorValues = deathFloorSampler.getOutput().getArray().slice();
assert.equal(floorValues.length, floorTimes.length * 3);
for (let i=0;i<floorTimes.length;i++) {
  // Weighted-vertex CPU sampling with the full-size corpse showed up to 3.8 cm
  // of floor penetration after the inherited vertical collapse was removed.
  floorValues[i*3+1] += Math.min(.04, Math.max(0, (floorTimes[i]-.18)*.085));
}
deathFloorSampler.getOutput().setArray(floorValues);
await doc.transform(weld());
const prim = root.listMeshes()[0].listPrimitives()[0];
const weldedVertices = prim.getAttribute('POSITION').getCount();
assert(weldedVertices >= 8000 && weldedVertices <= 12000, `Unexpected welded vertex count ${weldedVertices}`);
const indices = prim.getIndices().getArray();
assert.equal(indices.length, sourceVertices);
for (const semantic of semantics) {
  const accessor = prim.getAttribute(semantic);
  const values = accessor.getArray();
  const width = accessor.getElementSize();
  const before = originals[semantic];
  for (let i=0;i<indices.length;i++) for(let k=0;k<width;k++) {
    assert.equal(values[indices[i]*width+k],before[i*width+k],`${semantic} corner ${i} changed`);
  }
}
const output = await io.writeBinary(doc);
await writeFile(outputFile, output);
const readBack = await io.readBinary(output);
const checkRoot = readBack.getRoot();
const checkPrim = checkRoot.listMeshes()[0].listPrimitives()[0];
assert.equal(checkPrim.getAttribute('POSITION').getCount(),weldedVertices);
assert.equal(checkPrim.getIndices().getCount(),sourceVertices);
assert.equal(checkRoot.listSkins()[0].listJoints().length,12);
assert.deepEqual(checkRoot.listAnimations().map((a)=>a.getName()),['Idle','Walk','Death','Attack','Run','Hit','HitLeft','HitRight']);
const checkPresentation = checkRoot.listNodes().find((n)=>n.getName()==='SnailPresentation');
assert(checkPresentation.getScale().every((v)=>Math.abs(v-2.25)<1e-5));
assert(!checkRoot.listAnimations().find((a)=>a.getName()==='Death').listChannels().some((c)=>c.getTargetNode()===checkPresentation&&c.getTargetPath()==='scale'));
for (const clip of checkRoot.listAnimations()) for (const sampler of clip.listSamplers()) {
  const input = sampler.getInput().getArray(), output = sampler.getOutput().getArray();
  const multiple = sampler.getInterpolation()==='CUBICSPLINE' ? 3 : 1;
  assert.equal(sampler.getOutput().getCount(),input.length*multiple,`${clip.getName()} bad sampler`);
  assert([...input,...output].every(Number.isFinite));
}
const joints = checkPrim.getAttribute('JOINTS_0').getArray(), weights = checkPrim.getAttribute('WEIGHTS_0').getArray();
for (let i=0;i<weldedVertices;i++) {
  let sum=0;
  for(let k=0;k<4;k++){assert(joints[i*4+k]<12);sum+=weights[i*4+k];}
  assert(Math.abs(sum-1)<1e-4);
}
const candidateSha = hash(output);
for (const catalog of ['promotion.json','lab-catalog.json']) {
  const file = `${here}/${catalog}`;
  const data = JSON.parse(await readFile(file,'utf8'));
  const asset = data.assets.find((a)=>a.id===id);
  assert(asset);
  asset.file = 'models/fairy-garden/starcap-snail-faeholme-optimized.glb';
  asset.candidateFile = catalog==='lab-catalog.json' ? path.resolve(outputFile) : path.basename(outputFile);
  asset.bytes = output.length;
  asset.sha256 = candidateSha;
  asset.sourceProvenance.optimizationSourceFile = sourceFile;
  asset.sourceProvenance.optimizationSourceSha256 = hash(source);
  asset.sourceProvenance.optimizationBuilder = `${here}/optimize-starcap.mjs`;
  asset.sourceProvenance.optimizationBuilderSha256 = builderSha;
  asset.sourceProvenance.optimization = `Bitwise-exact indexed weld from ${sourceVertices} to ${weldedVertices} vertices; removed 8 constant Bone001 scale tracks, including 7 inherited malformed tracks. Removed inherited Death presentation scale that doubled the corpse; native skeletal Death plays at 2.25 rest scale. Retuned Death floor translation by up to 0.04 m for the full-size pose. Triangle corners, native skin, textures and other clips preserved.`;
  if (data.files) data.files[id] = path.resolve(outputFile);
  await writeFile(file,`${JSON.stringify(data,null,2)}\n`);
}
const validationFile = `${here}/validation.json`;
const validation = JSON.parse(await readFile(validationFile,'utf8'));
const entry = validation.results.find((r)=>r.id===id);
entry.candidateFile = outputFile;
entry.candidateSha256 = candidateSha;
entry.bytes = output.length;
entry.sourceVertices = sourceVertices;
entry.weldedVertices = weldedVertices;
entry.triangleCornersExact = true;
entry.removedStaticScaleTracks = removedStaticScaleTracks;
entry.removedDeathPresentationScaleTracks = removedDeathPresentationScaleTracks;
entry.deathPresentationScale = checkPresentation.getScale();
entry.deathFloorCorrectionMeters = .04;
entry.animationSamplersValid = true;
entry.optimizationBuilderSha256 = builderSha;
await writeFile(validationFile,`${JSON.stringify(validation,null,2)}\n`);
console.log(JSON.stringify({id,outputFile,candidateSha,bytes:output.length,sourceVertices,weldedVertices,triangles:sourceVertices/3,removedStaticScaleTracks,removedDeathPresentationScaleTracks,deathPresentationScale:checkPresentation.getScale(),clips:checkRoot.listAnimations().map(a=>a.getName())},null,2));
