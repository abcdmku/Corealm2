import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const path = 'game/public/assets/manifest.json';
const manifest = JSON.parse(await readFile(path, 'utf8'));
const variants = [
 ['gloam_fox','redbrush_fox',[.55,.68,1], [.06,.10,.24]],
 ['moonweave_spider','webweaver_spider',[.54,.85,.76],[.03,.13,.09]],
 ['rimeback_tortoise','slateback_tortoise',[.58,.76,1],[.04,.09,.16]],
 ['cindercrest_salamander','kiln_salamander',[1,.46,.18],[.23,.045,.008]],
 ['amethyst_spider','webweaver_spider',[.76,.42,1],[.10,.025,.19]],
];
for (const [id, base, tint, glow] of variants) {
 const parent = manifest.assets.find(a => a.id === `creature_${base}`);
 const bytes = await readFile(`game/public/assets/${parent.file}`);
 const doc = await io.readBinary(bytes);
 for (const mat of doc.getRoot().listMaterials()) {
  if (/eye|teeth|claw|mouth/i.test(mat.getName())) continue;
  const original = mat.getBaseColorFactor();
  mat.setBaseColorFactor([original[0]*tint[0],original[1]*tint[1],original[2]*tint[2],original[3]]);
  mat.setEmissiveFactor(glow).setRoughnessFactor(.68);
 }
 const assetId=`creature_${id}`, file=`models/creature/${assetId}.glb`;
 await io.write(`game/public/assets/${file}`,doc);
 const result=await readFile(`game/public/assets/${file}`);
 const entry={...structuredClone(parent), id:assetId, file, bytes:result.length, sha256:createHash('sha256').update(result).digest('hex'), is:id.replaceAll('_',' ')};
 entry.metadata={...entry.metadata, regionalVariant:{sourceAssetId:parent.id, sourceSha256:parent.sha256,tint,glow,generator:'tools/build-regional-variants.mjs'}};
 manifest.assets=manifest.assets.filter(a=>a.id!==assetId); manifest.assets.push(entry);
}
await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
