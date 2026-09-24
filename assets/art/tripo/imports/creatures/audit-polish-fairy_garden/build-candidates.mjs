import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';

const here = 'assets/art/tripo/imports/creatures/audit-polish-fairy_garden';
const stagedRoot = `${here}/sources`;
const hash = (b) => createHash('sha256').update(b).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const staged = JSON.parse(await readFile(`${stagedRoot}/promotion.json`, 'utf8'));
const manifest = JSON.parse(await readFile(`${here}/source-manifest.json`, 'utf8'));
const scriptSha = hash(await readFile(import.meta.filename));
const settings = [
  { id: 'fairy_garden_snail_faeholme', source: 'starwhorl-snail-faeholme.glb', output: 'starcap-snail-faeholme.glb', atlas: 'starcap-uv.png', name: 'Starcap Snail', scaleCorrection: .5, cap: 'Five-point luminous fungal star spread over the spiral shell' },
  { id: 'fairy_garden_snail_gloamgarden', source: 'glimmercap-snail-gloamgarden.glb', output: 'mooncap-snail-gloamgarden.glb', atlas: 'mooncap-uv.png', name: 'Mooncap Snail', scaleCorrection: .56, cap: 'Silver crescent fungal caps and spore trails on a teal-lilac shell' },
];
const assets = [];
const validation = [];
for (const v of settings) {
  const prior = staged.assets.find((a) => a.id === v.id);
  assert(prior);
  const sourceFile = `${stagedRoot}/${v.source}`;
  const sourceBytes = await readFile(sourceFile);
  assert.equal(hash(sourceBytes), prior.sha256, `${v.id}: staged source changed`);
  const atlasFile = `${here}/${v.atlas}`;
  const atlasBytes = await readFile(atlasFile);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const material = primitive.getMaterial();
  const baseColor = material.getBaseColorTexture();
  assert(baseColor, `${v.id}: missing albedo`);
  baseColor.setImage(new Uint8Array(atlasBytes)).setMimeType('image/png').setName(`${v.name} image-generated UV atlas`);
  if (v.scaleCorrection !== 1) {
    const scene = root.listScenes()[0];
    const presenter = scene.listChildren().find((n) => n.getName() === 'SnailPresentation');
    assert(presenter, `${v.id}: staged presentation missing`);
    presenter.setScale(presenter.getScale().map((s) => s * v.scaleCorrection));
    for (const clip of root.listAnimations()) for (const channel of clip.listChannels()) {
      if (channel.getTargetNode() !== presenter || channel.getTargetPath() !== 'translation') continue;
      const output = channel.getSampler().getOutput();
      output.setArray(output.getArray().map((value) => value * v.scaleCorrection));
    }
  }
  const bytes = await io.writeBinary(doc);
  const candidateFile = `${here}/${v.output}`;
  await writeFile(candidateFile, bytes);
  const check = await io.readBinary(bytes);
  const checkRoot = check.getRoot();
  const checkPrim = checkRoot.listMeshes()[0].listPrimitives()[0];
  for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
    assert.deepEqual(Array.from(checkPrim.getAttribute(key).getArray()), Array.from(primitive.getAttribute(key).getArray()), `${v.id}: ${key} altered`);
  }
  if (primitive.getIndices()) assert.deepEqual(Array.from(checkPrim.getIndices().getArray()), Array.from(primitive.getIndices().getArray()), `${v.id}: indices altered`);
  else assert.equal(checkPrim.getIndices(), null, `${v.id}: indices added`);
  const skin = checkRoot.listSkins()[0];
  assert(skin && skin.listJoints().length > 0);
  const originalClips = root.listAnimations().map((a) => a.getName());
  const clips = checkRoot.listAnimations().map((a) => a.getName());
  assert.deepEqual(clips, originalClips);
  const size = Object.fromEntries(Object.entries(prior.size).map(([k, value]) => [k, value * v.scaleCorrection]));
  const base = Object.fromEntries(Object.entries(prior.base).map(([k, value]) => [k, value * v.scaleCorrection]));
  const bounds = { min: [base.x, 0, base.z], max: [base.x + size.x, size.y, base.z + size.z] };
  const asset = {
    ...prior,
    file: `models/fairy-garden/${v.output}`,
    candidateFile: v.output,
    is: v.name,
    bytes: bytes.length,
    sha256: hash(bytes),
    size, base, bounds,
    impliedWalkMps: prior.impliedWalkMps === null ? null : prior.impliedWalkMps * v.scaleCorrection,
    impliedRunMps: prior.impliedRunMps === null ? null : prior.impliedRunMps * v.scaleCorrection,
    measuredGait: null,
    materials: checkRoot.listMaterials().map((m) => m.getName()),
    sourceProvenance: {
      ...prior.sourceProvenance,
      polishSourceFile: sourceFile,
      polishSourceSha256: hash(sourceBytes),
      polishBuilder: `${here}/build-candidates.mjs`,
      polishBuilderSha256: scriptSha,
      generatedAtlas: atlasFile,
      generatedAtlasSha256: hash(atlasBytes),
      modifications: `${v.cap}; native geometry, UV, skin and clips preserved; presentation scale is ${v.scaleCorrection} of the staged candidate.`,
    },
    metadata: {
      ...prior.metadata,
      capIdentity: v.cap,
      desiredInGameHeightMeters: size.y,
    },
    acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
  assets.push(asset);
  validation.push({ id: v.id, sourceFile, sourceSha256: hash(sourceBytes), candidateFile, candidateSha256: hash(bytes), bytes: bytes.length, atlasFile, atlasSha256: hash(atlasBytes), size, bounds, clips, joints: skin.listJoints().length, geometryUvWeightsIndicesPreserved: true, accepted: false });
}

