/** Real licensed winged dragons; CPU conversion stages assets for production lab acceptance. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune, weld} from '@gltf-transform/functions';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {sourceLoader,readFbx,identities,nameRig,importClip} from './source.mjs';
import {DRAGON_DESIGNS,SOURCE_CLIPS} from './designs.mjs';

const OUT='test-results/wilderness-dragons', ART='assets/art/wilderness-dragons';
const SOURCE=`${OUT}/source/Assets/FourEvilDragonsPBR`;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS), V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const smooth=(a,b,x)=>THREE.MathUtils.smoothstep(x,a,b);
const sha=b=>createHash('sha256').update(b).digest('hex');
// Open, asymmetric fault paths follow the throat and shoulder mass. There are
// deliberately no closed cells or an all-over edge network across the scales.
const FRONT_FAULTS=[
 [[-.34,1.40],[-.39,1.83],[-.25,2.07],[-.31,2.26],[-.21,2.43]],
 [[-.39,1.83],[-.64,2.02],[-.86,2.27]],
 [[.72,1.82],[.66,2.12],[.81,2.39],[.69,2.65],[.78,2.89]],
 [[.81,2.39],[1.05,2.49],[1.13,2.71]],
];
const FLANK_FAULTS=[
 [[-1.74,2.17],[-1.35,2.30],[-.97,2.22],[-.61,2.46],[-.27,2.38],[.13,2.59]],
 [[-.97,2.22],[-.87,1.93],[-.60,1.73]],
 [[.52,2.18],[.75,2.36],[.69,2.61],[.92,2.86]],
];
function pathFault(u,v,paths){
 let result=0;
 for(const [pathIndex,points] of paths.entries())for(let i=1;i<points.length;i++){
  const [ax,ay]=points[i-1],[bx,by]=points[i],dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((u-ax)*dx+(v-ay)*dy)/(dx*dx+dy*dy)));
  const distance=Math.hypot(u-ax-t*dx,v-ay-t*dy);
  const edgeTaper=Math.min(i===1?smooth(0,.22,t):1,i===points.length-1?1-smooth(.70,1,t):1);
  const width=(.024+.004*Math.sin(u*21+v*13+pathIndex))*Math.max(.28,edgeTaper);
  const heat=.60+.32*Math.sin(u*4.3-v*3.1+pathIndex)**2;
  result=Math.max(result,(1-smooth(width*.12,width,distance))*edgeTaper*heat);
 }
 return result;
}
function plateCrack(wx,wy,wz){
 const front=pathFault(wx,wy,FRONT_FAULTS)*smooth(.78,1.42,wz);
 const flank=pathFault(wz,wy+(wx<0?.13:0),FLANK_FAULTS)*smooth(.86,1.30,Math.abs(wx))*(1-smooth(1.55,2.3,Math.abs(wx)));
 return Math.max(front,flank);
}
globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result=`data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;this.onloadend?.();});}
};

async function sourceDocument(config,loader){
 const rig=await readFbx(loader,`${SOURCE}/Mesh/${config.lineage}Mesh.fbx`), ids=identities(rig);
 nameRig(rig,ids);rig.name=`${config.id}_source`;
 const clips=[];
 for(const [name,file]of Object.entries(SOURCE_CLIPS[config.lineage]))clips.push(importClip(await readFbx(loader,`${SOURCE}/Animations/${config.lineage}/${file}.fbx`),ids,name,config.tempo));
 if(config.lineage==='DragonTerrorBringer'){
  // The pack's Run is an airborne bound. The Wilderness ground chase uses a faster planted gait.
  const run=clips.findIndex(c=>c.name==='Run'),walk=clips.find(c=>c.name==='Walk').clone();walk.name='Run';
  const factor=config.baby?.62:.68;walk.duration*=factor;for(const track of walk.tracks)track.times=Float32Array.from(track.times,t=>t*factor);clips[run]=walk;
 }
 rig.traverse(n=>{if(n.isMesh){n.material=new THREE.MeshStandardMaterial({name:`animal_rpg_${config.id}_native_scales`,roughness:.84,metalness:.04});if(n.isSkinnedMesh)n.normalizeSkinWeights();}});
 const bytes=await new GLTFExporter().parseAsync(rig,{binary:true,animations:clips,trs:true,onlyVisible:false});
 return io.readBinary(new Uint8Array(bytes));
}

function shapeFor(config,root){
 const head=root.listNodes().find(n=>n.getName()==='Head'), chest=root.listNodes().find(n=>n.getName()==='Chest');
 const hp=V().fromArray(head.getWorldMatrix().slice(12,15)), cp=V().fromArray(chest.getWorldMatrix().slice(12,15));
 if(!config.baby)return v=>{
   // Keep the approved black adult; red bodies and dreadwings have narrower, longer silhouettes.
   if(config.lineage==='DragonTerrorBringer'){v.x*=config.dreadwing?.72:.86;v.z*=config.dreadwing?1.24:1.12;}
   if(config.lineage==='DragonUsurper'){v.x*=1.08;v.z*=.82;}
   return v.multiplyScalar(config.scale);
 };
 return v=>{
  const {x,y,z}=v;
  const belly=(1-smooth(.8,1.6,Math.abs(x)))*(1-smooth(cp.z+.3,hp.z,z));
  const headField=smooth(hp.z-.7,hp.z+.1,z)*smooth(hp.y-.9,hp.y-.1,y)*(1-smooth(1,1.8,Math.abs(x)));
  const wings=smooth(1.1,2.4,Math.abs(x))*smooth(1.8,3.1,y);
  const tail=1-smooth(-3.5,-1.5,z);
  const nx=x*(config.lineage==='DragonUsurper'?1+belly*.18+headField*.34-wings*.25:1-belly*.05+headField*.16-wings*.18);
  const ny=y*.88+headField*(y-hp.y)*.26-wings*Math.max(0,y-2.8)*.28;
  const nz=z< -1.5?-1.5+(z+1.5)*(1-(config.lineage==='DragonUsurper'?.32:.12)*tail):z-(z-cp.z)*smooth(cp.z,hp.z+.6,z)*(config.lineage==='DragonUsurper'?.17:.09);
  return V(nx,ny,nz).multiplyScalar(config.scale);
 };
}

function sculpt(doc,config){
 const root=doc.getRoot(),shape=shapeFor(config,root),world=new Map(root.listNodes().map(n=>[n,new THREE.Matrix4().fromArray(n.getWorldMatrix())]));
 const joints=new Set(root.listSkins().flatMap(s=>s.listJoints())), local=new Map([...joints].map(n=>[n,n.getTranslation()]));
 let vertices=0;
 for(const node of root.listNodes())if(node.getMesh()){
  const skin=node.getSkin(),binds=skin?.listJoints().map((j,i)=>world.get(j).clone().multiply(new THREE.Matrix4().fromArray(skin.getInverseBindMatrices().getArray(),i*16)));
  for(const p of node.getMesh().listPrimitives()){
   const pos=p.getAttribute('POSITION'),a=pos.getArray().slice(),w=p.getAttribute('WEIGHTS_0')?.getArray(),j=p.getAttribute('JOINTS_0')?.getArray();
   for(let i=0;i<pos.getCount();i++){
    const raw=V().fromArray(a,i*3),q=V();
    if(binds&&w)for(let k=0;k<4;k++){if(w[i*4+k])q.addScaledVector(raw.clone().applyMatrix4(binds[j[i*4+k]]),w[i*4+k]);}
    else q.copy(raw).applyMatrix4(world.get(node));
    shape(q).toArray(a,i*3);vertices++;
   }
   pos.setArray(a);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(a,3));
   if(p.getIndices())geometry.setIndex(new THREE.BufferAttribute(p.getIndices().getArray(),1));geometry.computeVertexNormals();
   p.getAttribute('NORMAL').setArray(geometry.attributes.normal.array);p.setAttribute('TANGENT',null);
  }
  node.getParentNode()?.removeChild(node);root.listScenes()[0].addChild(node);node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
 }
 for(const scene of root.listScenes())scene.traverse(node=>{if(joints.has(node)){
  const parent=node.getParentNode(),inverse=new THREE.Matrix4().fromArray(parent?parent.getWorldMatrix():new THREE.Matrix4().toArray()).invert();
  node.setTranslation(shape(V().setFromMatrixPosition(world.get(node))).applyMatrix4(inverse).toArray());
 }});
 for(const skin of root.listSkins())skin.getInverseBindMatrices().setArray(Float32Array.from(skin.listJoints().flatMap(j=>new THREE.Matrix4().fromArray(j.getWorldMatrix()).invert().toArray())));
 for(const animation of root.listAnimations())for(const channel of animation.listChannels()){
  const node=channel.getTargetNode(),sampler=channel.getSampler();
  if(channel.getTargetPath()==='translation'&&joints.has(node)){
   const old=local.get(node),now=node.getTranslation(),ratio=Math.hypot(...old)>.001?Math.hypot(...now)/Math.hypot(...old):config.scale;
   const output=sampler.getOutput(),a=output.getArray().slice();for(let i=0;i<a.length;i+=3)for(let k=0;k<3;k++)a[i+k]=now[k]+(a[i+k]-old[k])*ratio;
   sampler.setOutput(output.clone().setArray(a));
  }
  if(config.baby&&channel.getTargetPath()==='rotation'&&/Head$|Tail0?1$|Wing0?1_/.test(node.getName())){
   const times=sampler.getInput().getArray(),output=sampler.getOutput(),a=output.getArray().slice(),duration=times.at(-1);
   for(let i=0;i<times.length;i++){
    const phase=times[i]/duration,angle=(/Head$/.test(node.getName())?.065:.035)*Math.sin(phase*Math.PI*2);
    new THREE.Quaternion().fromArray(a,i*4).multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),angle)).normalize().toArray(a,i*4);
   }sampler.setOutput(output.clone().setArray(a));
  }
 }
 return vertices;
}

/** Bake a sparse three-dimensional fissure field into the original UV islands. */
async function fissures(doc,config,size=1024){
 const image=Buffer.alloc(size*size*3),coverage=new Uint8Array(size*size);let lit=0,covered=0;
 for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
  const pos=p.getAttribute('POSITION'),uv=p.getAttribute('TEXCOORD_0'),idx=p.getIndices()?.getArray()??Array.from({length:pos.getCount()},(_,i)=>i);
  for(let t=0;t<idx.length;t+=3){
   if(!uv)throw new Error(`Dragon source lost native UVs: ${mesh.getName()}`);
   const pts=Array.from(idx.slice(t,t+3),i=>({p:pos.getElement(i,[]),u:uv.getElement(i,[])}));
   const xs=pts.map(a=>a.u[0]*(size-1)),ys=pts.map(a=>a.u[1]*(size-1));
   const denominator=(ys[1]-ys[2])*(xs[0]-xs[2])+(xs[2]-xs[1])*(ys[0]-ys[2]);if(Math.abs(denominator)<.01)continue;
   for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<=Math.min(size-1,Math.ceil(Math.max(...ys)));y++)for(let x=Math.max(0,Math.floor(Math.min(...xs)));x<=Math.min(size-1,Math.ceil(Math.max(...xs)));x++){
    const a=((ys[1]-ys[2])*(x-xs[2])+(xs[2]-xs[1])*(y-ys[2]))/denominator,b=((ys[2]-ys[0])*(x-xs[2])+(xs[0]-xs[2])*(y-ys[2]))/denominator,c=1-a-b;if(Math.min(a,b,c)<-.002)continue;
    const w=pts[0].p.map((v,k)=>(v*a+pts[1].p[k]*b+pts[2].p[k]*c)/config.scale),[wx,wy,wz]=w;
    const body=(1-smooth(1.7,3.5,Math.abs(wx)))*smooth(.5,1.6,wy),crack=plateCrack(wx,wy,wz)*body;
    const index=y*size+x;if(!coverage[index]){coverage[index]=1;covered++;}
    const color=config.lava?[255,105,19]:[120,72,255];
    for(let k=0;k<3;k++)image[index*3+k]=Math.max(image[index*3+k],Math.round(crack*color[k]));
   }
  }
 }
 // One texel bleed prevents black UV seams at mip boundaries, without lighting the scales.
 for(let i=0;i<coverage.length;i++)if(Math.max(image[i*3],image[i*3+1],image[i*3+2])>30)lit++;
 const file=`${ART}/${config.id}-fissures.png`;await sharp(image,{raw:{width:size,height:size,channels:3}}).png().toFile(file);
 return{bytes:await readFile(file),file,coveredPixels:covered,litPixels:lit,litFraction:lit/covered};
}

