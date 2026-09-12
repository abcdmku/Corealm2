import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {NodeIO} from '@gltf-transform/core';
import {weld} from '@gltf-transform/functions';
import sharp from 'sharp';
const OUT='test-results/medieval-bridge', DIR='tools/medieval-bridge', id='crownward_timber_bridge';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=JSON.parse(await fs.readFile(`${DIR}/source-members.json`));
const bytes=await fs.readFile(rows[0].path);
if(hash(bytes)!==rows[0].sha256)throw Error('FBX source changed');
globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.()})}readAsDataURL(b){b.arrayBuffer().then(v=>{this.result=`data:${b.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.()})}};
const manager=new T.LoadingManager();manager.addHandler(/./,{path:'',setPath(){return this},load(){return new T.Texture()}});
const source=new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');source.updateMatrixWorld(true);
const box=new T.Box3().setFromObject(source,true), size=box.getSize(new T.Vector3()), center=box.getCenter(new T.Vector3());
const s=6.938079/size.x, worldScale=3.4591707591773826, approachSourceY=54.86465, approachTargetY=.65/worldScale;
const transform=new T.Matrix4().makeScale(s,s,s);transform.setPosition(-center.x*s,approachTargetY-approachSourceY*s,-center.z*s);
const normalized=new T.Group();normalized.name='user_medieval_bridge';
source.traverse(node=>{if(!node.isMesh)return;const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld).applyMatrix4(transform);const sourceMaterials=Array.isArray(node.material)?node.material:[node.material];const materials=sourceMaterials.map(m=>new T.MeshStandardMaterial({name:m.name,color:m.color.clone(),roughness:.9,metalness:m.name==='Metal Taper'?.85:0,side:T.DoubleSide}));normalized.add(new T.Mesh(geometry,materials));});normalized.updateMatrixWorld(true);
const normalizedBox=new T.Box3().setFromObject(normalized,true);
const ray=new T.Raycaster();const deckProfile=[];
for(let x=-3.45;x<=3.451;x+=.1){ray.set(new T.Vector3(x,10,0),new T.Vector3(0,-1,0));const hits=ray.intersectObject(normalized,true).filter(hit=>hit.face.materialIndex===1);deckProfile.push({x:+x.toFixed(4),y:hits.length?+hits[0].point.y.toFixed(6):null});}
const io=new NodeIO();const doc=await io.readBinary(new Uint8Array(await new GLTFExporter().parseAsync(normalized,{binary:true,onlyVisible:false})));
const texture=async(index,name,invert=false,normal=false)=>{let b=await fs.readFile(rows[index].path);if(hash(b)!==rows[index].sha256)throw Error('Texture source changed');if(invert)b=await sharp(b).negate({alpha:false}).png().toBuffer();if(normal){const raw=await sharp(b).removeAlpha().raw().toBuffer({resolveWithObject:true});for(let p=1;p<raw.data.length;p+=raw.info.channels)raw.data[p]=255-raw.data[p];b=await sharp(raw.data,{raw:raw.info}).png().toBuffer();}b=await sharp(b).flip().png().toBuffer();return doc.createTexture(name).setImage(b).setMimeType('image/png');};
const bindings={
 'Wood_Fence':{base:5,normal:8,rough:11,invert:true,ao:1},
 'Pavemet':{base:2,normal:6,rough:10,ao:13},
 'Rock_2':{base:4,normal:15,rough:3,invert:true,ao:7},
 'Rock':{base:4,normal:15,rough:3,invert:true,ao:7},
 'Metal Taper':{base:16,normal:9,rough:12,metal:14},
};
const cache=new Map();const tex=async(i,inv,normal=false)=>{const k=`${i}:${inv??false}:${normal}`;if(!cache.has(k))cache.set(k,await texture(i,`${path.basename(rows[i].path)}${inv?'_roughness_from_smoothness':''}${normal?'_gltf_normal_green_flipped':''}`,inv,normal));return cache.get(k)};
for(const material of doc.getRoot().listMaterials()){
 const b=bindings[material.getName()];if(!b)throw Error('Unknown material');
 material.setBaseColorTexture(await tex(b.base)).setNormalTexture(await tex(b.normal,false,true)).setNormalScale(1).setRoughnessFactor(1).setMetallicFactor(b.metal===undefined?0:1);
 // glTF packs roughness in G and metalness in B. Source grayscale roughness maps can be reused for dielectric materials.
 if(b.metal===undefined)material.setMetallicRoughnessTexture(await tex(b.rough,b.invert));
 else{const rough=await sharp(await fs.readFile(rows[b.rough].path)).removeAlpha().greyscale().raw().toBuffer({resolveWithObject:true});const metal=await sharp(await fs.readFile(rows[b.metal].path)).resize(rough.info.width,rough.info.height).removeAlpha().greyscale().raw().toBuffer();const pixels=Buffer.alloc(rough.info.width*rough.info.height*3);for(let i=0;i<metal.length;i++){pixels[i*3]=255;pixels[i*3+1]=rough.data[i];pixels[i*3+2]=metal[i]}const packed=await sharp(pixels,{raw:{width:rough.info.width,height:rough.info.height,channels:3}}).flip().png().toBuffer();material.setMetallicRoughnessTexture(doc.createTexture('metal_roughness_packed').setImage(packed).setMimeType('image/png'));}
 if(b.ao!==undefined)material.setOcclusionTexture(await tex(b.ao)).setOcclusionStrength(.8);
 for(const get of ['getBaseColorTextureInfo','getNormalTextureInfo','getMetallicRoughnessTextureInfo','getOcclusionTextureInfo'])material[get]?.()?.setWrapS(10497).setWrapT(10497);
}
await doc.transform(weld());
await fs.mkdir(`${OUT}/models/medieval-bridge`,{recursive:true});const file='models/medieval-bridge/user_medieval_bridge.glb';const glb=await io.writeBinary(doc);await fs.writeFile(`${OUT}/${file}`,glb);
const vec=v=>({x:v.x,y:v.y,z:v.z});
const pack={id:'user-supplied-medieval-bridge',name:'User supplied medieval bridge',source:'User attachment medieval_bridge.zip',license:'User-supplied; license not provided',author:'Not supplied',archiveName:'medieval_bridge.zip',archiveSha256:'pending-root-source-archive-hash'};
const archive='C:/Users/Borg/.t3/userdata/attachments/3c7e3bd2-1709-4576-9a6c-a3d8b5fcadcc-533940f0-1953-43cf-9992-4c328d0c29b4-zip.zip';pack.archiveSha256=hash(await fs.readFile(archive));
const asset={id,file,pack:pack.id,category:'building',is:'bridge',tags:['building','bridge','medieval','crownward','user-supplied'],bytes:glb.length,sha256:hash(glb),size:vec(normalizedBox.getSize(new T.Vector3())),base:vec(normalizedBox.min),animations:[],materials:doc.getRoot().listMaterials().map(m=>m.getName()),triangles:13244,metadata:{premadeSource:{source:'User attachment medieval_bridge.zip',sourceSha256:hash(bytes),license:pack.license},inspection:{sourceBounds:{min:vec(box.min),max:vec(box.max)},normalization:{uniformScale:s,crossingAxis:'X',sourceApproachY:approachSourceY,targetApproachY:approachTargetY,retainedWorldScale:worldScale,retainedWorldOffsetY:-.65},deckProfile,worldCrownHeight:1.9111,textureBindings:bindings,note:'All geometry retained; node transforms baked and uniform normalization applied. Native UVs retained. All embedded images flipped vertically for FBX-to-glTF origin conversion without changing tangent basis. Normal green channels inverted to match Three GLTFExporter no-tangent convention. The only two FBX-resolved texture transforms are identity (repeat1,offset0). FBX Phong colors retained in PBR; supplied maps embedded. ZIP duplicate names preserved by member index. Cobblestone map 10 interpreted roughness, map 13 AO from image inspection; no source channel labels were present.'}},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
await fs.writeFile(`${DIR}/catalog.json`,JSON.stringify({packs:[pack],files:{[id]:`../../${OUT}/${file}`},assets:[asset]},null,2)+'\n');
await fs.writeFile(`${DIR}/inspection.json`,JSON.stringify({asset,sourceMembers:rows,embeddedTextures:doc.getRoot().listTextures().map(t=>({name:t.getName(),bytes:t.getImage().length}))},null,2)+'\n');
console.log(JSON.stringify({file,bytes:glb.length,size:asset.size,base:asset.base,sourceScale:s,center:deckProfile.find(p=>Math.abs(p.x)<.06),profiles:deckProfile.filter((p,i)=>i%10===0)}));
