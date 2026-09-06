/** CPU-only closed sculptural derivatives of Poly Haven's measured Rock Face 01. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Document,NodeIO,type Material} from '@gltf-transform/core';
import {copyToDocument} from '@gltf-transform/functions';
import {Box3,Vector3} from 'three';
import sharp from 'sharp';

const out='art/rebuild/candidates/finish-structures/source-bedding';
const sourcePath='art/rebuild/candidates/finish-cave-source/models/cave/rock-face-01.glb';
const expected='80b6994e739dc3ddcb43fd24fdf3d3b25744a1830fc8327e5a14066818fc7b44';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(sourcePath);if(hash(bytes)!==expected)throw Error('Source bytes changed');
const io=new NodeIO(),source=await io.readBinary(bytes);
const sourcePrimitive=source.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
const sourcePosition=sourcePrimitive.getAttribute('POSITION')!,sourceUV=sourcePrimitive.getAttribute('TEXCOORD_0')!;
const sourceIndex=sourcePrimitive.getIndices()!;
const sourceMin=sourcePosition.getMin([]),sourceMax=sourcePosition.getMax([]);
const original=Array.from({length:sourcePosition.getCount()},(_,i)=>sourcePosition.getElement(i,[]));
const originalUV=Array.from({length:sourceUV.getCount()},(_,i)=>sourceUV.getElement(i,[]));
const grid=40,buckets=Array.from({length:grid*grid},()=>[] as number[]);
const cell=(x:number,axis:number)=>Math.max(0,Math.min(grid-1,Math.floor((x-sourceMin[axis]!)/(sourceMax[axis]!-sourceMin[axis]!)*grid)));
for(let t=0;t<sourceIndex.getCount();t+=3){
 const tri=[0,1,2].map(j=>original[sourceIndex.getScalar(t+j)]!);
 for(let y=cell(Math.min(...tri.map(p=>p[1]!)),1);y<=cell(Math.max(...tri.map(p=>p[1]!)),1);y++)
 for(let x=cell(Math.min(...tri.map(p=>p[0]!)),0);x<=cell(Math.max(...tri.map(p=>p[0]!)),0);x++)buckets[y*grid+x]!.push(t);
}
let fallbackSamples=0,totalSamples=0;
function sample(u:number,v:number){
 totalSamples++;
 // A small crop avoids the torn outline of the original open scan.
 const x=sourceMin[0]!+(.10+.80*u)*(sourceMax[0]!-sourceMin[0]!);
 const y=sourceMin[1]!+(.10+.80*v)*(sourceMax[1]!-sourceMin[1]!);
 let answer:{z:number;uv:number[]}|undefined;
 for(const t of buckets[cell(y,1)*grid+cell(x,0)]!){
  const ids=[0,1,2].map(j=>sourceIndex.getScalar(t+j)),[a,b,c]=ids.map(i=>original[i]!);
  const den=(b![1]!-c![1]!)*(a![0]!-c![0]!)+(c![0]!-b![0]!)*(a![1]!-c![1]!);if(Math.abs(den)<1e-10)continue;
  const wa=((b![1]!-c![1]!)*(x-c![0]!)+(c![0]!-b![0]!)*(y-c![1]!))/den;
  const wb=((c![1]!-a![1]!)*(x-c![0]!)+(a![0]!-c![0]!)*(y-c![1]!))/den,wc=1-wa-wb;
  if(Math.min(wa,wb,wc)<-1e-6)continue;
  const weights=[wa,wb,wc],z=weights.reduce((s,w,i)=>s+w*original[ids[i]!]![2]!,0);
  if(!answer||z>answer.z)answer={z,uv:[0,1].map(axis=>weights.reduce((s,w,i)=>s+w*originalUV[ids[i]!]![axis]!,0))};
 }
 if(answer)return answer;
 fallbackSamples++;let nearest=0,distance=Infinity;
 for(let i=0;i<original.length;i++){const p=original[i]!,d=(p[0]!-x)**2+(p[1]!-y)**2;if(d<distance){distance=d;nearest=i;}}
 return {z:original[nearest]![2]!,uv:originalUV[nearest]!};
}
function interpolate(v:number,knots:number[][]){for(let i=1;i<knots.length;i++){const a=knots[i-1]!,b=knots[i]!;if(v<=b[0]!)return a[1]!+(b[1]!-a[1]!)*(v-a[0]!)/(b[0]!-a[0]!);}return knots.at(-1)![1]!;}
const pack={id:'corealm-polyhaven-bedded-shortcuts',name:'Corealm bedded shortcut prototypes',author:'Corealm; scanned source by Dario Barresi / Poly Haven',source:'https://polyhaven.com/a/rock_face_01',license:'CC0-1.0'};
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const entries:any[]=[];
await mkdir(`${out}/models`,{recursive:true});await mkdir(`${out}/cpu-preview`,{recursive:true});
for(const [id,legacyId] of [['corealm_sunder_ledge','cliff_step_2'],['corealm_scree_slide','cliff_step_3']]){
 const scree=legacyId==='cliff_step_3',legacy=manifest.assets.find((a:any)=>a.id===legacyId);
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(id);doc.getRoot().setDefaultScene(scene);
 const material=copyToDocument(doc,source,[sourcePrimitive.getMaterial()!]).get(sourcePrimitive.getMaterial()!)! as Material;
 material.setName('Poly Haven Rock Face 01 sculptural derivative').setDoubleSided(false).setNormalScale(.4);
 const positions:number[]=[],uvs:number[]=[],indices:number[]=[],N=256,R=96;
 const crownSamples=Array.from({length:N},(_,column)=>sample(.5+Math.asin(Math.sin(column/N*Math.PI*2))/Math.PI,.82).z);
 const crownProfile=crownSamples.map((_value,column)=>Array.from({length:17},(_,i)=>crownSamples[(column+i-8+N)%N]!).reduce((a,b)=>a+b,0)/17);
 for(let row=0;row<R;row++){
  const v=row/R;
  const width=interpolate(v,[[0,1],[.12,1],[.45,.91],[.70,.75],[.86,.59],[.97,.3],[1,0]]);
  const depth=scree?interpolate(v,[[0,1],[.15,.79],[.4,.55],[.7,.34],[.9,.18],[1,0]]):interpolate(v,[[0,1],[.2,.98],[.55,.79],[.85,.5],[1,0]]);
  for(let column=0;column<=N;column++){
   const theta=(column%N)/N*Math.PI*2,sin=Math.sin(theta),cos=Math.cos(theta);
   // The scan is mirrored continuously around the back; source bedding stays horizontal.
   const u=.5+Math.asin(sin)/Math.PI,scan=sample(u,v),relief=(scan.z-.5)*Math.sin(Math.PI*v);
   const angular=(value:number)=>Math.sign(value)*Math.abs(value)**.8;
   const x=angular(sin)*(width+.27*relief);
   const z=angular(cos)*(depth+.31*relief)-(scree?.72:.15)*v;
   // A single measured crown profile scales each column monotonically in height.
   // This retains uneven scanned bedding at the skyline without vertically folding
   // individual narrow fracture bands back through their neighbours.
   const crown=crownProfile[column%N]!;
   const y=v*(.78+.38*crown);
   positions.push(x,y,z);uvs.push(...scan.uv);
  }
 }
 const pole=positions.length/3;positions.push(0,.94,scree?-.72:-.15);uvs.push(.5,.95);
 const base=positions.length/3;positions.push(0,0,0);uvs.push(.5,.05);
 for(let row=0;row<R-1;row++)for(let c=0;c<N;c++){const a=row*(N+1)+c,b=a+1,d=a+N+1,e=d+1;indices.push(a,b,d,b,e,d);}
 for(let c=0;c<N;c++){const a=(R-1)*(N+1)+c;indices.push(a,a+1,pole);indices.push(c,base,c+1);}
 const bound=new Box3();for(let i=0;i<positions.length;i+=3)bound.expandByPoint(new Vector3().fromArray(positions,i));
 const size=bound.getSize(new Vector3()),fit=new Vector3(legacy.size.x,legacy.size.y,legacy.size.z).divide(size);
 for(let i=0;i<positions.length;i+=3){positions[i]=legacy.base.x+(positions[i]!-bound.min.x)*fit.x;positions[i+1]=legacy.base.y+(positions[i+1]!-bound.min.y)*fit.y;positions[i+2]=legacy.base.z+(positions[i+2]!-bound.min.z)*fit.z;}
 // Normals are recalculated from the final sculpted geometry. Stale source tangents are not retained.
 const normals=new Float32Array(positions.length);
 for(let i=0;i<indices.length;i+=3){const a=indices[i]!,b=indices[i+1]!,c=indices[i+2]!;
  const p=new Vector3().fromArray(positions,a*3),q=new Vector3().fromArray(positions,b*3),r=new Vector3().fromArray(positions,c*3),n=q.sub(p).cross(r.sub(p));
  for(const index of [a,b,c])for(let axis=0;axis<3;axis++)normals[index*3+axis]+=n.getComponent(axis);
 }
 for(let row=0;row<R;row++)for(let axis=0;axis<3;axis++){const a=row*(N+1)*3+axis,b=(row*(N+1)+N)*3+axis,s=normals[a]!+normals[b]!;normals[a]=normals[b]=s;}
 for(let i=0;i<normals.length;i+=3)new Vector3().fromArray(normals,i).normalize().toArray(normals,i);
 const accessor=(name:string,type:'VEC3'|'VEC2'|'SCALAR',array:Float32Array|Uint32Array)=>doc.createAccessor(name).setBuffer(buffer).setType(type).setArray(array);
 const primitive=doc.createPrimitive().setAttribute('POSITION',accessor('sculpted source bedding','VEC3',new Float32Array(positions))).setAttribute('NORMAL',accessor('sculpted normals','VEC3',normals)).setAttribute('TEXCOORD_0',accessor('barycentric source UV','VEC2',new Float32Array(uvs))).setIndices(accessor('closed topology','SCALAR',new Uint32Array(indices))).setMaterial(material);
 scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(primitive)));
 const output=await io.writeBinary(doc),file=`models/${id}.glb`;await writeFile(`${out}/${file}`,output);
 const welded=new Map<string,number>(),remap:number[]=[],edges=new Map<string,number>();let signedVolume=0,degenerate=0;
 for(let i=0;i<positions.length;i+=3){const key=positions.slice(i,i+3).map(n=>n.toFixed(6)).join(',');if(!welded.has(key))welded.set(key,welded.size);remap.push(welded.get(key)!);}
 for(let i=0;i<indices.length;i+=3){const tri=indices.slice(i,i+3),ids=tri.map(n=>remap[n]!);if(new Set(ids).size!==3)degenerate++;
  for(let j=0;j<3;j++){const a=ids[j]!,b=ids[(j+1)%3]!,key=`${Math.min(a,b)},${Math.max(a,b)}`;edges.set(key,(edges.get(key)??0)+1);}
  const [a,b,c]=tri.map(n=>new Vector3().fromArray(positions,n*3));signedVolume+=a!.dot(b!.cross(c!))/6;
 }
 const closure={boundaryEdges:[...edges.values()].filter(v=>v===1).length,nonmanifoldEdges:[...edges.values()].filter(v=>v!==2).length,degenerateTriangles:degenerate,signedVolume,euler:welded.size-edges.size+indices.length/3};
 if(closure.boundaryEdges||closure.nonmanifoldEdges||degenerate||signedVolume<=0||closure.euler!==2)throw Error(`Closure failed ${JSON.stringify(closure)}`);
 const peak=(predicate:(x:number,y:number,z:number)=>boolean)=>{let peak=-Infinity;for(let i=0;i<positions.length;i+=3)if(predicate(positions[i]!,positions[i+1]!,positions[i+2]!))peak=Math.max(peak,positions[i+1]!);return peak;};
 const frontPeak=peak((_x,_y,z)=>z>legacy.base.z+legacy.size.z*.75),rearPeak=peak((_x,_y,z)=>z<legacy.base.z+legacy.size.z*.25);
 entries.push({id,file,pack:pack.id,category:'rock',is:'cliff',tags:['rock','bedding','source-derived','shortcut'],size:legacy.size,base:legacy.base,animations:[],materials:[material.getName()],bytes:output.byteLength,sha256:hash(output),triangles:indices.length/3,placement:{replacesAssetId:legacyId},closure,frontPeak,rearPeak,rearToFrontDrop:rearPeak-frontPeak});
 for(const [view,yaw]of [['front',.4],['rear',Math.PI+.4],['side',Math.PI/2]] as const){
  const eye=new Vector3(Math.sin(yaw)*.95,.31,Math.cos(yaw)*.95).normalize(),right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),up=new Vector3().crossVectors(eye,right),centre=new Vector3(legacy.base.x+legacy.size.x/2,legacy.base.y+legacy.size.y/2,legacy.base.z+legacy.size.z/2);
  const tris=[];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<indices.length;i+=3){const t=indices.slice(i,i+3).map(index=>new Vector3().fromArray(positions,index*3)),p=t.map(vertex=>{const w=vertex.clone().sub(centre),a=[w.dot(right),w.dot(up),w.dot(eye)];minX=Math.min(minX,a[0]!);maxX=Math.max(maxX,a[0]!);minY=Math.min(minY,a[1]!);maxY=Math.max(maxY,a[1]!);return a;});tris.push({t,p});}
  const scale=Math.min(710/(maxX-minX),625/(maxY-minY)),light=new Vector3(-.6,.7,.5).normalize();tris.sort((a,b)=>a.p.reduce((s,p)=>s+p[2]!,0)-b.p.reduce((s,p)=>s+p[2]!,0));
  const polygons=tris.map(({t,p})=>{const n=t[1]!.clone().sub(t[0]!).cross(t[2]!.clone().sub(t[0]!)).normalize(),shade=Math.round(65+155*Math.max(0,n.dot(light)));return `<polygon points="${p.map(v=>`${(400+(v[0]!-(minX+maxX)/2)*scale).toFixed(2)},${(390-(v[1]!-(minY+maxY)/2)*scale).toFixed(2)}`).join(' ')}" fill="rgb(${shade},${shade},${shade})"/>`;}).join('');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#25272a"/><text x="22" y="30" fill="white" font-family="sans-serif" font-size="17">${id} ${view} | CPU geometry study, not acceptance</text>${polygons}</svg>`)).png().toFile(`${out}/cpu-preview/${id}-${view}.png`);
 }
}
const generator='tools/build-bedded-shortcuts.ts';
const report={generator,generatorSha256:hash(await readFile(generator)),pack,source:{path:sourcePath,sha256:expected,provenance:'art/rebuild/candidates/finish-cave-source/provenance.json'},method:'Closed ring surface carrying barycentrically sampled scan depth and UVs. The source face mirrors continuously across the rear. Authored taper and rearward crown form a grounded complete mass. Normals recomputed after deformation; embedded original maps retained. This is a sculptural derivative, not unchanged source geometry.',sampling:{totalSamples,fallbackSamples,originalTriangles:sourceIndex.getCount()/3,originalVertices:sourcePosition.getCount()},assets:entries,visualAccepted:false,browserReviewed:false,limitations:['CPU clay views do not establish visual acceptance.','The underside is capped at the legacy lower bound and must remain buried.','Six-decimal positional welding proves closed manifold edge incidence and Euler characteristic, not exhaustive triangle self-intersection freedom.','Barycentric UV resampling and deformation can stretch textures; browser material review remains required.']};
await writeFile(`${out}/catalog.json`,JSON.stringify(report,null,2)+'\n');
await writeFile(`${out}/README.md`,'# Bedded shortcut prototypes\n\n'+report.method+'\n\nSource: Dario Barresi / Poly Haven, Rock Face 01, CC0-1.0. Source files, hashes and license evidence are recorded in the linked provenance file. Original embedded maps are retained. No public assets or world placements are changed.\n\nCPU closure and shape measurements are in catalog.json. CPU previews show geometry only. Browser and final-world acceptance are pending.\n');
console.log(JSON.stringify({out,assets:entries,sampling:report.sampling},null,2));
