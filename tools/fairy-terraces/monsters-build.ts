import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
// @ts-expect-error Existing asset compiler server.
import { startServer } from '../animals/serve.mjs';
import { deformedBounds } from '../creature-motion/validate-deformation.js';
import { applyClip, duration, restorePose, storedPose } from '../creature-motion/pose.js';

const output = 'test-results/fairy-terraces-assets/monsters';
await mkdir(`${output}/models`, { recursive: true });
const sources = JSON.parse(await readFile('.asset-cache/fairy-terraces/unity/sources.json', 'utf8'));
const packageMetadata = JSON.parse(await readFile(`${output}/package-metadata.json`, 'utf8'));
const selected = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',');
type MonsterSpec = {id:string;number:string;trial:boolean;model:string;texture:string;animationBase?:string;
  source:{package:string;archive:string;archiveSha256:string;model:string;texture:string};pack:string};
const specs:MonsterSpec[] = [];
for (const trial of [false, true]) for (const number of (trial ? ['11','14','16','21','27','30'] : ['01','02','03','04','05','06','07','08','09'])) {
  const id = `${trial ? 'fairy' : 'fantasy'}_monster_${number}`;
  if (selected && !selected.includes(id)) continue;
  const pack = sources.find((p:any) => trial ? p.package.startsWith('FreeTrial') : !p.package.startsWith('FreeTrial') && p.package.includes(`Monster ${number}`))
    ?? sources.find((p:any) => !trial && p.package.includes(`Model ${number}`));
  if (!pack) throw new Error(`No source package for ${id}`);
  const model = pack.files.find((p:string) => p.endsWith('.fbx') && p.includes(`/Monster${number}${trial ? '_FreeTrial/' : '/'}`));
  const textures = pack.files.filter((p:string) => p.endsWith('.png') && p.includes(`/Monster${number}${trial ? '_FreeTrial/' : '/'}`));
  const texture = textures.find((p:string)=>p.endsWith(`Monster${number}_Color02.png`)) ?? textures.find((p:string)=>p.endsWith(`Monster${number}_02.png`)) ?? textures[0];
  const prefix = '/' + pack.directory;
  specs.push({id, number, trial, model:`${prefix}/${model}`, texture:`${prefix}/${texture}`,
    animationBase:!trial && Number(number)>=7 ? `/${output}/sources/Assets/Stylized3DMonster/Monster${number}/Anim` : undefined,
    source: { package:pack.package, archive:pack.archive, archiveSha256:pack.sha256, model, texture },
    pack:`pixelius-fairy-${trial ? 'trial-vol01' : number}`});
}
const manifestPack = (spec:MonsterSpec) => {
  const metadata=packageMetadata.find((p:any)=>p.archiveSha256===spec.source.archiveSha256);
  if(!metadata)throw Error(`Missing verified package metadata ${spec.id}`);
  return {id:spec.pack,name:metadata.title,author:'PixeliusVita',source:metadata.source,license:'Standard Unity Asset Store EULA',archiveSha256:spec.source.archiveSha256,assetStoreId:metadata.assetStoreId,sourceArchive:spec.source.package};
};
const hoverMotionNote='Monster 07–09 retain the original Unity hover locomotion. Toe movement does not represent planted ground contact, so no implied walk/run stride speed is published. The six source clips and their durations remain unchanged; production movement and native hover cadence need browser proof.';
function applyHoverMetadata(asset:any):void {
  if(!/^fantasy_monster_0[789]$/.test(asset.id))return;
  delete asset.impliedWalkMps;delete asset.impliedRunMps;
  asset.sourceProvenance={...asset.sourceProvenance,locomotion:'hover',motionProof:hoverMotionNote};
}
if(process.argv.includes('--refresh-metadata')) {
  const prior=JSON.parse(await readFile(`${output}/candidates.json`,'utf8'));
  const packs=new Map(prior.packs.map((p:any)=>[p.id,p]));
  for(const spec of specs)packs.set(spec.pack,manifestPack(spec));
  prior.packs=[...packs.values()];
  for(const asset of prior.assets) {
    if(!specs.some(spec=>spec.id===asset.id))continue;
    const bytes=await readFile(path.join(output,prior.files[asset.id]));
    if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error(`Changed candidate bytes ${asset.id}`);
    applyHoverMetadata(asset);
    if(!/^fantasy_monster_0[789]$/.test(asset.id))continue;
    const auditPath=`${output}/${asset.id}.audit.json`,audit=JSON.parse(await readFile(auditPath,'utf8'));
    audit.nonContactToeVelocity??={walk:audit.walk,run:audit.run};
    audit.asset=asset;audit.walk=null;audit.run=null;audit.gaitFootBones=[];audit.motionProof=hoverMotionNote;
    await writeFile(auditPath,JSON.stringify(audit,null,2)+'\n');
  }
  await writeFile(`${output}/candidates.json`,JSON.stringify(prior,null,2)+'\n');
  console.log(JSON.stringify({metadataRefreshed:specs.length}));
  process.exit(0);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), server = await startServer();
