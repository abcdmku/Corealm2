import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

/** Deserialize original GLB skeleton/animation values without a WebGL context or texture loader. */
function publicRig(id:string) {
  const manifest=JSON.parse(readFileSync('game/public/assets/manifest.json','utf8'));
  const entry=manifest.assets.find((a:any)=>a.id===id), bytes=readFileSync(`game/public/assets/${entry.file}`);
  const jsonBytes=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+jsonBytes).toString()),binStart=20+jsonBytes+8;
  const jointIds=new Set<number>((g.skins??[]).flatMap((s:any)=>s.joints));
  const nodes:THREE.Object3D[]=g.nodes.map((n:any,i:number)=>{const o=jointIds.has(i)?new THREE.Bone():new THREE.Group();o.name=n.name ?? String(i);
    if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
  g.nodes.forEach((n:any,i:number)=>n.children?.forEach((child:number)=>nodes[i]!.add(nodes[child]!)));
  const root=new THREE.Group();for(const node of nodes)if(!node.parent)root.add(node);
  function accessor(index:number) {const a=g.accessors[index],v=g.bufferViews[a.bufferView],width=({SCALAR:1,VEC3:3,VEC4:4} as any)[a.type];
    if(a.componentType!==5126 || !width)throw new Error('Test expects float animation data');
    return Array.from({length:a.count*width},(_,i)=>bytes.readFloatLE(binStart+(v.byteOffset??0)+(a.byteOffset??0)+Math.floor(i/width)*(v.byteStride??width*4)+(i%width)*4));}
  const clips=g.animations.map((a:any)=>new THREE.AnimationClip(a.name,-1,a.channels.filter((c:any)=>['rotation','translation','scale'].includes(c.target.path)).map((c:any)=>{
    const s=a.samplers[c.sampler],name=`${nodes[c.target.node]!.name}.${({rotation:'quaternion',translation:'position',scale:'scale'} as any)[c.target.path]}`;
    const Track=c.target.path==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
    return new Track(name,accessor(s.input),accessor(s.output),s.interpolation==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear);
  })));
  return {root,hit:clips.find((c:THREE.AnimationClip)=>c.name==='Hit')!,idle:clips.find((c:THREE.AnimationClip)=>c.name==='Idle')!,
    walk:clips.find((c:THREE.AnimationClip)=>c.name==='Walk'),sha256:createHash('sha256').update(bytes).digest('hex')};
}

async function actualPublicRig(id:string) {
  const manifest=JSON.parse(readFileSync('game/public/assets/manifest.json','utf8'));
  const entry=manifest.assets.find((a:any)=>a.id===id),bytes=readFileSync(`game/public/assets/${entry.file}`);
  const jsonLength=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binStart=20+jsonLength+8;
  delete g.images;delete g.textures;delete g.materials;
  for(const mesh of g.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  g.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(binStart).toString('base64')}`;
  (globalThis as any).ProgressEvent ??= class { constructor(public type:string,init:any){Object.assign(this,init);} };
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify(g),'');
  return {root:gltf.scene,hit:gltf.animations.find(clip=>clip.name==='Hit')!,idle:gltf.animations.find(clip=>clip.name==='Idle')!,
    walk:gltf.animations.find(clip=>clip.name==='Walk'),sha256:createHash('sha256').update(bytes).digest('hex')};
}
const unchangedCoreMasks:Record<string,string>={
  creature_beetle_golem:'5a9f67d8962bdf8b6dd67eb0cbf14dfcdeee158d679d8f0e1fbdcde77e846589',
  creature_lava_golem:'4340707fac1c9376f042248559ad8e9a3ab18a40f8e4c115950b6d7c32d27fda',
  creature_mossback_sentinel:'7b65da47dd01ea0dd8ea7818fd631c554e2e2dfc44cf2aa1c0c792986614b7e4',
  creature_shale_elemental:'2371e194509276c94e691e2c31652033152c8fcfbe0e65e73762885dcca1a2f3',
};
const overlayDigest=(clip:THREE.AnimationClip|null)=>createHash('sha256').update(JSON.stringify(clip?.tracks.map(track=>({name:track.name,times:Array.from(track.times),values:Array.from(track.values)})))).digest('hex');

describe('support-safe additive creature recoil',()=>{
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
  it.each(['creature_beetle_golem','creature_mossback_sentinel','creature_lava_golem','creature_shale_elemental'])(
    'builds a nonempty safe mask on actual public %s',id=>{
      const {root,hit,idle,walk,sha256}=publicRig(id),result=createMaskedHitOverlay(root,hit,idle);
      console.log(JSON.stringify({assetId:id,nativeHit:hit.name,status:result.status,eligibleBones:result.boneNames,tracks:result.clip?.tracks.length}));
      expect(result.status).not.toBe('no-safe-mask');expect(result.boneNames.length).toBeGreaterThan(0);
      expect(overlayDigest(result.clip)).toBe(unchangedCoreMasks[id]);
      if(walk){const mixer=new THREE.AnimationMixer(root);mixer.clipAction(walk).play();mixer.setTime(walk.duration*.37);}
      root.updateMatrixWorld(true);const before=new Map<string,number[]>();
      for(const name of result.protectedBoneNames)before.set(name,root.getObjectByName(name)!.matrixWorld.elements.slice());
      applyMaskedHitOverlay(root,result,hit.duration*.4);root.updateMatrixWorld(true);
      for(const [name,matrix] of before)expect(root.getObjectByName(name)!.matrixWorld.elements,`${id}:${name}`).toEqual(matrix);
      if(id==='creature_beetle_golem')expect(result.boneNames.every(name=>!/^beetle_(?:1|2[2-9])_/.test(name))).toBe(true);
      if(id==='creature_mossback_sentinel')expect(result.boneNames.some(name=>/Arm|Spine/.test(name))).toBe(true);
      mkdirSync('test-results/creature-hit-overlay-mask',{recursive:true});
      writeFileSync(`test-results/creature-hit-overlay-mask/${id}.json`,JSON.stringify({assetId:id,sha256,nativeHit:hit.name,
        status:result.status,eligibleBones:result.boneNames,tracks:result.clip?.tracks.map(track=>track.name),protectedBones:result.protectedBoneNames,
        overlaySha256:createHash('sha256').update(JSON.stringify(result.clip?.tracks.map(track=>({name:track.name,times:Array.from(track.times),values:Array.from(track.values)})))).digest('hex'),
        sampledWalkPhase:.37,sampledHitPhase:.4,protectedWorldMatricesUnchanged:true,visualAccepted:false},null,2));
    });
  it('inventories actual GLTFLoader public character masks and verifies protected transforms',async()=>{
    const manifest=JSON.parse(readFileSync('game/public/assets/manifest.json','utf8'));
    const rows:any[]=[];
    for(const entry of manifest.assets.filter((a:any)=>a.category==='character' && a.animations?.includes('Hit'))) {
      try {
        const {root,hit,idle,walk,sha256}=await actualPublicRig(entry.id);
        if(!hit || !idle)throw new Error('Missing native Hit or Idle clip');
        const result=createMaskedHitOverlay(root,hit,idle);
        if(walk){const mixer=new THREE.AnimationMixer(root);mixer.clipAction(walk).play();mixer.setTime(walk.duration*.37);}
        root.updateMatrixWorld(true);const before=new Map<string,number[]>();
        for(const name of result.protectedBoneNames)before.set(name,root.getObjectByName(name)!.matrixWorld.elements.slice());
        applyMaskedHitOverlay(root,result,hit.duration*.4);root.updateMatrixWorld(true);
        const changed=[...before].filter(([name,matrix])=>root.getObjectByName(name)!.matrixWorld.elements.some((value,i)=>value!==matrix[i])).map(([name])=>name);
        rows.push({id:entry.id,sha256,status:result.status,bones:result.boneNames,tracks:result.clip?.tracks.length??0,protectedBones:result.protectedBoneNames,
          protectedWorldMatricesUnchanged:changed.length===0,changedProtectedBones:changed,loader:'THREE.GLTFLoader',sampledWalkPhase:.37,sampledHitPhase:.4});
      }catch(error){rows.push({id:entry.id,status:'diagnostic-error',error:String(error)});}
    }
    mkdirSync('test-results/creature-hit-overlay-mask',{recursive:true});
    const report={count:rows.length,unsupported:rows.filter(row=>row.status==='no-safe-mask'),errors:rows.filter(row=>row.status==='diagnostic-error'),rows};
    writeFileSync('test-results/creature-hit-overlay-mask/public-inventory.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify({publicMaskCount:rows.length,unsupported:report.unsupported.map(row=>row.id),errors:report.errors}));
    expect(rows.length).toBeGreaterThan(4);
    expect(report.errors).toEqual([]);expect(report.unsupported).toEqual([]);
    expect(rows.filter(row=>!row.protectedWorldMatricesUnchanged)).toEqual([]);
  },30000);
});
