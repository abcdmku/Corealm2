/** Staged shortcut arrangements derived from the project's licensed DEXSOFT rock. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Document,NodeIO,type Mesh} from '@gltf-transform/core';
import {copyToDocument} from '@gltf-transform/functions';
import {Box3,Matrix4,Quaternion,Vector3} from 'three';
const sourcePath='game/public/assets/models/magic/rocks_free_essence_node.glb';
const quiet=process.argv.includes('--quiet');
const out=`art/rebuild/candidates/finish-structures/source-outcrops${quiet?'-quiet':''}`;
const mutedPath='tools/data/ground-ore-muted-albedo.png';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=await readFile(sourcePath),sourceSha256=hash(sourceBytes);
if(sourceSha256!=='c1c3c2af9eaed4027d80c84ed64422c9fb261eabc8bc275334a6a834fb541a1d')throw new Error('DEXSOFT source bytes changed');
const io=new NodeIO(),source=await io.readBinary(sourceBytes);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const sourceEntry=manifest.assets.find((entry:any)=>entry.id==='rocks_free_essence_node');
const pack={id:'corealm-dexsoft-shortcut-outcrops',name:'Corealm shortcut rock arrangements',author:'Corealm; source rock geometry and maps by DEXSOFT',source:'tools/build-shortcut-outcrops.ts',license:'Derivative arrangement of the project’s DEXSOFT Rocks FREE pack geometry and material maps, under the existing Standard Unity Asset Store EULA. Corealm authored the placement, scale and composition.'};
type Part={position:[number,number,number];scale:[number,number,number];yaw:number};
const specs=[
 {id:'corealm_sunder_ledge',legacy:'cliff_step_2',parts:[
  {position:[-1.75,0,.05],scale:[1,.90,1.10],yaw:.25},
  {position:[1.80,0,-.35],scale:[.83,.74,1.03],yaw:2.65},
 ]},
 {id:'corealm_scree_slide',legacy:'cliff_step_3',parts:[
  {position:[-.30,0,-1.55],scale:[.77,1,.70],yaw:.10},
  {position:[.18,0,.15],scale:[.95,.64,.75],yaw:2.3},
  {position:[-.22,0,1.80],scale:[1,.30,.62],yaw:-.8},
 ]},
] satisfies {id:string;legacy:string;parts:Part[]}[];
const sourceBounds=new Box3();
for(const node of source.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
 const matrix=new Matrix4().fromArray(node.getWorldMatrix()),p=primitive.getAttribute('POSITION')!;
 for(let i=0;i<p.getCount();i++)sourceBounds.expandByPoint(new Vector3().fromArray(p.getElement(i,[])).applyMatrix4(matrix));
}
const centre=sourceBounds.getCenter(new Vector3());centre.y=sourceBounds.min.y;
const entries=[];
await mkdir(`${out}/models`,{recursive:true});
for(const spec of specs){
 const legacy=manifest.assets.find((entry:any)=>entry.id===spec.legacy),document=new Document();
 const scene=document.createScene(spec.id),assembly=document.createNode(spec.id);scene.addChild(assembly);document.getRoot().setDefaultScene(scene);
 const copies=copyToDocument(document,source,source.getRoot().listMeshes());
 if(quiet){
  const albedo=document.createTexture('Corealm muted source stone').setImage(await readFile(mutedPath)).setMimeType('image/png');
  for(const material of document.getRoot().listMaterials()){
   material.setName('Corealm quiet DEXSOFT outcrop').setBaseColorTexture(albedo).setMetallicFactor(0).setRoughnessFactor(.92).setNormalScale(.16);
   material.getBaseColorTextureInfo()!.setTexCoord(2);
  }
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
   const original=primitive.getAttribute('TEXCOORD_0')!,values:number[]=[];
   for(let i=0;i<original.getCount();i++){const uv=original.getElement(i,[]);values.push(.34+uv[0]!*.1,.32+uv[1]!*.1);}
   // Original UVs still drive every source detail map. A second channel samples the same
   // accepted quiet interior rectangle used by ground ore, without changing atlas islands.
   primitive.setAttribute('TEXCOORD_2',document.createAccessor('quiet-albedo-uv').setType('VEC2').setArray(new Float32Array(values)).setBuffer(document.getRoot().listBuffers()[0]!));
  }
 }
 const bounds=new Box3();let triangles=0;
 for(const [index,part]of spec.parts.entries()){
  const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),part.yaw);
  const placement=new Matrix4().compose(new Vector3(...part.position),rotation,new Vector3(...part.scale))
   .multiply(new Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z));
  for(const node of source.getRoot().listNodes()){
   const mesh=node.getMesh();if(!mesh)continue;
   const matrix=placement.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()));
   assembly.addChild(document.createNode(`${spec.id}_rock_${index}`).setMesh(copies.get(mesh)! as Mesh).setMatrix(matrix.toArray()));
   for(const primitive of mesh.listPrimitives()){
    const p=primitive.getAttribute('POSITION')!;triangles+=(primitive.getIndices()?.getCount()??p.getCount())/3;
    for(let i=0;i<p.getCount();i++)bounds.expandByPoint(new Vector3().fromArray(p.getElement(i,[])).applyMatrix4(matrix));
   }
  }
 }
 // Fit the entire coherent arrangement once. Individual source vertices, UVs, normals,
 // tangents, indices and material maps remain unchanged under node transforms.
 const fit=new Vector3(legacy.size.x,legacy.size.y,legacy.size.z).divide(bounds.getSize(new Vector3()));
 const position=new Vector3(legacy.base.x,legacy.base.y,legacy.base.z).sub(bounds.min.clone().multiply(fit));
 assembly.setScale(fit.toArray()).setTranslation(position.toArray());
 const bytes=await io.writeBinary(document),file=`models/${spec.id}.glb`;
 await writeFile(`${out}/${file}`,bytes);
 entries.push({id:spec.id,file,pack:pack.id,category:'rock',is:'cliff',tags:['cliff','rock','source-derived','shortcut'],size:legacy.size,base:legacy.base,animations:[],materials:document.getRoot().listMaterials().map(material=>material.getName()),bytes:bytes.byteLength,sha256:hash(bytes),triangles,
  placement:{replacesAssetId:spec.legacy,translation:[legacy.base.x+legacy.size.x/2,legacy.base.y,legacy.base.z+legacy.size.z/2]},
  source:{assetId:sourceEntry.id,file:sourcePath,sha256:sourceSha256,pack:sourceEntry.pack},parts:spec.parts});
}
const generator='tools/build-shortcut-outcrops.ts';
await writeFile(`${out}/shortcut-outcrops.json`,JSON.stringify({generator,generatorSha256:hash(await readFile(generator)),pack,source:{path:sourcePath,sha256:sourceSha256},material:quiet?{kind:'quiet',albedo:mutedPath,albedoSha256:hash(await readFile(mutedPath)),provenance:'tools/data/ground-ore-muted-albedo.json',normalScale:.16,originalUV:'TEXCOORD_0',albedoUV:'TEXCOORD_2'}:{kind:'source'},assets:entries,visualAccepted:false},null,2)+'\n');
console.log(JSON.stringify({out,sourceSha256,assets:entries.map(({id,sha256,triangles})=>({id,sha256,triangles}))}));

