import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildSpecies,SPECIES} from '../mammals.mjs';

// CPU evidence only. Retain the existing 25mm diagnostic threshold, but report
// physical planted soles separately. Never infer a terrain offset to hide them.
const root=new URL('../../../',import.meta.url);
const output=new URL('art/rebuild/candidates/finish-quadrupeds/penetration-review.json',root);
const round=n=>Number(n.toFixed(9));
const frac=n=>n-Math.floor(n);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function loadUntexturedGLB(path){
  const bytes=await readFile(path),jsonLength=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8'));
  for(const mesh of json.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  delete json.materials;delete json.textures;delete json.images;delete json.samplers;
  const text=Buffer.from(JSON.stringify(json)),padded=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(padded);
  const rest=bytes.subarray(20+jsonLength),rebuilt=Buffer.alloc(20+padded.length+rest.length);
  rebuilt.writeUInt32LE(0x46546c67,0);rebuilt.writeUInt32LE(2,4);rebuilt.writeUInt32LE(rebuilt.length,8);
  rebuilt.writeUInt32LE(padded.length,12);rebuilt.writeUInt32LE(0x4e4f534a,16);padded.copy(rebuilt,20);rest.copy(rebuilt,20+padded.length);
  const gltf=await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset,rebuilt.byteOffset+rebuilt.byteLength),'');
  return {object:gltf.scene,clips:gltf.animations,sourceSha256:hash(bytes),sourcePath:path.pathname};
}

function gaitPhase(id,name,time,duration,boneName){
  if(!['Walk','Run'].includes(name))return {stage:'not-a-locomotion-clip'};
  const leg=/^(FR|FL|HR|HL)_/.exec(boneName)?.[1];
  if(!leg)return {stage:'not-a-limb-vertex'};
  const front=leg[0]==='F',left=leg[1]==='L',run=name==='Run';
  let phase;
  if(run&&['redbrush_fox','duskoak_lynx'].includes(id))phase=front?(left?.05:.15):(left?.55:.65);
  else if(run)phase=front?(left?0:.5):(left?.5:0);
  else phase=front?(left?0:.5):(left?.75:.25);
  const u=frac(time/duration+phase),duty=run?.44:.66;
  return {leg,normalizedClipTime:round(time/duration),authoredLegPhaseOffset:phase,
    legCyclePhase:round(u),stanceDuty:duty,stage:u<duty?'stance':'swing',
    phaseBasis:'mammals.mjs buildClips phase/stance expressions; key intervals may cross a stance boundary'};
}

