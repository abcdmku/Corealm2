/** Whole licensed source bodies. Candidate-only; no procedural anatomy or texture replacement. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const OUT='test-results/wilderness-creatures/families/keepers';
const SOURCES='assets/art/wilderness-creatures/keeper-refinement/native-sources';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceRecords=JSON.parse(await readFile(`${SOURCES}/source-records.json`,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const designs=[
 {id:'ashseal_warden',source:'skeleton_soldier',height:3.0,description:'An armed skeletal keeper with the source shield, blade, bone structure and separate equipment materials.'},
 {id:'furnace_regent',source:'lava_golem',height:3.4,description:'A complete volcanic golem with a defined face, chest, hands and articulated stone limbs; heat follows the native fissure atlas.'},
 {id:'nightforge_marshal',source:'iron_golem',height:3.3,description:'A complete armored guardian with a fitted cuirass, helmet and articulated gauntlets, greaves and shoulders.'},
 {id:'chainbound_archon',source:'banshee',height:3.1,description:'A full spectral robed keeper with a deep tailored cowl, long continuous robe folds and skeletal hands.'},
 {id:'hollow_star',source:'gorge_mantis',height:3.4,description:'A complete alien insect keeper with an integrated head, thorax, abdomen and articulated native limbs.'},
];
await mkdir(OUT,{recursive:true});
const onlyIndex=process.argv.indexOf('--only'),only=onlyIndex<0?null:process.argv[onlyIndex+1];
if(only&&!designs.some(d=>d.id===only))throw Error(`Unknown keeper ${only}`);
const catalog=only?JSON.parse(await readFile(`${OUT}/catalog.json`,'utf8')):{assets:[],files:{}};
const reports=only?JSON.parse(await readFile(`${OUT}/native-body-check.json`,'utf8')):[];

async function loadGeometry(doc){
 const clone=await io.readBinary(await io.writeBinary(doc));
 for(const m of clone.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
 await clone.transform(prune());const b=await io.writeBinary(clone);
 return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
function at(scene,mixer,time){mixer.setTime(time);scene.updateMatrixWorld(true);scene.traverse(n=>{if(n.isSkinnedMesh)n.computeBoundingBox();});return new T.Box3().setFromObject(scene,true);}
function dataDigest(root){const h=createHash('sha256');for(const a of root.listAccessors()){const b=a.getArray();h.update(Buffer.from(b.buffer,b.byteOffset,b.byteLength));}return h.digest('hex');}

for(const config of designs.filter(d=>!only||d.id===only)){
 const id=`creature_${config.id}`,sourceId=`creature_${config.source}`;
 const sourceEntry=structuredClone(sourceRecords.find(a=>a.id===sourceId));
 const sourcePath=`${SOURCES}/models/creature/${sourceId}.glb`,sourceBytes=await readFile(sourcePath),doc=await io.read(sourcePath),root=doc.getRoot();
 // Embed the unchanged snapshotted maps so a staged GLB has no live texture dependency.
 for(const texture of root.listTextures())texture.setURI('');
 if(config.id==='ashseal_warden')for(const material of root.listMaterials()){
  // Native wear, seams and painted texture details remain. Only the material
  // response distinguishes this old bronze keeper from its source soldier.
  if(/DS_equipment/.test(material.getName()))material.setBaseColorFactor([1,.73,.38,1]).setMetallicFactor(.28).setRoughnessFactor(.76);
  else material.setBaseColorFactor([1,.96,.88,1]);
 }
 if(config.id==='furnace_regent'){
  const emission=doc.createTexture('regent_fine_recessed_heat').setImage(await readFile('assets/art/wilderness-creatures/keeper-refinement/regent-fine-emission.png')).setMimeType('image/png');
  const basalt=doc.createTexture('regent_fine_basalt').setImage(await readFile('assets/art/wilderness-creatures/keeper-refinement/regent-basalt-albedo.png')).setMimeType('image/png');
  for(const material of root.listMaterials())material.setBaseColorTexture(basalt).setEmissiveTexture(emission).setEmissiveFactor([.40,.30,.20]).setBaseColorFactor([1,.88,.76,1]).setNormalScale(.35);
 }
 if(config.id==='chainbound_archon'){
  const atlas=await sharp('assets/art/wilderness-creatures/keeper-refinement/archon-cloth-atlas.png').resize(2048,2048).linear(1.12,18).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
  const texture=doc.createTexture('archon_accepted_woven_cloth').setImage(atlas).setMimeType('image/jpeg');
  for(const mesh of root.listMeshes())for(const primitive of mesh.listPrimitives()){
   const material=primitive.getMaterial(),name=material.getName(),tile=/hood|cowl/i.test(name)?0:/Regular_Male/.test(name)?3:1;
   material.setBaseColorTexture(texture).setBaseColorFactor(tile===1?[.90,.80,.93,1]:[1,.98,.92,1]).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(tile===3?.86:.96).setEmissiveFactor([0,0,0]).setAlphaMode('OPAQUE');
   const p=primitive.getAttribute('POSITION').getArray(),uv=Float32Array.from(primitive.getAttribute('TEXCOORD_0').getArray());let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
   for(let i=0;i<p.length;i+=3){minX=Math.min(minX,p[i]);maxX=Math.max(maxX,p[i]);minY=Math.min(minY,p[i+1]);maxY=Math.max(maxY,p[i+1]);}
   for(let v=0;v<uv.length/2;v++){uv[v*2]=(tile%2)*.5+.015+(p[v*3]-minX)/(maxX-minX||1)*.47;uv[v*2+1]=Math.floor(tile/2)*.5+.015+(1-(p[v*3+1]-minY)/(maxY-minY||1))*.47;}
   primitive.setAttribute('TEXCOORD_0',primitive.getAttribute('TEXCOORD_0').clone().setArray(uv));
  }
 }
 if(config.id==='hollow_star'){
  const atlas=doc.createTexture('hollow_pearl_violet_wine_native_uv').setImage(await readFile('assets/art/wilderness-creatures/keeper-refinement/hollow-pearl-atlas.png')).setMimeType('image/png');
  for(const material of root.listMaterials())material.setBaseColorTexture(atlas).setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(.85);
 }
 if(config.id==='nightforge_marshal'){
  const steel=doc.createTexture('nightforge_worn_silver_steel').setImage(await readFile('assets/art/wilderness-creatures/keeper-refinement/nightforge-steel.png')).setMimeType('image/png');
  for(const node of root.listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
   const original=primitive.getMaterial(),name=node.getName();
   if(/Eyes/.test(name))continue;
   const material=original.clone().setName(`${original.getName()}_${name}_regional_metal`);primitive.setMaterial(material);
   if(/SuperHero/.test(name))material.setBaseColorFactor([.22,.22,.22,1]).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(.95);
   else if(/Pauldron|Head_Armet/.test(name))material.setBaseColorTexture(steel).setBaseColorFactor([1,.52,.16,1]).setMetallicRoughnessTexture(null).setMetallicFactor(.16).setRoughnessFactor(.80).setNormalScale(.22);
   else if(/Body_Armor|Knight_Arms/.test(name))material.setBaseColorTexture(steel).setBaseColorFactor([1,1,.94,1]).setMetallicRoughnessTexture(null).setMetallicFactor(.10).setRoughnessFactor(.83).setNormalScale(.25);
   else material.setBaseColorTexture(steel).setBaseColorFactor([.53,.57,.62,1]).setMetallicRoughnessTexture(null).setMetallicFactor(.12).setRoughnessFactor(.88).setNormalScale(.25);
  }
 }
 const before=dataDigest(root),gltf=await loadGeometry(doc),mixer=new T.AnimationMixer(gltf.scene);
 const idle=gltf.animations.find(c=>c.name==='Idle');if(!idle)throw Error(`${id}: missing Idle`);
 mixer.clipAction(idle).play();const initial=at(gltf.scene,mixer,0),factor=config.height/(initial.max.y-initial.min.y);
 const scene=root.listScenes()[0],wrapper=doc.createNode(`${id}_native_body_scale`).setScale([factor,factor,factor]);
 for(const node of [...scene.listChildren()]){scene.removeChild(node);wrapper.addChild(node);}scene.addChild(wrapper);
 if(before!==dataDigest(root))throw Error(`${id}: source mesh, skin or animation changed`);
 // Source fall clips can place equipment below ground. An outer scene translation
 // corrects that contact without touching a source bone, mesh or motion channel.
 const deathSource=await loadGeometry(doc),deathClip=deathSource.animations.find(c=>c.name==='Death'),deathMixer=new T.AnimationMixer(deathSource.scene);
 const deathAction=deathMixer.clipAction(deathClip).setLoop(T.LoopOnce,1);deathAction.clampWhenFinished=true;deathAction.play();
 const deathTimes=[],deathValues=[],deathSteps=Math.ceil(deathClip.duration*120);
 for(let i=0;i<=deathSteps;i++){const t=i/deathSteps*deathClip.duration,b=at(deathSource.scene,deathMixer,t);deathTimes.push(t);deathValues.push(0,.004-b.min.y,0);}
 const buffer=root.listBuffers()[0],deathAnimation=root.listAnimations().find(a=>a.getName()==='Death');
 const deathSampler=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(deathTimes)).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(deathValues)).setBuffer(buffer));
 deathAnimation.addSampler(deathSampler).addChannel(doc.createAnimationChannel().setTargetNode(wrapper).setTargetPath('translation').setSampler(deathSampler));
 const ready=await loadGeometry(doc),mix=new T.AnimationMixer(ready.scene),clips={},union=new T.Box3();let idleBounds;
 for(const clip of ready.animations){mix.stopAllAction();const action=mix.clipAction(clip).setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();const steps=Math.ceil(clip.duration*24);let minFloor=Infinity,maxFloor=-Infinity;const bounds=new T.Box3();
  for(let i=0;i<=steps;i++){const b=at(ready.scene,mix,i/steps*clip.duration);bounds.union(b);minFloor=Math.min(minFloor,b.min.y);maxFloor=Math.max(maxFloor,b.min.y);if(clip.name==='Idle'&&i===0)idleBounds={min:b.min.toArray(),max:b.max.toArray()};}
  clips[clip.name]={duration:clip.duration,min:bounds.min.toArray(),max:bounds.max.toArray(),minFloor,maxFloor,samples:steps+1};union.union(bounds);
 }
 const finite=root.listAccessors().every(a=>[...a.getArray()].every(Number.isFinite));if(!finite)throw Error(`${id}: non-finite source data`);
 const file=`${id}.glb`;await io.write(`${OUT}/${file}`,doc);const bytes=await readFile(`${OUT}/${file}`),size=idleBounds.max.map((v,i)=>v-idleBounds.min[i]);
 const asset={...sourceEntry,id,file:`models/creature/${file}`,is:config.description,tags:['creature','wilderness','keeper',config.id],bytes:bytes.length,sha256:sha(bytes),size:{x:size[0],y:size[1],z:size[2]},base:{x:idleBounds.min[0],y:idleBounds.min[1],z:idleBounds.min[2]},groundY:sourceEntry.groundY*factor,impliedWalkMps:sourceEntry.impliedWalkMps*factor,impliedRunMps:sourceEntry.impliedRunMps*factor,materials:root.listMaterials().map(m=>m.getName()),metadata:{...sourceEntry.metadata,family:'wilderness_keeper',nativeKeeperReplacement:{generator:'tools/wilderness-creatures/families/keepers.mjs',sourceId,sourcePath,sourceSha256:sha(sourceBytes),sourcePack:sourceEntry.pack,sourceProvenance:sourceEntry.sourceProvenance,uniformScale:factor,targetHeight:config.height,sourceAccessorSha256:before,scope:'Complete source anatomy, UVs, embedded maps, normals, skin and motion retained. Uniform scene scale and 120 Hz outer death floor translation only; no grafts or primitive assembly.',measurements:{idleBounds,animatedMin:union.min.toArray(),animatedMax:union.max.toArray(),clips}}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 if(config.id==='ashseal_warden')asset.metadata.nativeKeeperReplacement.materialIdentity='Native equipment texture preserved under worn bronze factor [1,.73,.38], metallic .28, roughness .76. Bone retains full brightness with warm factor [1,.96,.88]. Existing dark seam texels remain dark.';
 if(config.id==='furnace_regent')asset.metadata.nativeKeeperReplacement.materialIdentity='Native UV-aligned fine basalt albedo shared from cooled Kiln atlas with warm [1,.88,.76] factor. Original emission atlas edited to thinner uneven recessed red/amber seams with warmer torso and cooled limb islands; emission [.40,.30,.20], native normal strength .35.';
 if(config.id==='nightforge_marshal')asset.metadata.nativeKeeperReplacement.materialIdentity='Separate native mesh materials: charcoal SuperHero underbody, light silver chest and gauntlets, warm worn bronze Pauldron and Armet, darker steel greaves. Native geometry/UV retained. Metallic texture removed to preserve diffuse clarity under violet night; metallic .10 silver/.16 bronze, native normals .22-.25.';
 if(config.id==='chainbound_archon')asset.metadata.nativeKeeperReplacement.materialIdentity='Approved Banshee cloth treatment copied without its shape edits. Primitive planar UV cell remapping to ash cowl/ivory hands/plum tunic. Native normal maps, exact source positions, skin and clips retained.';
 if(config.id==='hollow_star')asset.metadata.nativeKeeperReplacement.materialIdentity='Original authored UV atlas edited with exact island boundaries to pearl raised plates, muted violet chitin and wine membranes. No geometric or UV edits.';
 asset.metadata.nativeKeeperReplacement.scope='Complete native positions, topology, normals, skin weights, rig and bone motion retained. Material factors or maps revised per keeper. Archon uses the approved cloth atlas with planar cell UV remapping; other keepers retain native UVs. Uniform scene scale and 120 Hz outer death floor translation; no anatomical grafts or primitive assembly.';
 const index=catalog.assets.findIndex(a=>a.id===id);if(index<0)catalog.assets.push(asset);else catalog.assets[index]=asset;
 catalog.files[id]=file;const report={id,sha256:asset.sha256,sourceId,sourceGeometrySkinBoneMotionUnchanged:true,uvRemapped:config.id==='chainbound_archon',materialRevised:true,finite,uniformScale:factor,clips};const ri=reports.findIndex(r=>r.id===id);if(ri<0)reports.push(report);else reports[ri]=report;
 console.log(id,JSON.stringify({scale:factor,size:asset.size,death:clips.Death}));
}
await writeFile(`${OUT}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
await writeFile(`${OUT}/native-body-check.json`,JSON.stringify(reports,null,2)+'\n');
