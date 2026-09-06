import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import sharp from 'sharp';
import {readSourceGlb} from '../humanoid-source/read-glb.mjs';

const root=path.resolve('game/public/assets'),out=path.resolve('tools/rpg-bestiary/minotaur-source/derived');
fs.mkdirSync(out,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
const ids=['base_male','animal_aurochs','outfit_male_peasant_legs','axe','animation_library_1'];
const sources=Object.fromEntries(ids.map(id=>{const record=manifest.assets.find(a=>a.id===id);return [id,{...readSourceGlb(path.join(root,record.file)),id,record}];}));
for(const id of ['outfit_male_knight_chest','outfit_male_knight_pauldron','outfit_male_knight_scarf','shield']){const record=manifest.assets.find(a=>a.id===id);sources[id]={...readSourceGlb(path.join(root,record.file)),id,record};}
export const minotaurProvenance={
  author:'Quaternius; janpec',
  license:'CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe',
  sourceAssets:[...ids],
  sourcePacks:manifest.packs.filter(p=>ids.some(id=>sources[id].record.pack===p.id)),
  sourceRecords:ids.map(id=>sources[id].record),
  modifications:'Coordinated humanoid bind-space vertex and joint proportions; human face reshaped into a sealed internal neck connector and toes removed; preserved shoulder peaks and continuous thighs; authored animal_aurochs head with closed rear crop and hoof topology aligned to exact foot bind centers, retaining original UVs and atlas; cropped source peasant waist cloth; source axe held at lower haft with broad blade facing outward; eight retargeted source clips and whole-mesh floor corrections',
};
const textures=new Map();
for(const s of Object.values(sources))for(let i=0;i<(s.json.materials||[]).length;i++){
  const m=s.json.materials[i],binding={flipY:false};
  for(const [field,info] of [['baseColorPath',m.pbrMetallicRoughness?.baseColorTexture],['normalPath',m.normalTexture]]){
    if(!info)continue;const im=s.json.images[s.json.textures[info.index].source];
    const view=im.bufferView===undefined?null:s.json.bufferViews[im.bufferView];
    const bytes=im.uri?fs.readFileSync(path.resolve(path.dirname(s.file),im.uri)):s.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
    binding[field]=path.join(out,`${s.id}-${i}-${field}.png`);await sharp(bytes).png().toFile(binding[field]);
  }textures.set(`${s.id}:${i}`,binding);
}
function hierarchy(s,jointSet=new Set()){
  const ns=s.json.nodes.map((n,i)=>{const o=jointSet.has(i)?new T.Bone():new T.Group();o.name=n.name||`${s.id}_${i}`;if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);if(n.matrix)new T.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);return o;});
  s.json.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>ns[i].add(ns[c])));const g=new T.Group();for(const i of s.json.scenes[s.json.scene||0].nodes)g.add(ns[i]);g.updateMatrixWorld(true);return {ns,g};
}
// Preserve the source shoulder, elbow, wrist, knuckle and muscle topology.
function bodyPoint(v){
  const chest=T.MathUtils.smoothstep(v.y,.99,1.35),neck=T.MathUtils.smoothstep(v.y,1.43,1.57);
  return new T.Vector3(v.x*(1.30+.22*chest-.06*neck),v.y*1.31,v.z*(1.50+.20*chest));
}
function rawGeometry(s,p){const g=new T.BufferGeometry();for(const [a,b] of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',COLOR_0:'color',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){if(p.attributes[a]===undefined)continue;const q=s.accessor(p.attributes[a]);g.setAttribute(b,new T.BufferAttribute(q.array.slice(),q.itemSize,q.normalized));}if(p.indices!==undefined)g.setIndex(new T.BufferAttribute(s.accessor(p.indices).array.slice(),1));return g;}
function filterTriangles(g,predicate){const indices=g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i),kept=[];for(let i=0;i<indices.length;i+=3){const tri=indices.slice(i,i+3);if(predicate(tri))kept.push(...tri);}g.setIndex(kept);return kept.length/3;}
function closeRearCut(g){
  const p=g.attributes.position,edges=new Map(),key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
  const ix=Array.from(g.index.array);for(let i=0;i<ix.length;i+=3)for(let j=0;j<3;j++){const a=ix[i+j],b=ix[i+(j+1)%3],ka=key(a),kb=key(b),k=[ka,kb].sort().join('|');if(edges.has(k))edges.get(k).count++;else edges.set(k,{a,b,ka,kb,count:1});}
  const cut=[...edges.values()].filter(e=>e.count===1&&p.getZ(e.a)<1.08&&p.getZ(e.b)<1.08),components=[];
  while(cut.length){const component=[cut.pop()],vertices=new Set([component[0].ka,component[0].kb]);let changed=true;while(changed){changed=false;for(let i=cut.length-1;i>=0;i--)if(vertices.has(cut[i].ka)||vertices.has(cut[i].kb)){const e=cut.splice(i,1)[0];component.push(e);vertices.add(e.ka);vertices.add(e.kb);changed=true;}}components.push(component);}
  const arrays=Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,Array.from(a.array)]));let centers=0;
  for(const component of components){if(component.length<3)continue;const vertices=[...new Set(component.flatMap(e=>[e.a,e.b]))],center=p.count+centers++;for(const [name,a] of Object.entries(g.attributes))for(let k=0;k<a.itemSize;k++)arrays[name].push(vertices.reduce((sum,i)=>sum+a.array[i*a.itemSize+k],0)/vertices.length);for(const e of component)ix.push(e.b,e.a,center);}
  for(const [name,a] of Object.entries(g.attributes))g.setAttribute(name,new T.BufferAttribute(new a.array.constructor(arrays[name]),a.itemSize,a.normalized));g.setIndex(ix);return centers;
}
function compact(g){if(!g.index)return;const remap=new Map(),indices=[];for(const i of g.index.array){if(!remap.has(i))remap.set(i,remap.size);indices.push(remap.get(i));}for(const [name,a] of Object.entries(g.attributes)){const values=new a.array.constructor(remap.size*a.itemSize);for(const [old,i] of remap)for(let k=0;k<a.itemSize;k++)values[i*a.itemSize+k]=a.array[old*a.itemSize+k];g.setAttribute(name,new T.BufferAttribute(values,a.itemSize,a.normalized));}g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();}
export function buildMinotaur(id='minotaur'){
  if(!['minotaur','labyrinth_guardian','elder_minotaur'].includes(id))throw new Error(`Unknown minotaur ${id}`);
  const guardian=id==='labyrinth_guardian',elder=id==='elder_minotaur';
  const usedIds=[...ids,...(guardian?['outfit_male_knight_chest','outfit_male_knight_pauldron','shield']:elder?['outfit_male_knight_pauldron','outfit_male_knight_scarf']:[])];
  const provenance=id==='minotaur'?minotaurProvenance:{...minotaurProvenance,sourceAssets:usedIds,sourceRecords:usedIds.map(id=>sources[id].record),sourcePacks:manifest.packs.filter(p=>usedIds.some(id=>sources[id].record.pack===p.id)),modifications:minotaurProvenance.modifications+(guardian?'; reinforced upper torso, shortened forward horns, source plate armor and shield; enclosed torso skin faces removed beneath cuirass and pauldrons to prevent flesh piercing chest/back plate':'; wider shoulders and forearms, enlarged spreading horn tips, single source pauldron and scarf')};
  const point=v=>{const p=bodyPoint(v);if(guardian||elder){const upper=T.MathUtils.smoothstep(v.y,.95,1.37);p.x*=1+upper*(elder?.15:.07);p.z*=1+upper*(elder?.10:.15);}return p;};
  const base=sources.base_male,skin=base.json.skins[0],{ns,g:object}=hierarchy(base,new Set(skin.joints));object.name=id;
  const positions=new Map(ns.map(n=>[n,point(n.getWorldPosition(new T.Vector3()))]));
  function move(n){if(positions.has(n)){n.parent.updateWorldMatrix(true,false);n.position.copy(n.parent.worldToLocal(positions.get(n).clone()));n.updateMatrixWorld(true);}for(const c of n.children)move(c);}for(const c of object.children)move(c);
  const bones=skin.joints.map(i=>ns[i]),skeleton=new T.Skeleton(bones);skeleton.calculateInverses();
  const textureBindings=[],materials=new Map(),counts={};
  function material(s,index){const key=`${s.id}:${index}`;if(materials.has(key))return materials.get(key);const sm=s.json.materials[index],pbr=sm.pbrMetallicRoughness||{};
    const mat=new T.MeshStandardMaterial({name:`minotaur_source_${s.id}_${sm.name}`,color:s.id==='base_male'?0x765446:s.id==='outfit_male_peasant_legs'?0x847261:new T.Color().fromArray(pbr.baseColorFactor||[1,1,1]),roughness:pbr.roughnessFactor??.85,metalness:pbr.metallicFactor??0,side:T.DoubleSide});materials.set(key,mat);textureBindings.push({materialName:mat.name,...textures.get(key)});return mat;
  }
  function addBody(s,isBody){for(const node of s.json.nodes){if(node.mesh===undefined)continue;for(const p of s.json.meshes[node.mesh].primitives){if(isBody&&!s.json.materials[p.material].name.includes('Superhero'))continue;
    const geo=rawGeometry(s,p),pos=geo.attributes.position,original=pos.array.slice();
    counts[s.id]=filterTriangles(geo,tri=>{
      // Keep shoulder peaks and continuous thighs. Human cranial topology below is
      // collapsed into the sealed neck interior rather than leaving an open amputation.
      if(isBody){
        if(tri.every(i=>original[i*3+1]<.09))return false;
        if(guardian){
          // The source cuirass and pauldrons replace the enclosed torso surface.
          // Keeping the bulked-up skin here made chest, ribs and back pierce plate.
          const covered=i=>{const x=Math.abs(original[i*3]),y=original[i*3+1];return (x<.245&&y>.975&&y<1.565)||(x<.42&&y>1.41&&y<1.57);};
          if(tri.filter(covered).length>=2)return false;
        }
        return true;
      }
      // Keep source pants as a knee-length leather wrap, exposing the calf and grafted hooves.
      if(s.id==='outfit_male_knight_pauldron'&&elder)return tri.every(i=>original[i*3]>0);
      return s.id!=='outfit_male_peasant_legs'||tri.some(i=>original[i*3+1]>.66);
    });
    for(let i=0;i<pos.count;i++){const originalPoint=new T.Vector3().fromArray(original,i*3),v=point(originalPoint);
      if(isBody&&originalPoint.y>1.49&&Math.abs(originalPoint.x)<.13){const t=T.MathUtils.smoothstep(originalPoint.y,1.49,1.57);v.x=T.MathUtils.lerp(v.x,originalPoint.x*2.05,t);v.y=T.MathUtils.lerp(v.y,1.96+(originalPoint.y-1.49)*.8,t);v.z=T.MathUtils.lerp(v.z,(originalPoint.z+.02)*1.6-.08,t);}
      if(!isBody){v.x*=1.025;v.z*=1.025;}pos.setXYZ(i,v.x,v.y,v.z);}
    const si=geo.attributes.skinIndex,ss=s.json.skins[node.skin];for(let i=0;i<si.array.length;i++){const name=s.json.nodes[ss.joints[si.array[i]]].name;si.array[i]=bones.findIndex(b=>b.name===name);if(si.array[i]<0)throw new Error(`Missing bone ${name}`);}
    geo.computeVertexNormals();const mesh=new T.SkinnedMesh(geo,material(s,p.material));mesh.name=`minotaur_${s.id}`;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;object.add(mesh);mesh.bind(skeleton);
  }}}
  addBody(base,true);addBody(sources.outfit_male_peasant_legs,false);
  if(guardian){addBody(sources.outfit_male_knight_chest,false);addBody(sources.outfit_male_knight_pauldron,false);}
  if(elder){addBody(sources.outfit_male_knight_pauldron,false);addBody(sources.outfit_male_knight_scarf,false);}
  object.traverse(n=>{if(n.isMesh)compact(n.geometry);});object.updateMatrixWorld(true);
  const bovine=sources.animal_aurochs,bovineHierarchy=hierarchy(bovine);
  function graft(name,holder,predicate,transform){for(let ni=0;ni<bovine.json.nodes.length;ni++){const n=bovine.json.nodes[ni];if(n.mesh===undefined)continue;for(const p of bovine.json.meshes[n.mesh].primitives){
    const geo=rawGeometry(bovine,p);geo.applyMatrix4(bovineHierarchy.ns[ni].matrixWorld);const pos=geo.attributes.position;
    counts[name]=filterTriangles(geo,tri=>tri.every(i=>predicate(new T.Vector3().fromBufferAttribute(pos,i))));
    if(!counts[name])throw new Error(`Empty graft ${name}`);
    if(name==='minotaur_authored_bull_head')counts.closedRearHeadCuts=closeRearCut(geo);
    const transformedPosition=geo.attributes.position,inv=holder.matrixWorld.clone().invert();for(let i=0;i<transformedPosition.count;i++){const v=transform(new T.Vector3().fromBufferAttribute(transformedPosition,i)).applyMatrix4(inv);transformedPosition.setXYZ(i,v.x,v.y,v.z);}
    geo.deleteAttribute('skinIndex');geo.deleteAttribute('skinWeight');geo.computeVertexNormals();const mesh=new T.Mesh(geo,material(bovine,p.material));mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;holder.add(mesh);
  }}}
  // A slight backward skull pitch raises the muzzle without turning the bull face into a human mask.
  const skullOrigin=new T.Vector3(0,1.19,1.13),skullPitch=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),-.25);
  graft('minotaur_authored_bull_head',object.getObjectByName('Head'),v=>v.z>.92,v=>{if(guardian||elder){const horn=T.MathUtils.smoothstep(v.y,1.36,1.51)*T.MathUtils.smoothstep(Math.abs(v.x),.075,.13);if(elder){v.x*=1+horn*.40;v.y+=horn*.065;}else{v.y-=horn*.055;v.z+=horn*.06;}}return v.sub(skullOrigin).applyQuaternion(skullPitch).multiply(new T.Vector3(1.30,1.15,1.12)).add(new T.Vector3(0,2.15,.095));});
  for(const sign of [-1,1]){const foot=object.getObjectByName(sign===1?'foot_l':'foot_r'),ankle=foot.getWorldPosition(new T.Vector3());graft(`minotaur_authored_hoof_${sign}`,foot,v=>v.y<.15&&v.z>.25&&v.z<.65&&v.x*sign>.04,v=>new T.Vector3((v.x-sign*.1915)*1.4+ankle.x,(v.y+.0048)*1.4,(v.z-.438)*1.45+ankle.z));}
  // Preserve the entitled axe's mesh hierarchy and vertex colours.
  const axe=sources.axe,{ns:an,g:ag}=hierarchy(axe);ag.name='minotaur_source_axe';ag.scale.setScalar(1.4);ag.position.set(-.014,.125,.252);ag.rotation.set(Math.PI/2,Math.PI/2,0);object.getObjectByName('hand_r').add(ag);
  axe.json.nodes.forEach((n,i)=>{if(n.mesh===undefined)return;for(const p of axe.json.meshes[n.mesh].primitives){const geo=rawGeometry(axe,p),mat=material(axe,p.material);mat.vertexColors=!!geo.attributes.color;const mesh=new T.Mesh(geo,mat);mesh.castShadow=mesh.receiveShadow=true;an[i].add(mesh);}});
  if(guardian){const source=sources.shield,{ns:sn,g:sg}=hierarchy(source);sg.name='minotaur_guardian_source_shield';sg.scale.setScalar(1.1);sg.position.set(.06,.06,-.015);sg.rotation.set(Math.PI/2,0,Math.PI/2);object.getObjectByName('hand_l').add(sg);source.json.nodes.forEach((n,i)=>{if(n.mesh===undefined)return;for(const p of source.json.meshes[n.mesh].primitives){const geo=rawGeometry(source,p),mat=material(source,p.material);mat.vertexColors=!!geo.attributes.color;const mesh=new T.Mesh(geo,mat);mesh.castShadow=mesh.receiveShadow=true;sn[i].add(mesh);}});}
  const library=sources.animation_library_1,names={Idle:'Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',Attack:'Sword_Attack',Hit:'Hit_Chest',HitLeft:'Hit_Chest',HitRight:'Hit_Chest',Death:'Death01'};
  const clips=Object.entries(names).map(([name,src])=>{const animation=library.json.animations.find(a=>a.name===src),tracks=[];for(const ch of animation.channels){const sn=library.json.nodes[ch.target.node],target=object.getObjectByName(sn.name);if(!target)continue;const sampler=animation.samplers[ch.sampler],times=library.accessor(sampler.input).array,values=library.accessor(sampler.output).array.slice();if(sampler.interpolation==='CUBICSPLINE')throw new Error('Unsupported cubic');const mode=sampler.interpolation==='STEP'?T.InterpolateDiscrete:T.InterpolateLinear;
    if(ch.target.path==='rotation'){const correction=target.quaternion.clone().multiply(new T.Quaternion().fromArray(sn.rotation||[0,0,0,1]).invert());for(let i=0;i<values.length;i+=4)new T.Quaternion().fromArray(values,i).premultiply(correction).toArray(values,i);tracks.push(new T.QuaternionKeyframeTrack(`${target.name}.quaternion`,times,values,mode));}
    if(ch.target.path==='translation'){const rest=sn.translation||[0,0,0];for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=target.position.getComponent(k)+(target.name==='root'?0:(values[i+k]-rest[k])*1.31);tracks.push(new T.VectorKeyframeTrack(`${target.name}.position`,times,values,mode));}
  }const clip=new T.AnimationClip(name,-1,tracks);if(name==='HitLeft'||name==='HitRight'){const t=tracks.find(t=>t.name==='spine_03.quaternion');if(t)for(let i=0;i<t.times.length;i++){const q=new T.Quaternion().fromArray(t.values,i*4);q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),(name==='HitLeft'?1:-1)*.22*Math.sin(t.times[i]/clip.duration*Math.PI))).toArray(t.values,i*4);}}return clip;});
  if(guardian){const mixer=new T.AnimationMixer(object),a=mixer.clipAction(clips.find(c=>c.name==='Idle'));a.play();mixer.setTime(.1);object.updateMatrixWorld(true);const shield=object.getObjectByName('minotaur_guardian_source_shield'),hand=shield.parent;shield.quaternion.copy(hand.getWorldQuaternion(new T.Quaternion()).invert().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI*.35)));shield.position.copy(hand.worldToLocal(hand.getWorldPosition(new T.Vector3()).add(new T.Vector3(.12,.12,.025))));a.stop();mixer.uncacheRoot(object);}
  object.traverse(n=>{if(n.isMesh)compact(n.geometry);});object.updateMatrixWorld(true);
  // Measure only referenced triangles; deleted human head/toes are not rendered.
  function floor(){let y=Infinity;object.updateMatrixWorld(true);object.traverse(n=>{if(!n.isMesh)return;const pos=n.geometry.attributes.position,indices=n.geometry.index?.array||Array.from({length:pos.count},(_,i)=>i);if(n.isSkinnedMesh)n.skeleton.update();for(const i of new Set(indices)){const v=new T.Vector3().fromBufferAttribute(pos,i);if(n.isSkinnedMesh)n.applyBoneTransform(i,v);v.applyMatrix4(n.matrixWorld);y=Math.min(y,v.y);}});return y;}
  const restFloor=floor();object.position.y-=restFloor;
  // Sample authored motion and lift the root only where any rendered part crosses the floor.
  // Airborne stride phases remain airborne; the larger bovine skull is included during death.
  const checks=[];for(const clip of clips){const mixer=new T.AnimationMixer(object),a=mixer.clipAction(clip);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();const times=[],values=[],steps=Math.ceil(clip.duration*60),rootBone=object.getObjectByName('root');let min=Infinity,max=-Infinity;for(let i=0;i<=steps;i++){const time=clip.duration*i/steps;mixer.setTime(time);const y=floor();min=Math.min(min,y);max=Math.max(max,y);times.push(time);const world=rootBone.getWorldPosition(new T.Vector3());world.y+=Math.max(0,-y)+.002;values.push(...rootBone.parent.worldToLocal(world).toArray());}a.stop();mixer.uncacheRoot(object);clip.tracks=clip.tracks.filter(t=>t.name!=='root.position');clip.tracks.push(new T.VectorKeyframeTrack('root.position',times,values));checks.push({clip:clip.name,beforeCorrectionMinFloor:min,beforeCorrectionMaxFloor:max});}
  for(const clip of clips){const mixer=new T.AnimationMixer(object),a=mixer.clipAction(clip);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();let min=Infinity,max=-Infinity;for(let i=0;i<=32;i++){mixer.setTime(clip.duration*i/32);const y=floor();min=Math.min(min,y);max=Math.max(max,y);}Object.assign(checks.find(c=>c.clip===clip.name),{minFloor:min,maxFloor:max});a.stop();mixer.uncacheRoot(object);}
  object.updateMatrixWorld(true);
  const dimensions=new T.Box3().setFromObject(object,true).getSize(new T.Vector3());
  return {object,clips,meta:{id,revision:id==='minotaur'?'minotaur-source-review-2':guardian?'labyrinth_guardian-source-review-2':id+'-source-review-1',provenance,family:'minotaur',height:dimensions.y,dimensions:dimensions.toArray(),rig:'source65-bovine-head-and-hooves',attackContact:.30,attackContactSource:'Production Sword_Attack marker 0.30; source axe review required',license:'CC0-1.0 humanoid/clothing/axe/animations; animal-pack-deluxe Standard Unity Asset Store EULA as recorded in manifest',source:'Quaternius base male, peasant cloth, axe and animation; janpec animal-pack-deluxe bovine head and hooves',textureBindings,sourceRecords:provenance.sourceRecords,sourcePacks:provenance.sourcePacks,counts,restFloor,animationFloorChecks:checks,approval:'candidate-awaiting-production-browser-review'}};
}






