/** Stage legacy undead surface refinements. Never changes production files. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const out='test-results/wilderness-creatures/families/undead';
const art='assets/art/wilderness-creatures/undead';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const accessorHash=root=>hash(Buffer.concat(root.listAccessors().map(a=>Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength))));
const srgb=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const color=(m,rgb)=>m.setBaseColorFactor([...rgb.map(srgb),1]);
await mkdir(out,{recursive:true});
const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
const catalog=only?JSON.parse(await readFile(`${out}/catalog.json`,'utf8')):{assets:[],files:{}};
for(const species of ['skeleton_soldier','skeleton_archer','skeleton_mage','grave_ghoul','grave_lantern']){
 if(only&&only!==species)continue;
 const id=`creature_${species}`,entry=structuredClone(manifest.assets.find(a=>a.id===id));
 if(!entry)throw Error(`Missing ${id}`);
 if(species==='grave_lantern'){
  // The previous Lantern removed the face and attached a separate cage to an
  // inflated corpse. Use the coherent native ghoul, including its source skin.
  const donor=catalog.assets.find(a=>a.id==='creature_grave_ghoul');
  if(!donor)throw Error('Build grave_ghoul before grave_lantern');
  const doc=await io.read(`${out}/${catalog.files.creature_grave_ghoul}`),root=doc.getRoot(),before=accessorHash(root);
  for(const list of [root.listNodes(),root.listMeshes(),root.listMaterials(),root.listTextures(),root.listSkins()]){
   for(const item of list){const name=item.getName().replaceAll('grave_ghoul','grave_lantern');item.setName(name.includes(species)?name:`${species}_${name||'surface'}`);}
  }
  for(const material of root.listMaterials()){
   if(/MI_Superhero_Male/.test(material.getName()))material.setBaseColorFactor([.80,.93,.89,1]);
   if(/MI_Peasant/.test(material.getName()))material.setBaseColorFactor([.68,.78,.73,1]);
   if(/MI_Eyes/.test(material.getName()))material.setEmissiveFactor([.012,.034,.021]);
  }
  if(before!==accessorHash(root))throw Error('Lantern changed native ghoul accessors');
  const file=`${id}.glb`;await io.write(`${out}/${file}`,doc);const bytes=await readFile(`${out}/${file}`);
  const candidate={...structuredClone(donor),id,file:entry.file,is:'Ashen Ghoul',tags:entry.tags,bytes:bytes.length,sha256:hash(bytes),materials:root.listMaterials().map(m=>m.getName()),acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
  candidate.metadata.materialRefinement={...donor.metadata.materialRefinement,sourceAssetSha256:donor.sha256,scope:'Restored complete native ghoul anatomy, source UVs and motions. Removed former face cage, extra rib grafts and inflated shoulders. Cooler skin and burial cloth distinguish the Lantern; a small eye emission is confined to the native eye mesh.',replacesAssetSha256:entry.sha256};
  candidate.metadata.family='zombie';candidate.metadata.style='native-ghoul-lantern';
  candidate.sourceProvenance={...candidate.sourceProvenance,lanternRevision:'Ashen Ghoul: whole native ghoul donor, no authored geometry grafts; material-only cooler variant. Legacy grave_lantern ID retained for persistence.'};
  const index=catalog.assets.findIndex(a=>a.id===id);if(index<0)catalog.assets.push(candidate);else catalog.assets[index]=candidate;
  catalog.files[id]=file;console.log(`${id}: restored native ghoul ${bytes.length} bytes; native accessors unchanged`);continue;
 }
 const doc=await io.read(`game/public/assets/${entry.file}`),root=doc.getRoot(),before=accessorHash(root);
 const texturePath=`${art}/${species.startsWith('grave_')?'ghoul-skin-v1':'bone-ivory-v1'}.png`;
 const source=await readFile(texturePath);
 const bytes=await sharp(source).resize(1024,1024).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
 let replaced=0;
 for(const material of root.listMaterials()){
  const name=material.getName();
  if(/DS_Skeleton_standard|MI_Superhero_Male/.test(name)){
   material.getBaseColorTexture().setImage(bytes).setMimeType('image/jpeg').setURI('');
   material.setRoughnessFactor(.86).setMetallicFactor(0);replaced++;
  }
  if(/DS_equipment_standard/.test(name))material.setRoughnessFactor(.68);
  if(/Variant_indigo_wool/.test(name))color(material,[.34,.39,.49]);
  if(/Variant_cloth_seams/.test(name))color(material,[.66,.60,.49]);
  if(/Variant_worn_leather/.test(name))color(material,[.42,.27,.17]);
  if(/Variant_oiled_yew/.test(name))color(material,[.49,.30,.16]);
  if(/Variant_aged_brass/.test(name)){color(material,[.72,.55,.29]);material.setMetallicFactor(.55).setRoughnessFactor(.48);}
  if(/Variant_arrowhead/.test(name)){color(material,[.54,.58,.62]);material.setMetallicFactor(.55).setRoughnessFactor(.44);}
  if(/ghoul_keratin_claws/.test(name))color(material,[.73,.66,.50]);
  if(/exposed_teeth/.test(name))color(material,[.83,.79,.64]);
  if(/MI_Peasant/.test(name))color(material,[.93,.76,.67]);
 }
 if(replaced!==1)throw Error(`Expected one body material ${id}, got ${replaced}`);
 if(before!==accessorHash(root))throw Error(`Unexpected geometry or animation change ${id}`);
 const file=`${id}.glb`;await io.write(`${out}/${file}`,doc);
 const glb=await readFile(`${out}/${file}`);
 Object.assign(entry,{bytes:glb.length,sha256:hash(glb),materials:root.listMaterials().map(m=>m.getName()),acceptance:{exported:true,labAccepted:false,worldIntegrated:false}});
 entry.metadata??={};entry.metadata.materialRefinement={generator:'tools/wilderness-creatures/families/undead.mjs',sourceAssetSha256:manifest.assets.find(a=>a.id===id).sha256,atlas:texturePath,atlasSha256:hash(source),accessorSha256:before,scope:'UV-preserving bone and corpse atlases. Ivory bone and visible role-specific leather, wood, wool and metal. All geometry, UV coordinates, rigs and animation accessors unchanged.'};
 const index=catalog.assets.findIndex(a=>a.id===id);if(index<0)catalog.assets.push(entry);else catalog.assets[index]=entry;catalog.files[id]=file;
 console.log(`${id}: ${glb.length} bytes; accessors unchanged`);
}
await writeFile(`${out}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
