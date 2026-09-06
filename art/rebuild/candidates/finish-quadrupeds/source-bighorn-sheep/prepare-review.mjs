import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ? path.resolve(packageRoot, process.argv[2]) : packageRoot, io = new NodeIO();
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const report = JSON.parse(await fs.readFile(path.join(root, 'adaptation-report.json')));
const doc = await io.read(path.join(root, 'bighorn-rest-review.glb'));
const model = doc.getRoot(), min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
assert.equal(model.listAnimations().length, 0);
assert.equal(model.listSkins().length, 0);
const animated=await io.read(path.join(root,'bighorn-source-adaptation.glb'));
assert.equal(animated.getRoot().listSkins()[0].listJoints().length,22);
for(const node of animated.getRoot().listNodes()) if(node.getMesh()) {
  assert.ok(node.getSkin(),`Unskinned animated source mesh ${node.getName()}`);
  for(const primitive of node.getMesh().listPrimitives()) {
    const weights=primitive.getAttribute('WEIGHTS_0');assert.ok(weights);
    for(let i=0;i<weights.getCount();i++)assert.ok(Math.abs(weights.getElement(i,[]).reduce((a,b)=>a+b,0)-1)<.002);
  }
}
let triangles = 0, vertices = 0;
for (const node of model.listNodes()) if (node.getMesh()) {
  const matrix = node.getWorldMatrix();
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    vertices += positions.getCount(); triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
    // Exporter duplicates the coat layer as COLOR_1. COLOR_0 is the same
    // authored regional tint; retain one standards-supported color channel.
    primitive.setAttribute('COLOR_1', null);
    for (let i=0;i<positions.getCount();i++) {
      const v=positions.getElement(i,[]);
      assert.ok(v.every(Number.isFinite));
      for(let k=0;k<3;k++) {
        const p=matrix[k]*v[0]+matrix[4+k]*v[1]+matrix[8+k]*v[2]+matrix[12+k];
        min[k]=Math.min(min[k],p);max[k]=Math.max(max[k],p);
      }
    }
    if(node.getName().includes('whole_body')) {
      assert.ok(primitive.getAttribute('COLOR_0'));assert.ok(primitive.getAttribute('TEXCOORD_0'));
      assert.ok(primitive.getMaterial().getBaseColorTexture()?.getImage()?.length);
    }
  }
}
const relativeFile='models/creature/creature_cairn_bighorn.glb';
const scene=model.getDefaultScene()??model.listScenes()[0];
const groundWrapper=doc.createNode('Bighorn_rest_ground_alignment').setTranslation([0,-min[1],0]);
for(const node of [...scene.listChildren()]){scene.removeChild(node);groundWrapper.addChild(node);}
scene.addChild(groundWrapper);max[1]-=min[1];min[1]=0;
await fs.mkdir(path.join(root,'models/creature'),{recursive:true});
await io.write(path.join(root,relativeFile),doc);
const bytes=await fs.readFile(path.join(root,relativeFile));
const provenance={author:'p0ss',texturePhotographer:'titus tscharntke',adaptationAuthor:'Corealm',
 license:'CC-BY-SA-3.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/',
 source:'https://opengameart.org/content/sheep-rigged-textured-and-animated',
 textureSource:'https://opengameart.org/content/woodland-animals-texture-pack',
 originalSha256:report.sourceSha256,derivativeLicense:'CC-BY-SA-3.0',
 attribution:'Sheep by p0ss; source boar texture photograph by titus tscharntke. Bighorn adaptation by Corealm. Licensed CC BY-SA 3.0.',
 changes:[report.sourceTopologyRetained?'Whole original Sheep 2 topology and UV retained; regional body/head/neck proportions changed':report.topologyChanges,
 'Bone rest landmarks follow whole-body deformation; original 22 bone names retained',
 'Continuous tapered keratin horns bound to original HEAD bone',
 'Regional gray-brown, pale-rump/muzzle and dark-hoof coat colors',
 'One interpolating subdivision; uniform scale and ground/heading alignment']};
const asset={id:'creature_cairn_bighorn',file:relativeFile,pack:'p0ss-sheep2-bighorn-candidate',category:'character',
 is:'Whole Sheep 2 body Bighorn adaptation — rest anatomy review only',tags:['bighorn','whole-source-adaptation','rest-review'],
 bytes:bytes.length,sha256:hash(bytes),triangles,vertices,animations:[],bones:0,sourceBones:22,static:true,accepted:false,
 size:Object.fromEntries(['x','y','z'].map((a,k)=>[a,max[k]-min[k]])),
 base:Object.fromEntries(['x','y','z'].map((a,k)=>[a,min[k]])),bounds:{min,max},groundY:min[1],sourceProvenance:provenance};
await fs.writeFile(path.join(root,'review-catalogue.json'),JSON.stringify({schema:1,scope:'Rest anatomy review. Source motions fail contact; no production acceptance.',assets:[asset]},null,2)+'\n');
await fs.writeFile(path.join(root,'asset-ledger.json'),JSON.stringify({schema:1,sourceProvenance:provenance,
 sourceFiles:[{path:root===packageRoot?'../source-caprine-free/sheepies.blend':'../../source-caprine-free/sheepies.blend',sha256:report.sourceSha256,readOnly:true}],
 derivatives:await Promise.all([root===packageRoot?'adapt.py':`../adapt-${path.basename(root)}.py`,'bighorn-source-adaptation.blend','bighorn-source-adaptation.glb','bighorn-rest-review.glb','source-diffuse.png',...(report.sourceTopologyRetained?[]:['source-vertex-nearest-map.json']),relativeFile].map(async file=>({file,sha256:hash(await fs.readFile(path.join(root,file))),license:'CC-BY-SA-3.0'}))),
 runtimeStatus:{accepted:false,missingProductionRoles:report.missingProductionRoles,sourceMotionContactPassed:false}},null,2)+'\n');
console.log(JSON.stringify({file:relativeFile,triangles,vertices,bones:22,bounds:{min,max},sha256:asset.sha256,accepted:false}));
