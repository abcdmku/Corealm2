/** Stage lean segmented crawler bodies while retaining native supporting legs and animation rigs. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as T from 'three';
import {measureAndGround} from '../ordinary/measure.mjs';

const source='test-results/wilderness-creatures/refined';
const out='test-results/wilderness-creatures/families/crawlers';
const atlasPath='assets/art/wilderness-creatures/keepers/material-atlas-v4.png';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const catalog=JSON.parse(await readFile(`${source}/catalog.json`,'utf8'));
const result={assets:[],files:{}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const atlas=await sharp(atlasPath).resize(2048,2048).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
const protectedHash=accessors=>hash(Buffer.concat(accessors
  .map(a=>Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength))));
await mkdir(out,{recursive:true});
for(const species of ['cinderback_crag','rift_carapace']){
 const id=`creature_${species}`,deep=species==='rift_carapace';
 const entry=structuredClone(catalog.assets.find(a=>a.id===id));
 const input=await readFile(`${source}/${catalog.files[id]}`);
 if(hash(input)!==entry.sha256)throw Error(`Stale source ${id}`);
 const doc=await io.readBinary(input),root=doc.getRoot();
 const protectedAccessors=root.listAnimations().flatMap(a=>a.listSamplers().flatMap(s=>[s.getInput(),s.getOutput()]));
 const before=protectedHash(protectedAccessors);
 const tx=doc.createTexture(`${id}_anatomical_stone_surfaces`).setImage(atlas).setMimeType('image/jpeg');
 const changes=[],geometryChanges=[];
 // Transform rigid anatomy in bind-world space, then return to its existing joint's local space.
 // Native skinned legs are untouched, retaining all footfalls and their full supporting spread.
 for(const node of root.listNodes()){
  if(!node.getMesh()||node.getSkin())continue;
  const name=node.getMesh().getName();let scale,parts=1,taper=false;
  if(/split_dorsal_plate/.test(name)){scale=[.68,.62,.77];parts=6;}
  else if(/upright_cleaved/.test(name)){scale=[.55,.73,.79];parts=4;taper=true;}
  else if(/bifurcated_prow/.test(name)){scale=[.43,.53,.93];parts=2;taper=true;}
  else if(/wide_crushing_head/.test(name))scale=[.64,.55,.78];
  else if(/lower_jaw/.test(name))scale=[.72,.62,.91];
  else if(/dark_mouth/.test(name))scale=[.63,.63,.79];
  else if(/banked_inner_mantle/.test(name))scale=[deep?.53:.58,.53,.87];
  else if(/underside/.test(name))scale=[.64,.57,.9];
  else if(/prow_inner_fissure/.test(name))scale=[.62,.64,.9];
  else continue;
  const world=new T.Matrix4().fromArray(node.getWorldMatrix()),inverse=world.clone().invert();
  for(const p of node.getMesh().listPrimitives()){
   const pos=p.getAttribute('POSITION'),a=Float32Array.from(pos.getArray()),count=pos.getCount(),stride=count/parts;
   if(!Number.isInteger(stride))throw Error(`Invalid segment partition ${name}`);
   const points=Array.from({length:count},(_,i)=>new T.Vector3().fromArray(a,i*3).applyMatrix4(world));
   for(let part=0;part<parts;part++){
    const chunk=points.slice(part*stride,(part+1)*stride),bounds=new T.Box3().setFromPoints(chunk),center=bounds.getCenter(new T.Vector3());
    for(let j=0;j<chunk.length;j++){
     const v=chunk[j],rise=(v.y-bounds.min.y)/Math.max(.001,bounds.max.y-bounds.min.y);
     const tip=taper?1-.52*Math.pow(rise,2):1;
     v.x=center.x*(parts>1?.80:1)+(v.x-center.x)*scale[0]*tip;
     v.y=bounds.min.y+(v.y-bounds.min.y)*scale[1]+(/banked|underside/.test(name)?.055:0);
     v.z=center.z+(v.z-center.z)*scale[2];
     v.applyMatrix4(inverse).toArray(a,(part*stride+j)*3);
    }
   }
   p.setAttribute('POSITION',pos.clone().setArray(a));
   const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(a,3));
   if(p.getIndices())geometry.setIndex(Array.from(p.getIndices().getArray()));
   geometry.computeVertexNormals();p.setAttribute('NORMAL',p.getAttribute('NORMAL').clone().setArray(Float32Array.from(geometry.attributes.normal.array)));
  }
  geometryChanges.push({mesh:name,parts,scale,taper});
 }
 for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
  const name=mesh.getName(),old=p.getMaterial();
  let role,tile=3,color;
  if(!name){role='worn_support_limbs';color=deep?[.53,.68,.70,1]:[.65,.58,.47,1];}
  else if(/wide_crushing_head/.test(name)){role='weathered_forehead';color=[.80,.84,.79,1];}
  else if(/lower_jaw/.test(name)){role='ochre_cutting_jaws';color=[.92,.71,.45,1];}
  else if(/split_dorsal_plate/.test(name)){role='oxidized_mantle_plates';tile=1;color=[1,.88,.73,1];}
  else if(/bifurcated_prow/.test(name)){role='weathered_prow';color=[.80,.90,.86,1];}
  else continue;
  p.setMaterial(old.clone().setName(`${id}_${role}`).setBaseColorTexture(tx).setBaseColorFactor(color)
   .setMetallicFactor(0).setRoughnessFactor(.88).setMetallicRoughnessTexture(null));
  const uv=p.getAttribute('TEXCOORD_0'),a=Float32Array.from(uv.getArray());
  for(let i=0;i<a.length;i++)a[i]=((a[i]%.5+.5)%.5)+(i%2?Math.floor(tile/2)*.5:(tile%2)*.5);
  p.setAttribute('TEXCOORD_0',uv.clone().setArray(a));
  changes.push({mesh:name||'native eight-legged support',role,tile,color});
 }
 if(before!==protectedHash(protectedAccessors))throw Error(`Animation changed ${id}`);
 // The narrowed dead shell rests lower after the original roll. Bake that floor correction
 // while retaining the native limb and body channels; living clips require no new correction.
 const measurements=measureAndGround(doc,`${species}_refined_contact`);
 if(measurements.clips.some(c=>c.clip!=='Death'&&c.maxCorrection>.006))throw Error(`Crawler floor contact changed ${id}: ${JSON.stringify(measurements.clips.map(c=>[c.clip,c.maxCorrection]))}`);
 const file=`${id}.glb`;await io.write(`${out}/${file}`,doc);const bytes=await readFile(`${out}/${file}`);
 Object.assign(entry,{sha256:hash(bytes),bytes:bytes.length,materials:root.listMaterials().map(m=>m.getName()),acceptance:{exported:true,labAccepted:false,worldIntegrated:false}});
 const b=measurements.idleBounds;entry.size={x:b.max[0]-b.min[0],y:b.max[1]-b.min[1],z:b.max[2]-b.min[2]};entry.base={x:b.min[0],y:b.min[1],z:b.min[2]};
 entry.metadata.crawlerRefinement={generator:'tools/wilderness-creatures/families/crawlers.mjs',sourceSha256:hash(input),atlas:atlasPath,atlasSha256:hash(await readFile(atlasPath)),changes,geometryChanges,measurements,protectedAnimationSha256:before,scope:'Narrow segmented shells above unchanged eight-leg spread. Lower Cinderback mantle and smaller jaws; thin tapered Rift plates and paired cutting prow. Recessed cores narrowed to fit, no emission increase. Rigs, clips and footfalls preserved.'};
 result.assets.push(entry);result.files[id]=file;
 console.log(`${id}: ${changes.length} anatomy materials, ${entry.sha256}`);
}
await writeFile(`${out}/catalog.json`,JSON.stringify(result,null,2)+'\n');
