import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';

// Stage and inspect the unchanged official source only. No production export.
const out=new URL('../../../art/rebuild/candidates/finish-quadrupeds/source-fox/',import.meta.url);
const repo='KhronosGroup/glTF-Sample-Assets';
const repositoryUrl=`https://github.com/${repo}/tree/main/Models/Fox`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const get=async url=>{const response=await fetch(url,{headers:{'User-Agent':'Corealm-source-evaluation'}});if(!response.ok)throw Error(`${response.status}: ${url}`);return Buffer.from(await response.arrayBuffer());};
await mkdir(out,{recursive:true});
let provenance;
if(process.argv.includes('--download')){
  const commit=JSON.parse((await get(`https://api.github.com/repos/${repo}/commits?path=Models/Fox&per_page=1`)).toString())[0].sha;
  const files=[];
  for(const [source,file] of [['glTF-Binary/Fox.glb','Fox.original.glb'],['LICENSE.md','LICENSE.original.md'],['README.md','README.original.md'],['metadata.json','metadata.original.json'],['screenshot/screenshot.jpg','preview.original.jpg']]){
    const url=`https://raw.githubusercontent.com/${repo}/${commit}/Models/Fox/${source}`,bytes=await get(url);
    await writeFile(new URL(file,out),bytes);files.push({file,url,bytes:bytes.length,sha256:sha(bytes)});
  }
  provenance={repositoryUrl,commit,downloadedAt:new Date().toISOString(),unchangedSource:true,files,
    attribution:[{author:'PixelMannen',work:'Model',year:2014,license:'CC0-1.0',url:'https://creativecommons.org/publicdomain/zero/1.0/legalcode'},
      {author:'tomkranis',work:'Rigging & Animation',year:2014,license:'CC-BY-4.0',url:'https://creativecommons.org/licenses/by/4.0/legalcode'},
      {author:'@AsoboStudio and @scurest',work:'Conversion to glTF',year:2017,license:'CC-BY-4.0',url:'https://creativecommons.org/licenses/by/4.0/legalcode'}]};
  await writeFile(new URL('provenance.json',out),JSON.stringify(provenance,null,2)+'\n');
}else provenance=JSON.parse(await readFile(new URL('provenance.json',out),'utf8'));
const bytes=await readFile(new URL('Fox.original.glb',out));
if(sha(bytes)!==provenance.files.find(f=>f.file==='Fox.original.glb').sha256)throw Error('Source hash mismatch');
const doc=await new NodeIO().readBinary(bytes),root=doc.getRoot(),bounds=new THREE.Box3();
const meshes=[];let nonfinite=0,invalidWeights=0;
for(const node of root.listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){
  const positions=p.getAttribute('POSITION'),weights=p.getAttribute('WEIGHTS_0'),joints=p.getAttribute('JOINTS_0'),matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for(let i=0;i<positions.getCount();i++){
    const v=positions.getElement(i,[]);bounds.expandByPoint(new THREE.Vector3(...v).applyMatrix4(matrix));
    if(!v.every(Number.isFinite))nonfinite++;
    if(weights){const w=weights.getElement(i,[]);if(w.some(x=>!Number.isFinite(x)||x<0)||Math.abs(w.reduce((a,b)=>a+b,0)-1)>.002)invalidWeights++;}
    if(joints&&node.getSkin()){const js=joints.getElement(i,[]);if(js.some(x=>x<0||x>=node.getSkin().listJoints().length))throw Error('Joint index out of range');}
  }
  meshes.push({node:node.getName(),mesh:node.getMesh().getName(),vertices:positions.getCount(),triangles:(p.getIndices()?.getCount()??positions.getCount())/3,skinned:!!node.getSkin(),attributes:p.listSemantics(),material:p.getMaterial()?.getName()});
}
const clips=root.listAnimations().map(a=>{
  const channels=a.listChannels().map(c=>{const sampler=c.getSampler(),times=sampler.getInput().getArray(),output=sampler.getOutput(),n=output.getCount();return {node:c.getTargetNode().getName(),path:c.getTargetPath(),interpolation:sampler.getInterpolation(),frames:times.length,duration:Math.max(...times),start:output.getElement(0,[]),end:output.getElement(n-1,[])};});
  return {name:a.getName(),duration:Math.max(...channels.map(c=>c.duration)),channelCount:channels.length,channels};
});
const dimensions=bounds.getSize(new THREE.Vector3()).toArray();
const report={sourceSha256:sha(bytes),sourceUnmodified:true,meshes,
  geometry:{vertices:meshes.reduce((s,m)=>s+m.vertices,0),triangles:meshes.reduce((s,m)=>s+m.triangles,0),nonfinite,invalidWeights},
  bindPoseBounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),dimensions,units:'native source units; production scale not yet chosen',note:'Node-transformed source positions, not an animated or posed visual measurement.'},
  skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(j=>({name:j.getName(),translation:j.getTranslation(),worldPosition:j.getWorldMatrix().slice(12,15)}))})),
  materials:root.listMaterials().map(m=>({name:m.getName(),baseColorFactor:m.getBaseColorFactor(),roughness:m.getRoughnessFactor(),metallic:m.getMetallicFactor(),texture:m.getBaseColorTexture()?.getName()})),
  textures:root.listTextures().map(t=>({name:t.getName(),mime:t.getMimeType(),bytes:t.getImage()?.length})),
  nativeClips:clips,
  missingProductionBehaviors:['Attack','Hit','HitLeft','HitRight','Death'],
  integrationNotes:['Survey must be evaluated as idle behavior before mapping.','Walk and Run are original authored source clips; foot contact still needs production state/temporal proof.','Missing combat/death clips require new authored motion, never aliases.','Preserve complete source body and rig; no hybrid head graft.','Choose production scale and root orientation only after whole-source visual review.'],
  acceptance:{officialPreviewInspected:false,hardwareLabReviewed:false,productionConverted:false,accepted:false}};