function inspect(id,built,label){
  const {object,clips}=built,meshes=[];
  object.updateMatrixWorld(true);
  object.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
  const restBones=new Map();object.traverse(o=>{if(o.isBone)restBones.set(o.name,o.getWorldPosition(new THREE.Vector3()).toArray());});
  const mixer=new THREE.AnimationMixer(object),reports=[];
  for(const clip of clips){
    const keys=[...new Set(clip.tracks.flatMap(t=>Array.from(t.times)).concat([0,clip.duration]))].sort((a,b)=>a-b);
    const times=[...keys,...keys.slice(1).flatMap((t,i)=>[.25,.5,.75].map(u=>keys[i]+(t-keys[i])*u))].sort((a,b)=>a-b);
    mixer.stopAllAction();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    let worst={y:Infinity},worstStanceSole={y:Infinity};
    for(const time of times){
      mixer.setTime(time);object.updateMatrixWorld(true);
      for(const mesh of meshes){
        mesh.skeleton.update();const pos=mesh.geometry.attributes.position,si=mesh.geometry.attributes.skinIndex,sw=mesh.geometry.attributes.skinWeight;
        const mats=mesh.skeleton.bones.map((_,i)=>new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices,i*16).premultiply(new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld,mesh.bindMatrixInverse)).multiply(mesh.bindMatrix));
        for(let i=0;i<pos.count;i++){
          const xyz=[pos.getX(i),pos.getY(i),pos.getZ(i)];let y=0,maxWeight=0,dominant='';
          for(let c=0;c<4;c++){const w=sw.getComponent(i,c);if(!w)continue;const idx=si.getComponent(i,c),e=mats[idx].elements;y+=w*(e[1]*xyz[0]+e[5]*xyz[1]+e[9]*xyz[2]+e[13]);if(w>maxWeight){maxWeight=w;dominant=mesh.skeleton.bones[idx].name;}}
          const phase=gaitPhase(id,clip.name,time,clip.duration,dominant),sole=xyz[1]<=.012&&/_Paw$/.test(dominant)&&maxWeight>.99;
          const record=()=>({y,time,mesh:mesh.name,vertex:i,bindPosition:xyz,dominantBone:dominant,weights:Array.from({length:4},(_,c)=>({bone:mesh.skeleton.bones[si.getComponent(i,c)]?.name,weight:sw.getComponent(i,c)})).filter(w=>w.weight>0),phase,physicalSole:sole});
          if(y<worst.y)worst=record();
          if(sole&&phase.stage==='stance'&&y<worstStanceSole.y)worstStanceSole=record();
        }
      }
    }
    // Resolve the exact world point and paw transform for the reported sample.
    for(const sample of [worst,worstStanceSole]){
      if(!Number.isFinite(sample.y))continue;
      action.reset().play();mixer.setTime(sample.time);object.updateMatrixWorld(true);
      const mesh=meshes.find(m=>m.name===sample.mesh);mesh.skeleton.update();
      const point=new THREE.Vector3(...sample.bindPosition);mesh.applyBoneTransform(sample.vertex,point);point.applyMatrix4(mesh.matrixWorld);
      sample.worldPosition=point.toArray().map(round);
      if(Math.abs(point.y-sample.y)>1e-6)throw new Error(`${id}/${clip.name}: direct skin evaluation disagrees with row audit`);
      sample.restBonePosition=restBones.get(sample.dominantBone);
      sample.posedBonePosition=object.getObjectByName(sample.dominantBone)?.getWorldPosition(new THREE.Vector3()).toArray().map(round);
      const below=keys.filter(t=>t<=sample.time+1e-10).at(-1),above=keys.find(t=>t>=sample.time-1e-10);
      sample.adjacentAuthoredKeys=[below,above].filter((t,i,a)=>Number.isFinite(t)&&a.indexOf(t)===i).map(time=>{
        action.reset().play();mixer.setTime(time);object.updateMatrixWorld(true);mesh.skeleton.update();
        const p=new THREE.Vector3(...sample.bindPosition);mesh.applyBoneTransform(sample.vertex,p);p.applyMatrix4(mesh.matrixWorld);
        return {time:round(time),worldY:round(p.y)};
      });
      sample.penetrationM=round(Math.max(0,-sample.y));sample.y=round(sample.y);sample.time=round(sample.time);
      sample.interpretation=sample.physicalSole&&sample.phase.stage==='stance'?'authored physical sole below floor during stance':sample.physicalSole?'physical sole outside stance':'non-sole surface';
    }
    reports.push({clip:clip.name,duration:clip.duration,samples:times.length,intervalSubdivisions:4,
      frames:clip.tracks[0]?.times.length,rawTrackBytes:clip.tracks.reduce((n,t)=>n+t.times.byteLength+t.values.byteLength,0),worst,
      worstStanceSole:Number.isFinite(worstStanceSole.y)?worstStanceSole:null});
  }
  mixer.stopAllAction();
  return {id,label,sourceSha256:built.sourceSha256??null,sourcePath:built.sourcePath??'current buildSpecies source',clips:reports};
}

const report={schema:1,floor:{y:0,units:'metres',basis:[
  'mammals.mjs buildSpecies object.userData.groundY=0',
  'implicit.mjs sole flattening clamps contact patch to y=0',
  'animation-audit.mjs groundPlaneY=0 and DEFAULT_MAX_PENETRATION=0.025',
  'This audits the authored flat-ground source. It does not claim the live world terrain has absolute y=0.'
]},thresholds:{existingDiagnosticMaxPenetrationM:.025,proposedPhysicalSoleReviewM:.001,
  proposalBasis:'1mm is a new stricter review criterion for rigid planted soles, not an existing project acceptance rule. Values above it need fixing or explicit root disposition; the 25mm diagnostic pass alone is insufficient.'},assets:[]};
