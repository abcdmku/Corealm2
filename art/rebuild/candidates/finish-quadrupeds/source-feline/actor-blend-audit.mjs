import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const folder=new URL('./',import.meta.url);
const v2=process.argv.includes('--v2');
const glbName=v2?'Lynx.actor-contact-v2.glb':'Lynx.actor-baked.glb';
const reportPrefix=v2?'actor2-blend-audit':'actor-blend-audit';
const bytes=await readFile(new URL(glbName,folder));
const sha=createHash('sha256').update(bytes).digest('hex');
const expected='fcc4296906bfeec04b9b2c650639a150238d2bccf14b2ec45b427ade1453b2d5';
if(!v2&&sha!==expected)throw Error(`Frozen GLB changed: ${sha}`);
const audit=JSON.parse(await readFile(new URL('lynx-gait-contact-audit.json',folder),'utf8'));
const npz=fileURLToPath(new URL('actor-bake-data.npz',folder));
// Read mapping from exported triangle corners to original source vertex IDs.
// The frozen GLB is hashed above; matching corner position arrays are checked.
const arrays=JSON.parse(execFileSync('python',['-c',
  "import numpy as np,json,sys; d=np.load(sys.argv[1]); print(json.dumps({n:{'ids':d[n+'_cornerIds'].tolist(),'positions':d[n+'_positions'].tolist()} for n in ['Cat','Sphere','Sphere.001']}))",npz],{maxBuffer:32*1024*1024}).toString());
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const mixer=new THREE.AnimationMixer(gltf.scene);
const clips=Object.fromEntries(gltf.animations.map(c=>[c.name,c]));
const point=new THREE.Vector3();
const footBySource=new Map();
const soleBySource=new Map();
for(const [foot,data]of Object.entries(audit.feet)){
  for(const id of data.vertexIndices)footBySource.set(id,foot);
  for(const id of data.soleVertexIndices)soleBySource.set(id,foot);
}
const meshes=[];
gltf.scene.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const source=arrays[mesh.name==='Sphere001'?'Sphere.001':mesh.name],pos=mesh.geometry.attributes.position;
  if(!source||source.ids.length!==pos.count)throw Error('Mapping length mismatch '+mesh.name);
  const selected=[],seen=new Set();
  for(let i=0;i<pos.count;i++){
    const id=source.ids[i],p=source.positions[id];
    if(Math.max(Math.abs(pos.getX(i)-p[0]),Math.abs(pos.getY(i)-p[1]),Math.abs(pos.getZ(i)-p[2]))>1e-5)
      throw Error('Mapping position mismatch '+mesh.name+' '+i);
    if(!seen.has(id)){selected.push({corner:i,source:id,foot:mesh.name==='Cat'?footBySource.get(id):null,sole:mesh.name==='Cat'?soleBySource.get(id):null});seen.add(id);}
  }
  meshes.push({mesh,selected});
});
const rows=[];
function probe(clip,idlePhase,incomingPhase,weight,kind){
  mixer.stopAllAction();
  mixer.time=0;
  const idle=mixer.clipAction(clips.Idle).reset(),incoming=mixer.clipAction(clips[clip]).reset();
  for(const a of [idle,incoming])a.setLoop(THREE.LoopOnce,1).setEffectiveTimeScale(0).setEffectiveWeight(1).play();
  idle.time=idlePhase*clips.Idle.duration;
  incoming.time=incomingPhase*clips[clip].duration;
  idle.crossFadeTo(incoming,1,false);
  mixer.update(weight);
  gltf.scene.updateMatrixWorld(true);
  const row={clip,idlePhase,incomingPhase,idleTime:idle.time,incomingTime:incoming.time,weight,kind,
    effectiveIdleWeight:idle.getEffectiveWeight(),effectiveIncomingWeight:incoming.getEffectiveWeight(),
    minimumY:Infinity,worst:null,footMinimumY:{},fixedSoleMinimumY:{}};
  for(const {mesh,selected}of meshes){
    mesh.skeleton?.update();
    for(const item of selected){
      mesh.getVertexPosition(item.corner,point).applyMatrix4(mesh.matrixWorld);
      if(!Number.isFinite(point.y))throw Error('Nonfinite blended vertex');
      if(point.y<row.minimumY){row.minimumY=point.y;row.worst={mesh:mesh.name,cornerIndex:item.corner,sourceVertex:item.source,foot:item.foot??null,fixedSole:item.sole??null,position:point.toArray()};}
      if(item.foot)row.footMinimumY[item.foot]=Math.min(row.footMinimumY[item.foot]??Infinity,point.y);
      if(item.sole)row.fixedSoleMinimumY[item.sole]=Math.min(row.fixedSoleMinimumY[item.sole]??Infinity,point.y);
    }
  }
  row.penetrationMm=Math.max(0,-row.minimumY)*1000;
  rows.push(row);
}
for(const clip of ['Walk','Run'])for(const idlePhase of [0,.25,.731])for(let p=0;p<=24;p++)for(let w=0;w<=10;w++)probe(clip,idlePhase,p/24,w/10,'grid');
let state=260906;
const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
for(const clip of ['Walk','Run'])for(let i=0;i<96;i++)probe(clip,random(),random(),.001+.998*random(),'off-grid');
const sorted=r=>[...r].sort((a,b)=>b.penetrationMm-a.penetrationMm);
const boundaries=rows.filter(r=>r.weight===0||r.weight===1),interior=rows.filter(r=>r.weight>0&&r.weight<1);
const report={glbFile:glbName,glbSha256:sha,threeRevision:THREE.REVISION,method:'Three GLTFLoader + AnimationMixer crossFadeTo,1s,no warp. Both clip local times held with effective timeScale0; elapsed fade time sets exact blend weight. All unique source vertices from all meshes evaluated using getVertexPosition and matrixWorld. Corner/source map checked against GLB positions.',
  floorY:0,samples:rows.length,grid:{idlePhases:[0,.25,.731],incomingPhases:'0..1 in1/24steps',weights:'0..1 in.1steps',offGridPerClip:96,seed:260906},
  meshes:meshes.map(({mesh,selected})=>({name:mesh.name,uniqueVertices:selected.length,corners:mesh.geometry.attributes.position.count})),
  boundaryWorst:sorted(boundaries)[0],interiorWorst:sorted(interior)[0],
  perClip:Object.fromEntries(['Walk','Run'].map(c=>[c,{boundaryWorst:sorted(boundaries.filter(r=>r.clip===c))[0],interiorWorst:sorted(interior.filter(r=>r.clip===c))[0]}])),
  worstTwenty:sorted(interior).slice(0,20),rows};
