import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

const dir='assets/art/tripo/imports/creatures/audit-polish-zombies';
const builder=`${dir}/build-candidates.mjs`;
const builderSha256=hash(await readFile(builder));
const manifest=JSON.parse(await readFile(`${dir}/source-manifest.json`,'utf8'));
const io=new NodeIO();
const ids=['creature_plague_zombie','creature_zombie'];
const texturePrefix={creature_plague_zombie:'plague',creature_zombie:'zombie'};
const entries=[];
const promotions=[];

function hash(data){return createHash('sha256').update(data).digest('hex');}
function duration(animation){
  return Math.max(...animation.listSamplers().map(s=>Math.max(...s.getInput().getArray())));
}
function digest(accessor){
  if(!accessor)return null;
  const array=accessor.getArray();
  return hash(Buffer.from(array.buffer,array.byteOffset,array.byteLength));
}
function signature(root){
  return {
    meshes:root.listMeshes().map(mesh=>mesh.listPrimitives().map(p=>({
      position:digest(p.getAttribute('POSITION')),normal:digest(p.getAttribute('NORMAL')),
      uv:digest(p.getAttribute('TEXCOORD_0')),joints:digest(p.getAttribute('JOINTS_0')),
      weights:digest(p.getAttribute('WEIGHTS_0')),indices:digest(p.getIndices()),
    }))),
    skins:root.listSkins().map(s=>({joints:s.listJoints().map(j=>j.getName()),inverseBind:digest(s.getInverseBindMatrices())})),
    animations:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().map(c=>({
      target:c.getTargetNode()?.getName(),path:c.getTargetPath(),
      input:digest(c.getSampler().getInput()),output:digest(c.getSampler().getOutput()),
    }))})),
  };
}