async function materials(doc,config){
 const folder=`${SOURCE}/Texture/${config.lineage}/${config.palette}`,terror=config.lineage==='DragonTerrorBringer';
 const albedo=terror?'ForSP_lambert1_AlbedoTransparency.png':'Albedo.png',normal=terror?'ForSP_lambert1_Normal.png':'Normal.png';
 const ao=terror?'Ambient Occlusion Map from Mesh lambert1.png':'AO.png';
 const texture=async(name,file)=>{
  let input=sharp(`${folder}/${file}`).flip();
  if(name==='native_albedo'&&terror&&!config.arcane&&!config.lava){
   // The source Red atlas is mostly ochre. Grade its dark skin midtones into
   // burgundy while retaining source grain and the pale membrane/claw islands.
   const {data,info}=await input.removeAlpha().raw().toBuffer({resolveWithObject:true});
   const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
   for(let i=0;i<data.length;i+=info.channels){
    const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,luma=.2126*r+.7152*g+.0722*b;
    const skin=(1-smooth(.48,.68,luma))*smooth(0,.06,r-b);
    const graded=[Math.min(.90,.10+Math.pow(r,.70)*1.02),Math.pow(g,.85)*.72+.035,Math.pow(b,.95)*.48+.018];
    // Native ochre ridge markings distinguish throat plates and facial scales
    // from the crimson hide. Keep their warm value under violet night light.
    const ridge=smooth(.58,.82,g/Math.max(.01,r))*smooth(.18,.42,luma);
    const bone=(.22+.74*Math.pow(luma,.65));
    for(let c=0;c<3;c++){
     const hide=[r,g,b][c]*(1-skin)+graded[c]*skin;
     data[i+c]=Math.round(255*Math.max(0,Math.min(.96,hide*(1-ridge)+bone*[1,.80,.52][c]*ridge)));
    }
   }
   input=sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}});
  }
  if(name==='native_albedo'&&config.arcane&&terror){
   const {data,info}=await input.removeAlpha().raw().toBuffer({resolveWithObject:true});
   for(let i=0;i<data.length;i+=info.channels){
    const [r,g,b]=[data[i]/255,data[i+1]/255,data[i+2]/255];
    const skin=1-smooth(.02,.14,r-b);
    const violet=[Math.pow(r,.66)*1.13,Math.pow(g,.72)*.62,Math.pow(b,.68)*1.1];
    const warm=[Math.pow(r,.68)*1.1,Math.pow(g,.68)*1.05,Math.pow(b,.68)];
    for(let c=0;c<3;c++)data[i+c]=Math.round(255*Math.min(.96,warm[c]*(1-skin)+violet[c]*skin));
   }
   input=sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}});
  }
  if(name==='native_albedo'&&(config.lava||config.arcane&&!terror)){
   // Preserve native colour separation and pale horns under regional night lighting.
   const {data,info}=await input.removeAlpha().raw().toBuffer({resolveWithObject:true});
   for(let i=0;i<data.length;i+=info.channels){
    const source=[data[i]/255,data[i+1]/255,data[i+2]/255];
    const luma=.2126*source[0]+.7152*source[1]+.0722*source[2];
    const horn=smooth(.44,.65,luma);
    const warm=config.lava?[1.0,.52,.25]:[.76,.55,.96];
    for(let c=0;c<3;c++){
     // Colour channels retain the source texture grain instead of a monochrome grade.
     const hide=config.lava ? .10+Math.pow(source[c],.58)*[.80,.64,.48][c] : .14*warm[c]+Math.pow(source[c],.28)*.78*(config.arcane&&terror?warm[c]:1);
     const ivory=(.25+.65*Math.pow(luma,.65))*[1,.85,.61][c];
     data[i+c]=Math.round(255*Math.max(0,Math.min(.95,hide*(1-horn)+ivory*horn)));
    }
   }
   input=sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}});
  }
  if(name==='native_albedo'&&config.simpleBlack){
   const {data,info}=await input.removeAlpha().raw().toBuffer({resolveWithObject:true});
   for(let i=0;i<data.length;i+=info.channels){
    const source=[data[i]/255,data[i+1]/255,data[i+2]/255],l=.2126*source[0]+.7152*source[1]+.0722*source[2];
    const hide=1-smooth(.40,.67,l),charcoal=.12+.38*Math.pow(l,.68);
    for(let c=0;c<3;c++)data[i+c]=Math.round(255*(source[c]*(1-hide*.75)+charcoal*[.85,.91,1][c]*hide*.75));
   }
   input=sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}});
  }
  if(name==='native_albedo'&&config.fineGlow){
   const {data,info}=await input.removeAlpha().raw().toBuffer({resolveWithObject:true});
   for(let i=0;i<data.length;i+=info.channels){
    const l=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;
    const source=[data[i]/255,data[i+1]/255,data[i+2]/255],horn=smooth(.48,.72,l);
    const value=.14+.60*Math.pow(l,.72),tint=[1.04,.62,1.24];
    // The four native membrane islands occupy the left two thirds of this atlas.
    const pixel=i/info.channels,u=(pixel%info.width)/info.width,v=Math.floor(pixel/info.width)/info.height;
    const membrane=u<.65&&v>.08&&v<.92?(1-smooth(.50,.64,l))*(1-smooth(.10,.22,Math.max(...source)-Math.min(...source))):0;
    for(let c=0;c<3;c++){
     const skin=(value*tint[c]+(source[c]-l)*.28)*(1-horn)+value*[1.15,1.02,.74][c]*horn;
     data[i+c]=Math.round(255*Math.min(.94,skin*(1-membrane)+value*[.90,.64,.70][c]*membrane));
    }
   }
   input=sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}});
  }
  // Skin albedo retains the source's 2048px UV detail; normals/AO use 1024px maps at gameplay scale.
  const albedo=name==='native_albedo',bytes=albedo?await input.jpeg({quality:93,chromaSubsampling:'4:4:4'}).toBuffer():await input.resize(1024,1024).png({compressionLevel:9}).toBuffer();
  return doc.createTexture(`animal_rpg_${config.id}_${name}`).setImage(bytes).setMimeType(albedo?'image/jpeg':'image/png');
 };
 const diffuse=await texture('native_albedo',albedo),norm=await texture('native_normal',normal),occlusion=await texture('native_occlusion',ao);
 const veins=config.lava||config.arcane?await fissures(doc,config):null;
 let emission=veins?doc.createTexture(`animal_rpg_${config.id}_fissure_mask`).setImage(veins.bytes).setMimeType('image/png'):null;
 if(config.fineGlow){
  const {data,info}=await sharp(`${folder}/${albedo}`).flip().removeAlpha().raw().toBuffer({resolveWithObject:true});
  const pixels=Buffer.alloc(info.width*info.height*3);
  for(let y=1;y<info.height-1;y++)for(let x=1;x<info.width-1;x++){
   const i=(y*info.width+x)*info.channels;
   const edge=Math.abs(data[i]-data[i+info.channels])+Math.abs(data[i]-data[i+info.width*info.channels]);
   const membrane=x/info.width<.65&&y/info.height>.08&&y/info.height<.92;
   const strength=membrane?0:smooth(32,78,edge)*smooth(18,65,data[i])*.45;
   for(let c=0;c<3;c++)pixels[(y*info.width+x)*3+c]=Math.round(strength*[235,75,255][c]);
  }
  const bytes=await sharp(pixels,{raw:{width:info.width,height:info.height,channels:3}}).png().toBuffer();
  emission=doc.createTexture(`animal_rpg_${config.id}_fine_scale_glow`).setImage(bytes).setMimeType('image/png');
 }
 for(const mat of doc.getRoot().listMaterials()){
  mat.setBaseColorTexture(diffuse).setBaseColorFactor([1,1,1,1]).setNormalTexture(norm).setOcclusionTexture(occlusion).setRoughnessFactor(config.lava?.91:config.palette==='Dark'?.73:.85).setMetallicFactor(0).setDoubleSided(true);
  if(emission)mat.setEmissiveTexture(emission).setEmissiveFactor(config.fineGlow?[.9,.6,.7]:config.lava?[.62,.51,.34]:[.37,.41,.57]);
 }
 return{sourceAlbedo:`${folder}/${albedo}`,sourceNormal:`${folder}/${normal}`,sourceAO:`${folder}/${ao}`,albedoGrade:config.lava?'Copper-charcoal hide with warm ivory membranes; native grain and sparse molten seams.':config.arcane?'Violet hide with pale native membranes and horns; sparse seam emission.':config.fineGlow?'Amethyst scales with warm grey horns and smoky plum membranes; fine scale-edge emission excludes wings.':config.simpleBlack?'Simple charcoal midtones with native pale horns and dark membranes.':terror?'Crimson skin with ochre throat and face ridge markings; native grain and warm pale membrane islands retained.':null,fissures:veins?{...veins,bytes:undefined}:null};
}

