import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const fileHash=async file=>hash(await readFile(file));
const evidence='runs/tier50-70/evidence';
await mkdir(evidence,{recursive:true});
const revision=await json('runs/tier50-70/evidence/revision-r14.json');
assert.equal(revision.passed,true);assert.equal(revision.round,'r14');
const contacts=await json(`${evidence}/contacts-r14.json`);
assert.equal(contacts.skinSourceSha256,await fileHash('tools/item-models/tier50-70/skin.ts'));
for(const theme of ['dragonhide','starhide']){
 const measured=contacts.results.find(row=>row.theme===theme&&row.label==='candidate');
 assert(measured&&!measured.reweighted);
 assert.equal(measured.summary.intersectingTrianglePairs,0);
 assert.equal(measured.rows.filter(row=>row.phase!==null).length,20);
 for(const source of measured.files)assert.equal(await fileHash(source.path),source.sha256);
}
const viewer=await json(`${evidence}/material-viewer.json`);
assert.equal(viewer.passed,true);assert.equal(viewer.round,'r14');
const manifest=await json('game/public/assets/manifest.json');
const registry=await json('art/item-models/registry.json');
const sets=[];
for(const [tier,theme,design,color] of [[50,'dragonhide','starhide','midnight navy and silver'],[70,'starhide','dragonhide','deep maroon and antique gold']]){
 const directory=`art/item-models/candidates/armor-${theme}-reference`;
 const catalog=await json(`${directory}/catalogue.json`);
 for(const dependency of catalog.sourceDependencies){
  const raw=await readFile(dependency.file),bytes=dependency.encoding==='utf8-lf'?Buffer.from(raw.toString().replaceAll('\r\n','\n')):raw;
  assert.equal(hash(bytes),dependency.sha256,`Changed authoring source: ${dependency.file}`);
 }
 const assets=[];
 for(const entry of catalog.assets){
  const candidateFile=`${directory}/${entry.file}`,productionFile=`game/public/assets/${entry.file}`;
  assert.equal(await fileHash(candidateFile),entry.sha256);
  assert.equal(await fileHash(productionFile),entry.sha256);
  const installed=manifest.assets.find(a=>a.id===entry.id);
  assert(installed?.tags.includes('tier50-70-tailored-approved'));
  assert.equal(installed.itemModel.itemId,entry.itemId);
  assert.equal(installed.bytes,entry.bytes);
  assert.equal(registry.items[entry.itemId].sha256,entry.sha256);
  assert.equal(registry.items[entry.itemId].promoted,true);
  assert(revision.assets.some(a=>a.itemId===entry.itemId&&a.sha256===entry.sha256));
  assets.push({itemId:entry.itemId,file:candidateFile,productionFile,sha256:entry.sha256,bytes:entry.bytes,triangles:entry.triangles});
 }
 const reports={};
 for(const [kind,suffix] of [['worn','chest'],['pieces','pieces'],['world','world']]){
  const source=kind==='world'?'test-results/item-models/tier50-70-r14-world/report.json':`test-results/item-models/tier${tier}-r14-${suffix}/report.json`,report=await json(source);
  assert.equal(report.passed,true,source);
  for(const asset of assets)assert(report.assets.some(a=>a.itemId===asset.itemId&&a.sha256===asset.sha256),`Stale ${kind} ${asset.itemId}`);
  if(kind==='world'){
   assert.equal(report.candidateOverride,false);assert.equal(report.route,'/index.html');
   for(const asset of assets)assert.equal(report.servedAssetHashes[`/assets/models/items/${asset.itemId}.glb`],asset.sha256);
  }
  const destination=`${evidence}/tier${tier}-${kind}.json`;await copyFile(source,destination);reports[kind]=destination;
 }
 const screenshots=[];
 for(const [suffix,names] of [['chest',['front','side','back','casting','armor-walk-front-50','armor-walk-side-50','armor-walk-rear-50']],['world',[`${theme}-front`,`${theme}-back`,`${theme}-walking`]]]){
  for(const name of names){
   const file=`${evidence}/tier${tier}-${suffix==='world'?'world-':''}${name}.png`;
   const sourceDirectory=suffix==='world'?'test-results/item-models/tier50-70-r14-world':`test-results/item-models/tier${tier}-r14-${suffix}`;
   await copyFile(`${sourceDirectory}/${name}.png`,file);
   screenshots.push({file,sha256:await fileHash(file)});
  }
 }
 const browser=viewer.sets.find(s=>s.theme===theme);
 assert.equal(browser.assets.length,5);
 for(const asset of assets)assert(browser.assets.some(a=>a.itemId===asset.itemId&&a.sha256===asset.sha256));
 for(const shot of browser.screenshots){
  assert.equal(await fileHash(shot.file),shot.sha256);
  const file=`${evidence}/tier${tier}-material-${shot.view}.png`;await copyFile(shot.file,file);
  if(shot.view==='front')await copyFile(shot.file,`${evidence}/tier${tier}-robe-flare.png`);
  screenshots.push({file,sha256:shot.sha256});
 }
 const blend=`art/tier50-70/${theme}-set.blend`,blendHash=await fileHash(blend);
 const validationFile=`art/tier50-70/${theme}-validation.json`,validation=await json(validationFile);
 assert.equal(validation.candidateId,`tier${tier}-${theme}-r14-review`);assert.equal(validation.passed,true);
 assert.equal(validation.sourceSha256,blendHash);assert.equal(validation.bones,65);assert.equal(validation.rigs,1);
 assert.equal(validation.allPackedImagesDecoded,true);assert.equal(validation.iridescencePreservation.sourceParametersMatch,true);
 for(const asset of assets)assert(validation.sourceFiles.some(s=>s.file===`${asset.itemId}.glb`&&s.sha256===asset.sha256));
 const renders=[];
 for(const part of ['studio','hood','robe','leggings','boots','wraps']){
  const stem=part==='studio'?`art/tier50-70/${theme}-studio`:`art/tier50-70/renders/${theme}_${part}`;
  const report=await json(`${stem}.json`);
  assert.equal(report.candidateId,validation.candidateId);assert.equal(report.sourceSha256,blendHash);
  assert.equal(report.renderSha256,await fileHash(`${stem}.png`));assert.equal(report.sourceBlendHashUnchanged,true);
  renders.push({file:`${stem}.png`,sha256:report.renderSha256});
 }
 const provenanceFile=`art/tier50-70/textures/${design}/provenance.json`,provenance=await json(provenanceFile);
 for(const [fileKey,hashKey]of [['sourceImage','sourceSha256'],['promptFile','promptSha256'],['editTargetImage','editTargetSha256']])
  assert.equal(await fileHash(provenance.clothSource[fileKey]),provenance.clothSource[hashKey]);
 assert(provenance.clothSource.sourceImage.includes('/imagegen-r13/'));
 sets.push({tier,theme,designTheme:design,color,assets,reports,screenshots,renders,
  blender:{file:blend,sha256:blendHash,validation:validationFile,packedImages:validation.packedImages},clothProvenance:provenanceFile,
  sourceDependencies:catalog.sourceDependencies.length,dependencySha256:catalog.dependencySha256});
}
const report={round:'r14',date:new Date().toISOString(),status:'native-male-game-assets-delivered',productionPromoted:true,exactReferenceAccepted:false,
 requestedRevisions:['Complete blue/silver design assigned to T50; complete red/gold design assigned to T70. Equipment IDs and progression retained.',
  'Calmer fabric noise with moderately more celestial embroidery retained from R13.','Normal native-male gameplay loads the authored GLBs.','Refined overlapping hip scales and robe bindings; front cloth follows its nearest thigh for knee clearance.','Covered pectoral skin no longer breaks through the upper robe: fitted fabric underlay plus anatomy-aware clavicle coverage.'],
 appearanceReview:{passed:true,critic:'Fresh read-only R14 critic accepted the sampled hip and knee refinements and reviewed both final chest-corrected sets in walking, standing and casting views. Root inspected the final lab, world and Blender views.',
  report:`${evidence}/revision-r14.json`,viewer:`${evidence}/material-viewer.json`,
  brightness:'Corrected normal-game asset selection. No global exposure or lighting changes. Daylight and studio highlights remain naturally different.'},
 validation:{focusedTests:93,focusedFiles:5,typecheck:'passed',productionBuild:'passed',individualLabViews:30,walkingPhaseViews:18,castingFixtures:2,
  kneeFrontClothContactReport:`${evidence}/contacts-r14.json`,sampledJogPhasesPerSet:20,
  normalWorldKits:2,normalPlayerCamera:true,canonicalBlenderScenes:2,renderedPreviews:12},
 remaining:['Skeletal cloth remains an approximation; extreme poses are not covered by a cloth simulation.',

  'Authored sets fit the native male body; female bodies retain their existing fitted fallback.',
  'Blender EEVEE approximates the GLB thin-film response. Neither exact icon reconstruction nor crowd-performance acceptance is claimed.'],sets};
await writeFile('runs/tier50-70/acceptance.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({verified:true,round:'r14',sets:sets.length,assets:sets.flatMap(s=>s.assets).length,productionPromoted:true}));
