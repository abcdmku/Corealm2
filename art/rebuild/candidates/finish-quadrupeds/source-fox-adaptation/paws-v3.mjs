import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Run from the repository root with node <path-to-this-file>.
// Reuses paws-v2 skinned-world deformation and raw-buffer patching machinery.
// Writes only Fox.paws-v3.glb and paws-v3-review.json beside this generator.
const base = new URL('./', import.meta.url);
const input = await readFile(new URL('Fox.paws-v2.glb', base));
const hash = b => createHash('sha256').update(b).digest('hex');
if (hash(input) !== '2859acf0777b4882f78c99e6b9aac95d5da7f4fe845cc8ab3d48749fee1b3e48') throw Error('Unexpected input hash');
const io = new NodeIO(), doc = await io.readBinary(input), root = doc.getRoot();
if(root.listMeshes().length!==1||root.listSkins().length!==1)throw Error('Expected one mesh and skin');
const primitive = root.listMeshes()[0].listPrimitives()[0];
const pa = primitive.getAttribute('POSITION'), na = primitive.getAttribute('NORMAL');
const original = pa.getArray().slice(), result = original.slice(), oldNormals = na.getArray().slice();
const indices = primitive.getIndices().getArray(), ji = primitive.getAttribute('JOINTS_0').getArray(), weights = primitive.getAttribute('WEIGHTS_0').getArray();
const otherPrimitives=root.listMeshes()[0].listPrimitives().slice(1).map(p=>({positions:p.getAttribute('POSITION').getArray(),joints:p.getAttribute('JOINTS_0').getArray(),weights:p.getAttribute('WEIGHTS_0').getArray(),count:p.getAttribute('POSITION').getCount(),triangles:p.getIndices().getCount()/3,indices:p.getIndices().getArray()}));
const count = pa.getCount(), nodes = root.listNodes(), skin = root.listSkins()[0], joints = skin.listJoints();
const objects = nodes.map(() => new THREE.Object3D()), nodeIndex = new Map(nodes.map((n,i) => [n,i]));
for (let i=0;i<nodes.length;i++) {
  const n=nodes[i], o=objects[i];
  o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale());
  if(n.getParentNode()) objects[nodeIndex.get(n.getParentNode())].add(o);
}
const tops=objects.filter(o=>!o.parent), update=()=>tops.forEach(o=>o.updateMatrixWorld(true));
const inverse=joints.map((_,i)=>new THREE.Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i,[])));
const matrices=()=>joints.map((j,i)=>objects[nodeIndex.get(j)].matrixWorld.clone().multiply(inverse[i]).elements);
function pose(clip,time=0) {
  for(let i=0;i<nodes.length;i++){objects[i].position.fromArray(nodes[i].getTranslation());objects[i].quaternion.fromArray(nodes[i].getRotation());objects[i].scale.fromArray(nodes[i].getScale());}
  if(clip)for(const c of clip.channels){
    const times=c.times;let lo=0,hi=times.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(times[m]<=time)lo=m;else hi=m;}
    const a=c.values.getElement(lo,[]),b=c.values.getElement(hi,[]),t=THREE.MathUtils.clamp((time-times[lo])/(times[hi]-times[lo]||1),0,1),o=objects[c.node];
    if(c.path==='rotation')o.quaternion.fromArray(a).slerp(new THREE.Quaternion().fromArray(b),t);
    else if(c.path==='translation')o.position.fromArray(a).lerp(new THREE.Vector3().fromArray(b),t);
    else if(c.path==='scale')o.scale.fromArray(a).lerp(new THREE.Vector3().fromArray(b),t);
    else throw Error(`Unsupported channel ${c.path}`);
  }
  update();return matrices();
}
function blended(i,m) {
  const e=new Float64Array(16);
  for(let k=0;k<4;k++){const w=weights[4*i+k];if(w)for(let j=0;j<16;j++)e[j]+=w*m[ji[4*i+k]][j];}
  // Weighted skinning is an affine sum, not a homogeneous divide by total weight.
  e[15]=1; return new THREE.Matrix4().fromArray(e);
}
function point(i,p,m) {return new THREE.Vector3().fromArray(p,3*i).applyMatrix4(blended(i,m));}
const bind=pose(), world=Array.from({length:count},(_,i)=>point(i,original,bind));
const jointID=name=>joints.findIndex(j=>j.getName()===name);
const influence=(i,ids)=>{let w=0;for(let k=0;k<4;k++)if(ids.includes(ji[4*i+k]))w+=weights[4*i+k];return w;};
const definitions=[
  ['foreLeft','b_LeftHand_011',null,'b_LeftForeArm_010'],
  ['foreRight','b_RightHand_08',null,'b_RightForeArm_07'],
  ['hindLeft','b_LeftFoot02_018','b_LeftFoot01_017','b_LeftLeg02_016'],
  ['hindRight','b_RightFoot02_022','b_RightFoot01_021','b_RightLeg02_020']
];
const feet=definitions.map(([id,end,mid,upper])=>{
  const distal=[end,mid].filter(Boolean).map(jointID), endID=jointID(end), upperID=jointID(upper);
  const region=Array.from({length:count},(_,i)=>i).filter(i=>influence(i,[endID])>=.5);
  const min=Math.min(...region.map(i=>world[i].y));
  const contact=region.filter(i=>world[i].y<=min+.003);
  const low=region.filter(i=>world[i].y<=min+.035);
  const cx=(Math.min(...low.map(i=>world[i].x))+Math.max(...low.map(i=>world[i].x)))/2;
  const cz=(Math.min(...low.map(i=>world[i].z))+Math.max(...low.map(i=>world[i].z)))/2;
  const upperVerts=Array.from({length:count},(_,i)=>i).filter(i=>influence(i,[upperID])>0).sort((a,b)=>world[a].y-world[b].y||a-b);
  const lower30=new Set(upperVerts.slice(0,Math.floor(upperVerts.length*.3)));
  const eligible=Array.from({length:count},(_,i)=>i).filter(i=>influence(i,distal)>0||lower30.has(i));
  return {id,distal,endID,upperID,region,min,contact,cx,cz,lower30,eligible};
});
if(input.length!==2280448)throw Error('Input size');
for(const f of feet)if(f.region.length!==(f.id.startsWith('fore')?626:405))throw Error('Unexpected foot region size');


