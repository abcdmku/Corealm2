/** Staged-only creature asset compiler. Production promotion and lab acceptance belong to root. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, resample } from '@gltf-transform/functions';
import { deformedBounds } from './creature-motion/validate-deformation.js';
import { applyClip, duration, restorePose, storedPose } from './creature-motion/pose.js';
import { Quaternion } from 'three';
import { expansionPacks, packForSpecies } from './creature-expansion/packs.js';
// @ts-expect-error plain ESM server used by the existing asset compiler.
import { startServer } from './animals/serve.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'test-results/creature-expansion');
const required=['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'];
const args=process.argv.slice(2);
const value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type BuildMeta={is?:string;tags?:string[];provenance?:unknown;attackSeconds?:number;contactNormalized?:number;impliedWalkMps?:number;impliedRunMps?:number;walkClipSeconds?:number;runClipSeconds?:number;animationResampleTolerance?:number;[key:string]:unknown};
type BuildResult={base64:string;meta:BuildMeta;clipMetadata:{name:string;seconds:number;tracks:number}[]};

function measureMotion(doc:Document,meta:BuildMeta){
  const pose=storedPose(doc),clips=doc.getRoot().listAnimations();
  const skeleton=new Set(doc.getRoot().listSkins().flatMap(s=>s.listJoints()));
  const explicit=Array.isArray(meta.gaitFootBones)?new Set(meta.gaitFootBones as string[]):undefined;
  let feet=[...skeleton].filter(n=>explicit?.has(n.getName())??/foot|ankle|toe|tarsus/i.test(n.getName()));
  // Keep the distal joint when an importer exposes foot/toe and toe-end names together.
  if(!explicit)feet=feet.filter(n=>{let descendant=false;n.traverse(c=>{if(c!==n&&feet.includes(c))descendant=true;});return !descendant;});
  const roots=[...skeleton].filter(n=>!skeleton.has(n.getParentNode()!));
  const gait:Record<string,unknown>={},loops:Record<string,unknown>={};
  for(const name of ['Idle','Walk','Run']){
    const clip=clips.find(c=>c.getName()===name)!;const seconds=duration(clip);
    let maxTranslationGap=0,maxRotationGap=0,maxScaleGap=0;
    for(const c of clip.listChannels()){
      const output=c.getSampler()!.getOutput()!,array=output.getArray()!,width=output.getElementSize();
      const first=Array.from(array.slice(0,width),Number),last=Array.from(array.slice(-width),Number);
      if(c.getTargetPath()==='rotation')maxRotationGap=Math.max(maxRotationGap,new Quaternion().fromArray(first).angleTo(new Quaternion().fromArray(last)));
      else if(c.getTargetPath()==='translation')maxTranslationGap=Math.max(maxTranslationGap,Math.hypot(...first.map((v,i)=>v-last[i]!)));
      else if(c.getTargetPath()==='scale')maxScaleGap=Math.max(maxScaleGap,Math.hypot(...first.map((v,i)=>v-last[i]!)));
    }
    loops[name]={seconds,maxTranslationGap,maxRotationGapRadians:maxRotationGap,maxScaleGap};
    if(name==='Idle')continue;
    const count=96,dt=seconds/count;
    const samples=new Map([...feet,...roots].map(n=>[n,[] as number[][]]));
    for(let i=0;i<=count;i++){
      restorePose(pose);applyClip(clip,i*dt);
      for(const [n,rows] of samples){const matrix=n.getWorldMatrix();rows.push([matrix[12]!,matrix[13]!,matrix[14]!]);}
    }
    const stanceSpeeds:number[]=[],footRows=[];
    for(const foot of feet){
      const rows=samples.get(foot)!,ys=rows.map(v=>v[1]!),zs=rows.map(v=>v[2]!);const low=Math.min(...ys),high=Math.max(...ys),threshold=low+Math.max(.008,(high-low)*.12);
      const speeds:number[]=[];
      for(let i=1;i<rows.length;i++)if(rows[i]![1]!<=threshold&&rows[i-1]![1]!<=threshold){
        const speed=-(rows[i]![2]!-rows[i-1]![2]!)/dt;
        if(speed>.02)speeds.push(speed);
      }
      stanceSpeeds.push(...speeds);speeds.sort((a,b)=>a-b);
      footRows.push({bone:foot.getName(),minY:low,maxY:high,strideZ:Math.max(...zs)-Math.min(...zs),contactSamples:speeds.length,stanceMedianMps:speeds.length?speeds[Math.floor(speeds.length/2)]:null});
    }
    stanceSpeeds.sort((a,b)=>a-b);
    gait[name.toLowerCase()]={seconds,sampledFootBones:feet.length,stanceSamples:stanceSpeeds.length,measuredStanceMps:stanceSpeeds.length?stanceSpeeds[Math.floor(stanceSpeeds.length/2)]:null,feet:footRows,rootHorizontalTravel:roots.map(n=>{const rows=samples.get(n)!;return {bone:n.getName(),x:Math.max(...rows.map(v=>v[0]!))-Math.min(...rows.map(v=>v[0]!)),z:Math.max(...rows.map(v=>v[2]!))-Math.min(...rows.map(v=>v[2]!))};})};
  }
  restorePose(pose);
  return {gait,loops,basis:'96 samples per exported locomotion cycle; distal joint backward speed during the lowest 12 percent of vertical travel. Actual moving production lab review remains required.'};
}

function audit(doc:Document){
  const failures:string[]=[],notes:string[]=[];
  let vertices=0,triangles=0,skinnedVertices=0,invalidWeights=0,invalidJoints=0,invalidNormals=0,missingUV=0,zeroArea=0,invalidDrawIndices=0;
  for(const accessor of doc.getRoot().listAccessors()){
    const array=accessor.getArray();if(array&&Array.from(array).some(v=>!Number.isFinite(v))) failures.push(`Nonfinite accessor ${accessor.getName()}`);
  }
  for(const node of doc.getRoot().listNodes()){
    const skin=node.getSkin(),joints=skin?.listJoints();
    if(skin && (!joints?.length || !skin.getInverseBindMatrices())) failures.push(`Incomplete skin ${node.getName()}`);
    for(const primitive of node.getMesh()?.listPrimitives()??[]){
      const p=primitive.getAttribute('POSITION'),n=primitive.getAttribute('NORMAL'),uv=primitive.getAttribute('TEXCOORD_0'),w=primitive.getAttribute('WEIGHTS_0'),j=primitive.getAttribute('JOINTS_0');
      if(!p){failures.push(`Missing positions ${node.getName()}`);continue;}
      if(primitive.getMode()!==4)failures.push(`Non-triangle primitive ${node.getName()}`);
      for(const semantic of primitive.listSemantics())if(primitive.getAttribute(semantic)!.getCount()!==p.getCount())failures.push(`Attribute count mismatch ${node.getName()}:${semantic}`);
      vertices+=p.getCount(); const indices=primitive.getIndices();triangles+=(indices?.getCount()??p.getCount())/3;
      if(!n)failures.push(`Missing normals ${node.getName()}`);
      if(!uv)missingUV+=p.getCount();
      const normal:number[]=[],weights:number[]=[],joint:number[]=[],a:number[]=[],b:number[]=[],c:number[]=[];
      for(let i=0;i<p.getCount();i++){
        if(n){n.getElement(i,normal);const len=Math.hypot(...normal);if(len<.5||len>1.5)invalidNormals++;}
        if(skin){
          skinnedVertices++;
          if(!w||!j){invalidWeights++;continue;}
          w.getElement(i,weights);j.getElement(i,joint);
          if(Math.abs(weights.reduce((s,v)=>s+v,0)-1)>.002||weights.some(v=>v<0))invalidWeights++;
          if(joint.some((v,k)=>weights[k]!>0 && (!Number.isInteger(v)||v<0||v>=joints!.length)))invalidJoints++;
        }
      }
      const ia=indices?.getArray();const count=indices?.getCount()??p.getCount();
      if(count%3!==0)failures.push(`Incomplete triangle ${node.getName()}`);
      if(ia)for(const ix of ia)if(!Number.isInteger(ix)||ix<0||ix>=p.getCount())invalidDrawIndices++;
      if(invalidDrawIndices)continue;
      for(let i=0;i<count;i+=3){
        p.getElement(Number(ia?.[i]??i),a);p.getElement(Number(ia?.[i+1]??i+1),b);p.getElement(Number(ia?.[i+2]??i+2),c);
        const ux=b[0]!-a[0]!,uy=b[1]!-a[1]!,uz=b[2]!-a[2]!,vx=c[0]!-a[0]!,vy=c[1]!-a[1]!,vz=c[2]!-a[2]!;
        if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<1e-12)zeroArea++;
      }
    }
  }
  if(invalidWeights)failures.push(`${invalidWeights} invalid vertex weights`);
  if(invalidJoints)failures.push(`${invalidJoints} invalid skin joint indices`);
  if(invalidDrawIndices)failures.push(`${invalidDrawIndices} invalid triangle vertex indices`);
  if(invalidNormals)failures.push(`${invalidNormals} invalid normals`);
  if(!skinnedVertices)failures.push('No skinned geometry');
  if(missingUV)failures.push(`${missingUV} vertices lack UVs`);
  if(zeroArea)notes.push(`${zeroArea} degenerate cap/seam triangles`);
  const pose=storedPose(doc),clips=doc.getRoot().listAnimations();
  const animatedBounds:Record<string,unknown>={};
  for(const name of required){
    const clip=clips.find(c=>c.getName()===name);
    if(!clip || duration(clip)<=0){failures.push(`Missing ${name}`);continue;}
    const seconds=duration(clip),samples=[];
    for(const phase of [0,.25,.5,.75,1]){
      restorePose(pose);applyClip(clip,seconds*phase);samples.push({phase,...deformedBounds(doc)});
    }
    animatedBounds[name]=samples;
  }
  restorePose(pose);
  return {passed:failures.length===0,vertices,triangles,skinnedVertices,invalidWeights,invalidJoints,invalidDrawIndices,invalidNormals,missingUV,zeroArea,failures,notes,animatedBounds};
}

async function main(){
  await mkdir(path.join(out,'models'),{recursive:true});
  const packs=await expansionPacks(root);
  await writeFile(path.join(out,'packs.json'),JSON.stringify(packs,null,2)+'\n');
  if(args.includes('--refresh-metadata')){
    const manifest=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8')) as {assets:Record<string,unknown>[];packs?:unknown;[key:string]:unknown};
    manifest.packs=packs;
    for(const asset of manifest.assets){
      const id=String(asset.id).replace(/^creature_/,'');asset.pack=packForSpecies(id);
      const file=path.join(out,`${id}.json`);const metadata=JSON.parse(await readFile(file,'utf8'));metadata.pack=asset.pack;
      await writeFile(file,JSON.stringify(metadata,null,2)+'\n');
    }
    await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    console.log(JSON.stringify({metadataRefreshed:manifest.assets.length,packs:packs.length,output:out}));return;
  }
  const server=await startServer();
  if(args.includes('--serve')){
    console.log(JSON.stringify({url:server.url,compiler:`${server.url}/tools/creature-expansion/convert.html`}));
    await new Promise(()=>{});return;
  }
  let browser:Browser|undefined;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage(); const errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${server.url}/tools/creature-expansion/convert.html`);
    await page.waitForFunction(()=>typeof (window as unknown as {buildExpansion?:unknown}).buildExpansion==='function');
    const roster=await page.evaluate(()=>(window as unknown as {expansionRoster:string[]}).expansionRoster);
    const ids=value('--only')?.split(',') ?? roster;
    for(const id of ids)if(!roster.includes(id))throw Error(`Unknown creature expansion id: ${id}`);
    const built:unknown[]=[],failures:unknown[]=[];
    for(const id of ids){
      const start=Date.now();
      try{
        const result=await page.evaluate(id=>(window as unknown as {buildExpansion:(id:string)=>Promise<BuildResult>}).buildExpansion(id),id);
        const doc=await io.readBinary(new Uint8Array(Buffer.from(result.base64,'base64')));
        // A dense contact solve may need tighter precision than the library's default. Cinder's
        // actual GLB gait audit caught default simplification breaking an otherwise planted step.
        const animationResampleTolerance=result.meta.animationResampleTolerance??1e-4;
        if(typeof animationResampleTolerance!=='number'||!Number.isFinite(animationResampleTolerance)
          ||animationResampleTolerance<=0||animationResampleTolerance>1e-4)throw Error(`${id}: invalid animation resample tolerance`);
        await doc.transform(dedup(),resample({tolerance:animationResampleTolerance}));
        const report={...audit(doc),animationResampleTolerance,motion:measureMotion(doc,result.meta)};const bytes=await io.writeBinary(doc);
        await writeFile(path.join(out,`${id}.audit.json`),JSON.stringify(report,null,2)+'\n');
        if(!report.passed)throw Error(report.failures.join('; '));
        const bounds=deformedBounds(doc),{meta}=result;
        const clips=doc.getRoot().listAnimations();
        const seconds=(name:string)=>duration(clips.find(c=>c.getName()===name)!);
        const asset={id:`creature_${id}`,file:`models/creature/creature_${id}.glb`,pack:packForSpecies(id),category:'character',is:meta.is??id.replaceAll('_',' '),tags:meta.tags??['creature',id],bytes:bytes.byteLength,sha256:hash(bytes),size:{x:bounds.max[0]!-bounds.min[0]!,y:bounds.max[1]!-bounds.min[1]!,z:bounds.max[2]!-bounds.min[2]!},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:bounds.min[1],triangles:report.triangles,animations:clips.map(c=>c.getName()),materials:doc.getRoot().listMaterials().map(m=>m.getName()),sourceProvenance:meta.provenance,impliedWalkMps:meta.impliedWalkMps,impliedRunMps:meta.impliedRunMps,walkClipSeconds:seconds('Walk'),runClipSeconds:seconds('Run'),attackSeconds:seconds('Attack'),contactNormalized:meta.contactNormalized??.45,measuredGait:report.motion,metadata:meta,acceptance:{assetAudit:true,labAccepted:false,worldIntegrated:false}};
        await writeFile(path.join(out,'models',`creature_${id}.glb`),bytes);
        await writeFile(path.join(out,`${id}.json`),JSON.stringify(asset,null,2)+'\n');
        built.push(asset);console.log(JSON.stringify({id,bytes:bytes.byteLength,triangles:report.triangles,seconds:(Date.now()-start)/1000,groundY:bounds.min[1]}));
      }catch(error){const message=error instanceof Error?error.message:String(error);failures.push({id,error:message});await writeFile(path.join(out,`${id}.json`),JSON.stringify({id:`creature_${id}`,buildFailed:true,error:message,acceptance:{assetAudit:false,labAccepted:false,worldIntegrated:false}},null,2)+'\n');console.error(JSON.stringify({id,error:message}));}
    }
    let prior:{assets:Record<string,unknown>[]}={assets:[]};try{prior=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));}catch{}
    const selected=new Set(ids.map((id:string)=>`creature_${id}`));
    const byId=new Map(prior.assets.filter(a=>!selected.has(a.id as string)).map(a=>[a.id,a]));for(const a of built as Record<string,unknown>[])byId.set(a.id,a);
    await writeFile(path.join(out,'manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),packs,assets:[...byId.values()],failures,browserErrors:errors},null,2)+'\n');
    console.log(JSON.stringify({built:built.length,failed:failures.length,browserErrors:errors,output:out}));
    if(failures.length||errors.length)process.exitCode=1;
  }finally{await browser?.close();await server.close();}
}
await main();
