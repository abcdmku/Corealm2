import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const rootURL=new URL('../../../',import.meta.url);
const originalURL=new URL('art/rebuild/candidates/finish-quadrupeds/source-fox/',rootURL);
const out=new URL('art/rebuild/candidates/finish-quadrupeds/source-fox-adaptation/',rootURL);
await mkdir(out,{recursive:true});
const io=new NodeIO(),originalBytes=await readFile(new URL('Fox.original.glb',originalURL));
const scaledBytes=await readFile(new URL('Fox.preview-scale001.glb',originalURL));
const sourceDoc=await io.readBinary(scaledBytes),doc=await io.readBinary(scaledBytes);
const sha=x=>createHash('sha256').update(x).digest('hex');
const sourceHash=sha(originalBytes);
if(sourceHash!=='d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7')throw Error('Pinned original Fox changed');
const clamp=THREE.MathUtils.clamp,lerp=THREE.MathUtils.lerp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const noise=(x,y,z)=>{const v=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return v-Math.floor(v);};
const rt=doc.getRoot(),buffer=rt.listBuffers()[0];
const fox=rt.listNodes().find(n=>n.getMesh()),skin=fox.getSkin(),joints=skin.listJoints();
const primitive=fox.getMesh().listPrimitives()[0];
const nativeHash=d=>{
  const h=createHash('sha256');
  for(const n of d.getRoot().listNodes())h.update(JSON.stringify({name:n.getName(),t:n.getTranslation(),r:n.getRotation(),s:n.getScale(),parent:n.getParentNode()?.getName()}));
  for(const s of d.getRoot().listSkins()){h.update(JSON.stringify(s.listJoints().map(j=>j.getName())));h.update(Buffer.from(s.getInverseBindMatrices().getArray().buffer));}
  for(const a of d.getRoot().listAnimations()){h.update(a.getName());for(const c of a.listChannels()){h.update(c.getTargetNode().getName()+c.getTargetPath()+c.getSampler().getInterpolation());for(const acc of [c.getSampler().getInput(),c.getSampler().getOutput()])h.update(Buffer.from(acc.getArray().buffer));}}
  return h.digest('hex');
};
const beforeRigHash=nativeHash(doc);
const {data:pixels,info}=await sharp(primitive.getMaterial().getBaseColorTexture().getImage()).raw().toBuffer({resolveWithObject:true});
const pos=primitive.getAttribute('POSITION'),uv=primitive.getAttribute('TEXCOORD_0'),si=primitive.getAttribute('JOINTS_0'),sw=primitive.getAttribute('WEIGHTS_0');
const vertices=[],triangles=[],lookup=new Map(),indices=[];
for(let i=0;i<pos.getCount();i++){
  const p=pos.getElement(i,[]),tex=uv.getElement(i,[]),js=si.getElement(i,[]),ws=sw.getElement(i,[]);
  const key=p.map(v=>Math.round(v*1e5)).join(',')+'|'+js.map((j,k)=>`${j}:${Math.round(ws[k]*1e5)}`).join(',');
  const px=clamp(Math.floor(tex[0]*info.width),0,info.width-1),py=clamp(Math.floor(tex[1]*info.height),0,info.height-1),offset=(py*info.width+px)*info.channels;
  const col=new THREE.Color().setRGB(pixels[offset]/255,pixels[offset+1]/255,pixels[offset+2]/255,THREE.SRGBColorSpace).toArray();
  let id=lookup.get(key);
  if(id===undefined){id=vertices.length;lookup.set(key,id);vertices.push({p,weights:new Map(js.map((j,k)=>[j,ws[k]]).filter(([,w])=>w>0)),c:[0,0,0],contributors:0});}
  const v=vertices[id];v.c=v.c.map((n,k)=>n+col[k]);v.contributors++;indices.push(id);
}
for(const v of vertices)v.c=v.c.map(n=>n/v.contributors);
const sourceIndices=primitive.getIndices()?.getArray()??Uint32Array.from({length:pos.getCount()},(_,i)=>i);
for(let i=0;i<sourceIndices.length;i+=3)triangles.push([indices[sourceIndices[i]],indices[sourceIndices[i+1]],indices[sourceIndices[i+2]]]);
const weldedCount=vertices.length;
const footNames=['b_RightHand_08','b_LeftHand_011','b_LeftFoot02_018','b_RightFoot02_022'];
const footCentres=new Map();
for(const name of footNames){
  const joint=joints.findIndex(j=>j.getName()===name),vs=vertices.filter(v=>(v.weights.get(joint)??0)>.45&&v.p[1]<8);
  if(vs.length)footCentres.set(joint,{x:vs.reduce((n,v)=>n+v.p[0],0)/vs.length,minY:Math.min(...vs.map(v=>v.p[1]))});
}
// Sculpt the actual source distal vertices. Keep their original sole elevation
// and rig weights, widen the contact end and soften its pointed wedge in Z.
let reshapedFootVertices=0;
for(const v of vertices){
  const [joint,weight]=[...v.weights].sort((a,b)=>b[1]-a[1])[0],foot=footCentres.get(joint);
  if(!foot||weight<.45||v.p[1]>8)continue;
  const strength=1-smooth(2.5,8,v.p[1]);
  v.p[0]=foot.x+(v.p[0]-foot.x)*(1+.48*strength);
  v.p[2]+=.65*strength;reshapedFootVertices++;
}

