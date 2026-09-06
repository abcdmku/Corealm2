/** Assemble immutable candidate bytes for a bounded gallery; no public writes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [destination,...sources]=process.argv.slice(2);
if(!destination||!sources.length)throw new Error('Usage: assemble-catalogues.mjs destination source-catalogue...');
const root=path.resolve('art/rebuild/candidates/finish-bestiary'),out=path.resolve(destination);
if(!out.startsWith(root+path.sep))throw new Error('Output must stay within bestiary candidates');
const result={packs:[],sharedTextures:[],files:{},assets:[]},seen=new Map();
for(const source of sources){
 const catalogue=JSON.parse(await fs.readFile(source,'utf8')),base=path.dirname(path.resolve(source));
 for(const item of [...catalogue.assets.map(a=>({...a,file:catalogue.files[a.id]})),...catalogue.sharedTextures]){
  const file=path.resolve(base,item.file),target=path.resolve(out,item.file);
  if(!file.startsWith(base+path.sep)||!target.startsWith(out+path.sep))throw new Error('Candidate path escapes catalogue');
  const bytes=await fs.readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==item.sha256||bytes.length!==item.bytes)throw new Error(`Source hash/size mismatch: ${file}`);
  if(seen.has(item.file)){if(seen.get(item.file)!==hash)throw new Error(`Conflicting bytes: ${item.file}`);continue;}
  seen.set(item.file,hash);await fs.mkdir(path.dirname(target),{recursive:true});
  try{const existing=await fs.readFile(target);if(!existing.equals(bytes))throw new Error(`Refusing to overwrite different candidate: ${target}`);}catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(target,bytes);}
 }
 for(const pack of catalogue.packs){const existing=result.packs.find(p=>p.id===pack.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(pack))throw new Error(`Conflicting pack ${pack.id}`);if(!existing)result.packs.push(pack);}
 for(const texture of catalogue.sharedTextures)if(!result.sharedTextures.some(t=>t.file===texture.file))result.sharedTextures.push(texture);
 for(const asset of catalogue.assets){if(result.files[asset.id])throw new Error(`Duplicate asset ${asset.id}`);result.assets.push(asset);result.files[asset.id]=catalogue.files[asset.id];}
}
const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');await fs.writeFile(path.join(out,'catalog.json'),bytes);
console.log(JSON.stringify({catalogue:path.join(out,'catalog.json'),sha256:createHash('sha256').update(bytes).digest('hex'),models:result.assets.length}));
