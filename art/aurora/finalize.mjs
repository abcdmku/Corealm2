import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async f=>JSON.parse((await readFile(f,'utf8')).replace(/^\uFEFF/,''));
const round=process.argv[2];
assert(/^aurora-r\d+$/.test(round??''),'Pass the current accepted Aurora round');
const candidate='art/item-models/candidates/armor-frostweave-aurora';
const catalog=await json(`${candidate}/catalogue.json`);
const registry=await json('art/item-models/registry.json');
const checks={};
for(const [name,file] of Object.entries({
  geometry:'runs/aurora/geometry-materials.json', viewer:'runs/aurora/viewer.json',
  pieces:`test-results/item-models/${round}-pieces/report.json`,
  worn:`test-results/item-models/${round}-worn-cast/report.json`,
  world:`test-results/item-models/${round}-world/report.json`,
  icons:'runs/aurora/icons.json',visual:'runs/aurora/visual-review.json',code:'runs/aurora/code-checks.json',
})) {const report=await json(file); assert(report.passed,`${name} failed`);checks[name]={file,sha256:hash(await readFile(file)),report};}
for(const dep of catalog.sourceDependencies){const b=await readFile(dep.file);assert.equal(hash(dep.encoding==='utf8-lf'?Buffer.from(b.toString().replaceAll('\r\n','\n')):b),dep.sha256,`Stale dependency ${dep.file}`);}
for(const asset of catalog.assets){
  assert.equal(hash(await readFile(`${candidate}/${asset.file}`)),asset.sha256);
  assert.equal(hash(await readFile(`game/public/assets/${asset.file}`)),asset.sha256);
  assert(registry.items[asset.itemId].promoted);
  for(const name of ['geometry','pieces','worn','world'])assert(checks[name].report.assets.some(a=>a.itemId===asset.itemId&&a.sha256===asset.sha256),`${name} stale ${asset.itemId}`);
  assert(checks.viewer.report.assets.some(a=>a.sha256===asset.sha256),'Viewer stale');
}
assert.equal(checks.visual.report.dependencySha256,catalog.dependencySha256,'Visual review stale');
for(const row of checks.icons.report.rows){assert.equal(hash(await readFile(row.source)),row.sourceSha256);for(const o of row.outputs)assert.equal(hash(await readFile(o.file)),o.sha256);}
const blendHash=hash(await readFile('art/aurora/aurora-set.blend'));
const renders=[];
for(const dir of ['art/aurora','art/aurora/renders','art/aurora/icons'])for(const name of await readdir(dir)){
  if(!name.endsWith('.json'))continue;
  const file=`${dir}/${name}`,r=await json(file);
  if(!r.renderSha256)continue;
  assert.equal(r.sourceSha256,blendHash,`${file}: stale Blender source`);
  assert.equal(hash(await readFile(path.join(dir,r.render))),r.renderSha256);
  renders.push({file,sha256:hash(await readFile(file))});
}
assert(renders.length>=12,'Missing studio, piece or icon renders');
const reopen=await json('art/aurora/aurora-validation.json');
assert(reopen.passed&&reopen.sourceSha256===blendHash);
for(const row of checks.geometry.report.baseline)assert.equal(hash(await readFile(row.file)),row.sha256);
await mkdir('runs/aurora/evidence',{recursive:true});
const wornShards=[];
for(const [index,entry] of (checks.worn.report.shards??[]).entries()){
  const raw=await readFile(entry.file),report=JSON.parse(raw.toString());
  assert.equal(hash(raw),entry.sha256,'Worn shard report changed');
  assert(report.passed,'Worn shard failed');
  for(const asset of catalog.assets)assert(report.assets.some(a=>a.itemId===asset.itemId&&a.sha256===asset.sha256),'Worn shard has stale armor');
  const file=`runs/aurora/evidence/worn-shard-${index+1}.json`;
  await copyFile(entry.file,file);wornShards.push({file,sha256:entry.sha256,source:entry.file});
}
for(const name of ['pieces','worn','world']){
  const report=checks[name].report;
  await copyFile(checks[name].file,`runs/aurora/evidence/${name}-report.json`);
  for(const row of report.captures??report.report??[]){if(!row.file?.endsWith('.png'))continue;const destination=`runs/aurora/evidence/${name}-${path.basename(row.file)}`;await copyFile(row.file,destination);}
}
for(const s of checks.viewer.report.shots)await copyFile(s.file,`runs/aurora/evidence/viewer-${s.name}.png`);
const out={passed:true,productionPromoted:true,round,createdAt:new Date().toISOString(),dependencySha256:catalog.dependencySha256,assets:catalog.assets.map(a=>({itemId:a.itemId,sha256:a.sha256,triangles:a.triangles,bytes:a.bytes})),checks:Object.fromEntries(Object.entries(checks).map(([k,v])=>[k,{file:v.file,sha256:v.sha256}])),wornShards,blend:{file:'art/aurora/aurora-set.blend',sha256:blendHash},renders,limitations:['Authored fit targets the native male skeleton. Other bodies retain the fitted fallback.','Walking and casting captures cover representative poses, not every possible animation.','Blender uses an editable thin-film approximation; the game uses glTF physical iridescence.']};
await writeFile('runs/aurora/acceptance.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({passed:true,round,assets:out.assets.length,renders:renders.length}));
