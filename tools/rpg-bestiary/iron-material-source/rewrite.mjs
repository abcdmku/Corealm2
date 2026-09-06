import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import sharp from 'sharp';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--preset','--out'].includes(args[i])&&args[i+1]&&!options[args[i]],'Usage: rewrite.mjs --preset round1|round2 [--out new-directory]');options[args[i]]=args[i+1];}
const preset=options['--preset']??'round1';assert(['round1','round2'].includes(preset),'Unknown preset');
const isRound2=preset==='round2',normalScale=isRound2?.45:.22,revision=`iron-material-${preset}`;
const sourceRoot=path.resolve('art/rebuild/candidates/finish-bestiary/retained-unhorned15'),round1Root=path.resolve('art/rebuild/candidates/finish-bestiary/iron-material-round1'),out=options['--out']?path.resolve(options['--out']):null,modelFile='models/creature/creature_iron_golem.glb';
const round1Sha='e853b524b0175ac78675fd7d6b1123fa183390c3914705a117bb218538204910';
assert(!isRound2||out,'Round 2 requires --out');
if(out){
 const relative=path.relative(process.cwd(),out);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Output must be inside this worktree');
 assert(!fs.existsSync(out),'Output must be a new directory; existing files are never overwritten');
 const r=path.relative(path.resolve('art/rebuild/candidates'),out);
 if(!r.startsWith('..')&&!path.isAbsolute(r))assert.equal(out,path.resolve('art/rebuild/candidates/finish-bestiary/iron-material-round2'),'Only the round2 candidate directory may be written');
 for(const protectedPath of ['game/src','game/public','tests','.git','.agents','.codex']){const r=path.relative(path.resolve(protectedPath),out);assert(r.startsWith('..')||path.isAbsolute(r),'Protected output directory');}
 for(let parent=path.dirname(out);parent!==path.dirname(parent);parent=path.dirname(parent)){if(fs.existsSync(parent))assert(!fs.lstatSync(parent).isSymbolicLink(),'Output ancestors must not be symlinks');}
}
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=j=>hash(Buffer.from(JSON.stringify(j)));
function parse(b){assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(4),2);const n=b.readUInt32LE(12);assert.equal(b.readUInt32LE(16),0x4e4f534a);const json=JSON.parse(b.subarray(20,20+n));assert.equal(b.readUInt32LE(24+n),0x004e4942);return {json,bin:Buffer.from(b.subarray(28+n,28+n+b.readUInt32LE(20+n)))};}
const originalBytes=fs.readFileSync(path.join(sourceRoot,modelFile)),baseline=parse(originalBytes);assert.equal(hash(originalBytes),'f84d7e0a237d1b4b78891f1b1802004b4acc67d64a93fce1b53d477acdf8ee2a','Baseline changed: review before rewriting');
const doc=structuredClone(baseline.json),sourceCatalog=JSON.parse(fs.readFileSync(path.join(sourceRoot,'catalog.json'))),asset=structuredClone(sourceCatalog.assets.find(a=>a.id==='creature_iron_golem'));assert(asset);
const sourceColor=path.resolve(sourceRoot,path.dirname(modelFile),doc.images[0].uri),sourceNormal=path.resolve(sourceRoot,path.dirname(modelFile),doc.images[1].uri),raw=await sharp(sourceColor).removeAlpha().raw().toBuffer({resolveWithObject:true}),color=Buffer.alloc(raw.info.width*raw.info.height*3),mr=Buffer.alloc(color.length);let oxidePixels=0;const stats={roughness:[Infinity,-Infinity],metalness:[Infinity,-Infinity]};
assert.equal(raw.info.channels,3);assert(raw.info.width<=2048&&raw.info.height<=2048);
const targetMean=[88,92,97],patina2=[104,72,52],oxideThreshold=.739,oxideFade=.16;
const sourceLuminance=i=>(raw.data[i]*.2126+raw.data[i+1]*.7152+raw.data[i+2]*.0722)/255;
const grainAt=l=>Math.max(-1,Math.min(1,(l-.835)*7));
const oxideAt=l=>Math.max(0,Math.min(1,(oxideThreshold-l)/oxideFade));
// Solve the clean base tone to retain the requested mean after grain and rust.
let cleanWeight=0;const offsets=[0,0,0],albedoSum=[0,0,0];
if(isRound2)for(let i=0;i<color.length;i+=3){const l=sourceLuminance(i),mix=oxideAt(l)*.55;cleanWeight+=1-mix;for(let k=0;k<3;k++)offsets[k]+=grainAt(l)*12*(1-mix)+patina2[k]*mix;}
const cleanBase=isRound2?targetMean.map((v,k)=>(v*(color.length/3)-offsets[k])/cleanWeight):[158,164,167];
for(let i=0;i<color.length;i+=3){
 const luminance=(raw.data[i]*.2126+raw.data[i+1]*.7152+raw.data[i+2]*.0722)/255,grain=Math.max(-1,Math.min(1,(luminance-.835)*7)),oxide=isRound2?oxideAt(luminance):Math.max(0,Math.min(1,(.73-luminance)/.16))*.75;
 if(oxide>(isRound2?0:.12))oxidePixels++;
 const steel=isRound2?cleanBase.map(v=>v+grain*12):[158+grain*7,164+grain*7,167+grain*7],patina=isRound2?patina2:[105,89,75],mix=oxide*(isRound2?.55:.45);
 for(let k=0;k<3;k++)color[i+k]=Math.round(steel[k]*(1-mix)+patina[k]*mix);
 for(let k=0;k<3;k++)albedoSum[k]+=color[i+k];
 const roughness=isRound2?(.58+Math.abs(grain)*.035)*(1-oxide)+.85*oxide:.43+Math.abs(grain)*.045+oxide*.29,metalness=isRound2?.88*(1-oxide)+.35*oxide:.97-oxide*.62;
 mr[i]=255;mr[i+1]=Math.round(roughness*255);mr[i+2]=Math.round(metalness*255);
 stats.roughness=[Math.min(stats.roughness[0],roughness),Math.max(stats.roughness[1],roughness)];stats.metalness=[Math.min(stats.metalness[0],metalness),Math.max(stats.metalness[1],metalness)];
}
const colorPng=await sharp(color,{raw:{width:raw.info.width,height:raw.info.height,channels:3}}).png().toBuffer(),mrPng=await sharp(mr,{raw:{width:raw.info.width,height:raw.info.height,channels:3}}).png().toBuffer(),normalPng=fs.readFileSync(sourceNormal),sharedTextures=[];
const normalMetadata=await sharp(normalPng).metadata();assert(normalMetadata.width<=2048&&normalMetadata.height<=2048);
function saveTexture(bytes){const sha256=hash(bytes),file=`textures/imported/${sha256}.png`;if(out){fs.mkdirSync(path.dirname(path.join(out??process.cwd(),file)),{recursive:true});fs.writeFileSync(path.join(out??process.cwd(),file),bytes);}sharedTextures.push({file,bytes:bytes.length,sha256,mimeType:'image/png'});return {file,uri:`../../${file}`};}
const albedo=saveTexture(colorPng),normal=saveTexture(normalPng),metallicRoughness=saveTexture(mrPng);doc.images[0].uri=albedo.uri;assert.equal(doc.images[1].uri,normal.uri,'Normal image remains byte-identical');
const mrImage=doc.images.length;doc.images.push({name:isRound2?'iron_golem_cast_iron_metallic_roughness':'iron_golem_oxidized_steel_metallic_roughness',mimeType:'image/png',uri:metallicRoughness.uri});const mrTexture=doc.textures.length;doc.textures.push({source:mrImage,sampler:doc.textures[0].sampler});
for(const material of doc.materials){const pbr=material.pbrMetallicRoughness,isEye=material.name.endsWith('MI_Eyes'),isArmor=material.name.includes('MI_Knight');if(isEye){pbr.baseColorFactor=[.018,.021,.023,1];pbr.metallicFactor=.72;pbr.roughnessFactor=.57;}else{pbr.baseColorFactor=isArmor?[1,1,1,1]:isRound2?[.20,.22,.24,1]:[.29,.33,.35,1];pbr.roughnessFactor=1;pbr.metallicFactor=1;pbr.metallicRoughnessTexture={index:mrTexture};material.normalTexture.scale=normalScale;}}
// Repack only the JSON chunk. Preserve the entire original BIN payload and all non-material JSON.
const jb=Buffer.from(JSON.stringify(doc)),jp=Buffer.alloc(Math.ceil(jb.length/4)*4,0x20);jb.copy(jp);const head=Buffer.alloc(20),bh=Buffer.alloc(8);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(20+jp.length+8+baseline.bin.length,8);head.writeUInt32LE(jp.length,12);head.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(baseline.bin.length);bh.writeUInt32LE(0x004e4942,4);const candidateBytes=Buffer.concat([head,jp,bh,baseline.bin]);if(!isRound2)assert.equal(hash(candidateBytes),round1Sha,'Round1 must remain byte-identical');
if(out){fs.mkdirSync(path.dirname(path.join(out??process.cwd(),modelFile)),{recursive:true});fs.writeFileSync(path.join(out??process.cwd(),modelFile),candidateBytes);assert.deepEqual(fs.readFileSync(path.join(out??process.cwd(),modelFile)),candidateBytes);}
const candidate=parse(candidateBytes),nonMaterial=j=>Object.fromEntries(Object.entries(j).filter(([k])=>!['materials','images','textures'].includes(k)));assert.deepEqual(nonMaterial(baseline.json),nonMaterial(candidate.json));assert.deepEqual(baseline.bin,candidate.bin);
const preserved={};for(const key of ['accessors','bufferViews','buffers','meshes','nodes','skins','animations','scenes']){assert.deepEqual(baseline.json[key],candidate.json[key]);preserved[key]={unchanged:true,sha256:digest(baseline.json[key]??null)};}
const materialRevision={kind:'material-only',baselineFile:path.relative(process.cwd(),path.join(sourceRoot,modelFile)).replaceAll('\\','/'),baselineSha256:hash(originalBytes),candidateSha256:hash(candidateBytes),sourceColor:{file:path.relative(process.cwd(),sourceColor).replaceAll('\\','/'),sha256:hash(fs.readFileSync(sourceColor))},sourceNormal:{file:path.relative(process.cwd(),sourceNormal).replaceAll('\\','/'),sha256:hash(normalPng),bytesUnchanged:true,materialNormalScale:normalScale},interpretation:'Existing authored mineral-grain luminance is remapped to restrained cool steel with sparse muted brown oxide in existing dark fissures. Metallic/roughness response is newly authored PBR data, not an original Quaternius map. Geometry, source rig, skin, gait and all eight clips are unchanged.',channels:{baseColor:'Low-contrast desaturated steel, source-luminance grain amplitude7/255, restrained brown oxide mix <=0.3375',metallic:'B channel, clean steel0.97, dark oxide reduces metalness',roughness:'G channel, clean steel about0.43, oxide increases roughness',normal:'Original normal PNG unchanged; material strength reduced to0.22'},statistics:{...stats,oxidePixelFraction:oxidePixels/(color.length/3),oxidePixelDefinition:isRound2?'oxide > 0':'oxide > 0.12',meanAlbedo:albedoSum.map(v=>v/(color.length/3))},author:'Corealm project material adaptation; underlying geometry/rig/clips Quaternius CC0',status:'candidate-needs-production-material-review'};
const regression={baselineSha256:hash(originalBytes),candidateSha256:hash(candidateBytes),bin:{bytes:baseline.bin.length,sha256:hash(baseline.bin),byteIdentical:true},nonMaterialJson:{sha256:digest(nonMaterial(baseline.json)),identical:true},preserved,changedTopLevelKeys:Object.keys(doc).filter(k=>JSON.stringify(doc[k])!==JSON.stringify(baseline.json[k])),sourceBaselineNotModified:hash(fs.readFileSync(path.join(sourceRoot,modelFile)))===hash(originalBytes),noGpuUsed:true};assert.deepEqual(regression.changedTopLevelKeys.sort(),['images','materials','textures']);
asset.bytes=candidateBytes.length;asset.sha256=hash(candidateBytes);asset.sourceProvenance.materialRevision=materialRevision;asset.metadata.provenance=asset.sourceProvenance;asset.metadata.materialRevision=materialRevision;asset.metadata.revision=revision;asset.metadata.textureBindings=doc.materials.filter(m=>!m.name.endsWith('MI_Eyes')).map(m=>({materialName:m.name,baseColorPath:path.join(out??process.cwd(),albedo.file),normalPath:path.join(out??process.cwd(),normal.file),metallicRoughnessPath:path.join(out??process.cwd(),metallicRoughness.file),normalScale,flipY:false}));asset.acceptance={...asset.acceptance,labAccepted:false,worldIntegrated:false};
assert.equal(regression.sourceBaselineNotModified,true);
assert.deepEqual(doc.materials.map(m=>m.name),baseline.json.materials.map(m=>m.name));
for(const m of doc.materials){assert(!m.emissiveTexture);assert((m.emissiveFactor??[0,0,0]).every(v=>v===0));assert.equal(m.extensions?.KHR_materials_emissive_strength?.emissiveStrength??0,0);}
if(isRound2){
 assert(materialRevision.statistics.oxidePixelFraction>=.12&&materialRevision.statistics.oxidePixelFraction<=.20);
 materialRevision.statistics.meanAlbedo.forEach((v,k)=>assert(Math.abs(v-targetMean[k])<.1));
 materialRevision.interpretation='Existing authored mineral-grain luminance is remapped to dark neutral grey-blue cast iron with muted rust in existing dark fissures. Metallic/roughness is newly authored PBR data. Geometry, source rig, skin, gait and all eight clips are unchanged.';
 materialRevision.channels={baseColor:'Dark cast iron, source-luminance grain amplitude 12/255; rust [104,72,52], mix <=0.55',metallic:'B channel, clean iron 0.88 fading to oxide 0.35',roughness:'G channel, clean iron 0.58 plus grain, fading to oxide 0.85',normal:'Original normal PNG unchanged; material strength 0.45'};
 materialRevision.parameters={cleanBase,grainAmplitude:12,oxideLuminanceCutoff:oxideThreshold,oxideFade,oxideMaxMix:.55,patina:patina2};
 const previousBytes=fs.readFileSync(path.join(round1Root,modelFile));assert.equal(hash(previousBytes),round1Sha);
 const previous=parse(previousBytes),previousAlbedo=path.resolve(round1Root,path.dirname(modelFile),previous.json.images[0].uri);
 const left=await sharp(previousAlbedo).resize({width:512}).png().toBuffer(),right=await sharp(colorPng).resize({width:512}).png().toBuffer();
 const size=await sharp(left).metadata(),rightSize=await sharp(right).metadata();assert.equal(size.height,rightSize.height);
 await sharp({create:{width:1024,height:size.height,channels:3,background:'#000000'}}).composite([{input:left,left:0,top:0},{input:right,left:512,top:0}]).png().toFile(path.join(out,'albedo-compare.png'));
}
const catalog={packs:sourceCatalog.packs.filter(p=>p.id===asset.pack),sharedTextures,files:{[asset.id]:modelFile},assets:[asset]};if(out){fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify(catalog,null,2));fs.writeFileSync(path.join(out??process.cwd(),'material-regression.json'),JSON.stringify(regression,null,2));fs.writeFileSync(path.join(out??process.cwd(),'material-interpretation.json'),JSON.stringify(materialRevision,null,2));}
assert.equal(hash(fs.readFileSync(path.join(sourceRoot,modelFile))),hash(originalBytes),'Source baseline changed after writing');
if(out)assert.deepEqual(fs.readFileSync(path.join(out,normal.file)),normalPng);
console.log(JSON.stringify({preset,output:out,round1ShaVerified:true,sha256:hash(candidateBytes),binSha256:hash(baseline.bin),changed:regression.changedTopLevelKeys,statistics:materialRevision.statistics}));
