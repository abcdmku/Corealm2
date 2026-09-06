import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import sharp from 'sharp';
import {readSourceGlb} from './read-glb.mjs';
import {prepareCorpseTextures} from './corpse-textures.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'../../..'),OUTPUT=path.join(HERE,'derived');
const load=file=>({...readSourceGlb(path.join(ROOT,'game/public/assets/models',file+'.glb')),id:file});
const base=load('character/base_male'),chest=load('outfit/outfit_male_peasant_chest'),legs=load('outfit/outfit_male_peasant_legs'),boots=load('outfit/outfit_male_peasant_boots'),ual1=load('animation/animation_library_1');
const ual2={...readSourceGlb(path.join(ROOT,'tools/rpg-bestiary/humanoid-source/derived/UAL2_Standard.glb')),id:'UAL2_Standard'};
fs.mkdirSync(OUTPUT,{recursive:true});
const textureFiles=new Map();
for(const source of [base,chest,legs,boots])for(let i=0;i<source.json.materials.length;i++){
  const material=source.json.materials[i],binding={};
  for(const [field,info]of [['baseColorPath',material.pbrMetallicRoughness?.baseColorTexture],['normalPath',material.normalTexture],['metallicRoughnessPath',material.pbrMetallicRoughness?.metallicRoughnessTexture]]){
    if(!info)continue;const image=source.json.images[source.json.textures[info.index].source],view=source.json.bufferViews[image.bufferView];
    const bytes=image.uri?fs.readFileSync(path.resolve(path.dirname(source.file),image.uri)):source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength),file=path.join(OUTPUT,path.basename(source.id)+'-'+i+'-'+field+'.png');
    await sharp(bytes).png().toFile(file);binding[field]=file;
  }textureFiles.set(source.id+':'+i,binding);
}
const gaussian=(x,center,width)=>Math.exp(-Math.pow((x-center)/width,2));
const corpseTextures=await prepareCorpseTextures(textureFiles.get(base.id+':2').baseColorPath,textureFiles.get(base.id+':1').baseColorPath,textureFiles.get(chest.id+':0').baseColorPath,OUTPUT);
function point(original,variant,face=true){
  const {x,y,z}=original,ghoul=variant==='grave_ghoul',plague=variant==='plague_zombie',head=THREE.MathUtils.smoothstep(y,1.48,1.58),waist=gaussian(y,1.17,.21);
  let xx=x*(.94-.1*waist*(1-head)),yy=y,zz=z*(.94-.1*waist)+head*.018;
  // Connected source geometry supplies cheeks, fingers and tendons; changes remain
  // continuous fields applied equally to vertices and bind joints.
  if(ghoul){xx=Math.sign(x)*(Math.min(Math.abs(x),.35)*.88+Math.max(0,Math.abs(x)-.35)*1.3);yy=y<1?y*.82:.82+(Math.min(y,1.5)-1)*.85+Math.max(0,y-1.5)*.98;zz=z*(.82+.12*head)+head*.05;}
  if(plague){const bloat=gaussian(y,1.12,.18)*(1-head);xx+=x*.27*bloat;zz+=z*.37*bloat;xx+=.026*gaussian(x,-.22,.11)*gaussian(y,1.44,.12);}
  const shoulder=gaussian(x,-.2,.16)*gaussian(y,1.43,.16);yy-=shoulder*(plague?.035:.019);
  const limb=gaussian(Math.abs(x),.49,.21)*gaussian(y,1.48,.16);yy=THREE.MathUtils.lerp(yy,1.48+(yy-1.48)*.76,limb*(ghoul?.2:1));zz*=1-.18*limb;
  if(face){const cheek=gaussian(y,1.655,.031)*THREE.MathUtils.smoothstep(z,.015,.055);xx*=1-.24*cheek;zz-=.023*cheek;zz-=.011*gaussian(x,-.033,.025)*gaussian(y,1.705,.018);yy-=.013*gaussian(x,-.023,.023)*gaussian(y,1.622,.022);
    zz-=.016*gaussian(x,-.055,.019)*gaussian(y,1.65,.022)*THREE.MathUtils.smoothstep(z,.015,.04);
  }
  return new THREE.Vector3(xx,yy,zz);
}
function wound(x,y,z,variant){
  const cheek=gaussian(x,-.046,.031)*gaussian(y,1.66,.05)*THREE.MathUtils.smoothstep(z,.01,.06);
  const arm=gaussian(x,.53,.085)*gaussian(y,1.49,.045);
  const elbow=gaussian(x,-.4,.075)*gaussian(y,1.5,.05);
  const mottling=(Math.sin(x*59+y*43+z*37)*Math.sin(y*61-z*47)+1)*.5;
  const amount=Math.min(.54,(cheek*.44+arm*.4+elbow*.24)*(variant==='plague_zombie'?1.2:1)+mottling*.035);
  return [1-amount*.36,1-amount*.63,1-amount*.58];
}
function hole(p,variant){
  if(p.z<.025)return false;
  return Math.pow((p.x+.105)/.07,2)+Math.pow((p.y-1.29)/.1,2)<1 || (variant==='plague_zombie'&&Math.pow((p.x-.08)/.056,2)+Math.pow((p.y-1.12)/.08,2)<1);
}
function compact(geometry,indices){
  const remap=new Map(),vertices=[];for(const i of indices)if(!remap.has(i)){remap.set(i,vertices.length);vertices.push(i);}
  for(const [name,a]of Object.entries(geometry.attributes)){const out=new a.array.constructor(vertices.length*a.itemSize);vertices.forEach((old,i)=>{for(let k=0;k<a.itemSize;k++)out[i*a.itemSize+k]=a.array[old*a.itemSize+k];});geometry.setAttribute(name,new THREE.BufferAttribute(out,a.itemSize,a.normalized));}
  geometry.setIndex(indices.map(i=>remap.get(i)));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
}
function sourceAnimation(source,name,outputName,object,variant){
  const animation=source.json.animations.find(a=>a.name===name);if(!animation)throw new Error('Missing source animation '+name);
  const tracks=[];
  for(const channel of animation.channels){
    const sourceNode=source.json.nodes[channel.target.node],target=object.getObjectByName(sourceNode.name);if(!target)throw new Error('Unmapped zombie source bone '+sourceNode.name);
    const sampler=animation.samplers[channel.sampler],times=source.accessor(sampler.input).array,values=source.accessor(sampler.output).array.slice();
    if(sampler.interpolation==='CUBICSPLINE')throw new Error('Cubic source requires resampling');const mode=sampler.interpolation==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear;
    if(channel.target.path==='rotation'){
      const correction=target.quaternion.clone().multiply(new THREE.Quaternion().fromArray(sourceNode.rotation||[0,0,0,1]).invert());
      for(let i=0;i<values.length;i+=4){const q=new THREE.Quaternion().fromArray(values,i).premultiply(correction);
        if(variant==='grave_ghoul'&&['spine_02','spine_03'].includes(target.name))q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),target.name==='spine_03'?.11:.07));
        q.toArray(values,i);}
      tracks.push(new THREE.QuaternionKeyframeTrack(target.name+'.quaternion',times,values,mode));
    }else if(channel.target.path==='translation'){
      const rest=sourceNode.translation||[0,0,0],factor=variant==='grave_ghoul'?.85:1;
      for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=target.position.getComponent(k)+(target.name==='root'?0:(values[i+k]-rest[k])*factor);
      tracks.push(new THREE.VectorKeyframeTrack(target.name+'.position',times,values,mode));
    }else if(channel.target.path==='scale')tracks.push(new THREE.VectorKeyframeTrack(target.name+'.scale',times,values,mode));
  }
  const clip=new THREE.AnimationClip(outputName,-1,tracks);
  if(outputName==='HitLeft'||outputName==='HitRight'){
    const track=tracks.find(t=>t.name==='spine_03.quaternion');for(let i=0;i<track.times.length;i++)new THREE.Quaternion().fromArray(track.values,i*4).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(outputName==='HitLeft'?1:-1)*.19*Math.sin(Math.PI*track.times[i]/clip.duration))).toArray(track.values,i*4);
  }return clip;
}
function floorCorrect(object,ground,clips){
  const mixer=new THREE.AnimationMixer(object),result={};
  for(const clip of clips){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const count=Math.ceil(clip.duration*120),times=[...new Set([...Array.from({length:count+1},(_,i)=>clip.duration*i/count),...clip.tracks.flatMap(t=>Array.from(t.times))])].sort((a,b)=>a-b),values=[];let lift=0;
    for(const time of times){mixer.setTime(time);object.updateMatrixWorld(true);const correction=Math.max(0,-new THREE.Box3().setFromObject(object,true).min.y)+.001;values.push(0,correction,0);lift=Math.max(lift,correction);}
    action.stop();mixer.uncacheClip(clip);clip.tracks.push(new THREE.VectorKeyframeTrack(ground.name+'.position',times,values));result[clip.name]={samples:times.length,maximumLift:lift};
  }mixer.stopAllAction();object.updateMatrixWorld(true);return result;
}
function addClaws(object){
  const material=new THREE.MeshStandardMaterial({name:'ghoul_keratin_claws',color:0x978f7a,roughness:.81});
  for(const side of ['l','r'])for(const finger of ['index','middle','ring','pinky']){
    const node=object.getObjectByName(finger+'_03_'+side),tip=object.getObjectByName(finger+'_04_leaf_'+side),length=tip.position.y;
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,length*.65,0),new THREE.Vector3(0,length+.035,.004),new THREE.Vector3(0,length+.09,.025)]),g=new THREE.TubeGeometry(curve,12,.009,6,false),p=g.attributes.position;
    for(let i=0;i<p.count;i++){const t=Math.floor(i/7)/12,center=curve.getPointAt(t),point=new THREE.Vector3().fromBufferAttribute(p,i).sub(center).multiplyScalar(1-.93*t).add(center);p.setXYZ(i,point.x,point.y,point.z);}g.computeVertexNormals();const claw=new THREE.Mesh(g,material);claw.name='ghoul_'+finger+'_claw_'+side;claw.castShadow=true;node.add(claw);
  }
}
function addRecessedMouth(object,id){
  const head=object.getObjectByName('Head');object.updateMatrixWorld(true);const inverse=head.matrixWorld.clone().invert();
  const width=id==='grave_ghoul'?.038:.03,positions=[],segments=12;
  positions.push(...point(new THREE.Vector3(-.003,1.619,.076),id).applyMatrix4(inverse).toArray());
  for(let i=0;i<segments;i++){const angle=i/segments*Math.PI*2,x=Math.cos(angle)*width,y=1.619+Math.sin(angle)*.011-.003*(x<0?1:0);positions.push(...point(new THREE.Vector3(x,y,.08),id).applyMatrix4(inverse).toArray());}
  const indices=[];for(let i=0;i<segments;i++)indices.push(0,1+i,1+(i+1)%segments);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mouth=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({name:id+'_desiccated_mouth',color:0x251b1e,roughness:1,side:THREE.DoubleSide}));mouth.name='RecessedTornMouth';head.add(mouth);
  const ivory=new THREE.MeshStandardMaterial({name:id+'_exposed_teeth',color:0xb5b095,roughness:.85});
  for(let i=0;i<6;i++){
    const x=(i-2.5)*.008,length=.005+(i%3)*.0018,g=new THREE.CylinderGeometry(.0035,.0027,length,5);
    const position=point(new THREE.Vector3(x,1.623-length*.5,.086),id);g.translate(position.x,position.y,position.z);g.applyMatrix4(inverse);
    const tooth=new THREE.Mesh(g,ivory);tooth.name='DesiccatedTooth'+i;tooth.castShadow=true;head.add(tooth);
  }
}
export function buildSourceZombie(id='zombie'){
  if(!['zombie','plague_zombie','grave_ghoul'].includes(id))throw new Error('Unknown source zombie '+id);
  const ghoul=id==='grave_ghoul',plague=id==='plague_zombie',object=new THREE.Group();object.name=id;const ground=new THREE.Group();ground.name='ZombieGround';object.add(ground);
  const skinDef=base.json.skins[0],jointSet=new Set(skinDef.joints),nodes=base.json.nodes.map((n,i)=>{const node=jointSet.has(i)?new THREE.Bone():new THREE.Group();node.name=n.name||'node'+i;if(n.translation)node.position.fromArray(n.translation);if(n.rotation)node.quaternion.fromArray(n.rotation);if(n.scale)node.scale.fromArray(n.scale);if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(node.position,node.quaternion,node.scale);return node;});
  base.json.nodes.forEach((n,i)=>{for(const c of n.children||[])nodes[i].add(nodes[c]);});for(const i of base.json.scenes[base.json.scene||0].nodes)ground.add(nodes[i]);object.updateMatrixWorld(true);
  const positions=new Map(nodes.map(n=>[n,point(n.getWorldPosition(new THREE.Vector3()),id,false)]));
  function morph(node){if(positions.has(node)){node.parent.updateWorldMatrix(true,false);node.position.copy(node.parent.worldToLocal(positions.get(node).clone()));node.updateMatrixWorld(true);}for(const child of node.children)morph(child);}for(const child of ground.children)morph(child);
  const bones=skinDef.joints.map(i=>nodes[i]),skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  const textureBindings=[],chosen=ghoul?[legs]:[chest,legs,boots];
  let retainedVertices=0,removedTriangles=0;
  for(const source of [base,...chosen])for(const sourceNode of source.json.nodes){if(sourceNode.mesh===undefined)continue;const sourceSkin=source.json.skins[sourceNode.skin];
    for(const primitive of source.json.meshes[sourceNode.mesh].primitives){
      const sourceMat=source.json.materials[primitive.material],isBody=source===base&&sourceMat.name.includes('Superhero'),isEyes=source===base&&sourceMat.name.includes('Eyes'),isCloth=source!==base;
      const material=new THREE.MeshStandardMaterial({name:id+'_source_'+path.basename(source.id)+'_'+sourceMat.name,color:isBody||isEyes||isCloth?0xffffff:0x77736a,roughness:.9,metalness:0,vertexColors:isBody,side:THREE.DoubleSide});
      const binding={materialName:material.name,...textureFiles.get(source.id+':'+primitive.material)};
      if(isBody)binding.baseColorPath=corpseTextures[id].skin;if(isEyes)binding.baseColorPath=corpseTextures[id].eyes;if(isCloth)binding.baseColorPath=corpseTextures[id].cloth;
      textureBindings.push(binding);
      const geometry=new THREE.BufferGeometry();
      for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){if(primitive.attributes[semantic]===undefined)continue;const a=source.accessor(primitive.attributes[semantic]);geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));}
      const original=geometry.attributes.position.array.slice(),sourceIndices=primitive.indices===undefined?Array.from({length:original.length/3},(_,i)=>i):Array.from(source.accessor(primitive.indices).array),filtered=[];
      for(let i=0;i<sourceIndices.length;i+=3){const tri=sourceIndices.slice(i,i+3),points=tri.map(q=>new THREE.Vector3().fromArray(original,q*3));let hide=false;
        // The ghoul wears shortened, ragged trousers. Preserve its entire source
        // leg surface beneath them; the former full-trouser mask removed knees
        // that become exposed when the hem is cut and the source rig crouches.
        if(isBody){hide=ghoul?false:points.every(p=>p.y<1.49&&Math.abs(p.x)<.335&&!hole(p,id)&&!(p.x<-.23&&p.y>1.36));
          const center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/3);
          if(center.z>.065&&Math.pow(center.x/(ghoul?.034:.027),2)+Math.pow((center.y-1.619)/.0105,2)<1)hide=true;
        }
        if(isCloth&&source===chest)hide=points.every(p=>hole(p,id))||points.every(p=>p.y<.955+.012*Math.sin(p.x*79))||points.every(p=>p.x<-.235&&p.y>1.36+.012*Math.sin(p.x*77));
        if(isCloth&&source===legs&&ghoul)hide=points.every(p=>p.y<.58+.05*Math.sin(p.x*67));
        if(hide)removedTriangles++;else filtered.push(...tri);
      }
      const p=geometry.attributes.position,colors=[];
      for(let i=0;i<p.count;i++){const originalP=new THREE.Vector3().fromArray(original,i*3),next=point(originalP,id);p.setXYZ(i,next.x,next.y,next.z);if(isBody)colors.push(...wound(originalP.x,originalP.y,originalP.z,id));}
      if(isBody)geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      const skinIndex=geometry.attributes.skinIndex;for(let i=0;i<skinIndex.count;i++)for(let k=0;k<4;k++){const sourceJoint=source.json.nodes[sourceSkin.joints[skinIndex.array[i*4+k]]].name,target=bones.findIndex(b=>b.name===sourceJoint);if(target<0)throw new Error('Unmapped clothing bone '+sourceJoint);skinIndex.array[i*4+k]=target;}
      compact(geometry,filtered);retainedVertices+=geometry.attributes.position.count;const skin=new THREE.SkinnedMesh(geometry,material);skin.name=id+'_'+sourceNode.name;skin.castShadow=true;skin.receiveShadow=true;skin.frustumCulled=false;ground.add(skin);skin.bind(skeleton);
    }
  }
  if(ghoul)addClaws(object);
  addRecessedMouth(object,id);
  const contact=new THREE.Group();contact.name='ZombieScratchContact';contact.position.set(0,.11,.015);object.getObjectByName('hand_r').add(contact);
  const specs=[['Idle',ual2,'Zombie_Idle_Loop'],['Walk',ual2,'Zombie_Walk_Fwd_Loop'],['Run',ual1,'Jog_Fwd_Loop'],['Attack',ual2,'Zombie_Scratch'],['Hit',ual1,'Hit_Chest'],['HitLeft',ual1,'Hit_Chest'],['HitRight',ual1,'Hit_Chest'],['Death',ual1,'Death01']];
  const clips=specs.map(([name,library,take])=>sourceAnimation(library,take,name,object,id));
  // Slow pursuit uses the authored zombie gait for both movement requests.
  // The separate ghoul gait is unchanged until its locomotion policy is accepted.
  if(!ghoul){const run=clips.findIndex(clip=>clip.name==='Run');clips[run]=clips.find(clip=>clip.name==='Walk').clone();clips[run].name='Run';}
  const floorCorrection=floorCorrect(object,ground,clips);
  object.animations=clips;
  const mixer=new THREE.AnimationMixer(object),attack=clips.find(c=>c.name==='Attack'),action=mixer.clipAction(attack);action.play();let forward=-Infinity,phase=.4;
  for(let i=10;i<=85;i++){mixer.setTime(attack.duration*i/100);object.updateMatrixWorld(true);const z=contact.getWorldPosition(new THREE.Vector3()).z;if(z>forward){forward=z;phase=i/100;}}
  action.stop();mixer.uncacheClip(attack);mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true),size=box.getSize(new THREE.Vector3());mixer.stopAllAction();mixer.uncacheRoot(object);object.updateMatrixWorld(true);
  return {object,clips,meta:{family:'zombie',style:ghoul?'gaunt-long-clawed-ghoul':plague?'swollen-asymmetric-plague':'gaunt-undead-peasant',heightM:size.y,dimensionsM:{width:size.x,height:size.y,depth:size.z},sourceSkinned:true,boneCount:65,retainedVertices,removedClothingAndHiddenBodyTriangles:removedTriangles,
    attackContactPhase:phase,attackContactNode:'ZombieScratchContact',attackContactStatus:'Measured maximum forward right-hand extension in source Zombie_Scratch between phases .10 and .85; gameplay contact pending production review.',
    textureBindings,floorCorrection,textureOrientation:'Original glTF UV and image rows, no flipY',corpseTextureRevision:'UV-authored-pallor-socket-cheek-decay-v2',
    ...(!ghoul?{gaitClipAliases:{Run:'Walk'},gaitMeasuredSpeedMps:{Walk:plague?1.02228:1.02122,Run:plague?1.02228:1.02122},gaitPolicy:'Zombie and plague slow pursuit uses source Zombie_Walk_Fwd_Loop for both Walk and Run requests; intended gameplay pursuit 1.2–1.6 m/s.'}:{}),
    animationProvenance:Object.fromEntries(specs.map(([name,library,take])=>[name,!ghoul&&name==='Run'?'UAL2_Standard:Zombie_Walk_Fwd_Loop; explicit Run alias of Walk for slow pursuit':library.id+':'+take+(name==='HitLeft'||name==='HitRight'?'; Corealm directional recoil added':'')+(ghoul?'; gaunt proportions and crouched spine retarget':'')])),
    provenance:{author:'Quaternius; Corealm corpse proportion, damage and clothing edits',license:'CC0-1.0',sourceAssets:['base_male',...chosen.map(s=>path.basename(s.id)),'animation_library_1','UAL2_Standard'],modifications:'Source UV layout, anatomical albedo luminance and 65-joint weights retained. Albedo repainted to corpse pallor with verified socket, cheek-necrosis and mouth masks; source eyes clouded and burial cloth weathered. Coherent vertex/joint gaunt proportions, recessed cheeks, narrowed arms, torn left sleeve, removed lip triangles and recessed mouth/teeth. Ghoul has elongated forearms/fingers, shortened legs, deeper crouch, bare torso and bone-attached tapered claws.'},
    acceptance:'Source candidate; requires production browser motion and visual review. No source review is treated as gameplay acceptance.'}};
}
