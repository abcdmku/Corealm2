import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Run in this directory with node paws-v2.mjs. Only the two named products
// are written. Raw GLB patching preserves every unrelated byte and JSON field.
const base = new URL('./', import.meta.url);
const input = await readFile(new URL('Fox.adaptive-actor.glb', base));
const hash = b => createHash('sha256').update(b).digest('hex');
if (hash(input) !== '07771d082ff31a4a0403fa4c4c3ddbf77c95db5066bf964d8befe8fdff751518') throw Error('Unexpected input hash');
const io = new NodeIO(), doc = await io.readBinary(input), root = doc.getRoot();
const primitive = root.listMeshes()[0].listPrimitives()[0];
const pa = primitive.getAttribute('POSITION'), na = primitive.getAttribute('NORMAL');
const original = pa.getArray().slice(), result = original.slice(), oldNormals = na.getArray().slice();
const indices = primitive.getIndices().getArray(), ji = primitive.getAttribute('JOINTS_0').getArray(), weights = primitive.getAttribute('WEIGHTS_0').getArray();
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
  return new THREE.Matrix4().fromArray(e);
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
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
const frozen=new Set(feet.flatMap(f=>f.contact)), permitted=new Set(feet.flatMap(f=>f.eligible));
const desired=world.map(v=>v.clone());
for(const f of feet){
  const other=feet.find(g=>g.id!==f.id&&g.id.slice(0,4)===f.id.slice(0,4));
  // Use one common frame for each pair. Existing frozen-contact asymmetry is
  // retained; it cannot be corrected without breaking exact contact preservation.
  const cx=(Math.abs(f.cx)+Math.abs(other.cx))/2,cz=(f.cz+other.cz)/2;
  const sole=(f.min+other.min)/2, fore=f.id.startsWith('fore');
  const cutoff=fore?.067:.159;
  for(const i of f.eligible){
    const p=world[i],h=p.y-sole;if(frozen.has(i)||h<=.003||p.y>=cutoff)continue;
    const sign=p.x<0?-1:1,x=Math.abs(p.x)-cx,z=p.z-cz;
    const baseBlend=smooth((h-.003)/.010),legBlend=1-smooth((p.y-.035)/(cutoff-.035));
    const w=baseBlend*legBlend;
    const front=smooth((z+.025)/.052),edge=smooth((z-.006)/.022);
    // Broaden the sides and fill the upper toe wedge. The lower 3 mm is fixed.
    const tx=x*(1+.19*w*(.9+.1*front));
    const toeCleft=[-.014,0,.014].reduce((s,c)=>s+Math.exp(-(((tx-c)/.0025)**2)),0)*.004;
    const tz=z+w*(.0035*front-.001*(1-front)-edge*toeCleft);
    const dome=Math.sqrt(Math.max(0,1-(x/.032)**2));
    const ty=p.y+w*(.014*front+.004*(1-front))*dome;
    desired[i].set(sign*(cx+tx),ty,cz+tz);
    const delta=desired[i].clone().sub(p);if(delta.length()>.029)desired[i].copy(p).add(delta.setLength(.029));
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
  return {name:a.getName(),channels,times};
});
function minY(p,m){
  let min=Infinity,index=-1;
  for(let i=0;i<count;i++){let y=0;const x=p[3*i],py=p[3*i+1],z=p[3*i+2];
    for(let k=0;k<4;k++){const w=weights[4*i+k];if(w){const e=m[ji[4*i+k]];y+=w*(e[1]*x+e[5]*py+e[9]*z+e[13]);}}
    if(y<min){min=y;index=i;}
  }return {min,index};
}
const floors=[], factors=new Float64Array(count).fill(1);
for(const clip of clips){
  let before=Infinity,worst=null;
  for(const time of clip.times){const m=pose(clip,time),v=minY(original,m);if(v.min<before){before=v.min;worst={time,vertex:v.index};}}
  const limit=Math.max(-.001,before-.0003)+1e-8;
  // Each vertex's deformation is a straight segment, so clipping its factor
  // against all sampled floor planes guarantees the sampled animation gate.
  for(const time of clip.times){const m=pose(clip,time);
    for(const i of candidate){let y=0,dy=0;for(let k=0;k<4;k++){const w=weights[4*i+k];if(w){const e=m[ji[4*i+k]];y+=w*(e[1]*original[3*i]+e[5]*original[3*i+1]+e[9]*original[3*i+2]+e[13]);dy+=w*(e[1]*delta[3*i]+e[5]*delta[3*i+1]+e[9]*delta[3*i+2]);}}
      if(dy<0)factors[i]=Math.min(factors[i],Math.max(0,(y-limit)/-dy));
    }
  }
  floors.push({clip:clip.name,samples:clip.times.length,beforeMinimumWorldYM:before,beforeWorst:worst});
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
// Keep the normal change below 0.5 degrees at fixed contact and leg boundaries.
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
  const clip=clips[c];let after=Infinity,worst=null;
  for(const time of clip.times){const v=minY(outPositions,pose(clip,time));if(v.min<after){after=v.min;worst={time,vertex:v.index};}}
  Object.assign(floors[c],{afterMinimumWorldYM:after,afterWorst:worst,deltaM:after-floors[c].beforeMinimumWorldYM,pass:after>=-.001&&after>=floors[c].beforeMinimumWorldYM-.0003});
  console.error(`Output ${clip.name}: ${after.toFixed(9)} m`);
}
const afterWorld=Array.from({length:count},(_,i)=>point(i,outPositions,bind));
const bands=[[0,.3],[.3,1],[1,2],[2,3.5],[3.5,5],[5,7]];
function dimensions(f,points){
  const heightBands=bands.map(([lo,hi])=>{const v=f.region.filter(i=>{const h=(points[i].y-f.min)*100;return h>=lo-1e-8&&h<=hi+1e-8;});return {heightCm:[lo,hi],vertices:v.length,widthCm:v.length?(Math.max(...v.map(i=>points[i].x))-Math.min(...v.map(i=>points[i].x)))*100:null,lengthCm:v.length?(Math.max(...v.map(i=>points[i].z))-Math.min(...v.map(i=>points[i].z)))*100:null};});
  // Fixed interior ellipse, excluding the rear leg-entry quarter. Report the
  // definition so a tall wrist cannot silently stand in for toe thickness.
  const interior=f.region.filter(i=>((points[i].x-f.cx)/.023)**2+((points[i].z-f.cz)/.031)**2<1&&points[i].z>f.cz-.010);
  const knuckles=f.region.filter(i=>points[i].z>=f.cz+.020&&Math.abs(points[i].x-f.cx)<.022);
  return {heightBands,pawThicknessCm:Math.max(...interior.map(i=>points[i].y-f.min))*100,interiorVertices:interior.length,toeKnuckleHeightCm:Math.max(...knuckles.map(i=>points[i].y-f.min))*100,toeKnuckleDefinition:'Maximum height within 2.2 cm of paw centre laterally and at least 2 cm forward of paw centre'};
}
const footReview=feet.map(f=>({id:f.id,regionDefinition:'At least 0.5 total weight on terminal hand/foot joint',vertices:f.region.length,minimumBindWorldYM:f.min,interiorDefinition:{centerWorldXZ:[f.cx,f.cz],ellipseRadiiM:[.023,.031],rearCutoffWorldZM:f.cz-.010},before:dimensions(f,world),after:dimensions(f,afterWorld),contactSetSize:f.contact.length,contactMaxDeltaM:Math.max(...f.contact.map(i=>afterWorld[i].distanceTo(world[i]))),newVerticesInContactBand:f.region.filter(i=>!frozen.has(i)&&afterWorld[i].y<=f.min+.003).length}));
const arrayBytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const roles=new Map(),addRole=(a,s)=>roles.set(a,[...(roles.get(a)||[]),s]);
for(const semantic of primitive.listSemantics())addRole(primitive.getAttribute(semantic),semantic);
addRole(primitive.getIndices(),'indices');addRole(skin.getInverseBindMatrices(),'inverse bind matrices');
for(const a of root.listAnimations())for(const c of a.listChannels()){const name=`${a.getName()}/${c.getTargetNode().getName()}/${c.getTargetPath()}`;addRole(c.getSampler().getInput(),`${name}/input`);addRole(c.getSampler().getOutput(),`${name}/output`);}
const accessorIdentity=root.listAccessors().map((a,i)=>{const b=reread.getRoot().listAccessors()[i],before=hash(arrayBytes(a.getArray())),after=hash(arrayBytes(b.getArray()));return {index:i,name:a.getName(),roles:roles.get(a)||[],type:a.getType(),componentType:a.getComponentType(),count:a.getCount(),bytes:a.getArray().byteLength,beforeSHA256:before,afterSHA256:after,identical:before===after,allowedChange:a===pa||a===na};});
const sourceJSON=JSON.parse(input.subarray(20,20+jsonLength).toString());
const structuralIdentity=['nodes','skins','animations','materials','textures','samplers','images'].map(key=>({section:key,beforeSHA256:hash(JSON.stringify(sourceJSON[key]??null)),afterSHA256:hash(JSON.stringify(json[key]??null)),identical:JSON.stringify(sourceJSON[key])===JSON.stringify(json[key])}));
let unexpectedBinaryBytes=0;const allowedBytes=new Uint8Array(bin.length);for(const id of [rawPrimitive.attributes.POSITION,rawPrimitive.attributes.NORMAL]){const a=json.accessors[id],v=json.bufferViews[a.bufferView],start=(v.byteOffset||0)+(a.byteOffset||0);for(let i=0;i<a.count;i++)allowedBytes.fill(1,start+i*(v.byteStride||12),start+i*(v.byteStride||12)+12);}
for(let i=0;i<bin.length;i++)if(bin[i]!==input[binOffset+i]&&!allowedBytes[i])unexpectedBinaryBytes++;
const maxDisplacement=Math.max(...[...moved].map(i=>world[i].distanceTo(afterWorld[i])));
const checks={allowedAccessorsOnly:accessorIdentity.every(a=>a.identical||a.allowedChange),rigAnimationMaterialTextureSamplerIdentity:structuralIdentity.every(s=>s.identical)&&unexpectedBinaryBytes===0,contactsPreserved:footReview.every(f=>f.contactMaxDeltaM===0&&f.newVerticesInContactBand===0),permittedVerticesOnly:[...moved].every(i=>permitted.has(i)),finiteValues:[...result,...normals].every(Number.isFinite),zeroFlippedTriangles:flipped===0,zeroDegenerateTriangles:degenerate===0,displacementWithin3cm:maxDisplacement<=.03,unchangedRegionNormalsWithinHalfDegree:maxOutsideNormal<.5,allClipFloorsPass:floors.every(f=>f.pass)};
const report={input:{file:'Fox.adaptive-actor.glb',sha256:hash(input),bytes:input.length},output:{file:'Fox.paws-v2.glb',sha256:hash(output),bytes:output.length},method:'Contact-locked distal deformation in skinned bind world coordinates, paired frames, dorsal toe inflation, lateral swell and three shallow clefts; per-vertex animation floor clipping and triangle-fold limiting; area-weighted smooth normals on affected triangle vertices; raw GLB buffer patch.',labException:'User explicitly prohibited browsers and game changes. No visual or gameplay acceptance claimed.',limitations:['Frozen sole vertices cannot be widened to the requested 5.5–6.0 cm footprint.','Exact bilateral equality of existing contact coordinates cannot be introduced while preserving those coordinates.','No browser or external image files created; visual toe-lobe and smooth leg-entry acceptance remains unverified.','test-results/codex-last.md omitted because the user explicitly limited writes to the three named files.'],vertices:count,triangles:indices.length/3,movedVertices:moved.size,maxDisplacementM:maxDisplacement,normalRecomputedVertices:affected.size,maxNormalChangeOutsideEditedSetDegrees:maxOutsideNormal,flippedTriangles:flipped,degenerateTriangles:degenerate,foldLimitPasses:foldPasses,floorLimitedVertices:candidate.filter(i=>factors[i]<1).length,unexpectedBinaryBytes,feet:footReview,accessorIdentity,structuralIdentity,clipFloors:floors,checks,hardConstraintsPassed:Object.values(checks).every(Boolean),visualAcceptance:false};
report.normalBoundaryLimitPasses=normalLimitPasses;
report.symmetry=['fore','hind'].map(prefix=>{
  const left=feet.find(f=>f.id===`${prefix}Left`),right=feet.find(f=>f.id===`${prefix}Right`);
  const pairs=left.region.map(i=>{let closest=-1,error=Infinity;for(const j of right.region){const d=(world[i].x+world[j].x)**2+(world[i].y-world[j].y)**2+(world[i].z-world[j].z)**2;if(d<error){error=d;closest=j;}}return [i,closest];});
  const maxError=points=>Math.max(...pairs.map(([i,j])=>Math.hypot(points[i].x+points[j].x,points[i].y-points[j].y,points[i].z-points[j].z)));
  return {pair:prefix,correspondence:'Nearest reflected input vertex, reused for output',beforeMaxReflectionErrorM:maxError(world),afterMaxReflectionErrorM:maxError(afterWorld),exact:false};
});
report.limitations[2]='In-memory CPU side/top previews show added volume. The four toe lobes are not sufficiently distinct for visual acceptance; the locked sole retains its original pointed outline. No browser or extra image file was used.';
report.shapeTargetsAccepted=false;
report.visualReview={method:'In-memory orthographic CPU triangle previews, before and after, fore/hind side and top views; no browser or saved screenshots',paddedSideVolumeImproved:true,fourDistinctRoundedToeLobesAccepted:false,soleOutlineTargetAccepted:false,exactBilateralSymmetryAccepted:false};
await writeFile(new URL('Fox.paws-v2.glb',base),output);
await writeFile(new URL('paws-v2-review.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(hash(await readFile(new URL('Fox.adaptive-actor.glb',base)))!==hash(input))throw Error('Input changed');
if(!report.hardConstraintsPassed)process.exitCode=1;
