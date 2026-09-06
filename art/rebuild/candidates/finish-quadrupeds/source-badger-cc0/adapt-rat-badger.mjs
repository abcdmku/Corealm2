import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Vector3,Matrix4,Quaternion,Box3} from 'three';
import sharp from 'sharp';
import {loadNativeRatSource,RAT_SOURCE} from '../../../../../tools/creature-expansion/mammals/source-porcupine.mjs';
import {warpBadger,badgerCoat,BADGER_CC0_REFERENCE} from '../../../../../tools/creature-expansion/mammals/source-badger-cc0.mjs';
const dir=new URL('./',import.meta.url),src=new URL('../source-porcupine/',dir);await mkdir(dir,{recursive:true});
const {document:doc,bytes:sourceBytes,report:nativeReport}=await loadNativeRatSource();
const mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',src),'utf8'));
const root=doc.getRoot(),buffer=root.listBuffers()[0],io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS),hash=b=>createHash('sha256').update(b).digest('hex');
const accessor=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
const groups=(name,index)=>{const raw=mapping.objects[name].originalVertexWeights[index],sum=raw.reduce((s,[,w])=>s+w,0);return raw.map(([n,w])=>[n,w/sum]);};
function normals(pos,indices){const n=new Float32Array(pos.length),a=new Vector3(),b=new Vector3(),c=new Vector3();for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]];a.fromArray(pos,ids[0]*3);b.fromArray(pos,ids[1]*3).sub(a);c.fromArray(pos,ids[2]*3).sub(a);b.cross(c);for(const id of ids){n[id*3]+=b.x;n[id*3+1]+=b.y;n[id*3+2]+=b.z;}}for(let i=0;i<n.length;i+=3)a.fromArray(n,i).normalize().toArray(n,i);return n;}
const srgb=c=>Math.round(255*(c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055));
async function bakeCoat(name,p,original,ordinal){
 const uv=p.getAttribute('TEXCOORD_0'),N=768,pixels=new Uint8Array(N*N*3),covered=new Uint8Array(N*N),ids=p.getIndices().getArray();
 pixels.fill(65);
 for(let k=0;k<ids.length;k+=3){
  const t=Array.from(ids.subarray(k,k+3)),u=t.map(i=>{const a=[];uv.getElement(i,a);return [a[0]*(N-1),(1-a[1])*(N-1)];});
  const minX=Math.max(0,Math.floor(Math.min(...u.map(a=>a[0])))),maxX=Math.min(N-1,Math.ceil(Math.max(...u.map(a=>a[0])))),minY=Math.max(0,Math.floor(Math.min(...u.map(a=>a[1])))),maxY=Math.min(N-1,Math.ceil(Math.max(...u.map(a=>a[1]))));
  const den=(u[1][1]-u[2][1])*(u[0][0]-u[2][0])+(u[2][0]-u[1][0])*(u[0][1]-u[2][1]);if(Math.abs(den)<1e-8)continue;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const a=((u[1][1]-u[2][1])*(x-u[2][0])+(u[2][0]-u[1][0])*(y-u[2][1]))/den,b=((u[2][1]-u[0][1])*(x-u[2][0])+(u[0][0]-u[2][0])*(y-u[2][1]))/den,c=1-a-b;if(Math.min(a,b,c)<-.001)continue;
   const point=[0,1,2].map(j=>original[t[0]*3+j]*a+original[t[1]*3+j]*b+original[t[2]*3+j]*c),color=badgerCoat(point,name),i=y*N+x;pixels.set(color.map(srgb),i*3);covered[i]=1;
  }
 }
 // Expand texel colors into the empty UV margin to prevent dark mip seams.
 for(let pass=0;pass<5;pass++){const next=covered.slice();for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){const i=y*N+x;if(covered[i])continue;const j=[i-1,i+1,i-N,i+N].find(j=>covered[j]);if(j!==undefined){pixels.set(pixels.subarray(j*3,j*3+3),i*3);next[i]=1;}}covered.set(next);}
 const png=await sharp(pixels,{raw:{width:N,height:N,channels:3}}).png().toBuffer();await writeFile(new URL(`${name}-${ordinal}-authored-coat.png`,dir),png);
 return doc.createTexture(`${name}_authored_badger_coat_${ordinal}`).setImage(png).setMimeType('image/png');
}
const topology=[];let ordinal=0;
for(const node of root.listNodes())if(node.getMesh()){
 const name=node.getName();
 for(const p of node.getMesh().listPrimitives()){
  const pos=p.getAttribute('POSITION'),old=new Float32Array(pos.getArray()),arr=new Float32Array(old.length),ids=p.getIndices().getArray();
  for(let i=0;i<pos.getCount();i++){const v=Array.from(old.subarray(i*3,i*3+3)),w=groups(name,p.getExtras().sourceVertexIndices[i]);arr.set(warpBadger(v,name,w),i*3);}
  let degenerate=0,reversed=0,minAreaRatio=Infinity;for(let i=0;i<ids.length;i+=3){const [a,b,c]=Array.from(ids.subarray(i,i+3)),normal=data=>new Vector3().fromArray(data,b*3).sub(new Vector3().fromArray(data,a*3)).cross(new Vector3().fromArray(data,c*3).sub(new Vector3().fromArray(data,a*3))),n=normal(old),m=normal(arr);if(m.lengthSq()<1e-18)degenerate++;if(n.dot(m)<0)reversed++;if(n.lengthSq()>1e-18)minAreaRatio=Math.min(minAreaRatio,m.length()/n.length());}
  topology.push({mesh:name,primitive:ordinal,triangles:ids.length/3,degenerate,normalDirectionReversals:reversed,minAreaRatio});
  pos.setArray(arr);p.setAttribute('NORMAL',accessor(name+'_badger_normals','VEC3',normals(arr,ids)));p.setAttribute('COLOR_0',null);p.setAttribute('TANGENT',null);
  const material=doc.createMaterial(name+'_authored_badger_coat').setMetallicFactor(0).setRoughnessFactor(name==='Eyes'?.25:name==='Teeth'?.58:.93);
  if(name==='Eyes'||name==='Teeth')material.setBaseColorFactor([...badgerCoat([0,0,0],name),1]);else material.setBaseColorTexture(await bakeCoat(name,p,old,ordinal));
  p.setMaterial(material);ordinal++;
 }
}
const jointSource=new Map(mapping.joints.map(j=>[j.name,j.sourceBone])),correctives=new Map(mapping.correctives.map(c=>[c.name,c]));
// Retarget all original flat joint pivots to the same whole-body warp.
for(const skin of root.listSkins()){
 const binds=skin.getInverseBindMatrices();for(const [i,joint] of skin.listJoints().entries()){
  if(correctives.has(joint.getName()))continue;const a=[];binds.getElement(i,a);const rest=new Matrix4().fromArray(a).invert(),v=new Vector3().setFromMatrixPosition(rest);rest.setPosition(new Vector3(...warpBadger(v.toArray(),'Body',[[jointSource.get(joint.getName())||joint.getName(),1]])));binds.setElement(i,rest.invert().toArray());
 }
}
for(const node of root.listNodes())if(jointSource.has(node.getName()))node.setTranslation(warpBadger(node.getTranslation(),'Body',[[jointSource.get(node.getName()),1]]));
function quaternionAt(channel,time){if(!channel)return new Quaternion();const sampler=channel.getSampler(),input=sampler.getInput(),out=sampler.getOutput();let a=0,b=input.getCount()-1;while(a<b){const k=Math.ceil((a+b)/2);if(input.getScalar(k)<=time)a=k;else b=k-1;}const next=Math.min(a+1,input.getCount()-1),u=[],v=[];out.getElement(a,u);out.getElement(next,v);const dt=input.getScalar(next)-input.getScalar(a);return new Quaternion(...u).slerp(new Quaternion(...v),dt?Math.max(0,Math.min(1,(time-input.getScalar(a))/dt)):0);}
for(const clip of root.listAnimations())for(const channel of clip.listChannels()){
 if(channel.getTargetPath()!=='translation')continue;const node=channel.getTargetNode(),name=node.getName(),corrective=correctives.get(name);if(!corrective&&!jointSource.has(name))continue;
 const out=channel.getSampler().getOutput(),arr=new Float32Array(out.getArray());
 for(let i=0;i<out.getCount();i++){
  const v=Array.from(arr.subarray(i*3,i*3+3));let result;
  if(corrective){const p=mapping.objects[corrective.object].sourceWorldPositions[corrective.vertex],w=groups(corrective.object,corrective.vertex),q=quaternionAt(clip.listChannels().find(c=>c.getTargetNode()===node&&c.getTargetPath()==='rotation'),channel.getSampler().getInput().getScalar(i)),posed=new Vector3(...p).applyQuaternion(q).add(new Vector3(...v));result=new Vector3(...warpBadger(posed.toArray(),corrective.object,w)).sub(new Vector3(...warpBadger(p,corrective.object,w)).applyQuaternion(q)).toArray();}
  else result=warpBadger(v,'Body',[[jointSource.get(name),1]]);
  if(!result.every(Number.isFinite))throw Error('Nonfinite species translation');arr.set(result,i*3);
 }
 channel.getSampler().setOutput(accessor(name+'_badger_translation','VEC3',arr));
}
function bounds(){const box=new Box3();for(const node of root.listNodes())if(node.getMesh()){
 const skin=node.getSkin(),matrices=skin?.listJoints().map((j,i)=>{const a=[];skin.getInverseBindMatrices().getElement(i,a);return new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(a));});
 for(const p of node.getMesh().listPrimitives()){const pos=p.getAttribute('POSITION'),j=p.getAttribute('JOINTS_0'),w=p.getAttribute('WEIGHTS_0');for(let i=0;i<pos.getCount();i++){const v=[],js=[],ws=[];pos.getElement(i,v);const point=new Vector3();if(skin){j.getElement(i,js);w.getElement(i,ws);for(let k=0;k<4;k++)if(ws[k])point.addScaledVector(new Vector3(...v).applyMatrix4(matrices[js[k]]),ws[k]);}else point.fromArray(v).applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));if(!point.toArray().every(Number.isFinite))throw Error('Nonfinite skinned rest');box.expandByPoint(point);}}
 }return box;}
