import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {jointRecoil,HIT_PROVENANCE} from './joint-recoil.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const SOURCE=path.join(ROOT,'art/rebuild/candidates/finish-bestiary/retained-unhorned15');
const REVISION='retained-skeleton-hit-round1';
const OUTPUT=path.join(SOURCE,'..',REVISION);
const FROZEN={soldier:['b322df501fd9e916fba28eb1e6b067beb7783b142f586c1a85e973d9cd530426',561416],archer:['490c761d848958e18bec8350949b990371e2782702a17a99ed9983700622f524',649832],mage:['68d88c7916a4892cf260f591e161100d12e72d909c0b1f04bbf74ca040658792',583684]};
const HITS=[['Hit',0],['HitLeft',1],['HitRight',-1]];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonHash=value=>hash(JSON.stringify(value));
const finite=value=>{if(typeof value==='number')assert(Number.isFinite(value),'Nonfinite value');else if(value&&typeof value==='object')for(const item of Object.values(value))finite(item);};
const properties={translation:'position',rotation:'quaternion',scale:'scale'};
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
const types={5120:[1,'readInt8'],5121:[1,'readUInt8'],5122:[2,'readInt16LE'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']};

function parse(bytes) {
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const chunks=[];let offset=12;
  while(offset<bytes.length){const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);assert.equal(length%4,0);assert(offset+8+length<=bytes.length);chunks.push({type,data:bytes.subarray(offset+8,offset+8+length)});offset+=8+length;}
  assert.equal(offset,bytes.length);assert.equal(chunks.length,2);assert.equal(chunks[0].type,0x4e4f534a);assert.equal(chunks[1].type,0x004e4942);
  const g=JSON.parse(chunks[0].data.toString()),bin=chunks[1].data;finite(g);
  assert.equal(g.buffers.length,1);assert(!g.buffers[0].uri);assert(g.buffers[0].byteLength<=bin.length&&bin.length-g.buffers[0].byteLength<4);
  for(const view of g.bufferViews){assert.equal(view.buffer,0);assert((view.byteOffset??0)+view.byteLength<=g.buffers[0].byteLength);}
  return {g,bin};
}
function accessor(doc,index,raw=false) {
  const a=doc.g.accessors[index],view=doc.g.bufferViews[a.bufferView];assert(!a.sparse,'Sparse accessor unsupported');
  const [size,read]=types[a.componentType]??[],width=widths[a.type];assert(size&&width);const stride=view.byteStride??size*width,start=(view.byteOffset??0)+(a.byteOffset??0);
  assert((a.byteOffset??0)+(a.count-1)*stride+width*size<=view.byteLength);
  const chunks=[],values=[];
  for(let i=0;i<a.count;i++){
    chunks.push(doc.bin.subarray(start+i*stride,start+i*stride+width*size));
    if(!raw)for(let j=0;j<width;j++){let v=doc.bin[read](start+i*stride+j*size);if(a.normalized){assert(a.componentType!==5126);v=a.componentType===5121?v/255:a.componentType===5123?v/65535:a.componentType===5120?Math.max(v/127,-1):Math.max(v/32767,-1);}assert(Number.isFinite(v));values.push(v);}
  }
  return raw?Buffer.concat(chunks):values;
}
function rig(doc) {
  const {g}=doc,joints=new Set(g.skins.flatMap(s=>s.joints));
  const nodes=g.nodes.map((n,i)=>{const o=joints.has(i)?new THREE.Bone():new THREE.Group();o.name=n.name??String(i);if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}return o;});
  g.nodes.forEach((n,i)=>n.children?.forEach(child=>nodes[i].add(nodes[child])));
  const object=new THREE.Group();for(const index of g.scenes[g.scene??0].nodes)object.add(nodes[index]);object.updateMatrixWorld(true);
  const rest=nodes.map(n=>[n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()]);
  const clips=g.animations.map(a=>new THREE.AnimationClip(a.name,-1,a.channels.map(c=>{
    const s=a.samplers[c.sampler];assert(!s.interpolation||s.interpolation==='LINEAR');const C=c.target.path==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
    return new C(nodes[c.target.node].name+'.'+properties[c.target.path],accessor(doc,s.input),accessor(doc,s.output));
  })));
  const samplers=new WeakMap();
  function pose(clip,time,groundBase=false){nodes.forEach((n,i)=>{n.position.fromArray(rest[i][0]);n.quaternion.fromArray(rest[i][1]);n.scale.fromArray(rest[i][2]);});
    if(!samplers.has(clip))samplers.set(clip,clip.tracks.map(t=>{const k=t.name.lastIndexOf('.');return {node:object.getObjectByName(t.name.slice(0,k)),property:t.name.slice(k+1),sample:t.createInterpolant()};}));
    for(const s of samplers.get(clip)){assert(s.node);if(groundBase&&s.node.name==='SkeletonGround'&&s.property==='position')continue;s.node[s.property].fromArray(s.sample.evaluate(time));}object.updateMatrixWorld(true);
  }
  const geometry=[];
  g.nodes.forEach((n,i)=>{if(n.mesh===undefined)return;for(const p of g.meshes[n.mesh].primitives){assert(!p.targets);const skin=n.skin===undefined?null:g.skins[n.skin];geometry.push({node:nodes[i],positions:accessor(doc,p.attributes.POSITION),weights:skin?accessor(doc,p.attributes.WEIGHTS_0):null,indices:skin?accessor(doc,p.attributes.JOINTS_0):null,bones:skin?skin.joints.map(j=>nodes[j]):null,inverses:skin?Array.from({length:skin.joints.length},(_,j)=>new THREE.Matrix4().fromArray(accessor(doc,skin.inverseBindMatrices),j*16)):null});}});
  function bounds(){let min=Infinity,skinnedMin=Infinity;const v=new THREE.Vector3(),sum=new THREE.Vector3(),point=new THREE.Vector3();
    for(const part of geometry){const matrices=part.bones?.map((b,i)=>new THREE.Matrix4().multiplyMatrices(b.matrixWorld,part.inverses[i]));for(let i=0;i<part.positions.length/3;i++){v.fromArray(part.positions,i*3);if(matrices){sum.set(0,0,0);for(let j=0;j<4;j++){const w=part.weights[i*4+j];if(w)sum.addScaledVector(point.copy(v).applyMatrix4(matrices[part.indices[i*4+j]]),w);}skinnedMin=Math.min(skinnedMin,sum.y);}else sum.copy(v).applyMatrix4(part.node.matrixWorld);finite(sum.toArray());min=Math.min(min,sum.y);}}
    return {min,skinnedMin};
  }
  return {object,nodes,clips,pose,bounds,joints,ground:object.getObjectByName('SkeletonGround')};
}
function timesFor(clip){const count=Math.ceil(clip.duration*120);return Array.from(new Set([...Array.from({length:count+1},(_,i)=>i/count*clip.duration),...clip.tracks.flatMap(t=>Array.from(t.times))])).sort((a,b)=>a-b);}
function replace(clip,track){const i=clip.tracks.findIndex(t=>t.name===track.name);assert(i>=0,'Cannot add channel '+track.name);clip.tracks[i]=track;}
function groundClip(r,clip){const base=r.ground.position.clone(),times=timesFor(clip),values=[];
  for(const t of times){r.pose(clip,t,true);const min=r.bounds().min;values.push(base.x,base.y+Math.max(0,-min)+.0005,base.z);}
  const track=new THREE.VectorKeyframeTrack('SkeletonGround.position',times,values);replace(clip,track);return track;
}
function appendAccessor(doc,values,type){const width=widths[type],data=Buffer.alloc(values.length*4);values.forEach((v,i)=>{assert(Number.isFinite(v));data.writeFloatLE(v,i*4);});
  const byteOffset=doc.bin.length;doc.bin=Buffer.concat([doc.bin,data]);const view=doc.g.bufferViews.push({buffer:0,byteOffset,byteLength:data.length})-1;
  const a={bufferView:view,componentType:5126,count:values.length/width,type};
  a.min=Array.from({length:width},(_,j)=>Math.min(...values.filter((_,i)=>i%width===j)));a.max=Array.from({length:width},(_,j)=>Math.max(...values.filter((_,i)=>i%width===j)));
  return doc.g.accessors.push(a)-1;
}
function encode(doc){doc.g.buffers[0].byteLength=doc.bin.length;const text=Buffer.from(JSON.stringify(doc.g)),json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const out=Buffer.alloc(12+8+json.length+8+doc.bin.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(doc.bin.length,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);doc.bin.copy(out,28+json.length);return out;}
const maxDifference=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const angle=(a,b)=>new THREE.Quaternion().fromArray(a).normalize().angleTo(new THREE.Quaternion().fromArray(b).normalize());

function accept(source,candidate,role){const r=rig(candidate),before=rig(source),idle=r.clips.find(c=>c.name==='Idle'),report={};
  // Validate every accessor, including unchanged geometry and animations.
  candidate.g.accessors.forEach((_,i)=>accessor(candidate,i));
  for(const [name] of HITS){const clip=r.clips.find(c=>c.name===name),old=before.clips.find(c=>c.name===name);assert.equal(clip.duration,old.duration);const result={peakDeltaRad:{},headBackwardM:0,maxSupportMatrixDifference:0,maxEndpointDifference:0,skeletonGround:{min:Infinity,max:-Infinity},skinnedMinY:{min:Infinity,max:-Infinity},skinnedMinYRelativeToGround:{min:Infinity,max:-Infinity},samples:0};
    r.pose(idle,0);const headIdle=r.object.getObjectByName('Bip001_Head').getWorldPosition(new THREE.Vector3());
    const support=r.nodes.filter(n=>/^Bip001_(Pelvis|Spine|[LR]_(Thigh|Calf|Foot|Toe0))$/.test(n.name));const supportIdle=support.map(n=>n.matrixWorld.toArray());
    for(const t of [0,Math.fround(.58)]){r.pose(clip,t);before.pose(old,t);r.nodes.forEach((n,i)=>{for(const property of ['position','quaternion','scale'])result.maxEndpointDifference=Math.max(result.maxEndpointDifference,maxDifference(n[property].toArray(),before.nodes[i][property].toArray()));});}
    assert.equal(result.maxEndpointDifference,0,`${role}/${name} endpoints must match exactly`);
    r.pose(clip,.1);result.headBackwardM=headIdle.z-r.object.getObjectByName('Bip001_Head').getWorldPosition(new THREE.Vector3()).z;assert(result.headBackwardM>=.05,`${role}/${name} head ${result.headBackwardM}`);
    for(const t of timesFor(clip)){r.pose(clip,t);before.pose(old,t);result.samples++;const bounds=r.bounds();result.skinnedMinY.min=Math.min(result.skinnedMinY.min,bounds.skinnedMin);result.skinnedMinY.max=Math.max(result.skinnedMinY.max,bounds.skinnedMin);result.skeletonGround.min=Math.min(result.skeletonGround.min,r.ground.position.y);result.skeletonGround.max=Math.max(result.skeletonGround.max,r.ground.position.y);
      assert(bounds.skinnedMin>=-.001&&bounds.skinnedMin<=.02,`${role}/${name} ground ${bounds.skinnedMin}`);
      const relative=bounds.skinnedMin-r.ground.getWorldPosition(new THREE.Vector3()).y;
      result.skinnedMinYRelativeToGround.min=Math.min(result.skinnedMinYRelativeToGround.min,relative);result.skinnedMinYRelativeToGround.max=Math.max(result.skinnedMinYRelativeToGround.max,relative);
      assert(relative>=-.001&&relative<=.02,`${role}/${name} relative ground ${relative}`);
      support.forEach((n,i)=>{result.maxSupportMatrixDifference=Math.max(result.maxSupportMatrixDifference,maxDifference(n.matrixWorld.toArray(),supportIdle[i]));});
      for(const i of r.joints){const n=r.nodes[i];const delta=angle(n.quaternion.toArray(),before.nodes[i].quaternion.toArray());result.peakDeltaRad[n.name]=Math.max(result.peakDeltaRad[n.name]??0,delta);assert(delta<=.35,`${role}/${name}/${n.name} delta ${delta}`);}
      for(const n of r.nodes)finite([...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray(),...n.matrixWorld.elements]);
    }
    assert(result.maxSupportMatrixDifference<1e-6,`${role}/${name} support ${result.maxSupportMatrixDifference}`);report[name]=result;
  }return report;
}
function preservation(source,candidate,changed){const hashes={};
  // Append-only BIN layout keeps ALL original accessors and their descriptors,
  // including now-unused old Hit accessors. No index remapping is needed.
  assert(candidate.bin.subarray(0,source.bin.length).equals(source.bin));
  source.g.accessors.forEach((a,i)=>{assert.deepEqual(candidate.g.accessors[i],a);assert(accessor(source,i,true).equals(accessor(candidate,i,true)));});
  assert.deepEqual(candidate.g.bufferViews.slice(0,source.g.bufferViews.length),source.g.bufferViews);
  hashes.originalBin=hash(source.bin);hashes.originalAccessors=jsonHash(source.g.accessors);
  for(const c of changed)assert((c.path==='translation'&&c.node==='SkeletonGround')||(c.path==='rotation'&&/^Bip001(?:|_Spine1|_Neck|_Head|_[LR]_(?:Clavicle|UpperArm|Forearm))$/.test(c.node)),'Forbidden changed channel');
  for(const key of Object.keys(source.g).filter(k=>!['accessors','bufferViews','buffers','animations'].includes(k))){assert.deepEqual(candidate.g[key],source.g[key]);hashes[key]=jsonHash(source.g[key]);}
  for(let i=0;i<source.g.animations.length;i++){const a=source.g.animations[i],b=candidate.g.animations[i];assert.deepEqual(b.channels,a.channels);assert.equal(b.samplers.length,a.samplers.length);
    if(!HITS.some(([n])=>n===a.name)){assert.deepEqual(b,a);hashes[a.name]=jsonHash(a);}
    else {assert.deepEqual({...b,samplers:a.samplers},a);const allowed=new Set(changed.filter(c=>c.clip===a.name).map(c=>c.sampler));for(let j=0;j<a.samplers.length;j++){if(!allowed.has(j))assert.deepEqual(b.samplers[j],a.samplers[j]);else {assert.deepEqual({...b.samplers[j],input:a.samplers[j].input,output:a.samplers[j].output},a.samplers[j]);}}}
  }return hashes;
}

function main(){const catalog=JSON.parse(fs.readFileSync(path.join(SOURCE,'catalog.json'),'utf8')),sources=new Map();
  // Hash and byte assertions happen before any GLB parsing or accessor reads.
  for(const [role,[sha,bytes]] of Object.entries(FROZEN)){const id='creature_skeleton_'+role,asset=catalog.assets.find(a=>a.id===id);assert(asset);assert.equal(asset.sha256,sha);assert.equal(asset.bytes,bytes);const data=fs.readFileSync(path.join(SOURCE,asset.file));assert.equal(data.length,bytes);assert.equal(hash(data),sha);sources.set(role,{asset,data});}
  const regression={revision:REVISION,method:'Append-only BIN rewrite; original accessor bytes and indices retained',visualAccepted:false,models:{}},textures=new Set(),pending=[];
  for(const [role,{asset,data}] of sources){const source=parse(data),doc={g:structuredClone(source.g),bin:Buffer.from(source.bin)},r=rig(source),idle=r.clips.find(c=>c.name==='Idle'),changed=[];
    const groundBase=r.ground.position.clone();
    for(const [name,side] of HITS){const original=r.clips.find(c=>c.name===name),clip=original.clone(),tracks=jointRecoil(r.object,idle,side,original);for(const track of tracks)replace(clip,track);
      r.ground.position.copy(groundBase);tracks.push(groundClip(r,clip));
      const animation=doc.g.animations.find(a=>a.name===name);
      for(const track of tracks){const channel=animation.channels.find(c=>doc.g.nodes[c.target.node].name+'.'+properties[c.target.path]===track.name);assert(channel);assert.equal(animation.channels.filter(c=>c.sampler===channel.sampler).length,1);
        const sampler=animation.samplers[channel.sampler],input=appendAccessor(doc,Array.from(track.times),'SCALAR'),output=appendAccessor(doc,Array.from(track.values),channel.target.path==='rotation'?'VEC4':'VEC3');
        changed.push({clip:name,node:doc.g.nodes[channel.target.node].name,path:channel.target.path,sampler:channel.sampler,previousInput:sampler.input,previousOutput:sampler.output,input,output,keys:track.times.length});sampler.input=input;sampler.output=output;
      }
    }
    const bytes=encode(doc),candidate=parse(bytes),identicalSectionHashes=preservation(source,candidate,changed),clips=accept(source,candidate,role),sha256=hash(bytes);
    regression.models[role]={source:{sha256:hash(data),bytes:data.length},candidate:{sha256,bytes:bytes.length},identicalSectionHashes,changedChannels:changed,clips};
    const next=structuredClone(asset);next.sha256=sha256;next.bytes=bytes.length;next.metadata.revision=REVISION;for(const [name] of HITS)next.metadata.animationProvenance[name]=HIT_PROVENANCE;next.acceptance.labAccepted=false;next.acceptance.worldIntegrated=false;
    next.sourceProvenance.hitRevision={kind:'clip-only',baselineSha256:asset.sha256,candidateSha256:sha256,description:HIT_PROVENANCE};
    for(const image of candidate.g.images){assert(image.uri);const relative=path.posix.normalize(path.posix.join(path.posix.dirname(asset.file),image.uri));assert(/^textures\/imported\/[a-f0-9]{64}\.png$/.test(relative));textures.add(relative);}
    pending.push({asset:next,bytes});
  }
  const nextCatalog={...structuredClone(catalog),assets:pending.map(p=>p.asset),files:Object.fromEntries(pending.map(p=>[p.asset.id,p.asset.file])),packs:catalog.packs.filter(p=>pending.some(a=>a.asset.pack===p.id)),sharedTextures:[]};
  for(const file of textures){const data=fs.readFileSync(path.join(SOURCE,file)),sha256=hash(data),original=catalog.sharedTextures.find(t=>t.file===file);assert(original);assert.equal(sha256,path.basename(file,'.png'));assert.equal(original.sha256,sha256);assert.equal(original.bytes,data.length);nextCatalog.sharedTextures.push({...original,bytes:data.length,sha256,mimeType:'image/png'});pending.push({textureFile:file,bytes:data});}
  // Publish files only after all three in-memory candidates pass acceptance.
  for(const item of pending){const file=path.join(OUTPUT,item.textureFile??item.asset.file);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,item.bytes);assert(fs.readFileSync(file).equals(item.bytes));}
  fs.writeFileSync(path.join(OUTPUT,'catalog.json'),JSON.stringify(nextCatalog,null,2)+'\n');
  const written=JSON.parse(fs.readFileSync(path.join(OUTPUT,'catalog.json'),'utf8'));
  for(const item of [...written.assets,...written.sharedTextures]){const bytes=fs.readFileSync(path.join(OUTPUT,item.file));assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);if(item.id){assert.equal(written.files[item.id],item.file);parse(bytes);}}
  for(const {asset,data} of sources.values())assert(fs.readFileSync(path.join(SOURCE,asset.file)).equals(data),'Frozen input changed');
  fs.writeFileSync(path.join(OUTPUT,'clip-regression.json'),JSON.stringify(regression,null,2)+'\n');
  console.log(JSON.stringify({revision:REVISION,cpuAccepted:true,visualAccepted:false,textures:textures.size,models:Object.fromEntries(Object.entries(regression.models).map(([role,m])=>[role,{bytes:m.candidate.bytes,sha256:m.candidate.sha256,headBackwardM:Object.fromEntries(Object.entries(m.clips).map(([name,c])=>[name,c.headBackwardM]))}]))}));
}
main();