await writeFile(new URL(reportPrefix+'.json',folder),JSON.stringify(report,null,2)+'\n');
const details=r=>`${r.penetrationMm.toFixed(3)} mm, Idle time ${r.idleTime.toFixed(6)} s, ${r.clip} time ${r.incomingTime.toFixed(6)} s, incoming weight ${r.weight.toFixed(6)}, ${r.worst.mesh} source vertex ${r.worst.sourceVertex}, exported corner ${r.worst.cornerIndex}, foot ${r.worst.foot}`;
await writeFile(new URL(reportPrefix+'.md',folder),`# ${v2?'Revision 2':'Frozen actor'} TRS blend audit\n\nFile \`${glbName}\`, SHA-256 \`${sha}\`. Three revision ${THREE.REVISION}. No asset or motion helper changed; no GPU used.\n\nThe actual Three AnimationMixer crossFadeTo path evaluated ${rows.length} samples spanning three outgoing Idle phases, 25 incoming phases, 11 blend weights and 96 deterministic off-grid samples per incoming clip. Clip local times were held while the one-second fade advanced, so incoming weight and both clip times were controlled independently. This tests ordinary weighted TRS blending, without corrective pose code.\n\nEvery unique source vertex from Cat and both eye meshes was evaluated, including all actual foot-mask and fixed-sole vertices. Original source IDs map to exported triangle corners through actor-bake-data.npz; every mapped coordinate was checked against the loaded GLB before sampling. Floor is Y=0.\n\n| Incoming clip | Standalone boundary worst | Interior blend worst |\n| --- | --- | --- |\n${Object.entries(report.perClip).map(([c,r])=>`| ${c} | ${details(r.boundaryWorst)} | ${details(r.interiorWorst)} |`).join('\n')}\n\nThe JSON preserves all sample weights, actual effective action weights, clip times, whole-mesh minima, foot minima, fixed-sole minima and the worst vertex position. Boundary weights 0 and 1 are reported separately. Interior penetration cannot be dismissed by passing standalone clip contacts. This sampled audit does not establish a continuous bound between tested states or prove horizontal stance stability.\n`);
console.log(JSON.stringify({samples:report.samples,sha,boundaryWorst:report.boundaryWorst,interiorWorst:report.interiorWorst}));
