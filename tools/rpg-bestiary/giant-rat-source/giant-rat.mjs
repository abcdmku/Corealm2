import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import {loadNativeRatSource} from '../../creature-expansion/mammals/source-porcupine.mjs';
import {repairIsolatedToeContact} from './toe-contact.mjs';
import {readSourceGlb} from '../humanoid-source/read-glb.mjs';

const expectedSha='ed0f9a8df62321d9aebcde6c9384a97464f67d9cdabf7f21b1ec2e7e6c3c3047';
const directory=path.resolve('tools/rpg-bestiary/giant-rat-source/derived');

/** Complete faithful native rat. No anatomy edits, skeleton pruning or material recolor. */
export async function buildGiantRat(id='giant_rat',{repair=true}={}){
  const upstream=await loadNativeRatSource();
  if(upstream.sha256!==expectedSha)throw new Error(`Native rat revision changed; re-audit adapter: ${upstream.sha256}`);
  fs.mkdirSync(directory,{recursive:true});
  // Read the exact released bytes, rather than an independently rebuilt asset.
  const nativeFile=path.join(directory,'released-native.glb');fs.writeFileSync(nativeFile,upstream.bytes);
  const source=readSourceGlb(nativeFile),j=source.json,jointIds=new Set(j.skins.flatMap(s=>s.joints));
  if(jointIds.size!==133)throw new Error('Expected all 133 native and corrective joints');
  const nodes=j.nodes.map((n,i)=>{const node=jointIds.has(i)?new T.Bone():new T.Group();node.name=`giant_rat_source_${i}_${(n.name||'node').replace(/[^a-zA-Z0-9_]/g,'_')}`;
    if(n.translation)node.position.fromArray(n.translation);if(n.rotation)node.quaternion.fromArray(n.rotation);if(n.scale)node.scale.fromArray(n.scale);if(n.matrix)new T.Matrix4().fromArray(n.matrix).decompose(node.position,node.quaternion,node.scale);return node;});
  j.nodes.forEach((n,i)=>{for(const c of n.children||[])nodes[i].add(nodes[c]);});
  const object=new T.Group();object.name=id;const floorRoot=new T.Group();floorRoot.name='giant_rat_floor';object.add(floorRoot);
  for(const index of j.scenes[j.scene||0].nodes)floorRoot.add(nodes[index]);object.updateMatrixWorld(true);
  const textureBindings=[];
  const materials=j.materials.map((m,i)=>{
    const pbr=m.pbrMetallicRoughness||{},factor=pbr.baseColorFactor||[1,1,1,1];
    const material=new T.MeshStandardMaterial({name:`giant_rat_original_${i}_${m.name}`,color:new T.Color().fromArray(factor),opacity:factor[3],transparent:m.alphaMode==='BLEND',alphaTest:m.alphaMode==='MASK'?(m.alphaCutoff??.5):0,metalness:pbr.metallicFactor??1,roughness:pbr.roughnessFactor??1,side:m.doubleSided?T.DoubleSide:T.FrontSide});
    const binding={materialName:material.name,flipY:false};
    for(const [key,info]of [['baseColorPath',pbr.baseColorTexture],['normalPath',m.normalTexture],['metallicRoughnessPath',pbr.metallicRoughnessTexture]])if(info){
      const image=j.images[j.textures[info.index].source],view=j.bufferViews[image.bufferView],file=path.join(directory,`${i}-${key}.png`);
      if(image.mimeType!=='image/png')throw new Error('Unexpected native texture encoding');fs.writeFileSync(file,source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength));binding[key]=file;
    }
    if(m.normalTexture?.scale!==undefined)material.normalScale.setScalar(m.normalTexture.scale);
    if(binding.baseColorPath||binding.normalPath||binding.metallicRoughnessPath)textureBindings.push(binding);return material;
  });
  const skeletons=j.skins.map(s=>{const inverse=source.accessor(s.inverseBindMatrices).array;return new T.Skeleton(s.joints.map(i=>nodes[i]),s.joints.map((_,i)=>new T.Matrix4().fromArray(inverse,i*16)));});
  let triangles=0,vertices=0;
  j.nodes.forEach((n,i)=>{if(n.mesh===undefined)return;j.meshes[n.mesh].primitives.forEach((p,pi)=>{
    const geometry=new T.BufferGeometry();
    for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',TEXCOORD_1:'uv1',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'}))if(p.attributes[semantic]!==undefined){const a=source.accessor(p.attributes[semantic]);geometry.setAttribute(name,new T.BufferAttribute(a.array.slice(),a.itemSize,a.normalized));}
    if(p.attributes.JOINTS_1!==undefined||p.targets)throw new Error('Native rig contract changed; adapter review required');
    if(p.indices!==undefined)geometry.setIndex(new T.BufferAttribute(source.accessor(p.indices).array.slice(),1));
    const mesh=n.skin===undefined?new T.Mesh(geometry,materials[p.material]):new T.SkinnedMesh(geometry,materials[p.material]);mesh.name=`${nodes[i].name}_mesh${pi}`;mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;nodes[i].add(mesh);if(n.skin!==undefined)mesh.bind(skeletons[n.skin],new T.Matrix4());vertices+=geometry.attributes.position.count;triangles+=(geometry.index?.count??geometry.attributes.position.count)/3;
  });});
  const nativeClips=j.animations.map(animation=>{
    const tracks=[];for(const channel of animation.channels){const s=animation.samplers[channel.sampler],field={translation:'position',rotation:'quaternion',scale:'scale'}[channel.target.path];if(!field)throw new Error('Unhandled native channel');if(s.interpolation==='CUBICSPLINE')throw new Error('Cubic native clip requires explicit interpolation support');
      const Type=field==='quaternion'?T.QuaternionKeyframeTrack:T.VectorKeyframeTrack;tracks.push(new Type(`${nodes[channel.target.node].name}.${field}`,source.accessor(s.input).array.slice(),source.accessor(s.output).array.slice(),s.interpolation==='STEP'?T.InterpolateDiscrete:T.InterpolateLinear));
    }return new T.AnimationClip(animation.name,-1,tracks);
  });
  const mapping={Idle:'Idle.001',Walk:'Walk',Run:'Run',Attack:'Attack.000',Hit:'Hit',HitLeft:'Hit',HitRight:'Hit',Death:'Die'};
  const clips=Object.entries(mapping).map(([name,sourceName])=>{const original=nativeClips.find(c=>c.name===sourceName);if(!original)throw new Error(`Missing native rat clip ${sourceName}`);const clip=original.clone();clip.name=name;return clip;});
  object.scale.setScalar(upstream.normalizedPreviewScale);
  const mixer=new T.AnimationMixer(object);mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);
  let box=new T.Box3().setFromObject(object,true);const center=box.getCenter(new T.Vector3());object.position.set(-center.x,.004-box.min.y,-center.z);mixer.stopAllAction();object.updateMatrixWorld(true);
  const floorCorrection={policy:'disabled; no blanket whole-body lift'};
  const contactRepair=repair?repairIsolatedToeContact(object,clips):null;
  mixer.stopAllAction();object.updateMatrixWorld(true);mixer.clipAction(clips[0]).play();mixer.setTime(0);object.updateMatrixWorld(true);box=new T.Box3().setFromObject(object,true);mixer.stopAllAction();object.animations=clips;
  const dimensions=box.getSize(new T.Vector3());
  return {object,clips,meta:{family:'rat',height:dimensions.y,dimensions:dimensions.toArray(),vertices,triangles,rig:'original-rat-133-joints-including-100-correctives',sourceSkinned:true,textureBindings,floorCorrection,contactRepair,contactHold:['Walk front feet','Run','Death head penetration outside approved toe scope'],nativeClipMapping:mapping,nativeClipNames:nativeClips.map(c=>c.name),nativeScale:upstream.normalizedPreviewScale,attackContact:.5,attackContactSource:'Provisional native Attack.000 contact pending production review',license:upstream.provenance.license,source:upstream.provenance.url,provenance:{...upstream.provenance,source:upstream.provenance.url,sourceUrl:upstream.provenance.url,attribution:'Evil Giant Rat by CDmir and TinyWorlds, CC0. Faithful native conversion and runtime aliases for Corealm.',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',sourcePacks:[{id:'evil-giant-rat',sha256:upstream.provenance.originalSha256}],nativeGlbSha256:upstream.sha256,modifications:'Original geometry, maps and133-joint hierarchy preserved. Fixed idle wrapper grounding only, no animated body lift. Approved distal quaternion correction only for Walk BackLeg_L.003/BackLeg_R.003 and Death FrontLeg_R.003. All other native channels preserved; front Walk and Run remain HOLD.'},upstream:{sha256:upstream.sha256,report:upstream.report,provenance:upstream.provenance,normalizedPreviewScale:upstream.normalizedPreviewScale,labAccepted:upstream.labAccepted},revision:'giant-rat-contact-round2',animationAcceptance:'Not accepted. Bounded distal toe correction; front Walk and Run remain HOLD. Scoped final-byte contact audit passes approved patches only; Death head, front Walk and Run remain HOLD. No visual acceptance.'}};
}