const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
const frozen=new Set(feet.flatMap(f=>f.contact)), permitted=new Set(feet.flatMap(f=>f.region));
// Shorten the sole, broaden the middle and heel, and taper horizontally into
// the pastern. Lower the surrounding underside into the contact band while
// retaining every original contact height within 0.1 micrometre. Three dorsal
// clefts and unequal inner-toe swell operate above the contact patch.
const desired=world.map(v=>v.clone());
for(const f of feet){
 const fore=f.id.startsWith('fore'),sgn=f.cx<0?-1:1,cx=Math.abs(f.cx),cz=fore?.219:-.303;
 for(const i of f.region){
  const p=world[i],h=p.y-f.min,w=1-smooth((h-.014)/.035),x=Math.abs(p.x)-cx,z=p.z-cz;
  let tx=x*(fore?1.13:1.06),tz=z*(fore?.73:.84);
  if(fore&&tz>.021)tz=.021+(tz-.021)*.35;
  if(fore)tx*=1+.025*Math.exp(-(((z+.004)/.012)**2));
  if(!fore&&tz<-.022)tz=-.022+(tz+.022)*.4;
  const front=smooth((z+.008)/.028);
  if(!fore)tx*=1+.3*front;
  if(fore)tz+=.004*(Math.exp(-(((tx+.006)/.0038)**2))+Math.exp(-(((tx-.006)/.005)**2)))*front*smooth((h-.009)/.007);
  const cleft=[-.013,0,.013].reduce((a,c)=>a+Math.exp(-(((tx-c)/.0028)**2)),0);
  tz-=(fore?.006:.009)*cleft*front*smooth((h-.009)/.007);
  if(!fore)tz-=.004*smooth((Math.abs(x+(tx-x)*w)-.017)/.01)*front*smooth((h-.009)/.007);
  let ty=p.y;
  if(!frozen.has(i)&&h<.055){const target=h<.009?.0027:.0027+(h-.009)*.4;ty=f.min+target+(h-target)*smooth((h-.032)/.023);}
  desired[i].set(sgn*(cx+x+(tx-x)*w),ty+1e-7*w,cz+z+(tz-z)*w);
 }
}
const delta=original.map(()=>0),candidate=[];
for(let i=0;i<count;i++)if(desired[i].distanceToSquared(world[i])>1e-22){
  const raw=desired[i].clone().applyMatrix4(blended(i,bind).invert());
  for(let k=0;k<3;k++)delta[3*i+k]=raw.getComponent(k)-original[3*i+k];candidate.push(i);
}
// All channel key times, plus each channel interval midpoint and union interval
// midpoints. The additional channel midpoints make the requested gate explicit.
const clips=root.listAnimations().map(a=>{
  const channels=a.listChannels().map(c=>{if(c.getSampler().getInterpolation()!=='LINEAR')throw Error('Expected LINEAR sampler');return {node:nodeIndex.get(c.getTargetNode()),path:c.getTargetPath(),times:Array.from(c.getSampler().getInput().getArray()),values:c.getSampler().getOutput()};});
  const keys=[...new Set(channels.flatMap(c=>c.times))].sort((a,b)=>a-b);
  const times=[...new Set([...keys,...keys.slice(1).map((t,i)=>(t+keys[i])/2),...channels.flatMap(c=>c.times.slice(1).map((t,i)=>(t+c.times[i])/2))])].sort((a,b)=>a-b);
  return {name:a.getName(),channels,times,keyTimes:keys};
});
function minY(p,m){
  let min=Infinity,index=-1;
  for(let i=0;i<count;i++){let y=0;const x=p[3*i],py=p[3*i+1],z=p[3*i+2];
    for(let k=0;k<4;k++){const w=weights[4*i+k];if(w){const e=m[ji[4*i+k]];y+=w*(e[1]*x+e[5]*py+e[9]*z+e[13]);}}
    if(y<min){min=y;index=i;}
  }
  let offset=count;
  for(const p of otherPrimitives){for(let i=0;i<p.count;i++){let y=0;for(let k=0;k<4;k++){const w=p.weights[4*i+k];if(w){const e=m[p.joints[4*i+k]];y+=w*(e[1]*p.positions[3*i]+e[5]*p.positions[3*i+1]+e[9]*p.positions[3*i+2]+e[13]);}}if(y<min){min=y;index=offset+i;}}offset+=p.count;}
  return {min,index};
}
const floors=[], factors=new Float64Array(count).fill(1);
for(const clip of clips){
  let before=Infinity,worst=null;
  for(const time of clip.times){const m=pose(clip,time),v=minY(original,m);if(v.min<before){before=v.min;worst={time,vertex:v.index};}}
  
  // Each vertex's deformation is a straight segment, so clipping its factor
  // against all sampled floor planes guarantees the sampled animation gate.
  for(const time of clip.times){const m=pose(clip,time),limit=minY(original,m).min-.00048+1e-8;
    for(const i of candidate){let y=0,dy=0;for(let k=0;k<4;k++){const w=weights[4*i+k];if(w){const e=m[ji[4*i+k]];y+=w*(e[1]*original[3*i]+e[5]*original[3*i+1]+e[9]*original[3*i+2]+e[13]);dy+=w*(e[1]*delta[3*i]+e[5]*delta[3*i+1]+e[9]*delta[3*i+2]);}}
      if(dy<0)factors[i]=Math.min(factors[i],Math.max(0,(y-limit)/-dy));
    }
  }
  floors.push({clip:clip.name,samples:clip.times.length,keyTimeCount:clip.keyTimes.length,sampleTimesSeconds:clip.times,beforeMinimumWorldYM:before,beforeWorst:worst});
  console.error(`Baseline ${clip.name}: ${before.toFixed(9)} m, ${clip.times.length} samples`);
}
// Couple mirrored partners when limiting deformations, including local folds.
const partners=new Int32Array(count).fill(-1);
for(const i of candidate)if(world[i].x>0){let best=-1,error=Infinity;for(const j of candidate)if(world[j].x<0){const d=(world[i].x+world[j].x)**2+(world[i].y-world[j].y)**2+(world[i].z-world[j].z)**2;if(d<error){error=d;best=j;}}if(error<1e-8){partners[i]=best;partners[best]=i;}}
const sync=()=>{for(const i of candidate)if(partners[i]>=0)factors[i]=factors[partners[i]]=Math.min(factors[i],factors[partners[i]]);};
const apply=()=>{sync();for(const i of candidate)for(let k=0;k<3;k++)result[3*i+k]=original[3*i+k]+delta[3*i+k]*factors[i];};
function face(p,t){const a=indices[t]*3,b=indices[t+1]*3,c=indices[t+2]*3;return new THREE.Vector3(p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]).cross(new THREE.Vector3(p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]));}
const oldFaces=Array.from({length:indices.length/3},(_,i)=>face(original,3*i));

