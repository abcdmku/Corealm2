/** Texture candidates preserve promoted anatomy, rigs and animations. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const out='test-results/wilderness-creatures/refined';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const groups={ordinary:['cinderback_crag','furnace_grazer','basalt_maw','rift_carapace','voidstone_colossus','gloam_wraith'],keepers:['ashseal_warden','furnace_regent','chainbound_archon','nightforge_marshal','hollow_star']};
const paths={ordinary:'assets/art/wilderness-creatures/ordinary/anatomy-atlas-v3.png',keepers:'assets/art/wilderness-creatures/keepers/material-atlas-v4.png'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(out,{recursive:true});
const catalog={assets:[],files:{}};
const accentBytes=await sharp(paths.keepers).resize(2048,2048).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
const paleFibre=await sharp('assets/art/wilderness-creatures/ordinary/anatomy-atlas-v2.png').resize(2048,2048).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
for(const [family,ids] of Object.entries(groups)){
 const source=await readFile(paths[family]),atlas=await sharp(source).resize(2048,2048).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
 for(const species of ids){
  const id=`creature_${species}`,entry=structuredClone(manifest.assets.find(a=>a.id===id));
  if(!entry)throw Error(`Missing production creature ${id}`);
  const doc=await io.read(`game/public/assets/${entry.file}`),root=doc.getRoot();
  const tx=root.listTextures().find(t=>/original_anatomy_atlas|authored_basalt_iron_obsidian_atlas/.test(t.getName()));
  if(!tx)throw Error(`Missing body atlas ${id}`);
  tx.setImage(atlas).setMimeType('image/jpeg').setURI('');
  for(const material of root.listMaterials())if(material.getBaseColorTexture()===tx){
   material.setMetallicRoughnessTexture(null);
   material.setRoughnessFactor(/iron/.test(material.getName())?.74:/membrane/.test(material.getName())?.88:.91);
  }
  const accentTexture=doc.createTexture(`${id}_pale_material_accents`).setImage(species==='gloam_wraith'?paleFibre:accentBytes).setMimeType('image/jpeg');
  const accentMaterials=new Map();
  for(const mesh of root.listMeshes())for(const primitive of mesh.listPrimitives()){
   const material=primitive.getMaterial(),name=mesh.getName(),role=material.getName();
   const selected=species==='basalt_maw'?/upper_lobe|dorsal_slab/.test(name)
    :species==='rift_carapace'?/upright_cleaved|bifurcated_prow/.test(name)
    :species==='voidstone_colossus'?/eroded_fracture/.test(role)
    :species==='gloam_wraith'?/hollow_cowl|trailing_body_fold_1|hooked_digit/.test(name)
    :species==='chainbound_archon'?/forged_structural_iron/.test(role):false;
   if(!selected||material.getBaseColorTexture()!==tx)continue;
   let accent=accentMaterials.get(material);
   if(!accent){accent=material.clone().setName(`${role}_pale_accent`).setBaseColorTexture(accentTexture).setBaseColorFactor([1,1,1,1]);accentMaterials.set(material,accent);}
   primitive.setMaterial(accent);
   const uv=primitive.getAttribute('TEXCOORD_0'),array=Float32Array.from(uv.getArray());
   for(let i=0;i<array.length;i++)array[i]=.5+(array[i]%.5+.5)%.5;
   primitive.setAttribute('TEXCOORD_0',uv.clone().setArray(array));
  }
  if(!accentMaterials.size)accentTexture.dispose();
  // The authored surface changes only texture coordinates, never body or animation data.
  const geometryHash=hash(Buffer.concat(root.listAccessors().map(a=>Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength))));
  const file=`${id}.glb`;await io.write(`${out}/${file}`,doc);
  const bytes=await readFile(`${out}/${file}`);
  Object.assign(entry,{bytes:bytes.length,sha256:hash(bytes),materials:root.listMaterials().map(material=>material.getName()),acceptance:{exported:true,labAccepted:false,worldIntegrated:false}});
  entry.metadata.materialRefinement={generator:'tools/wilderness-creatures/refine-materials.mjs',sourceAssetSha256:manifest.assets.find(a=>a.id===id).sha256,atlas:paths[family],atlasSha256:hash(source),accessorSha256:geometryHash,scope:'Fine coloured mineral grain and pale anatomical accents. Existing texture cells remapped on selected parts; positions, normals, weights, joints, clips and recessed emission unchanged.'};
  catalog.assets.push(entry);catalog.files[id]=file;
  console.log(id);
 }
}
await writeFile(`${out}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
