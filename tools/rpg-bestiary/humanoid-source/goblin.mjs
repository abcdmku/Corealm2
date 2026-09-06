import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import sharp from 'sharp';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { readSourceGlb } from './read-glb.mjs';
import { animalHeadSource, fitAnimalHead } from './animal-heads.mjs';

const root=path.resolve('game/public/assets/models');
const output=path.resolve('tools/rpg-bestiary/humanoid-source/derived');
fs.mkdirSync(output,{recursive:true});
function glb(file){
  return {...readSourceGlb(path.join(root,`${file}.glb`)),file};
}
const base=glb('character/base_male'),library=glb('animation/animation_library_1');
const clothes=['outfit_male_peasant_chest','outfit_male_peasant_legs','outfit_male_peasant_boots'].map(n=>glb(`outfit/${n}`));
const ranger=['outfit_male_ranger_chest','outfit_male_ranger_legs','outfit_male_ranger_boots'].map(n=>glb(`outfit/${n}`));
const knight=['outfit_male_knight_chest','outfit_male_knight_legs','outfit_male_knight_boots','outfit_male_knight_pauldron'].map(n=>glb(`outfit/${n}`));
const scarf=glb('outfit/outfit_male_knight_scarf'),axe=glb('weapon/axe'),staff=glb('magic/rpg_weapon_staff'),sword=glb('weapon/sword'),shield=glb('weapon/shield');
const textureFiles=new Map();
for(const source of [base,...clothes,...ranger,...knight,scarf,axe,staff,sword,shield]) for(let i=0;i<(source.json.materials||[]).length;i++){
  const mat=source.json.materials[i],bindings={};
  for(const [field,info]of [['baseColorPath',mat.pbrMetallicRoughness?.baseColorTexture],['normalPath',mat.normalTexture]]){
    if(!info)continue;const image=source.json.images[source.json.textures[info.index].source],view=source.json.bufferViews[image.bufferView];
    const bytes=image.uri?fs.readFileSync(path.resolve(root,path.dirname(source.file),image.uri)):source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength),filename=path.join(output,`${path.basename(source.file)}-${i}-${field}.png`);
    await sharp(bytes).png().toFile(filename);bindings[field]=filename;
  }
  textureFiles.set(`${source.file}:${i}`,bindings);
}

function orcPoint(v,face=true){
  const head=THREE.MathUtils.smoothstep(v.y,1.48,1.58),jaw=Math.exp(-Math.pow((v.y-1.62)/.074,2));
  const shoulder=THREE.MathUtils.smoothstep(v.y,1.1,1.4)*(1-head);
  const x=v.x*(1.18+shoulder*.13+head*(.12+.28*jaw));
  const y=v.y*1.10;
  let z=v.z*(1.27+head*.14)+head*.025;
  if(face){z+=jaw*.034*THREE.MathUtils.smoothstep(v.z,.01,.07);z+=.014*Math.exp(-Math.pow((v.y-1.72)/.022,2))*THREE.MathUtils.smoothstep(v.z,.03,.07);}
  return new THREE.Vector3(x,y,z);
}

function gnollPoint(v,face=true){
  const head=THREE.MathUtils.smoothstep(v.y,1.49,1.59),shoulder=THREE.MathUtils.smoothstep(v.y,1.1,1.45)*(1-head);
  let x=v.x*(.97+shoulder*.16+head*.21),y=v.y*1.01,z=v.z*(1.02+head*.20)+head*.16;
  if(face&&head){
    const snout=Math.exp(-Math.pow(v.x/.062,4))*Math.exp(-Math.pow((v.y-1.652)/.074,4))*THREE.MathUtils.smoothstep(v.z,.02,.072);
    z+=.145*snout;x*=1-.18*snout;
    const ear=THREE.MathUtils.smoothstep(Math.abs(v.x),.066,.086)*(1-THREE.MathUtils.smoothstep(v.z,.013,.034))*Math.exp(-Math.pow((v.y-1.691)/.036,2));
    y+=.126*ear;x+=Math.sign(v.x)*.024*ear;
  }
  return new THREE.Vector3(x,y,z);
}

function lizardPoint(v,face=true){
  const head=THREE.MathUtils.smoothstep(v.y,1.49,1.59);
  let x=v.x*(.88+head*.13),y=v.y*.99,z=v.z*(.85+head*.30)+head*.071;
  if(face&&head){
    const snout=Math.exp(-Math.pow(v.x/.075,4))*Math.exp(-Math.pow((v.y-1.651)/.08,4))*THREE.MathUtils.smoothstep(v.z,.016,.072);
    z+=.177*snout;
    y-=.027*Math.exp(-Math.pow((v.y-1.79)/.055,2));
    const ear=THREE.MathUtils.smoothstep(Math.abs(v.x),.065,.085)*(1-THREE.MathUtils.smoothstep(v.z,.013,.04))*Math.exp(-Math.pow((v.y-1.689)/.044,2));
    x-=Math.sign(v.x)*.029*ear;
  }
  return new THREE.Vector3(x,y,z);
}

