import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Document, NodeIO, type Primitive} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as THREE from 'three';
import {bakePlayerJog} from '../../game/src/render/playerLocomotion.js';
import {tailorSkirtWeights} from '../../tools/item-models/tier50-70/skin.js';

// Read-only delivery audit. No models are written. Reweighting is in-memory only.
// Usage: node --import tsx art/tier50-70/verify_contacts_r14.ts [--reweight-baseline] [--out FILE]
// Default compares baseline with current built candidate GLBs. In-memory tuning:
// --reweight-baseline [--knee-boost .07] [--split-width .065] [--themes dragonhide]
const args=process.argv.slice(2), option=(name:string)=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const baseline=path.resolve(option('--baseline')??'test-results/tier50-70/r13-final-baseline');
const out=path.resolve(option('--out')??'test-results/tier50-70/r14-contact-audit.json');
const reweight=args.includes('--reweight-baseline');
const onlyBaseline=args.includes('--baseline-only');
const kneeBoost=Number(option('--knee-boost')??0),splitWidth=option('--split-width')?Number(option('--split-width')):null;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function tuneInMemory(doc:Document){
  for(const node of doc.getRoot().listNodes()) {
    if(!node.getMesh()||node.getExtras().itemModelDeform!=='skirt')continue;
    for(const primitive of node.getMesh()!.listPrimitives()) {
      const p=primitive.getAttribute('POSITION')!,w=primitive.getAttribute('WEIGHTS_0')!;
      for(let i=0;i<p.getCount();i++) {
        const xyz:number[]=[],weights:number[]=[];p.getElement(i,xyz);w.getElement(i,weights);
        const front=smooth(-.075,.085,xyz[2]!),boost=kneeBoost*front*(1-smooth(.76,.98,xyz[1]!));
        const originalSwing=weights[1]!+weights[2]!,swing=Math.max(0,Math.min(.96,originalSwing+boost));
        let left=originalSwing?weights[1]!/originalSwing:.5;
        if(splitWidth!==null) {const old=smooth(-.20,.20,xyz[0]!);left=old+(smooth(-splitWidth,splitWidth,xyz[0]!)-old)*front*(1-smooth(.85,1.02,xyz[1]!));}
        w.setElement(i,[1-swing,swing*left,swing*(1-left),0]);
      }
    }
  }
}
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const library=await io.read('game/public/assets/models/animation/animation_library_1.glb');
const animation=library.getRoot().listAnimations().find(a=>a.getName()==='Jog_Fwd_Loop'); assert(animation);
const tracks=animation.listChannels().map(channel=>{
  const sampler=channel.getSampler()!,name=channel.getTargetNode()!.getName(), target=channel.getTargetPath();
  assert(['LINEAR','STEP'].includes(sampler.getInterpolation()));
  const interpolation=sampler.getInterpolation()==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear;
  const times=sampler.getInput()!.getArray()!,values=sampler.getOutput()!.getArray()!;
  return target==='rotation'?new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,times,values,interpolation)
    :new THREE.VectorKeyframeTrack(`${name}.${target==='translation'?'position':'scale'}`,times,values,interpolation);
});
const sourceClip=new THREE.AnimationClip('Jog_Fwd_Loop',-1,tracks);