for(const id of ids){
  const source=manifest.assets.find(a=>a.id===id);
  if(!source)throw new Error(`Missing manifest asset: ${id}`);
  const sourceFile=`${dir}/sources/${id}.glb`;
  const sourceBytes=await readFile(sourceFile);
  if(hash(sourceBytes)!==source.sha256)throw new Error(`${id}: production hash changed`);
  // The pinned source GLB keeps URIs relative to its former production path.
  // Mirror those resources entirely inside this candidate directory for NodeIO.
  const ioDir=`${dir}/sources/deep/deeper`;
  await mkdir(ioDir,{recursive:true});
  await writeFile(`${ioDir}/${id}.glb`,sourceBytes);
  const sourceJson=JSON.parse(sourceBytes.subarray(20,20+sourceBytes.readUInt32LE(12)).toString());
  for(const image of sourceJson.images??[]){
    if(!image.uri?.startsWith('../../textures/imported/'))continue;
    const name=image.uri.split('/').at(-1);
    const resourceDir=`${dir}/sources/textures/imported`;
    await mkdir(resourceDir,{recursive:true});
    await copyFile(`game/public/assets/textures/imported/${name}`,`${resourceDir}/${name}`);
  }
  const doc=await io.read(`${ioDir}/${id}.glb`),root=doc.getRoot();
  const sourceSignature=signature(root);
  if(root.listSkins().map(s=>s.listJoints().length).join(',')!=='65')throw new Error(`${id}: source rig changed`);
  const prefix=texturePrefix[id];
  const mapRecords=[];
  for(const [kind,materialPattern] of [['skin','MI_Superhero_Male'],['cloth','MI_Peasant']]){
    const material=root.listMaterials().find(m=>m.getName().includes(materialPattern));
    const texture=material?.getBaseColorTexture();
    const oldImage=texture?.getImage();
    if(!oldImage)throw new Error(`${id}: missing ${kind} texture`);
    const oldMeta=await sharp(oldImage).metadata();
    const imagegenFile=id==='creature_zombie'&&kind==='skin'?
      `${dir}/zombie-skin-imagegen-v2.png`:`${dir}/${prefix}-${kind}-imagegen.png`;
    const generated=await readFile(imagegenFile);
    const resized=await sharp(generated).resize(oldMeta.width,oldMeta.height,{fit:'fill'}).removeAlpha().raw().toBuffer();
    const alpha=await sharp(oldImage).ensureAlpha().extractChannel('alpha').raw().toBuffer();
    const runtime=await sharp(resized,{raw:{width:oldMeta.width,height:oldMeta.height,channels:3}})
      .joinChannel(alpha,{raw:{width:oldMeta.width,height:oldMeta.height,channels:1}})
      .png({compressionLevel:9}).toBuffer();
    const runtimeFile=`${dir}/${prefix}-${kind}-runtime.png`;
    await writeFile(runtimeFile,runtime);
    texture.setImage(runtime).setMimeType('image/png').setName(`${id} ${kind} layered imagegen albedo`);
    mapRecords.push({material:material.getName(),imagegenFile,imagegenSha256:hash(generated),runtimeFile,
      runtimeSha256:hash(runtime),width:oldMeta.width,height:oldMeta.height,sourceImageSha256:hash(oldImage)});
  }
  if(JSON.stringify(signature(root))!==JSON.stringify(sourceSignature))throw new Error(`${id}: geometry, rig or clips changed`);
  const candidateBytes=await io.writeBinary(doc);
  const candidateFile=`${dir}/${id}-polish.glb`;
  await writeFile(candidateFile,candidateBytes);
  const verify=await io.readBinary(candidateBytes);
  if(JSON.stringify(signature(verify.getRoot()))!==JSON.stringify(sourceSignature))throw new Error(`${id}: round-trip changed geometry, rig or clips`);
  const bounds={min:[source.base.x,source.base.y,source.base.z],
    max:[source.base.x+source.size.x,source.base.y+source.size.y,source.base.z+source.size.z]};
  const clips=root.listAnimations();
  const provenance={sourceAssetId:id,sourceFile,sourceSha256:source.sha256,sourcePack:source.pack,
    author:source.sourceProvenance.author,license:source.sourceProvenance.license,
    sourceAssets:source.sourceProvenance.sourceAssets,sourceRigAndGeometryPreserved:true,
    sourceAnimationsPreserved:true,builder,builderSha256,maps:mapRecords,
    changes:id==='creature_plague_zombie'?
      'Layered olive-gray plague lesions, bruised tissue, pustules and damp mildew-frayed cloth on source UVs.':
      'Layered dry pale decay, subtle bruising and restrained dusty threadbare cloth on source UVs.'};
  const entry={...source,
    tags:[...new Set([...source.tags,'candidate','zombie-polish'])],
    bytes:candidateBytes.length,sha256:hash(candidateBytes),bounds,
    materials:root.listMaterials().map(m=>m.getName()),animations:clips.map(a=>a.getName()),
    walkClipSeconds:duration(clips.find(a=>a.getName()==='Walk')),
    runClipSeconds:duration(clips.find(a=>a.getName()==='Run')),
    attackSeconds:duration(clips.find(a=>a.getName()==='Attack')),
    contactNormalized:source.contactNormalized,
    sourceProvenance:provenance,
    acceptance:{sourceIdentityVerified:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false},
  };
  entries.push(entry);
  promotions.push({id,candidateFile,productionFile:`game/public/assets/${source.file}`,sha256:entry.sha256,bytes:entry.bytes,
    bounds,size:source.size,groundY:source.groundY,materials:entry.materials,animations:entry.animations,
    attack:{seconds:entry.attackSeconds,contactNormalized:entry.contactNormalized,
      contactSeconds:entry.attackSeconds*entry.contactNormalized,contactNode:source.metadata.attackContactNode,
      contactBasis:source.metadata.attackContactStatus},
    gait:{walkClipSeconds:entry.walkClipSeconds,runClipSeconds:entry.runClipSeconds,
      impliedWalkMps:source.impliedWalkMps,impliedRunMps:source.impliedRunMps,
      locomotionPolicy:source.locomotionPolicy,clipAliases:source.metadata.gaitClipAliases,
      reason:'Source geometry and locomotion clips are unchanged; source gait metadata remains applicable.'},
    sourceProvenance:provenance,status:'awaiting-root-lab-review',accepted:false});
}
const lab={schema:'corealm-lab-asset-candidates/1',assets:entries,files:Object.fromEntries(ids.map(id=>[id,`${id}-polish.glb`]))};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(lab,null,2));
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-polish-promotion/1',
  pack:'corealm-audit-polish-zombies',builder,builderSha256,status:'awaiting-root-lab-review',accepted:false,
  assets:promotions},null,2));
console.log(JSON.stringify(promotions.map(({id,sha256,bytes,bounds,attack})=>({id,sha256,bytes,bounds,attack})),null,2));
