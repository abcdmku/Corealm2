import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, unpartition } from '@gltf-transform/functions';
import { Quaternion } from 'three';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/audit-polish-bandits';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const builderFile = `${dir}/build-candidates.mjs`;
const builderSha256 = sha256(await readFile(builderFile));
const sourcePins=JSON.parse(await readFile(`${dir}/source-pins.json`,'utf8'));
for(const pin of sourcePins.inputs){
  const bytes=await readFile(pin.stagedFile);
  if(bytes.length!==pin.bytes||sha256(bytes)!==pin.sha256)throw new Error(`Staged source changed: ${pin.stagedFile}`);
}
const libraryFile = `${dir}/sources/models/animation/animation_library_1.glb`;
const library = await io.read(libraryFile);
const punch = library.getRoot().listAnimations().find(a => a.getName() === 'Punch_Jab');
if (!punch) throw new Error('Shared Punch_Jab clip missing');
const attackSeconds = Math.max(...punch.listSamplers().flatMap(s => [...s.getInput().getArray()]));
const nativeClipNames={Idle:'Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',Attack:'Punch_Jab',Hit:'Hit_Chest',Death:'Death01'};

const specs = [
  { id:'bandit_forest_ranger', sourceId:'outfit_female_ranger', atlas:'forest-atlas-imagegen.png', name:'Forest Bandit', enemyId:'gorge_reavers', region:'vellenwood',base:{x:-.832,y:-.004,z:-.21},size:{x:1.664,y:1.798,z:.377} },
  { id:'bandit_highland_ranger', sourceId:'outfit_male_ranger', atlas:'highland-atlas-imagegen.png', name:'Highland Bandit', enemyId:'karrow_reavers', region:'karrowmoor',base:{x:-.899,y:-.004,z:-.206},size:{x:1.799,y:1.869,z:.373} },
  { id:'bandit_quarry_ranger', sourceId:'outfit_male_ranger', atlas:'quarry-atlas-imagegen.png', name:'Quarry Bandit', enemyId:'kilnroad_reavers', region:'kilnhalt',base:{x:-.899,y:-.004,z:-.206},size:{x:1.799,y:1.869,z:.373} },
];
await mkdir(`${dir}/models`, { recursive:true });
await mkdir(`${dir}/textures`, { recursive:true });
const assets=[];
const promotions=[];
const fileMap={};
for (const spec of specs) {
  const sourceFile=`${dir}/sources/models/outfit/${spec.sourceId}.glb`;
  const sourceBytes=await readFile(sourceFile);
  const sourceSha256=sha256(sourceBytes);
  const doc=await io.read(sourceFile);
  const root=doc.getRoot();
  const skin=root.listSkins()[0];
  if (root.listSkins().length!==1 || skin.listJoints().length!==65 || root.listAnimations().length!==0) throw new Error(`Unexpected rig ${spec.sourceId}`);
  const mats=root.listMaterials();
  const garment=mats.find(m=>m.getName()==='MI_Ranger');
  if (!garment?.getBaseColorTexture() || mats.length!==2) throw new Error(`Unexpected materials ${spec.sourceId}`);
  const sourceTextureSha256=sha256(garment.getBaseColorTexture().getImage());
  const mapBytes=await readFile(`${dir}/${spec.atlas}`);
  const runtimeFile=`${dir}/textures/${spec.id}-basecolor.jpg`;
  // Imagegen returns a 1254 px editing canvas. Return it to the source atlas's
  // exact dimensions and keep the UV coordinates and every non-color map intact.
  const runtime=await sharp(mapBytes).resize(1024,1024,{kernel:'lanczos3'}).flatten({background:'#4f4c40'}).jpeg({quality:93,chromaSubsampling:'4:4:4'}).toBuffer();
  await writeFile(runtimeFile,runtime);
  garment.getBaseColorTexture().setImage(runtime).setMimeType('image/jpeg').setName(`${spec.name} weathered garment atlas`);
  const gender=spec.sourceId.includes('female')?'female':'male';
  const baseFile=`${dir}/sources/models/character/base_${gender}.glb`;
  const baseDoc=await io.read(baseFile);
  const baseRoot=baseDoc.getRoot();
  const baseNodes=baseRoot.listNodes().filter(n=>n.getMesh());
  const baseMap=mergeDocuments(doc,baseDoc);
  const outfitScene=root.listScenes()[0];
  const outfitArmature=outfitScene.listChildren()[0];
  for(const sourceNode of baseNodes){
    const node=baseMap.get(sourceNode);
    if(!node)throw new Error(`Unmapped base node ${sourceNode.getName()}`);
    node.setSkin(skin);
    if(sourceNode.getName().toLowerCase().includes('superhero')){
      const cutoff=gender==='female'?1.50:1.55;
      for(const primitive of node.getMesh().listPrimitives()){
        const pos=primitive.getAttribute('POSITION').getArray();
        const original=primitive.getIndices()?.getArray()??Uint32Array.from({length:pos.length/3},(_,i)=>i);
        const retained=[];
        for(let i=0;i<original.length;i+=3){
          const tri=[original[i],original[i+1],original[i+2]];
          if(tri.every(v=>pos[v*3+1]>=cutoff))retained.push(...tri);
        }
        if(!retained.length)throw new Error(`Empty head mesh ${spec.id}`);
        primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(retained)));
      }
    }
    outfitArmature.addChild(node);
  }
  for(const scene of baseRoot.listScenes())baseMap.get(scene)?.dispose();
  const animationDoc=await io.read(libraryFile);
  const animationRoot=animationDoc.getRoot();
  const animationMap=mergeDocuments(doc,animationDoc);
  const targetBones=new Map(skin.listJoints().map(n=>[n.getName(),n]));
  for(const [name,sourceName]of Object.entries(nativeClipNames)){
    const sourceClip=animationRoot.listAnimations().find(a=>a.getName()===sourceName);
    const clip=animationMap.get(sourceClip);
    if(!clip)throw new Error(`Missing clip ${sourceName}`);
    clip.setName(name);
    for(const channel of clip.listChannels()){
      const sourceNode=channel.getTargetNode();
      const target=targetBones.get(sourceNode?.getName());
      if(!target)throw new Error(`Unmapped animation bone ${sourceNode?.getName()}`);
      const sampler=channel.getSampler(),out=sampler.getOutput(),values=new Float32Array(out.getArray());
      if(channel.getTargetPath()==='rotation'){
        const sourceRest=new Quaternion(...sourceNode.getRotation());
        const correction=new Quaternion(...target.getRotation()).multiply(sourceRest.invert());
        for(let i=0;i<values.length;i+=4){
          const q=new Quaternion(values[i],values[i+1],values[i+2],values[i+3]).premultiply(correction).normalize();
          values.set(q.toArray(),i);
        }
      }else if(channel.getTargetPath()==='translation'){
        const sourceRest=sourceNode.getTranslation(),targetRest=target.getTranslation();
        for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=sourceNode.getName()==='root'?targetRest[k]:targetRest[k]+values[i+k]-sourceRest[k];
      }
      out.setArray(values);
      channel.setTargetNode(target);
    }
  }
  for(const clip of animationRoot.listAnimations())if(!Object.values(nativeClipNames).includes(clip.getName()))animationMap.get(clip)?.dispose();
  for(const scene of animationRoot.listScenes())animationMap.get(scene)?.dispose();
  for(const node of animationRoot.listNodes())if(node.getName()==='Mannequin')animationMap.get(node)?.dispose();
  await doc.transform(prune(),unpartition());
  if(root.listSkins().length!==1||root.listAnimations().length!==6)throw new Error(`Unexpected assembled rig ${spec.id}: ${root.listSkins().length} skins ${root.listAnimations().length} clips; skins=${JSON.stringify(root.listSkins().map(s=>({name:s.getName(),nodes:root.listNodes().filter(n=>n.getSkin()===s).map(n=>n.getName())})))}`);
  const primitives=root.listMeshes().flatMap(m=>m.listPrimitives());
  if (primitives.some(p=>!p.getAttribute('JOINTS_0')||!p.getAttribute('WEIGHTS_0')||!p.getAttribute('TEXCOORD_0'))) throw new Error(`Unskinned or unmapped mesh ${spec.id}`);
  const triangles=primitives.reduce((sum,p)=>sum+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0);
  const binary=await io.writeBinary(doc);
  const candidateFile=`${dir}/models/${spec.id}.glb`;
  await writeFile(candidateFile,binary);
  const src={base:spec.base,size:spec.size};
  const entry={
    id:spec.id,file:`models/bandit/${spec.id}.glb`,pack:'corealm-audit-polish-bandits',category:'character',is:spec.name,
    tags:['creature','bandit','human','ranger',spec.region,'candidate'],
    bytes:binary.length,sha256:sha256(binary),builderSha256,
    size:src.size,base:src.base,groundY:src.base.y,triangles,
    materials:root.listMaterials().map(m=>m.getName()),animations:Object.keys(nativeClipNames),
    motionSource:{file:libraryFile,clip:'Punch_Jab',nativeClip:'Attack',durationSeconds:attackSeconds,contactNormalized:0.42,contactSeconds:attackSeconds*0.42,retargetedToOutfitSkeleton:true},
    strideCalibration:null,
    sourceProvenance:{file:sourceFile,originalProductionFile:`game/public/assets/models/outfit/${spec.sourceId}.glb`,sha256:sourceSha256,bytes:sourceBytes.length,baseBodyFile:baseFile,originalBaseBodyFile:`game/public/assets/models/character/base_${gender}.glb`,baseBodySha256:sha256(await readFile(baseFile)),animationLibraryFile:libraryFile,originalAnimationLibraryFile:'game/public/assets/models/animation/animation_library_1.glb',animationLibrarySha256:sha256(await readFile(libraryFile)),externalTexturePins:`${dir}/source-pins.json`,upstreamPack:'modular-character-outfits-fantasy',upstreamAuthor:'Quaternius',upstreamSource:'https://quaternius.itch.io/modular-character-outfits-fantasy',upstreamLicense:'CC0-1.0',upstreamArchiveSha256:'c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70',baseBodyPack:'universal-base-characters',baseBodyArchiveSha256:'fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40',animationPack:'universal-animation-library',animationArchiveSha256:'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724',sourceGarmentAtlasSha256:sourceTextureSha256,generatedMap:`${dir}/${spec.atlas}`,generatedMapSha256:sha256(mapBytes),runtimeMap:runtimeFile,runtimeMapSha256:sha256(runtime)},
    metadata:{enemyId:spec.enemyId,regionId:spec.region,sourceAssetId:spec.sourceId,originalOutfitGeometrySkinWeightsUvNormalsAndOtherPbrMapsUnchanged:true,baseBodyFile:baseFile,baseBodySha256:sha256(await readFile(baseFile)),animationLibrarySha256:sha256(await readFile(libraryFile)),faceEyesAndBrowsBoundToOutfitSkin:true,hoodRetained:true,nativeClips:true},
    acceptance:{cpuValidated:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false},
  };
  assets.push(entry);
  promotions.push({id:spec.id,enemyId:spec.enemyId,sourceAssetId:spec.sourceId,candidateFile,sha256:entry.sha256,bytes:entry.bytes,bounds:{base:src.base,size:src.size},triangles,materials:entry.materials,animations:entry.animations,attack:entry.motionSource,sourceProvenance:entry.sourceProvenance,productionTarget:`game/public/assets/models/bandit/${spec.id}.glb`});
  fileMap[spec.id]=`models/${spec.id}.glb`;
}
const lab={schema:'corealm-lab-asset-candidates/1',pack:{id:'corealm-audit-polish-bandits',name:'Corealm forest, highland and quarry bandit polish',author:'Corealm',source:builderFile,license:'Quaternius CC0-1.0 source plus Corealm imagegen texture edits',generatorSha256:builderSha256},assets,files:fileMap};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n');
const promotion={schema:'corealm-creature-polish-promotion/1',pack:lab.pack.id,builderFile,builderSha256,status:'awaiting-root-lab-review',accepted:false,assets:promotions,enemyMapping:Object.fromEntries(specs.map(s=>[s.enemyId,s.id])),rendererIntegration:'Self-contained base body, face and six native humanoid clips; no OUTFIT_BODIES or HOODED_PARTS keys needed. Preserve original player ranger IDs and modular parts.',remainingAcceptance:['Root checks candidate catalog in production creature lab at normal camera limits, including cloth UV seams, face, hood and animation.','Root builds production after promoting assets and enemy bindings.']};
await writeFile(`${dir}/promotion.json`,JSON.stringify(promotion,null,2)+'\n');
console.log(JSON.stringify({assets:promotions.map(({id,enemyId,candidateFile,sha256,bytes,bounds,triangles,attack})=>({id,enemyId,candidateFile,sha256,bytes,bounds,triangles,attack})),builderSha256},null,2));