const browser = await chromium.launch({headless:true}), page = await browser.newPage();
const errors:string[] = []; page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`${server.url}/tools/fairy-terraces/monsters-convert.html`);
  await page.waitForFunction(()=>typeof (window as any).convertFairyMonster==='function');
  let prior:any = {assets:[],packs:[],files:{}};
  try { prior = JSON.parse(await readFile(`${output}/candidates.json`,'utf8')); } catch {}
  const assets = prior.assets.filter((a:any)=>!specs.some(s=>s.id===a.id));
  const packs = new Map(prior.packs.map((p:any)=>[p.id,p])); const files={...prior.files};
  for (const spec of specs) {
    const start=Date.now();
    const result = await page.evaluate(spec=>(window as any).convertFairyMonster(spec),spec);
    const doc = await io.readBinary(Buffer.from(result.base64,'base64'));
    await doc.transform(dedup(),prune(),resample({tolerance:1e-6}),textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:90}));
    const original=storedPose(doc), sampled:any={}; let triangles=0;
    for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives())triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION')!.getCount())/3;
    for(const accessor of doc.getRoot().listAccessors())if(Array.from(accessor.getArray()??[]).some(v=>!Number.isFinite(v)))throw Error(`${spec.id}: nonfinite accessor`);
    for(const clip of doc.getRoot().listAnimations()) {
      sampled[clip.getName()]=[];
      for(const phase of [0,.25,.5,.75,1]) {restorePose(original);applyClip(clip,duration(clip)*phase);sampled[clip.getName()].push({phase,...deformedBounds(doc)});}
    }
    restorePose(original);
    const bytes=await io.writeBinary(doc), sha256=createHash('sha256').update(bytes).digest('hex');
    const min=result.bounds.min,max=result.bounds.max;
    const asset={id:spec.id,file:`models/fairy/${spec.id}.glb`,pack:spec.pack,category:'character',is:spec.trial?'fairy-creature':'miniboss',
      tags:['creature',spec.trial?'fairy':'miniboss','source-rig'],bytes:bytes.length,sha256,
      size:{x:max[0]-min[0],y:max[1]-min[1],z:max[2]-min[2]},base:{x:min[0],y:min[1],z:min[2]},triangles,
      animations:doc.getRoot().listAnimations().map(a=>a.getName()),materials:doc.getRoot().listMaterials().map(m=>m.getName()),
      ...(result.walk>0?{impliedWalkMps:result.walk}:{}),...(result.run>0?{impliedRunMps:result.run}:{}),
      walkClipSeconds:result.clips.find((c:any)=>c.name==='Walk').seconds,runClipSeconds:result.clips.find((c:any)=>c.name==='Run').seconds,
      attackSeconds:result.clips.find((c:any)=>c.name==='Attack').seconds,contactNormalized:spec.trial?.5:.4,
      sourceProvenance:{...spec.source,modifications:result.modifications},acceptance:{assetAudit:true,labAccepted:false,worldIntegrated:false}};
    applyHoverMetadata(asset);
    await writeFile(`${output}/models/${spec.id}.glb`,bytes);
    await writeFile(`${output}/${spec.id}.audit.json`,JSON.stringify({asset,...result,base64:undefined,sampled},null,2)+'\n');
    files[spec.id]=`models/${spec.id}.glb`; assets.push(asset);
    packs.set(spec.pack,manifestPack(spec));
    await writeFile(`${output}/candidates.json`,JSON.stringify({assets,packs:[...packs.values()],files,browserErrors:errors},null,2)+'\n');
    console.log(JSON.stringify({id:spec.id,bytes:bytes.length,triangles,size:asset.size,seconds:(Date.now()-start)/1000}));
  }
  if(errors.length)throw Error(errors.join('; '));
}finally{await browser.close();await server.close();}