function combine(parts){
  const v={p:[0,0,0],c:[0,0,0],weights:new Map()};
  for(const [src,f]of parts){for(let k=0;k<3;k++){v.p[k]+=src.p[k]*f;v.c[k]+=src.c[k]*f;}for(const [j,w]of src.weights)v.weights.set(j,(v.weights.get(j)??0)+w*f);}
  const best=[...v.weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=best.reduce((n,p)=>n+p[1],0);v.weights=new Map(best.map(([j,w])=>[j,w/sum]));return v;
}
function subdivide(vs,ts,iteration){
  const neighbours=vs.map(()=>new Set()),edges=new Map();
  for(const [a,b,c]of ts)for(const [i,j,k]of [[a,b,c],[b,c,a],[c,a,b]]){neighbours[i].add(j);neighbours[j].add(i);const key=i<j?`${i},${j}`:`${j},${i}`;if(!edges.has(key))edges.set(key,{a:Math.min(i,j),b:Math.max(i,j),opposite:[]});edges.get(key).opposite.push(k);}
  const result=vs.map((v,i)=>{
    const ns=[...neighbours[i]],n=ns.length;if(n<3)return combine([[v,1]]);
    // Deliberately retain characteristic ear/nose planes. Feet keep their
    // original floor band, while the trunk gets most of the cage relaxation.
    let strength=[.66,.46,.25][iteration];
    if(v.p[1]>68||v.p[2]>58)strength*=.20;
    if(v.p[1]<3)strength*=.12;
    const beta=n===3?3/16:3/(8*n),parts=[[v,1-strength*n*beta],...ns.map(j=>[vs[j],strength*beta])];
    const next=combine(parts);
    if(v.p[1]<1.5)next.p[1]=v.p[1];
    return next;
  });
  for(const e of edges.values()){
    e.index=result.length;
    const boundary=e.opposite.length!==2;
    const src=boundary?combine([[vs[e.a],.5],[vs[e.b],.5]]):combine([[vs[e.a],.375],[vs[e.b],.375],[vs[e.opposite[0]],.125],[vs[e.opposite[1]],.125]]);
    const midpoint=combine([[vs[e.a],.5],[vs[e.b],.5]]);
    const preserve=(midpoint.p[1]>68||midpoint.p[2]>58)?.86:midpoint.p[1]<3?.82:.28;
    result.push(combine([[src,1-preserve],[midpoint,preserve]]));
  }
  const edge=(a,b)=>edges.get(a<b?`${a},${b}`:`${b},${a}`).index,newTriangles=[];
  for(const [a,b,c]of ts){const ab=edge(a,b),bc=edge(b,c),ca=edge(c,a);newTriangles.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);}
  return {vertices:result,triangles:newTriangles};
}
let mesh={vertices,triangles};
for(let i=0;i<3;i++)mesh=subdivide(mesh.vertices,mesh.triangles,i);
// Preserve the source orange/white/dark-region meaning while adding fine,
// directional colour variation to the refined surface. No new raster image.
for(const v of mesh.vertices){
  const [x,y,z]=v.p,grain=noise(Math.floor(x*3.8),Math.floor(y*.85),Math.floor(z*4.2));
  const fleck=noise(Math.floor(x*1.9),Math.floor(y*1.9),Math.floor(z*1.5));
  const upper=smooth(40,58,y)*(1-smooth(26,42,z));
  const factor=.92+.12*grain-.08*upper*fleck;
  v.c=v.c.map(n=>clamp(n*factor,0,1));
}
const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(mesh.vertices.flatMap(v=>v.p),3));geom.setIndex(mesh.triangles.flat());geom.computeVertexNormals();
const coat=primitive.getMaterial();coat.setName('Fox_source_coat_refined').setBaseColorTexture(null).setBaseColorFactor([1,1,1,1]).setRoughnessFactor(.91).setMetallicFactor(0);
const acc=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
primitive.setAttribute('POSITION',acc('Fox_refined_position','VEC3',new Float32Array(mesh.vertices.flatMap(v=>v.p))));
primitive.setAttribute('NORMAL',acc('Fox_refined_normal','VEC3',geom.attributes.normal.array));
primitive.setAttribute('COLOR_0',acc('Fox_refined_source_coat','VEC3',new Float32Array(mesh.vertices.flatMap(v=>v.c))));
primitive.setAttribute('TEXCOORD_0',null);
const weights=mesh.vertices.map(v=>{const ws=[...v.weights];while(ws.length<4)ws.push([0,0]);return ws;});
primitive.setAttribute('JOINTS_0',acc('Fox_refined_joints','VEC4',new Uint16Array(weights.flatMap(ws=>ws.map(w=>w[0])))));
primitive.setAttribute('WEIGHTS_0',acc('Fox_refined_weights','VEC4',new Float32Array(weights.flatMap(ws=>ws.map(w=>w[1])))));
primitive.setIndices(acc('Fox_refined_triangles','SCALAR',new Uint32Array(mesh.triangles.flat())));

