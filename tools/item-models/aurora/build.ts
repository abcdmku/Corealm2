import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {NodeIO,PropertyType,type Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS,KHRMaterialsIridescence,KHRMaterialsSheen} from '@gltf-transform/extensions';
import {dedup} from '@gltf-transform/functions';
import {MeshPhysicalMaterial} from 'three';
import {tailorSkirtWeights} from '../tier50-70/skin.js';
import {createAuroraMaterials} from './materials.js';

const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const author='armor-frostweave-aurora',dir=`art/item-models/candidates/${author}`,file=`${dir}/catalogue.json`;
async function files(dir:string):Promise<string[]> {
  const rows=await readdir(dir,{withFileTypes:true});
  return (await Promise.all(rows.map(row=>row.isDirectory()?files(`${dir}/${row.name}`):[`${dir}/${row.name}`]))).flat();
}
const inputs=[
  `tools/item-models/authors/${author}.ts`,
  ...(await files('tools/item-models/aurora')).filter(f=>/\.(ts|json|py)$/.test(f)),
  ...(await files('tools/item-models/tier50-70')).filter(f=>/\.(ts|json|py)$/.test(f)),
  ...(await files('tools/item-models/starhide')).filter(f=>/\.(ts|json|py)$/.test(f)),
  ...(await files('art/tier50-70/textures')).filter(f=>/\.(png|json|txt)$/.test(f)),
  ...(await files('art/aurora/textures')).filter(f=>/\.(png|json|txt)$/.test(f)),
  ...(await files('art/aurora/references')).filter(f=>/\.(png|json|txt)$/.test(f)),
  'tools/item-models/build.ts','tools/item-models/contracts.ts','tools/item-models/skin.ts',
  'tools/item-models/core/profile.ts','tools/item-models/core/contracts.ts','tools/item-models/core/body-profile.json',
  'game/public/assets/models/character/base_male.glb',
].sort();
async function dependencies(){return Promise.all(inputs.map(async file=>{
  const raw=await readFile(file),text=/\.(ts|json|py)$/.test(file),bytes=text?Buffer.from(raw.toString().replaceAll('\r\n','\n')):raw;
  return{file,sha256:hash(bytes),bytes:bytes.length,encoding:text?'utf8-lf':'binary'};
}));}
function geometryFingerprint(doc:Document) {
  return hash(JSON.stringify(doc.getRoot().listAccessors().map(a=>{
    const array=a.getArray();return[a.getName(),a.getType(),a.getComponentType(),a.getCount(),array?hash(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)):null];
  })));
}
const before=await dependencies(),io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
if(process.argv.includes('--verify')) {
  const catalog=JSON.parse(await readFile(file,'utf8'));
  assert.equal(catalog.dependencySha256,hash(JSON.stringify(before)),'Aurora authoring inputs changed');
  for(const asset of catalog.assets)assert.equal(hash(await readFile(path.join(dir,asset.file))),asset.sha256);
  console.log('Aurora sources and five GLBs verified.');
} else {
  const result=spawnSync(process.execPath,['--import','tsx','tools/item-models/build.ts','--author',author],{stdio:'inherit'});
  assert.equal(result.status,0,'Aurora export failed');
  assert.deepEqual(await dependencies(),before,'Sources changed during export');
  const catalog=JSON.parse(await readFile(file,'utf8'));
  catalog.sourceDependencies=before;catalog.dependencySha256=hash(JSON.stringify(before));
  const source=createAuroraMaterials();
  const physical=[...new Set(Object.values(source).flat())].filter(m=>m instanceof MeshPhysicalMaterial);
  for(const entry of catalog.assets) {
    const glb=path.join(dir,entry.file),doc=await io.read(glb);
    for(const mat of physical) {
      const exported=doc.getRoot().listMaterials().find(m=>m.getName()===mat.name);
      if(!exported)continue;
      if(mat.iridescence>0) {
        assert(!mat.iridescenceMap&&!mat.iridescenceThicknessMap,'Mapped films require explicit texture export');
        exported.setExtension('KHR_materials_iridescence',doc.createExtension(KHRMaterialsIridescence).createIridescence()
          .setIridescenceFactor(mat.iridescence).setIridescenceIOR(mat.iridescenceIOR)
          .setIridescenceThicknessMinimum(mat.iridescenceThicknessRange[0]).setIridescenceThicknessMaximum(mat.iridescenceThicknessRange[1]));
      }
      if(mat.sheen>0) {
        assert(!mat.sheenColorMap&&!mat.sheenRoughnessMap,'Mapped sheen requires explicit texture export');
        exported.setExtension('KHR_materials_sheen',doc.createExtension(KHRMaterialsSheen).createSheen()
          .setSheenColorFactor(mat.sheenColor.clone().multiplyScalar(mat.sheen).toArray() as [number,number,number]).setSheenRoughnessFactor(mat.sheenRoughness));
      }
    }
    entry.tailoredSkirtVertices=tailorSkirtWeights(doc);
    const fingerprint=geometryFingerprint(doc),textureCount=doc.getRoot().listTextures().length,originalBytes=entry.bytes;
    await doc.transform(dedup({propertyTypes:[PropertyType.TEXTURE]}));
    assert.equal(geometryFingerprint(doc),fingerprint,'Texture dedup changed geometry or weights');
    const bytes=await io.writeBinary(doc);await writeFile(glb,bytes);
    entry.bytes=bytes.length;entry.sha256=hash(bytes);entry.dependencySha256=catalog.dependencySha256;
    entry.textureDeduplication={originalBytes,originalTextures:textureCount,textures:doc.getRoot().listTextures().length};
    entry.tags.push('reference-tailored-candidate','aurora-ivory-gold');
    console.log(`${entry.itemId}: ${entry.triangles} triangles, ${bytes.length} bytes`);
  }
  await writeFile(file,JSON.stringify(catalog,null,2)+'\n');
}
