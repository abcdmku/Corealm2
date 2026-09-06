import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Box3,Vector3,Matrix4} from 'three';

const directory=new URL('./',import.meta.url),io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(new URL('cdmir-source-preview.glb',directory)),doc=await io.readBinary(raw),root=doc.getRoot();
function geometryHash(){const h=createHash('sha256');for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives())for(const a of [p.getIndices(),...p.listAttributes()]){if(a){const arr=a.getArray();h.update(Buffer.from(arr.buffer,arr.byteOffset,arr.byteLength));}}return h.digest('hex');}
function drawnBounds(){
  const box=new Box3(),perMesh=[];
  for(const node of root.listNodes()){
    if(!node.getMesh())continue;
    const localBox=new Box3(),skin=node.getSkin(),jointMatrices=skin?.listJoints().map((joint,i)=>{
      const values=[];skin.getInverseBindMatrices().getElement(i,values);
      return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(values));
    });
    for(const primitive of node.getMesh().listPrimitives()){
      const pos=primitive.getAttribute('POSITION'),weights=primitive.getAttribute('WEIGHTS_0'),joints=primitive.getAttribute('JOINTS_0');
      for(let i=0;i<pos.getCount();i++){
        const p=[],w=[],j=[];pos.getElement(i,p);let point;
        if(skin&&weights&&joints){weights.getElement(i,w);joints.getElement(i,j);point=new Vector3();for(let k=0;k<w.length;k++)if(w[k])point.addScaledVector(new Vector3(...p).applyMatrix4(jointMatrices[j[k]]),w[k]);}
        else point=new Vector3(...p).applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
        if(!point.toArray().every(Number.isFinite))throw Error('Nonfinite source geometry');
        box.expandByPoint(point);localBox.expandByPoint(point);
      }
    }
    perMesh.push({name:node.getName(),min:localBox.min.toArray(),max:localBox.max.toArray()});
  }
  return {box,perMesh};
}
const before=drawnBounds(),beforeGeometry=geometryHash(),beforeSize=before.box.getSize(new Vector3()),centre=before.box.getCenter(new Vector3());
// Source units are unspecified. This is an authored preview scale only, with
// total drawn height0.34m. No claim of a measured real animal dimension.
const scale=.34/beforeSize.y,translation=[-centre.x*scale,-before.box.min.y*scale,-centre.z*scale];
for(const scene of root.listScenes()){
  const children=[...scene.listChildren()],wrapper=doc.createNode('Original_rat_source_preview_wrapper').setScale([scale,scale,scale]).setTranslation(translation);
  for(const child of children){scene.removeChild(child);wrapper.addChild(child);}scene.addChild(wrapper);
}
const after=drawnBounds(),size=after.box.getSize(new Vector3());
if(beforeGeometry!==geometryHash())throw Error('Wrapper changed source geometry');
const file='cdmir-rat-preview-normalized.glb',bytes=await io.writeBinary(doc);await writeFile(new URL(file,directory),bytes);
const record=JSON.parse(await readFile(new URL('cdmir-source-record.json',directory),'utf8'));
const pack='cdmir-cc0-rat-source-evaluation',id='creature_quillback_porcupine';
const asset={id,file:'models/creature/creature_quillback_porcupine.glb',pack,category:'character',is:'original complete rat body by CDmir and TinyWorlds, source evaluation only; NOT a porcupine',tags:['rat','rodent','original-source','whole-body-evaluation','not-porcupine','static-preview'],bytes:bytes.length,sha256:hash(bytes),size:{x:size.x,y:size.y,z:size.z},base:{x:after.box.min.x,y:after.box.min.y,z:after.box.min.z},bounds:{min:after.box.min.toArray(),max:after.box.max.toArray()},groundY:after.box.min.y,triangles:root.listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),animations:[],materials:root.listMaterials().map(m=>m.getName()),sourceProvenance:{author:'CDmir; TinyWorlds',source:record.sourcePage,download:record.directDownload,license:'CC0-1.0',licenseUrl:record.licenseUrl,originalSpecies:'rat',sourceFile:record.file,sourceSha256:record.sha256,rawPreviewSha256:hash(raw),sourceNativeActions:record.nativeActions,adaptationPerformed:false},acceptance:{sourceMeasured:true,labAccepted:false,worldIntegrated:false}};
const report={schema:1,scope:'Original rat source preview using the porcupine asset interception slot. No species adaptation, native animation export or gameplay acceptance.',assets:[asset],packs:[{id:pack,name:'CDmir and TinyWorlds original rat source evaluation',author:'CDmir; TinyWorlds',source:record.sourcePage,license:'CC0-1.0'}],files:{[id]:file},previewTransform:{scale,translation,rotation:'identity: stock Blender glTF export already maps the source nose toward +Z',targetHeight:.34,units:'Authored preview scale, not measured zoological dimensions.',rawBounds:{min:before.box.min.toArray(),max:before.box.max.toArray()},geometryAndWeightsSha256:beforeGeometry,geometryAndWeightsUnchanged:true},floorAndAxisLimits:['Ground offset places the lowest drawn rest vertex at y=0; this does not prove all paws planted or motion contact.','No animation clips exported. Gallery Walk/Run/Attack cannot demonstrate native movement.','Long original rat tail remains and contributes to centering and bounds.','Original Hair object omitted by stock export; source exporter flagged invalid Rat mesh and reduced vertices with more than4 influences.','Materials approximate original packed albedo and normals; AO and legacy vertex colors are not translated.','This preview is the original rat body. Porcupine anatomy, tail and quills remain unauthored.'],perMeshDrawnBounds:after.perMesh};
await writeFile(new URL('candidate-catalogue.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({catalogue:new URL('candidate-catalogue.json',directory).pathname,asset,previewTransform:report.previewTransform}));