// One nonlinear proportion map is applied to skin vertices and all bind joint positions.
function goblinPoint(v,face=true){
  const x=v.x,y=v.y,z=v.z,head=THREE.MathUtils.smoothstep(y,1.50,1.60);
  const yy=y<.95?y*.65:.6175+(Math.min(y,1.50)-.95)*.74+Math.max(0,y-1.50)*1.04;
  let xx=x*THREE.MathUtils.lerp(.72,1.05,head),zz=z*THREE.MathUtils.lerp(.75,1.0,head);
  if(face&&head){
    const ear=THREE.MathUtils.smoothstep(Math.abs(x),.061,.084)*(1-THREE.MathUtils.smoothstep(z,.015,.045))*Math.exp(-Math.pow((y-1.702)/.065,2));
    xx+=Math.sign(x)*.075*ear;
    const nose=Math.exp(-Math.pow(x/.025,2)-Math.pow((y-1.664)/.041,2))*THREE.MathUtils.smoothstep(z,.062,.094);
    zz+=.047*nose;
    const jaw=Math.exp(-Math.pow(x/.058,2)-Math.pow((y-1.592)/.045,2))*THREE.MathUtils.smoothstep(z,.015,.047);
    zz+=.026*jaw;
    return new THREE.Vector3(xx,yy+ear*.043,zz+.033*head);
  }
  return new THREE.Vector3(xx,yy,zz+.033*head);
}

