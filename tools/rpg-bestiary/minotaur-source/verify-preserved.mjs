import fs from 'node:fs';
import {createHash} from 'node:crypto';
const {buildMinotaur}=await import(process.argv.includes('--before')?'./minotaur-before-guardian.mjs':'./minotaur.mjs');
const hashes={};
for(const id of ['minotaur','elder_minotaur']){const r=buildMinotaur(id),h=createHash('sha256');r.object.traverse(n=>{h.update(n.name);h.update(JSON.stringify([n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()]));if(n.isMesh){for(const [k,a]of Object.entries(n.geometry.attributes)){h.update(k);h.update(Buffer.from(a.array.buffer));}if(n.geometry.index)h.update(Buffer.from(n.geometry.index.array.buffer));}});for(const c of r.clips){h.update(c.name);h.update(String(c.duration));for(const t of c.tracks){h.update(t.name);h.update(Buffer.from(t.times.buffer));h.update(Buffer.from(t.values.buffer));}}hashes[id]=h.digest('hex');}
const target='tools/rpg-bestiary/minotaur-source/guardian-preservation-baseline.json';
if(process.argv.includes('--verify')){const old=JSON.parse(fs.readFileSync(target));if(JSON.stringify(old)!==JSON.stringify(hashes))throw new Error('Unrelated variant changed');console.log('unchanged',hashes);}else fs.writeFileSync(target,JSON.stringify(hashes,null,2)+'\n');

