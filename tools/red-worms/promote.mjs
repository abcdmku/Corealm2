/** Run after accepting the staged model in the production lab. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='test-results/red-worms/assets';
const candidate=JSON.parse(await readFile(`${root}/candidates.json`,'utf8'));
const file='game/public/assets/manifest.json';
const manifest=JSON.parse(await readFile(file,'utf8'));
for(const asset of candidate.assets) {
  const source=`${root}/${candidate.files[asset.id]}`;
  const bytes=await readFile(source);
  if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Stale candidate');
  manifest.assets=manifest.assets.filter(a=>a.id!==asset.id);
  manifest.assets.push(asset);
  await mkdir('game/public/assets/models/creature',{recursive:true});
  await copyFile(source,`game/public/assets/${asset.file}`);
}
for(const pack of candidate.packs) {
  manifest.packs=manifest.packs.filter(p=>p.id!==pack.id);
  manifest.packs.push(pack);
}
await writeFile(file,JSON.stringify(manifest,null,2)+'\n');
