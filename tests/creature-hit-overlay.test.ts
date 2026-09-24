import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { readFileSync } from "node:fs";
import { createMaskedHitOverlay, applyMaskedHitOverlay, hitOverlayWeight } from "../game/src/render/creatureHitOverlay.js";

function bone(name:string,parent:THREE.Object3D) {const b=new THREE.Bone();b.name=name;parent.add(b);return b;}
function rotation(name:string,angles:number[],axis=new THREE.Vector3(1,0,0)) {
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,[0,.5,1],angles.flatMap(angle=>new THREE.Quaternion().setFromAxisAngle(axis,angle).toArray()));
}
function fixture() {
  const root=new THREE.Group(), hips=bone('Wolf_ROOT',root),spine=bone('Wolf_Spine',hips);
  const leg=bone('Wolf_FrontLeg',spine),foot=bone('Wolf_Ankle',leg),neck=bone('Wolf_Neck',spine),head=bone('Wolf_Head',neck);
  leg.position.set(.2,-.5,0);foot.position.set(0,-.4,0);neck.position.set(0,.3,.4);head.position.set(0,.2,.2);
  const idle=new THREE.AnimationClip('Idle',1,[rotation(neck.name,[.2,.2,.2]),rotation(head.name,[0,0,0])]);
  const hit=new THREE.AnimationClip('Hit',1,[rotation(hips.name,[0,.5,0]),rotation(spine.name,[0,.5,0]),rotation(leg.name,[0,.5,0]),
    rotation(neck.name,[.2,.5,.2]),new THREE.VectorKeyframeTrack(`${head.name}.position`,[0,1],[0,0,0,0,1,0]),rotation(head.name,[0,-.15,0])]);
  return {root,hips,spine,leg,foot,neck,head,idle,hit};
}