let foldPasses=0;
for(;foldPasses<160;foldPasses++){
  apply();const bad=new Set();
  for(let t=0;t<indices.length;t+=3){const n=face(result,t);if(n.dot(oldFaces[t/3])<=0||n.lengthSq()<1e-20)for(let k=0;k<3;k++)if(factors[indices[t+k]]>0)bad.add(indices[t+k]);}
  if(!bad.size)break;for(const i of bad)factors[i]*=.8;
}
apply();
// Keep the normal change below 0.5 degrees at stationary mesh boundaries.
// Damp only the movable one-ring neighbours, then recompute from geometry.
const adjacency=Array.from({length:count},()=>new Set());
for(let t=0;t<indices.length;t+=3)for(let k=0;k<3;k++)for(let j=0;j<3;j++)adjacency[indices[t+k]].add(indices[t+j]);
let normalLimitPasses=0;
for(;normalLimitPasses<100;normalLimitPasses++){
  const active=new Set(candidate.filter(i=>[0,1,2].some(k=>result[3*i+k]!==original[3*i+k])));
  const boundary=new Set([...active].flatMap(i=>[...adjacency[i]]).filter(i=>!active.has(i)));
  const sums=new Float64Array(original.length);
  for(let t=0;t<indices.length;t+=3){if(![0,1,2].some(k=>boundary.has(indices[t+k])))continue;const n=face(result,t);for(let k=0;k<3;k++){const i=indices[t+k];if(boundary.has(i)){sums[3*i]+=n.x;sums[3*i+1]+=n.y;sums[3*i+2]+=n.z;}}}
  const damp=new Set();
  for(const i of boundary){const n=new THREE.Vector3().fromArray(sums,3*i),a=new THREE.Vector3().fromArray(oldNormals,3*i).angleTo(n)*180/Math.PI;if(a>.48)for(const j of adjacency[i])if(active.has(j))damp.add(j);}
  for(let t=0;t<indices.length;t+=3){const n=face(result,t);if(n.dot(oldFaces[t/3])<=0||n.lengthSq()<1e-20)for(let k=0;k<3;k++)if(active.has(indices[t+k]))damp.add(indices[t+k]);}
  if(!damp.size)break;for(const i of damp)factors[i]*=.7;apply();
}
const moved=new Set(candidate.filter(i=>[0,1,2].some(k=>result[3*i+k]!==original[3*i+k])));
const affected=new Set();let flipped=0,degenerate=0;
const accumulated=new Float64Array(original.length);
for(let t=0;t<indices.length;t+=3){
  const n=face(result,t);if(n.dot(oldFaces[t/3])<0)flipped++;if(n.lengthSq()<1e-20)degenerate++;
  if([0,1,2].some(k=>moved.has(indices[t+k])))for(let k=0;k<3;k++)affected.add(indices[t+k]);
  for(let k=0;k<3;k++){const offset=indices[t+k]*3;accumulated[offset]+=n.x;accumulated[offset+1]+=n.y;accumulated[offset+2]+=n.z;}
}
const normals=oldNormals.slice();
for(const i of affected){const n=new THREE.Vector3().fromArray(accumulated,3*i).normalize();n.toArray(normals,3*i);}
let maxOutsideNormal=0;
for(let i=0;i<count;i++)if(!moved.has(i))maxOutsideNormal=Math.max(maxOutsideNormal,new THREE.Vector3().fromArray(oldNormals,3*i).angleTo(new THREE.Vector3().fromArray(normals,3*i))*180/Math.PI);