await writeFile(new URL('source-inspection.json',out),JSON.stringify(report,null,2)+'\n');
if(process.argv.includes('--stage-catalogue')){
  const pack={id:'khronos-fox-source-review',name:'Khronos complete Fox source review',author:'PixelMannen; tomkranis; @AsoboStudio and @scurest',source:repositoryUrl,license:'CC0-1.0 model; CC-BY-4.0 rigging, animation and conversion',archiveSha256:sha(bytes)};
  const xyz=a=>({x:a[0],y:a[1],z:a[2]});
  const entry=(file,data,scale)=>({id:'creature_redbrush_fox',file,pack:pack.id,category:'character',is:'fox',tags:['animal','fox','skinned','source-review'],
    bytes:data.length,sha256:sha(data),size:xyz(dimensions.map(v=>v*scale)),base:xyz(bounds.min.toArray().map(v=>v*scale)),
    bounds:{min:bounds.min.toArray().map(v=>v*scale),max:bounds.max.toArray().map(v=>v*scale)},groundY:bounds.min.y*scale,
    animations:clips.map(c=>c.name),materials:report.materials.map(m=>m.name),triangles:report.geometry.triangles,
    walkClipSeconds:clips.find(c=>c.name==='Walk').duration,runClipSeconds:clips.find(c=>c.name==='Run').duration,
    sourceProvenance:{repositoryUrl,commit:provenance.commit,sourceSha256:sha(bytes),attribution:provenance.attribution,modifications:scale===1?'None; exact original source bytes.':'Added uniform 0.01 scene-root scale only. Geometry, skin, texture and native animation data preserved; no renaming or new clips.'},
    reviewOnly:{sourceUnits:scale===1?'native source units':'source units multiplied by 0.01',scaleApplied:scale,orientationChange:false,idlePlayback:'Production idle resolver falls back to first own clip Survey; hardware gallery verified actual Survey playback. This is not a static bind pose.',missingProductionBehaviors:report.missingProductionBehaviors,groundYIsBindBounds:true}});
  const raw=entry('models/creature/creature_redbrush_fox.glb',bytes,1);
  await writeFile(new URL('raw-catalogue.json',out),JSON.stringify({schema:1,scope:'Exact source bytes at native size. NOT metre normalized; use scaled-catalogue for normal production gallery framing.',pack,assets:[raw],files:{[raw.id]:'Fox.original.glb'}},null,2)+'\n');
  // The production loader does not normalize from registered height. Add a
  // common ancestor around every source scene child so joints and mesh share
  // the same scale. No animation target or inverse-bind matrix is changed.
  const payloadHash=()=>{const h=createHash('sha256');for(const a of root.listAccessors()){const values=a.getArray();if(values)h.update(Buffer.from(values.buffer,values.byteOffset,values.byteLength));}for(const t of root.listTextures()){if(t.getImage())h.update(t.getImage());}return h.digest('hex');};
  const before=payloadHash();
  for(const scene of root.listScenes()){
    const wrapper=doc.createNode('Fox_Source_UniformScale_001').setScale([.01,.01,.01]);
    for(const child of [...scene.listChildren()]){scene.removeChild(child);wrapper.addChild(child);}
    scene.addChild(wrapper);
  }
  const previewBytes=Buffer.from(await new NodeIO().writeBinary(doc));
  if(before!==payloadHash())throw Error('Source payload changed while wrapping scale');
  await writeFile(new URL('Fox.preview-scale001.glb',out),previewBytes);
  const scaled=entry('models/creature/creature_redbrush_fox.glb',previewBytes,.01);
  await writeFile(new URL('scaled-catalogue.json',out),JSON.stringify({schema:1,scope:'Whole native Fox preview, uniform 0.01 root scale only. Original source preserved separately. No production acceptance or promotion.',pack,assets:[scaled],files:{[scaled.id]:'Fox.preview-scale001.glb'}},null,2)+'\n');
  await writeFile(new URL('scale-proof.json',out),JSON.stringify({sourceSha256:sha(bytes),previewSha256:sha(previewBytes),uniformScale:.01,rotationY:0,accessorAndTexturePayloadSha256:before,payloadUnchanged:true,clipNamesUnchanged:root.listAnimations().map(a=>a.getName()),productionLoaderReferences:['game/src/render/assets.ts:598 loads scene unchanged','game/src/featureLab/catalog.ts:276 viewScale comes from content, not asset height','game/src/render/entityViews.ts:2248 applies view scale and tier silhouette only'],note:'Manifest size records bounds and collision dimensions; it cannot rescale GLB geometry. The scale-only preview wrapper is necessary for a metre-sized animal in the existing gallery.'},null,2)+'\n');
}
console.log(JSON.stringify({out:out.pathname,commit:provenance.commit,sha256:report.sourceSha256,geometry:report.geometry,bounds:report.bindPoseBounds,clips:clips.map(({name,duration,channelCount})=>({name,duration,channelCount})),jointCount:report.skins.map(s=>s.joints.length)}));
if(process.argv.includes('--gait'))await inspectNativeGait();

