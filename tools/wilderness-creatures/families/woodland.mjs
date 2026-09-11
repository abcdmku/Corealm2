/** Stage the leafless guardian's material refinement, preserving its production rig. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const out='test-results/wilderness-creatures/families/woodland';
const atlasPath='assets/art/wilderness-creatures/woodland/hollow-bough-albedo-v3.png';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const source=manifest.assets.find(asset=>asset.id==='creature_hollow_bough');
if(!source) throw new Error('Missing production Hollow Bough');
const sourceBytes=await readFile(`game/public/assets/${source.file}`);
const doc=await io.readBinary(sourceBytes),root=doc.getRoot();
// Accessors include every position, normal, UV, skin weight, inverse bind and animation key.
const accessorHash=()=>hash(Buffer.concat(root.listAccessors().map(accessor=>{
 const array=accessor.getArray();return Buffer.from(array.buffer,array.byteOffset,array.byteLength);
})));
const before=accessorHash();
const atlasSource=await readFile(atlasPath);
const atlas=await sharp(atlasSource).resize(2048,2048).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
const material=root.listMaterials().find(material=>material.getName().endsWith('_Monster'));
if(!material?.getBaseColorTexture())throw new Error('Missing native wood material');
material.getBaseColorTexture().setName('hollow_bough_worn_wood_bark_albedo_v3').setImage(atlas).setMimeType('image/jpeg').setURI('');
material.setBaseColorFactor([1,1,1,1]).setRoughnessFactor(.94).setMetallicFactor(0);
// Retain bark relief without the native normal map crushing lower-body grain in moonlight.
material.setNormalScale(.35);
if(before!==accessorHash())throw new Error('Material refinement changed native geometry or motion');
await mkdir(out,{recursive:true});
const file='creature_hollow_bough.glb';
await io.write(`${out}/${file}`,doc);
const bytes=await readFile(`${out}/${file}`);
const asset={...structuredClone(source),bytes:bytes.length,sha256:hash(bytes),materials:root.listMaterials().map(material=>material.getName()),
 acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
asset.metadata.materialRefinement={generator:'tools/wilderness-creatures/families/woodland.mjs',sourceAssetSha256:hash(sourceBytes),
 atlas:atlasPath,atlasSha256:hash(atlasSource),accessorSha256:before,scope:'Native UV-preserving bark repaint. Pale exposed face and fingers, warm chest growth rings, pale ashen limb bark and dark hollows. Reduced normal strength. All geometry, UVs, joints, weights and clips unchanged.'};
await writeFile(`${out}/catalog.json`,JSON.stringify({assets:[asset],files:{[asset.id]:file}},null,2)+'\n');
console.log(JSON.stringify({id:asset.id,sha256:asset.sha256,bytes:asset.bytes,accessorSha256:before,triangles:asset.triangles}));
