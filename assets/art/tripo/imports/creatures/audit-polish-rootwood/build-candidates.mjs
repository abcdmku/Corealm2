import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../../../..');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha=b=>createHash('sha256').update(b).digest('hex');
const generatorSha256=sha(await readFile(fileURLToPath(import.meta.url)));
const starrootOnly=process.argv.includes('--starroot-only');
const previousLab=starrootOnly?JSON.parse(await readFile(path.join(here,'lab-catalog.json'),'utf8')):null;
const previousCatalog=starrootOnly?JSON.parse(await readFile(path.join(here,'catalog.json'),'utf8')):null;
const specs=[
  {id:'creature_starroot_guardian',label:'Starroot Guardian',
    source:'assets/art/tripo/imports/creatures/audit-polish-rootwood/sources/creature_starroot_guardian.glb',
    map:'textures/starroot-deepwood-generated-v2.png',atlas:'textures/starroot-guardian-basecolor-v2-2k.jpg',
    blend:.64,scale:1.28,headScale:1,
    originalSource:'assets/art/tripo/exports/121e4591-e66b-4803-bf39-802fa7bdb392.glb',
    originalSourceSha256:'e031c4ec0d7d128576d59adced8b63de217e3f0e81da32de32aebc4946543c47',
    sourceCatalog:'assets/art/tripo/imports/creatures/starred-sheet-c/parts/03-woodland-antler-demon/catalog.json',
    destination:'models/fairy-crown/creature_starroot_guardian.glb',
    note:'High-contrast guardian bark, deep purple-blue fissures, jade moss, amber flowers and turquoise sap over the accepted branch-antler source; height lifted for level 106.'},
  {id:'creature_briar_harrow',label:'Bramble Tiller',
    source:'assets/art/tripo/imports/creatures/audit-polish-rootwood/sources/creature_briar_harrow.glb',
    map:'textures/briar-orchard-generated.png',atlas:'textures/briar-tiller-basecolor-2k.jpg',
    blend:.67,scale:.76,headScale:.82,
    originalSource:'assets/art/tripo/imports/creatures/bramble-tiller-t10/sources/creature_briar_harrow-2663d6ba545d.glb',
    originalSourceSha256:'2663d6ba545d0ceea22059a45f0b269384b9f0df1b56bb6f435ed7a2c1e60e12',
    sourceCatalog:'assets/art/tripo/imports/creatures/bramble-tiller-t10/catalog.json',
    destination:'models/creature/creature_briar_harrow.glb',
    note:'Orchard roots, fresh bramble leaves and berry detail over accepted bark; smaller head and overall size reduce human and boss reading at level 13.'},
];
const assets=[],files={},records=[];
await mkdir(path.join(here,'models'),{recursive:true});
for(const spec of specs){
  if(starrootOnly&&spec.id!=='creature_starroot_guardian'){
    const asset=previousLab.assets.find(a=>a.id===spec.id);
    const record=previousCatalog.records.find(r=>r.id===spec.id);
    if(!asset||!record)throw Error('Briar candidate missing for preservation');
    const bytes=await readFile(path.join(here,asset.candidateFile));
    if(sha(bytes)!==asset.sha256)throw Error('Briar candidate differs from pinned hash');
    assets.push(asset);files[spec.id]=asset.candidateFile;records.push(record);
    continue;
  }
  const sourceBytes=await readFile(path.join(repo,spec.source));
  const doc=await io.readBinary(sourceBytes);
  const root=doc.getRoot(),scene=root.listScenes()[0];
  const meshNode=root.listNodes().find(n=>n.getMesh()&&n.getSkin());
  const primitive=meshNode?.getMesh().listPrimitives()[0],skin=meshNode?.getSkin();
  const material=primitive?.getMaterial();
  if(!scene||!meshNode||!primitive||!skin||!material||root.listSkins().length!==1)throw Error(spec.id+': source mesh/skin changed');
  const attrs=['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'];
  const accessorSha=a=>sha(Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength));
  const geometry=Object.fromEntries(attrs.map(k=>[k,accessorSha(primitive.getAttribute(k))]));
  geometry.indices=accessorSha(primitive.getIndices());
  const sourceColor=material.getBaseColorTexture(),normal=material.getNormalTexture(),roughness=material.getMetallicRoughnessTexture();
  if(!sourceColor||!normal||!roughness)throw Error(spec.id+': source PBR maps missing');
  const normalSha=sha(normal.getImage()),roughnessSha=sha(roughness.getImage()),sourceColorSha=sha(sourceColor.getImage());
  let candidateRoughnessSha=roughnessSha;
  if(spec.id==='creature_starroot_guardian'){
    const {data,info}=await sharp(roughness.getImage()).raw().toBuffer({resolveWithObject:true});
    if(info.channels!==3)throw Error('Starroot roughness map channel layout changed');
    // glTF roughness lives in G. The accepted source averaged 114/255, too glossy for bark.
    // Raise G into a matte range while retaining the source's spatial roughness variation.
    for(let i=0;i<data.length;i+=3)data[i+1]=Math.min(255,Math.round(160+data[i+1]*.45));
    const matte=await sharp(data,{raw:{width:info.width,height:info.height,channels:3}}).png().toBuffer();
    await writeFile(path.join(here,'textures/starroot-guardian-matte-orm-v3.png'),matte);
    roughness.setImage(matte).setMimeType('image/png').setName('starroot_guardian_matte_wood_orm');
    material.setMetallicFactor(0).setRoughnessFactor(1);
    candidateRoughnessSha=sha(matte);
  }
  const old=await sharp(sourceColor.getImage()).resize(2048,2048).ensureAlpha().raw().toBuffer();
  const tile=await sharp(path.join(here,spec.map)).resize(2048,2048).ensureAlpha().raw().toBuffer();
  const blended=Buffer.alloc(old.length);
  for(let i=0;i<old.length;i+=4){
    // Preserve the accepted UV atlas's baked form while placing image-generated detail in every island.
    const r=old[i],g=old[i+1],b=old[i+2];
    const green=g>r*1.12&&g>b*1.1;
    const a=green?spec.blend*.65:spec.blend;
    for(let c=0;c<3;c++)blended[i+c]=Math.round(old[i+c]*(1-a)+tile[i+c]*a);
    blended[i+3]=255;
  }
  const color=await sharp(blended,{raw:{width:2048,height:2048,channels:4}})
    .removeAlpha().jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
  await writeFile(path.join(here,spec.atlas),color);
  sourceColor.setImage(color).setMimeType('image/jpeg').setName(spec.id+'_imagegen_layered_basecolor');
  // entityViews exempts image-authored Tripo materials from the tier-metal swatch by name.
  // Keep that source family prefix or a level-106 guardian turns blue-violet in game.
  material.setName(spec.id==='creature_starroot_guardian'
    ?'Material_tripo_starroot_guardian_layered_rootwood'
    :spec.id+'_layered_rootwood');
  const sceneRoot=scene.listChildren()[0];
  sceneRoot.setScale(sceneRoot.getScale().map(v=>v*spec.scale));
  if(spec.headScale!==1){
    const head=root.listNodes().find(n=>/[:]?Head$/.test(n.getName()));
    if(!head)throw Error(spec.id+': no head bone');
    head.setScale([spec.headScale,spec.headScale,spec.headScale]);
  }
  const clips=root.listAnimations().map(a=>a.getName());
  const expected=spec.id==='creature_starroot_guardian'
    ?['Idle','Walk','Run','Attack','Hit','Death']
    :['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'];
  if(JSON.stringify(clips)!==JSON.stringify(expected))throw Error(spec.id+': clips changed');
  const duration=name=>{
    const a=root.listAnimations().find(a=>a.getName()===name);
    return Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray())));
  };
  const contact=measureAttackContact(root,duration('Attack'));
  const bounds=measureBounds(primitive,meshNode);
  const candidateBytes=await io.writeBinary(doc);
  const output='models/'+spec.id+'.glb';
  await writeFile(path.join(here,output),candidateBytes);
  const verify=(await io.readBinary(candidateBytes)).getRoot();
  const check=verify.listNodes().find(n=>n.getMesh()&&n.getSkin())?.getMesh().listPrimitives()[0];
  for(const k of attrs)if(accessorSha(check.getAttribute(k))!==geometry[k])throw Error(spec.id+': '+k+' changed');
  if(accessorSha(check.getIndices())!==geometry.indices)throw Error(spec.id+': topology changed');
  if(sha(check.getMaterial().getNormalTexture().getImage())!==normalSha||sha(check.getMaterial().getMetallicRoughnessTexture().getImage())!==candidateRoughnessSha)throw Error(spec.id+': candidate PBR differs from pinned map');
  if(spec.id==='creature_starroot_guardian'&&(check.getMaterial().getMetallicFactor()!==0||check.getMaterial().getRoughnessFactor()!==1))throw Error('Starroot dielectric bark factors changed');
  if(JSON.stringify(verify.listAnimations().map(a=>a.getName()))!==JSON.stringify(clips))throw Error(spec.id+': clip roundtrip changed');
  const size=Object.fromEntries(['x','y','z'].map((k,i)=>[k,bounds.max[i]-bounds.min[i]]));
  const base=Object.fromEntries(['x','y','z'].map((k,i)=>[k,bounds.min[i]]));
  const asset={id:spec.id,file:spec.destination,candidateFile:output,pack:'corealm-tripo-audit-polish-rootwood',
    category:'character',is:spec.label,tags:['creature','rootwood','tripo','candidate'],
    bytes:candidateBytes.length,sha256:sha(candidateBytes),
    triangles:primitive.getIndices().getCount()/3,size,base,groundY:bounds.min[1],
    animations:clips,materials:verify.listMaterials().map(m=>m.getName()),
    walkClipSeconds:duration('Walk'),runClipSeconds:duration('Run'),attackSeconds:duration('Attack'),
    contactNormalized:contact.fraction,
    impliedWalkMps:null,impliedRunMps:null,measuredGait:null,locomotionPolicy:null,
    sourceProvenance:{generator:'Tripo Studio',license:'LicenseRef-Corealm-Original',
      sourceFile:spec.source,sourceSha256:sha(sourceBytes),sourceBaseColorSha256:sourceColorSha,
      originalSourceFile:spec.originalSource,originalSourceSha256:spec.originalSourceSha256,sourceCatalog:spec.sourceCatalog,
      sourceNormalSha256:normalSha,sourceMetallicRoughnessSha256:roughnessSha,
      candidateMetallicRoughnessSha256:candidateRoughnessSha,
      authoredMaterialName:material.getName(),
      sourceGeometrySha256:geometry,sourceTriangles:primitive.getIndices().getCount()/3,
      rigJoints:skin.listJoints().length,imagegenMap:spec.map,imagegenMapSha256:sha(await readFile(path.join(here,spec.map))),
      blendedAtlas:spec.atlas,blendedAtlasSha256:sha(color),generatorSha256,
      modifications:spec.note+(spec.id==='creature_starroot_guardian'
        ?' Image-authored Tripo material prefix protects the bark from level-106 tier-metal tint; dielectric metallic factor 0; source ORM roughness channel remapped to matte bark while retaining its variation; original normal and native clips preserved.'
        :' Source geometry, UV, skin weights, normal/roughness and native clips preserved.')},
    metadata:{role:spec.note,uniformScaleMultiplier:spec.scale,headScaleMultiplier:spec.headScale,
      contactMethod:'Peak forward hand reach relative to hips over 41 sampled Attack frames; pending lab contact review'},
    acceptance:{cpuMotionChecked:true,labAccepted:false,worldIntegrated:false}};
  assets.push(asset);files[spec.id]=output;
  records.push({id:spec.id,source:spec.source,sourceSha256:sha(sourceBytes),candidate:output,
    candidateSha256:sha(candidateBytes),bounds,animationDurations:Object.fromEntries(clips.map(n=>[n,duration(n)])),
    attackContact:contact,geometry,sourceNormalSha256:normalSha,sourceMetallicRoughnessSha256:roughnessSha,candidateMetallicRoughnessSha256:candidateRoughnessSha,
    status:'pending-root-feature-lab-review'});
}
const pack={id:'corealm-tripo-audit-polish-rootwood',name:'Rootwood polish candidates',author:'Corealm',
  source:'assets/art/tripo/imports/creatures/audit-polish-rootwood/build-candidates.mjs',
  license:'LicenseRef-Corealm-Original',generatorSha256};