// A small sculpted frill follows the native head joint. The blue/violet frog skin remains
// the source material; this only gives the high-tier Orchid Pondling a distinct outline.
{
  const id = 'fairy_garden_frog_faeholme';
  const prior = manifest.assets.find((a) => a.id === id);
  assert(prior);
  const sourceFile = `${here}/sources/${id}.glb`;
  const sourceBytes = await readFile(sourceFile);
  assert.equal(hash(sourceBytes), 'b6c0684d636eb16a0547cc142b4d7c0de54cbea65459c85f67208d06642442b6', 'Frog source changed; inspect before rebuilding');
  const doc = await io.readBinary(sourceBytes), root = doc.getRoot(), scene = root.listScenes()[0];
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const sourceAttrs = Object.fromEntries(['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'].map(k=>[k,Array.from(primitive.getAttribute(k).getArray())]));
  const head = root.listNodes().find((n) => n.getName() === 'Bone003');
  assert(head);
  const worldCache = new Map();
  const world = (node) => {
    if (worldCache.has(node)) return worldCache.get(node);
    const m = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.getTranslation()), new THREE.Quaternion().fromArray(node.getRotation()), new THREE.Vector3().fromArray(node.getScale()));
    if (node.getParentNode()) m.premultiply(world(node.getParentNode()));
    worldCache.set(node,m);
    return m;
  };
  const intoHead = world(head).clone().invert();
  const points = [], uvs = [], indices = [];
  const petals = [
    { x: -.034, lean: -.020, width: .031, top: .169, uv: [.11,.07,.34,.27] },
    { x: 0, lean: 0, width: .037, top: .177, uv: [.50,.07,.73,.29] },
    { x: .034, lean: .020, width: .031, top: .169, uv: [.11,.29,.34,.49] },
  ];
  for (const p of petals) {
    const start = points.length/3;
    const verts = [
      [p.x,.102,.055], [p.x-p.width,.133,.073], [p.x+p.lean,p.top,.096],
      [p.x+p.width,.133,.073], [p.x+p.lean*.35,.141,.081],
    ];
    for (const vertex of verts) points.push(...new THREE.Vector3(...vertex).applyMatrix4(intoHead).toArray());
    const [u0,v0,u1,v1]=p.uv;
    uvs.push((u0+u1)/2,v1,u0,(v0+v1)/2,(u0+u1)/2,v0,u1,(v0+v1)/2,(u0+u1)/2,(v0+v1)/2);
    indices.push(start,start+1,start+4,start+1,start+2,start+4,start+2,start+3,start+4,start+3,start,start+4);
  }
  const normals = new Float32Array(points.length);
  for (let i=0;i<indices.length;i+=3) {
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const va=new THREE.Vector3(...points.slice(a*3,a*3+3)),vb=new THREE.Vector3(...points.slice(b*3,b*3+3)),vc=new THREE.Vector3(...points.slice(c*3,c*3+3));
    const n=vb.sub(va).cross(vc.sub(va)).normalize();
    for(const j of [a,b,c]) for(let k=0;k<3;k++)normals[j*3+k]+=n.getComponent(k);
  }
  for(let i=0;i<normals.length;i+=3){const n=new THREE.Vector3(...normals.slice(i,i+3)).normalize();normals.set(n.toArray(),i);}
  const buffer = root.listBuffers()[0];
  const posAcc=doc.createAccessor('Orchid petal positions').setType(Accessor.Type.VEC3).setArray(Float32Array.from(points)).setBuffer(buffer);
  const normalAcc=doc.createAccessor('Orchid petal normals').setType(Accessor.Type.VEC3).setArray(normals).setBuffer(buffer);
  const uvAcc=doc.createAccessor('Orchid petal UVs').setType(Accessor.Type.VEC2).setArray(Float32Array.from(uvs)).setBuffer(buffer);
  const indexAcc=doc.createAccessor('Orchid petal triangles').setType(Accessor.Type.SCALAR).setArray(Uint16Array.from(indices)).setBuffer(buffer);
  const mat=doc.createMaterial('Orchid frill, native patterned skin').setBaseColorTexture(primitive.getMaterial().getBaseColorTexture()).setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(.82).setDoubleSided(true);
  const petalPrim=doc.createPrimitive().setAttribute('POSITION',posAcc).setAttribute('NORMAL',normalAcc).setAttribute('TEXCOORD_0',uvAcc).setIndices(indexAcc).setMaterial(mat);
  const mesh=doc.createMesh('Three orchid head petals').addPrimitive(petalPrim);
  head.addChild(doc.createNode('Orchid head frill').setMesh(mesh));
  const presenter=doc.createNode('OrchidPondlingPresentation').setScale([1.2,1.2,1.2]);
  for(const child of [...scene.listChildren()]){scene.removeChild(child);presenter.addChild(child);}scene.addChild(presenter);
  const attack=root.listAnimations().find(a=>a.getName()==='Attack');assert(attack);
  const attackTimes=doc.createAccessor('Pondling lunge time').setType(Accessor.Type.SCALAR).setArray(Float32Array.from([0,.12,.326,.5,.68])).setBuffer(buffer);
  const attackPosition=doc.createAccessor('Pondling lunge position').setType(Accessor.Type.VEC3).setArray(Float32Array.from([0,0,0,0,.008,0,0,.035,.066,0,.015,.05,0,0,0])).setBuffer(buffer);
  const attackSampler=doc.createAnimationSampler('Pondling lunge').setInput(attackTimes).setOutput(attackPosition);
  attack.addSampler(attackSampler).addChannel(doc.createAnimationChannel('Pondling lunge').setTargetNode(presenter).setTargetPath('translation').setSampler(attackSampler));
  const bytes=await io.writeBinary(doc),output='orchid-pondling-faeholme.glb',candidateFile=`${here}/${output}`;
  await writeFile(candidateFile,bytes);
  const check=await io.readBinary(bytes),checkRoot=check.getRoot(),checkPrim=checkRoot.listMeshes()[0].listPrimitives()[0];
  for(const [key,arr] of Object.entries(sourceAttrs))assert.deepEqual(Array.from(checkPrim.getAttribute(key).getArray()),arr,`Frog ${key} changed`);
  assert.equal(checkRoot.listSkins()[0].listJoints().length,53);
  assert.equal(checkRoot.listAnimations().length,8);
  const size={x:prior.size.x*1.2,y:.178*1.2,z:prior.size.z*1.2};
  const base={x:prior.base.x*1.2,y:prior.base.y*1.2,z:prior.base.z*1.2};
  const bounds={min:[base.x,base.y,base.z],max:[base.x+size.x,base.y+size.y,base.z+size.z]};
  const asset={...prior,file:`models/fairy-garden/${output}`,candidateFile:output,is:'Orchid Pondling',bytes:bytes.length,sha256:hash(bytes),size,base,bounds,groundY:0,
    materials:checkRoot.listMaterials().map(m=>m.getName()),impliedWalkMps:prior.impliedWalkMps*1.2,impliedRunMps:prior.impliedRunMps*1.2,measuredGait:null,
    attackSeconds:.68,contactNormalized:.48,
    sourceProvenance:{...prior.sourceProvenance,polishSourceFile:sourceFile,polishSourceSha256:hash(sourceBytes),polishBuilder:`${here}/build-candidates.mjs`,polishBuilderSha256:scriptSha,modifications:'Original image-generated layered frog skin and native 53-joint body retained. Three small textured orchid frills follow the native head bone; presentation size +20%; a 0.68 s forward lunge peaks at contact.'},
    metadata:{family:'fairy_frog',region:'faeholme',level:115,anatomy:'Frog body and native patterned skin with three small orchid head petals',desiredInGameHeightMeters:size.y},
    acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
  assets.push(asset);
  validation.push({id,sourceFile,sourceSha256:hash(sourceBytes),candidateFile,candidateSha256:hash(bytes),bytes:bytes.length,size,bounds,clips:checkRoot.listAnimations().map(a=>a.getName()),joints:53,sourceGeometryUvWeightsPreserved:true,petals:3,attackSeconds:.68,contactNormalized:.48,accepted:false});
}
const packs = staged.packs;
const promotion = { schema: 'corealm-creature-promotion/1', packs, assets, sourceRoot: here, destinationRoot: 'game/public/assets', apply: false, prerequisite: 'Root lab browser state, normal-camera screenshot and build review.' };
const lab = { schema: 'corealm-lab-asset-candidates/1', packs, assets: assets.map((a) => ({ ...a, candidateFile: path.resolve(here, a.candidateFile) })), files: Object.fromEntries(assets.map((a) => [a.id, path.resolve(here, a.candidateFile)])) };
await writeFile(`${here}/promotion.json`, `${JSON.stringify(promotion, null, 2)}\n`);
await writeFile(`${here}/lab-catalog.json`, `${JSON.stringify(lab, null, 2)}\n`);
await writeFile(`${here}/validation.json`, `${JSON.stringify({ builderSha256: scriptSha, results: validation }, null, 2)}\n`);
console.log(JSON.stringify(validation, null, 2));