// Small almond surfaces sit directly on the subdivided source head. The head
// itself is the original Fox mesh; these details do not replace any anatomy.
const castMesh=new THREE.Mesh(geom,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));castMesh.updateMatrixWorld(true);
const eyePositions=[];
for(const sign of [-1,1]){
  const ray=new THREE.Raycaster(new THREE.Vector3(sign*25,61.4,50.3),new THREE.Vector3(-sign,0,0));
  const hit=ray.intersectObject(castMesh)[0];if(!hit)throw Error('Eye ray missed refined source head');
  const normal=hit.face.normal.clone();if(normal.x*sign<0)normal.negate();
  const centre=hit.point.clone().addScaledVector(normal,.025),horizontal=new THREE.Vector3(0,0,1).addScaledVector(normal,-normal.z).normalize();
  const vertical=new THREE.Vector3().crossVectors(horizontal,normal).normalize();if(vertical.y<0)vertical.negate();
  const ps=[],cs=[],ix=[],rings=[0,.30,.58,.82,1],cols=['#10120d','#272416','#ab7829','#29231b','#9d4d1d'];
  for(let r=0;r<rings.length;r++)for(let j=0;j<24;j++){
    const a=j/24*Math.PI*2,t=rings[r],p=centre.clone().addScaledVector(horizontal,Math.cos(a)*t*1.20).addScaledVector(vertical,Math.sin(a)*t*.72).addScaledVector(normal,.13*(1-t*t));
    ps.push(...p.toArray());cs.push(...new THREE.Color(cols[r]).toArray());
  }
  for(let r=0;r<rings.length-1;r++)for(let j=0;j<24;j++){const a=r*24+j,b=r*24+(j+1)%24,c=a+24,d=b+24;if(r===0)ix.push(a,d,c);else ix.push(a,b,c,b,d,c);}
  const eg=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(ps,3));eg.setIndex(ix);eg.computeVertexNormals();
  const joint=joints.findIndex(j=>j.getName()==='b_Head_05'),eyeMaterial=doc.createMaterial('Fox_seated_amber_eye').setRoughnessFactor(.39).setDoubleSided(true);
  const eye=doc.createPrimitive().setAttribute('POSITION',acc('eye_position','VEC3',new Float32Array(ps))).setAttribute('NORMAL',acc('eye_normal','VEC3',eg.attributes.normal.array))
    .setAttribute('COLOR_0',acc('eye_color','VEC3',new Float32Array(cs))).setAttribute('JOINTS_0',acc('eye_joints','VEC4',new Uint16Array(Array.from({length:ps.length/3},()=>[joint,0,0,0]).flat())))
    .setAttribute('WEIGHTS_0',acc('eye_weights','VEC4',new Float32Array(Array.from({length:ps.length/3},()=>[1,0,0,0]).flat())))
    .setIndices(acc('eye_indices','SCALAR',new Uint16Array(ix))).setMaterial(eyeMaterial);
  fox.getMesh().addPrimitive(eye);eyePositions.push({side:sign,centre:centre.toArray(),projectionDistance:.025,maximumDome:.13,joint:'b_Head_05'});
}
if(nativeHash(doc)!==beforeRigHash)throw Error('Native node/skin/animation data changed');
const outputBytes=Buffer.from(await io.writeBinary(doc));
await writeFile(new URL('Fox.adapted.glb',out),outputBytes);
const reread=await io.readBinary(outputBytes);if(nativeHash(reread)!==beforeRigHash)throw Error('Native data changed during serialization');

