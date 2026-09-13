import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const round=process.argv[2]??'r12';
const imagegenRevision=round==='r12';
const materialRevision=['r11','r12'].includes(round);
const openFaceRevision=['r6','r7','r9','r10','r11','r12'].includes(round);
const intermediateFlare=round==='r10'||materialRevision;
const refinedFlare=round==='r9'||intermediateFlare;
const flareRevision=round==='r7'||refinedFlare;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const root='runs/tier50-70',evidence=`${root}/evidence`;
await mkdir(evidence,{recursive:true});
const sets=[];
for(const [tier,theme] of [[50,'dragonhide'],[70,'starhide']]) {
 const candidate=`art/item-models/candidates/armor-${theme}-reference`;
 const catalog=await json(`${candidate}/catalogue.json`);
 const validation=await json(`art/tier50-70/${theme}-validation.json`);
 const studio=await json(`art/tier50-70/${theme}-studio.json`);
 assert.equal(validation.candidateId,`tier${tier}-${theme}-${round}-review`);
 assert.equal(validation.passed,true);assert.equal(studio.candidateId,validation.candidateId);
 if(imagegenRevision)for(const file of ['art/tier50-70/references/embroidered-fabric-r12.png',
  `art/tier50-70/textures/imagegen-r12/${theme}-embroidered-source.png`,`art/tier50-70/textures/imagegen-r12/${theme}-embroidered-prompt.txt`]) {
  const dependency=catalog.sourceDependencies.find(row=>row.file===file);
  assert(dependency,`Missing source dependency: ${file}`);
  const raw=await readFile(file),bytes=dependency.encoding==='utf8-lf'?Buffer.from(raw.toString().replaceAll('\r\n','\n')):raw;
  assert.equal(dependency.sha256,hash(bytes),`Stale source dependency: ${file}`);
 }
 const assets=[];
 for(const entry of catalog.assets) {
  const source=`${candidate}/${entry.file}`,bytes=await readFile(source);
  assert.equal(hash(bytes),entry.sha256);
  assert(validation.sourceFiles.some(file=>file.file===entry.file.split('/').at(-1)&&file.sha256===entry.sha256));
  assets.push({itemId:entry.itemId,file:source,sha256:entry.sha256,bytes:bytes.length,triangles:entry.triangles,materials:entry.drawCalls});
 }
 const reports={};
 for(const [kind,suffix] of [['worn','motion'],['pieces','pieces']]) {
  const original=`test-results/item-models/tier${tier}-${round}-${suffix}/report.json`;
  const report=await json(original);assert.equal(report.passed,true);
  for(const asset of report.assets)assert(assets.some(entry=>entry.itemId===asset.itemId&&entry.sha256===asset.sha256),`Stale ${original}: ${asset.itemId}`);
  const destination=`${evidence}/tier${tier}-${kind}.json`;
  await copyFile(original,destination);reports[kind]=destination;
 }
 const shots=[];
 for(const name of ['front','side','back','casting','armor-walk-front-50','armor-walk-side-50','armor-walk-rear-50']) {
  const file=`${evidence}/tier${tier}-${name}.png`;
  await copyFile(`test-results/item-models/tier${tier}-${round}-motion/${name}.png`,file);shots.push(file);
 }
 const blend=`art/tier50-70/${theme}-set.blend`,blendBytes=await readFile(blend);
 assert.equal(hash(blendBytes),studio.sourceSha256);
 assert.equal(hash(await readFile(`art/tier50-70/${theme}-studio.png`)),studio.renderSha256);
 for(const part of ['hood','robe','leggings','boots','wraps']) {
  const file=`art/tier50-70/renders/${theme}_${part}`;
  const report=await json(`${file}.json`);
  assert.equal(report.candidateId,validation.candidateId);
  assert.equal(hash(await readFile(`${file}.png`)),report.renderSha256);
  assert.equal(report.sourceSha256,studio.sourceSha256);
 }
 const flareViewer=flareRevision?`${evidence}/tier${tier}-robe-flare.png`:undefined;
 if(flareViewer)await copyFile(`test-results/tier50-70/${round}-viewer-${theme}-robe.png`,flareViewer);
 const materialShots=[];
 if(materialRevision)for(const view of ['front','orbit']) {
  const original=`test-results/tier50-70/${round}-material-${theme}-${view}.png`,file=`${evidence}/tier${tier}-material-${view}.png`;
  const bytes=await readFile(original);await copyFile(original,file);
  materialShots.push({view,file,source:original,sha256:hash(bytes)});
 }
 sets.push({tier,theme,candidate:validation.candidateId,assets,dependencySha256:catalog.dependencySha256,
  sourceDependencies:catalog.sourceDependencies.length,blender:{file:blend,bytes:blendBytes.length,sha256:hash(blendBytes),validation:`art/tier50-70/${theme}-validation.json`,sourceFiles:validation.sourceFiles},
  studio:`art/tier50-70/${theme}-studio.png`,reports,shots,...(materialRevision?{materialShots}:{}),...(flareViewer?{flareViewer,presentationNote:'Standalone robe comparison; gameplay evidence is listed separately in reports and shots.'}:{})});
}
const materials=materialRevision?await json(`${evidence}/materials.json`):undefined;
const materialViewer=materialRevision?await json(`${evidence}/material-viewer.json`):undefined;
if(materials){
 assert.equal(materials.passed,true);assert.equal(materialViewer.passed,true);assert.equal(materials.assets.length,10);
 assert.equal(materials.round,round);assert.equal(materialViewer.round,round);
 for(const asset of materials.assets)assert(sets.some(set=>set.assets.some(a=>a.itemId===asset.itemId&&a.sha256===asset.sha256)));
 for(const set of sets){const validation=await json(set.blender.validation);assert(validation.iridescencePreservation.sourceParametersMatch);assert(validation.iridescencePreservation.editableNodesConnected);}
}
if(imagegenRevision){
 assert.equal(materialViewer.sets.length,2);
 assert.deepEqual(materialViewer.sets.map(row=>row.theme).sort(),sets.map(set=>set.theme).sort());
 for(const set of sets){
  const viewer=materialViewer.sets.find(row=>row.theme===set.theme);
  assert.equal(viewer.assets.length,5,`${set.theme}: missing captured GLB hashes`);
  assert.deepEqual(viewer.assets.map(asset=>({itemId:asset.itemId,sha256:asset.sha256})).sort((a,b)=>a.itemId.localeCompare(b.itemId)),
   set.assets.map(asset=>({itemId:asset.itemId,sha256:asset.sha256})).sort((a,b)=>a.itemId.localeCompare(b.itemId)),`${set.theme}: stale viewer GLBs`);
  for(const shot of set.materialShots){
   const matches=viewer.screenshots.filter(row=>row.view===shot.view);
   assert.equal(matches.length,1,`${set.theme}: missing or duplicate ${shot.view} screenshot record`);
   assert.equal(matches[0].file,shot.source);assert.equal(matches[0].sha256,shot.sha256,`Stale viewer screenshot: ${shot.source}`);
  }
 }
 assert.equal(materials.clothProvenance.length,2);
 assert.equal(materials.clothReference.file,'art/tier50-70/references/embroidered-fabric-r12.png');
 assert.equal(hash(await readFile(materials.clothReference.file)),materials.clothReference.sha256);
 assert.deepEqual(materials.clothProvenance.map(row=>row.theme).sort(),sets.map(set=>set.theme).sort());
 for(const row of materials.clothProvenance){
  assert.equal(hash(await readFile(row.file)),row.sha256);
  assert.deepEqual((await json(row.file)).clothSource,row.clothSource);
  assert.equal(hash(await readFile(row.clothSource.sourceImage)),row.clothSource.sourceSha256);
  assert.equal(hash(await readFile(row.clothSource.promptFile)),row.clothSource.promptSha256);
  assert.equal(row.clothSource.sourceImage,`art/tier50-70/textures/imagegen-r12/${row.theme}-embroidered-source.png`);
  assert.equal(row.clothSource.promptFile,`art/tier50-70/textures/imagegen-r12/${row.theme}-embroidered-prompt.txt`);
  assert.equal(row.clothSource.colorSourceImage,row.clothSource.sourceImage);
  assert.equal(row.clothSource.colorPromptFile,row.clothSource.promptFile);
  assert.equal(hash(await readFile(row.clothSource.colorSourceImage)),row.clothSource.colorSourceSha256);
  assert.equal(hash(await readFile(row.clothSource.colorPromptFile)),row.clothSource.colorPromptSha256);
  assert.equal(row.clothSource.dyeMeanSRGB,row.theme==='dragonhide'?'#571827':'#25355d');
  assert.equal(row.clothSource.referenceImage,materials.clothReference.file);
  assert.equal(row.clothSource.referenceSha256,materials.clothReference.sha256);
  assert.equal(row.clothSource.editTargetImage,`art/tier50-70/textures/imagegen-r12/${row.theme}-botanical-source-v1.png`);
  assert.equal(hash(await readFile(row.clothSource.editTargetImage)),row.clothSource.editTargetSha256);
  assert.equal(row.clothSource.imagegenIntent,'edit: sparse celestial embroidery replaces botanical pattern');
  assert.equal(row.threadColor.colorAndValueVariation,true);
  assert.equal(row.threadColor.width,2048);assert.equal(row.threadColor.height,2048);
  assert(row.threadColor.valueStdSRGB>2&&row.threadColor.chromaticResidualRms>1);
  assert.equal(row.embroidery.matteBaseAndMetallicEmbroidery,true);
  if(row.patternDensity.available){
   assert.equal(row.patternDensity.coverageReduced,true);
   assert(row.patternDensity.current.markedFraction<row.patternDensity.previous.markedFraction);
   assert.equal(row.patternDensity.current.file,row.clothSource.sourceImage);
   assert.equal(row.patternDensity.current.sha256,row.clothSource.sourceSha256);
   assert.equal(hash(await readFile(row.patternDensity.previous.file)),row.patternDensity.previous.sha256);
  }
  for(const map of row.maps)assert.equal(hash(await readFile(`art/tier50-70/textures/${row.theme}/${map.file}`)),map.sha256);
  for(const asset of materials.assets.filter(asset=>asset.itemId.startsWith(`${row.theme}_`))){
   assert.deepEqual(asset.cloth.baseColor,[1,1,1,1]);
   assert.equal(asset.cloth.metalness,1);assert.equal(asset.cloth.roughness,1);assert.equal(asset.cloth.ior,1.3);
   assert.equal(asset.cloth.threadColor.pixelSha256,row.threadColor.pixelSha256);
   assert.equal(asset.cloth.embroidery.packedChannelsSha256,row.embroidery.packedChannelsSha256);
   assert.equal(asset.r11Baseline.nonClothTextureBytesUnchanged,true);
   assert.equal(asset.r11Baseline.nonClothMaterialsUnchangedExceptDeclaredPigment,true);
   if(row.theme==='starhide'){
    assert.deepEqual(asset.r11Baseline.scalePigmentRevision.srgb,['#2d425b','#304765','#3a4564','#424563','#48425f','#294a58']);
    assert.equal(asset.r11Baseline.scalePigmentRevision.onlyBaseColorFactorChanged,true);
   }
  }
 }
}
const widthReview=refinedFlare?await json(`${evidence}/skirt-width.json`):undefined;
if(widthReview){
 assert.equal(widthReview.round,round);assert.equal(widthReview.passed,true);
 for(const row of widthReview.sets){
  if(intermediateFlare){
   assert(Math.abs(row.fractionTowardReference-.5)<.00001);
   assert(row.currentWidth>row.previousWidth&&row.currentWidth<row.referenceWidth);
   for(const section of row.sections)assert(section.current>section.r9&&section.current<section.reference);
  }else{assert(Math.abs(row.hemToWaistRatio-2)<.00001);assert(row.currentWidth<row.previousWidth);}
  assert(sets.find(set=>set.theme===row.theme).assets.some(asset=>asset.itemId===`${row.theme}_robe`&&asset.sha256===row.sha256));
 }
}
const report={date:new Date().toISOString(),round,status:'review-candidate-delivered',
 exactReferenceAccepted:false,productionPromoted:false,
 workingScope:'Crafted Dragonhide T50 and Starhide T70, five pieces each. Boss variants excluded.',
 initialTimebox:{start:'2026-09-12T07:39:00Z',deadline:'2026-09-12T08:39:00Z'},
 ...(openFaceRevision?{requestedRevisions:['Open faces: remove veil, attached throat leaves, and opaque eye lining; darken the interior crown seam.',intermediateFlare?'Keep the accepted R9 tip flare and add gradual widening below the waist, between R9 and the supplied reference.':refinedFlare?'Reduce the prior roughly 3x Dragonhide and 2.5x Starhide flares to 2x the fitted waist. Apply the rapid outward curve only near each pointed hem.':flareRevision?'Reshape the entire lower half into the reference flare: sustained widening below the belt, diagonal scaled panels, and long pointed ends. Dragonhide has the stronger flare.':'Subtle outward lower robe flare below the hips; waist fit and detail placement retained.']}:{}),
 ...(flareRevision?{flareReference:'art/tier50-70/references/dragonhide-flare-r7.png',flareReferenceSha256:hash(await readFile('art/tier50-70/references/dragonhide-flare-r7.png')),lowerHalfSilhouetteAccepted:true,
  silhouetteReview:refinedFlare?{measurement:`${evidence}/skirt-width.json`,method:widthReview.method,sets:widthReview.sets,visualReview:intermediateFlare?'Gradual widening between the narrow R9 skirt and the reference-matched R7 skirt, retaining the accepted short outward tip turn.':'Reduced overall width from R7 with a short accelerating outward turn at the pointed ends. The target is a hem-to-waist ratio, not multiplication of the old hem width.'}:{method:'Approximate screenshot widths normalized to the fitted waist, reviewed against the supplied images.',dragonhide:{mid:2.37,lower:3.08,referenceMid:2.3,referenceLower:3.0},starhide:{mid:2.11,lower:2.51,referenceMid:2.1,referenceLower:2.45},detailLimit:'Fine engraving, material response, and some trim intersections remain approximate.'}}:{}),
 strengths:['Slim fitted silhouettes and distinct tier construction','Physical overlapping scutes with curved-surface clearance','Woven cloth and pebbled leather PBR maps, beveled metal borders','Native male skeleton, full finger weights and editable packed Blender assemblies','Waist coverage union fixed and regression tested'],
 ...(materialRevision?{requestedRevisions:imagegenRevision?['Use sparse celestial stars, arcane diamond marks and short constellation details over mostly open fabric, replacing the earlier botanical pattern.','Keep deep maroon T50 and navy T70 base fabric with varied yarn colors and fine reflective gold stitches.','Darken T70 scale pigments to the requested six-color palette while retaining T50 scale colors and all scale geometry, textures and physical finish parameters.','Retain bounded front-tail drape, upright cloth mapping, accepted silhouette widths, non-robe geometry and open faces.']:['Muted wine fabric and restrained smoky blue-violet scale pigment for T50.','Matte blue fabric for T70. Both fabrics include visible ripples, irregular creases, twill yarns and dye variation.','Raised overlapping scale lips and curved faces with stronger fine grain, clearcoat and view-dependent blue/violet/cyan iridescence on both sets.','Retain accepted R10 cloth silhouette, flare and open faces.'],materialReview:{geometryAndMaterialChecks:`${evidence}/materials.json`,browserChecks:`${evidence}/material-viewer.json`,blenderFinish:'Editable EEVEE angle-dependent approximation, sampled from original GLB film parameters. GLB uses KHR_materials_iridescence.',normalViewerShadows:true,...(imagegenRevision?{clothReference:materials.clothReference,clothProvenance:materials.clothProvenance,clothRelief:'Bounded authored front-tail drape plus imagegen celestial embroidery RGB sources baked into aligned color, normal and packed roughness/metallic maps. Rough nonmetallic base cloth and sparse metallic gold marks. Texture heights are inferred, not a measured textile scan. No cloth simulation is added.'}:{})}}:{}),
 remaining:['Not an exact reconstruction of the icon rendering: folds, fine engraving and the distribution of scale reflections remain approximate.','Long robe panels still overlap raised knees/boots and bend stiffly in walking samples.','Small scale fragments still cross the upper outer cloth flaps on standalone leggings, and some fine trim intersects adjacent scale edges.','Unseen back construction is inferred from the visible design.','No female-body fit, cloth simulation, animation retargeting or crowd performance acceptance was performed.'],
 validation:{focusedTests:openFaceRevision?8:58,focusedFiles:openFaceRevision?2:7,typecheck:'passed',productionBuild:'passed',
  individualLabViews:30,walkingPhaseViews:18,castingFixtures:2,normalPlayerCamera:true,
  fullWorld:'Not run. These candidates were not promoted because exact-reference and motion acceptance did not pass.',
  blender:'Both canonical scenes reopened, packed textures decoded, source hashes and asset manifests verified. Studio posing leaves saved files unchanged.'},
 critics:['Fresh R1 reference and motion critic','Fresh R2 critic','Fresh R3 final critic with R4/R5 repair reviews','Independent Blender presentation and packed-asset reviewer',...(openFaceRevision?['Fresh R6 open-face and hem-flare visual critic']:[]),...(flareRevision?['Fresh R7 silhouette critic, comparing waist, mid-skirt, lower sweep, and pointed ends with the supplied reference']:[]),...(refinedFlare?['Fresh R9 read-only critic: reduced overall width, 2x fitted-waist ratio, and pointed-end flare']:[]),...(intermediateFlare?['Fresh R10 read-only critic: gradual waist-down widening between R9 and the reference, with accepted tips retained']:[]),...(materialRevision?['R11 material export and Blender support audit','Fresh R11 material visual critic with final fabric and scale-relief review']:[]),...(imagegenRevision?['Fresh R12 read-only critic passed final front, orbit and zoom views: darker T70 scales, sparse celestial embroidery, rich fabric and upright unstretched motifs. Strong crushed-velvet mottling remains a nonblocking observation; microscopic stitch quality was not established.']:[])],sets};
await writeFile(`${root}/acceptance.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({verified:true,round,sets:sets.length,assets:sets.flatMap(set=>set.assets).length,evidence}));
