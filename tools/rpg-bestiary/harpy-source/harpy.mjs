import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import sharp from 'sharp';
import {readSourceGlb} from '../humanoid-source/read-glb.mjs';
const dir=path.resolve('tools/rpg-bestiary/harpy-source');
const provenance=JSON.parse(fs.readFileSync(path.join(dir,'provenance.json'),'utf8'));
const sources=['character/base_female','outfit/outfit_female_ranger_chest','animation/animation_library_1','character/hair_long'].map(f=>({...readSourceGlb(path.resolve('game/public/assets/models',f+'.glb')),key:f}));
const [base,outfit,library,hair]=sources,bindings=[];
for(const src of [base,outfit,hair])for(let i=0;i<src.json.materials.length;i++){
 const mat=src.json.materials[i],binding={materialName:`harpy_${path.basename(src.key)}_${i}`,flipY:false};
 for(const [field,info] of [['baseColorPath',mat.pbrMetallicRoughness?.baseColorTexture],['normalPath',mat.normalTexture]]){if(!info)continue;const image=src.json.images[src.json.textures[info.index].source],v=src.json.bufferViews[image.bufferView],file=path.join(dir,`${path.basename(src.key)}-${i}-${field}.png`);await sharp(image.uri?fs.readFileSync(path.resolve(path.dirname(src.file),image.uri)):src.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)).png().toFile(file);binding[field]=file;}
 bindings.push(binding);
}
const featherPath=path.join(dir,'feather-vane.png');
let barbs='';for(let y=4;y<512;y+=7){const tone=y%21===4?'#acafa2':'#777f77';barbs+=`<path d="M128 ${y} Q70 ${y+18} 0 ${y+53} M128 ${y} Q189 ${y+15} 256 ${y+46}" stroke="${tone}" stroke-width="1.8" fill="none"/>`;}
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="512"><rect width="256" height="512" fill="#969f94"/><path d="M0 95L256 145V183L0 133ZM0 255L256 300V335L0 291ZM0 416L256 449V479L0 450Z" fill="#737c75"/>${barbs}<path d="M128 0V512" stroke="#c3c4ad" stroke-width="3"/><path d="M132 0V512" stroke="#505f58" stroke-width="1"/></svg>`)).png().toFile(featherPath);
for(let i=0;i<5;i++)bindings.push({materialName:`harpy_plumage_${i}`,baseColorPath:featherPath,flipY:false});
const vec=a=>new T.Vector3(...a);
// Closed feather cross sections have convex vanes, a cambered rachis, and rounded tips.
function feather(a,b,width,bend=0.035){
 const start=vec(a),end=vec(b),direction=end.clone().sub(start),axis=new T.Vector3(1,0,0);axis.addScaledVector(direction,-axis.dot(direction)/direction.lengthSq()).normalize();
 const normal=new T.Vector3().crossVectors(direction,axis).normalize(),p=[],uv=[],ix=[],rows=direction.length()>.2?10:direction.length()>.065?6:4,radial=6;
 for(let i=0;i<=rows;i++){const t=i/rows,center=start.clone().addScaledVector(direction,t).addScaledVector(normal,Math.sin(t*Math.PI)*bend);const w=Math.max(.001,width*Math.pow(Math.sin(Math.PI*t),.82)*(1-.64*t)*(1+.018*Math.sin(t*120)));for(let j=0;j<radial;j++){const q=j/radial*Math.PI*2,v=center.clone().addScaledVector(axis,Math.cos(q)*w*(Math.cos(q)>0?1:.77)).addScaledVector(normal,Math.sin(q)*w*.055);p.push(...v.toArray());uv.push((Math.cos(q)+1)/2,t);}}
 for(let i=0;i<rows;i++)for(let j=0;j<radial;j++){const a=i*radial+j,b=i*radial+(j+1)%radial,c=a+radial,d=b+radial;ix.push(a,b,c,b,d,c);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
export function buildHarpy(id='harpy',{mergeAttachments=true}={}){
 if(!['harpy','cliff_harpy','storm_harpy'].includes(id))throw new Error('Unknown harpy ID '+id);
 const cliff=id==='cliff_harpy',storm=id==='storm_harpy';
 const object=new T.Group();object.name=id;const jointSet=new Set(base.json.skins[0].joints);
 const nodes=base.json.nodes.map((n,i)=>{const o=jointSet.has(i)?new T.Bone():new T.Group();o.name=n.name||`harpyNode${i}`;if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);if(n.matrix)new T.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);return o;});
 base.json.nodes.forEach((n,i)=>{for(const c of n.children||[])nodes[i].add(nodes[c]);});for(const i of base.json.scenes[base.json.scene||0].nodes)object.add(nodes[i]);object.updateMatrixWorld(true);
 const bones=base.json.skins[0].joints.map(i=>nodes[i]),skeleton=new T.Skeleton(bones);skeleton.calculateInverses();
 for(const src of [base,outfit,hair])for(const node of src.json.nodes){if(node.mesh===undefined)continue;for(const prim of src.json.meshes[node.mesh].primitives){
 let g=new T.BufferGeometry();for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){if(prim.attributes[semantic]===undefined)continue;const a=src.accessor(prim.attributes[semantic]);g.setAttribute(name,new T.BufferAttribute(a.array,a.itemSize,a.normalized));}
 const inds=prim.indices===undefined?Array.from({length:g.attributes.position.count},(_,i)=>i):Array.from(src.accessor(prim.indices).array),filtered=[];const p=g.attributes.position;
 for(let i=0;i<inds.length;i+=3){const tri=inds.slice(i,i+3);if(src===base&&src.json.materials[prim.material].name.includes('Superhero')&&tri.every(j=>p.getY(j)<.52||(p.getY(j)>.91&&p.getY(j)<1.49&&Math.abs(p.getX(j))<.19)))continue;filtered.push(...tri);}g.setIndex(filtered);
 const si=g.attributes.skinIndex,skin=src.json.skins[node.skin];for(let i=0;i<si.count;i++)for(let k=0;k<4;k++){const name=src.json.nodes[skin.joints[si.array[i*4+k]]].name;si.array[i*4+k]=bones.findIndex(b=>b.name===name);}
 const compact=new T.BufferGeometry(),used=[...new Set(g.index.array)],remap=new Map(used.map((v,i)=>[v,i]));for(const [name,attribute]of Object.entries(g.attributes)){const array=new attribute.array.constructor(used.length*attribute.itemSize);used.forEach((old,i)=>{for(let k=0;k<attribute.itemSize;k++)array[i*attribute.itemSize+k]=attribute.array[old*attribute.itemSize+k];});compact.setAttribute(name,new T.BufferAttribute(array,attribute.itemSize,attribute.normalized));}compact.setIndex(Array.from(g.index.array,i=>remap.get(i)));g=compact;
 const mat=new T.MeshStandardMaterial({name:`harpy_${path.basename(src.key)}_${prim.material}`,color:src===outfit?0x8c948b:src===hair?0x383e37:prim.material===2?0xc3c5ac:0xffffff,roughness:.86,side:T.DoubleSide});const mesh=new T.SkinnedMesh(g,mat);mesh.name=`harpy_source_${node.name}`;mesh.frustumCulled=false;mesh.castShadow=true;object.add(mesh);mesh.bind(skeleton);
 }}
 const colors=cliff?[0x3e3029,0x705544,0x977b5b,0xb09b76,0xc9b990]:storm?[0x202f44,0x354862,0x50667e,0x869aa9,0xbfcaca]:[0x323c3d,0x414c4b,0x59615a,0x72796a,0x989986];const mats=colors.map((c,i)=>new T.MeshStandardMaterial({name:`harpy_plumage_${i}`,color:c,roughness:.91}));
 function attach(g,bone,mat,name){g.applyMatrix4(bone.matrixWorld.clone().invert());const m=new T.Mesh(g,mat);m.name=name;m.castShadow=true;bone.add(m);return m;}
 // Feather rows follow upper arm, forearm and wrist rather than floating on a separate wing.
 for(const sign of [-1,1]){const side=sign>0?'l':'r';for(let row=0;row<3;row++)for(let i=0;i<17;i++){
 const x=.19+i*.034,y=1.405-(x-.19)*.12,z=-.03-row*.012;const bone=object.getObjectByName(x<.38?`upperarm_${side}`:x<.60?`lowerarm_${side}`:`hand_${side}`),length=(.21+.25*Math.sin(i/20*Math.PI))*(1-row*.25)*(cliff?(i<8?1.14:.82):storm?(i>10?1.34:.98):1);
 attach(feather([sign*x,y,z],[sign*(x+.13+Math.max(0,i-9)*(storm?.027:cliff?.008:.015)),y-length,z-.10],.046-row*.008,.025),bone,mats[(i+row)%3+row%2],`harpy_${side}_feather_${row}_${i}`);
 }
 const calf=object.getObjectByName(`calf_${side}`),foot=object.getObjectByName(`foot_${side}`),x=sign*.105;
 const skinMat=new T.MeshStandardMaterial({name:'harpy_shank_ochre',color:0x655342,roughness:.89}),scaleMat=new T.MeshStandardMaterial({name:'harpy_shank_scale',color:0x8e795a,roughness:.83}),clawMat=new T.MeshStandardMaterial({name:'harpy_horn',color:0x28231e,roughness:.64});
 const tube=(points,radius,profile)=>{const c=new T.CatmullRomCurve3(points.map(vec)),g=new T.TubeGeometry(c,12,radius,8,false),p=g.attributes.position;for(let i=0;i<p.count;i++){const t=Math.floor(i/9)/12,center=c.getPointAt(t),v=new T.Vector3().fromBufferAttribute(p,i).sub(center).multiplyScalar(profile(t)).add(center);p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;};
 attach(tube([[x,.575,.008],[x,.43,-.012],[x,.27,-.035],[x,.13,.001],[x,.085,.04]],.054,t=>1-.52*t+.16*Math.exp(-Math.pow((t-.79)/.1,2))),calf,skinMat,`harpy_tapered_shank_${side}`);
 for(let row=0;row<17;row++)for(let sideScale=-1;sideScale<=1;sideScale++){const y=.49-row*.022,r=.049*(.98-row*.023),angle=sideScale*.74;const xx=x+Math.sin(angle)*r,z=-.012+Math.cos(angle)*r;attach(feather([xx,y,z],[xx,y-.034,z+.003],.015,.002),calf,scaleMat,`harpy_shank_scale_${side}_${row}_${sideScale}`);}
 for(let k=-1;k<=1;k++){
 const offset=k*.041,toeEnd=.182-Math.abs(k)*.017;
 attach(tube([[x+k*.013,.094,.029],[x+offset*.55,.056,.092],[x+offset,.049,.133],[x+offset*1.12,.045,toeEnd]],.02,t=>1-.35*t+.17*Math.sin(t*Math.PI*3)**2),foot,skinMat,`harpy_toe_${side}_${k}`);
 attach(tube([[x+offset*1.12,.045,toeEnd-.009],[x+offset*1.18,.053,toeEnd+.022],[x+offset*1.21,.04,toeEnd+.043],[x+offset*1.19,.017,toeEnd+.047]],.014,t=>Math.max(.035,1-t)),foot,clawMat,`harpy_hooked_claw_${side}_${k}`);
 for(let j=0;j<5;j++)attach(feather([x+offset*(.55+j*.12),.067-j*.004,.083+j*.019],[x+offset*(.55+j*.12),.064-j*.004,.107+j*.019],.013,.001),foot,scaleMat,`harpy_toe_scale_${side}_${k}_${j}`);
 }
 attach(tube([[x,.1,.014],[x+sign*.016,.065,-.065],[x+sign*.025,.035,-.10]],.019,t=>1-t*.65),foot,skinMat,`harpy_rear_toe_${side}`);
 attach(tube([[x+sign*.025,.035,-.10],[x+sign*.026,.035,-.12],[x+sign*.027,.012,-.126]],.01,t=>Math.max(.04,1-t)),foot,clawMat,`harpy_rear_claw_${side}`);
 for(let row=0;row<4;row++)for(let j=0;j<12;j++){const angle=j/12*Math.PI*2+row*.22,radius=.09-row*.006,yy=.74-row*.06;attach(feather([x+Math.cos(angle)*radius,yy,Math.sin(angle)*radius],[x+Math.cos(angle)*(radius+.012),yy-.155,Math.sin(angle)*(radius+.012)],.026,.006),object.getObjectByName(`thigh_${side}`),mats[1+(row+j)%3],`harpy_leg_cuff_${side}_${row}_${j}`);}

 }
 // Layered mantle covers the ranger neckline without obscuring authored facial topology.
 for(let row=0;row<3;row++)for(let i=0;i<22;i++){const angle=i/22*Math.PI*2+row*.1,x=Math.cos(angle)*(.145+row*.004),z=Math.sin(angle)*(.12+row*.01);attach(feather([x,1.49-row*.037,z],[x*1.07,1.40-row*.047,z*1.05],.021,.006),object.getObjectByName('spine_03'),mats[1+(i+row)%3],`harpy_mantle_${row}_${i}`);}
 for(let row=0;row<(storm?4:3);row++)for(let i=0;i<7;i++){const x=(i-3)*.018;attach(feather([x,1.756-row*.017,-.027-row*.021],[x*(cliff?2.8:storm?1.1:1.8),(storm?1.925:cliff?1.81:1.83)-row*.012,-(cliff?.19:storm?.10:.14)-row*.025],.02,.024),object.getObjectByName('Head'),mats[1+(i+row)%3],`harpy_swept_crest_${row}_${i}`);}

 if(cliff||storm){const holder=object.getObjectByName('pelvis'),count=cliff?11:7;for(let i=0;i<count;i++){const f=(i-(count-1)/2)/((count-1)/2),length=cliff?.29+.09*(1-f*f):.47+.19*Math.abs(f);attach(feather([f*.072,.91,-.14],[f*(cliff?.28:.18),.91-length,-.23-(cliff?.08:.17)*(1-Math.abs(f))],cliff?.037:.029,.024),holder,mats[1+i%4],`${id}_tail_${i}`);}}
 const map={Idle:'Idle_Loop',Walk:'Walk_Loop',Run:'Jog_Fwd_Loop',Attack:'Punch_Jab',Hit:'Hit_Chest',HitLeft:'Hit_Chest',HitRight:'Hit_Chest',Death:'Death01'};
 const clips=Object.entries(map).map(([name,sourceName])=>{const animation=library.json.animations.find(a=>a.name===sourceName),tracks=[];for(const ch of animation.channels){const sn=library.json.nodes[ch.target.node],target=object.getObjectByName(sn.name);if(!target)continue;const s=animation.samplers[ch.sampler],times=library.accessor(s.input).array,values=library.accessor(s.output).array.slice();if(s.interpolation==='CUBICSPLINE')throw Error('Unsupported cubic');if(ch.target.path==='rotation'){const correction=target.quaternion.clone().multiply(new T.Quaternion().fromArray(sn.rotation||[0,0,0,1]).invert());for(let i=0;i<values.length;i+=4)new T.Quaternion().fromArray(values,i).premultiply(correction).toArray(values,i);tracks.push(new T.QuaternionKeyframeTrack(`${target.name}.quaternion`,times,values));}else if(ch.target.path==='translation'){for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++)values[i+k]=target.position.getComponent(k)+(target.name==='root'?0:values[i+k]-(sn.translation||[0,0,0])[k]);tracks.push(new T.VectorKeyframeTrack(`${target.name}.position`,times,values));}}
 const clip=new T.AnimationClip(name,-1,tracks);if(name!=='Death')for(const sign of [-1,1]){const side=sign>0?'l':'r',bn=`upperarm_${side}`,bone=object.getObjectByName(bn),vals=[],times=[];for(let i=0;i<=24;i++){const phase=i/24,t=phase*clip.duration;const spread=name==='Attack'?.22+.42*Math.sin(phase*Math.PI):name==='Run'?.62+.08*Math.sin(phase*Math.PI*2):.74+.035*Math.sin(phase*Math.PI*2);const desired=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),-sign*spread).multiply(bone.getWorldQuaternion(new T.Quaternion()));bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(desired).toArray(vals,i*4);times.push(t);}clip.tracks=clip.tracks.filter(t=>t.name!==`${bn}.quaternion`);clip.tracks.push(new T.QuaternionKeyframeTrack(`${bn}.quaternion`,times,vals));}return clip;});
 const mixer=new T.AnimationMixer(object),action=mixer.clipAction(clips[0]);action.play();mixer.setTime(0);object.updateMatrixWorld(true);let floor=Infinity;object.traverse(n=>{if(!n.isMesh)return;for(const i of (n.geometry.index?new Set(n.geometry.index.array):Array.from({length:n.geometry.attributes.position.count},(_,i)=>i))){const v=n.isSkinnedMesh?n.getVertexPosition(i,new T.Vector3()):new T.Vector3().fromBufferAttribute(n.geometry.attributes.position,i);floor=Math.min(floor,v.applyMatrix4(n.matrixWorld).y);}});action.stop();mixer.uncacheRoot(object);object.position.y=-floor;object.updateMatrixWorld(true);
 // Correct only below-floor frames, including the source death roll, using root translation.
 const groundingMixer=new T.AnimationMixer(object),rootBone=object.getObjectByName('root');
 for(const clip of clips){const action=groundingMixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();const times=[],values=[],count=Math.ceil(clip.duration*120),sampleTimes=[...new Set([...Array.from({length:count+1},(_,i)=>i/count*clip.duration),...clip.tracks.flatMap(track=>Array.from(track.times))])].sort((a,b)=>a-b);for(const t of sampleTimes){groundingMixer.setTime(t);object.updateMatrixWorld(true);let minimum=Infinity;object.traverse(n=>{if(!n.isMesh)return;const ids=n.geometry.index?new Set(n.geometry.index.array):Array.from({length:n.geometry.attributes.position.count},(_,i)=>i);for(const i of ids){const v=n.isSkinnedMesh?n.getVertexPosition(i,new T.Vector3()):new T.Vector3().fromBufferAttribute(n.geometry.attributes.position,i);minimum=Math.min(minimum,v.applyMatrix4(n.matrixWorld).y);}});const correction=new T.Vector3(0,Math.max(0,.002-minimum),0).transformDirection(rootBone.parent.matrixWorld.clone().invert()).multiplyScalar(Math.max(0,.002-minimum));times.push(t);values.push(...rootBone.position.clone().add(correction).toArray());}action.stop();clip.tracks=clip.tracks.filter(t=>t.name!=='root.position');clip.tracks.push(new T.VectorKeyframeTrack('root.position',times,values));groundingMixer.uncacheClip(clip);}
 groundingMixer.uncacheRoot(object);object.updateMatrixWorld(true);
 // Batch rigid bone attachments after authoring and grounding, preserving existing animation tracks.
 if(mergeAttachments){
  object.updateMatrixWorld(true);
  const inverseObject=object.matrixWorld.clone().invert(),groups=new Map(),attachments=[];
  object.traverse(n=>{if(n.isMesh&&!n.isSkinnedMesh)attachments.push(n);});
  for(const mesh of attachments){
   if(Array.isArray(mesh.material))throw new Error('Harpy attachment batching requires one material per source mesh');
   const boneIndex=bones.indexOf(mesh.parent);if(boneIndex<0)throw new Error(`Unmapped attachment bone for ${mesh.name}`);
   const material=mesh.material,key=JSON.stringify([material.name,material.color.getHex(),material.roughness,material.metalness,material.side,material.opacity]);
   let group=groups.get(key);if(!group){group={material,geometries:[]};groups.set(key,group);}
   const geometry=mesh.geometry.clone().applyMatrix4(inverseObject.clone().multiply(mesh.matrixWorld)),count=geometry.attributes.position.count,indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
   for(let i=0;i<count;i++){indices[i*4]=boneIndex;weights[i*4]=1;}
   geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));group.geometries.push(geometry);
  }
  for(const mesh of attachments)mesh.removeFromParent();
  for(const {material,geometries}of groups.values()){
   const geometry=mergeGeometries(geometries,false);if(!geometry)throw new Error(`Attachment merge failed for ${material.name}`);
   const mesh=new T.SkinnedMesh(geometry,material);mesh.name=`${id}_batched_${material.name}`;mesh.castShadow=true;mesh.frustumCulled=false;object.add(mesh);mesh.bind(skeleton,new T.Matrix4());
  }
  object.updateMatrixWorld(true);
 }
 const usedMaterialNames=new Set();object.traverse(n=>{if(n.isMesh)for(const m of (Array.isArray(n.material)?n.material:[n.material]))usedMaterialNames.add(m.name);});
 return {object,clips,meta:{family:'harpy',groundY:0,attackContactNormalized:.5,contactNormalized:.5,attackContactSource:'Authored wing downstroke extremum: upperarm spread = 0.22 + 0.42 * sin(pi * normalizedTime), maximum at 0.5. Timing intent only; not collision- or browser-measured contact.',textureBindings:bindings.filter(b=>usedMaterialNames.has(b.materialName)),provenance,status:'Candidate awaiting root browser and screenshot acceptance',sourceFiles:sources.map(s=>s.file)}};
}