function audit(d){
  const r=d.getRoot(),nodes=r.listNodes(),rest=new Map(nodes.map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
  const caches=[];for(const node of nodes)for(const p of node.getMesh()?.listPrimitives()??[]){const skin=node.getSkin();caches.push({node,pos:p.getAttribute('POSITION'),js:p.getAttribute('JOINTS_0'),ws:p.getAttribute('WEIGHTS_0'),joints:skin.listJoints(),ibm:skin.listJoints().map((_,i)=>new THREE.Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i,[])))});}
  let invalidWeights=0;for(const c of caches)for(let i=0;i<c.pos.getCount();i++){const w=c.ws.getElement(i,[]);if(w.some(n=>!Number.isFinite(n)||n<0)||Math.abs(w.reduce((a,b)=>a+b,0)-1)>1e-5)invalidWeights++;}
  function pose(animation,time){
    const trs=new Map([...rest].map(([n,v])=>[n,{t:[...v.t],r:[...v.r],s:[...v.s]}]));
    if(animation)for(const c of animation.listChannels()){
      const sampler=c.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput();let i=0;while(i<times.length-2&&times[i+1]<time)i++;
      const f=clamp((time-times[i])/(times[i+1]-times[i]||1),0,1),a=values.getElement(i,[]),b=values.getElement(i+1,[]),key={translation:'t',rotation:'r',scale:'s'}[c.getTargetPath()];
      trs.get(c.getTargetNode())[key]=key==='r'?new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b),f).toArray():a.map((v,k)=>lerp(v,b[k],f));
    }
    const world=new Map(),visit=n=>{if(world.has(n))return world.get(n);const t=trs.get(n),m=new THREE.Matrix4().compose(new THREE.Vector3(...t.t),new THREE.Quaternion(...t.r),new THREE.Vector3(...t.s));if(n.getParentNode())m.premultiply(visit(n.getParentNode()));world.set(n,m);return m;};nodes.forEach(visit);
    const points=[];
    for(const c of caches){const mats=c.joints.map((j,i)=>world.get(j).clone().multiply(c.ibm[i]));for(let i=0;i<c.pos.getCount();i++){const p=new THREE.Vector3(...c.pos.getElement(i,[])),ws=c.ws.getElement(i,[]),js=c.js.getElement(i,[]),out=new THREE.Vector3();for(let k=0;k<4;k++)if(ws[k])out.addScaledVector(p.clone().applyMatrix4(mats[js[k]]),ws[k]);points.push(out);}}
    return points;
  }
  const bind=pose(null,0),box=new THREE.Box3().setFromPoints(bind),clips=[];
  for(const a of r.listAnimations()){
    const duration=Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray())));let min=Infinity,maxFloor=-Infinity,first,last,minimumAt;
    for(let i=0;i<=240;i++){const t=i*duration/240,points=pose(a,t);if(i===0)first=points;if(i===240)last=points;const lowest=Math.min(...points.map(p=>p.y));if(lowest<min){min=lowest;minimumAt=t;}maxFloor=Math.max(maxFloor,lowest);}
    clips.push({name:a.getName(),duration,samples:241,minimumY:min,maximumFrameMinimumY:maxFloor,minimumAt,loopMaxVertexDistance:Math.max(...first.map((p,i)=>p.distanceTo(last[i])))});
  }
  return {vertices:caches.reduce((n,c)=>n+c.pos.getCount(),0),triangles:r.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((a,p)=>a+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),invalidWeights,bindBounds:{min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray()},clips};
}
const before=audit(sourceDoc),after=audit(reread),provenance=JSON.parse(await readFile(new URL('provenance.json',originalURL),'utf8'));
const report={schema:1,originalSourceSha256:sourceHash,previewSourceSha256:sha(scaledBytes),adaptedSha256:sha(outputBytes),bytes:outputBytes.length,
  nativeRigSkinAnimationHashBefore:beforeRigHash,nativeRigSkinAnimationHashAfter:nativeHash(reread),nativeDataExactlyPreserved:true,
  modifications:['Welded face duplicates by position and skin weights; averaged source texture colours at shared vertices without exchanging orange/white/dark coat regions.','Three controlled Loop-subdivision rounds on the complete original mesh cage. Ear/nose planes and sole elevation receive minimal relaxation.','Widened existing weighted distal foot vertices and eased pointed forefoot ends.','Source colour regions converted to linear vertex colours with directional grizzle; smooth normals and rough coat.','Added two small surface-projected almond eye details on native Head joint.'],
  topology:{originalVertices:pos.getCount(),weldedVertices:weldedCount,reshapedFootVertices,subdivisionRounds:3},eyePositions,
  audit:{method:'241 CPU samples per native clip; original joint matrices and skinning; same 0.01 wrapper; floor y=0, no hidden contact offset.',before,after,
    penetrationChange:before.clips.map((c,i)=>({clip:c.name,beforeM:Math.max(0,-c.minimumY),afterM:Math.max(0,-after.clips[i].minimumY),increaseM:c.minimumY-after.clips[i].minimumY})),
    interpretation:'Expanded distal source vertices alter the physical sole envelope. Walk penetration grows about 3.83mm; Run grows about 0.57mm. This is a measured regression requiring native-rig contact repair if the adapted mesh is selected.'},
  missingProductionBehaviors:['Attack','Hit','HitLeft','HitRight','Death'],nativeGaitContactAccepted:false,hardwareAccepted:false,
  limitations:['Native Walk/Run already penetrate and float relative to y=0. Geometry adaptation does not repair those original motion targets.','Survey is a moving native observation clip, not a new idle alias.','Eye/coat/silhouette refinements have not yet been seen in hardware.','No combat/death aliases were created.'],attribution:provenance.attribution};
