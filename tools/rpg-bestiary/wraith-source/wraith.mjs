import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import sharp from 'sharp';
import {readSourceGlb} from '../humanoid-source/read-glb.mjs';

const here=path.resolve('tools/rpg-bestiary/wraith-source');
const assets=path.resolve('game/public/assets/models');
const base=readSourceGlb(path.join(assets,'character/base_male.glb'));
const library=readSourceGlb(path.join(assets,'animation/animation_library_1.glb'));
const body=readSourceGlb(path.join(here,'source/Male_Wizard_Body.glb'));
const legs=readSourceGlb(path.join(here,'source/Male_Wizard_Legs.glb'));
const arms=readSourceGlb(path.join(here,'source/Male_Wizard_Arms.glb'));
const hood=readSourceGlb(path.join(assets,'outfit/outfit_male_ranger_hood.glb'));
const armor=readSourceGlb(path.join(assets,'outfit/outfit_male_knight_pauldron.glb'));
const derived=path.join(here,'derived');fs.mkdirSync(derived,{recursive:true});
const bindings=new Map();
for(const source of [base,body,legs,arms,hood,armor])for(let i=0;i<source.json.materials.length;i++){
  const material=source.json.materials[i],binding={flipY:false};
  for(const [key,info]of [['baseColorPath',material.pbrMetallicRoughness?.baseColorTexture],['normalPath',material.normalTexture]]){
    if(!info)continue;
    const img=source.json.images[source.json.textures[info.index].source];
    const view=img.bufferView===undefined?null:source.json.bufferViews[img.bufferView];
    const bytes=img.uri?fs.readFileSync(path.resolve(path.dirname(source.file),img.uri)):source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
    const output=path.join(derived,`${path.basename(source.file,'.glb')}-${i}-${key}.png`);
    let texture=sharp(bytes);
    if(key==='baseColorPath'&&material.name.includes('Regular'))texture=texture.grayscale().linear(.38,155).tint({r:191,g:219,b:218});
    else if(key==='baseColorPath'&&source!==base&&source!==armor)texture=texture.grayscale().linear(1.15,16).tint({r:159,g:184,b:189});
    await texture.png().toFile(output);binding[key]=output;
  }
  bindings.set(`${source.file}:${i}`,binding);
}