await writeFile(path.join(here,'lab-catalog.json'),JSON.stringify({schema:'corealm-lab-asset-candidates/1',pack,assets,files},null,2)+'\n');
await writeFile(path.join(here,'promotion.json'),JSON.stringify({schema:'corealm-promoted-asset-candidates/1',pack,
  generatorSha256,assets,status:'pending-root-lab-acceptance',
  recommendations:[
    {id:'creature_starroot_guardian',preset:'starroot_guardian_t60',tier:106,scale:'Candidate height '+assets[0].size.y.toFixed(2)+' m; verify authored runtime scale and presence in lab before integration.'},
    {id:'creature_briar_harrow',preset:'briar_harrow_t10',tier:13,scale:'Candidate height '+assets[1].size.y.toFixed(2)+' m; preserve lower-tier gameplay speed and collision after visual size review.'}
  ]},null,2)+'\n');
await writeFile(path.join(here,'catalog.json'),JSON.stringify({schema:'corealm-rootwood-polish/1',pack,records},null,2)+'\n');
console.log(JSON.stringify(assets.map(a=>({id:a.id,file:a.candidateFile,sha:a.sha256,size:a.size,animations:a.animations,attackSeconds:a.attackSeconds,contactNormalized:a.contactNormalized})),null,2));

function measureAttackContact(root,seconds){
  const attack=root.listAnimations().find(a=>a.getName()==='Attack');
  const joints=root.listNodes();
  const hand=joints.find(n=>/RightHand$/.test(n.getName()));
  const hips=joints.find(n=>/Hips$/.test(n.getName()));
  if(!hand||!hips)throw Error('Attack contact joints missing');
  const rest=new Map(joints.map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
  let best={fraction:0,forward:-Infinity};
  for(let frame=1;frame<=28;frame++){
    const fraction=frame/40,time=seconds*fraction;
    for(const [n,p] of rest)n.setTranslation(p.t).setRotation(p.r).setScale(p.s);
    for(const ch of attack.listChannels()){
      const sampler=ch.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray();
      const kind=ch.getTargetPath(),stride=kind==='rotation'?4:3;
      let k=0;while(k<times.length-2&&times[k+1]<time)k++;
      const u=times[k+1]>times[k]?(time-times[k])/(times[k+1]-times[k]):0;
      let v;
      if(kind==='rotation')v=new Quaternion(...values.slice(k*stride,k*stride+4))
        .slerp(new Quaternion(...values.slice((k+1)*stride,(k+1)*stride+4)),u).toArray();
      else v=Array.from({length:stride},(_,i)=>values[k*stride+i]*(1-u)+values[(k+1)*stride+i]*u);
      if(kind==='rotation')ch.getTargetNode().setRotation(v);
      else if(kind==='translation')ch.getTargetNode().setTranslation(v);
      else if(kind==='scale')ch.getTargetNode().setScale(v);
    }
    const forward=-(hand.getWorldMatrix()[14]-hips.getWorldMatrix()[14]);
    if(forward>best.forward)best={fraction,forward};
  }
  for(const [n,p] of rest)n.setTranslation(p.t).setRotation(p.r).setScale(p.s);
  return best;
}

function measureBounds(primitive,node){
  const a=primitive.getAttribute('POSITION'),v=[],p=new Vector3();
  const m=new Matrix4().fromArray(node.getWorldMatrix());
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.getCount();i++){
    a.getElement(i,v);p.set(v[0],v[1],v[2]).applyMatrix4(m);
    for(let j=0;j<3;j++){min[j]=Math.min(min[j],p.getComponent(j));max[j]=Math.max(max[j],p.getComponent(j));}
  }
  return {min,max};
}
