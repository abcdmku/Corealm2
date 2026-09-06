import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
const out=path.resolve('art/rebuild/candidates/finish-bestiary/giant-rat-contact-round2'),io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const baselineBytes=fs.readFileSync(path.join(out,'baseline.glb')),candidateBytes=fs.readFileSync(path.join(out,'giant_rat.glb'));
const baseline=await io.readBinary(baselineBytes),candidate=await io.readBinary(candidateBytes);
const allowed={Walk:['giant_rat_source_29_BackLeg_L_003','giant_rat_source_33_BackLeg_R_003'],Death:['giant_rat_source_14_FrontLeg_R_003']};
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
const changes=[];
for(const a of candidate.getRoot().listAnimations()){
  const old=baseline.getRoot().listAnimations().find(v=>v.getName()===a.getName());
  const entries=animation=>new Map(animation.listChannels().map(c=>[`${c.getTargetNode().getName()}/${c.getTargetPath()}`,c]));
  const prior=entries(old),current=entries(a);
  if(prior.size!==current.size)throw Error('Channel count changed');
  for(const [key,c]of current){const p=prior.get(key);if(!p)throw Error(`New channel ${key}`);const same=equal(c.getSampler().getInput().getArray(),p.getSampler().getInput().getArray())&&equal(c.getSampler().getOutput().getArray(),p.getSampler().getOutput().getArray());if(!same){const permitted=c.getTargetPath()==='rotation'&&(allowed[a.getName()]||[]).includes(c.getTargetNode().getName());changes.push({clip:a.getName(),node:c.getTargetNode().getName(),path:c.getTargetPath(),permitted});if(!permitted)throw Error(`Unapproved channel change ${a.getName()}/${key}`);}}
}
for(let i=0;i<baseline.getRoot().listMeshes().length;i++){
  const a=baseline.getRoot().listMeshes()[i],b=candidate.getRoot().listMeshes()[i];
  for(let j=0;j<a.listPrimitives().length;j++)for(const semantic of a.listPrimitives()[j].listSemantics())if(!equal(a.listPrimitives()[j].getAttribute(semantic).getArray(),b.listPrimitives()[j].getAttribute(semantic).getArray()))throw Error(`Geometry modified ${semantic}`);
}
function compile(doc){
  const list=doc.getRoot().listNodes(),ids=new Map(list.map((n,i)=>[n,i])),parent=Array(list.length).fill(-1);list.forEach((n,i)=>n.listChildren().forEach(c=>parent[ids.get(c)]=i));
  const nodes=list.map(n=>({name:n.getName(),t:new T.Vector3().fromArray(n.getTranslation()),q:new T.Quaternion().fromArray(n.getRotation()),s:new T.Vector3().fromArray(n.getScale()),matrix:new T.Matrix4()}));const rest=nodes.map(n=>({t:n.t.clone(),q:n.q.clone(),s:n.s.clone()}));
  const meshes=list.filter(n=>n.getMesh()).flatMap(n=>n.getMesh().listPrimitives().map(p=>({positions:p.getAttribute('POSITION').getArray(),indices:p.getAttribute('JOINTS_0').getArray(),weights:p.getAttribute('WEIGHTS_0').getArray(),joints:n.getSkin().listJoints().map(j=>ids.get(j)),inverse:n.getSkin().listJoints().map((_,i)=>new T.Matrix4().fromArray(n.getSkin().getInverseBindMatrices().getArray(),i*16))})));
  const animations=new Map(doc.getRoot().listAnimations().map(a=>[a.getName(),a.listChannels().map(c=>({node:ids.get(c.getTargetNode()),field:c.getTargetPath(),times:c.getSampler().getInput().getArray(),values:c.getSampler().getOutput().getArray(),step:c.getSampler().getInterpolation()==='STEP'}))]));
  const sample=(name,time)=>{
    nodes.forEach((n,i)=>{n.t.copy(rest[i].t);n.q.copy(rest[i].q);n.s.copy(rest[i].s);});
    for(const c of animations.get(name)){const times=c.times;let lo=0,hi=times.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(times[mid]<=time)lo=mid;else hi=mid-1;}const a=lo,b=Math.min(a+1,times.length-1),f=a===b||c.step?0:(time-times[a])/(times[b]-times[a]);if(c.field==='rotation')nodes[c.node].q.fromArray(c.values,a*4).slerp(new T.Quaternion().fromArray(c.values,b*4),f);else nodes[c.node][c.field==='translation'?'t':'s'].fromArray(c.values,a*3).lerp(new T.Vector3().fromArray(c.values,b*3),f);}
    const done=new Set(),world=i=>{if(done.has(i))return;nodes[i].matrix.compose(nodes[i].t,nodes[i].q,nodes[i].s);if(parent[i]>=0){world(parent[i]);nodes[i].matrix.premultiply(nodes[parent[i]].matrix);}done.add(i);};nodes.forEach((_,i)=>world(i));
    return meshes.map(m=>{const matrices=m.joints.map((j,k)=>nodes[j].matrix.clone().multiply(m.inverse[k])),output=new Float64Array(m.positions.length);for(let v=0;v<m.positions.length/3;v++){const p=new T.Vector3().fromArray(m.positions,v*3),result=new T.Vector3();for(let k=0;k<4;k++)if(m.weights[v*4+k])result.addScaledVector(p.clone().applyMatrix4(matrices[m.indices[v*4+k]]),m.weights[v*4+k]);result.toArray(output,v*3);}return output;});
  };
  return {nodes,meshes,animations,sample};
}
const before=compile(baseline),after=compile(candidate),rows=[];let seed=0x3917;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(const [name,channels]of after.animations){
  const duration=Math.max(...channels.map(c=>c.times[c.times.length-1])),count=Math.ceil(duration*(allowed[name]?1200:120)),times=Array.from({length:count+1},(_,i)=>duration*i/count);for(let i=0;i<157;i++)times.push(random()*duration);
  const suffixes=allowed[name]||[],row={clip:name,samples:times.length,minimumNativeY:Infinity,minimumCandidateY:Infinity,minimumCorrectedPatchY:Infinity,maximumDeformationMeters:0,maximumUnrelatedDeformationMeters:0};
  for(const time of times){const a=before.sample(name,time),b=after.sample(name,time);for(let m=0;m<a.length;m++){const mesh=after.meshes[m];for(let v=0;v<a[m].length/3;v++){const x=v*3,delta=Math.hypot(a[m][x]-b[m][x],a[m][x+1]-b[m][x+1],a[m][x+2]-b[m][x+2]);row.minimumNativeY=Math.min(row.minimumNativeY,a[m][x+1]);if(b[m][x+1]<row.minimumCandidateY){let strongest=0,dominant='';for(let k=0;k<4;k++)if(mesh.weights[v*4+k]>strongest){strongest=mesh.weights[v*4+k];dominant=after.nodes[mesh.joints[mesh.indices[v*4+k]]].name;}row.worstAny={time,mesh:m,vertex:v,dominantBone:dominant};}row.minimumCandidateY=Math.min(row.minimumCandidateY,b[m][x+1]);row.maximumDeformationMeters=Math.max(row.maximumDeformationMeters,delta);let affected=false;for(let k=0;k<4;k++)if(mesh.weights[v*4+k]>1e-8&&suffixes.includes(after.nodes[mesh.joints[mesh.indices[v*4+k]]].name))affected=true;if(affected){if(b[m][x+1]<row.minimumCorrectedPatchY)row.worstCorrected={time,mesh:m,vertex:v};row.minimumCorrectedPatchY=Math.min(row.minimumCorrectedPatchY,b[m][x+1]);}else row.maximumUnrelatedDeformationMeters=Math.max(row.maximumUnrelatedDeformationMeters,delta);}}}
  if(!Number.isFinite(row.minimumCorrectedPatchY))row.minimumCorrectedPatchY=null;rows.push(row);console.log(JSON.stringify(row));
}
const nativeFile=path.resolve('art/rebuild/candidates/finish-quadrupeds/source-porcupine/cdmir-rat-native.glb'),nativeSha256=createHash('sha256').update(fs.readFileSync(nativeFile)).digest('hex');if(nativeSha256!=='ed0f9a8df62321d9aebcde6c9384a97464f67d9cdabf7f21b1ec2e7e6c3c3047')throw Error('Shared native bytes changed');
const report={nativeSha256,sharedNativeBytesUnchanged:true,candidateSha256:createHash('sha256').update(candidateBytes).digest('hex'),baselineSha256:createHash('sha256').update(baselineBytes).digest('hex'),method:'Independent final-byte NodeIO animation/linear skin evaluation. Changed clips 1200Hz plus157 seeded random times; other clips120Hz plus157random. Same original geometry; exact channel-array comparisons.',jointCount:candidate.getRoot().listSkins()[0].listJoints().length,geometryAttributesUnchanged:true,changes,rows,hold:['Walk front feet','Run','Death head penetration outside approved toe scope'],labAccepted:false};
const passed=!(changes.length!==3||report.jointCount!==133||rows.some(r=>r.maximumUnrelatedDeformationMeters>1e-8||(r.minimumCorrectedPatchY!==null&&r.minimumCorrectedPatchY<0)));report.scopedContactPass=passed;
fs.writeFileSync(path.join(out,'final-byte-contact-audit.json'),JSON.stringify(report,null,2));
const metadataPath=path.join(out,'giant_rat-metadata.json'),metadata=JSON.parse(fs.readFileSync(metadataPath));metadata.contactHold=report.hold;metadata.acceptance={cpuContactAudit:passed?'passes approved toe patches only':'failed',labAccepted:false,hold:report.hold};metadata.finalByteContactAudit={file:'final-byte-contact-audit.json',candidateSha256:report.candidateSha256,maximumDeformationMeters:Math.max(...rows.map(r=>r.maximumDeformationMeters)),changedChannels:changes};fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2));
if(!passed)throw Error('Bounded contact correction audit failed');
