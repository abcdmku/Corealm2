import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import * as THREE from 'three';
import { readSourceGlb } from '../humanoid-source/read-glb.mjs';
import { buildSourceDemon } from './demon.mjs';

const derived=path.resolve('tools/rpg-bestiary/mythic-source/derived');
fs.mkdirSync(derived,{recursive:true});
const bodyPath=path.join(derived,'gargoyle-stone-source-uv.png');
const wingPath=path.join(derived,'gargoyle-wing-stone.png');
// Keep UV-authored sculpt shading. The derivative changes hue and surface grain,
// not the source's folds, eyes, mouth, plates or anatomical shading.
const source=readSourceGlb(path.resolve('game/public/assets/models/creature/creature_cinder_ravager.glb'));
const image=source.json.images[0],view=source.json.bufferViews[image.bufferView];
const imageBytes=source.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
const {data,info}=await sharp(imageBytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let i=0;i<data.length;i+=4) {
  const x=(i/4)%info.width,y=Math.floor(i/4/info.width);
  const luminance=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  const grain=Math.sin(x*1.73+y*2.17)*Math.sin(x*.61-y*1.93);
  const vein=Math.sin(x*.041+Math.sin(y*.013)*1.1)*Math.sin(y*.035+x*.023);
  const grey=Math.max(12,Math.min(231,27+luminance*.78+grain*3.5+vein*4));
  data[i]=grey;data[i+1]=grey*.973;data[i+2]=grey*.925;
}
await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(bodyPath);
const wingPixels=Buffer.alloc(256*256*3);
for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const i=(y*256+x)*3,g=135+9*Math.sin(x*.053)*Math.sin(y*.07)+4*Math.sin(x*1.77+y*2.03)+3*Math.sin(x*.21+y*.37);
  wingPixels[i]=g;wingPixels[i+1]=g*.973;wingPixels[i+2]=g*.925;
}
await sharp(wingPixels,{raw:{width:256,height:256,channels:3}}).png().toFile(wingPath);
const v=p=>new THREE.Vector3(...p);
function sweep(parent,name,points,radii,material){
  const curve=new THREE.CatmullRomCurve3(points.map(v),false,'catmullrom',.25);
  const pos=[],uv=[],indices=[],rings=32,sides=12;
  const frames=curve.computeFrenetFrames(rings-1,false);
  for(let i=0;i<rings;i++){
    const t=i/(rings-1),p=curve.getPointAt(t),ri=t*(radii.length-1),j=Math.min(radii.length-2,Math.floor(ri)),r=THREE.MathUtils.lerp(radii[j],radii[j+1],ri-j);
    for(let k=0;k<sides;k++){
      const a=k/sides*Math.PI*2,q=p.clone().addScaledVector(frames.normals[i],Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r);
      pos.push(...q.toArray());uv.push(k/sides,t);
      if(i<rings-1){const a=i*sides+k,b=i*sides+(k+1)%sides;indices.push(a,b,a+sides,b,b+sides,a+sides);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const m=new THREE.Mesh(g,material);m.name=name;m.castShadow=m.receiveShadow=true;parent.add(m);
}
function wingMesh(parent,side,material){
  // Folded bat arm: a thick scapular root rises to the elbow and wrist, then
  // the fingers separate down the rear silhouette behind the forearms.
  const wrist=v([side*.51,.57,-.13]);
  sweep(parent,`GargoyleWingArm${side}`,[[0,0,0],[side*.15,.27,-.02],wrist.toArray(),[side*.95,.57,-.23]],[.09,.071,.048,.002],material);
  const ends=[[side*.99,.055,-.29],[side*.74,-.37,-.24],[side*.41,-.55,-.13],[side*.018,-.41,.015]].map(v);
  for(let j=0;j<ends.length;j++){
    const midpoint=wrist.clone().lerp(ends[j],.48);midpoint.z-=.05;
    sweep(parent,`GargoyleWingFinger${side}_${j}`,[wrist.toArray(),midpoint.toArray(),ends[j].toArray()],[.036,.022,.004],material);
    if(j===ends.length-1)continue;
    const pos=[],uv=[],index=[],resolution=22;
    for(let u=0;u<=resolution;u++)for(let w=0;w<=resolution;w++){
      const t=u/resolution,s=w/resolution,edge=ends[j].clone().lerp(ends[j+1],s);
      edge.lerp(wrist,.17*Math.sin(s*Math.PI));
      const p=wrist.clone().lerp(edge,t);p.z-=Math.sin(t*Math.PI)*Math.sin(s*Math.PI)*.10;
      pos.push(...p.toArray());uv.push(t,s);
    }
    for(let u=0;u<resolution;u++)for(let w=0;w<resolution;w++){
      const a=u*(resolution+1)+w,b=a+resolution+1;index.push(a,b,a+1,a+1,b,b+1);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
    const m=new THREE.Mesh(g,material);m.name=`GargoyleMembrane${side}_${j}`;m.castShadow=m.receiveShadow=true;parent.add(m);
    const rim=[];for(let k=0;k<12;k++){const s=k/11,p=ends[j].clone().lerp(ends[j+1],s);p.lerp(wrist,.17*Math.sin(s*Math.PI));rim.push(p.toArray());}
    sweep(parent,`GargoyleTrailingEdge${side}_${j}`,rim,Array(12).fill(.010),material);
  }
}

export function buildSourceGargoyle(){
  const result=buildSourceDemon(),{object,clips}=result;object.name='gargoyle';
  const bindings=[];
  object.traverse(n=>{
    if(!n.isMesh)return;
    n.material=n.material.clone();n.material.name='animal_rpg_gargoyle_source_stone';n.material.roughness=.96;n.material.metalness=0;
    bindings.push({materialName:n.material.name,baseColorPath:bodyPath,flipY:false});
  });
  const spine=object.getObjectByName('spine_03x');if(!spine)throw new Error('Monster04 gargoyle requires upper spine attachment');
  const wingMaterial=new THREE.MeshStandardMaterial({name:'animal_rpg_gargoyle_wing_stone',color:0xffffff,roughness:.96,metalness:0,side:THREE.DoubleSide});
  bindings.push({materialName:wingMaterial.name,baseColorPath:wingPath,flipY:false});
  const wings=[];
  for(const side of [-1,1]){
    const wing=new THREE.Group();wing.name=side<0?'GargoyleWingL':'GargoyleWingR';
    // Scene-space placement in the measured source rest pose; attach preserves
    // that matrix and then follows the authored torso motion through all clips.
    wing.position.set(side*.235,1.70,-.13);object.add(wing);wingMesh(wing,side,wingMaterial);
    object.updateMatrixWorld(true);spine.attach(wing);wings.push({wing,side,rest:wing.quaternion.clone()});
  }
  for(const clip of clips)for(const {wing,side,rest}of wings){
    const times=[],values=[];
    for(let i=0;i<=48;i++){
      const t=i/48,angle=clip.name==='Death'?-.12*t:clip.name==='Attack'?.09*Math.sin(Math.PI*t):clip.name==='Run'?.026*Math.sin(t*Math.PI*2):.008*Math.sin(t*Math.PI*2);
      // The authored corpse rolls onto its left flank. Fold that wing back
      // toward the spine before contact; the upper wing remains relaxed.
      const delta=clip.name==='Death'&&side<0
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(t,-t,0))
        : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),side*angle);
      const q=rest.clone().multiply(delta);times.push(t*clip.duration);values.push(...q.toArray());
    }
    clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${wing.name}.quaternion`,times,values));
  }
  object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true),size=box.getSize(new THREE.Vector3());
  result.meta={...result.meta,id:'gargoyle',family:'gargoyle',height:size.y,width:size.x,depth:size.z,dimensions:size.toArray(),bounds:{min:box.min.toArray(),max:box.max.toArray()},
    textureBindings:bindings,provenance:{...result.meta.provenance,candidateModifications:'Source Monster04 body/face/skin/gait retained; source atlas converted to weathered neutral limestone preserving sculpt shading; original curved bat membrane wings attached to upper spine; roughness .96. No rejected procedural body or head retained.'},
    stoneAtlasSha256:createHash('sha256').update(fs.readFileSync(bodyPath)).digest('hex'),
    distinctSilhouette:true,sourceBodySharedWith:'horned_demon / creature_cinder_ravager',
    acceptance:'one source-based gargoyle graft candidate; anatomical wing attachment, material and full motion need production screenshot review',revision:'gargoyle-source-review-1'};
  return result;
}