// Preserve binary layout, indices, rig, animation, images and material/sampler
// JSON verbatim. Only POSITION/NORMAL payloads and POSITION bounds change.
const jsonLength=input.readUInt32LE(12),json=JSON.parse(input.subarray(20,20+jsonLength).toString());
const binOffset=20+jsonLength+8, bin=Buffer.from(input.subarray(binOffset));
const rawPrimitive=json.meshes[0].primitives[0];
function patchAccessor(id,array){const a=json.accessors[id],v=json.bufferViews[a.bufferView];if(a.sparse)throw Error('Unexpected sparse accessor');const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||12;for(let i=0;i<a.count;i++)bytes.copy(bin,offset+i*stride,i*12,i*12+12);}
patchAccessor(rawPrimitive.attributes.POSITION,result);patchAccessor(rawPrimitive.attributes.NORMAL,normals);
const positionJSON=json.accessors[rawPrimitive.attributes.POSITION];
positionJSON.min=[0,1,2].map(k=>{let v=Infinity;for(let i=k;i<result.length;i+=3)v=Math.min(v,result[i]);return v;});
positionJSON.max=[0,1,2].map(k=>{let v=-Infinity;for(let i=k;i<result.length;i+=3)v=Math.max(v,result[i]);return v;});
let jsonBytes=Buffer.from(JSON.stringify(json));jsonBytes=Buffer.concat([jsonBytes,Buffer.alloc((4-jsonBytes.length%4)%4,32)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+jsonBytes.length+8+bin.length,8);header.writeUInt32LE(jsonBytes.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const output=Buffer.concat([header,jsonBytes,binHeader,bin]);
const reread=await io.readBinary(output),op=reread.getRoot().listMeshes()[0].listPrimitives()[0],outPositions=op.getAttribute('POSITION').getArray();
for(let c=0;c<clips.length;c++){
  const clip=clips[c];let after=Infinity,worst=null,worstPoseDeltaM=Infinity,worstPoseDelta=null;
  for(const time of clip.times){const m=pose(clip,time),v=minY(outPositions,m),b=minY(original,m);if(v.min<after){after=v.min;worst={time,vertex:v.index};}if(v.min-b.min<worstPoseDeltaM){worstPoseDeltaM=v.min-b.min;worstPoseDelta={time,beforeMinimumWorldYM:b.min,afterMinimumWorldYM:v.min,beforeVertex:b.index,afterVertex:v.index};}}
  Object.assign(floors[c],{afterMinimumWorldYM:after,afterWorst:worst,worstPoseDeltaM,worstPoseDelta,deltaM:after-floors[c].beforeMinimumWorldYM,pass:after>=floors[c].beforeMinimumWorldYM-.0005&&worstPoseDeltaM>=-.0005});
  console.error(`Output ${clip.name}: ${after.toFixed(9)} m`);
}
const afterWorld=Array.from({length:count},(_,i)=>point(i,outPositions,bind));
let worldFlipped=0,worldDegenerate=0,minWorldDoubleAreaM2=Infinity,minWorldFaceCosine=1;
for(let t=0;t<indices.length;t+=3){const [a,b,c]=[indices[t],indices[t+1],indices[t+2]],n0=world[b].clone().sub(world[a]).cross(world[c].clone().sub(world[a])),n1=afterWorld[b].clone().sub(afterWorld[a]).cross(afterWorld[c].clone().sub(afterWorld[a]));if(n0.dot(n1)<=0)worldFlipped++;if(n1.lengthSq()<1e-28)worldDegenerate++;minWorldDoubleAreaM2=Math.min(minWorldDoubleAreaM2,n1.length());minWorldFaceCosine=Math.min(minWorldFaceCosine,n0.dot(n1)/(n0.length()*n1.length()));}

for(const p of otherPrimitives){const pts=Array.from({length:p.count},(_,i)=>{const q=new THREE.Vector3();for(let k=0;k<4;k++){const w=p.weights[4*i+k];if(w)q.add(new THREE.Vector3().fromArray(p.positions,3*i).applyMatrix4(new THREE.Matrix4().fromArray(bind[p.joints[4*i+k]])).multiplyScalar(w));}return q;});for(let t=0;t<p.indices.length;t+=3){const a=pts[p.indices[t]],n=pts[p.indices[t+1]].clone().sub(a).cross(pts[p.indices[t+2]].clone().sub(a));if(n.lengthSq()<1e-28)worldDegenerate++;minWorldDoubleAreaM2=Math.min(minWorldDoubleAreaM2,n.length());}}

function dimensions(f,points){
 const low=Math.min(...f.region.map(i=>points[i].y)),contact=f.region.filter(i=>points[i].y<=low+.003),ext=(ids,k)=>[Math.min(...ids.map(i=>points[i][k])),Math.max(...ids.map(i=>points[i][k]))];
 const [xmin,xmax]=ext(contact,'x'),[zmin,zmax]=ext(contact,'z');
 const profile=Array.from({length:8},(_,s)=>{const ids=contact.filter(i=>points[i].z>=zmin+s/8*(zmax-zmin)-1e-9&&points[i].z<=zmin+(s+1)/8*(zmax-zmin)+1e-9);const e=ext(ids,'x');return {vertices:ids.length,widthCm:ids.length?(e[1]-e[0])*100:0};});
 const band=f.region.filter(i=>points[i].y>=low+.003&&points[i].y<=low+.015),[bx0,bx1]=ext(band,'x');
 const curve=Array.from({length:16},(_,b)=>{const ids=band.filter(i=>Math.min(15,Math.floor((points[i].x-bx0)/(bx1-bx0)*16))===b);return ids.length?Math.max(...ids.map(i=>points[i].z)):null;});
 const maxima=curve.flatMap((v,i)=>v!==null&&(i===0||(curve[i-1]!==null&&v>curve[i-1]))&&(i===15||(curve[i+1]!==null&&v>=curve[i+1]))?[i]:[]),clefts=[];
 for(let i=1;i<15;i++)if(curve[i]!==null&&curve[i-1]!==null&&curve[i+1]!==null&&curve[i]<curve[i-1]&&curve[i]<=curve[i+1]){const l=maxima.filter(j=>j<i).at(-1),r=maxima.find(j=>j>i);if(l!==undefined&&r!==undefined)clefts.push({bin:i+1,leftMaximumBin:l+1,rightMaximumBin:r+1,prominenceM:Math.min(curve[l],curve[r])-curve[i],worldX:bx0+(i+.5)/16*(bx1-bx0),worldZ:curve[i],leftMaximumWorldZ:curve[l],rightMaximumWorldZ:curve[r]});}
 const valid=clefts.filter(c=>c.prominenceM>=.002),lobes=maxima.map(b=>{const left=valid.filter(c=>c.bin<b+1).at(-1),right=valid.find(c=>c.bin>b+1),lo=left?left.bin-.5:0,hi=right?right.bin-.5:16;return {bin:b+1,worldX:bx0+(b+.5)/16*(bx1-bx0),worldZ:curve[b],leftWorldX:bx0+lo/16*(bx1-bx0),rightWorldX:bx0+hi/16*(bx1-bx0),widthM:(bx1-bx0)/16*(hi-lo)};});
 const four=lobes.length===4&&valid.length>=3,innerFurther=four&&Math.min(lobes[1].worldZ,lobes[2].worldZ)>Math.max(lobes[0].worldZ,lobes[3].worldZ),unequal=four&&Math.max(...lobes.map(l=>l.widthM))-Math.min(...lobes.map(l=>l.widthM))>1e-6;
 const interior=f.region.filter(i=>((points[i].x-f.cx)/.023)**2+((points[i].z-f.cz)/.031)**2<1&&points[i].z>f.cz-.010);
 return {lowestWorldYM:low,contactVertices:contact.length,contactWidthCm:(xmax-xmin)*100,contactLengthCm:(zmax-zmin)*100,aspect:(xmax-xmin)/(zmax-zmin),widthProfileCm:profile,bandVertices:band.length,bandWorldXRange:[bx0,bx1],forwardExtent16BinsWorldZM:curve,clefts,lobes,detectedCleftCount:valid.length,detectedLobeCount:lobes.length,innerLobesFurtherForward:innerFurther,unequalLobeWidths:unequal,toePass:curve.every(v=>v!==null)&&four&&innerFurther&&unequal,v2InteriorThicknessCm:(Math.max(...interior.map(i=>points[i].y))-low)*100,pawThicknessCm:(Math.max(...f.region.map(i=>points[i].y))-low)*100};
}
const footReview=feet.map(f=>({id:f.id,bone:joints[f.endID].getName(),interiorCentreWorldXZ:[f.cx,f.cz],vertices:f.region.length,contactSetSize:f.contact.length,before:dimensions(f,world),after:dimensions(f,afterWorld),contactMaxHeightDeltaM:Math.max(...f.contact.map(i=>Math.abs(afterWorld[i].y-world[i].y)))}));
const arrayBytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const roles=new Map(),addRole=(a,s)=>roles.set(a,[...(roles.get(a)||[]),s]);
for(const semantic of primitive.listSemantics())addRole(primitive.getAttribute(semantic),semantic);
addRole(primitive.getIndices(),'indices');addRole(skin.getInverseBindMatrices(),'inverse bind matrices');
for(const a of root.listAnimations())for(const c of a.listChannels()){const name=`${a.getName()}/${c.getTargetNode().getName()}/${c.getTargetPath()}`;addRole(c.getSampler().getInput(),`${name}/input`);addRole(c.getSampler().getOutput(),`${name}/output`);}
const accessorIdentity=root.listAccessors().map((a,i)=>{const b=reread.getRoot().listAccessors()[i],before=hash(arrayBytes(a.getArray())),after=hash(arrayBytes(b.getArray()));return {index:i,name:a.getName(),roles:roles.get(a)||[],type:a.getType(),componentType:a.getComponentType(),count:a.getCount(),bytes:a.getArray().byteLength,beforeSHA256:before,afterSHA256:after,identical:before===after,allowedChange:a===pa||a===na};});
const sourceJSON=JSON.parse(input.subarray(20,20+jsonLength).toString());
const compactSourceJSON=input.subarray(20,20+jsonLength).toString().trimEnd()===JSON.stringify(sourceJSON);
const compactOutputJSON=jsonBytes.toString().trimEnd()===JSON.stringify(json);
if(!compactSourceJSON||!compactOutputJSON)throw Error('Raw section hash extraction requires compact JSON');
for(const row of accessorIdentity){const before=JSON.stringify(sourceJSON.accessors[row.index]),after=JSON.stringify(json.accessors[row.index]);Object.assign(row,{beforeDescriptorSHA256:hash(before),afterDescriptorSHA256:hash(after),descriptorIdentical:before===after});}
const unrelatedJSONIdentity=Object.keys(sourceJSON).filter(k=>k!=='accessors').every(k=>JSON.stringify(sourceJSON[k])===JSON.stringify(json[k]));
const structuralIdentity=['nodes','skins','animations','materials','textures','samplers','images'].map(key=>({section:key,beforeSHA256:hash(JSON.stringify(sourceJSON[key]??null)),afterSHA256:hash(JSON.stringify(json[key]??null)),presentBefore:key in sourceJSON,presentAfter:key in json,identical:JSON.stringify(sourceJSON[key])===JSON.stringify(json[key]),hashEncoding:'Exact compact UTF-8 JSON section value; null denotes an absent section'}));
let unexpectedBinaryBytes=0;const allowedBytes=new Uint8Array(bin.length);for(const id of [rawPrimitive.attributes.POSITION,rawPrimitive.attributes.NORMAL]){const a=json.accessors[id],v=json.bufferViews[a.bufferView],start=(v.byteOffset||0)+(a.byteOffset||0);for(let i=0;i<a.count;i++)allowedBytes.fill(1,start+i*(v.byteStride||12),start+i*(v.byteStride||12)+12);}
for(let i=0;i<bin.length;i++)if(bin[i]!==input[binOffset+i]&&!allowedBytes[i])unexpectedBinaryBytes++;
const originalBytes=arrayBytes(original),resultBytes=arrayBytes(outPositions),normalBytes=arrayBytes(normals),oldNormalBytes=arrayBytes(oldNormals);
const outsideIDs=Array.from({length:count},(_,i)=>i).filter(i=>!permitted.has(i));
const outsideBefore=Buffer.concat(outsideIDs.map(i=>originalBytes.subarray(i*12,i*12+12))),outsideAfter=Buffer.concat(outsideIDs.map(i=>resultBytes.subarray(i*12,i*12+12)));
const outsidePositionIdentity={vertices:outsideIDs.length,beforeSHA256:hash(outsideBefore),afterSHA256:hash(outsideAfter),bitIdentical:outsideBefore.equals(outsideAfter)};
const normalSupportOnly=Array.from({length:count},(_,i)=>i).filter(i=>!affected.has(i)).every(i=>normalBytes.subarray(i*12,i*12+12).equals(oldNormalBytes.subarray(i*12,i*12+12)));
const maxDisplacement=Math.max(...[...moved].map(i=>world[i].distanceTo(afterWorld[i])));

const symmetry=['fore','hind'].map(prefix=>{const l=feet.find(f=>f.id===prefix+'Left'),r=feet.find(f=>f.id===prefix+'Right');const pairs=l.region.map(i=>{let closest=-1,error=Infinity;for(const j of r.region){const d=(world[i].x+world[j].x)**2+(world[i].y-world[j].y)**2+(world[i].z-world[j].z)**2;if(d<error){error=d;closest=j;}}return [i,closest];});const err=p=>Math.max(...pairs.map(([i,j])=>Math.hypot(p[i].x+p[j].x,p[i].y-p[j].y,p[i].z-p[j].z)));return {pair:prefix,correspondence:'Nearest reflected input vertex in opposite foot, held fixed for output',beforeMaxReflectionErrorM:err(world),afterMaxReflectionErrorM:err(afterWorld)};});
const between=(v,l,h)=>v>=l&&v<=h;
const constraints={1:unrelatedJSONIdentity&&accessorIdentity.every(a=>(a.identical&&a.descriptorIdentical)||a.allowedChange)&&structuralIdentity.every(s=>s.identical)&&unexpectedBinaryBytes===0,2:outsidePositionIdentity.bitIdentical&&[...moved].every(i=>permitted.has(i)),3:footReview.every(f=>f.contactMaxHeightDeltaM<=.0002&&f.after.lowestWorldYM>=f.before.lowestWorldYM),4:maxDisplacement<=.03&&worldFlipped===0&&worldDegenerate===0&&flipped===0&&degenerate===0&&[...result,...normals,...otherPrimitives.flatMap(p=>Array.from(p.positions))].every(Number.isFinite),5:normalSupportOnly&&maxOutsideNormal<=.5,6:symmetry.every(s=>s.afterMaxReflectionErrorM<=.0002),7:floors.length===8&&floors.every(f=>f.pass)};
const targets={A:footReview.filter(f=>f.id.startsWith('fore')).every(({after:a})=>between(a.contactWidthCm,5.2,6)&&between(a.contactLengthCm,5,6.2)&&between(a.aspect,.85,1.15)),B:footReview.filter(f=>f.id.startsWith('hind')).every(({after:a})=>between(a.contactWidthCm,4.9,5.6)&&between(a.contactLengthCm,5.5,6.6)&&between(a.aspect,.78,1)),C:footReview.every(({after:a})=>{const p=a.widthProfileCm.map(s=>s.widthCm),max=Math.max(...p);return p.every(w=>w>0)&&p.some((w,i)=>i>=2&&i<=5&&w===max)&&p[0]>=max*.4&&p[7]>=max*.45;}),D:footReview.every(f=>f.after.toePass),E:footReview.every(f=>between(f.after.pawThicknessCm/f.before.pawThicknessCm,.9,1.1)&&between(f.after.v2InteriorThicknessCm/f.before.v2InteriorThicknessCm,.9,1.1))};
const report={input:{file:'Fox.paws-v2.glb',bytes:input.length,sha256:hash(input)},output:{file:'Fox.paws-v3.glb',bytes:output.length,sha256:hash(output)},units:'Bind-pose skinned world coordinates are metres; no additional scene scale applied.',labException:'The user requires CPU/Node only and prohibits browser and game changes.',measurementDefinitions:{contact:'Terminal joint weight >=0.5, within 0.003 m of region minimum Y.',profile:'Eight equal rear-to-front Z slices, inclusive 1e-9 m boundaries, as in the project audit.',toeCurve:'Maximum world Z in each of 16 equal X bins in the 0.003 to 0.015 m height band. Local minima compared with nearest local maxima on both sides.',thickness:'Full terminal-joint region maximum Y minus minimum Y, sole through wrist/ankle transition. Also retain the v2 interior-ellipse measurement within 10%.',v2Interior:'Within an ellipse with X/Z radii 0.023/0.031 m centred on input low-region bounds, excluding Z below centre minus 0.010 m; same fixed centres for before and after.',normals:'Area-weighted sum of incident face crosses at vertices on triangles touching moved vertices. Unchanged incident triangles contribute their unchanged areas; normals outside this support remain bit-identical.',clipFloors:'All channel key times, all channel interval midpoints, and union-key interval midpoints. Every sampled pose compares minima across all 18674 skinned vertices, including the two unchanged 120-vertex primitives against that same input pose.'},vertices:count+otherPrimitives.reduce((n,p)=>n+p.count,0),triangles:indices.length/3+otherPrimitives.reduce((n,p)=>n+p.triangles,0),editedPrimitive:{mesh:0,primitive:0,vertices:count,triangles:indices.length/3},unchangedPrimitives:otherPrimitives.map((p,i)=>({mesh:0,primitive:i+1,vertices:p.count,triangles:p.triangles})),movedVertices:moved.size,maxDisplacementM:maxDisplacement,flippedTriangles:worldFlipped,degenerateTriangles:worldDegenerate,minWorldDoubleAreaM2,minWorldFaceCosine,localOrientationChecks:{flipped,degenerate},maxNormalChangeOnUnmovedVertexDegrees:maxOutsideNormal,normalRecomputedVertices:affected.size,foldPasses,normalLimitPasses,feet:footReview,accessorIdentity,structuralIdentity,unrelatedJSONIdentity,outsidePositionIdentity,normalSupportOnly,unexpectedBinaryBytes,symmetry,clipFloors:floors,constraints,targets};
await writeFile(new URL('Fox.paws-v3.glb',base),output);
const {spawnSync}=await import('node:child_process');
const audit=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/creature-expansion/mammals/paw-contact-audit.mjs','art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/Fox.paws-v3.glb','--band','0.003','--map'],{encoding:'utf8',shell:false,env:{...process.env,TSX_DISABLE_CACHE:'1',npm_config_offline:'true',npm_config_yes:'false',npm_config_update_notifier:'false'},maxBuffer:8*1024*1024});
report.independentAuditCommand='node node_modules/tsx/dist/cli.mjs tools/creature-expansion/mammals/paw-contact-audit.mjs art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/Fox.paws-v3.glb --band 0.003 --map';
report.independentAuditLauncherNote='npx is unavailable in this environment. The installed local tsx CLI executes the exact unmodified project audit. No install or network is used; tsx caching is disabled.';
report.independentAuditSourceSHA256=hash(await readFile('tools/creature-expansion/mammals/paw-contact-audit.mjs'));
report.independentAudit=audit.stdout;report.independentAuditExitCode=audit.status;report.independentAuditStderr=audit.stderr;
if(audit.status===0){const independent=JSON.parse(audit.stdout);report.independentAuditMatches=independent.sha256===hash(output)&&footReview.every(f=>{const a=independent.feet.find(g=>g.bone===f.bone);return a&&a.regionVertices===f.vertices&&a.contactVertices===f.after.contactVertices&&a.contactWidthCm===Number(f.after.contactWidthCm.toFixed(2))&&a.contactLengthCm===Number(f.after.contactLengthCm.toFixed(2))&&a.aspect===Number(f.after.aspect.toFixed(3))&&a.widthProfileCm.every((s,i)=>s.widthCm===Number(f.after.widthProfileCm[i].widthCm.toFixed(2)));});}
for(const f of footReview){f.minimumHeightDeltaM=f.after.lowestWorldYM-f.before.lowestWorldYM;
const p=f.after.widthProfileCm.map(s=>s.widthCm),max=Math.max(...p);f.profileChecks={noEmptyOrZeroWidthSlice:p.every(w=>w>0),maximumSlices:p.flatMap((w,i)=>w===max?[i+1]:[]),rearToMaximumRatio:p[0]/max,frontToMaximumRatio:p[7]/max};f.thicknessRatio=f.after.pawThicknessCm/f.before.pawThicknessCm;f.v2InteriorThicknessRatio=f.after.v2InteriorThicknessCm/f.before.v2InteriorThicknessCm;}
await writeFile(new URL('paws-v3-review.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({constraints,targets,feet:footReview.map(f=>({id:f.id,after:f.after})),symmetry,flipped,degenerate,maxDisplacement,maxOutsideNormal,auditStatus:audit.status},null,2));
if(hash(await readFile(new URL('Fox.paws-v2.glb',base)))!==hash(input))throw Error('Input changed');
if(audit.status!==0||!report.independentAuditMatches||![...Object.values(constraints),...Object.values(targets)].every(Boolean))process.exitCode=1;
