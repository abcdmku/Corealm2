import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=new URL('./',import.meta.url),io=new NodeIO(),bytes=await readFile(new URL('Fox.adapted.glb',out)),doc=await io.readBinary(bytes),skin=doc.getRoot().listSkins()[0];
const names=['b_RightHand_08','b_LeftHand_011','b_LeftFoot02_018','b_RightFoot02_022'];
const p=doc.getRoot().listMeshes()[0].listPrimitives()[0],positions=p.getAttribute('POSITION'),joints=p.getAttribute('JOINTS_0'),weights=p.getAttribute('WEIGHTS_0'),report=[];
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
for(const name of names){
 const joint=skin.listJoints().findIndex(j=>j.getName()===name),indices=[];
 for(let i=0;i<positions.getCount();i++){const v=positions.getElement(i,[]),js=joints.getElement(i,[]),ws=weights.getElement(i,[]);if(v[1]<9&&js.some((j,k)=>j===joint&&ws[k]>.45))indices.push(i);}
 const values=indices.map(i=>positions.getElement(i,[])),sole=Math.min(...values.map(v=>v[1])),low=values.filter(v=>v[1]<sole+3.2),cx=(Math.min(...low.map(v=>v[0]))+Math.max(...low.map(v=>v[0])))/2,cz=(Math.min(...low.map(v=>v[2]))+Math.max(...low.map(v=>v[2])))/2;
 const rx=(Math.max(...low.map(v=>v[0]))-Math.min(...low.map(v=>v[0])))/2,rz=(Math.max(...low.map(v=>v[2]))-Math.min(...low.map(v=>v[2])))/2;
 // Reparameterize the connected distal skin into a rounded elongated footprint.
 // Preserve source mesh topology and skin influences; no appended paw primitives.
 for(const i of indices){const v=positions.getElement(i,[]),h=v[1]-sole,blend=1-smooth((h-3.4)/5.4),nx=(v[0]-cx)/rx,nz=(v[2]-cz)/rz,angle=Math.atan2(nz,nx),radial=Math.hypot(nx,nz)/(1+.20*Math.hypot(nx,nz));
  const dome=Math.sqrt(Math.max(.1,1-((h-1.6)/4.7)**2)),width=3.15*dome,length=5.15*dome;
  const tx=cx+width*Math.cos(angle)*radial,tz=cz+.65+length*Math.sin(angle)*radial;
  v[0]=THREE.MathUtils.lerp(v[0],tx,blend);v[2]=THREE.MathUtils.lerp(v[2],tz,blend);
  // Three shallow toe clefts shape the fore edge while keeping one continuous paw.
  const front=smooth((Math.sin(angle)-.48)/.5),top=smooth(h/1.1)*(1-smooth((h-3)/1.5));
  const clefts=[-.47,0,.47].reduce((a,x)=>a+Math.exp(-(((Math.cos(angle)-x)/.065)**2)),0);
  v[2]-=.22*clefts*front*blend;
  positions.setElement(i,v);
 }
 report.push({name,vertices:indices.length,sourceSole:sole,centre:[cx,cz],authoredFootprintMaxWidthM:.063,authoredFootprintMaxLengthM:.103});
}
// Locally limit only folds where a face reverses relative to the original surface.
const sourcePositions=(await io.readBinary(bytes)).getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION'),surfaceIndices=p.getIndices().getArray();
let limitedVertices=new Set();
for(let pass=0;pass<40;pass++){
 const fix=new Set();
 for(let i=0;i<surfaceIndices.length;i+=3){const ids=[surfaceIndices[i],surfaceIndices[i+1],surfaceIndices[i+2]],normal=attribute=>{const [a,b,c]=ids.map(id=>new THREE.Vector3(...attribute.getElement(id,[])));return b.sub(a).cross(c.sub(a));};if(normal(positions).dot(normal(sourcePositions))<0)ids.forEach(id=>fix.add(id));}
 if(!fix.size)break;
 for(const id of fix){const old=sourcePositions.getElement(id,[]),value=positions.getElement(id,[]);positions.setElement(id,value.map((v,k)=>THREE.MathUtils.lerp(old[k],v,.8)));limitedVertices.add(id);}
}
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions.getArray(),3));geometry.setIndex(Array.from(p.getIndices().getArray()));geometry.computeVertexNormals();p.getAttribute('NORMAL').setArray(geometry.getAttribute('normal').array);
const result=Buffer.from(await io.writeBinary(doc));await writeFile(new URL('Fox.paws.glb',out),result);
const hash=b=>createHash('sha256').update(b).digest('hex');
await writeFile(new URL('paw-review.json',out),JSON.stringify({source:hash(bytes),candidate:hash(result),method:'Connected original distal source surface reshaped to flattened elongated oval, tapered ankle transition and shallow toe clefts; no added geometry. Native skin weights, rig and animations unchanged.',feet:report,hardwareAccepted:false},null,2)+'\n');
const catalogue=JSON.parse(await readFile(new URL('catalogue.json',out),'utf8'));catalogue.files.creature_redbrush_fox='Fox.paws.glb';catalogue.scope='Source fox paw-shape revision review, native uncorrected motion';catalogue.assets[0].sha256=hash(result);catalogue.assets[0].bytes=result.length;await writeFile(new URL('paw-catalogue.json',out),JSON.stringify(catalogue,null,2)+'\n');
console.log(report);

// Validate mesh topology and exact rig/animation/skin preservation for the paw edit.
const original=await io.readBinary(bytes),nativeHash=d=>{const h=createHash('sha256');for(const n of d.getRoot().listNodes())h.update(JSON.stringify([n.getName(),n.getTranslation(),n.getRotation(),n.getScale()]));for(const a of d.getRoot().listAnimations())for(const c of a.listChannels()){h.update(c.getTargetNode().getName()+c.getTargetPath());h.update(Buffer.from(c.getSampler().getInput().getArray().buffer));h.update(Buffer.from(c.getSampler().getOutput().getArray().buffer));}for(const s of d.getRoot().listSkins())h.update(Buffer.from(s.getInverseBindMatrices().getArray().buffer));return h.digest('hex');};
let degenerate=0,flipped=0;const idx=p.getIndices().getArray(),oldp=original.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
const normal=(attribute,i)=>{const a=new THREE.Vector3(...attribute.getElement(idx[i],[])),b=new THREE.Vector3(...attribute.getElement(idx[i+1],[])),c=new THREE.Vector3(...attribute.getElement(idx[i+2],[]));return b.sub(a).cross(c.sub(a));};
for(let i=0;i<idx.length;i+=3){const n=normal(positions,i);if(n.lengthSq()<1e-16)degenerate++;if(n.dot(normal(oldp,i))<0)flipped++;}
const review=JSON.parse(await readFile(new URL('paw-review.json',out),'utf8'));review.validation={locallyLimitedVertices:limitedVertices.size,nativeRigAndAnimationHashEqual:nativeHash(original)===nativeHash(doc),weightsUnchanged:hash(Buffer.from(weights.getArray().buffer))===hash(Buffer.from(original.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('WEIGHTS_0').getArray().buffer)),degenerateTriangles:degenerate,trianglesWhoseNormalTurnedOver90Degrees:flipped,finitePositions:Array.from(positions.getArray()).every(Number.isFinite)};await writeFile(new URL('paw-review.json',out),JSON.stringify(review,null,2)+'\n');console.log(review.validation);