export function buildSourceGoblin(id='goblin_scout'){
  const isOrc=id.startsWith('orc_'),archer=id==='goblin_archer',shaman=id.endsWith('_shaman'),gnoll=id.startsWith('gnoll_'),lizard=id.startsWith('lizardman_');
  const berserker=id.endsWith('_berserker'),warlord=id.endsWith('_warlord'),brute=id.endsWith('_brute'),chieftain=id.endsWith('_chieftain'),guardRole=id.endsWith('_guard');
  const thrust=gnoll&&!brute&&!chieftain||lizard&&!shaman&&!guardRole;
  const point=isOrc?orcPoint:gnoll?gnollPoint:lizard?lizardPoint:goblinPoint,family=isOrc?'orc':gnoll?'gnoll':lizard?'lizardman':'goblin',chosenClothes=berserker?ranger:isOrc||guardRole?(warlord?[...knight,scarf]:knight):chieftain?[...ranger,knight.at(-1)]:archer||gnoll?ranger:shaman?[...clothes,scarf]:clothes;
  const object=new THREE.Group();object.name=id;
  const skinDef=base.json.skins[0],jointSet=new Set(skinDef.joints),nodes=base.json.nodes.map((n,i)=>{
    const node=jointSet.has(i)?new THREE.Bone():new THREE.Group();node.name=n.name||`node${i}`;
    if(n.translation)node.position.fromArray(n.translation);if(n.rotation)node.quaternion.fromArray(n.rotation);if(n.scale)node.scale.fromArray(n.scale);
    if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(node.position,node.quaternion,node.scale);return node;
  });
  base.json.nodes.forEach((n,i)=>{for(const child of n.children||[])nodes[i].add(nodes[child]);});
  for(const index of base.json.scenes[base.json.scene||0].nodes)object.add(nodes[index]);
  object.updateMatrixWorld(true);
  const sourceGripWorld={};
  if(family==='goblin')for(const side of ['l','r'])sourceGripWorld[side]=object.getObjectByName(`hand_${side}`).localToWorld(new THREE.Vector3(side==='l'?.01:-.01,.085,0));
  const newPositions=new Map(nodes.map(n=>[n,point(n.getWorldPosition(new THREE.Vector3()),false)]));
  const visit=node=>{
    if(newPositions.has(node)){
      node.parent.updateWorldMatrix(true,false);node.position.copy(node.parent.worldToLocal(newPositions.get(node).clone()));node.updateMatrixWorld(true);
    }
    for(const child of node.children)visit(child);
  };for(const child of object.children)visit(child);
  const bones=skinDef.joints.map(i=>nodes[i]),tailBones=[],tailCenters=[];
  if(lizard){
    let parent=object.getObjectByName('pelvis');
    for(let i=0;i<7;i++){
      const bone=new THREE.Bone();bone.name=`lizard_tail_${i}`;parent.add(bone);object.updateMatrixWorld(true);
      const center=new THREE.Vector3(0,.91-i*.068,-.085-i*.15);tailCenters.push(center);
      bone.position.copy(parent.worldToLocal(center.clone()));tailBones.push(bone);bones.push(bone);parent=bone;
    }
    object.updateMatrixWorld(true);
  }
  const donor=gnoll||lizard?animalHeadSource(family):null;
  if(donor){
    const jaw=new THREE.Bone();jaw.name=`${family}_jaw`;object.getObjectByName('Head').add(jaw);object.updateMatrixWorld(true);
    jaw.position.copy(jaw.parent.worldToLocal(donor.jawPosition.clone()));bones.push(jaw);object.updateMatrixWorld(true);
  }
  const skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  const goblinGrip={};
  if(family==='goblin')for(const side of ['l','r'])goblinGrip[side]=object.getObjectByName(`hand_${side}`).worldToLocal(point(sourceGripWorld[side],false));
  const materials=new Map(),textureBindings=[];
  const addSource=(source,baseBody)=>{
    for(const sourceNode of source.json.nodes){if(sourceNode.mesh===undefined)continue;
      const sourceSkin=source.json.skins[sourceNode.skin];
      for(const primitive of source.json.meshes[sourceNode.mesh].primitives){
        const sourceMat=source.json.materials[primitive.material],key=`${source.file}:${primitive.material}`;
        if(baseBody&&donor&&!sourceMat.name.includes('Superhero'))continue;
        let mat=materials.get(key);
        if(!mat){
          const skin=baseBody&&sourceMat.name.includes('Superhero');
          mat=new THREE.MeshStandardMaterial({name:`${family}_source_${path.basename(source.file)}_${sourceMat.name}`,color:skin?(isOrc?0x7e966d:gnoll?0xbcb69d:lizard?0x779e8c:0x91aa6b):baseBody&&sourceMat.name.includes('Eyes')?0xc4b462:baseBody?0x4c4939:shaman?0xaaa299:isOrc?0x99998b:0xada390,metalness:0,roughness:.87,side:THREE.DoubleSide});
          materials.set(key,mat);textureBindings.push({materialName:mat.name,...textureFiles.get(key)});
        }
        const geometry=new THREE.BufferGeometry();
        for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){
          if(primitive.attributes[semantic]===undefined)continue;const a=source.accessor(primitive.attributes[semantic]);geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
        }
        const original=geometry.attributes.position.array.slice(),indices=primitive.indices===undefined?Array.from({length:original.length/3},(_,i)=>i):Array.from(source.accessor(primitive.indices).array);
        // Hide only skin enclosed by clothing. Forearms, hands and the entire face stay authored source topology.
        const filtered=[];
        for(let i=0;i<indices.length;i+=3){
          const tri=indices.slice(i,i+3);
          if(baseBody&&donor&&tri.some(q=>original[q*3+1]>1.535))continue;
          if(baseBody&&sourceMat.name.includes('Superhero')&&tri.every(q=>original[q*3+1]<1.51&&Math.abs(original[q*3])<(isOrc||archer||gnoll?.19:.335)))continue;
          filtered.push(...tri);
        }
        geometry.setIndex(filtered);
        const p=geometry.attributes.position;
        for(let i=0;i<p.count;i++){const v=point(new THREE.Vector3().fromArray(original,i*3));p.setXYZ(i,v.x,v.y,v.z);}
        if(baseBody&&sourceMat.name.includes('Superhero')&&(gnoll||lizard)){
          const colors=[];
          for(let i=0;i<p.count;i++){
            const x=original[i*3],y=original[i*3+1],z=original[i*3+2];let shade=1;
            if(gnoll){
              const nose=Math.exp(-Math.pow(x/.035,4)-Math.pow((y-1.665)/.026,4))*THREE.MathUtils.smoothstep(z,.073,.10);shade-=nose*.78;
              const spot=Math.sin(x*113+y*51)*Math.sin(y*87+z*133);if(y<1.55&&spot>.56)shade*=.48;
              shade*=.96+.045*Math.sin(x*357+y*171+z*209);
            }else{
              const row=Math.floor(y*175),ridge=Math.sin((x+row*.003)*245)*Math.sin(y*287);shade= ridge>.40?.75:1;
              if(z>.05&&y<1.5)shade*=1.10;
            }
            colors.push(shade,shade,shade);
          }
          geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));mat.vertexColors=true;
        }
        const si=geometry.attributes.skinIndex;
        for(let i=0;i<si.count;i++)for(let k=0;k<4;k++){
          const sourceJoint=source.json.nodes[sourceSkin.joints[si.array[i*4+k]]].name,newIndex=bones.findIndex(b=>b.name===sourceJoint);
          if(newIndex<0)throw new Error(`Unmapped source bone ${sourceJoint}`);si.array[i*4+k]=newIndex;
        }
        geometry.computeVertexNormals();geometry.computeBoundingBox();
        const mesh=new THREE.SkinnedMesh(geometry,mat);mesh.name=`goblin_${sourceNode.name}`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;object.add(mesh);mesh.bind(skeleton);
      }
    }
  };
  addSource(base,true);for(const source of chosenClothes)addSource(source,false);
  if(donor)textureBindings.push(fitAnimalHead(donor,object,skeleton,family));
  if(lizard){
    const positions=[],indices=[],weights=[],joints=[],colors=[],uv=[],segments=16,rings=31;
    for(let r=0;r<rings;r++){
      const t=r/(rings-1),segment=t*6,lower=Math.min(5,Math.floor(segment)),blend=segment-lower,center=tailCenters[lower].clone().lerp(tailCenters[lower+1],blend),radius=.112*Math.pow(1-t,1.18)+.002;
      for(let k=0;k<segments;k++){
        const a=k/segments*Math.PI*2;positions.push(center.x+Math.cos(a)*radius,center.y+Math.sin(a)*radius*.78,center.z);
        uv.push(.80+(k/segments-.5)*(.36*(1-t)+.005),.31+.62*t);
        joints.push(65+lower,65+lower+1,0,0);weights.push(1-blend,blend,0,0);
        const shade=(k%4===0?.78:1)*(r%3===0?.88:1);colors.push(shade,shade,shade);
        if(r<rings-1){const n=r*segments+k,b=r*segments+(k+1)%segments;indices.push(n,n+segments,b,b,n+segments,b+segments);}
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));g.setIndex(indices);g.computeVertexNormals();
    const mat=object.getObjectByName('lizardman_genuine_animal_skull').material;
    const tail=new THREE.SkinnedMesh(g,mat);tail.name='lizard_blended_tail';object.add(tail);tail.bind(skeleton);tail.castShadow=true;tail.frustumCulled=false;
  }
  const names={Idle:shaman?'Spell_Simple_Idle_Loop':'Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',Attack:shaman?'Spell_Simple_Shoot':archer?'Idle_Loop':thrust?'Punch_Jab':'Sword_Attack',Hit:'Hit_Chest',HitLeft:'Hit_Chest',HitRight:'Hit_Chest',Death:'Death01'};
  const clips=Object.entries(names).map(([name,sourceName])=>{
    const animation=library.json.animations.find(a=>a.name===sourceName),tracks=[];
    for(const channel of animation.channels){
      const sourceNode=library.json.nodes[channel.target.node],target=object.getObjectByName(sourceNode.name);if(!target)continue;
      const sampler=animation.samplers[channel.sampler],times=library.accessor(sampler.input).array,values=library.accessor(sampler.output).array.slice();
      if(sampler.interpolation==='CUBICSPLINE')throw new Error('Source cubic interpolation requires explicit resampling');
      const mode=sampler.interpolation==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear;
      if(channel.target.path==='rotation'){
        const sourceRest=new THREE.Quaternion().fromArray(sourceNode.rotation||[0,0,0,1]);const correction=target.quaternion.clone().multiply(sourceRest.invert());
        for(let i=0;i<values.length;i+=4){const q=new THREE.Quaternion().fromArray(values,i).premultiply(correction);q.toArray(values,i);}
        tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`,times,values,mode));
      }else if(channel.target.path==='translation'){
        const rest=sourceNode.translation||[0,0,0];
        for(let i=0;i<values.length;i+=3){
          if(target.name==='root'){values[i]=target.position.x;values[i+1]=target.position.y;values[i+2]=target.position.z;continue;}
          for(let k=0;k<3;k++)values[i+k]=target.position.getComponent(k)+(values[i+k]-rest[k])*(isOrc?1.12:gnoll||lizard?1:.72);
        }
        tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`,times,values,mode));
      }
    }
    const clip=new THREE.AnimationClip(name,-1,tracks);
    if(donor){
      const times=[],values=[];for(let j=0;j<=24;j++){const t=j/24;times.push(t*clip.duration);const angle=lizard?(name==='Attack'?.14:0)*Math.sin(t*Math.PI):(name==='Attack'?.065:.012)*Math.sin(t*Math.PI);new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle).toArray(values,j*4);}
      tracks.push(new THREE.QuaternionKeyframeTrack(`${family}_jaw.quaternion`,times,values));
    }
    if(lizard)for(let i=0;i<tailBones.length;i++){
      const times=[],values=[];for(let j=0;j<=24;j++){const t=j/24;times.push(t*clip.duration);new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.sin(t*Math.PI*2-i*.5)*.045).toArray(values,j*4);}
      tracks.push(new THREE.QuaternionKeyframeTrack(`${tailBones[i].name}.quaternion`,times,values));
    }
    if(name==='HitLeft'||name==='HitRight'){
      const track=tracks.find(t=>t.name==='spine_03.quaternion');if(track)for(let i=0;i<track.times.length;i++){
        const q=new THREE.Quaternion().fromArray(track.values,i*4),yaw=(name==='HitLeft'?1:-1)*.22*Math.sin(track.times[i]/clip.duration*Math.PI);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw)).toArray(track.values,i*4);
      }
    }
    return clip;
  });
  if(family==='goblin'){
    // Holding hands retain the source closed-fist pose even when the spell or hit
    // source opens its fingers. The free casting/drawing hand stays animated.
    const heldSide=archer?'l':'r',idle=library.json.animations.find(a=>a.name==='Idle_Loop');
    for(const channel of idle.channels){
      const sourceNode=library.json.nodes[channel.target.node];
      if(channel.target.path!=='rotation'||!new RegExp(`^(thumb|index|middle|ring|pinky)_.*_${heldSide}$`).test(sourceNode.name))continue;
      const target=object.getObjectByName(sourceNode.name),sampler=idle.samplers[channel.sampler],values=library.accessor(sampler.output).array;
      const closed=target.quaternion.clone().multiply(new THREE.Quaternion().fromArray(sourceNode.rotation||[0,0,0,1]).invert()).multiply(new THREE.Quaternion().fromArray(values));
      for(const clip of clips){const name=`${target.name}.quaternion`;clip.tracks=clip.tracks.filter(t=>t.name!==name);clip.tracks.push(new THREE.QuaternionKeyframeTrack(name,[0,clip.duration],[...closed.toArray(),...closed.toArray()]));}
    }
  }
  const attachProp=(source,holder,scale,position,rotation)=>{
    const group=new THREE.Group();group.name=`${id}_${path.basename(source.file)}`;holder.add(group);group.scale.setScalar(scale);group.position.set(...position);group.rotation.set(...rotation);
    const sourceNodes=source.json.nodes.map((n,i)=>{const g=new THREE.Group();g.name=`prop_${i}`;if(n.translation)g.position.fromArray(n.translation);if(n.rotation)g.quaternion.fromArray(n.rotation);if(n.scale)g.scale.fromArray(n.scale);if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(g.position,g.quaternion,g.scale);return g;});
    source.json.nodes.forEach((n,i)=>{for(const c of n.children||[])sourceNodes[i].add(sourceNodes[c]);});for(const i of source.json.scenes[source.json.scene||0].nodes)group.add(sourceNodes[i]);
    source.json.nodes.forEach((n,i)=>{if(n.mesh===undefined)return;for(const primitive of source.json.meshes[n.mesh].primitives){
      const geometry=new THREE.BufferGeometry();
      for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',COLOR_0:'color'})){if(primitive.attributes[semantic]===undefined)continue;const a=source.accessor(primitive.attributes[semantic]);geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));}
      if(primitive.indices!==undefined)geometry.setIndex(new THREE.BufferAttribute(source.accessor(primitive.indices).array,1));
      const sm=source.json.materials[primitive.material],key=`prop:${source.file}:${primitive.material}`;
      let mat=materials.get(key);if(!mat){mat=new THREE.MeshStandardMaterial({name:`${family}_source_${path.basename(source.file)}_${sm.name}`,color:new THREE.Color().fromArray(sm.pbrMetallicRoughness?.baseColorFactor||[1,1,1]),roughness:sm.pbrMetallicRoughness?.roughnessFactor??.8,metalness:sm.pbrMetallicRoughness?.metallicFactor??0,vertexColors:!!geometry.attributes.color,side:sm.doubleSided?THREE.DoubleSide:THREE.FrontSide});materials.set(key,mat);textureBindings.push({materialName:mat.name,...textureFiles.get(`${source.file}:${primitive.material}`)});}
      const mesh=new THREE.Mesh(geometry,mat);mesh.name=`${group.name}_mesh${i}`;mesh.castShadow=true;mesh.receiveShadow=true;sourceNodes[i].add(mesh);
    }});return group;
  };
  // Source fingers carry the held blade through attack and hit clips.
  const hand=object.getObjectByName('hand_r'),grip=new THREE.Group();grip.name='goblinKnifeGrip';grip.position.set(-.007,.061,0);grip.rotation.set(Math.PI/2,0,.15);hand.add(grip);
  if(family==='goblin')grip.position.copy(goblinGrip.r);
  const steel=new THREE.MeshStandardMaterial({name:'goblin_source_knife_steel',color:0x777d78,metalness:.65,roughness:.64}),hide=new THREE.MeshStandardMaterial({name:'goblin_source_knife_leather',color:0x382e23,roughness:.9});
  const haft=new THREE.Mesh(new THREE.CylinderGeometry(.011,.012,.105,8),hide);grip.add(haft);
  const blade=new THREE.Mesh(new THREE.ConeGeometry(.026,.24,4),steel);blade.position.y=.165;blade.scale.z=.26;grip.add(blade);
  const guard=new THREE.Mesh(new THREE.BoxGeometry(.075,.013,.024),steel);guard.position.y=.05;grip.add(guard);
  if(isOrc||archer||shaman||gnoll||lizard)hand.remove(grip);
  if(isOrc){
    const axeScale=warlord?1.32:berserker?.95:1.03;
    attachProp(axe,hand,axeScale,[-.011,.096,.18*axeScale],[Math.PI/2,Math.PI/2,0]);
    if(berserker)attachProp(axe,object.getObjectByName('hand_l'),.95,[.011,.096,.171],[Math.PI/2,Math.PI/2,0]);
    const headBone=object.getObjectByName('Head');object.updateMatrixWorld(true);
    const ivory=new THREE.MeshStandardMaterial({name:'orc_source_aged_tusks',color:0xc8bb96,roughness:.79});
    for(const s of [-1,1]){
      const curve=new THREE.CatmullRomCurve3([[s*.033,1.606,.072],[s*.038,1.632,.105],[s*.034,1.659,.103]].map(v=>point(new THREE.Vector3(...v))));
      const geometry=new THREE.TubeGeometry(curve,14,.011,9,false),pos=geometry.attributes.position;
      for(let i=0;i<pos.count;i++){const row=Math.floor(i/10),t=row/14,c=curve.getPointAt(t),v=new THREE.Vector3().fromBufferAttribute(pos,i).sub(c).multiplyScalar(1-t*.93).add(c);pos.setXYZ(i,v.x,v.y,v.z);}
      geometry.computeVertexNormals();geometry.applyMatrix4(headBone.matrixWorld.clone().invert());const tusk=new THREE.Mesh(geometry,ivory);tusk.name=`orc_lower_tusk_${s}`;tusk.castShadow=true;headBone.add(tusk);
    }
  }
  if(shaman){const scale=lizard?.62:.47;const prop=attachProp(staff,hand,scale,[-.007-.043*scale,(lizard?.085:.061)+.021*scale,-.224*scale],[Math.PI*.53,0,-Math.PI*.06]);if(family==='goblin'){const shaftGrip=new THREE.Vector3(0,.228,0).applyQuaternion(prop.quaternion).multiplyScalar(scale);prop.position.copy(goblinGrip.r).sub(shaftGrip);}}
  if(chieftain)attachProp(axe,hand,1.08,[-.01,.085,.1944],[Math.PI/2,Math.PI/2,0]);
  if(guardRole){attachProp(sword,hand,.8,[-.01,.085,-.08],[Math.PI/2,Math.PI/2,0]);attachProp(shield,object.getObjectByName('hand_l'),.83,[.01-.022*.83,.085,0],[Math.PI/2,-Math.PI/2,0]);}
  if(thrust||brute){
    const objName=brute?'Hammer_Double':'Spear';
    const mtl=new MTLLoader().parse(fs.readFileSync(path.join(output,`${objName}.mtl`),'utf8'));
    const spear=new OBJLoader().setMaterials(mtl).parse(fs.readFileSync(path.join(output,`${objName}.obj`),'utf8'));spear.name=`${family}_source_${objName.toLowerCase()}`;
    const b=new THREE.Box3().setFromObject(spear,true),c=b.getCenter(new THREE.Vector3()),size=b.getSize(new THREE.Vector3()),length=Math.max(size.x,size.y,size.z),axis=size.x===length?'x':size.z===length?'z':'y';
    const sizeScale=(brute?1.08:1.58)/length;
    spear.traverse(n=>{if(n.isMesh){n.geometry.translate(-c.x,-c.y,-c.z);n.geometry.scale(sizeScale,sizeScale,sizeScale);if(axis==='x')n.geometry.rotateZ(Math.PI/2);if(axis==='z')n.geometry.rotateX(-Math.PI/2);const ms=Array.isArray(n.material)?n.material:[n.material];n.material=ms.map(m=>new THREE.MeshStandardMaterial({name:`${family}_source_${objName}_${m.name}`,color:m.color,roughness:.78}));if(n.material.length===1)n.material=n.material[0];n.castShadow=true;}});
    hand.add(spear);spear.position.set(-.01,.085,.04);spear.rotation.x=Math.PI/2;
  }
  let bowGroup;
  if(archer){
    const sourceMtl=new MTLLoader().parse(fs.readFileSync(path.join(output,'Bow_Wooden.mtl'),'utf8'));
    bowGroup=new OBJLoader().setMaterials(sourceMtl).parse(fs.readFileSync(path.join(output,'Bow_Wooden.obj'),'utf8'));
    bowGroup.name='goblin_source_wooden_bow';const b=new THREE.Box3().setFromObject(bowGroup,true),center=b.getCenter(new THREE.Vector3()),scale=.85/(b.max.y-b.min.y);
    // The OBJ origin and bounding-box centre are not the grip. Measure the
    // LightWood handle's central cross-section before normalization.
    const gripPoints=[];bowGroup.traverse(n=>{if(n.isMesh){const mats=Array.isArray(n.material)?n.material:[n.material];for(const group of n.geometry.groups){if(mats[group.materialIndex]?.name!=='LightWood')continue;for(let i=group.start;i<group.start+group.count;i++){const p=new THREE.Vector3().fromBufferAttribute(n.geometry.attributes.position,i);if(Math.abs(p.y)<.105)gripPoints.push(p);}}}});
    if(!gripPoints.length)throw new Error('Cannot locate source bow grip cross-section');new THREE.Box3().setFromPoints(gripPoints).getCenter(center);
    bowGroup.traverse(n=>{if(n.isMesh){n.geometry.translate(-center.x,-center.y,-center.z);n.geometry.scale(scale,scale,scale);n.castShadow=true;const sourceMaterials=Array.isArray(n.material)?n.material:[n.material];n.material=sourceMaterials.map(m=>new THREE.MeshStandardMaterial({name:`goblin_source_bow_${m.name}`,color:m.color,roughness:.86}));if(n.material.length===1)n.material=n.material[0];}});
    const left=object.getObjectByName('hand_l');bowGroup.position.copy(goblinGrip.l);left.add(bowGroup);
    const bowLocal=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(-1,0,0)));
    const holdingHandWorld=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0)));
    bowGroup.quaternion.copy(bowLocal);
    const arrowMtl=new MTLLoader().parse(fs.readFileSync(path.join(output,'Arrow.mtl'),'utf8'));
    const arrow=new OBJLoader().setMaterials(arrowMtl).parse(fs.readFileSync(path.join(output,'Arrow.obj'),'utf8'));arrow.name='goblin_source_arrow';hand.add(arrow);arrow.position.set(-.007,.061,0);
    arrow.position.copy(goblinGrip.r);
    const ab=new THREE.Box3().setFromObject(arrow,true),ac=ab.getCenter(new THREE.Vector3()),as=ab.getSize(new THREE.Vector3()),axis=as.x>as.y&&as.x>as.z?'x':as.z>as.y?'z':'y',length=as[axis];
    arrow.traverse(n=>{if(n.isMesh){n.geometry.translate(-ac.x,-ac.y,-ac.z);n.geometry.scale(.55/length,.55/length,.55/length);if(axis==='x')n.geometry.rotateZ(Math.PI/2);if(axis==='z')n.geometry.rotateX(-Math.PI/2);n.geometry.translate(0,.20,0);const ms=Array.isArray(n.material)?n.material:[n.material];n.material=ms.map(m=>new THREE.MeshStandardMaterial({name:`goblin_source_arrow_${m.name}`,color:m.color,roughness:.86}));if(n.material.length===1)n.material=n.material[0];}});
    const aim=(bone,child,target)=>{
      object.updateMatrixWorld(true);const origin=bone.getWorldPosition(new THREE.Vector3()),current=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(),desired=target.clone().sub(origin).normalize();
      const q=new THREE.Quaternion().setFromUnitVectors(current,desired).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));object.updateMatrixWorld(true);
    };
    const armIK=(side,target,pole)=>{
      const upper=object.getObjectByName(`upperarm_${side}`),lower=object.getObjectByName(`lowerarm_${side}`),wrist=object.getObjectByName(`hand_${side}`);
      object.updateMatrixWorld(true);const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=wrist.getWorldPosition(new THREE.Vector3()),l1=a.distanceTo(b),l2=b.distanceTo(c),d=target.clone().sub(a),distance=Math.min(d.length(),l1+l2-.0005);d.normalize();
      const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
      const bend=pole.clone().sub(a);bend.addScaledVector(d,-bend.dot(d)).normalize();const elbow=a.clone().addScaledVector(d,along).addScaledVector(bend,height);
      aim(upper,lower,elbow);aim(lower,wrist,target);
    };
    const attack=clips.find(c=>c.name==='Attack');attack.duration=1.45;
    for(const t of attack.tracks){const old=t.times[t.times.length-1];for(let i=0;i<t.times.length;i++)t.times[i]=t.times[i]/old*attack.duration;}
    const am=new THREE.AnimationMixer(object),action=am.clipAction(attack);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const animatedNames=['upperarm_l','lowerarm_l','hand_l','upperarm_r','lowerarm_r','hand_r','goblin_source_wooden_bow','goblin_source_arrow'];
    const sampled=Object.fromEntries(animatedNames.map(n=>[n,[]])),times=[];
    for(let i=0;i<=87;i++){
      const phase=i/87,time=phase*attack.duration;am.setTime(time);object.updateMatrixWorld(true);
      const draw=phase<.48?THREE.MathUtils.smoothstep(phase,0,.38):1-THREE.MathUtils.smoothstep(phase,.48,.66);
      armIK('l',new THREE.Vector3(.015,.99,.42),new THREE.Vector3(.42,.86,.17));
      armIK('r',new THREE.Vector3(-.06,1.05,.25-.15*draw),new THREE.Vector3(-.43,.97,-.07));
      left.quaternion.copy(left.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(holdingHandWorld));
      bowGroup.quaternion.copy(bowLocal);object.updateMatrixWorld(true);
      arrow.quaternion.copy(arrow.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2)));
      for(const n of animatedNames){const node=object.getObjectByName(n);sampled[n].push(...node.quaternion.toArray());}times.push(time);
    }
    action.stop();am.uncacheClip(attack);
    attack.tracks=attack.tracks.filter(t=>!animatedNames.some(n=>t.name===`${n}.quaternion`));
    for(const n of animatedNames)attack.tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`,times,sampled[n]));
    attack.tracks.push(new THREE.VectorKeyframeTrack('goblin_source_arrow.scale',[0,.04*attack.duration,.479*attack.duration,.48*attack.duration,attack.duration],[0,0,0,1,1,1,1,1,1,0,0,0,0,0,0],THREE.InterpolateDiscrete));
    // Return the prop to its carried orientation after sampling.
    bowGroup.quaternion.copy(bowLocal);
    arrow.quaternion.identity();arrow.scale.setScalar(0);
    // Carry the bow with a bent elbow and aligned grip in every other clip.
    // The source leg, torso and free-arm motion remains unchanged.
    for(const clip of clips.filter(c=>c!==attack&&c.name!=='Death')){
      const cm=new THREE.AnimationMixer(object),ca=cm.clipAction(clip);ca.setLoop(THREE.LoopOnce,1);ca.clampWhenFinished=true;ca.play();
      const names=['upperarm_l','lowerarm_l','hand_l'],values=Object.fromEntries(names.map(n=>[n,[]])),ct=[];
      const count=Math.ceil(clip.duration*30);
      for(let i=0;i<=count;i++){
        const t=clip.duration*i/count;cm.setTime(t);object.updateMatrixWorld(true);
        const shoulder=object.getObjectByName('upperarm_l').getWorldPosition(new THREE.Vector3());
        armIK('l',shoulder.clone().add(new THREE.Vector3(.005,-.24,.19)),shoulder.clone().add(new THREE.Vector3(.15,-.15,-.04)));
        left.quaternion.copy(left.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(holdingHandWorld));
        for(const n of names)values[n].push(...object.getObjectByName(n).quaternion.toArray());ct.push(t);
      }
      ca.stop();cm.uncacheClip(clip);clip.tracks=clip.tracks.filter(t=>!names.some(n=>t.name===`${n}.quaternion`));
      for(const n of names)clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`,ct,values[n]));
    }
  }
  object.animations=clips;object.updateMatrixWorld(true);
  const mixer=new THREE.AnimationMixer(object);mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);
  let box=new THREE.Box3().setFromObject(object,true);object.position.y-=box.min.y;object.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(object,true);
  // Reset for export so the exported bind pose stays consistent with its inverse binds.
  mixer.stopAllAction();object.updateMatrixWorld(true);
  const floorCorrection={};
  const motionRoot=object.getObjectByName('root');
  for(const clip of clips){
    const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const times=[],values=[],samples=Math.ceil(clip.duration*60);let maximumLift=0;
    const sampleSet=new Set(Array.from({length:samples+1},(_,i)=>clip.duration*i/samples));
    for(const track of clip.tracks)for(const time of track.times)sampleSet.add(time);
    const sampleTimes=[...sampleSet].sort((a,b)=>a-b);
    for(const time of sampleTimes){
      mixer.setTime(time);object.updateMatrixWorld(true);
      const floor=new THREE.Box3().setFromObject(object,true).min.y,lift=Math.max(0,.002-floor);
      times.push(time);values.push(motionRoot.position.x,motionRoot.position.y+lift,motionRoot.position.z);maximumLift=Math.max(maximumLift,lift);
    }
    action.stop();mixer.uncacheClip(clip);
    clip.tracks=clip.tracks.filter(t=>t.name!=='root.position');clip.tracks.push(new THREE.VectorKeyframeTrack('root.position',times,values));
    floorCorrection[clip.name]={samples:times.length,maximumLift};
  }
  mixer.stopAllAction();object.updateMatrixWorld(true);
  const size=box.getSize(new THREE.Vector3());
  return {object,clips,meta:{family,height:size.y,dimensions:size.toArray(),rig:lizard?'source65-plus7-tail-plus-animal-jaw':gnoll?'source65-plus-animal-jaw':'entitled-universal-base-65-joint',attackContact:archer?.48:shaman||thrust?.42:.30,attackContactSource:archer?'Authored65bone two-arm IK bow release at0.48; no source archery clip exists in entitled Standard libraries':thrust?'Production characterRig.ts CLIP_MOTION_MARKERS Punch_Jab0.42; spear reach review required':shaman?'Production characterRig.ts CLIP_MOTION_MARKERS Spell_Simple_Shoot0.42':'Production characterRig.ts CLIP_MOTION_MARKERS Sword_Attack0.30',source:'Quaternius Universal Base Characters with modular source outfit, weighted source animations, species-specific vertex and joint deformation',license:donor?'CC0-1.0 body/clothing/animations; Animal Pack Deluxe head Standard Unity Asset Store EULA':shaman?'CC0-1.0 body/clothing/animations; Blink staff Standard Unity Asset Store EULA':'CC0-1.0',provenance:{sourceAssets:['base_male',...chosenClothes.map(s=>path.basename(s.file)),'animation_library_1',...(donor?[gnoll?'Animal Pack Deluxe Wolf_Rig':'creature_reedjaw_crocodile']:[]),...(isOrc?['axe']:shaman?['rpg_weapon_staff']:archer?['Bow_Wooden','Arrow']:brute?['Hammer_Double']:chieftain?['axe']:guardRole?['sword','shield']:gnoll||lizard?['Spear']:[])],license:donor?'CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA':shaman?'CC0-1.0 plus Blink weapon Standard Unity Asset Store EULA':'CC0-1.0',author:donor?'Quaternius; Jan Pec animal head':shaman?'Quaternius; Blink staff':'Quaternius',animalHeadSource:donor?{id:'animal-pack-deluxe',author:'janpec',license:'Standard Unity Asset Store EULA',source:'https://assetstore.unity.com/packages/3d/characters/animals/animal-pack-deluxe-99702',archiveSha256:'0809f4ff5aebfdf93bc7915ed9295deb79b5c11f26075edb130b4d298bc4acc1',asset:gnoll?'Wolf_Rig.fbx':'Crocodile_Rig.fbx'}:null,weaponSource:shaman?{id:'blink-free-rpg-weapons',author:'Blink',license:'Standard Unity Asset Store EULA',source:'https://assetstore.unity.com/packages/3d/props/weapons/free-rpg-weapons-199738'}:archer||thrust||brute?{id:'Medieval_Weapons_Pack_by_Quaternius',license:'CC0-1.0',sha256:'546d6e168d71cc3ea0c5d388a7834658619ac2ace8be960050e5fb1dbd344a2a'}:isOrc||chieftain||guardRole?{id:'fantasy-props-megakit',license:'CC0-1.0',sha256:'8b6f7e806d222e585478f0e1bdc6b271bbc7bc6f84dd6af8ca703a7c64f0cb1e'}:null,sourcePacks:[{id:'universal-base-characters',sha256:'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40'},{id:'modular-character-outfits-fantasy',sha256:'c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70'},{id:'universal-animation-library',sha256:'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724'}],modifications:'Coordinated nonlinear bind-space vertex and joint proportions, pointed ear and nose/jaw deformation, olive skin material, retained source texture/UV and weighted anatomy'},textureBindings,floorCorrection,...(lizard?{lizardNeck:'Closed three-bone collar-to-skull shell; source head cropped at neck z0.75m',lizardJaw:'Source Idle inverse-bind bake plus -0.40rad source-world-X closure; neutral0rad, Attack opens0.14rad'}:{}),textureOrientation:gnoll?'Body glTF UVs unchanged; donor FBX wolf UV.v inverted once for glTF texture orientation':'Original glTF TEXCOORD_0 and decoded image rows preserved; no flipY',animationAcceptance:'candidate-needs-production-lab-motion-review',revision:gnoll?'gnoll-animal-source-review-2':lizard?'lizard-animal-source-review-3':isOrc?'orc-source-review-2':archer?'goblin-archer-source-review-1':shaman?'goblin-shaman-source-review-1':'goblin-source-review-3'}};
}










