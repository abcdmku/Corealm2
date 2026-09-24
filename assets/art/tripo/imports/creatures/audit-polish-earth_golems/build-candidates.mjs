import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../../../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const relative=p=>path.relative(repo,p).replaceAll('\\','/');
const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const builderHash=hash(await readFile(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(await readFile(path.join(here,'source-manifest.json'),'utf8'));
await mkdir(path.join(here,'models'),{recursive:true});
await mkdir(path.join(here,'textures'),{recursive:true});

const variants=[
 {id:'creature_cairn_treader',source:'assets/art/tripo/imports/creatures/audit-polish-earth_golems/sources/creature_cairn_treader.glb',expected:'118d8e7328ecfc6eee2a0c20a18c92718fbe7f9db98adaffe4fc8cf688c5a2ba',tile:'cairn-imagegen.png',scale:[.5,.84,.9],blend:.62,contact:.3095238147949687,warp:{body:1.13,head:.9,arms:1,hands:1,legs:1.12},design:'compact broad-hipped cairn with intact native hands and recessed head'},
 {id:'creature_chalk_warden',source:'assets/art/tripo/imports/creatures/audit-polish-earth_golems/sources/creature_chalk_warden.glb',expected:'7449a44168b62ef14233c1378649d76d9399584c2957bda4e1a8ee3bdcc3888b',tile:'chalk-imagegen.png',scale:[.25,.9,.9],blend:.78,contact:.45,warp:{body:.86,head:2,arms:1,hands:1,legs:.85},design:'tall chalk column with flared capstone and intact native hands'},
 {id:'creature_shale_elemental',source:'assets/art/tripo/imports/creatures/audit-polish-earth_golems/sources/stone-shalewake-native-rig-candidate.glb',expected:'30c0e0c674cdcb30ed90aae25d3a0a233a6513f465256a943ccc53b61651351e',tile:'shale-imagegen.png',scale:[2.25,2.25,2.25],blend:.28,contact:.58,design:'low four-legged stratified shale body'},
];
const assets=[],promotion=[];
for(const v of variants){
 const sourcePath=path.join(repo,v.source),sourceBytes=await readFile(sourcePath);
 if(hash(sourceBytes)!==v.expected)throw new Error(`${v.id}: source changed`);
 const doc=await io.readBinary(sourceBytes),root=doc.getRoot(),meshNode=root.listNodes().find(n=>n.getMesh()&&n.getSkin());
 if(!meshNode)throw new Error(`${v.id}: no skinned mesh`);
 const prim=meshNode.getMesh().listPrimitives()[0],uv=prim.getAttribute('TEXCOORD_0');
 if(!uv||!prim.getAttribute('WEIGHTS_0'))throw new Error(`${v.id}: UV or weights missing`);
 let geometryWarp=null;
 if(v.warp){
  const positions=prim.getAttribute('POSITION'),normals=prim.getAttribute('NORMAL'),joints=prim.getAttribute('JOINTS_0'),weights=prim.getAttribute('WEIGHTS_0');
  const arr=new Float32Array(positions.getArray());
  let maxLocalDisplacement=0,changedVertices=0,protectedArmHandVertices=0,maxProtectedArmHandDisplacement=0;
  const group=k=>k===3||k===4?'head':k>=5&&k<=50?(k>=8&&k<=27||k>=31&&k<=50?'hands':'arms'):k>=51?'legs':'body';
  for(let i=0;i<positions.getCount();i++){
   const js=[],ws=[];joints.getElement(i,js);weights.getElement(i,ws);
   let factor=0;for(let k=0;k<4;k++)factor+=ws[k]*v.warp[group(js[k])];
   if(v.id==='creature_chalk_warden'){
    let headWeight=0;for(let k=0;k<4;k++)if(group(js[k])==='head')headWeight+=ws[k];
    const cap=Math.max(0,Math.min(1,(arr[i*3+1]-7.7)/2.2));
    factor+=headWeight*2.4*cap;
   }
   const before=arr[i*3];arr[i*3]*=factor;
   if(js.every((joint,k)=>ws[k]===0||joint>=5&&joint<=50)){
    protectedArmHandVertices++;
    maxProtectedArmHandDisplacement=Math.max(maxProtectedArmHandDisplacement,Math.abs(arr[i*3]-before));
   }
   maxLocalDisplacement=Math.max(maxLocalDisplacement,Math.abs(arr[i*3]-before));
   if(Math.abs(arr[i*3]-before)>1e-6)changedVertices++;
  }
  positions.setArray(arr);
  if(normals&&!prim.getIndices()){
   const n=new Float32Array(arr.length);
   for(let i=0;i<arr.length;i+=9){
    const ax=arr[i+3]-arr[i],ay=arr[i+4]-arr[i+1],az=arr[i+5]-arr[i+2];
    const bx=arr[i+6]-arr[i],by=arr[i+7]-arr[i+1],bz=arr[i+8]-arr[i+2];
    let x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;
    const len=Math.hypot(x,y,z)||1;x/=len;y/=len;z/=len;
    for(let k=0;k<3;k++){n[i+k*3]=x;n[i+k*3+1]=y;n[i+k*3+2]=z;}
   }
   normals.setArray(n);
  }
  if(maxProtectedArmHandDisplacement>1e-6)throw new Error(`${v.id}: native arm/hand geometry shifted`);
  geometryWarp={factors:v.warp,changedVertices,maxLocalDisplacement,protectedArmHandVertices,maxProtectedArmHandDisplacement,uvPreserved:true,weightsPreserved:true,clipsPreserved:true};
 }
 const material=prim.getMaterial(),texture=material.getBaseColorTexture();
 if(!texture?.getImage())throw new Error(`${v.id}: no base color map`);
 const old=texture.getImage(),meta=await sharp(old).metadata(),w=meta.width,h=meta.height;
 const native=await sharp(old).ensureAlpha().raw().toBuffer();
 const tileFile=path.join(here,'textures',v.tile),tileOriginal=await readFile(tileFile);
 const tileMeta=await sharp(tileOriginal).metadata();
 // Imagegen's two pale tiles have transparent vignette margins. Only use their detailed center.
 const crop=v.id==='creature_shale_elemental'?{left:0,top:0,width:tileMeta.width,height:tileMeta.height}:{left:Math.round(tileMeta.width*.18),top:Math.round(tileMeta.height*.18),width:Math.round(tileMeta.width*.64),height:Math.round(tileMeta.height*.64)};
 const tile=await sharp(tileOriginal).extract(crop).resize(w,h).ensureAlpha().raw().toBuffer();
 const out=Buffer.from(native);
 for(let i=0;i<w*h;i++){
  const p=i*4,nl=(native[p]+native[p+1]+native[p+2])/3;
  let a=v.blend;
  // Preserve the source atlas's bright, unused padding and the darkest recesses.
  if(v.id==='creature_shale_elemental')a*=Math.max(0,Math.min(1,(215-nl)/95));
  else if(nl<42)a*=.26;
  for(let c=0;c<3;c++)out[p+c]=Math.round(native[p+c]*(1-a)+tile[p+c]*a);
 }
 const atlas=await sharp(out,{raw:{width:w,height:h,channels:4}}).removeAlpha().jpeg({quality:91,chromaSubsampling:'4:4:4'}).toBuffer();
 const atlasName=`${v.id}-atlas.jpg`;
 await writeFile(path.join(here,'textures',atlasName),atlas);
 texture.setImage(atlas).setMimeType('image/jpeg').setName(`${v.id}_layered_geology`);
 const sceneRoot=root.listScenes()[0].listChildren()[0],prior=sceneRoot.getScale();
 sceneRoot.setScale(prior.map((x,i)=>x*v.scale[i]));
 const clips=root.listAnimations().map(c=>({name:c.getName(),duration:Math.max(...c.listSamplers().map(s=>{const x=s.getInput().getArray();return x[x.length-1]}))}));
 const required=['Idle','Walk','Run','Attack','Hit','Death'];
 if(!required.every(n=>clips.some(c=>c.name===n)))throw new Error(`${v.id}: missing clip`);
 const bounds=deformedBounds(doc),size=bounds.max.map((x,i)=>x-bounds.min[i]);
 if(!size.every(Number.isFinite)||size[1]<.7||size[1]>2.2)throw new Error(`${v.id}: bad bounds ${JSON.stringify(bounds)}`);
 const binary=await io.writeBinary(doc),model=`models/${v.id}.glb`;
 await writeFile(path.join(here,model),binary);
 const reread=await io.readBinary(binary);
 if(reread.getRoot().listAnimations().length!==root.listAnimations().length||reread.getRoot().listNodes().find(n=>n.getMesh())?.getSkin()?.listJoints().length!==meshNode.getSkin().listJoints().length)throw new Error(`${v.id}: roundtrip rig/clip loss`);
 const nativeAsset=manifest.assets.find(a=>a.id===v.id);
 if(!nativeAsset)throw new Error(`${v.id}: no production manifest record`);
 const record={id:v.id,file:nativeAsset.file,pack:nativeAsset.pack,category:'character',is:v.id.replaceAll('_',' '),tags:['creature','earth','polish','candidate'],bytes:binary.length,sha256:hash(binary),triangles:Math.floor((prim.getIndices()?.getCount()??prim.getAttribute('POSITION').getCount())/3),size:{x:size[0],y:size[1],z:size[2]},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},groundY:bounds.min[1],animations:clips.map(c=>c.name),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:clips.find(c=>c.name==='Walk').duration,runClipSeconds:clips.find(c=>c.name==='Run').duration,attackSeconds:clips.find(c=>c.name==='Attack').duration,contactNormalized:v.contact,candidateReview:{labAccepted:false,worldIntegrated:false}};
 assets.push(record);
 promotion.push({id:v.id,status:'awaiting-root-lab-review',source:{file:v.source,sha256:v.expected,bytes:sourceBytes.length,original:v.id==='creature_shale_elemental'?JSON.parse(await readFile(path.join(repo,'assets/art/tripo/imports/creatures/nine-pack-two/shalewake/provenance.json'),'utf8')):{url:nativeAsset.sourceProvenance?.url,author:nativeAsset.sourceProvenance?.author,license:nativeAsset.sourceProvenance?.license,attribution:nativeAsset.sourceProvenance?.attribution}},builder:{file:relative(fileURLToPath(import.meta.url)),sha256:builderHash},candidate:{file:relative(path.join(here,model)),sha256:hash(binary),bytes:binary.length,bounds,vertices:prim.getAttribute('POSITION').getCount(),triangles:record.triangles,joints:meshNode.getSkin().listJoints().length,materials:root.listMaterials().map(m=>m.getName()),clips,attack:{duration:clips.find(c=>c.name==='Attack').duration,contactNormalized:v.contact,contactReviewRequired:true}},texture:{imagegenTile:`textures/${v.tile}`,imagegenTileSha256:hash(tileOriginal),runtimeAtlas:`textures/${atlasName}`,runtimeAtlasSha256:hash(atlas),uvPreserved:true,sourceNormalPreserved:true},geometryWarp,design:v.design,recommendation:{level:13,bodyHeightM:Math.round(size[1]*100)/100,clearanceRadiusM:Math.ceil(Math.max(size[0],size[2])/2*10)/10},acceptance:{cpuStructureChecked:true,labAccepted:false,visualAccepted:false,worldIntegrated:false}});
 console.log(`${v.id}: ${size.map(x=>x.toFixed(2)).join(' x ')} m, ${binary.length} bytes, ${clips.length} clips`);
}
await writeFile(path.join(here,'lab-catalog.json'),JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets,files:Object.fromEntries(assets.map(a=>[a.id,`models/${a.id}.glb`]))},null,2)+'\n');
await writeFile(path.join(here,'promotion.json'),JSON.stringify({schema:'corealm-earth-golem-polish/1',variants:promotion},null,2)+'\n');
