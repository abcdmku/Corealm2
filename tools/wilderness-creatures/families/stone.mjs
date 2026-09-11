/** Stage stone-family anatomy and materials. Never promotes or replaces native rigs. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as T from 'three';
import {measureAndGround} from '../ordinary/measure.mjs';

const base='test-results/wilderness-creatures/refined';
const out='test-results/wilderness-creatures/families/stone';
const atlasFile='assets/art/wilderness-creatures/stone/mineral-atlas-v2.png';
const ids=['furnace_grazer','basalt_maw','voidstone_colossus','kiln_marrow'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const liveCatalog=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const nativePlans=[
 {flag:'--native-grazer',id:'furnace_grazer',name:'Furnace Grazer',source:'basalt_drake',scale:.72,out:'native-grazer',replacement:'Native DragonBoar armored quadruped replaces rejected constructed mantle body'},
 {flag:'--native-maw',id:'basalt_maw',name:'Basalt Maw',source:'cinder_ravager',scale:1,out:'native-maw',replacement:'Native Monster04 anatomical clawed predator replaces rejected rock-jaw graft body'},
 {flag:'--native-colossus',id:'voidstone_colossus',name:'Voidstone Colossus',source:'stone_golem',scale:1.3,out:'native-colossus',replacement:'Retained Quaternius humanoid anatomy and weighted source knight plates replace rejected cylinder head and stacked rib blocks'},
 {flag:'--native-kiln',id:'kiln_marrow',name:'Kiln Marrow',source:'lava_golem',scale:1,out:'native-kiln',replacement:'Complete native gavlig Lava Golem body without authored collar, rib loops or dorsal grafts'},
];
const nativePlan=nativePlans.find(p=>process.argv.includes(p.flag));
if(!nativePlan&&!process.argv.includes('--legacy-rejected')){
 throw Error('Choose an accepted native family build: --native-grazer, --native-maw, --native-colossus or --native-kiln. Approved materials are automatic. --legacy-rejected is archival only and must never be promoted.');
}
if(nativePlan){
 const id=`creature_${nativePlan.id}`,native=liveCatalog.assets.find(a=>a.id===`creature_${nativePlan.source}`);
 const sourcePath=`game/public/assets/${native.file}`,source=await readFile(sourcePath);
 const doc=await io.read(sourcePath),root=doc.getRoot();
 const shapeDigest=()=>hash(Buffer.concat(root.listMeshes().flatMap(m=>m.listPrimitives().flatMap(p=>p.listSemantics().map(s=>p.getAttribute(s))).map(a=>Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength)))));
 const shapeBefore=shapeDigest(),textureBefore=root.listTextures().map(t=>hash(t.getImage()));
 let albedoRevision,emissionRevision;
 if(nativePlan.id==='furnace_grazer'){
  const albedo=root.listMaterials()[0].getBaseColorTexture();
  const file='assets/art/wilderness-creatures/stone/grazer-warm-native-albedo.png',bytes=await readFile(file);
  albedoRevision={file,sourceSha256:hash(albedo.getImage()),sha256:hash(bytes),scope:'Native UV atlas hue/value revision; existing tan throat, pale horns, claws and teeth retained. No geometry, normal/AO map or emissive changes.'};
  albedo.setImage(bytes).setMimeType('image/png');
 }
 if(nativePlan.id==='kiln_marrow'){
  const material=root.listMaterials()[0],albedo=material.getBaseColorTexture(),emission=material.getEmissiveTexture();
  const albedoFile='assets/art/wilderness-creatures/stone/kiln-cooled-albedo-v2.png',emissionFile='assets/art/wilderness-creatures/stone/kiln-cooled-emission-v2.png';
  const albedoBytes=await readFile(albedoFile),emissionBytes=await readFile(emissionFile);
  albedoRevision={file:albedoFile,sourceSha256:hash(albedo.getImage()),sha256:hash(albedoBytes),scope:'Finer low-contrast cooled ash stone on retained native UV layout'};
  emissionRevision={file:emissionFile,sourceSha256:hash(emission.getImage()),sha256:hash(emissionBytes),scope:'Narrower interrupted dim ember seams on original crack layout; cooled throughout rather than hot Regent torso'};
  albedo.setImage(albedoBytes).setMimeType('image/png');emission.setImage(emissionBytes).setMimeType('image/png');
  material.setBaseColorFactor([.92,1,1,1]).setEmissiveFactor([.22,.22,.22]).setRoughnessFactor(.93).setNormalScale(.35);
 }
 let materialRevision;
 if(nativePlan.id==='voidstone_colossus'){
  materialRevision=[];
  for(const node of root.listNodes())if(node.getMesh())for(const primitive of node.getMesh().listPrimitives()){
   const original=primitive.getMaterial(),material=original.clone().setName(`${original.getName()}_${node.getName()}_readable`),name=node.getName();
   // Region light is strongly violet. Distinct warm worn plate faces and dark
   // structural leg armour must survive that illumination instead of all
   // converging to the same lavender value.
   const color=/Eyes/.test(name)?[.28,.13,.43,1]
    :/SuperHero/.test(name)?[.18,.16,.13,1]
    :/Pauldron/.test(name)?[.95,.80,.46,1]
    :/Arms/.test(name)?[.72,.59,.36,1]
    :/Feet/.test(name)?[.13,.15,.17,1]
    :/Legs/.test(name)?[.16,.17,.20,1]
    :[.70,.48,.23,1];
   material.setBaseColorFactor(color).setMetallicFactor(0).setRoughnessFactor(.88);
   if(/Eyes/.test(name))material.setEmissiveFactor([.20,.05,.34]);
   primitive.setMaterial(material);materialRevision.push({node:name,baseColorFactor:color});
  }
 }
 const scale=doc.createNode(`${nativePlan.id}_native_uniform_scale`).setScale([nativePlan.scale,nativePlan.scale,nativePlan.scale]);
 for(const scene of root.listScenes()){for(const node of scene.listChildren()){scene.removeChild(node);scale.addChild(node);}scene.addChild(scale);}
 const measurements=measureAndGround(doc,`${nativePlan.id}_native`);
 if(nativePlan.id!=='furnace_grazer'){
  const ground=root.listNodes().find(n=>n.getName()===`${nativePlan.id}_native_authored_ground`);
  const position=ground.getTranslation();ground.setTranslation([position[0],Math.max(0,position[1]),position[2]]);
  for(const animation of root.listAnimations())for(const channel of animation.listChannels())if(channel.getTargetNode()===ground){
   const accessor=channel.getSampler().getOutput(),array=Float32Array.from(accessor.getArray());
   for(let i=1;i<array.length;i+=3)array[i]=Math.max(0,array[i]);
   accessor.setArray(array);
  }
  measurements.policy='Upward-only new wrapper correction. Source airborne phases retained; sampled bounds below describe the grounded envelope, not aerial height.';
 }
 if(shapeDigest()!==shapeBefore)throw Error('Native shape changed');
 for(let i=0;i<textureBefore.length;i++)if(textureBefore[i]!==hash(root.listTextures()[i].getImage())&&textureBefore[i]!==albedoRevision?.sourceSha256&&textureBefore[i]!==emissionRevision?.sourceSha256)throw Error('Protected native texture changed');
 const b=measurements.idleBounds,size={x:b.max[0]-b.min[0],y:b.max[1]-b.min[1],z:b.max[2]-b.min[2]};
 const target=`${out}/${nativePlan.out}`;await mkdir(target,{recursive:true});const file=`${id}.glb`;await io.write(`${target}/${file}`,doc);const bytes=await readFile(`${target}/${file}`);
 const entry={...structuredClone(native),id,is:nativePlan.name,file:`models/creature/${file}`,bytes:bytes.length,sha256:hash(bytes),size,base:{x:b.min[0],y:b.min[1],z:b.min[2]},bounds:b,groundY:.003,impliedWalkMps:native.impliedWalkMps*nativePlan.scale,impliedRunMps:native.impliedRunMps*nativePlan.scale,acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
 delete entry.measuredGait;
 delete entry.metadata.gaitStanceAudit;
 entry.metadata={...entry.metadata,id:nativePlan.id,height:size.y,dimensions:[size.x,size.y,size.z],impliedWalkMps:entry.impliedWalkMps,impliedRunMps:entry.impliedRunMps,groundCorrections:measurements.clips.map(c=>({name:c.clip,maxCorrectionM:c.maxCorrection})),familyRefinement:{family:'stone',replacement:nativePlan.replacement,generator:`tools/wilderness-creatures/families/stone.mjs ${nativePlan.flag}`,sourceAssetId:native.id,sourceAssetSha256:hash(source),uniformScale:nativePlan.scale,shapeSha256:shapeBefore,nativeTextureSha256:textureBefore,measurements,scope:'Full native body, UVs, topology, joint weights, maps and skeletal animation retained. Uniform root scale and sampled ground channel only. Attack timing and measured contact retained from source asset.'}};
 if(albedoRevision){entry.metadata.familyRefinement.albedoRevision=albedoRevision;entry.metadata.familyRefinement.generator+=emissionRevision?' --cool-ash':' --warm-hide';}
 if(emissionRevision)entry.metadata.familyRefinement.emissionRevision=emissionRevision;
 if(materialRevision){entry.metadata.familyRefinement.materialRevision=materialRevision;entry.metadata.familyRefinement.generator+=' --readable-stone';entry.materials=root.listMaterials().map(m=>m.getName());}
 await writeFile(`${target}/catalog.json`,JSON.stringify({assets:[entry],files:{[id]:file}},null,2)+'\n');
 console.log(JSON.stringify({id,sha256:entry.sha256,size,impliedWalkMps:entry.impliedWalkMps,impliedRunMps:entry.impliedRunMps,clips:measurements.clips.map(c=>({name:c.clip,seconds:c.duration,maxGroundCorrection:c.maxCorrection})),nativeShapeAndProtectedMapsUnchanged:true,albedoRevised:!!albedoRevision,materialFactorsRevised:!!materialRevision}));
 process.exit(0);
}
const sourceCatalog=JSON.parse(await readFile(`${base}/catalog.json`,'utf8'));
const atlasSource=await readFile(atlasFile);
const atlas=await sharp(atlasSource).resize(2048,2048).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
await mkdir(out,{recursive:true});
const catalog={assets:[],files:{}};
const protectedBytes=root=>Buffer.concat(root.listMeshes().flatMap(m=>m.listPrimitives().flatMap(p=>['POSITION','NORMAL','JOINTS_0','WEIGHTS_0'].map(s=>p.getAttribute(s)).filter(Boolean).map(a=>Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength)))));
for(const species of ids){
 const id=`creature_${species}`,entry=structuredClone(sourceCatalog.assets.find(a=>a.id===id)??liveCatalog.assets.find(a=>a.id===id));
 const sourcePath=sourceCatalog.files[id]?`${base}/${sourceCatalog.files[id]}`:`game/public/assets/${entry.file}`;
 const doc=await io.read(sourcePath),root=doc.getRoot(),before=hash(protectedBytes(root));
 const geometryEdits=[];
 for(const node of root.listNodes())if(node.getMesh())for(const primitive of node.getMesh().listPrimitives()){
  const name=node.getMesh().getName(),role=primitive.getMaterial().getName();
  const selected=species==='kiln_marrow'?/fused_dorsal_mantle|furnace_rib/.test(name)
   :species==='furnace_grazer'?/shoulder|forearm_crust|crushing_palm|palm_fissure/.test(name)
   :species==='basalt_maw'?(!name||/upper_lobe|lower_mandible|jaw_tooth|dorsal_slab/.test(name))
   :/cleaved_void_slate|eroded_fracture/.test(role);
  if(!selected)continue;
  const accessor=primitive.getAttribute('POSITION'),array=Float32Array.from(accessor.getArray());
  const mat=new T.Matrix4().fromArray(node.getWorldMatrix()),inverse=mat.clone().invert();
  const skin=node.getSkin(),joints=skin?.listJoints(),jointIds=primitive.getAttribute('JOINTS_0')?.getArray();
  const bound=new T.Box3(),v=new T.Vector3();
  for(let i=0;i<array.length;i+=3)bound.expandByPoint(v.fromArray(array,i).applyMatrix4(mat));
  const center=bound.getCenter(new T.Vector3());
  for(let i=0;i<array.length;i+=3){
   v.fromArray(array,i);
   if(species==='basalt_maw'&&!name){
    const taper=T.MathUtils.smoothstep(Math.abs(v.x),1.02,1.50);
    v.x=Math.sign(v.x)*(1.37+(Math.abs(v.x)-1.37)*(1-.32*taper));
    v.z*=1-.34*taper;
    v.y=.65+(v.y-.65)*(1-.18*taper);
   }else if(species==='voidstone_colossus'&&joints&&jointIds){
    // Batched anatomy retains one rigid joint per vertex. Narrow each plate
    // around its own joint without moving the joint or changing leg length.
    const jointIndex=jointIds[i/3*4];
    const pivot=new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(skin.getInverseBindMatrices().getArray(),jointIndex*16).invert());
    const amount=T.MathUtils.smoothstep(v.y,.50,.90);
    v.x=pivot.x+(v.x-pivot.x)*(1-.21*amount);v.z=pivot.z+(v.z-pivot.z)*(1-.20*amount);
   }else{
    v.applyMatrix4(mat);
    const mantle=species==='furnace_grazer'&&/shoulder/.test(name);
    v.x=center.x+(v.x-center.x)*(mantle?.75:species==='basalt_maw'?.80:.86);
    v.z=center.z+(v.z-center.z)*(mantle?.74:.84);
    if(mantle)v.y=center.y+(v.y-center.y)*.78;
    v.applyMatrix4(inverse);
   }
   v.toArray(array,i);
  }
  primitive.setAttribute('POSITION',accessor.clone().setArray(array));
  const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(array,3));
  if(primitive.getIndices())geometry.setIndex(new T.BufferAttribute(primitive.getIndices().getArray(),1));
  geometry.computeVertexNormals();
  primitive.setAttribute('NORMAL',primitive.getAttribute('NORMAL').clone().setArray(Float32Array.from(geometry.getAttribute('normal').array))).setAttribute('TANGENT',null);
  geometry.dispose();geometryEdits.push(name||role);
 }
 const texture=doc.createTexture(`${id}_mineral_hierarchy`).setImage(atlas).setMimeType('image/jpeg');
 for(const mesh of root.listMeshes())for(const primitive of mesh.listPrimitives()){
  const material=primitive.getMaterial(),role=material.getName(),name=mesh.getName();
  if(species==='kiln_marrow'){
   if(/cavities|banked_furnace/.test(role))continue;
   const native=/lava_authored/.test(role);
   material.setBaseColorTexture(texture).setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setMetallicRoughnessTexture(null).setRoughnessFactor(.88);
   // Keep the native emissive and normal UV set intact. Body mineral grain
   // gets its own projection, so retained source masks cannot slide onto limbs.
   material.getBaseColorTextureInfo().setTexCoord(1);
   if(native)material.setEmissiveFactor([.30,.30,.30]);
   const p=primitive.getAttribute('POSITION'),a=p.getArray(),lo=p.getMin([]),hi=p.getMax([]),uv=[];
   const tile=native?0:1,span=Math.max(hi[0]-lo[0],hi[1]-lo[1],.01);
   for(let i=0;i<a.length;i+=3)uv.push((tile%2)*.5+.02+(a[i]-lo[0])/span*.46,Math.floor(tile/2)*.5+.02+(a[i+1]-lo[1])/span*.46);
   primitive.setAttribute('TEXCOORD_1',doc.createAccessor().setType('VEC2').setArray(Float32Array.from(uv)).setBuffer(root.listBuffers()[0]));
   continue;
  }
  if(/recessed_/.test(role)){material.setEmissiveFactor(species==='voidstone_colossus'?[.56,.56,.56]:[.65,.65,.65]);continue;}
  if(/deep_unlit/.test(role))continue;
  material.setBaseColorTexture(texture).setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setMetallicRoughnessTexture(null).setRoughnessFactor(.86);
  let tile=/eroded_fracture|pale_accent/.test(role)?1:0;
  if(species==='furnace_grazer'){
   if(/shoulder_dome|forearm_crust/.test(name))tile=1;
   if(/crushing_palm/.test(name))tile=3;
  }
  if(species==='basalt_maw'){
   if(/upper_lobe|dorsal_slab/.test(name))tile=1;
   if(/mandible|jaw_tooth/.test(name))tile=3;
  }
  const uv=primitive.getAttribute('TEXCOORD_0');if(!uv)throw Error(`${id} missing mapped body`);
  const array=Float32Array.from(uv.getArray()),positions=primitive.getAttribute('POSITION').getArray();
  for(let i=0;i<array.length;i+=2){
   let cell=tile;
   // Colossus is one weighted mesh: retain its original UV shape and give the
   // planted feet and crown a worn limestone material at existing triangle boundaries.
   if(species==='voidstone_colossus'&&!primitive.getIndices()){
    const t=Math.floor(i/6)*9;
    const y=(positions[t+1]+positions[t+4]+positions[t+7])/3;
    if(y<.17||y>2.12)cell=3;
   }
   array[i]=(cell%2)*.5+.018+(((array[i]%.5)+.5)%.5)*.928;
   array[i+1]=Math.floor(cell/2)*.5+.018+(((array[i+1]%.5)+.5)%.5)*.928;
  }
  primitive.setAttribute('TEXCOORD_0',uv.clone().setArray(array));
 }
 const measurements=measureAndGround(doc,`${species}_family_refinement`);
 console.log(JSON.stringify({id,groundCorrections:measurements.clips.map(c=>[c.clip,c.maxCorrection])}));
 if(measurements.clips.some(c=>c.maxCorrection>.20))throw Error(`${id} grounding changed excessively`);
 await doc.transform(prune());
 const file=`${id}.glb`;await io.write(`${out}/${file}`,doc);
 const bytes=await readFile(`${out}/${file}`);
 Object.assign(entry,{sha256:hash(bytes),bytes:bytes.length,materials:root.listMaterials().map(m=>m.getName()),acceptance:{exported:true,labAccepted:false,worldIntegrated:false}});
 const b=measurements.idleBounds;entry.size={x:b.max[0]-b.min[0],y:b.max[1]-b.min[1],z:b.max[2]-b.min[2]};entry.base={x:b.min[0],y:b.min[1],z:b.min[2]};
 entry.metadata.familyRefinement={family:'stone',generator:'tools/wilderness-creatures/families/stone.mjs',atlas:atlasFile,atlasSha256:hash(atlasSource),sourceAssetSha256:hash(await readFile(sourcePath)),sourceGeometrySha256:before,geometryEdits,measurements,scope:'Narrowed grazer mantle and forearms, reduced maw jaw bulk, slimmed colossus plates around retained joints. Midtone blue-grey body, ochre armour, ivory jaw/palms/feet. Normals recomputed, clips retained, ground measured at 120Hz.'};
 catalog.assets.push(entry);catalog.files[id]=file;
 console.log(`${id} ${entry.sha256}`);
}
await writeFile(`${out}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