export async function bareScene(doc){
 const bare=await io.readBinary(await io.writeBinary(doc));for(const m of bare.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null);
 await bare.transform(prune());const bytes=await io.writeBinary(bare);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}

async function measureAndGround(doc,config){
 const root=doc.getRoot(),buffer=root.listBuffers()[0],gltf=await bareScene(doc),scene=gltf.scene,mixer=new THREE.AnimationMixer(scene);
 const ground=doc.createNode(`${config.id}_ground`);for(const c of root.listScenes()[0].listChildren()){root.listScenes()[0].removeChild(c);ground.addChild(c);}root.listScenes()[0].addChild(ground);
 const union=new THREE.Box3(),locomotion=new THREE.Box3(),reports={};let idle,attackContact=.5,maxReach=-Infinity;
 const feet=[];scene.traverse(n=>{if(/Feet|feet/.test(n.name)&&n.isBone)feet.push(n);});
 for(const clip of gltf.animations){
  mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const times=[],values=[],bounds=new THREE.Box3(),footSamples=feet.map(()=>[]);let maximumLift=0,maximumDrop=0;
  const samples=Math.ceil(clip.duration*60);
  for(let i=0;i<=samples;i++){
   const time=Math.min(clip.duration,i/60);mixer.setTime(time);scene.updateMatrixWorld(true);
   const box=new THREE.Box3().setFromObject(scene,true),offset=.003-box.min.y;maximumLift=Math.max(maximumLift,offset);maximumDrop=Math.min(maximumDrop,offset);
   times.push(time);values.push(0,offset,0);box.translate(V(0,offset,0));bounds.union(box);
   if(clip.name==='Idle'&&i===0)idle=box.clone();
   if(clip.name==='Attack'){const z=scene.getObjectByName('Head').getWorldPosition(V()).z;if(z>maxReach){maxReach=z;attackContact=time/clip.duration;}}
   feet.forEach((f,k)=>footSamples[k].push(f.getWorldPosition(V())));
  }
  let stance=[];
  for(const samples of footSamples){const low=Math.min(...samples.map(p=>p.y)),high=Math.max(...samples.map(p=>p.y));for(let i=1;i<samples.length;i++){
   const speed=(samples[i-1].z-samples[i].z)*60;if(speed>.015&&samples[i].y<low+(high-low)*.35)stance.push(speed);
  }}stance.sort((a,b)=>a-b);
  reports[clip.name]={seconds:clip.duration,samples:times.length,min:bounds.min.toArray(),max:bounds.max.toArray(),maximumLift,maximumDrop,stanceSamples:stance.length,impliedMps:stance[Math.floor(stance.length/2)]??0};
  union.union(bounds);if(['Idle','Walk','Run'].includes(clip.name))locomotion.union(bounds);
  const animation=root.listAnimations().find(a=>a.getName()===clip.name),sampler=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(times)).setBuffer(buffer)).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(values)).setBuffer(buffer)).setInterpolation('LINEAR');
  animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('translation').setSampler(sampler));
 }
 const size=idle.getSize(V()),radius=b=>Math.max(...[b.min.x,b.max.x].flatMap(x=>[b.min.z,b.max.z].map(z=>Math.hypot(x,z))));
 return{size:{x:size.x,y:size.y,z:size.z},base:{x:idle.min.x,y:idle.min.y,z:idle.min.z},animatedMin:union.min.toArray(),animatedMax:union.max.toArray(),locomotionRadius:radius(locomotion),fullMotionRadius:radius(union),clips:reports,attackContact,grounding:'Actual skinned geometry at 60 Hz; per-clip root clearance is 3 mm.'};
}