function poseRig(doc:Document) {
  const rig=new THREE.Group(), byName=new Map<string,THREE.Object3D>();
  const nodes=new Map(doc.getRoot().listNodes().filter(n=>!n.getMesh()).map(node=>{
    const object=new THREE.Object3D();object.name=node.getName();object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());object.scale.fromArray(node.getScale());byName.set(object.name,object);
    return [node,object] as const;
  }));
  for(const [node,object] of nodes)(nodes.get(node.getParentNode()!)??rig).add(object);
  rig.updateMatrixWorld(true);
  const clip=bakePlayerJog(sourceClip,rig,3.5).clip;
  const mixer=new THREE.AnimationMixer(rig);mixer.clipAction(clip).play();
  const skin=doc.getRoot().listSkins()[0]!, inverse=skin.getInverseBindMatrices()!;
  const inverseMatrices=skin.listJoints().map((_,i)=>{const a:number[]=[];inverse.getElement(i,a);return new THREE.Matrix4().fromArray(a);});
  return {duration:clip.duration, pose(phase:number|null){
    if(phase===null) return skin.listJoints().map(()=>new THREE.Matrix4());
    mixer.setTime(phase*clip.duration);rig.updateMatrixWorld(true);
    return skin.listJoints().map((j,i)=>byName.get(j.getName())!.matrixWorld.clone().multiply(inverseMatrices[i]!));
  }};
}
type XYZ=[number,number,number];
type Vertex={p:XYZ,j:number[],w:number[]};
function vertices(p:Primitive):Vertex[]{
  const pos=p.getAttribute('POSITION')!,j=p.getAttribute('JOINTS_0')!,w=p.getAttribute('WEIGHTS_0')!;
  return Array.from({length:pos.getCount()},(_,i)=>{const a:number[]=[],b:number[]=[],c:number[]=[];pos.getElement(i,a);j.getElement(i,b);w.getElement(i,c);return {p:a as XYZ,j:b,w:c};});
}
function deform(v:Vertex,matrices:THREE.Matrix4[]):XYZ{
  let x=0,y=0,z=0;
  for(let k=0;k<4;k++) {if(!v.w[k])continue; const a=matrices[v.j[k]!]!.elements,p=v.p,w=v.w[k]!;
    x+=w*(a[0]!*p[0]+a[4]!*p[1]+a[8]!*p[2]+a[12]!);
    y+=w*(a[1]!*p[0]+a[5]!*p[1]+a[9]!*p[2]+a[13]!);
    z+=w*(a[2]!*p[0]+a[6]!*p[1]+a[10]!*p[2]+a[14]!);
  }return[x,y,z];
}
type Surface={name:string,v:Vertex[],tri:number[][]};
function clothSurfaces(doc:Document):Surface[]{
  const surfaces:Surface[]=[];
  for(const node of doc.getRoot().listNodes()) {
    if(!node.getMesh()||node.getExtras().itemModelDeform!=='skirt')continue;
    for(const p of node.getMesh()!.listPrimitives()) {
      if(!/close-twill-cloth/.test(p.getMaterial()?.getName()??''))continue;
      const v=vertices(p),ix=p.getIndices()!.getArray()!;
      const tri:number[][]=[];
      for(let i=0;i<ix.length;i+=3) {
        const t=[ix[i]!,ix[i+1]!,ix[i+2]!];
        // The front-facing half of the actual cloth shell, below its belt.
        if(t.every(k=>v[k]!.p[2]>.015&&v[k]!.p[1]<1.075))tri.push(t);
      }
      surfaces.push({name:node.getName(),v,tri});
    }
  }return surfaces;
}
function kneeSamples(doc:Document):Vertex[]{
  const samples:Vertex[]=[],seen=new Set<string>();
  for(const node of doc.getRoot().listNodes()) {
    if(!node.getMesh()||node.getExtras().itemModelDeform==='skirt')continue;
    if(!(node.getExtras().sourceParts as string[]|undefined)?.some(name=>name.includes('Knee')))continue;
    for(const p of node.getMesh()!.listPrimitives()) {
      // Scute geometry provides the actual forward knee envelope, including relief.
      if(!/scute/.test(p.getMaterial()?.getName()??''))continue;
      for(const v of vertices(p)) {
        if(v.p[1]<.455||v.p[1]>.66||v.p[2]<.04)continue;
        const key=v.p.map(a=>Math.round(a*1e6)).join(',');if(seen.has(key))continue;seen.add(key);samples.push(v);
      }
    }
  }return samples;
}
function kneeSurfaces(doc:Document):Surface[]{
  const surfaces:Surface[]=[];
  for(const node of doc.getRoot().listNodes()) {
    if(!node.getMesh()||node.getExtras().itemModelDeform==='skirt')continue;
    if(!(node.getExtras().sourceParts as string[]|undefined)?.some(name=>name.includes('Knee')))continue;
    for(const p of node.getMesh()!.listPrimitives()) {
      if(!/scute/.test(p.getMaterial()?.getName()??''))continue;
      const v=vertices(p),ix=p.getIndices()!.getArray()!,tri:number[][]=[];
      for(let i=0;i<ix.length;i+=3) {
        const t=[ix[i]!,ix[i+1]!,ix[i+2]!];
        if(t.every(k=>v[k]!.p[1]>=.455&&v[k]!.p[1]<=.66&&v[k]!.p[2]>.04))tri.push(t);
      }
      surfaces.push({name:node.getName(),v,tri});
    }
  }return surfaces;
}
type Triangle={a:XYZ,b:XYZ,c:XYZ,name:string,bindCenter?:XYZ};
function posedTriangles(surfaces:Surface[],matrices:THREE.Matrix4[]):Triangle[]{
  return surfaces.flatMap(surface=>{const v=surface.v.map(p=>deform(p,matrices));return surface.tri.map(t=>({a:v[t[0]!]!,b:v[t[1]!]!,c:v[t[2]!]!,name:surface.name,
    bindCenter:[0,1,2].map(k=>t.reduce((s,i)=>s+surface.v[i]!.p[k]!,0)/3) as XYZ}));});
}
function contactAudit(cloth:Triangle[],knee:Triangle[]){
  const cell=.04,grid=new Map<string,number[]>();
  const bounds=(t:Triangle)=>({min:[0,1,2].map(i=>Math.min(t.a[i]!,t.b[i]!,t.c[i]!)),max:[0,1,2].map(i=>Math.max(t.a[i]!,t.b[i]!,t.c[i]!))});
  const cb=cloth.map(bounds),kb=knee.map(bounds);
  const keys=(b:ReturnType<typeof bounds>)=>{
    const out:string[]=[];
    for(let x=Math.floor(b.min[0]!/cell);x<=Math.floor(b.max[0]!/cell);x++)
      for(let y=Math.floor(b.min[1]!/cell);y<=Math.floor(b.max[1]!/cell);y++)
        for(let z=Math.floor(b.min[2]!/cell);z<=Math.floor(b.max[2]!/cell);z++)out.push(`${x},${y},${z}`);
    return out;
  };
  cb.forEach((b,i)=>{for(const key of keys(b)){const a=grid.get(key);if(a)a.push(i);else grid.set(key,[i]);}});
  const ray=new THREE.Ray(),hit=new THREE.Vector3(),start=new THREE.Vector3(),end=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  function edgeHit(p:XYZ,q:XYZ,t:Triangle):XYZ|null {
    start.fromArray(p);end.fromArray(q);const length=end.distanceTo(start);if(length<1e-10)return null;
    ray.origin.copy(start);ray.direction.copy(end).sub(start).multiplyScalar(1/length);
    const result=ray.intersectTriangle(a.fromArray(t.a),b.fromArray(t.b),c.fromArray(t.c),false,hit);
    return result&&result.distanceTo(start)<=length+1e-8?[result.x,result.y,result.z]:null;
  }
  function intersect(t:Triangle,s:Triangle):XYZ|null {
    for(const [p,q] of [[t.a,t.b],[t.b,t.c],[t.c,t.a]] as [XYZ,XYZ][]) {const hit=edgeHit(p,q,s);if(hit)return hit;}
    for(const [p,q] of [[s.a,s.b],[s.b,s.c],[s.c,s.a]] as [XYZ,XYZ][]) {const hit=edgeHit(p,q,t);if(hit)return hit;}
    return null;
  }
  let pairs=0;const hitCloth=new Set<number>(),hitKnee=new Set<number>(),locations:{posedMm:number[],clothBindCenterMm:number[],kneeBindCenterMm:number[]}[]=[];
  knee.forEach((t,i)=>{
    const candidates=new Set(keys(kb[i]!).flatMap(key=>grid.get(key)??[]));
    for(const j of candidates) {
      if([0,1,2].some(k=>kb[i]!.min[k]!>cb[j]!.max[k]!+1e-8||kb[i]!.max[k]!<cb[j]!.min[k]!-1e-8))continue;
      const hit=intersect(t,cloth[j]!);if(!hit)continue;
      pairs++;hitCloth.add(j);hitKnee.add(i);if(locations.length<10)locations.push({posedMm:hit.map(mm),clothBindCenterMm:cloth[j]!.bindCenter!.map(mm),kneeBindCenterMm:t.bindCenter!.map(mm)});
    }
  });
  return {intersectingTrianglePairs:pairs,clothTrianglesCrossed:hitCloth.size,kneeTrianglesCrossed:hitKnee.size,firstContacts:locations};
}
const CELL=.025;
function projectionIndex(surfaces:Surface[],matrices:THREE.Matrix4[]){
  const grid=new Map<string,Triangle[]>();let triangles=0;
  for(const surface of surfaces) {
    const v=surface.v.map(p=>deform(p,matrices));
    for(const tri of surface.tri) {
      const [a,b,c]=tri.map(i=>v[i]!) as [XYZ,XYZ,XYZ];
      const denom=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denom)<1e-10)continue;
      const t={a,b,c,name:surface.name};triangles++;
      const minX=Math.floor(Math.min(a[0],b[0],c[0])/CELL),maxX=Math.floor(Math.max(a[0],b[0],c[0])/CELL);
      const minY=Math.floor(Math.min(a[1],b[1],c[1])/CELL),maxY=Math.floor(Math.max(a[1],b[1],c[1])/CELL);
      for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++) {
        const key=`${x},${y}`,list=grid.get(key);if(list)list.push(t);else grid.set(key,[t]);
      }
    }
  }
  return {triangles, query(p:XYZ){
    const list=grid.get(`${Math.floor(p[0]/CELL)},${Math.floor(p[1]/CELL)}`)??[];
    let z=-Infinity;
    for(const {a,b,c} of list) {
      const denom=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/denom;
      const v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/denom;
      if(u<0||v<0||u+v>1)continue;
      z=Math.max(z,u*a[2]+v*b[2]+(1-u-v)*c[2]);
    }return z;
  }};
}
const mm=(v:number)=>Number((v*1000).toFixed(3));
async function audit(theme:string,label:string,dir:string,weight=false){
  const file=(part:string)=>path.join(dir,`${theme}_${part}.glb`);
  const [robe,legs]=await Promise.all([io.read(file('robe')),io.read(file('leggings'))]);
  if(weight){tailorSkirtWeights(robe);if(kneeBoost||splitWidth!==null)tuneInMemory(robe);}
  const surfaces=clothSurfaces(robe),knees=kneeSurfaces(legs),samples=kneeSamples(legs),robeRig=poseRig(robe),legRig=poseRig(legs);
  assert(samples.length>0&&surfaces.length>0);
  const phases:[string,number|null][]=[['bind',null],...Array.from({length:20},(_,i)=>[i.toFixed(0).padStart(2,'0'),i/20] as [string,number])];
  const rows=phases.map(([name,phase])=>{
    const robeMatrices=robeRig.pose(phase),index=projectionIndex(surfaces,robeMatrices),matrices=legRig.pose(phase);
    const contact=contactAudit(posedTriangles(surfaces,robeMatrices),posedTriangles(knees,matrices));
    const covered:{clearance:number,bind:XYZ,posed:XYZ,clothZ:number}[]=[];
    for(const sample of samples){const p=deform(sample,matrices),z=index.query(p);if(Number.isFinite(z))covered.push({clearance:z-p[2],bind:sample.p,posed:p,clothZ:z});}
    covered.sort((a,b)=>a.clearance-b.clearance);
    const penetrating=covered.filter(x=>x.clearance<-.001), worst=covered[0];
    return {phase,frame:name,contact,sampled:samples.length,covered:covered.length,penetratingOver1mm:penetrating.length,penetratingOver5mm:covered.filter(x=>x.clearance<-.005).length,
      minClearanceMm:worst?mm(worst.clearance):null,p05ClearanceMm:covered.length?mm(covered[Math.floor(covered.length*.05)]!.clearance):null,
      meanPenetrationMm:penetrating.length?mm(penetrating.reduce((s,x)=>s-x.clearance,0)/penetrating.length):0,
      worst:worst?{bindMm:worst.bind.map(mm),posedMm:worst.posed.map(mm),clothZMm:mm(worst.clothZ)}:null};
  });
  const animationRows=rows.filter(r=>r.phase!==null);
  const result={theme,label,reweighted:weight,files:await Promise.all(['robe','leggings'].map(async part=>({path:file(part),sha256:createHash('sha256').update(await readFile(file(part))).digest('hex')}))),
    duration:robeRig.duration,surfaces:surfaces.map(s=>({name:s.name,triangles:s.tri.length})),rows,
    summary:{intersectingTrianglePairs:animationRows.reduce((s,r)=>s+r.contact.intersectingTrianglePairs,0),phasesWithTriangleIntersections:animationRows.filter(r=>r.contact.intersectingTrianglePairs>0).length,
      worstClearanceMm:Math.min(...animationRows.map(r=>r.minClearanceMm??Infinity)),coveredSamples:animationRows.reduce((s,r)=>s+r.covered,0),
      penetratingSamplesOver1mm:animationRows.reduce((s,r)=>s+r.penetratingOver1mm,0),penetratingSamplesOver5mm:animationRows.reduce((s,r)=>s+r.penetratingOver5mm,0)}};
  console.log(JSON.stringify({theme,label,...result.summary}));return result;
}
const results=[];
for(const theme of (option('--themes')??'dragonhide,starhide').split(',')) {
  results.push(await audit(theme,'R13 baseline',baseline));
  if(reweight)results.push(await audit(theme,'R13 geometry + current skirt weights',baseline,true));
  if(!onlyBaseline&&!reweight)results.push(await audit(theme,'candidate',`art/item-models/candidates/armor-${theme}-reference/models/items`));
}
await mkdir(path.dirname(out),{recursive:true});
await writeFile(out,JSON.stringify({method:'Actual front-cloth/knee-scute triangle intersections using segment-triangle tests with 3D AABB broadphase; also forward-axis projected clearance of knee vertices to outermost front cloth at matching posed x/y. Bind and twenty phases of production baked Jog_Fwd_Loop at speed 3.5. Positive projected clearance = cloth outside knee; gaps excluded. Very negative projected ordering alone can hit another panel behind an open gap, so actual triangle crossings are the primary contact metric. This audits knee armor against outer front cloth only, not all player/armor contacts. Coordinates are metres internally; reported positions millimetres. Reweight and optional parameter tuning mutate documents in memory only.',parameters:{kneeBoost,splitWidth},skinSourceSha256:createHash('sha256').update(await readFile('tools/item-models/tier50-70/skin.ts')).digest('hex'),results},null,2)+'\n');
console.log(`Report: ${out}`);