await writeFile(new URL('adaptation-review.json',out),JSON.stringify(report,null,2)+'\n');
const sourceCatalogue=JSON.parse(await readFile(new URL('scaled-catalogue.json',originalURL),'utf8')),asset={...sourceCatalogue.assets[0],sha256:sha(outputBytes),bytes:outputBytes.length,triangles:after.triangles,
  bounds:{min:after.bindBounds.min,max:after.bindBounds.max},size:Object.fromEntries(['x','y','z'].map((k,i)=>[k,after.bindBounds.size[i]])),
  base:Object.fromEntries(['x','y','z'].map((k,i)=>[k,after.bindBounds.min[i]])),groundY:after.bindBounds.min[1],
  sourceProvenance:{...sourceCatalogue.assets[0].sourceProvenance,modifications:report.modifications},reviewOnly:{nativeDataExactlyPreserved:true,missingProductionBehaviors:report.missingProductionBehaviors,contactAccepted:false,hardwareAccepted:false}};
await writeFile(new URL('catalogue.json',out),JSON.stringify({...sourceCatalogue,scope:'Whole licensed source Fox adaptation review only. Native gaits uncorrected; combat/death absent.',assets:[asset],files:{[asset.id]:'Fox.adapted.glb'}},null,2)+'\n');
await writeFile(new URL('README.md',out),`# Licensed Fox adaptation candidate\n\nThe complete Khronos source mesh is refined through controlled subdivision and local distal-vertex shaping. It remains on the exact original 24-joint rig, inverse binds and three native animations. The original snapshot in ../source-fox is untouched.\n\nCoat boundaries retain their source orange, white and dark meaning; vertex colour replaces the palette atlas. Small amber eye details sit on the source skull.\n\nNative contact is **not accepted**. Read adaptation-review.json for before/after floor penetration, animated bounds and loop errors. Widening the physical paws increases Walk penetration from 20.20 to 24.03 mm and Run from 37.33 to 37.89 mm. This needs native-rig correction if the mesh is selected. Survey/Walk/Run are the only clips. Attack, reactions and Death are absent. No visual or production acceptance is claimed.\n\nCredits: PixelMannen, model 2014, CC0-1.0; tomkranis, rigging/animation 2014, CC-BY-4.0; @AsoboStudio and @scurest, glTF conversion 2017, CC-BY-4.0. This adaptation modifies geometry, normals, colour/material and eye detail. Exact original license and provenance remain in ../source-fox.\n\nReproduce: node tools/creature-expansion/mammals/source-fox-adaptation.mjs\n`);
if(sha(await readFile(new URL('Fox.original.glb',originalURL)))!==sourceHash)throw Error('Original source mutated');
console.log(JSON.stringify({out:out.pathname,bytes:outputBytes.length,before,after,nativeDataExactlyPreserved:true,hardwareAccepted:false}));
