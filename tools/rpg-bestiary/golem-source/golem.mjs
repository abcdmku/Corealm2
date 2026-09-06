import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import sharp from 'sharp';
import { readSourceGlb } from '../humanoid-source/read-glb.mjs';
const root=path.resolve('game/public/assets/models');
const load=name=>({...readSourceGlb(path.join(root,`${name}.glb`)),asset:name,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,`${name}.glb`))).digest('hex')});
const base=load('character/base_male'),library=load('animation/animation_library_1');
const outfits=['chest','legs','boots','gloves','pauldron'].map(x=>load(`outfit/outfit_male_knight_${x}`));
const helmet=load('outfit/outfit_male_knight_helmet');
const output=path.resolve('tools/rpg-bestiary/golem-source/derived');fs.mkdirSync(output,{recursive:true});
// Original UVs carry a deterministic mineral grain texture. No luminous trim.
const N=512,bytes=Buffer.alloc(N*N*3),normal=Buffer.alloc(N*N*3);
for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const h=Math.sin(x*127.1+y*311.7)*43758.5453,noise=h-Math.floor(h);
  const strata=Math.sin(y*.11+Math.sin(x*.028)*3),grain=185+noise*46+strata*9;
  const fissure=Math.abs(Math.sin(x*.019+y*.027+Math.sin(y*.052)*.48))<.026;
  const k=(y*N+x)*3;bytes[k]=Math.max(0,grain-(fissure?52:0));bytes[k+1]=Math.max(0,grain-(fissure?54:3));bytes[k+2]=Math.max(0,grain-(fissure?56:7));
  normal[k]=128+(noise-.5)*22;normal[k+1]=128+strata*9;normal[k+2]=250;
}
const stoneTexture=path.join(output,'mineral-grain.png'),normalTexture=path.join(output,'mineral-normal.png');
await sharp(bytes,{raw:{width:N,height:N,channels:3}}).png().toFile(stoneTexture);
await sharp(normal,{raw:{width:N,height:N,channels:3}}).png().toFile(normalTexture);
function guardianPoint(v){
 const head=THREE.MathUtils.smoothstep(v.y,1.47,1.57)*(1-THREE.MathUtils.smoothstep(Math.abs(v.x),.15,.24)),torso=Math.exp(-Math.pow((v.y-1.28)/.27,4));
 const hand=THREE.MathUtils.smoothstep(Math.abs(v.x),.46,.61);
 const width=1.66+torso*.22-head*.29+hand*.14;
 // Massive chest, compact neck and broad feet share the source anatomical topology.
 const yy=v.y+hand*(v.y-1.445)*.55,zz=v.z+hand*(v.z+.055)*.46;
 return new THREE.Vector3(v.x*width,yy<.98?yy*1.30:1.274+(yy-.98)*(1.28-head*.25),zz*(1.70+torso*.31+hand*.16));
}
export function buildGolem(id='stone_golem'){
 if(!['stone_golem','iron_golem','fire_golem'].includes(id))throw new Error(`Unknown guardian ${id}`);
 const iron=id==='iron_golem',fire=id==='fire_golem';
 const chosenOutfits=iron?[...outfits,helmet]:outfits;
 const object=new THREE.Group();object.name=id;
 const skinDef=base.json.skins[0],jointSet=new Set(skinDef.joints);
 const nodes=base.json.nodes.map((n,i)=>{const node=jointSet.has(i)?new THREE.Bone():new THREE.Group();node.name=n.name||`node${i}`;if(n.translation)node.position.fromArray(n.translation);if(n.rotation)node.quaternion.fromArray(n.rotation);if(n.scale)node.scale.fromArray(n.scale);if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(node.position,node.quaternion,node.scale);return node;});
 base.json.nodes.forEach((n,i)=>{for(const c of n.children||[])nodes[i].add(nodes[c]);});for(const i of base.json.scenes[base.json.scene||0].nodes)object.add(nodes[i]);object.updateMatrixWorld(true);
 const world=new Map(nodes.map(n=>[n,guardianPoint(n.getWorldPosition(new THREE.Vector3()))]));
 function reshape(n){if(world.has(n)){n.parent.updateWorldMatrix(true,false);n.position.copy(n.parent.worldToLocal(world.get(n).clone()));n.updateMatrixWorld(true);}for(const c of n.children)reshape(c);}for(const c of object.children)reshape(c);
 const bones=skinDef.joints.map(i=>nodes[i]),skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
 const textureBindings=[];
 for(const source of [base,...chosenOutfits])for(const sn of source.json.nodes){if(sn.mesh===undefined)continue;
  for(const primitive of source.json.meshes[sn.mesh].primitives){const sm=source.json.materials[primitive.material];if(sm.name.includes('Hair'))continue;
   const isBody=source===base,isEye=sm.name.includes('Eyes'),armor=!isBody,part=source.asset.split('_').at(-1);
   const color=isEye?(fire?0xaf5a25:iron?0x514329:0x37352b):iron?(armor?0x777873:0x474d4c):fire?(armor?0x554c45:0x342f2b):(armor?0x96927f:0x777767);
   const material=new THREE.MeshStandardMaterial({name:`${id}_${path.basename(source.asset)}_${sm.name}`,color,roughness:iron?.66:.94,metalness:iron?(armor?.82:.6):0,side:THREE.DoubleSide,emissive:fire&&isBody&&!isEye?0x742209:0x000000,emissiveIntensity:fire&&isBody?.35:0});
   if(!isEye)textureBindings.push({materialName:material.name,baseColorPath:stoneTexture,normalPath:normalTexture,flipY:false});
   const geometry=new THREE.BufferGeometry();
   for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){if(primitive.attributes[semantic]===undefined)continue;const a=source.accessor(primitive.attributes[semantic]);geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));}
   const p=geometry.attributes.position,original=p.array.slice(),indices=primitive.indices===undefined?Array.from({length:p.count},(_,i)=>i):Array.from(source.accessor(primitive.indices).array),filtered=[];
   for(let i=0;i<indices.length;i+=3){const tri=indices.slice(i,i+3);if(isBody&&!isEye&&tri.every(q=>(original[q*3+1]<1.49&&Math.abs(original[q*3])<.32)||Math.abs(original[q*3])>.57))continue;if(fire&&part==='pauldron'&&tri.every(q=>original[q*3]<0))continue;filtered.push(...tri);}geometry.setIndex(filtered);
   for(let i=0;i<p.count;i++){const raw=new THREE.Vector3().fromArray(original,i*3);
    // Variant shape changes retain all source joint weights and authored plate topology.
    if(iron&&armor){
     if(part==='pauldron'){raw.x=Math.sign(raw.x)*.26+(raw.x-Math.sign(raw.x)*.26)*1.65;raw.y=1.49+(raw.y-1.49)*1.23;raw.z*=1.32;}
     if(part==='chest')raw.z*=1.21;
     if(part==='gloves'){raw.y=1.445+(raw.y-1.445)*1.20;raw.z=-.055+(raw.z+.055)*1.24;}
     if(part==='boots'){raw.x=Math.sign(raw.x)*.095+(raw.x-Math.sign(raw.x)*.095)*1.28;raw.z*=1.12;}
    }
    if(fire&&armor){
     if(part==='pauldron'){raw.x=.26+(raw.x-.26)*1.32;raw.y=1.46+(raw.y-1.46)*1.70;raw.z*=1.10;}
     if(part==='gloves'&&raw.x>0){raw.y=1.445+(raw.y-1.445)*1.29;raw.z=-.055+(raw.z+.055)*1.32;}
     if(part==='chest')raw.z*=.94;
    }
    const v=guardianPoint(raw);p.setXYZ(i,v.x,v.y,v.z);}
   const si=geometry.attributes.skinIndex,sourceSkin=source.json.skins[sn.skin];for(let i=0;i<si.array.length;i++){const name=source.json.nodes[sourceSkin.joints[si.array[i]]].name,index=bones.findIndex(b=>b.name===name);if(index<0)throw new Error(`Unknown bone ${name}`);si.array[i]=index;}
   geometry.computeVertexNormals();geometry.computeBoundingBox();const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name=`${id}_${sn.name}`;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;object.add(mesh);mesh.bind(skeleton);
  }
 }
 const names={Idle:'Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',Attack:'Punch_Jab',Hit:'Hit_Chest',HitLeft:'Hit_Chest',HitRight:'Hit_Chest',Death:'Death01'};
 const clips=Object.entries(names).map(([name,sourceName])=>{
  const animation=library.json.animations.find(a=>a.name===sourceName);if(!animation)throw new Error(`Missing ${sourceName}; available ${library.json.animations.map(a=>a.name)}`);const tracks=[];
  for(const channel of animation.channels){const sourceNode=library.json.nodes[channel.target.node],target=object.getObjectByName(sourceNode.name);if(!target)continue;const sampler=animation.samplers[channel.sampler],times=library.accessor(sampler.input).array.slice(),values=library.accessor(sampler.output).array.slice();if(sampler.interpolation==='CUBICSPLINE')throw new Error('Unsupported cubic source');const mode=sampler.interpolation==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear;
   // Slow locomotion gives the larger guardian time to transfer its weight.
   const stretch=name==='Walk'?1.35:name==='Run'?1.2:name==='Attack'?1.30:1;for(let i=0;i<times.length;i++)times[i]*=stretch;
   if(channel.target.path==='rotation'){const correction=target.quaternion.clone().multiply(new THREE.Quaternion().fromArray(sourceNode.rotation||[0,0,0,1]).invert());for(let i=0;i<values.length;i+=4)new THREE.Quaternion().fromArray(values,i).premultiply(correction).toArray(values,i);tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`,times,values,mode));}
   else if(channel.target.path==='translation'){const rest=sourceNode.translation||[0,0,0];for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=target.position.getComponent(k)+(target.name==='root'?0:(values[i+k]-rest[k])*1.3);tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`,times,values,mode));}
  }
  const clip=new THREE.AnimationClip(name,-1,tracks);if(name==='HitLeft'||name==='HitRight'){const track=tracks.find(t=>t.name==='spine_03.quaternion');if(track)for(let i=0;i<track.times.length;i++)new THREE.Quaternion().fromArray(track.values,i*4).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(name==='HitLeft'?1:-1)*.18*Math.sin(Math.PI*track.times[i]/clip.duration))).toArray(track.values,i*4);}return clip;
 });
 object.animations=clips;object.updateMatrixWorld(true);
 const mixer=new THREE.AnimationMixer(object),motionRoot=object.getObjectByName('root'),floorCorrection={};
 for(const clip of clips){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();const times=[],values=[];let maximumLift=0;
  const sampleSet=new Set(Array.from({length:Math.ceil(clip.duration*60)+1},(_,i)=>Math.min(clip.duration,i/60)));sampleSet.add(clip.duration);for(const track of clip.tracks)for(const t of track.times)sampleSet.add(t);
  for(const t of [...sampleSet].sort((a,b)=>a-b)){mixer.setTime(t);object.updateMatrixWorld(true);const floor=new THREE.Box3().setFromObject(object,true).min.y,lift=Math.max(0,.003-floor);times.push(t);values.push(motionRoot.position.x,motionRoot.position.y+lift,motionRoot.position.z);maximumLift=Math.max(maximumLift,lift);}action.stop();mixer.uncacheClip(clip);clip.tracks=clip.tracks.filter(t=>t.name!=='root.position');clip.tracks.push(new THREE.VectorKeyframeTrack('root.position',times,values));floorCorrection[clip.name]={samples:times.length,maximumLift};
 }
 mixer.stopAllAction();object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true),size=box.getSize(new THREE.Vector3());
 return {object,clips,meta:{family:'golem',height:size.y,dimensions:size.toArray(),rig:'entitled-universal-base-65-joint',textureBindings,floorCorrection,source:'Quaternius Universal Base Characters and Modular Fantasy Knight armor, preserved source topology and skin weights',license:'CC0-1.0',provenance:{sourceAssets:['base_male',...chosenOutfits.map(s=>path.basename(s.asset)),'animation_library_1'],sourceFiles:[base,...chosenOutfits,library].map(s=>({file:`game/public/assets/models/${s.asset}.glb`,sha256:s.sha256})),author:'Quaternius',license:'CC0-1.0',sourcePacks:[{id:'universal-base-characters',sha256:'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40'},{id:'modular-character-outfits-fantasy',sha256:'c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70'},{id:'universal-animation-library',sha256:'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724'}],modifications:'Broad coordinated bind-space anatomy and joints; original knight armor converted to weathered guardian statue; authored mineral texture, heavy clip timing'},attackContact:.38,animationAcceptance:'candidate-needs-production-lab-motion-review',variantDesign:iron?'Enclosed knight helmet, enlarged cast shoulder shells, deeper breastplate and broad iron gauntlets/boots':fire?'Asymmetric single tall volcanic shoulder, enlarged right gauntlet and recessed dark chest with warm inner anatomy':'Accepted paired stone pauldrons and weathered carved anatomy',revision:iron||fire?'golem-source-review-2':'golem-source-review-1'}};
}