report.currentSourceFiles=await Promise.all(['tools/creature-expansion/mammals.mjs',
  'tools/creature-expansion/mammals/implicit.mjs','tools/creature-expansion/mammals/fox-anatomy.mjs',
  'tools/creature-expansion/mammals/badger-anatomy.mjs','tools/creature-expansion/mammals/porcupine-anatomy.mjs']
  .map(async path=>({path,sha256:hash(await readFile(new URL(path,root)))})));
for(const id of SPECIES)report.assets.push(inspect(id,await buildSpecies(id),'current source'));
const previousPath=new URL('art/rebuild/candidates/finish-quadrupeds/models/creature_duskoak_lynx.glb',root);
try{report.assets.push(inspect('duskoak_lynx',await loadUntexturedGLB(previousPath),'staged prior candidate; exact SHA256 recorded, revision label not inferred'));}
catch(error){report.previousCandidateUnavailable={path:previousPath.pathname,error:error.message};}
report.summary=report.assets.map(a=>({id:a.id,label:a.label,maxPenetrationM:Math.max(...a.clips.map(c=>c.worst.penetrationM)),maxStanceSolePenetrationM:Math.max(0,...a.clips.map(c=>c.worstStanceSole?.penetrationM??0)),requiresPhysicalContactReview:a.clips.some(c=>(c.worstStanceSole?.penetrationM??0)>.001)}));
report.finding='The preserved before-contact-fix report and prior staged Lynx show 7.7mm burial of a 100% FR_Paw-weighted sole during stance. Adjacent authored keys stay at y=0: this is between-key skeletal interpolation sag, not fur or a floor offset. Current values below are measured after the sampling-only source fix.';
report.contactFix='Walk/Run/Attack bake at160Hz, except Lynx Run320Hz after160Hz still failed1mm. Other clips remain40Hz. Shapes, target paths, clip durations, markers and speed metadata are unchanged. Quarter/mid/three-quarter interval samples supplement the whole-vertex key/midpoint audit. Original diagnostic25mm remains unchanged;1mm is the explicit goal for this repair.';
// Reconstruct only the previous 40Hz bake in memory. This is explicitly a
// sampling baseline of current geometry, not an invented prior art revision.
const sourceURL=new URL('tools/creature-expansion/mammals.mjs',root);
const baselineSource=(await readFile(sourceURL,'utf8')).replace(/const sampleHz=.*;/,'const sampleHz=40;')
  .replace("from 'three'",`from '${new URL('node_modules/three/build/three.module.js',root).href}'`)
  .replace(/(['"])(\.\/mammals\/[^'"]+)\1/g,(_m,_q,path)=>`'${new URL(path,sourceURL).href}'`);
const baseline=await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString('base64')}`);
function fingerprints(built){
  const geometry=createHash('sha256'),endpoints=createHash('sha256');let bytes=0;
  built.object.traverse(o=>{if(o.isMesh){for(const a of Object.values(o.geometry.attributes))geometry.update(Buffer.from(a.array.buffer));geometry.update(Buffer.from(o.geometry.index.array.buffer));}});
  for(const clip of built.clips){endpoints.update(clip.name+':'+clip.duration);for(const track of clip.tracks){const n=track.getValueSize();endpoints.update(track.name);endpoints.update(JSON.stringify([...track.values.slice(0,n),...track.values.slice(-n)]));bytes+=track.times.byteLength+track.values.byteLength;}}
  return {geometry:geometry.digest('hex'),endpoints:endpoints.digest('hex'),metadata:hash(JSON.stringify(built.meta)),rawTrackBytes:bytes};
}
report.samplingBaselineComparison=[];
for(const id of SPECIES){
  const before=fingerprints(await baseline.buildSpecies(id)),after=fingerprints(await buildSpecies(id));
  const preserved={geometry:before.geometry===after.geometry,clipEndpointsAndDurations:before.endpoints===after.endpoints,metadata:before.metadata===after.metadata};
  if(Object.values(preserved).some(ok=>!ok))throw new Error(`${id}: sampling fix changed a preserved contract`);
  report.samplingBaselineComparison.push({id,basis:'same current geometry re-evaluated at original40Hz; original measured penetration preserved separately',before,after,preserved,rawTrackBytesIncrease:after.rawTrackBytes-before.rawTrackBytes,rawTrackBytesRatio:round(after.rawTrackBytes/before.rawTrackBytes)});
}
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:output.pathname,summary:report.summary,previousCandidateUnavailable:report.previousCandidateUnavailable}));
