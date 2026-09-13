import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {NodeIO,PropertyType,type Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS,KHRMaterialsIridescence} from '@gltf-transform/extensions';
import {dedup} from '@gltf-transform/functions';
import {tailorSkirtWeights} from './skin.js';
import {createArmorMaterials} from './materials.js';
import {designForTier} from './appearance.js';
import type {ArmorTheme} from './contracts.js';
import {MeshPhysicalMaterial} from 'three';
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const themes=['dragonhide','starhide'];
const selected=process.argv.includes('--theme')?[process.argv[process.argv.indexOf('--theme')+1]!]:themes;
assert(selected.every(theme=>themes.includes(theme)));
async function files(dir:string):Promise<string[]> {
 const rows=await readdir(dir,{withFileTypes:true});
 return (await Promise.all(rows.map(row=>row.isDirectory()?files(`${dir}/${row.name}`):[`${dir}/${row.name}`]))).flat();
}
const inputs=[
 ...themes.map(theme=>`tools/item-models/authors/armor-${theme}-reference.ts`),
 ...(await files('tools/item-models/tier50-70')).filter(f=>/\.(ts|json|py)$/.test(f)),
 ...(await files('tools/item-models/starhide')).filter(f=>/\.(ts|json|py)$/.test(f)),
 ...(await files('art/tier50-70/textures')).filter(f=>/\.(png|json|txt)$/.test(f)),
 'tools/item-models/build.ts','tools/item-models/contracts.ts','tools/item-models/skin.ts',
 'tools/item-models/core/profile.ts','tools/item-models/core/contracts.ts','tools/item-models/core/body-profile.json',
 'game/public/assets/models/character/base_male.glb',
 'art/tier50-70/references/embroidered-fabric-r12.png',
 ...themes.flatMap(theme=>['hood','robe','leggings','boots','wraps'].map(part=>`art/item-icons/generated/${theme}_${part}.png`)),
].sort();
async function dependencies(){return Promise.all(inputs.map(async file=>{
 const raw=await readFile(file),text=/\.(ts|json|py)$/.test(file),bytes=text?Buffer.from(raw.toString().replaceAll('\r\n','\n')):raw;
 return{file,sha256:hash(bytes),bytes:bytes.length,encoding:text?'utf8-lf':'binary'};
}));}
const before=await dependencies();
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
function geometryFingerprint(doc:Document) {
 return hash(JSON.stringify(doc.getRoot().listAccessors().map(a=>{
  const array=a.getArray();
  return [a.getName(),a.getType(),a.getComponentType(),a.getCount(),array?hash(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)):null];
 })));
}
for(const theme of selected){
 const author=`armor-${theme}-reference`,dir=`art/item-models/candidates/${author}`,file=`${dir}/catalogue.json`;
 if(!process.argv.includes('--verify')) {
  const result=spawnSync(process.execPath,['--import','tsx','tools/item-models/build.ts','--author',author],{stdio:'inherit'});
  assert.equal(result.status,0,`${theme} export failed`);
  assert.deepEqual(await dependencies(),before,'Sources changed during export');
  const catalog=JSON.parse(await readFile(file,'utf8'));
  catalog.sourceDependencies=before;catalog.dependencySha256=hash(JSON.stringify(before));
  for(const entry of catalog.assets){
   const glb=path.join(dir,entry.file),doc=await io.read(glb);
   // The shared exporter predates thin-film materials. Preserve this set's finish
   // here without invalidating provenance for already promoted equipment.
   const sourceScutes=createArmorMaterials(designForTier(theme as ArmorTheme)).scutes;
   for(const source of sourceScutes){
    assert(source instanceof MeshPhysicalMaterial && source.iridescence>0);
    assert(!source.iridescenceMap && !source.iridescenceThicknessMap,'Add film texture export before authoring mapped films');
    const exported=doc.getRoot().listMaterials().find(m=>m.getName()===source.name);
    assert(exported,`Missing scale material ${source.name} on ${entry.itemId}`);
    exported.setExtension('KHR_materials_iridescence',doc.createExtension(KHRMaterialsIridescence).createIridescence()
      .setIridescenceFactor(source.iridescence).setIridescenceIOR(source.iridescenceIOR)
      .setIridescenceThicknessMinimum(source.iridescenceThicknessRange[0])
      .setIridescenceThicknessMaximum(source.iridescenceThicknessRange[1]));
   }
   entry.tailoredSkirtVertices=tailorSkirtWeights(doc);
   const fingerprint=geometryFingerprint(doc);
   const textureCount=doc.getRoot().listTextures().length,originalBytes=entry.bytes;
   await doc.transform(dedup({propertyTypes:[PropertyType.TEXTURE]}));
   assert.equal(geometryFingerprint(doc),fingerprint,'Texture deduplication changed geometry or skinning');
   const bytes=await io.writeBinary(doc);await writeFile(glb,bytes);
   entry.bytes=bytes.length;entry.sha256=hash(bytes);
   entry.textureDeduplication={originalBytes,originalTextures:textureCount,textures:doc.getRoot().listTextures().length};
   entry.dependencySha256=catalog.dependencySha256;entry.tags.push('reference-tailored-candidate');
   console.log(`${entry.itemId}: ${originalBytes} -> ${entry.bytes} bytes, ${textureCount} -> ${entry.textureDeduplication.textures} identical image slots`);
  }
  await writeFile(file,JSON.stringify(catalog,null,2)+'\n');
 } else {
  const catalog=JSON.parse(await readFile(file,'utf8'));
  assert.equal(catalog.dependencySha256,hash(JSON.stringify(before)),'Source dependencies changed');
  for(const asset of catalog.assets)assert.equal(hash(await readFile(path.join(dir,asset.file))),asset.sha256);
  console.log(`${theme}: sources and five GLBs verified.`);
 }
}
