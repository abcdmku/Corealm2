import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { readSourceGlb } from '../humanoid-source/read-glb.mjs';

const sourcePath=path.resolve('game/public/assets/models/creature/creature_cinder_ravager.glb');
const output=path.resolve('tools/rpg-bestiary/mythic-source/derived');

/** Exact source mesh/rig import. No new silhouette is claimed for this reused body. */
export function buildSourceDemon() {
  const {json,bin,accessor}=readSourceGlb(sourcePath);
  const sha256=createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  const inherited=JSON.parse(fs.readFileSync(new URL('./cinder-adaptations.json',import.meta.url),'utf8'));
  const object=new THREE.Group();object.name='horned_demon';
  const jointSet=new Set(json.skins.flatMap(s=>s.joints));
  const names=new Set();
  const nodes=json.nodes.map((def,i)=>{
    const n=jointSet.has(i)?new THREE.Bone():new THREE.Group();n.name=def.name||`sourceNode${i}`;
    if(names.has(n.name))throw new Error(`Duplicate source node name ${n.name}`);names.add(n.name);
    if(def.matrix)new THREE.Matrix4().fromArray(def.matrix).decompose(n.position,n.quaternion,n.scale);
    else {if(def.translation)n.position.fromArray(def.translation);if(def.rotation)n.quaternion.fromArray(def.rotation);if(def.scale)n.scale.fromArray(def.scale);}
    return n;
  });
  json.nodes.forEach((def,i)=>{for(const child of def.children||[])nodes[i].add(nodes[child]);});
  for(const i of json.scenes[json.scene||0].nodes)object.add(nodes[i]);
  object.updateMatrixWorld(true);
  const skeletons=json.skins.map(def=>{
    const inverse=def.inverseBindMatrices===undefined?null:accessor(def.inverseBindMatrices).array;
    return new THREE.Skeleton(def.joints.map(i=>nodes[i]),inverse?def.joints.map((_,i)=>new THREE.Matrix4().fromArray(inverse,i*16)):undefined);
  });
  fs.mkdirSync(output,{recursive:true});
  const textureBindings=[];
  const materialList=(json.materials||[]).map((def,i)=>{
    const pbr=def.pbrMetallicRoughness||{},rgba=pbr.baseColorFactor||[1,1,1,1];
    const m=new THREE.MeshStandardMaterial({
      name:`animal_rpg_horned_demon_source_${i}`,color:new THREE.Color().fromArray(rgba),opacity:rgba[3],
      roughness:pbr.roughnessFactor??1,metalness:pbr.metallicFactor??1,
      side:def.doubleSided?THREE.DoubleSide:THREE.FrontSide,
      transparent:def.alphaMode==='BLEND',alphaTest:def.alphaMode==='MASK'?(def.alphaCutoff??.5):0,
      emissive:new THREE.Color().fromArray(def.emissiveFactor||[0,0,0]),
    });
    if(def.normalTexture?.scale!==undefined)m.normalScale.setScalar(def.normalTexture.scale);
    const binding={materialName:m.name,flipY:false};
    for(const [field,info]of [
      ['baseColorPath',pbr.baseColorTexture],['normalPath',def.normalTexture],
      ['metallicRoughnessPath',pbr.metallicRoughnessTexture],['occlusionPath',def.occlusionTexture],['emissivePath',def.emissiveTexture],
    ]) {
      if(!info)continue;
      const image=json.images[json.textures[info.index].source];
      if(image.mimeType!=='image/png')throw new Error(`Source texture must be losslessly staged as PNG: ${image.mimeType}`);
      const view=json.bufferViews[image.bufferView];
      const bytes=image.uri?fs.readFileSync(path.resolve(path.dirname(sourcePath),image.uri)):bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
      const filename=path.join(output,`monster04-${i}-${field}.png`);fs.writeFileSync(filename,bytes);binding[field]=filename;
      binding[`${field}Sha256`]=createHash('sha256').update(bytes).digest('hex');
    }
    textureBindings.push(binding);return m;
  });
  for(let i=0;i<json.nodes.length;i++) {
    const def=json.nodes[i];if(def.mesh===undefined)continue;
    for(const [primitiveIndex,primitive]of json.meshes[def.mesh].primitives.entries()) {
      if(primitive.mode!==undefined&&primitive.mode!==4)throw new Error('Monster source contains non-triangle primitive');
      if(primitive.targets)throw new Error('Monster source morph targets need an explicit import path');
      const geometry=new THREE.BufferGeometry();
      for(const [semantic,attribute]of Object.entries({POSITION:'position',NORMAL:'normal',TANGENT:'tangent',TEXCOORD_0:'uv',TEXCOORD_1:'uv1',COLOR_0:'color',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})) {
        if(primitive.attributes[semantic]===undefined)continue;
        const a=accessor(primitive.attributes[semantic]);geometry.setAttribute(attribute,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
      }
      if(primitive.indices!==undefined){const a=accessor(primitive.indices);geometry.setIndex(new THREE.BufferAttribute(a.array,1));}
      const material=materialList[primitive.material];if(geometry.attributes.color)material.vertexColors=true;
      const mesh=def.skin===undefined?new THREE.Mesh(geometry,material):new THREE.SkinnedMesh(geometry,material);
      mesh.name=`${nodes[i].name}_mesh_${primitiveIndex}`;mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
      nodes[i].add(mesh);object.updateMatrixWorld(true);
      if(def.skin!==undefined)mesh.bind(skeletons[def.skin],new THREE.Matrix4());
    }
  }
  const property={translation:'position',rotation:'quaternion',scale:'scale'};
  const clips=(json.animations||[]).map(def=>new THREE.AnimationClip(def.name,-1,def.channels.map(channel=>{
    const sampler=def.samplers[channel.sampler],target=channel.target;
    if(!property[target.path])throw new Error(`Unsupported animation property ${target.path}`);
    if(sampler.interpolation&&sampler.interpolation!=='LINEAR'&&sampler.interpolation!=='STEP')throw new Error(`Unsupported source interpolation ${sampler.interpolation}`);
    const Track=target.path==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
    return new Track(`${nodes[target.node].name}.${property[target.path]}`,accessor(sampler.input).array,accessor(sampler.output).array,sampler.interpolation==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear);
  })));
  for(const name of ['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'])if(!clips.some(c=>c.name===name))throw new Error(`Monster04 source lacks ${name}`);
  object.animations=clips;object.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(object,true),size=box.getSize(new THREE.Vector3());
  return {object,clips,meta:{
    ...inherited,id:'horned_demon',family:'demon',height:size.y,width:size.x,depth:size.z,dimensions:size.toArray(),
    bounds:{min:box.min.toArray(),max:box.max.toArray()},rig:'PixeliusVita Monster04 original 62-joint weighted rig',
    contactPhase:.235,attackContact:.235,attackContactPhase:.235,contactNormalized:.235,
    source:'Existing creature_cinder_ravager Monster04 source mesh, UVs, skin, atlas and adapted eight clips',
    license:'Standard Unity Asset Store EULA',provenance:{...inherited.provenance,derivedFromAsset:'creature_cinder_ravager',sourceAssetSha256:sha256,candidateModifications:'Asset identity and material names only; source mesh, bind matrices, UVs, weighted anatomy, textures and all eight adapted clips retained'},
    textureBindings,textureOrientation:'Original glTF image bytes and TEXCOORD_0 preserved; flipY=false',
    distinctSilhouette:false,acceptance:'source-body candidate; production lab visual and motion acceptance required',revision:'horned-demon-source-review-1',
  }};
}
