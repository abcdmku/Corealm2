/** CPU evidence against current production terrain. Does not change source or placement. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {Box3,Matrix4,Scene,Vector3} from 'three';
import sharp from 'sharp';
import {WorldScene} from '../game/src/render/scene.js';
import {buildWorldTerrainSpec} from '../game/src/app/worldSpec.js';
import {prepareWorldSurface} from '../game/src/app/worldSurface.js';
import {buildWorld} from '../game/src/world/regionBuilder.js';
const out=process.argv[3]??'test-results/rock09-world-grounding';await mkdir(out,{recursive:true});
const cataloguePath=process.argv[2]??'art/rebuild/candidates/finish-structures/closed-rock09/catalog.json',catalogue=JSON.parse(await readFile(cataloguePath,'utf8'));
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const paths=['game/src/app/worldSpec.ts','game/src/app/worldSurface.ts','game/src/render/scene.ts','game/src/world/regionBuilder.ts','game/src/content/regions.ts','game/public/assets/manifest.json',cataloguePath];
const sources=await Promise.all(paths.map(async path=>({path,sha256:await hash(path)})));
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')),assets=new Map<string,any>(manifest.assets.map((a:any)=>[a.id,a]));
const terrain=new WorldScene(new Scene());terrain.buildWorld({...buildWorldTerrainSpec(),coast:undefined},scene=>prepareWorldSurface(scene));
const heightAt=(_region:unknown,x:number,z:number)=>terrain.meshHeightAt(x,z);
const world=buildWorld(1337,heightAt,{heightAt,baseY:id=>assets.get(id)?.base.y??0,assetSize:id=>assets.get(id)?.size??null,assetCenterXZ:id=>{const a=assets.get(id);return a?{x:a.base.x+a.size.x/2,z:a.base.z+a.size.z/2}:null;}});
type Point=[number,number];
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function hull(points:Point[]){const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(sorted.length<3)return sorted;const lower:Point[]=[],upper:Point[]=[];for(const p of sorted){while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}for(const p of sorted.reverse()){while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}lower.pop();upper.pop();return lower.concat(upper);}
const inside=(p:Point,polygon:Point[])=>polygon.length>=3&&polygon.every((a,i)=>cross(a,polygon[(i+1)%polygon.length]!,p)>=-1e-7);
const results=[];
try{
for(const id of ['sunder_ledge','scree_slide']){
 const entity=world.entities.find(e=>e.id===id)!;if(!entity)throw Error(`Missing ${id}`);
 const candidate=catalogue.assets.find((a:any)=>a.placement.replacesAssetId===entity.view?.assetId);if(!candidate)throw Error(`No candidate ${id}`);
 const candidateFile=`${cataloguePath.slice(0,cataloguePath.lastIndexOf('/'))}/${candidate.file}`;if(await hash(candidateFile)!==candidate.sha256)throw Error('Candidate changed');
 const doc=await new NodeIO().read(candidateFile),yaw=entity.view?.rotationY??0,scale=entity.view?.scale??1;
 const placement=new Matrix4().makeTranslation(...entity.position).multiply(new Matrix4().makeRotationY(yaw)).multiply(new Matrix4().makeScale(scale,scale,scale));
 const triangles:Vector3[][]=[],bounds=new Box3();
 for(const node of doc.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){const m=placement.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix())),position=p.getAttribute('POSITION')!,index=p.getIndices()!,vertices=Array.from({length:position.getCount()},(_,i)=>new Vector3().fromArray(position.getElement(i,[])).applyMatrix4(m));for(const v of vertices)bounds.expandByPoint(v);for(let i=0;i<index.getCount();i+=3)triangles.push([0,1,2].map(j=>vertices[index.getScalar(i+j)]!));}
 const origin=bounds.getCenter(new Vector3()),centroid=new Vector3();let volume=0;
 for(const [a,b,c]of triangles){const ar=a!.clone().sub(origin),br=b!.clone().sub(origin),cr=c!.clone().sub(origin),v=ar.dot(br.clone().cross(cr))/6;volume+=v;centroid.add(ar.add(br).add(cr).multiplyScalar(v/4));}centroid.divideScalar(volume).add(origin);
 function ray(x:number,z:number){let bottom=Infinity,top=-Infinity;for(const [a,b,c]of triangles){if(x<Math.min(a!.x,b!.x,c!.x)||x>Math.max(a!.x,b!.x,c!.x)||z<Math.min(a!.z,b!.z,c!.z)||z>Math.max(a!.z,b!.z,c!.z))continue;const den=(b!.z-c!.z)*(a!.x-c!.x)+(c!.x-b!.x)*(a!.z-c!.z);if(Math.abs(den)<1e-10)continue;const wa=((b!.z-c!.z)*(x-c!.x)+(c!.x-b!.x)*(z-c!.z))/den,wb=((c!.z-a!.z)*(x-c!.x)+(a!.x-c!.x)*(z-c!.z))/den,wc=1-wa-wb;if(Math.min(wa,wb,wc)<-1e-7)continue;const y=wa*a!.y+wb*b!.y+wc*c!.y;bottom=Math.min(bottom,y);top=Math.max(top,y);}return Number.isFinite(bottom)?{bottom,top}:null;}
 const samples:any[]=[],contacts:Point[]=[],size=bounds.getSize(new Vector3()),N=96,tolerance=.05;
 for(let iz=0;iz<N;iz++)for(let ix=0;ix<N;ix++){const x=bounds.min.x+(ix+.5)/N*size.x,z=bounds.min.z+(iz+.5)/N*size.z,rock=ray(x,z);if(!rock)continue;const ground=terrain.meshHeightAt(x,z),gap=rock.bottom-ground,contact=gap<=tolerance&&ground<=rock.top+tolerance;samples.push({x,z,...rock,ground,gap,contact});if(contact)contacts.push([x,z]);}
 const contactHull=hull(contacts),gaps=samples.map(s=>s.gap).sort((a,b)=>a-b),quantile=(q:number)=>gaps[Math.floor((gaps.length-1)*q)];
 const centreGround=terrain.meshHeightAt(centroid.x,centroid.z),centroidRay=ray(centroid.x,centroid.z);
 const summary={id,entity,candidate:{file:candidateFile,sha256:candidate.sha256},bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},volume,volumeCentroid:centroid.toArray(),centroidUndersideY:centroidRay?.bottom,centroidTerrainY:centreGround,centroidUndersideGap:centroidRay?centroidRay.bottom-centreGround:null,contactTolerance:tolerance,sampleCount:samples.length,contactCount:contacts.length,contactFraction:contacts.length/samples.length,centroidProjectionInsideContactHull:inside([centroid.x,centroid.z],contactHull),contactHull,gapMetres:{min:gaps[0],q25:quantile(.25),median:quantile(.5),q75:quantile(.75),q90:quantile(.9),max:gaps.at(-1)},overhangFractionAboveHalfMetre:samples.filter(s=>s.gap>.5).length/samples.length,overhangFractionAboveOneMetre:samples.filter(s=>s.gap>1).length/samples.length,overhangFractionAboveTwoMetres:samples.filter(s=>s.gap>2).length/samples.length,terrainBounds:[Math.min(...samples.map(s=>s.ground)),Math.max(...samples.map(s=>s.ground))]};
 for(const axis of ['x','z'] as const){
  const start=bounds.min[axis]-2,end=bounds.max[axis]+2,section=Array.from({length:220},(_,i)=>{const along=start+(end-start)*i/219,x=axis==='x'?along:centroid.x,z=axis==='z'?along:centroid.z;return{along,ground:terrain.meshHeightAt(x,z),rock:ray(x,z)};}),minY=Math.min(...section.map(s=>s.ground),bounds.min.y)-.5,maxY=Math.max(...section.map(s=>s.ground),bounds.max.y)+.5;
  const px=(x:number)=>75+(x-start)/(end-start)*850,py=(y:number)=>535-(y-minY)/(maxY-minY)*445;
  const terrainLine=section.map(s=>`${px(s.along).toFixed(2)},${py(s.ground).toFixed(2)}`).join(' '),rockRuns:string[]=[];let run:typeof section=[];
  function flush(){if(run.length){rockRuns.push(run.map(s=>`${px(s.along)},${py(s.rock!.top)}`).concat(run.slice().reverse().map(s=>`${px(s.along)},${py(s.rock!.bottom)}`)).join(' '));run=[];}}
  for(const row of section){if(row.rock)run.push(row);else flush();}flush();
  const ticks=Array.from({length:6},(_,i)=>{const y=minY+(maxY-minY)*i/5;return`<line x1="75" x2="925" y1="${py(y)}" y2="${py(y)}" stroke="#d6dbe1"/><text x="16" y="${py(y)+4}" font-size="13">${y.toFixed(1)} m</text>`;}).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="620"><rect width="1000" height="620" fill="#f4f5f6"/><g font-family="sans-serif" fill="#202832"><text x="45" y="32" font-size="21">${id}: world ${axis.toUpperCase()} section through volume centroid</text><text x="45" y="58" font-size="14">Current authored placement and production terrain. Orange = rock, green = terrain.</text>${ticks}${rockRuns.map(points=>`<polygon points="${points}" fill="#cf8d49" stroke="#805b34" opacity=".8"/>`).join('')}<polyline points="${terrainLine}" fill="none" stroke="#36734c" stroke-width="4"/><line x1="${px(centroid[axis])}" x2="${px(centroid[axis])}" y1="75" y2="535" stroke="#344b7c" stroke-dasharray="6 5"/><text x="75" y="575" font-size="14">${start.toFixed(1)} m</text><text x="840" y="575" font-size="14">${end.toFixed(1)} m</text><text x="75" y="602" font-size="13">CPU section; no geometry, pivot or terrain changed. Blue dashed line = centroid projection.</text></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${out}/${id}-${axis}-section.png`);await writeFile(`${out}/${id}-${axis}-section.json`,JSON.stringify(section));
 }
 await writeFile(`${out}/${id}-samples.json`,JSON.stringify(samples));results.push(summary);
}
const changedSources=[];for(const source of sources)if(await hash(source.path)!==source.sha256)changedSources.push(source.path);
await writeFile(`${out}/report.json`,JSON.stringify({createdAt:new Date().toISOString(),sources,changedSources,scope:'CPU production terrain and exact current authored entities with unpromoted candidate mesh substitution only; coast visuals omitted, production terrain/surface preparation retained.',results},null,2)+'\n');console.log(JSON.stringify({out,changedSources,results:results.map(({id,contactFraction,centroidProjectionInsideContactHull,centroidUndersideGap,gapMetres,overhangFractionAboveOneMetre,entity})=>({id,position:entity.position,contactFraction,centroidProjectionInsideContactHull,centroidUndersideGap,gapMetres,overhangFractionAboveOneMetre}))},null,2));
}finally{terrain.dispose();}
