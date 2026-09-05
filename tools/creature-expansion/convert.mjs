import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';

const MODULES = {
  redbrush_fox:'mammals',duskoak_lynx:'mammals',rootdelve_badger:'mammals',quillback_porcupine:'mammals',
  marchwild_horse:'hoofed',cairn_bighorn:'hoofed',marsh_moose:'hoofed',bracken_tapir:'hoofed',
  reedjaw_crocodile:'imported-animals',kiln_salamander:'imported-animals',reedbank_goose:'imported-animals',quarry_snail:'imported-animals',
  slateback_tortoise:'reptiles',ashscale_monitor:'reptiles',
  blackwater_heron:'birds',scree_bustard:'birds',marchfield_turkey:'birds',
  antler_beetle:'crawlers',slag_centipede:'crawlers',hollowroot_spider:'crawlers',
  cinder_ravager:'monsters',basalt_drake:'monsters',gorge_mantis:'monsters',quarry_nightmare:'monsters',
};
const CLIPS=['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'];
function makeExportableTextures(object){
  const converted=new Map();
  object.traverse(node=>{
    for(const material of node.material?(Array.isArray(node.material)?node.material:[node.material]):[]){
      for(const slot of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap']){
        const texture=material[slot];if(!texture?.isDataTexture)continue;
        if(!converted.has(texture)){
          const {data,width,height}=texture.image,channels=data.length/(width*height);
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const context=canvas.getContext('2d'),pixels=context.createImageData(width,height);
          for(let p=0;p<width*height;p++){
            for(let c=0;c<3;c++)pixels.data[p*4+c]=data[p*channels+Math.min(c,channels-1)];
            pixels.data[p*4+3]=channels===4?data[p*4+3]:255;
          }
          context.putImageData(pixels,0,0);
          const replacement=new THREE.CanvasTexture(canvas);
          replacement.name=texture.name;replacement.colorSpace=texture.colorSpace;
          replacement.minFilter=texture.minFilter;replacement.magFilter=texture.magFilter;
          replacement.channel=texture.channel;replacement.anisotropy=texture.anisotropy;
          replacement.generateMipmaps=texture.generateMipmaps;replacement.premultiplyAlpha=texture.premultiplyAlpha;
          replacement.flipY=texture.flipY;replacement.wrapS=texture.wrapS;replacement.wrapT=texture.wrapT;
          replacement.repeat.copy(texture.repeat);replacement.offset.copy(texture.offset);replacement.rotation=texture.rotation;
          converted.set(texture,replacement);
        }
        material[slot]=converted.get(texture);
      }
    }
  });
}
window.expansionRoster=Object.keys(MODULES);
window.inspectExpansionFbx=async url=>{
  const object=await new FBXLoader().loadAsync(url); object.updateMatrixWorld(true);
  const bones=[],meshes=[];
  object.traverse(n=>{
    if(n.isBone) bones.push({name:n.name,parent:n.parent?.name,position:n.position.toArray(),world:n.getWorldPosition(new THREE.Vector3()).toArray()});
    if(n.isMesh) meshes.push({name:n.name,vertices:n.geometry.attributes.position?.count,materials:(Array.isArray(n.material)?n.material:[n.material]).map(m=>m.name)});
  });
  return {bones,meshes,clips:object.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),bounds:new THREE.Box3().setFromObject(object).toJSON?.()};
};
window.buildExpansion=async id=>{
  if(!MODULES[id]) throw Error(`Unknown expansion species ${id}`);
  const mod=await import(`/tools/creature-expansion/${MODULES[id]}.mjs?build=${Date.now()}`);
  const built=await mod.buildSpecies(id);
  if(!built?.object || !Array.isArray(built.clips)) throw Error(`${id}: invalid buildSpecies result`);
  const {object,clips,meta={}}=built;
  for(const name of CLIPS){
    const clip=clips.find(c=>c.name===name);
    if(!clip || clip.duration<=0 || !clip.tracks.length) throw Error(`${id}: missing or empty ${name}`);
  }
  const names=new Map();
  object.traverse(n=>{if(n.name) names.set(n.name,(names.get(n.name)||0)+1);});
  const unresolved=[];
  for(const clip of clips) for(const track of clip.tracks){
    const parsed=THREE.PropertyBinding.parseTrackName(track.name);
    if(parsed.objectName!==undefined || parsed.objectIndex!==undefined) throw Error(`${id}: unsupported object-qualified GLTF animation target ${clip.name}:${track.name}`);
    if(!['position','quaternion','scale','morphTargetInfluences'].includes(parsed.propertyName) || parsed.propertyIndex!==undefined) throw Error(`${id}: unsupported GLTF animation property ${clip.name}:${track.name}`);
    if(parsed.nodeName && names.get(parsed.nodeName)>1) throw Error(`${id}: ambiguous animation target ${clip.name}:${track.name}`);
    if(parsed.nodeName && !object.getObjectByName(parsed.nodeName) && !object.getObjectByProperty('uuid',parsed.nodeName)) unresolved.push(`${clip.name}:${track.name}`);
  }
  if(unresolved.length) throw Error(`${id}: unresolved animation targets ${unresolved.slice(0,8).join(', ')}`);
  object.name ||= `creature_${id}`;
  object.userData={...object.userData,speciesId:id,sourceProvenance:meta.provenance,stagedExpansion:true};
  makeExportableTextures(object);
  object.updateMatrixWorld(true);
  const boneNames=[];
  object.traverse(n=>{if(n.isBone)boneNames.push(n.name);});
  const result=await new GLTFExporter().parseAsync(object,{binary:true,animations:clips,onlyVisible:false,maxTextureSize:1024});
  const bytes=new Uint8Array(result);let binary='';
  for(let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  object.traverse(n=>{n.geometry?.dispose();});
  return {base64:btoa(binary),meta:{...meta,boneNames,authoringModule:`tools/creature-expansion/${MODULES[id]}.mjs`},clipMetadata:clips.map(c=>({name:c.name,seconds:c.duration,tracks:c.tracks.length,userData:c.userData??{}}))};
};
