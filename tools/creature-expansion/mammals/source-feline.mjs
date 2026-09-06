import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=new URL('../../../art/rebuild/candidates/finish-quadrupeds/source-feline/',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const get=async url=>{const r=await fetch(url,{headers:{'User-Agent':'Corealm-source-evaluation'}});if(!r.ok)throw Error(`${r.status} ${url}`);return Buffer.from(await r.arrayBuffer());};
await mkdir(out,{recursive:true});
if(process.argv.includes('--download')){
  const commit=JSON.parse((await get('https://api.github.com/repos/nrz/ylikuutio/commits/master')).toString()).sha;
  const base=`https://raw.githubusercontent.com/nrz/ylikuutio/${commit}/`;
  const folder='res/objects/www.blendswap.com/86110_rigged_and_animated_cat/';
  const assets=[
    ['cat.original.fbx',base+folder+'cat.fbx'],
    ['LICENSE.original.html',base+folder+encodeURIComponent('86110 - LICENSE.html')],
    ['mirror-README.original.md',base+'README.md'],
    ['creator-page.original.html','https://blendswap.com/blend/18519'],
    ['creator-preview.original.jpg','https://blendswap.com/blend_previews/18519/0/500?v=68bdf07e'],
    ['mirror-preview.original.png',base+'screenshots/cats_2020-10-08.png'],
    ['simple-cat.original.zip','https://opengameart.org/sites/default/files/cat.zip'],
    ['simple-cat-free.original.png','https://opengameart.org/sites/default/files/cat_free.png'],
    ['simple-cat-preview.original.png','https://opengameart.org/sites/default/files/catfree.png'],
    ['simple-cat-page.original.html','https://opengameart.org/content/simple-cat'],
  ];
  const files=[];
  for(const [file,url]of assets){const bytes=await get(url);await writeFile(new URL(file,out),bytes);files.push({file,url,bytes:bytes.length,sha256:hash(bytes)});}
  await writeFile(new URL('provenance.json',out),JSON.stringify({downloadedAt:new Date().toISOString(),mirrorCommit:commit,files,
    primary:{title:'Rigged and animated Cat',author:'JonasDichelle',creatorUrl:'https://blendswap.com/blend/18519',license:'CC-BY-3.0',licenseUrl:'https://creativecommons.org/licenses/by/3.0/',mirror:'https://github.com/nrz/ylikuutio',mirrorChanges:'Original cat.blend exported to FBX by Ylikuutio project. Complete FBX staged unchanged. Mirror README explicitly credits author and license.',localModifications:'None'},
    secondary:{title:'Simple Cat',author:'drummyfish',creatorUrl:'https://opengameart.org/content/simple-cat',license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',texture:'Use separately supplied cat_free.png, expressly authored from scratch by drummyfish; original archive photo texture not selected.',localModifications:'None'},
    accessNotes:['BlendSwap direct download requires sign-in; not attempted beyond public download page.','Public GitHub redistribution includes original license and explicit credit to JonasDichelle.','No authentication bypass, purchase, GPU render or production conversion.']},null,2)+'\n');
}
const provenance=JSON.parse(await readFile(new URL('provenance.json',out),'utf8'));
for(const f of provenance.files){const bytes=await readFile(new URL(f.file,out));if(hash(bytes)!==f.sha256)throw Error(`Hash mismatch ${f.file}`);}
console.log(JSON.stringify({files:provenance.files.map(({file,bytes,sha256})=>({file,bytes,sha256})),mirrorCommit:provenance.mirrorCommit}));
if(process.argv.includes('--inspect')){
  const THREE=await import('three');
  const {FBXLoader}=await import('three/addons/loaders/FBXLoader.js');
  // Inspect geometry/rig without decoding textures or creating a renderer.
  globalThis.window={URL:globalThis.URL};
  const originalLoad=THREE.TextureLoader.prototype.load;
  const requestedTextures=[];
  THREE.TextureLoader.prototype.load=function(url){requestedTextures.push({url,path:this.path});return new THREE.Texture();};
  try{
    const bytes=await readFile(new URL('cat.original.fbx',out));
    const object=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');object.updateMatrixWorld(true);
    const meshes=[],bones=[],box=new THREE.Box3();
    object.traverse(node=>{
      if(node.isBone)bones.push(node.name);
      if(!node.isMesh)return;
      const p=node.geometry.getAttribute('position'),w=node.geometry.getAttribute('skinWeight');let invalidWeights=0;
      if(w)for(let i=0;i<w.count;i++){let sum=0;for(let k=0;k<4;k++)sum+=w.getComponent(i,k);if(!Number.isFinite(sum)||Math.abs(sum-1)>.002)invalidWeights++;}
      const q=new THREE.Vector3();for(let i=0;i<p.count;i++)box.expandByPoint(q.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld));
      meshes.push({name:node.name,vertices:p.count,triangles:(node.geometry.index?.count??p.count)/3,skinned:!!node.isSkinnedMesh,invalidWeights,joints:node.skeleton?.bones.map(b=>b.name),materials:(Array.isArray(node.material)?node.material:[node.material]).map(m=>m.name)});
    });
    const report={sourceSha256:hash(bytes),loader:'Three FBXLoader CPU parse; texture decoding skipped',requestedTextures,meshes,bones,bounds:{min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new THREE.Vector3()).toArray(),units:'FBX loader units, not yet normalized'},animations:object.animations.map(a=>({name:a.name,duration:a.duration,tracks:a.tracks.length})),converted:false,previewInspected:'Creator full-body preview and redistributor screenshot inspected before conversion',accepted:false};
    await writeFile(new URL('source-inspection.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  }finally{THREE.TextureLoader.prototype.load=originalLoad;delete globalThis.window;}
}
if(process.argv.includes('--stage-catalogue')){
  const {NodeIO}=await import('@gltf-transform/core');const {KHRONOS_EXTENSIONS}=await import('@gltf-transform/extensions');const THREE=await import('three');
  const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS),input=await readFile(new URL('Cat.source-import.glb',out)),doc=await io.readBinary(input),root=doc.getRoot(),box=new THREE.Box3();
  const primitiveAudit=[];
  for(const node of root.listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){
    const position=p.getAttribute('POSITION'),matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for(let i=0;i<position.getCount();i++)box.expandByPoint(new THREE.Vector3(...position.getElement(i,[])).applyMatrix4(matrix));
    primitiveAudit.push({vertices:position.getCount(),triangles:p.getIndices().getCount()/3,attributes:p.listSemantics(),material:p.getMaterial().getName()});
  }
  const payload=()=>{const h=createHash('sha256');for(const a of root.listAccessors()){const v=a.getArray();h.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}return h.digest('hex');};
  const originalPayload=payload(),scale=.1;
  for(const scene of root.listScenes()){
    const parent=doc.createNode('Cat_Source_Preview_Scale_01').setScale([scale,scale,scale]);
    for(const child of [...scene.listChildren()]){scene.removeChild(child);parent.addChild(child);}scene.addChild(parent);
  }
  if(payload()!==originalPayload)throw Error('Scale wrapper modified mesh payload');
  const output=Buffer.from(await io.writeBinary(doc));await writeFile(new URL('Cat.preview.glb',out),output);
  const xyz=a=>({x:a[0],y:a[1],z:a[2]}),min=box.min.toArray().map(v=>v*scale),max=box.max.toArray().map(v=>v*scale),id='creature_duskoak_lynx';
  const pack={id:'jonasdichelle-cat-source-review',name:'JonasDichelle complete Cat source review',author:'JonasDichelle; FBX redistribution by nrz/Ylikuutio',source:provenance.primary.creatorUrl,license:'CC-BY-3.0',archiveSha256:provenance.files.find(f=>f.file==='cat.original.fbx').sha256};
  const asset={id,file:'models/creature/creature_duskoak_lynx.glb',pack:pack.id,category:'character',is:'cat',tags:['animal','cat','source-review','static'],bytes:output.length,sha256:hash(output),size:xyz(max.map((v,i)=>v-min[i])),base:xyz(min),groundY:min[1],bounds:{min,max},animations:[],materials:root.listMaterials().map(m=>m.getName()),triangles:primitiveAudit.reduce((s,p)=>s+p.triangles,0),
    sourceProvenance:{...provenance.primary,mirrorCommit:provenance.mirrorCommit,sourceSha256:pack.archiveSha256,modifications:'Blender 4.5.11 CPU FBX import and glTF export with UVs/normals/all vertex colours; uniform .1 preview root scale after automatic FBX centimetre conversion; source body, materials and pose otherwise unchanged. No Lynx adaptation, rig or animations.'}};
  await writeFile(new URL('preview-catalogue.json',out),JSON.stringify({schema:1,scope:'Complete static source Cat anatomy preview. Existing Lynx id used only for request interception. No native animations, no fabricated clip names, no production promotion.',pack,assets:[asset],files:{[id]:'Cat.preview.glb'}},null,2)+'\n');
  const audit={sourceFbxSha256:pack.archiveSha256,sourceImportGlbSha256:hash(input),previewGlbSha256:hash(output),importPrimitiveAudit:primitiveAudit,accessorPayloadSha256:originalPayload,accessorPayloadUnchanged:true,additionalScale:scale,rotationAdded:false,bounds:asset.bounds,
    materials:root.listMaterials().map(m=>({name:m.getName(),baseColorFactor:m.getBaseColorFactor(),roughness:m.getRoughnessFactor(),metallic:m.getMetallicFactor(),hasBaseTexture:!!m.getBaseColorTexture()})),textures:root.listTextures().length,animations:root.listAnimations().length,
    limits:['Static neutral-grey anatomy only. No textures were present in FBX or its repository sibling folder.','Original all-white Col attribute preserved alongside exporter neutral COLOR_0. UVMap and normals exported.','Only skin has assigned polygons; other two empty material slots are not exported.','Blender triangulation produces 45296 triangles versus Three FBXLoader 45290; original 22648 polygon surface retained without decimation.','Preview scale is .1 after automatic Blender FBX unit conversion, not .01. Total upright-tail height .928m is a display choice, not a Lynx anatomy fit.','Do not request run/attack/hit/death in this zero-animation static preview.']};
  await writeFile(new URL('preview-proof.json',out),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({catalogue:new URL('preview-catalogue.json',out).pathname,asset,audit}));
}
if(process.argv.includes('--neutral-preview')){
  const {NodeIO}=await import('@gltf-transform/core');const {KHRONOS_EXTENSIONS}=await import('@gltf-transform/extensions');
  const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS),source=await readFile(new URL('Cat.preview.glb',out)),doc=await io.readBinary(source);
  const accessorHash=d=>{const h=createHash('sha256');for(const a of d.getRoot().listAccessors()){const v=a.getArray();h.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}return h.digest('hex');};
  const before=accessorHash(doc),originalMaterials=doc.getRoot().listMaterials().map(m=>({name:m.getName(),color:m.getBaseColorFactor(),metallic:m.getMetallicFactor(),roughness:m.getRoughnessFactor()}));
  for(const m of doc.getRoot().listMaterials())m.setBaseColorFactor([.8,.8,.8,1]).setMetallicFactor(0).setRoughnessFactor(.85);
  const output=Buffer.from(await io.writeBinary(doc)),reread=await io.readBinary(output);
  if(accessorHash(reread)!==before)throw Error('Neutral material variant changed accessor payload');
  await writeFile(new URL('Cat.neutral-preview.glb',out),output);
  const catalog=JSON.parse(await readFile(new URL('preview-catalogue.json',out),'utf8')),entry=catalog.assets[0];
  entry.bytes=output.length;entry.sha256=hash(output);entry.sourceProvenance.modifications+=' Inspection material only: neutral grey0.8, metallic0, roughness0.85. No final coat acceptance.';
  catalog.scope='Whole static Cat anatomy inspection with explicit neutral material. Original import material remains in preview-catalogue.json. No final coat or body acceptance.';
  catalog.files[entry.id]='Cat.neutral-preview.glb';
  await writeFile(new URL('neutral-preview-catalogue.json',out),JSON.stringify(catalog,null,2)+'\n');
  await writeFile(new URL('neutral-preview-proof.json',out),JSON.stringify({originalPreviewSha256:hash(source),neutralPreviewSha256:hash(output),originalMaterials,neutralMaterials:[{color:[.8,.8,.8,1],metallic:0,roughness:.85}],geometryAccessorPayloadSha256:before,parsedAccessorPayloadUnchanged:true,originalFileAndCatalogueUnchanged:true,animationCount:reread.getRoot().listAnimations().length,scope:'Anatomy inspection material only; no final coat acceptance or geometry edits.'},null,2)+'\n');
  console.log(JSON.stringify({neutralFile:'Cat.neutral-preview.glb',bytes:output.length,sha256:hash(output),accessorPayloadSha256:before,animationCount:reread.getRoot().listAnimations().length}));
}
if(process.argv.includes('--baked-catalogue')||process.argv.includes('--lynx-catalogue')||process.argv.includes('--actor-catalogue')||process.argv.includes('--actor2-catalogue')){
  const actor2=process.argv.includes('--actor2-catalogue'),actor=process.argv.includes('--actor-catalogue')||actor2,lynx=process.argv.includes('--lynx-catalogue')||actor,lead=actor2?'actor2-':(actor?'actor-':(lynx?'lynx-':'')),file=actor2?'Lynx.actor-contact-v2.glb':(actor?'Lynx.actor-baked.glb':(lynx?'Lynx.adapted-baked.glb':'Cat.corrected-baked.glb'));
  const THREE=await import('three');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const bytes=await readFile(new URL(file,out));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const mixer=new THREE.AnimationMixer(gltf.scene),box=new THREE.Box3(),q=new THREE.Vector3();
  const probes=JSON.parse(await readFile(new URL(lead+'baked-three-probes.json',out),'utf8'));let probeMax=0,probeCount=0;
  for(const probe of probes){
    mixer.stopAllAction();const clip=gltf.animations.find(c=>c.name===probe.clip);const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(probe.time);gltf.scene.updateMatrixWorld(true);
    const body=gltf.scene.getObjectByName('Cat');body.skeleton.update();
    for(let i=0;i<probe.indices.length;i++){body.getVertexPosition(probe.indices[i],q);q.applyMatrix4(body.matrixWorld);probeMax=Math.max(probeMax,q.distanceTo(new THREE.Vector3(...probe.positions[i])));probeCount++;}
  }
  mixer.stopAllAction();mixer.clipAction(gltf.animations.find(c=>c.name===(actor?'Idle':'Walk'))).play();mixer.setTime(0);gltf.scene.updateMatrixWorld(true);
  let triangles=0;const meshAudit=[];
  gltf.scene.traverse(n=>{if(!n.isMesh)return;n.skeleton?.update();const p=n.geometry.attributes.position;for(let i=0;i<p.count;i++){n.getVertexPosition(i,q);box.expandByPoint(q.applyMatrix4(n.matrixWorld));}triangles+=(n.geometry.index?.count??p.count)/3;meshAudit.push({name:n.name,vertices:p.count,skinJoints:n.skeleton?.bones.length});});
  const validation=JSON.parse(await readFile(new URL(lead+'baked-interpolation-report.json',out),'utf8'));
  const catalogue=JSON.parse(await readFile(new URL('neutral-preview-catalogue.json',out),'utf8')),asset=catalogue.assets[0];
  const xyz=v=>({x:v.x,y:v.y,z:v.z});
  Object.assign(asset,{bytes:bytes.length,sha256:hash(bytes),size:xyz(box.getSize(new THREE.Vector3())),base:xyz(box.min),bounds:{min:box.min.toArray(),max:box.max.toArray()},groundY:box.min.y,triangles,animations:gltf.animations.map(c=>c.name),animationMetadata:gltf.animations.map(c=>({name:c.name,duration:c.duration})),tags:['animal','cat','source-derived-baked-rig','inspection']});
  asset.sourceProvenance={...asset.sourceProvenance,sourceSha256:'b12adb6b0a0d061b1909a4095d3f75ad1f919d1eb01b10ecbf0edfd5f6311488',historicalMirrorCommit:'864ea1982524367ed416803db425f1895e4a0717',modifications:'Historical full source rig baked at 192 Hz into flat standard joints with 76 shared corrective pairs and four native shear frames. Four fitted normalized influences; native hierarchy and channels replaced. Complete original body topology/UVs, reduced original eyes, neutral material. Walk/Run durations retained; no Idle/Attack/Hit/Death aliases. Source placement removed and .1 display scaling baked into skin transforms.',limits:validation.splits};
  catalogue.scope='Source-derived baked Cat inspection candidate. Numerical conversion proof exists; hardware anatomy/motion/shading acceptance remains pending. No Lynx adaptation in this file.';catalogue.files[asset.id]='Cat.corrected-baked.glb';
  if(lynx){asset.is='lynx';asset.tags=['animal','lynx','source-adapted-baked-rig','inspection'];asset.sourceProvenance.modifications+=' Species adaptation: connected closed stub tail about13.5 cm, broadened paws, connected cheek ruff, narrowed dark-tipped ears, grey-buff dapple vertex coat. Tail/ear rest chains adapted and all evaluated matrices rebaked/refitted against full-weight adapted rig. This intentionally changes source anatomy and deformation.';catalogue.scope='Complete source-derived Lynx adaptation candidate with baked/refitted Walk/Run only. Hardware species, material, motion and contact acceptance pending.';catalogue.files[asset.id]=file;}
  if(actor){
    catalogue.pack.archiveSha256=asset.sourceProvenance.sourceSha256;asset.sourceProvenance.mirrorCommit='864ea1982524367ed416803db425f1895e4a0717';
    asset.impliedWalkMps=.65;asset.impliedRunMps=2.2;
    asset.sourceProvenance.modifications+=' New3s calm Idle authored from adapted rest pose with independent breathing, head and ear motion; four planted feet. Walk/Run contact timing, paw orientation and leg IK explicitly modified using measured actual sole vertices, with bounded body-lowering for leg reach. Inconsistent native endpoint poses replaced with periodic cubic closure at unchanged clip durations. Four-weight fit reoptimized against all three motions. Ground reference is adapted rest sole floor. Source-space stance speeds0.65/2.2m/s measured on final weighted sole vertices; game movement stats and cadence caps unchanged.';
    catalogue.scope='Lynx actor motion candidate: genuine Idle and source-derived contact-repaired periodic Walk/Run. Numerical rig/contact/loop reports accompany candidate; hardware acceptance remains pending. Combat/death clips remain absent.';
  }
  if(actor2){
    asset.sourceProvenance.modifications=asset.sourceProvenance.modifications.replace('Source-space stance speeds0.65/2.2m/s measured on final weighted sole vertices;','Source-space stance speed targets0.65/2.2m/s;');
    asset.sourceProvenance.modifications+=' Revision2: rest-centered stance anchors; source body-pose amplitudes attenuated to22% Run and50% Walk for reachable authored contacts. Paw lift/descent <=10mm/s through the physical contact band; horizontal release0.6–1.6mm; paw orientation held until4mm clearance. Adaptive contact-band keys augment192Hz baking. Anatomical bind pivots and matching inverse-bind matrices replace identity-bind flattening, with shared corrective frames retained. Speeds are authored targets; independent maximum-XYZ vertex contact and generic blend reports determine actual acceptance.';
    catalogue.scope='Isolated revision2 Lynx actor motion candidate. Frozen revision1 and source review candidates preserved. CPU contact, deformation and blend reports must be checked; no hardware or production acceptance implied.';
  }
  await writeFile(new URL(lead+'baked-preview-catalogue.json',out),JSON.stringify(catalogue,null,2)+'\n');
  await writeFile(new URL(lead+'baked-three-proof.json',out),JSON.stringify({glbSha256:hash(bytes),probeCount,pythonVsThreeMaxMetres:probeMax,meshAudit,bounds:asset.bounds,animations:asset.animations,hardwareAccepted:false},null,2)+'\n');
  if(probeMax>1e-5)throw Error(`Three interpolation mismatch ${probeMax}`);
  console.log(JSON.stringify({bakedCatalogue:lead+'baked-preview-catalogue.json',probeCount,pythonVsThreeMaxMetres:probeMax,bounds:asset.bounds,animations:asset.animations}));
}
if(process.argv.includes('--ground-baked-catalogue')||process.argv.includes('--ground-lynx-catalogue')){
  const lynx=process.argv.includes('--ground-lynx-catalogue'),lead=lynx?'lynx-':'',input=lynx?'Lynx.adapted-baked.glb':'Cat.corrected-baked.glb',outputFile=lynx?'Lynx.adapted-baked-grounded.glb':'Cat.corrected-baked-grounded.glb';
  const source=await readFile(new URL(input,out)),catalogue=JSON.parse(await readFile(new URL(lead+'baked-preview-catalogue.json',out),'utf8'));
  const jsonLength=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+jsonLength).toString()),binaryChunk=source.subarray(20+jsonLength),asset=catalogue.assets[0],offset=-asset.bounds.min[1];
  for(const scene of doc.scenes){const wrapper=doc.nodes.length;doc.nodes.push({name:'Constant_Walk_Start_Floor_Preview_Placement',translation:[0,offset,0],children:[...scene.nodes]});scene.nodes=[wrapper];}
  const j=Buffer.from(JSON.stringify(doc)),padding=Buffer.alloc((4-j.length%4)%4,32),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+j.length+padding.length+binaryChunk.length,8);header.writeUInt32LE(j.length+padding.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const output=Buffer.concat([header,j,padding,binaryChunk]);await writeFile(new URL(outputFile,out),output);
  asset.bytes=output.length;asset.sha256=hash(output);asset.bounds.min[1]+=offset;asset.bounds.max[1]+=offset;asset.base.y+=offset;asset.groundY+=offset;asset.sourceProvenance.modifications+=` Constant whole-scene preview translation Y +${offset} m places Walk time-zero minimum at yard floor. This is preview placement, not native contact correction.`;
  catalogue.files[asset.id]=outputFile;catalogue.scope+=' Constant Walk-start floor placement variant; raw baked GLB/catalogue preserved.';
  await writeFile(new URL(lead+'baked-grounded-preview-catalogue.json',out),JSON.stringify(catalogue,null,2)+'\n');
  await writeFile(new URL(lead+'baked-ground-placement-proof.json',out),JSON.stringify({sourceSha256:hash(source),outputSha256:hash(output),constantYTranslation:offset,reference:'Whole skinned source at Walk time zero; minimum coincides with paw sole region. No per-frame/root-motion/contact changes.',binaryAccessorPayloadUnchanged:output.subarray(20+j.length+padding.length).equals(binaryChunk),rawFilePreserved:true},null,2)+'\n');
  console.log(JSON.stringify({catalogue:lead+'baked-grounded-preview-catalogue.json',constantYTranslation:offset,sha256:hash(output)}));
}
