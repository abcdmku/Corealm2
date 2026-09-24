// Run once to pin the entitled Quaternius inputs beside the bandit builder.
// The builder itself reads only this staged tree and generated atlases.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

const dir='assets/art/tripo/imports/creatures/audit-polish-bandits';
const sourceDir=`${dir}/sources`;
const inputs=[
 'models/outfit/outfit_female_ranger.glb',
 'models/outfit/outfit_male_ranger.glb',
 'models/character/base_female.glb',
 'models/character/base_male.glb',
 'models/animation/animation_library_1.glb',
];
const pins=new Map();
const pin=async relative=>{
 const production=path.join('game/public/assets',relative);
 const staged=path.join(sourceDir,relative);
 const bytes=await readFile(production);
 await mkdir(path.dirname(staged),{recursive:true});
 await writeFile(staged,bytes);
 pins.set(relative,{productionFile:production.replaceAll('\\','/'),stagedFile:staged.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 return bytes;
};
for(const relative of inputs){
 const bytes=await pin(relative);
 if(!relative.endsWith('/ranger.glb')&&!relative.includes('ranger.glb'))continue;
 const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
 for(const image of json.images??[]){
  if(!image.uri)continue;
  const texturePath=path.posix.normalize(path.posix.join(path.posix.dirname(relative),image.uri));
  if(!texturePath.startsWith('textures/imported/'))throw new Error(`Unexpected external texture ${image.uri}`);
  if(!pins.has(texturePath))await pin(texturePath);
 }
}
await writeFile(`${dir}/source-pins.json`,JSON.stringify({schema:'corealm-bandit-source-pins/1',inputs:[...pins.values()]},null,2)+'\n');
console.log(JSON.stringify({count:pins.size,files:[...pins.keys()]},null,2));