const rawOutput=await io.writeBinary(doc);await writeFile(new URL('cdmir-badger-adapted.glb',dir),rawOutput);
const before=bounds(),scale=.35/before.getSize(new Vector3()).y,centre=before.getCenter(new Vector3()),translation=[-centre.x*scale,-before.min.y*scale,-centre.z*scale];
for(const scene of root.listScenes()){const wrapper=doc.createNode('Badger_CC0_grounded_preview').setScale([scale,scale,scale]).setTranslation(translation);for(const child of [...scene.listChildren()]){scene.removeChild(child);wrapper.addChild(child);}scene.addChild(wrapper);}
const after=bounds(),size=after.getSize(new Vector3()),output=await io.writeBinary(doc);await writeFile(new URL('cdmir-badger-normalized.glb',dir),output);
const report={sourceOriginalSha256:RAT_SOURCE.originalSha256,nativeSha256:hash(sourceBytes),normalizedSha256:hash(output),rawAdaptedSha256:hash(rawOutput),bytes:output.length,reference:BADGER_CC0_REFERENCE,nativeClipNames:root.listAnimations().map(a=>a.getName()),sourceAuditMaximumNormalizedMm:nativeReport.finalByteMaximumNormalizedMm,topology,previewTransform:{scale,translation},scope:'Whole original rat mesh resculpt into Badger, with new authored coat. Original topology, skin weights, native clip names/timing retained; all joint pivots/translations retargeted. No unverified Badger source used.',limits:['CPU candidate; species silhouette, facial seams, paws, tail and motion contact require hardware review.','Source digit counts retained; no claim of anatomically verified five-toe Badger paws.','Rat source Idle.000 remains excluded for original B-bone discontinuities; original blend preserves all14 actions.','New coat is position-baked using original UVs, with smooth normals recomputed; no borrowed or generated-image textures.']};
await writeFile(new URL('badger-adaptation.json',dir),JSON.stringify(report,null,2)+'\n');await copyFile(new URL('CC0-1.0.txt',src),new URL('CC0-1.0.txt',dir));
const id='creature_rootdelve_badger',pack='cdmir-cc0-wholebody-badger-adaptation';
const asset={id,file:`models/creature/${id}.glb`,pack,category:'character',is:'Badger candidate adapted from complete CDmir/TinyWorlds CC0 rat mesh; authored body and coat; pending hardware species review',tags:['badger','cc0-rat-wholebody-adaptation','native-animation','candidate'],bytes:output.length,sha256:hash(output),size:{x:size.x,y:size.y,z:size.z},base:{x:after.min.x,y:after.min.y,z:after.min.z},bounds:{min:after.min.toArray(),max:after.max.toArray()},groundY:after.min.y,triangles:topology.reduce((s,t)=>s+t.triangles,0),animations:report.nativeClipNames,materials:root.listMaterials().map(m=>m.getName()),sourceProvenance:report,acceptance:{sourceMeasured:true,labAccepted:false,worldIntegrated:false}};
await writeFile(new URL('candidate-catalogue.json',dir),JSON.stringify({schema:1,assets:[asset],packs:[{id:pack,name:'CC0 complete-source Badger adaptation',author:'CDmir; TinyWorlds; Corealm adaptation',source:RAT_SOURCE.url,license:'CC0-1.0'}],files:{[id]:'cdmir-badger-normalized.glb'},previewTransform:report.previewTransform,limits:report.limits},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(output),bytes:output.length,bounds:asset.bounds,topology,clips:report.nativeClipNames}));
