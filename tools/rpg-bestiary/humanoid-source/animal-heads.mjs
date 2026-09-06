import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readSourceGlb } from './read-glb.mjs';

const derived=path.resolve('tools/rpg-bestiary/humanoid-source/derived');
let wolf,croc;
function wolfSource(){
  if(wolf)return wolf;
  const originalLoad=THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};
  globalThis.window??={URL:{createObjectURL:()=>''}};
  let root;
  try{const bytes=fs.readFileSync(path.join(derived,'Wolf_Rig.fbx'));root=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
  finally{THREE.TextureLoader.prototype.load=originalLoad;}
  root.updateMatrixWorld(true);let mesh;root.traverse(n=>{if(n.isSkinnedMesh)mesh=n;});
  const source=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone(),p=source.attributes.position;
  for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);p.setXYZ(i,v.x,v.y,v.z);}
  wolf={geometry:source,boneNames:mesh.skeleton.bones.map(b=>b.name),jaw:new THREE.Vector3(0,81.3197,77.7558)};return wolf;
}

function crocodileSource(){
  if(croc)return croc;
  const file=readSourceGlb('game/public/assets/models/creature/creature_reedjaw_crocodile.glb');
  const nodes=file.json.nodes.map(n=>{const g=new THREE.Object3D();if(n.translation)g.position.fromArray(n.translation);if(n.rotation)g.quaternion.fromArray(n.rotation);if(n.scale)g.scale.fromArray(n.scale);return g;});
  file.json.nodes.forEach((n,i)=>{for(const c of n.children||[])nodes[i].add(nodes[c]);});for(const i of file.json.scenes[0].nodes)nodes[i].updateMatrixWorld(true);
  const index=file.json.nodes.findIndex(n=>n.mesh!==undefined),node=file.json.nodes[index],primitive=file.json.meshes[node.mesh].primitives[0],geometry=new THREE.BufferGeometry();
  for(const [semantic,name]of Object.entries({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'})){const a=file.accessor(primitive.attributes[semantic]);geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));}
  if(primitive.indices!==undefined)geometry.setIndex(new THREE.BufferAttribute(file.accessor(primitive.indices).array,1));
  // glTF positions are the source bind mesh, whose crocodile jaw is open.
  // Bake the actual source Idle pose through inverse binds before fitting the head.
  const jointIds=file.json.skins[node.skin].joints,inv=file.accessor(file.json.skins[node.skin].inverseBindMatrices).array;
  const skeleton=new THREE.Skeleton(jointIds.map(i=>nodes[i]),jointIds.map((_,i)=>new THREE.Matrix4().fromArray(inv,i*16)));
  const posedMesh=new THREE.SkinnedMesh(geometry);posedMesh.name='crocodile_pose_probe';
  nodes[index].add(posedMesh);posedMesh.bind(skeleton,new THREE.Matrix4());
  const scene=new THREE.Group();for(const i of file.json.scenes[0].nodes)scene.add(nodes[i]);
  nodes.forEach((n,i)=>n.name=file.json.nodes[i].name||`source_node_${i}`);
  const animation=file.json.animations.find(a=>a.name==='Idle'),tracks=[];
  for(const c of animation.channels){
    const sampler=animation.samplers[c.sampler],times=file.accessor(sampler.input).array,values=file.accessor(sampler.output).array;
    const suffix={translation:'position',rotation:'quaternion',scale:'scale'}[c.target.path],name=`${nodes[c.target.node].name}.${suffix}`;
    const C=c.target.path==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;tracks.push(new C(name,times,values));
  }
  const mixer=new THREE.AnimationMixer(scene);mixer.clipAction(new THREE.AnimationClip('source_idle',-1,tracks)).play();mixer.setTime(0);scene.updateMatrixWorld(true);
  const sourceJawNode=nodes[file.json.nodes.findIndex(n=>n.name==='Crocodile_Head_JawSHJnt')];
  // The source Idle retains a basking gape. Close it in the original source rig,
  // before baking, so jaw skin influences and teeth stay coherent.
  const closeWorld=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-.40)
    .multiply(sourceJawNode.getWorldQuaternion(new THREE.Quaternion()));
  sourceJawNode.quaternion.copy(sourceJawNode.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(closeWorld));scene.updateMatrixWorld(true);
  const flat=geometry.index?geometry.toNonIndexed():geometry.clone(),p=flat.attributes.position;
  for(let i=0;i<p.count;i++){
    const originalIndex=geometry.index?geometry.index.getX(i):i;
    const v=posedMesh.getVertexPosition(originalIndex,new THREE.Vector3()).applyMatrix4(posedMesh.matrixWorld);p.setXYZ(i,v.x,v.y,v.z);
  }
  const sourceJaw=sourceJawNode.getWorldPosition(new THREE.Vector3());
  for(const [i,name]of [[0,'croc-head-albedo.png'],[1,'croc-head-normal.png']]){const image=file.json.images[i],view=file.json.bufferViews[image.bufferView];fs.writeFileSync(path.join(derived,name),file.bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength));}
  croc={geometry:flat,boneNames:file.json.skins[node.skin].joints.map(i=>file.json.nodes[i].name),jaw:sourceJaw};return croc;
}

export function animalHeadSource(family){
  const isWolf=family==='gnoll',source=isWolf?wolfSource():crocodileSource();
  const map=isWolf?(v)=>{
    // Shorten the canid rostrum and widen the skull for a hyena-like head.
    const ear=THREE.MathUtils.smoothstep(v.y,96,104),neck=THREE.MathUtils.smoothstep(v.z,55,66);
    return new THREE.Vector3(v.x*.0134*(1+ear*.12),1.51+(v.y-77)*.0108+neck*.035-ear*.030,.045+(v.z-55)*.0105);
  }:(v)=>{
    const neck=THREE.MathUtils.smoothstep(v.z,.60,.80);
    return new THREE.Vector3(v.x*.70,1.52+(v.y-.24)*.75+neck*.13,.035+(v.z-.60)*.55);
  };
  return {...source,map,jawPosition:map(source.jaw),accept:(v)=>isWolf?v.z>55&&v.y>67:v.z>.75,materialName:`${family}_source_animal_head`,textureBindings:isWolf?{baseColorPath:path.join(derived,'common_wolf_col2_unity.tga.png'),normalPath:path.join(derived,'common_wolf_nrml4.tga.png')}:{baseColorPath:path.join(derived,'croc-head-albedo.png'),normalPath:path.join(derived,'croc-head-normal.png')}};
}

export function fitAnimalHead(source,object,skeleton,family){
  const head=skeleton.bones.findIndex(b=>b.name==='Head'),neck=skeleton.bones.findIndex(b=>b.name==='neck_01'),jaw=skeleton.bones.findIndex(b=>b.name===`${family}_jaw`);
  const attrs=source.geometry.attributes,out={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]};
  const wp=i=>new THREE.Vector3().fromBufferAttribute(attrs.position,i);
  const belongsToHead=i=>{
    let weight=0;for(let s=0;s<4;s++){const name=source.boneNames[attrs.skinIndex.array[i*4+s]];if(/Neck|Head|Ear|Tongue/.test(name))weight+=attrs.skinWeight.array[i*4+s];}
    return weight>.40;
  };
  for(let i=0;i<attrs.position.count;i+=3){
    if(![0,1,2].every(k=>source.accept(wp(i+k))&&belongsToHead(i+k)))continue;
    for(let k=0;k<3;k++){
      const index=i+k,p=source.map(wp(index));out.position.push(...p.toArray());
      out.uv.push(attrs.uv.getX(index),family==='gnoll'?1-attrs.uv.getY(index):attrs.uv.getY(index));
      const influence=new Map();
      for(let s=0;s<4;s++){
        const sourceName=source.boneNames[attrs.skinIndex.array[index*4+s]],w=attrs.skinWeight.array[index*4+s];if(!w)continue;
        const target=/Jaw|Tongue/.test(sourceName)?jaw:/Neck_01|Neck_02|Spine/.test(sourceName)?neck:head;
        influence.set(target,(influence.get(target)||0)+w);
      }
      const entries=[...influence.entries()].sort((a,b)=>b[1]-a[1]);for(let s=0;s<4;s++){out.skinIndex.push(entries[s]?.[0]??head);out.skinWeight.push(entries[s]?.[1]??0);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(out.position,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(out.uv,2));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(out.skinIndex,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(out.skinWeight,4));g.computeVertexNormals();
  const mat=new THREE.MeshStandardMaterial({name:source.materialName,color:family==='gnoll'?0xb5a68c:0xa1b298,roughness:.88});
  const mesh=new THREE.SkinnedMesh(g,mat);mesh.name=`${family}_genuine_animal_skull`;object.add(mesh);mesh.bind(skeleton);mesh.castShadow=true;mesh.frustumCulled=false;
  if(family==='gnoll'){
    // The quadruped neck crop leaves the rear skull open above the human collar.
    // Close that volume with fur, overlapping both the collar and source skull.
    const contours=[
      [1.385,.077,.080,.025], [1.445,.101,.100,.040],
      [1.515,.119,.112,.060], [1.585,.132,.122,.080],
      [1.650,.137,.119,.095], [1.710,.121,.096,.125],
      [1.755,.080,.063,.157], [1.777,.035,.027,.175],
    ];
    const positions=[],uv=[],joints=[],weights=[],indices=[],segments=28;
    const spine=skeleton.bones.findIndex(b=>b.name==='spine_03');
    if([spine,neck,head].some(i=>i<0))throw new Error('Gnoll neck requires spine_03, neck_01 and Head');
    contours.forEach(([y,rx,rz,z],r)=>{
      const hw=THREE.MathUtils.smoothstep(y,1.50,1.69);
      const nw=(1-hw)*THREE.MathUtils.smoothstep(y,1.405,1.55);
      for(let k=0;k<segments;k++){
        const a=k/segments*Math.PI*2;
        positions.push(Math.cos(a)*rx,y,z+Math.sin(a)*rz);
        // This interior body-fur atlas patch excludes eyes, teeth and padding.
        uv.push(.48+.12*k/(segments-1),.40+.15*r/(contours.length-1));
        joints.push(spine,neck,head,0);weights.push(1-hw-nw,nw,hw,0);
        if(r<contours.length-1){
          const n=r*segments+k,b=r*segments+(k+1)%segments;
          indices.push(n,n+segments,b,b,n+segments,b+segments);
        }
      }
    });
    for(let k=1;k<segments-1;k++){
      indices.push(0,k,k+1);
      const n=(contours.length-1)*segments;indices.push(n,n+k+1,n+k);
    }
    const bridge=new THREE.BufferGeometry();
    bridge.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    bridge.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    bridge.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
    bridge.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    bridge.setIndex(indices);bridge.computeVertexNormals();
    const neckMesh=new THREE.SkinnedMesh(bridge,mat);neckMesh.name='gnoll_closed_blended_neck';
    object.add(neckMesh);neckMesh.bind(skeleton);neckMesh.castShadow=true;neckMesh.frustumCulled=false;
  }
  if(family==='lizardman'){
    // Closed anatomical neck volume overlaps the collar and the cropped skull.
    // Its three-bone blend spans torso -> neck -> head instead of a rigid strip.
    const contours=[
      [1.395,.082,.078,.025], [1.45,.102,.086,.037],
      [1.515,.123,.094,.058], [1.575,.135,.106,.087],
      [1.635,.134,.105,.116], [1.695,.116,.087,.143],
      [1.748,.084,.067,.165], [1.776,.045,.040,.172],
    ];
    const p=[],uv=[],si=[],sw=[],index=[],segments=28;
    const spine=skeleton.bones.findIndex(b=>b.name==='spine_03');
    contours.forEach(([y,rx,rz,z],r)=>{
      const headWeight=THREE.MathUtils.smoothstep(y,1.525,1.695),neckWeight=(1-headWeight)*THREE.MathUtils.smoothstep(y,1.415,1.55),spineWeight=1-headWeight-neckWeight;
      for(let k=0;k<=segments;k++){
        const a=k/segments*Math.PI*2;p.push(Math.cos(a)*rx,y,z+Math.sin(a)*rz);uv.push(.06+k/segments*.11,.12+r/(contours.length-1)*.2);
        si.push(spine,neck,head,0);sw.push(spineWeight,neckWeight,headWeight,0);
        if(r<contours.length-1&&k<segments){const n=r*(segments+1)+k,b=n+1;index.push(n,n+segments+1,b,b,n+segments+1,b+segments+1);}
      }
    });
    // Caps remain inside collar/skull, making the bridge a closed solid mesh.
    for(let k=1;k<segments-1;k++){index.push(0,k,k+1);const n=(contours.length-1)*(segments+1);index.push(n,n+k+1,n+k);}
    const bridge=new THREE.BufferGeometry();bridge.setAttribute('position',new THREE.Float32BufferAttribute(p,3));bridge.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));bridge.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));bridge.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));bridge.setIndex(index);bridge.computeVertexNormals();
    const neckMesh=new THREE.SkinnedMesh(bridge,mat);neckMesh.name='lizardman_closed_blended_neck';object.add(neckMesh);neckMesh.bind(skeleton);neckMesh.castShadow=true;neckMesh.frustumCulled=false;
  }
  return {materialName:source.materialName,...source.textureBindings};
}
