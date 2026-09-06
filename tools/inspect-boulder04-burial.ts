/** Read-only burial hypotheses against recorded exact production terrain samples. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='test-results/boulder04-world-grounding';
const base=JSON.parse(await readFile(`${root}/report.json`,'utf8'));
const cataloguePath='art/rebuild/candidates/finish-structures/closed-boulder04/catalog.json';
const catalogue=JSON.parse(await readFile(cataloguePath,'utf8'));
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const checks=[];
for(const source of base.sources){const actual=await hash(source.path);checks.push({path:source.path,expected:source.sha256,actual,matched:actual===source.sha256});}
for(const asset of catalogue.assets){const path=`art/rebuild/candidates/finish-structures/closed-boulder04/${asset.file}`,actual=await hash(path);checks.push({path,expected:asset.sha256,actual,matched:actual===asset.sha256});}
const sourceRoot=catalogue.source.file.slice(0,catalogue.source.file.lastIndexOf('/'));
for(const source of catalogue.source.files){const path=`${sourceRoot}/${source.file}`,actual=await hash(path);checks.push({path,expected:source.sha256,actual,matched:actual===source.sha256});}
const generatorActual=await hash(catalogue.generator);checks.push({path:catalogue.generator,expected:catalogue.generatorSha256,actual:generatorActual,matched:generatorActual===catalogue.generatorSha256});
type Point=[number,number];
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function hull(points:Point[]){const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(sorted.length<3)return sorted;const lower:Point[]=[],upper:Point[]=[];for(const p of sorted){while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}for(const p of sorted.reverse()){while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}lower.pop();upper.pop();return lower.concat(upper);}
const inside=(p:Point,polygon:Point[])=>polygon.length>=3&&polygon.every((a,i)=>cross(a,polygon[(i+1)%polygon.length]!,p)>=-1e-7);
const results=[];
for(const site of base.results){
 const path=`${root}/${site.id}-samples.json`,samples=JSON.parse(await readFile(path,'utf8')) as {x:number;z:number;bottom:number;top:number;ground:number;gap:number}[];
 const centroid:Point=[site.volumeCentroid[0],site.volumeCentroid[2]],rows=[];
 for(const burial of [.2,.3,.4,.5,.6]){
  const contacts=samples.filter(s=>s.bottom-burial-s.ground<=site.contactTolerance&&s.ground<=s.top-burial+site.contactTolerance),contactHull=hull(contacts.map(s=>[s.x,s.z])),gaps=samples.map(s=>s.bottom-burial-s.ground).sort((a,b)=>a-b),exposed=samples.map(s=>Math.max(0,s.top-burial-s.ground)).sort((a,b)=>a-b);
  const q=(a:number[],fraction:number)=>a[Math.floor((a.length-1)*fraction)];
  rows.push({burialMetres:burial,contactFraction:contacts.length/samples.length,contactCount:contacts.length,centroidProjectionInsideContactHull:inside(centroid,contactHull),centroidUndersideGap:site.centroidUndersideGap-burial,remainingGapFractionOverHalfMetre:gaps.filter(g=>g>.5).length/gaps.length,remainingGapFractionOverOneMetre:gaps.filter(g=>g>1).length/gaps.length,gapMetres:{min:gaps[0],median:q(gaps,.5),q75:q(gaps,.75),max:gaps.at(-1)},exposedHeightAboveLocalTerrain:{maximum:exposed.at(-1),median:q(exposed,.5),q90:q(exposed,.9)},topYAboveEntityOrigin:site.bounds.max[1]-site.entity.position[1]-burial,contactHull});
 }
 const minimal=rows.find(row=>row.centroidProjectionInsideContactHull);
 results.push({id:site.id,entityPosition:site.entity.position,candidate:site.candidate,sampleFile:path,sampleSha256:await hash(path),sampleCount:samples.length,contactToleranceMetres:site.contactTolerance,rows,smallestTestedOffsetWithCentroidSupport: minimal?.burialMetres??null});
}
const report={createdAt:new Date().toISOString(),baselineReport:`${root}/report.json`,baselineReportSha256:await hash(`${root}/report.json`),checks,allInputsMatch:checks.every(c=>c.matched),method:'Subtract each hypothesis offset from every recorded rock underside/top and volume-centroid Y. Recorded production terrain stays unchanged. A contact column requires underside within 5 cm of or below terrain, while the top is not fully buried. Convex hull support is geometric only, not a structural simulation.',results,screeNativeRearToFrontQuarterDrop:catalogue.assets.find((a:any)=>a.id==='corealm_scree_slide').rearToFrontQuarterDrop,screeTwoMetreDescentMet:catalogue.screeTwoMetreDescentMet,worldOrCandidateMutated:false};
await writeFile(`${root}/burial-hypotheses.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,results:results.map(site=>({...site,rows:site.rows.map(({contactHull,...row})=>row)}))},null,2));
if(!report.allInputsMatch)process.exitCode=1;
