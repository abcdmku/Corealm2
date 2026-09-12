/** Stage source Fey skins for lab review. Does not change the public manifest or world. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO, Logger, getBounds } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, weld } from '@gltf-transform/functions';
import { AnimationMixer, Box3, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = path.join(rootPath, '.asset-cache/fairy-terraces/fey');
const outputPath = path.join(rootPath, 'test-results/fairy-terraces-assets/fey');
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
const bodyHeight = 0.78;
const textureLimit = 512;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const round = value => Math.round(value * 1e6) / 1e6;
const specs = [
  ['opaline', 'Opaline', 'Fey_Opaline'],
  ['autumn', 'AutumnKeeper', 'Fey_AutumnKeeper'],
  ['nightshade', 'Nightshade', 'Fey_Nightshade'],
  ['frostbloom', 'Frostbloom', 'Fey_Frostbloom'],
];

function normalizeSkinWeights(document) {
  let vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const source = primitive.getAttribute('WEIGHTS_0');
    if (!source) continue;
    const values = new Float32Array(source.getCount() * 4);
    for (let index = 0; index < source.getCount(); index++) {
      const weight = source.getElement(index, []);
      const total = weight.reduce((sum, value) => sum + value, 0);
      if (!(total > 0)) throw Error(`${mesh.getName()}: unweighted source vertex ${index}`);
      for (let axis = 0; axis < 4; axis++) values[index * 4 + axis] = weight[axis] / total;
    }
    // Integer attributes round again when GLTFLoader normalizes weights. A 1/255 error
    // displaces a vertex by 8 m at this world's x=2087 placement. Keep normalized floats.
    primitive.setAttribute('WEIGHTS_0', document.createAccessor(`${mesh.getName()}_weights_float`)
      .setType('VEC4').setArray(values).setBuffer(source.getBuffer()));
    vertices += source.getCount();
  }
  return vertices;
}

async function auditNativeMotion(glb) {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  delete json.images; delete json.textures; delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.buffers[0].uri = `data:application/octet-stream;base64,${glb.subarray(28 + jsonLength).toString('base64')}`;
  globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  const meshes = [];
  gltf.scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  const mixer = new AnimationMixer(gltf.scene);
  const clip = gltf.animations.find(animation => animation.name === 'Idle_Loop');
  mixer.clipAction(clip).play();
  const offset = new Vector3(2087, -119.95, -103);
  const frames = [];
  let maximumRelocationError = 0;
  for (const time of [0, 0.23, 1.19, 4.73, 9.9]) {
    mixer.setTime(time);
    const samples = [];
    for (const translated of [false, true]) {
      gltf.scene.position.copy(translated ? offset : new Vector3());
      gltf.scene.updateMatrixWorld(true);
      for (const mesh of meshes) mesh.skeleton.update();
      const bounds = new Box3();
      let vertex = 0;
      for (const mesh of meshes) for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
        const point = mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld);
        if (translated) {
          point.sub(offset);
          maximumRelocationError = Math.max(maximumRelocationError, point.distanceTo(samples[vertex++]));
        } else samples.push(point.clone());
        bounds.expandByPoint(point);
      }
      const size = bounds.getSize(new Vector3()).toArray();
      if (size[0] > 1.2 || size[1] < 0.6 || size[1] > 1.2 || size[2] > 1.2) {
        throw Error(`Fey animated dimensions outside tiny body bounds: ${size}`);
      }
      frames.push({ time, translated, min: bounds.min.toArray(), max: bounds.max.toArray(), size });
    }
  }
  if (maximumRelocationError > 0.002) throw Error(`Fey skin drifts ${maximumRelocationError}m at world placement`);
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  return { tracks: clip.tracks.length, worldOffset: offset.toArray(), maximumRelocationError, frames };
}

function copyIdle(target, source) {
  const from = source.getRoot().listAnimations()[0];
  if (!from || from.listChannels().length !== 519) throw Error('Expected the complete 173-joint Fey idle take.');
  const targets = new Map(target.getRoot().listNodes().filter(n => n.getName()).map(n => [n.getName(), n]));
  const buffer = target.getRoot().listBuffers()[0];
  const accessors = new Map();
  const samplers = new Map();
  const animation = target.createAnimation('Idle_Loop');
  const adjustedJoints = new Set();
  function accessor(input) {
    if (!input) throw Error('Source animation has no accessor.');
    if (!accessors.has(input)) accessors.set(input, target.createAccessor(input.getName())
      .setType(input.getType()).setArray(input.getArray().slice()).setNormalized(input.getNormalized()).setBuffer(buffer));
    return accessors.get(input);
  }
  for (const channel of from.listChannels()) {
    const node = channel.getTargetNode();
    const destination = targets.get(node?.getName());
    if (!node || !destination) throw Error(`Missing Fey joint ${node?.getName()}`);
    if (node.getParentNode()?.getName() !== destination.getParentNode()?.getName()) {
      throw Error(`Source/skin hierarchy mismatch at ${node.getName()}`);
    }
    const sampler = channel.getSampler();
    const kind = channel.getTargetPath();
    const getter = {translation:'getTranslation',rotation:'getRotation',scale:'getScale'}[kind];
    const sourceBind = node[getter](), targetBind = destination[getter]();
    const changed = sourceBind.some((value,index)=>Math.abs(value-targetBind[index])>0.00001);
    const samplerKey = changed ? channel : sampler;
    if (!samplers.has(samplerKey)) {
      let output = accessor(sampler.getOutput());
      if (changed) {
        // Autumn Keeper has a differently shaped face. Carry the source local motion delta onto its bind pose.
        adjustedJoints.add(node.getName());
        const values = sampler.getOutput().getArray().slice();
        const stride = sourceBind.length;
        const rotationDelta = kind === 'rotation'
          ? new Quaternion().fromArray(targetBind).multiply(new Quaternion().fromArray(sourceBind).invert()) : null;
        for (let index=0;index<values.length;index+=stride) {
          if (rotationDelta) rotationDelta.clone().multiply(new Quaternion().fromArray(values,index)).normalize().toArray(values,index);
          else for (let axis=0;axis<stride;axis++) values[index+axis] = kind === 'scale'
            ? values[index+axis]*targetBind[axis]/sourceBind[axis]
            : values[index+axis]+targetBind[axis]-sourceBind[axis];
        }
        output = target.createAccessor(`${node.getName()}_${kind}_skin_adjusted`)
          .setType(sampler.getOutput().getType()).setArray(values).setBuffer(buffer);
      }
      const cloned = target.createAnimationSampler()
        .setInput(accessor(sampler.getInput())).setOutput(output)
        .setInterpolation(sampler.getInterpolation());
      samplers.set(samplerKey, cloned);
      animation.addSampler(cloned);
    }
    animation.addChannel(target.createAnimationChannel().setTargetNode(destination)
      .setTargetPath(channel.getTargetPath()).setSampler(samplers.get(samplerKey)));
  }
  return [...adjustedJoints];
}

function geometryStats(doc) {
  const primitives = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
  return {
    meshes: doc.getRoot().listMeshes().length, primitives: primitives.length,
    vertices: primitives.reduce((count,p) => count + p.getAttribute('POSITION').getCount(), 0),
    triangles: primitives.reduce((count,p) => count + p.getIndices().getCount()/3, 0),
    joints: doc.getRoot().listSkins().map(s=>s.listJoints().length),
  };
}

await mkdir(outputPath, {recursive:true});
const sourceIdleBytes = await readFile(path.join(sourcePath, 'idle.glb'));
const sourceIdle = await io.readBinary(sourceIdleBytes);
const assets = [];
const audits = [];
for (const [variant, sourceSkin, sourceMesh] of specs) {
  const assetId = `npc_fey_${variant}`;
  const sourceBytes = await readFile(path.join(sourcePath, `fey_${variant}.glb`));
  const document = await io.readBinary(sourceBytes);
  const originalStats = geometryStats(document);
  const scene = document.getRoot().listScenes()[0];
  const sourceBounds = getBounds(scene);
  const adjustedJoints = copyIdle(document, sourceIdle);
  const normalizedWeightVertices = normalizeSkinWeights(document);

  // Put the whole skeleton and mesh under one uniform transform. Bind poses and source vertices stay intact.
  const scale = bodyHeight / (sourceBounds.max[1] - sourceBounds.min[1]);
  const tinyRoot = document.createNode(`${assetId}_size`).setScale([scale,scale,scale])
    .setTranslation([0,-sourceBounds.min[1]*scale,0]);
  for (const child of scene.listChildren()) tinyRoot.addChild(child);
  scene.addChild(tinyRoot);

  await document.transform(
    dedup(),
    prune({keepAttributes:false, keepLeaves:true, keepSolidTextures:false}),
    weld(),
    resample({tolerance:0.00001}),
    textureCompress({encoder:sharp, targetFormat:'jpeg', resize:[textureLimit,textureLimit], quality:85}),
    // Alpha masks remain PNG, preserving the source hair, plants and wing frame.
    textureCompress({encoder:sharp, targetFormat:'png', resize:[textureLimit,textureLimit], quality:90, effort:100, formats:/image\/png/}),
  );
  for (const texture of document.getRoot().listTextures()) {
    if (texture.getMimeType() !== 'image/png') continue;
    const current = texture.getImage();
    const palette = await sharp(current).png({palette:true,colours:256,effort:10,dither:0.7}).toBuffer();
    if (palette.length < current.length) texture.setImage(palette);
  }
  const glb = Buffer.from(await io.writeBinary(document));
  const nativeMotion = await auditNativeMotion(glb);
  const loaded = await io.readBinary(glb);
  const finalStats = geometryStats(loaded);
  if (originalStats.triangles !== finalStats.triangles || JSON.stringify(originalStats.joints)!==JSON.stringify(finalStats.joints)) {
    throw Error(`${assetId}: source geometry or skin was lost`);
  }
  const bounds = getBounds(loaded.getRoot().listScenes()[0]);
  const textures = loaded.getRoot().listTextures().map(t=>({name:t.getName(), size:t.getSize(), mimeType:t.getMimeType(), bytes:t.getImage().length}));
  if (textures.some(t=>t.size.some(n=>n>textureLimit))) throw Error(`${assetId}: oversized texture`);
  const animation = loaded.getRoot().listAnimations()[0];
  const duration = Math.max(...animation.listSamplers().map(s=>s.getInput().getMax([])[0]));
  if (animation.getName() !== 'Idle_Loop' || animation.listChannels().length < 100 || duration < 9) throw Error(`${assetId}: missing idle`);
  const entry = {
    id:assetId, file:`models/character/${assetId}.glb`, pack:'fab-paragon-fey', category:'character', is:'fairy',
    tags:['fairy','npc','paragon-fey',variant,'native-skin','small'], bytes:glb.length,
    size:{x:round(bounds.max[0]-bounds.min[0]), y:round(bounds.max[1]-bounds.min[1]),z:round(bounds.max[2]-bounds.min[2])},
    base:{x:round(bounds.min[0]),y:round(bounds.min[1]),z:round(bounds.min[2])},
    animations:loaded.getRoot().listAnimations().map(a=>a.getName()),
    materials:loaded.getRoot().listMaterials().map(m=>m.getName()),
    sha256:sha256(glb),
  };
  assets.push(entry);
  audits.push({
    id:assetId, sourceFile:`.asset-cache/fairy-terraces/fey/fey_${variant}.glb`,
    sourceAsset:`/Game/ParagonFey/Characters/Heroes/Fey/Skins/${sourceSkin}/Meshes/${sourceMesh}`,
    sourceSha256:sha256(sourceBytes), sourceBytes:sourceBytes.length, outputSha256:entry.sha256, outputBytes:glb.length,
    sourceAnimation:'/Game/ParagonFey/Characters/Heroes/Fey/Animations/Idle', animationSourceSha256:sha256(sourceIdleBytes),
    sourceStats:originalStats, finalStats, sourceBounds, normalizedBounds:bounds, scale,
    animation:{name:animation.getName(),channels:animation.listChannels().length,duration,adjustedJoints},
    skinWeights:{componentType:'FLOAT',normalizedWeightVertices}, nativeMotion, textures,
  });
  await writeFile(path.join(outputPath, `${assetId}.glb`), glb);
  console.log(`${assetId}: ${(glb.length/1024/1024).toFixed(2)} MiB, ${finalStats.triangles} triangles, ${animation.listChannels().length} idle channels, ${entry.size.y}m bind height`);
}
await writeFile(path.join(outputPath, 'manifest-assets.json'), JSON.stringify(assets,null,2)+'\n');
await writeFile(path.join(outputPath, 'candidates.json'), JSON.stringify({
  pack:{id:'fab-paragon-fey',name:'Paragon: The Fey',author:'Epic Games',
    source:'https://www.fab.com/listings/9afbcde6-4a14-4018-95c3-2f3a2e1da858',
    license:'Fab Standard License'},
  assets,files:Object.fromEntries(assets.map(entry=>[entry.id,`${entry.id}.glb`])),
},null,2)+'\n');
await writeFile(path.join(outputPath, 'asset-audit.json'), JSON.stringify({
  generator:'tools/fairy-terraces/fey-build.mjs', generatorSha256:sha256(await readFile(fileURLToPath(import.meta.url))),
  sourceExporter:'tools/fairy-terraces/export_fey.py', bodyHeightMetres:bodyHeight, textureLimit, assets:audits,
},null,2)+'\n');