async function main(){
 await mkdir(OUT,{recursive:true});await mkdir(ART,{recursive:true});const loader=await sourceLoader();
 const only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:null;
 const catalog=only?JSON.parse(await readFile(`${OUT}/catalog.json`,'utf8').catch(()=>' {"assets":[],"files":{}}')):{assets:[],files:{}};
 for(const config of DRAGON_DESIGNS.filter(c=>!only||c.id===only)){
  console.log(`Building ${config.id}`);const doc=await sourceDocument(config,loader),vertices=sculpt(doc,config);
  const textures=await materials(doc,config);await doc.transform(weld(),prune());
  const measure=await measureAndGround(doc,config);await doc.transform(prune());
  const file=`creature_${config.id}.glb`;await io.write(`${OUT}/${file}`,doc);const bytes=await readFile(`${OUT}/${file}`),root=doc.getRoot();
  const entry={id:`creature_${config.id}`,file:`models/creature/${file}`,pack:'dungeon-mason-four-evil-dragons-pbr',category:'character',is:config.description,tags:['creature',config.dreadwing?'dreadwing':'dragon',config.baby?'hatchling':'adult','wilderness'],bytes:bytes.length,sha256:sha(bytes),size:measure.size,base:measure.base,triangles:root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0),animations:root.listAnimations().map(a=>a.getName()),materials:root.listMaterials().map(m=>m.getName()),walkClipSeconds:measure.clips.Walk.seconds,runClipSeconds:measure.clips.Run.seconds,attackSeconds:measure.clips.Attack.seconds,contactNormalized:measure.attackContact,impliedWalkMps:measure.clips.Walk.impliedMps,impliedRunMps:measure.clips.Run.impliedMps,
   metadata:{id:config.id,provenance:{author:'Dungeon Mason; Corealm juvenile anatomy and fissure authoring',license:'Standard Unity Asset Store EULA',archiveSha256:'01b15c6e6ac1339acc40e653924691583cbf44303397878ae7f79a59112b7383',sourceMesh:`Assets/FourEvilDragonsPBR/Mesh/${config.lineage}Mesh.fbx`,sourceAnimations:SOURCE_CLIPS[config.lineage],generator:'tools/wilderness-dragons/build.mjs',juvenile:config.baby,sculptedVertices:vertices,nativeScale:config.scale,animationTempo:config.tempo,textures},measurement:measure,notes:['Original UV islands and source tangent normals retained.','Source FBX channels bind by Model ID and complete ancestry.','Horizontal root motion removed; signed foot stance speed measured after all anatomy edits.','Red lineage ground Run uses the planted native Walk at faster cadence instead of the source airborne bound.','Breath is an authored animation clip, not an unimplemented damage mechanic.']},acceptance:{exported:true,labAccepted:false,worldIntegrated:false}};
  const index=catalog.assets.findIndex(a=>a.id===entry.id);if(index<0)catalog.assets.push(entry);else catalog.assets[index]=entry;catalog.files[entry.id]=file;
  await writeFile(`${OUT}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
  console.log(`${entry.id}: ${entry.triangles} triangles, ${Object.values(entry.size).map(n=>n.toFixed(2)).join(' x ')} m; ${measure.locomotionRadius.toFixed(2)} m locomotion radius`);
 }
 await writeFile(`${ART}/source-and-measurements.json`,JSON.stringify(catalog.assets.map(a=>({id:a.id,sha256:a.sha256,provenance:a.metadata.provenance,measurement:a.metadata.measurement})),null,2)+'\n');
}
await main();