async function actualPublicRig(id:string) {
  const manifest=JSON.parse(readFileSync('game/public/assets/manifest.json','utf8'));
  const entry=manifest.assets.find((a:any)=>a.id===id),bytes=readFileSync(`game/public/assets/${entry.file}`);
  const jsonLength=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binStart=20+jsonLength+8;
  delete g.images;delete g.textures;delete g.materials;
  for(const mesh of g.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  g.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(binStart).toString('base64')}`;
  (globalThis as any).ProgressEvent ??= class { constructor(public type:string,init:any){Object.assign(this,init);} };
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(g),'');
  return {root:gltf.scene,hit:gltf.animations.find(clip=>clip.name==='Hit')!,idle:gltf.animations.find(clip=>clip.name==='Idle')!,
    walk:gltf.animations.find(clip=>clip.name==='Walk')};
}

describe('support-safe additive creature recoil',()=>{
  it('keeps Mixamo upper-body recoil while protecting locomotion support, and rejects a broken branch',()=>{
    const root=new THREE.Group(), hips=bone('mixamorigHips',root);
    const spine=bone('mixamorigSpine',hips), spine1=bone('mixamorigSpine1',spine), spine2=bone('mixamorigSpine2',spine1);
    const neck=bone('mixamorigNeck',spine2), head=bone('mixamorigHead',neck);
    const expressive=[spine,spine1,spine2,neck,head], protectedBones=[hips];
    let rightShoulder:THREE.Bone;
    for(const side of ['Left','Right']) {
      const shoulder=bone(`mixamorig${side}Shoulder`,spine2), arm=bone(`mixamorig${side}Arm`,shoulder);
      const forearm=bone(`mixamorig${side}ForeArm`,arm), hand=bone(`mixamorig${side}Hand`,forearm);
      if(side==='Right')rightShoulder=shoulder;
      expressive.push(shoulder,arm,forearm,hand);
      const leg=bone(`mixamorig${side}UpLeg`,hips), calf=bone(`mixamorig${side}Leg`,leg);
      const foot=bone(`mixamorig${side}Foot`,calf), toe=bone(`mixamorig${side}ToeBase`,foot);
      leg.position.set(side==='Left'?.2:-.2,-.2,0);calf.position.y=-.4;foot.position.y=-.4;toe.position.z=.2;
      protectedBones.push(leg,calf,foot,toe);
    }
    const all=[...expressive,...protectedBones],idle=new THREE.AnimationClip('Idle',1,all.map(joint=>rotation(joint.name,[0,0,0])));
    const hit=new THREE.AnimationClip('Hit',1,all.map(joint=>rotation(joint.name,[0,.3,0])));
    const result=createMaskedHitOverlay(root,hit,idle);
    expect(result.boneNames.sort()).toEqual(expressive.map(joint=>joint.name).sort());
    for(const angle of [.2,.5]) {
      for(const joint of all)joint.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),angle);
      root.updateMatrixWorld(true);const before=protectedBones.map(joint=>joint.matrixWorld.clone());
      applyMaskedHitOverlay(root,result,.5);root.updateMatrixWorld(true);
      protectedBones.forEach((joint,index)=>expect(joint.matrixWorld.equals(before[index]!)).toBe(true));
    }
    hips.add(rightShoulder!);
    expect(createMaskedHitOverlay(root,hit,idle).boneNames.sort()).toEqual([head.name,neck.name].sort());
  });
  it('keeps CMU mocap upper-body recoil while its hip joints and legs stay protected',()=>{
    const root=new THREE.Group(), hips=bone('mocap_Hips',root), lowerBack=bone('mocap_LowerBack',hips);
    const spine=bone('mocap_Spine',lowerBack), spine1=bone('mocap_Spine1',spine), neck=bone('mocap_Neck',spine1), head=bone('mocap_Head',neck);
    const expressive=[spine,spine1,neck,head], protectedBones=[hips];
    for(const [side,short] of [['Left','L'],['Right','R']]) {
      const shoulder=bone(`mocap_${side}Shoulder`,spine1), arm=bone(`mocap_${side}Arm`,shoulder);
      const forearm=bone(`mocap_${side}ForeArm`,arm);
      expressive.push(shoulder,arm,forearm,bone(`mocap_${side}Hand`,forearm));
      const joint=bone(`mocap_${short}HipJoint`,hips), leg=bone(`mocap_${side}UpLeg`,joint), calf=bone(`mocap_${side}Leg`,leg);
      protectedBones.push(joint,leg,calf,bone(`mocap_${side}Foot`,calf));
    }
    const all=[lowerBack,...expressive,...protectedBones],idle=new THREE.AnimationClip('Idle',1,all.map(joint=>rotation(joint.name,[0,0,0])));
    const hit=new THREE.AnimationClip('Hit',1,all.map(joint=>rotation(joint.name,[0,.3,0])));
    const result=createMaskedHitOverlay(root,hit,idle);
    expect(result.boneNames.sort()).toEqual(expressive.map(joint=>joint.name).sort());
    expect(result.protectedBoneNames).toEqual(expect.arrayContaining(protectedBones.map(joint=>joint.name)));
  });
  it('recognizes the complete hovering six-arm topology while protecting its lower hooks and hover',()=>{
    const root=new THREE.Group(), hover=bone('hollow_root',root), thorax=bone('hollow_thorax',hover);
    const joints=Array.from({length:6},(_,index)=>{
      const arm=bone(`hollow_arm_${index}`,thorax), forearm=bone(`hollow_forearm_${index}`,arm);
      return [arm,forearm,bone(`hollow_hook_${index}`,forearm)];
    }).flat();
    const all=[hover,thorax,...joints];
    const idle=new THREE.AnimationClip('Idle',1,all.map(joint=>rotation(joint.name,[0,0,0])));
    const hit=new THREE.AnimationClip('Hit',1,[...all.map(joint=>rotation(joint.name,[0,.3,0])),
      new THREE.VectorKeyframeTrack('hollow_root.position',[0,1],[0,0,0,0,-3,0])]);
    const overlay=createMaskedHitOverlay(root,hit,idle);
    expect(overlay.status).toBe('native-masked');
    expect(overlay.boneNames).toHaveLength(12);
    expect(overlay.boneNames.every(name=>/^hollow_(?:arm|forearm|hook)_[0-3]$/.test(name))).toBe(true);
    root.updateMatrixWorld(true);
    const protectedBones=[hover,thorax,...joints.filter(joint=>/_[45]$/.test(joint.name))];
    const before=protectedBones.map(joint=>joint.matrixWorld.clone());
    applyMaskedHitOverlay(root,overlay,.5);root.updateMatrixWorld(true);
    protectedBones.forEach((joint,index)=>expect(joint.matrixWorld.elements).toEqual(before[index]!.elements));
    expect(joints[0]!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.2);
    thorax.remove(joints[15]!);
    expect(createMaskedHitOverlay(root,hit,idle).status).toBe('no-safe-mask');
  });
  it('keeps support branches and all their ancestors out of the quaternion-only clip',()=>{
    const f=fixture(),result=createMaskedHitOverlay(f.root,f.hit,f.idle);
    expect(result.status).toBe('native-masked');expect(result.boneNames.sort()).toEqual(['Wolf_Head','Wolf_Neck']);
    expect(result.clip!.blendMode).toBe(THREE.AdditiveAnimationBlendMode);
    expect(result.clip!.tracks.every(t=>t.name.endsWith('.quaternion'))).toBe(true);
    expect(result.excludedBoneNames).toEqual(expect.arrayContaining(['Wolf_ROOT','Wolf_Spine','Wolf_FrontLeg','Wolf_Ankle']));
  });
  it('adds the native delta relative to Idle@0 without changing support world transforms',()=>{
    const f=fixture(),result=createMaskedHitOverlay(f.root,f.hit,f.idle);
    f.hips.position.set(2,.1,3);f.spine.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.4);f.leg.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),.25);
    f.neck.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.8);f.root.updateMatrixWorld(true);
    const before=[f.hips,f.spine,f.leg,f.foot].map(b=>b.matrixWorld.clone()), neckBefore=f.neck.quaternion.clone();
    applyMaskedHitOverlay(f.root,result,.5);f.root.updateMatrixWorld(true);
    expect([f.hips,f.spine,f.leg,f.foot].map(b=>b.matrixWorld.elements)).toEqual(before.map(m=>m.elements));
    expect(f.neck.quaternion.angleTo(neckBefore)).toBeCloseTo(.3,6);
  });
  it('agrees with THREE additive mixer composition',()=>{
    const f=fixture(),result=createMaskedHitOverlay(f.root,f.hit,f.idle),base=new THREE.AnimationClip('Walk',1,[rotation(f.neck.name,[.8,.8,.8])]);
    const mixer=new THREE.AnimationMixer(f.root);const baseAction=mixer.clipAction(base).play(),hitAction=mixer.clipAction(result.clip!).play();
    baseAction.time=.5;hitAction.time=.5;hitAction.setEffectiveWeight(hitOverlayWeight(.5,1));mixer.update(0);
    const expected=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),1.1);
    expect(f.neck.quaternion.clone().normalize().angleTo(expected)).toBeLessThan(1e-6);
  });
  it('is exactly neutral at start/end and reports fallback without mislabelling it native',()=>{
    const f=fixture(),result=createMaskedHitOverlay(f.root,new THREE.AnimationClip('Hit',1,[]),f.idle);
    expect(result.status).toBe('safe-fallback');const original=f.neck.quaternion.clone();
    for(const t of [-1,0,1,2]){applyMaskedHitOverlay(f.root,result,t);expect(f.neck.quaternion.equals(original)).toBe(true);expect(hitOverlayWeight(t,1)).toBe(0);}
    applyMaskedHitOverlay(f.root,result,.18);expect(f.neck.quaternion.angleTo(original)).toBeGreaterThan(.1);
  });
  it('refuses an unclassified or entirely support-only skeleton',()=>{
    const root=new THREE.Group(),spine=bone('Spine',root);bone('Foot',spine);
    expect(createMaskedHitOverlay(root,new THREE.AnimationClip('Hit',1,[rotation('Spine',[0,.5,0])]),new THREE.AnimationClip('Idle',1,[])).status).toBe('no-safe-mask');
    const unknown=new THREE.Group();bone('Head',unknown);
    expect(createMaskedHitOverlay(unknown,new THREE.AnimationClip('Hit',1,[]),new THREE.AnimationClip('Idle',1,[])).clip).toBeNull();
  });
  it('deliberately excludes the accepted red worm because every joint moves weighted belly contacts',async()=>{
    // The exemption is earned by this contact audit on the shipped rig, not by the asset ID.
    const {root,hit,idle,walk}=await actualPublicRig('creature_red_worm');
    const names=['Worm_Rig_Main',...Array.from({length:5},(_,i)=>`Worm_Rig${i+1}`)];
    const bones:THREE.Bone[]=[],meshes:THREE.SkinnedMesh[]=[];
    root.traverse(node=>{
      if((node as THREE.Bone).isBone)bones.push(node as THREE.Bone);
      if((node as THREE.SkinnedMesh).isSkinnedMesh)meshes.push(node as THREE.SkinnedMesh);
    });
    expect(bones.map(bone=>bone.name)).toEqual(names);
    expect(meshes).toHaveLength(1);
    const mesh=meshes[0]!;
    expect(mesh.skeleton.bones.map(bone=>bone.name)).toEqual(names);
    bones.forEach((bone,index)=>expect(bone.children.map(child=>child.name)).toEqual(index<5?[names[index+1]]:[]));
    const overlay=createMaskedHitOverlay(root,hit,idle);
    expect(overlay.status).toBe('no-safe-mask');expect(overlay.clip).toBeNull();
    expect(overlay.boneNames).toEqual([]);expect(overlay.excludedBoneNames).toEqual(names);
    expect(walk).toBeDefined();
    const mixer=new THREE.AnimationMixer(root);mixer.clipAction(walk!).play();
    const update=()=>{root.updateMatrixWorld(true);mesh.skeleton.update();};
    const vertices=()=>Array.from({length:mesh.geometry.attributes.position!.count},(_,index)=>
      mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    const indices=mesh.geometry.attributes.skinIndex!,weights=mesh.geometry.attributes.skinWeight!;
    for(const phase of [0,.25,.5,.75]) {
      mixer.setTime(walk!.duration*phase);update();
      const beforeVertices=vertices(),beforeMatrices=bones.map(bone=>bone.matrixWorld.elements.slice());
      const floor=Math.min(...beforeVertices.map(vertex=>vertex.y));
      for(const [index,joint] of bones.entries()) {
        const contacts=beforeVertices.flatMap((vertex,vertexIndex)=>
          vertex.y-floor<.0011 && [0,1,2,3].some(slot=>indices.getComponent(vertexIndex,slot)===index && weights.getComponent(vertexIndex,slot)>.1)
            ? [vertexIndex] : []);
        expect(contacts.length,`${joint.name} must weight the belly within 1.1 mm of the source floor`).toBeGreaterThan(0);
        const sample=(clip:THREE.AnimationClip,time:number)=>{
          const track=clip.tracks.find(track=>track.name===`${joint.name}.quaternion`)!;
          const interpolant=(track as THREE.KeyframeTrack & {createInterpolant():THREE.Interpolant}).createInterpolant();
          return new THREE.Quaternion().fromArray(interpolant.evaluate(time)).normalize();
        };
        const original=joint.quaternion.clone();
        joint.quaternion.multiply(sample(idle,0).invert().multiply(sample(hit,hit.duration*.5))).normalize();update();
        const displaced=vertices();
        expect(Math.max(...contacts.map(vertexIndex=>displaced[vertexIndex]!.distanceTo(beforeVertices[vertexIndex]!))),
          `${joint.name}'s authored Hit must move its actual belly contacts`).toBeGreaterThan(1e-5);
        joint.quaternion.copy(original);update();
      }
      applyMaskedHitOverlay(root,overlay,hit.duration*.4);update();
      expect(bones.map(bone=>bone.matrixWorld.elements)).toEqual(beforeMatrices);
      expect(vertices().map(vertex=>vertex.toArray())).toEqual(beforeVertices.map(vertex=>vertex.toArray()));
    }
  });
  const publicCharacters = JSON.parse(readFileSync('game/public/assets/manifest.json','utf8')).assets
    .filter((asset:any)=>asset.category==='character' && asset.animations?.includes('Hit'));
  const inventoryRows:any[]=[];
  // Keep the full catalog proof, but give failures an asset-sized batch instead of one
  // growing timeout around every GLTFLoader parse in the game.
  const inventoryBatchSize=24;
  it.each(Array.from({length:Math.ceil(publicCharacters.length/inventoryBatchSize)},(_,index)=>index))(
    'inventories actual GLTFLoader public character masks and verifies protected transforms, batch %i',async(batch)=>{
    const rows:any[]=[];
    const entries=publicCharacters.slice(batch*inventoryBatchSize,(batch+1)*inventoryBatchSize);
    for(const entry of entries) {
      try {
        const {root,hit,idle,walk}=await actualPublicRig(entry.id);
        if(!hit || !idle)throw new Error('Missing native Hit or Idle clip');
        const result=createMaskedHitOverlay(root,hit,idle);
        if(walk){const mixer=new THREE.AnimationMixer(root);mixer.clipAction(walk).play();mixer.setTime(walk.duration*.37);}
        root.updateMatrixWorld(true);const before=new Map<string,number[]>();
        for(const name of result.protectedBoneNames)before.set(name,root.getObjectByName(name)!.matrixWorld.elements.slice());
        applyMaskedHitOverlay(root,result,hit.duration*.4);root.updateMatrixWorld(true);
        const changed=[...before].filter(([name,matrix])=>root.getObjectByName(name)!.matrixWorld.elements.some((value,i)=>value!==matrix[i])).map(([name])=>name);
        rows.push({id:entry.id,status:result.status,bones:result.boneNames,tracks:result.clip?.tracks.length??0,protectedBones:result.protectedBoneNames,
          protectedWorldMatricesUnchanged:changed.length===0,changedProtectedBones:changed,loader:'THREE.GLTFLoader',sampledWalkPhase:.37,sampledHitPhase:.4});
      }catch(error){rows.push({id:entry.id,status:'diagnostic-error',error:String(error)});}
    }
    inventoryRows.push(...rows);
    expect(rows.filter(row=>row.status==='diagnostic-error')).toEqual([]);
    expect(rows.filter(row=>row.status==='no-safe-mask').map(row=>row.id))
      .toEqual(entries.filter((entry:any)=>entry.id==='creature_red_worm').map((entry:any)=>entry.id));
    expect(rows.filter(row=>!row.protectedWorldMatricesUnchanged)).toEqual([]);
  },30000);
  it('covers every public character exactly once across the recoil inventory batches',()=>{
    const rows=inventoryRows;
    expect(rows.map(row=>row.id).sort()).toEqual(publicCharacters.map((entry:any)=>entry.id).sort());
    const report={unsupported:rows.filter(row=>row.status==='no-safe-mask'),errors:rows.filter(row=>row.status==='diagnostic-error')};
    expect(rows.length).toBeGreaterThan(4);
    expect(report.errors).toEqual([]);expect(report.unsupported.map(row=>row.id)).toEqual(['creature_red_worm']);
    expect(rows.filter(row=>!row.protectedWorldMatricesUnchanged)).toEqual([]);
  });
});
