import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const directory='test-results/creature-expansion/sources/monsters/cinder';
const glbArgument=process.argv.find(argument=>argument.startsWith('--glb='));
const glbUrl=glbArgument?'/'+glbArgument.slice(6).replaceAll('\\','/').replace(/^\//,''):null;
const phaseCount=Number(process.argv.find(argument=>argument.startsWith('--phases='))?.slice(9)||480);
const baseline=JSON.parse(await fs.readFile(`${directory}/gait-baseline.json`,'utf8'));
const sourceMeta=glbUrl?JSON.parse(await fs.readFile(`${directory}/gait-repair-audit.json`,'utf8')).metadata:null;
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
await page.goto('http://127.0.0.1:60588/tools/creature-expansion/convert.html');
const report=await page.evaluate(async({baseline,glbUrl,sourceMeta,phaseCount})=>{
  const THREE=await import('three');
  let built;
  if(glbUrl){const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const asset=await new GLTFLoader().loadAsync(glbUrl);built={object:asset.scene,clips:asset.animations,meta:sourceMeta};}
  else {const {buildCinder}=await import('/tools/creature-expansion/monsters/cinder.mjs');built=await buildCinder();}
  const object=built.object;
  const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(value=>value.toString(16).padStart(2,'0')).join('');
  const hashes={};for(const clip of built.clips)hashes[clip.name]=await hash(clip.tracks.map(track=>[track.name,Array.from(track.times),Array.from(track.values)]));
  const unchanged=['Idle','Attack','Hit','HitLeft','HitRight','Death'].map(name=>({name,equal:hashes[name]===baseline.hashes[name],hash:hashes[name]}));
  const gait=[];
  const point=name=>object.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const soleParts={l:[],r:[]};
  for(const side of ['l','r'])object.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;const ids=new Set(mesh.skeleton.bones.flatMap((bone,index)=>(bone.name===`foot${side}`||bone.name.startsWith('toes_')&&bone.name.endsWith(side))?[index]:[]));const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,vertices=[];for(let i=0;i<indices.count;i++){let weight=0;for(let c=0;c<4;c++)if(ids.has(indices.getComponent(i,c)))weight+=weights.getComponent(i,c);if(weight>.001)vertices.push(i);}soleParts[side].push({mesh,vertices});});
  const soleY=side=>{const vertex=new THREE.Vector3();let low=Infinity;for(const {mesh,vertices} of soleParts[side])for(const index of vertices){mesh.getVertexPosition(index,vertex).applyMatrix4(mesh.matrixWorld);low=Math.min(low,vertex.y);}return low;};
  for(const name of ['Walk','Run']) {
    const clip=built.clips.find(clip=>clip.name===name),mixer=new THREE.AnimationMixer(object);
    const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const phases=phaseCount,feet={l:[],r:[]},soles={l:[],r:[]};let minFloor=Infinity,maxFloor=-Infinity,maxRootXZDrift=0;
    const jointRows=[];
    for(let i=0;i<=phases;i++) {
      const phase=i/phases,time=phase*clip.duration;
      mixer.setTime(time);object.updateMatrixWorld(true);
      const floor=new THREE.Box3().setFromObject(object,true).min.y;
      minFloor=Math.min(minFloor,floor);maxFloor=Math.max(maxFloor,floor);
      const pelvis=point('rootx');maxRootXZDrift=Math.max(maxRootXZDrift,Math.hypot(pelvis.x,pelvis.z));
      for(const side of ['l','r']){feet[side].push(point(`toes_01${side}`));soles[side].push(soleY(side));}
      if(i%60===0)jointRows.push({phase,pelvis:pelvis.toArray(),left:{hip:point('thigh_stretchl').toArray(),knee:point('leg_stretchl').toArray(),ankle:point('footl').toArray(),toe:feet.l.at(-1).toArray()},right:{hip:point('thigh_stretchr').toArray(),knee:point('leg_stretchr').toArray(),ankle:point('footr').toArray(),toe:feet.r.at(-1).toArray()}});
    }
    mixer.stopAllAction();mixer.uncacheRoot(object);
    const target=name==='Walk'?.9:3,support=name==='Walk'?.60:.34,dt=clip.duration/phases;
    const contacts={};
    for(const side of ['l','r']) {
      const data=feet[side],speeds=[],cross=[],clearance=[],xerrors=[];
      for(let i=1;i<data.length;i++) {
        const a=((i-1)/phases+(side==='r'?.07:.57))%1,b=(i/phases+(side==='r'?.07:.57))%1;
        if(a>.015&&b<support-.015&&b>a){speeds.push((data[i-1].z-data[i].z)/dt);cross.push(Math.abs(data[i].x-data[i-1].x)/dt);clearance.push(soles[side][i]);xerrors.push(Math.abs(data[i].x-(side==='l'?.34:-.34)));}
      }
      const sorted=[...speeds].sort((a,b)=>a-b),errors=speeds.map(speed=>Math.abs(speed-target)).sort((a,b)=>a-b);
      contacts[side]={samples:speeds.length,medianMps:sorted[Math.floor(sorted.length/2)],p95SpeedErrorMps:errors[Math.floor(errors.length*.95)],maxLateralMps:Math.max(...cross),maxLateralDisplacementM:Math.max(...xerrors),soleGroundClearanceM:[Math.min(...clearance),Math.max(...clearance)],toeExcursionM:Math.max(...data.map(point=>point.z))-Math.min(...data.map(point=>point.z)),endpointDistanceM:data[0].distanceTo(data.at(-1))};
    }
    let maxTrackEndpointDifference=0;
    for(const track of clip.tracks){const size=track.getValueSize();for(let i=0;i<size;i++)maxTrackEndpointDifference=Math.max(maxTrackEndpointDifference,Math.abs(track.values[i]-track.values[track.values.length-size+i]));}
    gait.push({name,duration:clip.duration,targetMps:target,contacts,minFloor,maxFloor,maxRootXZDrift,maxTrackEndpointDifference,jointRows});
  }
  const semantics=[];
  if(glbUrl){
    const {buildCinder}=await import('/tools/creature-expansion/monsters/cinder.mjs'),reference=await buildCinder();
    const names=[];reference.object.traverse(node=>{if(node.isBone)names.push(node.name);});
    for(const name of ['Idle','Attack','Hit','HitLeft','HitRight','Death']){
      const source=reference.clips.find(clip=>clip.name===name),output=built.clips.find(clip=>clip.name===name),a=new THREE.AnimationMixer(reference.object),b=new THREE.AnimationMixer(object);
      for(const [mixer,clip] of [[a,source],[b,output]]){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();}
      let maxBoneDistanceM=0;
      for(let i=0;i<=16;i++){a.setTime(source.duration*i/16);b.setTime(output.duration*i/16);reference.object.updateMatrixWorld(true);object.updateMatrixWorld(true);for(const bone of names){const x=reference.object.getObjectByName(bone),y=object.getObjectByName(bone);if(!y)throw new Error(`Export lost ${bone}`);maxBoneDistanceM=Math.max(maxBoneDistanceM,x.getWorldPosition(new THREE.Vector3()).distanceTo(y.getWorldPosition(new THREE.Vector3())));}}
      a.stopAllAction();a.uncacheRoot(reference.object);b.stopAllAction();b.uncacheRoot(object);
      semantics.push({name,durationDifference:Math.abs(source.duration-output.duration),maxBoneDistanceM});
    }
  }
  return {source:glbUrl||'browser source builder',phaseCount,unchanged,semantics,scale:object.scale.toArray(),gait,metadata:built.meta};
},{baseline,glbUrl,sourceMeta,phaseCount});
await fs.writeFile(`${directory}/${glbUrl?'gait-roundtrip-audit':'gait-repair-audit'}${phaseCount===480?'':`-${phaseCount}`}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({unchanged:report.unchanged.map(({name,equal})=>({name,equal})),scale:report.scale,gait:report.gait.map(({jointRows,...summary})=>summary)},null,2));
if(glbUrl)console.log(JSON.stringify({semantics:report.semantics},null,2));
await browser.close();
if(!glbUrl&&report.unchanged.some(clip=>!clip.equal))throw new Error('An unrelated Cinder clip changed');
if(report.semantics.some(clip=>clip.durationDifference>1e-5||clip.maxBoneDistanceM>.002))throw new Error('Roundtrip changed non-gait motion beyond2mm');
for(const gait of report.gait){if(gait.minFloor<-.004||gait.maxTrackEndpointDifference>0)throw new Error(`Cinder ${gait.name} floor/seam failure`);for(const contact of Object.values(gait.contacts))if(Math.abs(contact.medianMps-gait.targetMps)>.03||contact.p95SpeedErrorMps>.15||contact.endpointDistanceM>.001)throw new Error(`Cinder ${gait.name} contact failure`);}
