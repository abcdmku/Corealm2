import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Vector3,Matrix4,Quaternion} from 'three';
import {adaptSourcePoint,coatDescriptor,canonical,seededRandom,PORCUPINE_REFERENCE} from './porcupine-surface.mjs';
const dir=new URL('./',import.meta.url),io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const input=process.argv[2]||'cdmir-rat-native.glb';
const mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8'));
const nativeReport=JSON.parse(await readFile(new URL('native-export-report.json',dir),'utf8'));
if(nativeReport.releaseReady!==true)throw Error('Native rat final-byte motion audit has not passed');
const bytes=await readFile(new URL(input,dir));
if(createHash('sha256').update(bytes).digest('hex')!==nativeReport.sha256||mapping.sourceSha256!==nativeReport.sourceSha256||nativeReport.sourceSha256!=='52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2')throw Error('Native source or mapping identity differs from passed audit');
const doc=await io.readBinary(bytes),root=doc.getRoot(),buffer=root.listBuffers()[0];
const hash=b=>createHash('sha256').update(b).digest('hex');
const accessor=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
const random=seededRandom(),quills={positions:[],normals:[],colors:[],joints:[],weights:[],indices:[],roots:[]};
let quillCount=0;
function vertexNormals(pos,indices){
 const n=new Float32Array(pos.length),a=new Vector3(),b=new Vector3(),c=new Vector3();
 for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]];a.fromArray(pos,ids[0]*3);b.fromArray(pos,ids[1]*3);c.fromArray(pos,ids[2]*3);b.sub(a);c.sub(a);b.cross(c);for(const id of ids){n[id*3]+=b.x;n[id*3+1]+=b.y;n[id*3+2]+=b.z;}}
 for(let i=0;i<n.length;i+=3){a.fromArray(n,i).normalize().toArray(n,i);}return n;
}
function addQuill(p,n,j,w,descriptor,rootIndex){
 const axis=new Vector3(...descriptor.direction).normalize(),side=new Vector3(1,0,0);if(Math.abs(axis.x)>.85)side.set(0,1,0);side.cross(axis).normalize();const other=axis.clone().cross(side).normalize();
 const start=new Vector3(...p).addScaledVector(new Vector3(...n),-.010),base=quills.positions.length/3;
 const rings=descriptor.banded?[0,.36,.66,.89,1]:[0,.7,1],sides=3;
 for(let r=0;r<rings.length;r++){const t=rings[r],radius=descriptor.radius*(1-t)*(.85+Math.sin(t*Math.PI)*.30),centre=start.clone().addScaledVector(axis,descriptor.length*t);for(let k=0;k<sides;k++){
 const angle=k*Math.PI*2/sides,radial=side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(other,Math.sin(angle));const v=centre.clone().addScaledVector(radial,radius);quills.positions.push(...v.toArray());quills.roots.push(rootIndex);quills.normals.push(...radial.toArray());
 const pale=descriptor.banded&&(r===1||r===3),color=pale?[.68,.61,.46]:[.035,.029,.023];quills.colors.push(...color);quills.joints.push(...j);quills.weights.push(...w);
 if(r<rings.length-1){const a=base+r*sides+k,b=base+r*sides+(k+1)%sides,c=a+sides,d=b+sides;quills.indices.push(a,b,c);if(r<rings.length-2)quills.indices.push(b,d,c);}
 }}quillCount++;
}
let bodyNode;
for(const node of root.listNodes()){
 const mesh=node.getMesh();if(!mesh)continue;const name=node.getName()||mesh.getName();if(name==='Body')bodyNode=node;
 const jointNames=node.getSkin()?.listJoints().map(j=>j.getName())||[];
 for(const prim of mesh.listPrimitives()){
 const positions=prim.getAttribute('POSITION'),skinJ=prim.getAttribute('JOINTS_0'),skinW=prim.getAttribute('WEIGHTS_0'),source=positions.getArray(),arr=new Float32Array(source.length),colors=new Float32Array(positions.getCount()*3);
 for(let i=0;i<positions.getCount();i++){
 const p=[],j=[],w=[];positions.getElement(i,p);skinJ?.getElement(i,j);skinW?.getElement(i,w);
 const sourceIndex=prim.getExtras().sourceVertexIndices?.[i];
 const original=mapping.objects[name]?.originalVertexWeights[sourceIndex];
 if(!original)throw Error('Missing source correspondence for '+name+' vertex '+i);
 const sum=original.reduce((s,[,w])=>s+w,0),groups=original.map(([n,w])=>[n,w/sum]);
 const v=adaptSourcePoint(p,name,groups);arr.set(v,i*3);
 const c=canonical(v),foot=c.y<.20,ear=name==='Head'&&c.y>.76&&Math.abs(c.x)>.17;colors.set(foot?[.25,.23,.20]:ear?[.40,.34,.28]:[1,1,1],i*3);
 }
 positions.setArray(arr);prim.setAttribute('COLOR_0',accessor(name+'_coat_tint','VEC3',colors));
 const idx=prim.getIndices()?.getArray()||Uint32Array.from({length:positions.getCount()},(_,i)=>i),normals=vertexNormals(arr,idx);prim.setAttribute('NORMAL',accessor(name+'_adapted_normal','VEC3',normals));
 if(name==='Body')for(let i=0;i<positions.getCount();i++){
 const p=Array.from(arr.subarray(i*3,i*3+3)),n=Array.from(normals.subarray(i*3,i*3+3)),j=[],w=[];skinJ.getElement(i,j);skinW.getElement(i,w);
 const rootSourceIndex=prim.getExtras().sourceVertexIndices[i],rootGroups=mapping.objects.Body.originalVertexWeights[rootSourceIndex],rootSum=rootGroups.reduce((s,[,w])=>s+w,0);
 const limbWeight=rootGroups.filter(([n])=>n.includes('Leg')).reduce((s,[,w])=>s+w,0)/rootSum;
 if(limbWeight>.35)continue;
 const descriptor=coatDescriptor(p,n,random);if(!descriptor)continue;
 // Every root inherits one real source vertex's complete four-weight solution.
 // No unmeasured truncation of barycentrically blended influences is introduced.
 addQuill(p,n,j,w,descriptor,prim.getExtras().sourceVertexIndices[i]);
 for(let guard=0;guard<4;guard++){
 const direction=new Vector3(...descriptor.direction).add(new Vector3((random()-.5)*.65,(random()-.5)*.48,(random()-.5)*.48)).normalize().toArray();
 const shorter={...descriptor,direction,length:descriptor.length*(.32+random()*.63),radius:descriptor.radius*(.42+random()*.30),banded:guard===0};addQuill(p,n,j,w,shorter,prim.getExtras().sourceVertexIndices[i]);
 }
 }
 }
 if(name==='Eyes')for(const prim of mesh.listPrimitives())prim.setMaterial(doc.createMaterial('Porcupine_dark_eyes').setBaseColorFactor([.023,.016,.010,1]).setRoughnessFactor(.24));
}
if(!bodyNode)throw Error('Native Body mesh missing; source adapter requires the verified complete source.');
const coat=doc.createMaterial('Porcupine_banded_quills').setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(.83);
const primitive=doc.createPrimitive().setExtras({sourceRootVertices:quills.roots}).setAttribute('POSITION',accessor('quill_positions','VEC3',new Float32Array(quills.positions))).setAttribute('NORMAL',accessor('quill_normals','VEC3',new Float32Array(quills.normals))).setAttribute('COLOR_0',accessor('quill_bands','VEC3',new Float32Array(quills.colors))).setAttribute('JOINTS_0',accessor('quill_joints','VEC4',new Uint16Array(quills.joints))).setAttribute('WEIGHTS_0',accessor('quill_weights','VEC4',new Float32Array(quills.weights))).setIndices(accessor('quill_indices','SCALAR',new Uint32Array(quills.indices))).setMaterial(coat);
bodyNode.getMesh().addPrimitive(primitive);
// Reposition short-tail pivots and bake their native translation paths into the
// same species proportions. Keep rotations, timing and exact native clip names.
const tailNodes=new Set(root.listNodes().filter(n=>n.getName().startsWith('Tail')));
for(const skin of root.listSkins()){
 const binds=skin.getInverseBindMatrices();
 for(const [index,joint] of skin.listJoints().entries())if(tailNodes.has(joint)){
  const a=[];binds.getElement(index,a);const rest=new Matrix4().fromArray(a).invert(),p=new Vector3().setFromMatrixPosition(rest);
  rest.setPosition(new Vector3(...adaptSourcePoint(p.toArray(),'Body',[['Tail',1]])));
  binds.setElement(index,rest.invert().toArray());
 }
}
for(const node of tailNodes)node.setTranslation(adaptSourcePoint(node.getTranslation(),'Body',[['Tail',1]]));
function sampleQuaternion(channel,time){
 if(!channel)return new Quaternion();const sampler=channel.getSampler(),input=sampler.getInput(),output=sampler.getOutput();let lo=0,hi=input.getCount()-1;
 while(lo<hi){const m=Math.ceil((lo+hi)/2);if(input.getScalar(m)<=time)lo=m;else hi=m-1;}
 const next=Math.min(lo+1,input.getCount()-1),a=[],b=[];output.getElement(lo,a);output.getElement(next,b);const dt=input.getScalar(next)-input.getScalar(lo),t=dt>0?Math.max(0,Math.min(1,(time-input.getScalar(lo))/dt)):0;return new Quaternion(...a).slerp(new Quaternion(...b),t);
}
const correctiveMap=new Map(mapping.correctives.map(c=>[c.name,c]));
for(const animation of root.listAnimations())for(const channel of animation.listChannels()){
 if(channel.getTargetPath()!=='translation')continue;
 const node=channel.getTargetNode(),out=channel.getSampler().getOutput(),corrective=correctiveMap.get(node.getName());
 if(!tailNodes.has(node)&&!corrective)continue;
 const array=new Float32Array(out.getArray());
 for(let i=0;i<out.getCount();i++){
  const value=Array.from(array.subarray(i*3,i*3+3));let adapted;
  if(corrective){
   const obj=mapping.objects[corrective.object],p=obj.sourceWorldPositions[corrective.vertex],raw=obj.originalVertexWeights[corrective.vertex],sum=raw.reduce((n,[,w])=>n+w,0),weights=raw.map(([n,w])=>[n,w/sum]);
   const rotationChannel=animation.listChannels().find(c=>c.getTargetNode()===node&&c.getTargetPath()==='rotation');
   const q=sampleQuaternion(rotationChannel,channel.getSampler().getInput().getScalar(i));
   const actual=new Vector3(...p).applyQuaternion(q).add(new Vector3(...value));
   const before=new Vector3(...adaptSourcePoint(p,corrective.object,weights)).applyQuaternion(q);
   const after=new Vector3(...adaptSourcePoint(actual.toArray(),corrective.object,weights));
   adapted=after.sub(before).toArray();
  }else adapted=adaptSourcePoint(value,'Body',[['Tail',1]]);
  array.set(adapted,i*3);
 }
 // Exporter may share constant accessors. Give each changed channel its own.
 channel.getSampler().setOutput(accessor(node.getName()+'_adapted_translation','VEC3',array));
}
const output='cdmir-porcupine-adapted.glb',result=await io.writeBinary(doc);await writeFile(new URL(output,dir),result);
const report={source:input,sourceSha256:hash(bytes),output,sha256:hash(result),bytes:result.length,sourceAuthor:'CDmir; TinyWorlds',license:'CC0-1.0',sourceUrl:'https://opengameart.org/content/evil-giant-rat',originalBlendSha256:'52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2',reference:PORCUPINE_REFERENCE,quillCount,nativeActions:root.listAnimations().map(a=>a.getName()),nativeExportAudit:{file:'native-export-report.json',finalByteMaximumNormalizedMm:nativeReport.finalByteMaximumNormalizedMm,sourceActionsPreservedInOriginal:14,omittedSourceActions:[{name:'Idle.000',reason:'Six original Blender B-bone discontinuities; source jumps 33.4–51.35 mm at preview scale.',evidence:'weight-audit-tail-discontinuity.json'}]},topology:'Original body/head/limbs/tail topology retained and reshaped; quills added to Body skin.',limits:['CPU candidate only. No hardware visual or gameplay acceptance.','Original native tracks retained; species reshaping changes resulting surface motion and requires a separate contact and silhouette review.','Quill root weights copied intact from source vertices; added quill lengths amplify local rotational motion.','Tail pivots and translation paths retargeted to the shorter source mesh; Run/Walk/Attack contact still requires review.']};await writeFile(new URL('porcupine-adaptation.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));