async function inspectNativeGait(){
  const preview=await readFile(new URL('Fox.preview-scale001.glb',out));
  const d=await new NodeIO().readBinary(preview),rt=d.getRoot(),nodes=rt.listNodes();
  const rest=new Map(nodes.map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
  const feet=[
    {id:'foreRight',bone:'b_RightHand_08',region:['b_RightHand_08']},
    {id:'foreLeft',bone:'b_LeftHand_011',region:['b_LeftHand_011']},
    {id:'hindLeft',bone:'b_LeftFoot02_018',region:['b_LeftFoot01_017','b_LeftFoot02_018']},
    {id:'hindRight',bone:'b_RightFoot02_022',region:['b_RightFoot01_021','b_RightFoot02_022']},
  ];
  const meshes=[];
  for(const node of nodes)for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const skin=node.getSkin();if(!skin)throw Error('Expected whole Fox mesh to be skinned');
    const joints=skin.listJoints(),inv=skin.getInverseBindMatrices();
    meshes.push({node,joints,ibm:joints.map((_,i)=>new THREE.Matrix4().fromArray(inv.getElement(i,[]))),
      pos:primitive.getAttribute('POSITION'),indices:primitive.getAttribute('JOINTS_0'),weights:primitive.getAttribute('WEIGHTS_0')});
  }
  const channels=a=>a.listChannels().map(c=>({node:c.getTargetNode(),path:c.getTargetPath(),sampler:c.getSampler()}));
  function pose(a,time){
    const trs=new Map([...rest].map(([n,v])=>[n,{t:[...v.t],r:[...v.r],s:[...v.s]}]));
    if(a)for(const c of channels(a)){
      if(c.sampler.getInterpolation()!=='LINEAR')throw Error('Only source LINEAR interpolation is implemented');
      const times=c.sampler.getInput().getArray(),output=c.sampler.getOutput();
      let i=0;while(i<times.length-2&&times[i+1]<time)i++;
      const t=THREE.MathUtils.clamp((time-times[i])/(times[i+1]-times[i]||1),0,1),aa=output.getElement(i,[]),bb=output.getElement(i+1,[]);
      const value=c.path==='rotation'?new THREE.Quaternion(...aa).slerp(new THREE.Quaternion(...bb),t).toArray():aa.map((v,k)=>v+(bb[k]-v)*t);
      const key={rotation:'r',translation:'t',scale:'s'}[c.path];if(!key)throw Error(`Unhandled ${c.path}`);trs.get(c.node)[key]=value;
    }
    const world=new Map();
    const visit=n=>{if(world.has(n))return world.get(n);const v=trs.get(n),local=new THREE.Matrix4().compose(new THREE.Vector3(...v.t),new THREE.Quaternion(...v.r),new THREE.Vector3(...v.s));const parent=n.getParentNode();if(parent)local.premultiply(visit(parent));world.set(n,local);return local;};
    nodes.forEach(visit);
    const points=[];
    for(const mesh of meshes){
      const mats=mesh.joints.map((j,i)=>world.get(j).clone().multiply(mesh.ibm[i]));
      for(let i=0;i<mesh.pos.getCount();i++){
        const original=new THREE.Vector3(...mesh.pos.getElement(i,[])),js=mesh.indices.getElement(i,[]),ws=mesh.weights.getElement(i,[]),p=new THREE.Vector3();
        js.forEach((j,k)=>{if(ws[k])p.addScaledVector(original.clone().applyMatrix4(mats[j]),ws[k]);});
        points.push({p,weights:js.map((j,k)=>[mesh.joints[j].getName(),ws[k]])});
      }
    }
    return {points,world};
  }
  const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.floor((a.length-1)*q)]:null;};
  const initial=pose(null,0);
  let bindCheckIndex=0,bindReconstructionMaxError=0;
  for(const mesh of meshes)for(let i=0;i<mesh.pos.getCount();i++){
    const expected=new THREE.Vector3(...mesh.pos.getElement(i,[])).applyMatrix4(initial.world.get(mesh.node));
    bindReconstructionMaxError=Math.max(bindReconstructionMaxError,expected.distanceTo(initial.points[bindCheckIndex++].p));
  }
  if(bindReconstructionMaxError>1e-4)throw Error(`Bind reconstruction mismatch: ${bindReconstructionMaxError}`);
  // Select vertices by actual distal weights, then keep each foot's bottom
  // bind-pose band. These same physical vertices are tracked in every frame.
  const regions=feet.map(f=>{
    const candidates=initial.points.map((v,i)=>({i,y:v.p.y,w:v.weights.reduce((s,[name,w])=>s+(f.region.includes(name)?w:0),0)})).filter(v=>v.w>=.5);
    if(!candidates.length)throw Error(`No weighted foot vertices for ${f.id}`);
    const min=Math.min(...candidates.map(v=>v.y));
    return {...f,vertices:candidates.filter(v=>v.y<=min+.025).map(v=>v.i),bindMinY:min};
  });
  const results=[];
  for(const a of rt.listAnimations()){
    const duration=Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),count=240,dt=duration/count,samples=[];
    let first,last;
    for(let i=0;i<=count;i++){
      const time=i*dt,current=pose(a,time);if(i===0)first=current;if(i===count)last=current;
      const ys=current.points.map(v=>v.p.y);
      samples.push({time,wholeMinY:Math.min(...ys),wholeMaxY:Math.max(...ys),feet:regions.map(f=>{
        const pts=f.vertices.map(i=>current.points[i].p),mean=pts.reduce((s,p)=>s.add(p),new THREE.Vector3()).multiplyScalar(1/pts.length);
        const bone=nodes.find(n=>n.getName()===f.bone),bp=new THREE.Vector3().setFromMatrixPosition(current.world.get(bone));
        return {id:f.id,minY:Math.min(...pts.map(v=>v.y)),maxY:Math.max(...pts.map(v=>v.y)),centroid:mean.toArray(),bonePosition:bp.toArray()};
      })});
    }
    const footMeasures=regions.map((f,fi)=>{
      const ys=samples.map(s=>s.feet[fi].minY),minY=Math.min(...ys),heightBand=minY+.015;
      const velocities=[];
      for(let i=1;i<samples.length;i++){
        const prev=samples[i-1].feet[fi],cur=samples[i].feet[fi];
        const vy=(cur.centroid[1]-prev.centroid[1])/dt;
        if(prev.minY<=heightBand&&cur.minY<=heightBand&&Math.abs(vy)<=.15){
          const vx=(cur.centroid[0]-prev.centroid[0])/dt,vz=(cur.centroid[2]-prev.centroid[2])/dt;
          velocities.push({time:samples[i].time,vx,vy,vz,backwardMps:-vz});
        }
      }
      const speeds=velocities.map(v=>v.backwardMps),slips=velocities.filter(v=>v.backwardMps<-.025).length;
      return {id:f.id,bone:f.bone,soleVertexCount:f.vertices.length,minY,maxY:Math.max(...ys),
        centroidStrideZ:Math.max(...samples.map(s=>s.feet[fi].centroid[2]))-Math.min(...samples.map(s=>s.feet[fi].centroid[2])),
        stanceDefinition:'Fixed distal-weighted bottom vertices; consecutive sole minima within 15mm of per-foot clip minimum and centroid vertical speed <=0.15m/s. Candidate stance, not an external ground-truth contact label.',
        stanceSampleCount:speeds.length,stanceBackwardMps:{p10:quantile(speeds,.1),median:quantile(speeds,.5),p90:quantile(speeds,.9)},forwardDuringCandidateStance:slips,velocitySamples:velocities};
    });
    const deltas=first.points.map((v,i)=>v.p.distanceTo(last.points[i].p));
    results.push({name:a.getName(),duration,sampleIntervals:count,dt,wholeMesh:{minimumY:Math.min(...samples.map(s=>s.wholeMinY)),maximumY:Math.max(...samples.map(s=>s.wholeMaxY)),floorMinimumRange:[Math.min(...samples.map(s=>s.wholeMinY)),Math.max(...samples.map(s=>s.wholeMinY))]},
      loopEndpoint:{maxVertexDistance:Math.max(...deltas),rmsVertexDistance:Math.sqrt(deltas.reduce((s,v)=>s+v*v,0)/deltas.length)},feet:footMeasures,samples});
  }
  const head=nodes.find(n=>n.getName()==='b_Head_05'),tail=nodes.find(n=>n.getName()==='b_Tail03_014');
  const report={sourceSha256:sha(bytes),previewSha256:sha(preview),method:'CPU glTF LINEAR channel interpolation and full weighted skinning: jointWorld * inverseBind * sourceVertex. Uniform 0.01 wrapper included. 241 samples per native clip. No animation or geometry edits.',
    orientation:{up:'+Y',forward:'+Z',headPosition:new THREE.Vector3().setFromMatrixPosition(initial.world.get(head)).toArray(),tailTipBonePosition:new THREE.Vector3().setFromMatrixPosition(initial.world.get(tail)).toArray(),backwardStanceSign:'negative world Z in unrotated source'},
    bindReconstructionMaxError,feet:regions,clips:results,limitations:['Candidate stance thresholds infer contact from source motion; they do not prove actual production floor placement or sliding against runtime travel.','Survey is a moving observation cycle, not a proven settled idle.','Per-foot minima differ; do not assume one floor offset fixes all soles.','No locomotion speed metadata was written. No missing clips were aliased.'],hardwareAccepted:false};
  await writeFile(new URL('native-gait.json',out),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({nativeGait:results.map(c=>({name:c.name,wholeMesh:c.wholeMesh,loopEndpoint:c.loopEndpoint,feet:c.feet.map(({id,soleVertexCount,minY,maxY,stanceSampleCount,stanceBackwardMps,forwardDuringCandidateStance})=>({id,soleVertexCount,minY,maxY,stanceSampleCount,stanceBackwardMps,forwardDuringCandidateStance}))}))}));
}
