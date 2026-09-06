/** One unchanged, complete Poly Haven Rock 09 mesh per staged shortcut. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Document,NodeIO,type Mesh} from '@gltf-transform/core';
import {copyToDocument} from '@gltf-transform/functions';
import {Box3,Matrix4,Vector3} from 'three';
import sharp from 'sharp';
const root='art/rebuild/candidates/finish-structures/source-bedding/closed-source/rock_09';
const out='art/rebuild/candidates/finish-structures/closed-rock09';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const inspection=JSON.parse(await readFile(`${root}/inspection.json`,'utf8'));
for(const file of inspection.files)if(hash(await readFile(`${root}/${file.file}`))!==file.sha256)throw Error(`Source changed: ${file.file}`);
const io=new NodeIO(),source=await io.read(`${root}/rock_09.gltf`),manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const pack={id:'corealm-polyhaven-rock09-shortcuts',name:'Corealm Rock 09 shortcut derivatives',author:'Corealm placement; original Rock 09 by Jenelle van Heerden / Poly Haven',source:'https://polyhaven.com/a/rock_09',license:'CC0-1.0'};
const entries=[];
await mkdir(`${out}/models`,{recursive:true});await mkdir(`${out}/cpu-preview`,{recursive:true});
for(const spec of [{id:'corealm_sunder_ledge',legacy:'cliff_step_2',yaw:120,pitch:18},{id:'corealm_scree_slide',legacy:'cliff_step_3',yaw:145,pitch:-39}]){
 const legacy=manifest.assets.find((a:any)=>a.id===spec.legacy),doc=new Document(),scene=doc.createScene(spec.id),body=doc.createNode(spec.id);scene.addChild(body);doc.getRoot().setDefaultScene(scene);
 const copies=copyToDocument(doc,source,source.getRoot().listMeshes()),rotation=new Matrix4().makeRotationY(spec.yaw*Math.PI/180).multiply(new Matrix4().makeRotationX(spec.pitch*Math.PI/180));
 const triangles:Vector3[][]=[],bounds=new Box3();
 for(const node of source.getRoot().listNodes()){
  const mesh=node.getMesh();if(!mesh)continue;
  const matrix=rotation.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()));body.addChild(doc.createNode('original Rock 09').setMesh(copies.get(mesh)! as Mesh).setMatrix(matrix.toArray()));
  for(const primitive of mesh.listPrimitives()){
   const position=primitive.getAttribute('POSITION')!,index=primitive.getIndices()!,vertices=Array.from({length:position.getCount()},(_,i)=>new Vector3().fromArray(position.getElement(i,[])).applyMatrix4(matrix));
   for(const v of vertices)bounds.expandByPoint(v);
   for(let i=0;i<index.getCount();i+=3)triangles.push([0,1,2].map(j=>vertices[index.getScalar(i+j)]!.clone()));
  }
 }
 const fit=new Vector3(legacy.size.x,legacy.size.y,legacy.size.z).divide(bounds.getSize(new Vector3())),translation=new Vector3(legacy.base.x,legacy.base.y,legacy.base.z).sub(bounds.min.clone().multiply(fit));
 body.setScale(fit.toArray()).setTranslation(translation.toArray());for(const triangle of triangles)for(const p of triangle)p.multiply(fit).add(translation);
 const bytes=await io.writeBinary(doc),file=`models/${spec.id}.glb`;await writeFile(`${out}/${file}`,bytes);
 // Sample vertical intersections over the actual projected footprint. The lowest
 // triangle hit is the underside. No plane, collider, terrain or pivot is added.
 const sampleN=96,bottoms:number[]=[],tops:number[]=[],groundPoints:number[][]=[];
 for(let iz=0;iz<sampleN;iz++)for(let ix=0;ix<sampleN;ix++){
  const x=legacy.base.x+(ix+.5)/sampleN*legacy.size.x,z=legacy.base.z+(iz+.5)/sampleN*legacy.size.z;let low=Infinity,high=-Infinity;
  for(const [a,b,c]of triangles){
   if(x<Math.min(a!.x,b!.x,c!.x)||x>Math.max(a!.x,b!.x,c!.x)||z<Math.min(a!.z,b!.z,c!.z)||z>Math.max(a!.z,b!.z,c!.z))continue;
   const d=(b!.z-c!.z)*(a!.x-c!.x)+(c!.x-b!.x)*(a!.z-c!.z);if(Math.abs(d)<1e-12)continue;
   const wa=((b!.z-c!.z)*(x-c!.x)+(c!.x-b!.x)*(z-c!.z))/d,wb=((c!.z-a!.z)*(x-c!.x)+(a!.x-c!.x)*(z-c!.z))/d,wc=1-wa-wb;
   if(Math.min(wa,wb,wc)<-1e-7)continue;const y=wa*a!.y+wb*b!.y+wc*c!.y;low=Math.min(low,y);high=Math.max(high,y);
  }
  if(Number.isFinite(low)){bottoms.push(low);tops.push(high);if(low<=0&&high>=0)groundPoints.push([x,z]);}
 }
 bottoms.sort((a,b)=>a-b);const q=(fraction:number)=>Math.max(0,bottoms[Math.floor((bottoms.length-1)*fraction)]!);
 const support={method:'96×96 vertical-ray grid over exact transformed GLB triangle footprint; ground plane Y=0, pivot held at legacy base',sampledFootprintColumns:bottoms.length,groundIntersectingColumns:groundPoints.length,groundIntersectingFootprintFraction:groundPoints.length/bottoms.length,minimumUndersideY:bottoms[0],medianUndersideY:bottoms[Math.floor(bottoms.length/2)],maximumUndersideY:bottoms.at(-1),additionalDownwardBurialForUndersideQuantile:{'25percent':q(.25),'50percent':q(.5),'75percent':q(.75),'90percent':q(.9)},pivotChangedBeyondLegacyFit:false,terrainChanged:false,caveat:'Underside quantiles report how far a flat ground plane would need to rise relative to this held pivot. This is an embedding diagnostic, not an instruction to change terrain or an approved stability threshold.'};
 const front=triangles.flat().filter(p=>p.z>legacy.base.z+legacy.size.z*.75),rear=triangles.flat().filter(p=>p.z<legacy.base.z+legacy.size.z*.25),peak=(p:Vector3[])=>p.reduce((y,p)=>Math.max(y,p.y),-Infinity);
 entries.push({id:spec.id,file,pack:pack.id,category:'rock',is:'cliff',tags:['rock','fractured','source-derived','shortcut'],size:legacy.size,base:legacy.base,animations:[],materials:doc.getRoot().listMaterials().map(m=>m.getName()),bytes:bytes.byteLength,sha256:hash(bytes),triangles:triangles.length,placement:{replacesAssetId:spec.legacy},transform:{yawDegrees:spec.yaw,pitchDegrees:spec.pitch,order:'source X pitch then world Y yaw, then axis fit and legacy-base translation',rigidBounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new Vector3()).toArray()},axisScale:fit.toArray(),translation:translation.toArray()},rearToFrontQuarterDrop:peak(rear)-peak(front),support});
 for(const [view,yaw,pitch]of [['front',.4,.31],['rear',Math.PI+.4,.31],['left',-Math.PI/2,.31],['right',Math.PI/2,.31],['front-high',.4,.78],['rear-high',Math.PI+.4,.78]] as const){
  const eye=new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)),right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),up=new Vector3().crossVectors(eye,right),centre=new Vector3(legacy.base.x+legacy.size.x/2,legacy.base.y+legacy.size.y/2,legacy.base.z+legacy.size.z/2);let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  const projected=triangles.map(t=>({t,p:t.map(vertex=>{const w=vertex.clone().sub(centre),a=[w.dot(right),w.dot(up),w.dot(eye)];minX=Math.min(minX,a[0]!);maxX=Math.max(maxX,a[0]!);minY=Math.min(minY,a[1]!);maxY=Math.max(maxY,a[1]!);return a;})}));
  const scale=Math.min(710/(maxX-minX),625/(maxY-minY)),light=new Vector3(-.6,.7,.5).normalize();projected.sort((a,b)=>a.p.reduce((s,p)=>s+p[2]!,0)-b.p.reduce((s,p)=>s+p[2]!,0));
  const polygons=projected.map(({t,p})=>{const n=t[1]!.clone().sub(t[0]!).cross(t[2]!.clone().sub(t[0]!)).normalize(),shade=Math.round(65+155*Math.max(0,n.dot(light)));return `<polygon points="${p.map(v=>`${(400+(v[0]!-(minX+maxX)/2)*scale).toFixed(2)},${(390-(v[1]!-(minY+maxY)/2)*scale).toFixed(2)}`).join(' ')}" fill="rgb(${shade},${shade},${shade})"/>`;}).join('');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#25272a"/><text x="22" y="30" fill="white" font-family="sans-serif" font-size="17">${spec.id} ${view} | one original Rock 09, CPU only</text>${polygons}</svg>`)).png().toFile(`${out}/cpu-preview/${spec.id}-${view}.png`);
 }
}
const generator='tools/build-rock09-shortcuts.ts';
await writeFile(`${out}/catalog.json`,JSON.stringify({generator,generatorSha256:hash(await readFile(generator)),pack,source:{file:`${root}/rock_09.gltf`,inspection:`${root}/inspection.json`,files:inspection.files,topology:inspection.geometry},method:'One entire original Rock 09 mesh per asset. Original geometry channels, indices and materials unchanged. Rigid rotation and modest axis fit only. No extra support, open panels, terrain or procedural deformation.',assets:entries,visualAccepted:false,browserReviewed:false},null,2)+'\n');
console.log(JSON.stringify(entries.map(({id,sha256,rearToFrontQuarterDrop,support})=>({id,sha256,rearToFrontQuarterDrop,support})),null,2));
