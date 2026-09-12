/** Root-only replacement promotion after production-lab browser acceptance. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=p=>readFile(path.resolve(root,p));
const json=async p=>JSON.parse(await read(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
assert(process.argv.includes('--evidence'),'Provide --evidence <report.json>');
const evidencePath=process.argv[process.argv.indexOf('--evidence')+1],evidence=await json(evidencePath);
assert.equal(evidence.passed,true);
assert((evidence.acceptedCandidateIds??evidence.candidateIds??evidence.catalogIds)?.includes('crownward_timber_bridge'),'Report must explicitly accept the replacement asset');
const catalog=await json('tools/medieval-bridge/catalog.json'), inspection=await json('tools/medieval-bridge/inspection.json');
assert.equal(catalog.assets.length,1);const asset=catalog.assets[0],pack=catalog.packs[0];
assert.equal(asset.id,'crownward_timber_bridge');assert.equal(asset.file,'models/medieval-bridge/user_medieval_bridge.glb');
assert.equal(evidence.acceptedCandidateHashes?.[asset.id],asset.sha256,'Browser evidence must pin this exact candidate hash');
assert.deepEqual(asset,inspection.asset);
for(const member of inspection.sourceMembers){const b=await read(member.path);assert.equal(hash(b),member.sha256);assert.equal(b.length,member.bytes);}
const staged=await read('test-results/medieval-bridge/'+asset.file);assert.equal(hash(staged),asset.sha256);assert.equal(staged.length,asset.bytes);
const manifest=await json('game/public/assets/manifest.json');
asset.acceptance={...asset.acceptance,labAccepted:true,worldIntegrated:process.argv.includes('--integrated'),evidence:evidencePath.replaceAll('\\','/')};
const i=manifest.assets.findIndex(a=>a.id===asset.id);if(i<0)manifest.assets.push(asset);else manifest.assets[i]=asset;
const j=manifest.packs.findIndex(p=>p.id===pack.id);if(j<0)manifest.packs.push(pack);else manifest.packs[j]=pack;
await mkdir(path.resolve(root,'game/public/assets/models/medieval-bridge'),{recursive:true});
await writeFile(path.resolve(root,'game/public/assets',asset.file),staged);
await writeFile(path.resolve(root,'game/public/assets/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({promoted:asset.id,sha256:asset.sha256,evidence:evidencePath}));
