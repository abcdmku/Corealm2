/** Staged affine assemblies of the original CC0 Rock Face 01 scan. No remeshing. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Document,NodeIO,type Mesh} from '@gltf-transform/core';
import {copyToDocument} from '@gltf-transform/functions';
import {Box3,Euler,Matrix4,Quaternion,Vector3} from 'three';
import sharp from 'sharp';
const out='art/rebuild/candidates/finish-structures/source-bedding';
const sourcePath='art/rebuild/candidates/finish-cave-source/models/cave/rock-face-01.glb';
const sourceSha='80b6994e739dc3ddcb43fd24fdf3d3b25744a1830fc8327e5a14066818fc7b44';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(sourcePath);if(hash(bytes)!==sourceSha)throw Error('Source changed');
const io=new NodeIO(),source=await io.readBinary(bytes),manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const supportPath='art/rebuild/candidates/finish-structures/source-outcrops-quiet/models/corealm_sunder_ledge.glb';
const supportBytes=await readFile(supportPath),support=await io.readBinary(supportBytes),supportMesh=support.getRoot().listMeshes()[0]!;
const supportBounds=new Box3();
for(const primitive of supportMesh.listPrimitives()){const p=primitive.getAttribute('POSITION')!;for(let i=0;i<p.getCount();i++)supportBounds.expandByPoint(new Vector3().fromArray(p.getElement(i,[])));}
type Panel={name:string;position:[number,number,number];rotation:[number,number,number];scale:[number,number,number]};
const panel=(name:string,position:Panel['position'],rotation:Panel['rotation'],scale:Panel['scale']):Panel=>({name,position,rotation,scale});
// Each panel is the untouched 20,174-triangle source scan. Its source back plane
// is Z=0; its original X is centred and its original Y runs from 0 to 5.081 m.
const specs=[
 {id:'corealm_sunder_ledge',legacy:'cliff_step_2',panels:[
  panel('front bedding',[0,0,1.35],[.03,0,-.035],[1.38,.47,1.05]),
  panel('rear bedding',[.12,0,-1.65],[-.025,Math.PI,.035],[1.35,.49,1.1]),
  panel('left flank',[-2.85,0,-.04],[0,-Math.PI/2,.02],[.93,.46,.8]),
  panel('right flank',[2.85,0,-.10],[0,Math.PI/2,-.04],[.94,.47,.82]),
  panel('upper fractured bed',[-.10,2.04,2.6],[-Math.PI/2+.04,0,.035],[1.43,1.05,1.02]),
 ]},
 {id:'corealm_scree_slide',legacy:'cliff_step_3',panels:[
  panel('continuous descending bed',[0,.08,2.25],[-Math.PI*.32,0,.025],[.93,1.04,.72]),
  panel('rear supporting bedding',[.03,0,-1.25],[0,Math.PI,.025],[.83,.55,.72]),
  panel('front buried toe',[.05,-.1,1.65],[.1,0,-.025],[.89,.20,.6]),
  panel('left rear support',[-1.75,0,-.75],[0,-Math.PI/2,.04],[.48,.46,.65]),
  panel('right rear support',[1.74,0,-.72],[0,Math.PI/2,-.04],[.48,.46,.65]),
  panel('left toe support',[-1.74,0,.94],[0,-Math.PI/2,.025],[.42,.30,.59]),
  panel('right toe support',[1.73,0,.93],[0,Math.PI/2,-.025],[.42,.30,.59]),
 ]},
];
const pack={id:'corealm-polyhaven-bedded-shortcuts',name:'Corealm source-panel shortcut prototypes',author:'Corealm; scan by Dario Barresi / Poly Haven',source:'https://polyhaven.com/a/rock_face_01',license:'CC0-1.0'};
await mkdir(`${out}/models`,{recursive:true});await mkdir(`${out}/cpu-preview`,{recursive:true});
const entries=[];
for(const spec of specs){
 const legacy=manifest.assets.find((a:any)=>a.id===spec.legacy),doc=new Document(),scene=doc.createScene(spec.id),assembly=doc.createNode(spec.id);scene.addChild(assembly);doc.getRoot().setDefaultScene(scene);
 const copies=copyToDocument(doc,source,source.getRoot().listMeshes());
 const triangles:Vector3[][]=[],bounds=new Box3(),panelBounds:any[]=[];
 for(const part of spec.panels){
  const placement=new Matrix4().compose(new Vector3(...part.position),new Quaternion().setFromEuler(new Euler(...part.rotation)),new Vector3(...part.scale)),partBounds=new Box3();
  for(const node of source.getRoot().listNodes()){
   const mesh=node.getMesh();if(!mesh)continue;
   const matrix=placement.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()));
   assembly.addChild(doc.createNode(part.name).setMesh(copies.get(mesh)! as Mesh).setMatrix(matrix.toArray()));
   for(const primitive of mesh.listPrimitives()){
    const p=primitive.getAttribute('POSITION')!,idx=primitive.getIndices()!;
    const vertices=Array.from({length:p.getCount()},(_,i)=>new Vector3().fromArray(p.getElement(i,[])).applyMatrix4(matrix));
    for(const v of vertices){bounds.expandByPoint(v);partBounds.expandByPoint(v);}
    for(let i=0;i<idx.getCount();i+=3)triangles.push([0,1,2].map(j=>vertices[idx.getScalar(i+j)]!.clone()));
   }
  }
  panelBounds.push({name:part.name,min:partBounds.min.toArray(),max:partBounds.max.toArray()});
 }
 // Quiet licensed rock bodies fill the space behind the unchanged scanned faces.
 // They are supporting volume, not the authored outer bedding treatment.
 const bodies=spec.legacy==='cliff_step_2'?[[-2.82,-.3,-1.62,2.82,2.03,1.32]]:[[-1.70,-.3,-1.8,1.70,1.86,-.7],[-1.70,-.3,-.8,1.70,1.20,.4],[-1.68,-.3,.35,1.68,.57,1.43]];
 const supportCopy=copyToDocument(doc,support,[supportMesh]).get(supportMesh)! as Mesh;
 for(const [index,body]of bodies.entries()){
  const target=new Box3(new Vector3(body[0],body[1],body[2]),new Vector3(body[3],body[4],body[5]));
  const scale=target.getSize(new Vector3()).divide(supportBounds.getSize(new Vector3())),offset=target.min.clone().sub(supportBounds.min.clone().multiply(scale));
  assembly.addChild(doc.createNode(`buried quiet support ${index}`).setMesh(supportCopy).setScale(scale.toArray()).setTranslation(offset.toArray()));
  for(const primitive of supportMesh.listPrimitives()){
   const p=primitive.getAttribute('POSITION')!,idx=primitive.getIndices()!;
   const vertices=Array.from({length:p.getCount()},(_,i)=>new Vector3().fromArray(p.getElement(i,[])).multiply(scale).add(offset));
   for(const v of vertices)bounds.expandByPoint(v);
   for(let i=0;i<idx.getCount();i+=3)triangles.push([0,1,2].map(j=>vertices[idx.getScalar(i+j)]!.clone()));
  }
 }
 const fit=new Vector3(legacy.size.x,legacy.size.y,legacy.size.z).divide(bounds.getSize(new Vector3())),translation=new Vector3(legacy.base.x,legacy.base.y,legacy.base.z).sub(bounds.min.clone().multiply(fit));
 assembly.setScale(fit.toArray()).setTranslation(translation.toArray());
 for(const triangle of triangles)for(const vertex of triangle)vertex.multiply(fit).add(translation);
 for(const b of panelBounds){b.min=new Vector3(...b.min).multiply(fit).add(translation).toArray();b.max=new Vector3(...b.max).multiply(fit).add(translation).toArray();}
 const combinedBuffer=doc.getRoot().listBuffers()[0]!;for(const accessor of doc.getRoot().listAccessors())accessor.setBuffer(combinedBuffer);for(const buffer of doc.getRoot().listBuffers().slice(1))buffer.dispose();
 const output=await io.writeBinary(doc),file=`models/${spec.id}.glb`;await writeFile(`${out}/${file}`,output);
 const rear=triangles.flat().filter(p=>p.z<legacy.base.z+legacy.size.z*.25),front=triangles.flat().filter(p=>p.z>legacy.base.z+legacy.size.z*.75);
 const maxY=(points:Vector3[])=>points.reduce((height,p)=>Math.max(height,p.y),-Infinity);
 entries.push({id:spec.id,file,pack:pack.id,category:'rock',is:'cliff',tags:['rock','bedding','source-derived','shortcut'],size:legacy.size,base:legacy.base,animations:[],materials:doc.getRoot().listMaterials().map(m=>m.getName()),bytes:output.byteLength,sha256:hash(output),triangles:triangles.length,placement:{replacesAssetId:spec.legacy},panels:spec.panels,panelBounds,supportBodies:bodies,rearToFrontDrop:maxY(rear)-maxY(front),topology:'Overlapping open source panels with complete licensed support rocks. Not a watertight or manifold claim.'});
 for(const [view,yaw]of [['front',.4],['rear',Math.PI+.4],['side',Math.PI/2]] as const){
  const eye=new Vector3(Math.sin(yaw)*.95,.31,Math.cos(yaw)*.95).normalize(),right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),up=new Vector3().crossVectors(eye,right),centre=new Vector3(legacy.base.x+legacy.size.x/2,legacy.base.y+legacy.size.y/2,legacy.base.z+legacy.size.z/2);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  const projected=triangles.map(t=>({t,p:t.map(vertex=>{const w=vertex.clone().sub(centre),a=[w.dot(right),w.dot(up),w.dot(eye)];minX=Math.min(minX,a[0]!);maxX=Math.max(maxX,a[0]!);minY=Math.min(minY,a[1]!);maxY=Math.max(maxY,a[1]!);return a;})}));
  const scale=Math.min(710/(maxX-minX),625/(maxY-minY)),light=new Vector3(-.6,.7,.5).normalize();projected.sort((a,b)=>a.p.reduce((s,p)=>s+p[2]!,0)-b.p.reduce((s,p)=>s+p[2]!,0));
  const polygons=projected.map(({t,p})=>{const n=t[1]!.clone().sub(t[0]!).cross(t[2]!.clone().sub(t[0]!)).normalize(),shade=Math.round(65+155*Math.max(0,n.dot(light)));return `<polygon points="${p.map(v=>`${(400+(v[0]!-(minX+maxX)/2)*scale).toFixed(2)},${(390-(v[1]!-(minY+maxY)/2)*scale).toFixed(2)}`).join(' ')}" fill="rgb(${shade},${shade},${shade})"/>`;}).join('');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#25272a"/><text x="22" y="30" fill="white" font-family="sans-serif" font-size="17">${spec.id} ${view} | original scan panels, CPU only</text>${polygons}</svg>`)).png().toFile(`${out}/cpu-preview/${spec.id}-${view}.png`);
 }
}
const generator='tools/build-bedded-shortcuts.ts';
pack.license='Mixed: Poly Haven scanned faces CC0-1.0; DEXSOFT buried rock bodies under the project’s Standard Unity Asset Store EULA';
await writeFile(`${out}/catalog.json`,JSON.stringify({generator,generatorSha256:hash(await readFile(generator)),pack,source:{path:sourcePath,sha256:sourceSha,provenance:'art/rebuild/candidates/finish-cave-source/provenance.json'},support:{path:supportPath,sha256:hash(supportBytes),provenance:'art/rebuild/candidates/finish-structures/source-outcrops-quiet/shortcut-outcrops.json'},method:'Affine original scan panels and buried quiet licensed source rock bodies. Source POSITION, NORMAL, TEXCOORD_0, indices and material maps copied unchanged. Node transforms provide assembly and one overall legacy-bounds fit. Open edges overlap adjacent source panels and support bodies; complete opaque exterior is pending visual inspection.',assets:entries,visualAccepted:false,browserReviewed:false},null,2)+'\n');
await writeFile(`${out}/README.md`,'# Original source-panel prototypes\n\nRock Face 01 by Dario Barresi / Poly Haven supplies CC0 exterior scans. Quiet DEXSOFT rock bodies supply buried support under the project\'s existing Standard Unity Asset Store EULA. The assembled file is therefore mixed-license, not a CC0-only derivative. Original vertex, normal, UV, index and material channels are retained without remeshing. Only node transforms and assembly placement differ. CPU previews and catalogue describe the current prototype. Browser and world acceptance are pending. The rejected radial prototype is preserved under v1.\n');
console.log(JSON.stringify(entries.map(({id,sha256,triangles,rearToFrontDrop})=>({id,sha256,triangles,rearToFrontDrop})),null,2));