/** Source Wizard tailoring and original Ranger hood. No procedural replacement body. */
export function buildWraith(id='wraith'){
  if(!['wraith','banshee','revenant'].includes(id))throw new Error(`Unknown spectral creature ${id}`);
  const banshee=id==='banshee',revenant=id==='revenant';
  const object=new THREE.Group();object.name=id;
  const def=base.json.skins[0],jointIds=new Set(def.joints);
  const nodes=base.json.nodes.map((n,i)=>{
    const node=jointIds.has(i)?new THREE.Bone():new THREE.Group();node.name=n.name||`source_node_${i}`;
    if(n.translation)node.position.fromArray(n.translation);if(n.rotation)node.quaternion.fromArray(n.rotation);if(n.scale)node.scale.fromArray(n.scale);
    if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(node.position,node.quaternion,node.scale);return node;
  });
  base.json.nodes.forEach((n,i)=>{for(const c of n.children||[])nodes[i].add(nodes[c]);});
  for(const i of base.json.scenes[base.json.scene||0].nodes)object.add(nodes[i]);
  object.updateMatrixWorld(true);
  const bones=def.joints.map(i=>nodes[i]),skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  const textureBindings=[],materials=new Map();let vertices=0,triangles=0;
  const chosen=[body,arms,hood,...(revenant?[armor]:[])];
  for(const source of chosen)for(const node of source.json.nodes){
    if(node.mesh===undefined)continue;
    for(const primitive of source.json.meshes[node.mesh].primitives){
      const sm=source.json.materials[primitive.material];
      const geometry=new THREE.BufferGeometry();
      for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){
        if(primitive.attributes[semantic]===undefined)continue;const a=source.accessor(primitive.attributes[semantic]);
        geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
      }
      const p=geometry.attributes.position,index=primitive.indices===undefined?Array.from({length:p.count},(_,i)=>i):Array.from(source.accessor(primitive.indices).array),filtered=[];
      for(let i=0;i<index.length;i+=3){
        const tri=index.slice(i,i+3);
        filtered.push(...tri);
      }
      if(!filtered.length)continue;
      geometry.setIndex(filtered);
      if(source===body&&node.name==='Male_Wizard_Body'){
        // Extend the existing continuous tunic surface. The rejected pants are absent.
        // Source folds and UV islands survive this tailoring; the hanging section follows the pelvis.
        for(let i=0;i<p.count;i++){
          const y=p.getY(i),t=THREE.MathUtils.clamp((1.115-y)/(1.115-.932236969),0,1);
          if(t>0){
            const angle=Math.atan2(p.getX(i),p.getZ(i));
            const rag=.035*(Math.sin(angle*7+.6)+.45*Math.sin(angle*13));
            p.setY(i,y-t*(banshee?.87:.78)+rag*t*t);
            p.setX(i,p.getX(i)*(1+t*(banshee?.82:revenant?.45:.60)));
            p.setZ(i,p.getZ(i)*(1+t*.55));
          }
        }
      }
      if(source===hood&&banshee)for(let i=0;i<p.count;i++){
        const y=p.getY(i),z=p.getZ(i);p.setX(i,p.getX(i)*.88);
        if(y>1.55)p.setY(i,1.55+(y-1.55)*1.16);
        if(z<-.06&&y<1.68)p.setY(i,p.getY(i)-.33*(1-THREE.MathUtils.smoothstep(y,1.43,1.68)));
      }
      const si=geometry.attributes.skinIndex,sourceSkin=source.json.skins[node.skin];
      for(let i=0;i<si.count;i++)for(let k=0;k<4;k++){
        const name=source.json.nodes[sourceSkin.joints[si.array[i*4+k]]].name,j=bones.findIndex(b=>b.name===name);
        if(j<0)throw new Error(`Missing skin joint ${name}`);si.array[i*4+k]=j;
      }
      if(source===body&&node.name==='Male_Wizard_Body'){
        const sw=geometry.attributes.skinWeight,pelvis=bones.findIndex(b=>b.name==='pelvis'),spine=bones.findIndex(b=>b.name==='spine_01');
        for(let i=0;i<p.count;i++)if(p.getY(i)<1.11){si.setXYZW(i,pelvis,spine,0,0);sw.setXYZW(i,.94,.06,0,0);}
      }
      const key=`${source.file}:${primitive.material}`;let material=materials.get(key);
      if(!material){
        material=new THREE.MeshStandardMaterial({name:`${id}_source_${path.basename(source.file,'.glb')}_${sm.name}`,color:sm.name.includes('Regular')?0xe2eeee:source===armor?0x858e95:banshee?0xc5d5d2:revenant?0x8e999b:0x9cabad,roughness:source===armor?.62:.96,metalness:source===armor?.65:0,side:THREE.DoubleSide});
        materials.set(key,material);textureBindings.push({materialName:material.name,...bindings.get(key)});
      }
      geometry.computeVertexNormals();geometry.computeBoundingBox();
      const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name=`wraith_${node.name}`;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;object.add(mesh);mesh.bind(skeleton);
      vertices+=p.count;triangles+=filtered.length/3;
    }
  }
  const sourceClips={Idle:revenant?'Idle_Loop':'Spell_Simple_Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',Attack:banshee?'Spell_Simple_Shoot':'Sword_Attack',Hit:'Hit_Chest',HitLeft:'Hit_Chest',HitRight:'Hit_Chest',Death:'Death01'};
  const clips=Object.entries(sourceClips).map(([name,sourceName])=>{
    const animation=library.json.animations.find(a=>a.name===sourceName);if(!animation)throw new Error(`Missing ${sourceName}`);
    const tracks=[];
    for(const channel of animation.channels){
      const n=library.json.nodes[channel.target.node],target=object.getObjectByName(n.name);if(!target)continue;
      const sampler=animation.samplers[channel.sampler],times=library.accessor(sampler.input).array,values=library.accessor(sampler.output).array.slice();
      if(sampler.interpolation==='CUBICSPLINE')throw new Error('Cubic tracks need resampling');
      const interpolation=sampler.interpolation==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear;
      if(channel.target.path==='rotation'){
        const correction=target.quaternion.clone().multiply(new THREE.Quaternion().fromArray(n.rotation||[0,0,0,1]).invert());
        for(let i=0;i<values.length;i+=4)new THREE.Quaternion().fromArray(values,i).premultiply(correction).toArray(values,i);
        tracks.push(new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`,times,values,interpolation));
      }else if(channel.target.path==='translation'){
        const rest=n.translation||[0,0,0];for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=target.position.getComponent(k)+(target.name==='root'?0:values[i+k]-rest[k]);
        tracks.push(new THREE.VectorKeyframeTrack(`${target.name}.position`,times,values,interpolation));
      }
    }
    const clip=new THREE.AnimationClip(name,-1,tracks);
    if(name==='HitLeft'||name==='HitRight'){
      const t=tracks.find(t=>t.name==='spine_03.quaternion');if(t)for(let i=0;i<t.times.length;i++){
        const q=new THREE.Quaternion().fromArray(t.values,i*4);q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(name==='HitLeft'?1:-1)*.20*Math.sin(t.times[i]/clip.duration*Math.PI))).toArray(t.values,i*4);
      }
    }
    return clip;
  });
  object.animations=clips;
  const mixer=new THREE.AnimationMixer(object);mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);
  let box=new THREE.Box3().setFromObject(object,true);object.position.y+=.09-box.min.y;
  mixer.stopAllAction();object.updateMatrixWorld(true);
  const floorCorrection={},motionRoot=object.getObjectByName('root');
  for(const clip of clips){
    const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const samples=Math.ceil(clip.duration*60),timeSet=new Set(Array.from({length:samples+1},(_,i)=>i*clip.duration/samples));
    for(const track of clip.tracks)for(const t of track.times)timeSet.add(t);
    const times=[...timeSet].sort((a,b)=>a-b),values=[];let maximumLift=0;
    for(const time of times){
      mixer.setTime(time);object.updateMatrixWorld(true);const floor=new THREE.Box3().setFromObject(object,true).min.y,lift=Math.max(0,.012-floor);
      values.push(motionRoot.position.x,motionRoot.position.y+lift,motionRoot.position.z);maximumLift=Math.max(maximumLift,lift);
    }
    action.stop();mixer.uncacheClip(clip);clip.tracks=clip.tracks.filter(t=>t.name!=='root.position');clip.tracks.push(new THREE.VectorKeyframeTrack('root.position',times,values));
    floorCorrection[clip.name]={samples:times.length,maximumLift};
  }
  mixer.stopAllAction();object.updateMatrixWorld(true);mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(object,true);mixer.stopAllAction();
  const sources=[base,...chosen,library].map(s=>({file:path.relative(process.cwd(),s.file).replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(s.file)).digest('hex')}));
  return {object,clips,meta:{family:'wraith',height:box.getSize(new THREE.Vector3()).y,dimensions:box.getSize(new THREE.Vector3()).toArray(),rig:'entitled-universal-base-65-joint',sourceSkinned:true,vertices,triangles,textureBindings,floorCorrection,attackContact:banshee?.42:.30,attackContactSource:banshee?'Spell_Simple_Shoot production marker .42':'Sword_Attack production marker .30',license:'CC0-1.0',provenance:{author:'Quaternius',license:'CC0-1.0',sourceAssets:['base_male',...chosen.map(s=>path.basename(s.file,'.glb')),'animation_library_1'],sources,sourcePacks:[{id:'universal-base-characters',sha256:'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40'},{id:'modular-character-outfits-fantasy-source',sha256:'c1bdaa7c79bb43e8f082f8484a841ac8ec8afa0295a9cfa7e9b101cd0cd32cab'},{id:'universal-animation-library',sha256:'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724'}],modifications:'Hidden body and face; original Wizard hands. Rejected pants removed. Continuous source tunic extended to a ragged hem; lower robe reweighted to pelvis/spine to avoid leg separation. Source UV islands and normal maps retained. Basecolor textures desaturated with pale hands and cold cloth. Banshee has longer bell robe and hood veil; revenant adds source knight shoulder armor.'},textureOrientation:'Original glTF UVs and image rows, flipY false',sourceClips,animationAcceptance:'candidate-needs-production-lab-motion-review; floating cloak, no foot-contact claim',revision:`${id}-source-review-2`}};
}
