import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { CreatureRepairProfile } from '../repairProfile.js';
import { retargetCreatureMotion, type CreatureMotionProfile } from '../retarget.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import { applyClip, duration, restorePose, sample, storedPose } from '../../creature-motion/pose.js';

const P = 'mixamorig:';
const worldPosition = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
const names: Record<string, string> = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' };
const children: Record<string, string> = { Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head' };
for (const [side, suffix] of [['Left', 'l'], ['Right', 'r']] as const) {
  for (const [a, b] of [['Shoulder', 'clavicle'], ['Arm', 'upperarm'], ['ForeArm', 'lowerarm'], ['Hand', 'hand'], ['UpLeg', 'thigh'], ['Leg', 'calf'], ['Foot', 'foot'], ['ToeBase', 'ball']] as const) names[side + a] = b + '_' + suffix;
  for (const [a, b] of [['Shoulder', 'Arm'], ['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['Hand', 'HandMiddle1'], ['UpLeg', 'Leg'], ['Leg', 'Foot'], ['Foot', 'ToeBase']] as const) children[side + a] = side + b;
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (let i = 1; i <= 3; i++) names[side + 'Hand' + finger + i] = finger.toLowerCase() + '_0' + i + '_' + suffix;
}

/** Assumes an anatomically reviewed +Z-facing target bind, including its presentation parents. */
export function retargetMixamoColon(doc: Document, donor: Document, deathGroundingMaxSpeedMps?: number) {
  const nodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
  const source = new Map(donor.getRoot().listNodes().map(n => [n.getName(), n]));
  const mapping = Object.fromEntries(Object.entries(names).filter(([a, b]) => nodes.has(P + a) && source.has(b)).map(([a, b]) => [P + a, b]));
  const directionChildren = Object.fromEntries(Object.entries(children).filter(([a, b]) => mapping[P + a] && mapping[P + b] && worldPosition(nodes.get(P + a)!).distanceTo(worldPosition(nodes.get(P + b)!)) > 1e-5).map(([a, b]) => [P + a, P + b]));
  const chainLength = (map: Map<string, Node>, chain: string[]) => chain.slice(1).reduce((n, b, i) => n + worldPosition(map.get(chain[i]!)!).distanceTo(worldPosition(map.get(b)!)), 0);
  const scale = chainLength(nodes, ['LeftUpLeg', 'LeftLeg', 'LeftFoot'].map(n => P + n)) / chainLength(source, ['thigh_l', 'calf_l', 'foot_l']);
  const bounds = deformedBounds(doc);
  const profile: CreatureMotionProfile = {
    mapping, directionChildren, sourceToTargetRotation: [0, 0, 0, 1],
    root: { target: P + 'Hips', source: 'pelvis', translationScale: scale, horizontal: 'in-place' },
    clips: { Idle: { source: 'Idle_Loop', loop: true }, Walk: { source: 'Walk_Loop', loop: true }, Run: { source: 'Jog_Fwd_Loop', loop: true }, Attack: { source: 'Punch_Jab' }, Hit: { source: 'Hit_Chest' }, Death: { source: 'Death01', duration: 1.05, holdLastSeconds: .45, ...(deathGroundingMaxSpeedMps === undefined ? {} : { groundingMaxSpeedMps: deathGroundingMaxSpeedMps }) } },
    replaceAnimations: true, grounding: { floor: 0 },
  };
  const report = retargetCreatureMotion(doc, donor, profile);
  return { ...report, bindBounds: bounds, measurements: measureMixamoColonMotion(doc, donor) };
}

/** Read motion only. Native donor contact phases are independent of target floor lift. */
export function measureMixamoColonMotion(doc: Document, donor: Document) {
  const nodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
  const source = new Map(donor.getRoot().listNodes().map(n => [n.getName(), n]));
  const pose = storedPose(doc), donorPose = storedPose(donor);
  const cycleSpeed = (name: string, native: string) => {
    const clip = doc.getRoot().listAnimations().find(c => c.getName() === name)!, seconds = duration(clip), intervals = 240;
    const sourceClip = donor.getRoot().listAnimations().find(c => c.getName() === native)!;
    const samples = Array.from({ length: intervals + 1 }, (_, i) => {
      restorePose(pose); applyClip(clip, seconds * i / intervals);
      restorePose(donorPose); applyClip(sourceClip, duration(sourceClip) * i / intervals);
      return {
        target: ['LeftFoot', 'RightFoot'].map(n => worldPosition(nodes.get(P + n)!)),
        source: ['foot_l', 'foot_r'].map(n => worldPosition(source.get(n)!)),
      };
    });
    const speeds: number[] = [], feet: { side: string; metresPerSecond: number; stanceSamples: number; contactIntervals: number; minimumVelocity: number; maximumVelocity: number }[] = [];
    for (let side = 0; side < 2; side++) {
      const low = Math.min(...samples.map(row => row.source[side]!.y)), high = Math.max(...samples.map(row => row.source[side]!.y));
      const window = (high - low) * .12, backward: number[] = [], contact: number[] = [];
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!.target[side]!, b = samples[i]!.target[side]!;
        const velocity = (a.z - b.z) * intervals / seconds;
        if (samples[i - 1]!.source[side]!.y < low + window && samples[i]!.source[side]!.y < low + window) {
          contact.push(velocity);
          if (velocity > 0) { speeds.push(velocity); backward.push(velocity); }
        }
      }
      backward.sort((a,b) => a-b);
      if (!backward.length) throw new Error(`${name} ${side ? 'Right' : 'Left'} has no backward movement during donor contact`);
      feet.push({ side: side ? 'Right' : 'Left', metresPerSecond: backward[Math.floor(backward.length / 2)]!, stanceSamples: backward.length,
        contactIntervals: contact.length, minimumVelocity: Math.min(...contact), maximumVelocity: Math.max(...contact) });
    }
    speeds.sort((a, b) => a - b);
    if (!speeds.length) throw new Error(`${name} has no measurable backward stance motion`);
    const sideRatio = Math.max(...feet.map(f=>f.metresPerSecond)) / Math.min(...feet.map(f=>f.metresPerSecond));
    return { metresPerSecond: speeds[Math.floor(speeds.length / 2)]!, stanceSamples: speeds.length, feet, sideRatio,
      method: 'Target backward-foot speed during native donor ankle contact phases, sourceY bottom12% of per-clip range' };
  };
  const walk = cycleSpeed('Walk', 'Walk_Loop'), run = cycleSpeed('Run', 'Jog_Fwd_Loop');
  const attack = doc.getRoot().listAnimations().find(c => c.getName() === 'Attack')!;
  let reach = -Infinity, contactNormalized = 0;
  for (let i = 0; i <= 240; i++) {
    restorePose(pose); applyClip(attack, duration(attack) * i / 240);
    const forward = worldPosition(nodes.get(P + 'LeftHand')!).z - worldPosition(nodes.get(P + 'Hips')!).z;
    if (forward > reach) { reach = forward; contactNormalized = i / 240; }
  }
  restorePose(pose); restorePose(donorPose);
  return { walk, run, contactNormalized, strikingHand: 'LeftHand', maximumReach: reach };
}

type Point = [number, number, number];
type LandmarkSet = { core: Point[]; arm: Point[]; leg: Point[] };
// Coordinates are in the source mesh's one-metre authoring space. These are anatomical
// pelvis, spine, neck/head, shoulder/elbow/wrist and hip/knee/ankle pivots, not box extents.
const landmarks: Record<string, LandmarkSet> = {
  votary: { core: [[0,.49,.02],[0,.56,.02],[0,.645,.015],[0,.735,.005],[0,.805,.005],[0,.85,.015]], arm: [[.09,.765,.005],[.145,.745,.005],[.197,.605,.005],[.215,.475,.015]], leg: [[.103,.48,.005],[.135,.265,.005],[.143,.075,-.005],[.143,.035,.052]] },
  custodian: { core: [[0,.48,-.025],[0,.56,-.01],[0,.65,0],[0,.735,.005],[0,.83,-.005],[0,.875,-.005]], arm: [[.105,.78,0],[.17,.755,0],[.215,.60,.005],[.235,.48,.015]], leg: [[.105,.475,-.025],[.135,.26,-.055],[.14,.075,-.05],[.14,.032,.025]] },
  starroot: { core: [[0,.405,-.045],[0,.47,-.02],[0,.555,.005],[0,.64,.005],[0,.735,.005],[0,.795,.005]], arm: [[.10,.65,0],[.165,.63,0],[.245,.49,.025],[.315,.365,.025]], leg: [[.09,.39,-.05],[.105,.235,-.075],[.155,.075,-.04],[.17,.027,.035]] },
};
const starroots = ['creature_mossback_sentinel', 'creature_silverthorn_harrow', 'fairy_garden_sapling_faeholme', 'fairy_guardian_03_gloamgarden', 'fantasy_monster_03'];

function adaptCrownedDeath(donor: Document) {
  const clip = donor.getRoot().listAnimations().find(c => c.getName() === 'Death01')!;
  const channel = clip.listChannels().find(c => c.getTargetNode()!.getName() === 'Head' && c.getTargetPath() === 'rotation')!;
  const sampler = channel.getSampler()!, start = 1, end = 1.4;
  const a = new Quaternion().fromArray(sample(sampler, start)), b = new Quaternion().fromArray(sample(sampler, end));
  const times = sampler.getInput()!.getArray()!, output = sampler.getOutput()!;
  // The human impact flick drives this guardian's rigid crown below the floor,
  // lifting its whole torso 47cm in one frame. Keep the donor endpoint poses and
  // settle the head between them; root, torso, limbs and other takes stay native.
  for (let i = 0; i < times.length; i++) {
    const time = Number(times[i]);
    if (time > start && time < end) output.setElement(i, a.clone().slerp(b, (time - start) / (end - start)).toArray());
  }
  return { sourceTake: 'Death01', sourceNode: 'Head', sourceSeconds: [start, end],
    method: 'Retained donor head endpoint poses with a continuous settle across the human impact overshoot for the tall rigid crown.' };
}

function fitAnatomy(doc: Document, fit: LandmarkSet) {
  const skin = doc.getRoot().listSkins()[0]!;
  const joints = skin.listJoints(), byName = new Map(doc.getRoot().listNodes().map(n => [n.getName().replace(P, ''), n]));
  const mesh = doc.getRoot().listNodes().find(n => n.getSkin() === skin && n.getMesh())!;
  const meshMatrix = new Matrix4().fromArray(mesh.getWorldMatrix());
  const desired = new Map<Node, Matrix4>();
  const put = (name: string, point: Point) => { const node = byName.get(name); if (node) desired.set(node, meshMatrix.clone().multiply(new Matrix4().makeTranslation(...point))); };
  ['Hips','Spine','Spine1','Spine2','Neck','Head'].forEach((name, i) => put(name, fit.core[i]!));
  for (const [side, sign] of [['Left',1],['Right',-1]] as const) {
    const mirror = (p: Point): Point => [p[0] * sign, p[1], p[2]];
    ['Shoulder','Arm','ForeArm','Hand'].forEach((name, i) => put(side + name, mirror(fit.arm[i]!)));
    ['UpLeg','Leg','Foot','ToeBase'].forEach((name, i) => put(side + name, mirror(fit.leg[i]!)));
    const hand = new Vector3(...fit.arm[3]!), axis = hand.clone().sub(new Vector3(...fit.arm[2]!)).normalize();
    for (const [f, offset] of [['Index',-.016],['Middle',0],['Ring',.016],['Pinky',.028],['Thumb',-.032]] as const) for (let i=1;i<=4;i++) {
      const p = hand.clone().addScaledVector(axis, i*.018); p.z += offset; put(side+'Hand'+f+i, mirror(p.toArray()));
    }
    put(side+'Toe_End', mirror([fit.leg[3]![0],fit.leg[3]![1],fit.leg[3]![2]+.04]));
  }
  put('HeadTop_End', [fit.core[5]![0],.98,fit.core[5]![2]]);
  const depth = (n: Node): number => n.getParentNode() ? depth(n.getParentNode()!)+1 : 0;
  for (const [node, matrix] of [...desired].sort(([a],[b]) => depth(a)-depth(b))) {
    const parent = node.getParentNode(); node.setMatrix((parent ? new Matrix4().fromArray(parent.getWorldMatrix()).invert().multiply(matrix) : matrix).toArray());
  }
  const inverse = skin.getInverseBindMatrices()!;
  joints.forEach((node, i) => inverse.setElement(i, new Matrix4().fromArray(node.getWorldMatrix()).invert().multiply(meshMatrix).toArray()));
  return { fittedPivots: Object.fromEntries([...desired].map(([n,m]) => [n.getName(),new Vector3().setFromMatrixPosition(m).toArray()])), method: 'Measured anatomical pivots, source mesh and UVs preserved, matching inverse bind reconstruction' };
}

function rotateMesh(doc: Document, radians: number) {
  const seen = new Set<unknown>(), matrix = new Matrix4().makeRotationY(radians);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) for (const semantic of ['POSITION','NORMAL','TANGENT']) {
    const a=p.getAttribute(semantic); if (!a || seen.has(a)) continue; seen.add(a);
    for(let i=0;i<a.getCount();i++){const e=a.getElement(i,[]),v=new Vector3().fromArray(e).applyMatrix4(matrix);a.setElement(i,semantic==='TANGENT'?[...v.toArray(),e[3]!]:v.toArray());}
  }
}

/** Keep unrelated limbs out of a vertex's four skin influences. */
function repairSegmentWeights(doc: Document) {
  const skin=doc.getRoot().listSkins()[0]!, joints=skin.listJoints();
  const named=new Map(joints.map((n,i)=>[n.getName().replace(P,''),{node:n,index:i}]));
  const at=(n:string)=>worldPosition(named.get(n)!.node);
  const h=deformedBounds(doc).max[1]! - deformedBounds(doc).min[1]!;
  const terminal:Record<string,string>={...children,Head:'HeadTop_End'};
  for(const s of ['Left','Right']) {terminal[s+'Hand']=s+'HandMiddle1';terminal[s+'ToeBase']=s+'Toe_End';}
  const allNodes=new Map(doc.getRoot().listNodes().map(n=>[n.getName().replace(P,''),n]));
  const capsules=Object.entries(terminal).filter(([n,c])=>named.has(n)&&allNodes.has(c)).map(([name,child])=>{const a=at(name),b=worldPosition(allNodes.get(child)!);if(name==='Head'&&a.distanceTo(b)<h*1e-5)b.add(new Vector3(0,h*.12,0));return {name,index:named.get(name)!.index,a,b};}).filter(c=>c.a.distanceTo(c.b)>h*1e-5);
  const arm=(name:string)=>/(Shoulder|Arm|ForeArm|Hand)$/.test(name);
  const leg=(name:string)=>/(UpLeg|Leg|Foot|ToeBase)$/.test(name);
  const groups=(side:string)=>({arm:capsules.filter(c=>c.name.startsWith(side)&&arm(c.name)),leg:capsules.filter(c=>c.name==='Hips'||c.name.startsWith(side)&&leg(c.name)),torso:capsules.filter(c=>!arm(c.name)&&!leg(c.name))});
  const stats:Record<string,number>={};
  for(const meshNode of doc.getRoot().listNodes().filter(n=>n.getSkin()===skin&&n.getMesh())) {
    const world=new Matrix4().fromArray(meshNode.getWorldMatrix());
    for(const p of meshNode.getMesh()!.listPrimitives()) {
      const position=p.getAttribute('POSITION')!,ix=new Uint16Array(position.getCount()*4),ws=new Float32Array(position.getCount()*4);
      for(let v=0;v<position.getCount();v++){
        const point=new Vector3().fromArray(position.getElement(v,[])).applyMatrix4(world),side=point.x>=at('Hips').x?'Left':'Right',g=groups(side);
        const distance=(c:typeof capsules[number])=>{const d=c.b.clone().sub(c.a),t=Math.max(0,Math.min(1,point.clone().sub(c.a).dot(d)/d.lengthSq()));return point.distanceTo(c.a.clone().addScaledVector(d,t));};
        const nearest=(cs:typeof capsules)=>cs.map(c=>({...c,d:distance(c)})).sort((a,b)=>a.d-b.d);
        const arms=nearest(g.arm),legs=nearest(g.leg),torso=nearest(g.torso);
        const hand=at(side+'Hand'),shoulder=at(side+'Arm'),hip=at(side+'UpLeg');
        const limbSide=Math.abs(point.x-at('Hips').x), boundary=Math.abs(hip.x-at('Hips').x)*.55+Math.abs(hand.x-at('Hips').x)*.45;
        const fingerFloor=Math.min(hand.y,...[...allNodes].filter(([name])=>name.startsWith(side+'Hand')).map(([,n])=>worldPosition(n).y))-h*.06;
        const belowHand=point.y<fingerFloor;
        const isArm=!belowHand && point.y<shoulder.y+h*.06 && limbSide>boundary && arms[0]!.d<Math.min(legs[0]!.d,torso[0]!.d)+h*.04;
        const candidates=isArm?arms:point.y<hip.y+h*.045?legs:torso;
        // Limit the initial weights to one anatomical chain. Mesh-neighbour smoothing
        // then blends the shoulder and pelvis junctions without reaching a nearby limb.
        const dominant=candidates[0]!;
        const selected=candidates.slice(0,4);
        const sigma=h*.028,minimum=selected[0]!.d;
        const weights=selected.map(c=>Math.exp(-(c.d*c.d-minimum*minimum)/(sigma*sigma))),sum=weights.reduce((a,b)=>a+b,0);
        selected.forEach((c,i)=>{ix[v*4+i]=c.index;ws[v*4+i]=weights[i]!/sum;});
        stats[dominant.name]=(stats[dominant.name]||0)+1;
      }
      const neighbors=Array.from({length:position.getCount()},()=>new Set<number>()),tri=p.getIndices()!.getArray()!;
      for(let i=0;i<tri.length;i+=3)for(let j=0;j<3;j++){const a=Number(tri[i+j]),b=Number(tri[i+(j+1)%3]);neighbors[a]!.add(b);neighbors[b]!.add(a);}
      // Weld coincident UV seam vertices for continuous weights without touching geometry.
      const seam=new Map<string,number[]>();
      for(let v=0;v<position.getCount();v++){const key=position.getElement(v,[]).map(x=>Math.round(x*1e5)).join(',');const list=seam.get(key)??[];list.push(v);seam.set(key,list);}
      for(const group of seam.values())for(const a of group)for(const b of group)if(a!==b)neighbors[a]!.add(b);
      let dense=new Float64Array(position.getCount()*joints.length);
      for(let v=0;v<position.getCount();v++)for(let j=0;j<4;j++)dense[v*joints.length+ix[v*4+j]!]!+=ws[v*4+j]!;
      for(let pass=0;pass<24;pass++){
        const next=dense.slice();
        for(let v=0;v<position.getCount();v++)if(neighbors[v]!.size){
          for(let j=0;j<joints.length;j++){let sum=0;for(const n of neighbors[v]!)sum+=dense[n*joints.length+j]!;next[v*joints.length+j]=dense[v*joints.length+j]!*.45+sum/neighbors[v]!.size*.55;}
        }
        dense=next;
      }
      for(let v=0;v<position.getCount();v++){
        const chosen=Array.from({length:joints.length},(_,i)=>({i,w:dense[v*joints.length+i]!})).sort((a,b)=>b.w-a.w).slice(0,4),sum=chosen.reduce((a,b)=>a+b.w,0);
        chosen.forEach(({i,w},j)=>{ix[v*4+j]=i;ws[v*4+j]=w/sum;});
      }
      const buffer=doc.getRoot().listBuffers()[0]!;
      p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(ix).setBuffer(buffer));
      p.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(ws).setBuffer(buffer));
    }
  }
  return {method:'Anatomical arm/leg/torso ownership with mesh-topology smoothing',dominantVertices:stats};
}

export const profile:CreatureRepairProfile={
  id:'humanoids-colon',
  assetIds:['creature_boss_cinderwake','creature_boss_rootheart','creature_boss_tideworn','creature_briar_harrow','creature_cinder_penitent',...starroots.slice(0,2),'creature_stone_golem','creature_vault_custodian',...starroots.slice(2,4),'fairy_garden_sapling_gloamgarden','fairy_guardian_06_faeholme','fantasy_monster_03'],
  async repair(doc,{assetId,readAsset}){
    const changes:string[]=[],provenance:Record<string,unknown>={};
    if(['creature_briar_harrow','creature_boss_rootheart','fairy_garden_sapling_gloamgarden'].includes(assetId)) {
      const measurements=measureMixamoColonMotion(doc,await readAsset('animation_library_1'));
      return {changes:['Measured existing native gait contact speeds without changing motion.'],provenance:{reason:'Native anatomical skin and studio motion retained after every-state devdocs audit.',measurements},
        motion:{impliedWalkMps:measurements.walk.metresPerSecond,impliedRunMps:measurements.run.metresPerSecond,contactNormalized:measurements.contactNormalized}};
    }
    if(assetId==='creature_boss_cinderwake'){rotateMesh(doc,Math.PI/2);changes.push('Corrected proven 90-degree mesh-to-skeleton basis mismatch.');}
    if(assetId==='fairy_guardian_06_faeholme'){
      const scene=doc.getRoot().getDefaultScene()!,wrapper=doc.createNode('corealm_verified_facing').setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-Math.PI/2).toArray());
      for(const n of [...scene.listChildren()]){scene.removeChild(n);wrapper.addChild(n);}scene.addChild(wrapper);changes.push('Normalized complete rig and mesh from +X to +Z facing.');
      provenance.previousMotion='Rejected low-channel procedural stand-in clips; native segmented skin retained for studio retarget.';
    }
    const fit=assetId==='creature_cinder_penitent'?'votary':assetId==='creature_vault_custodian'?'custodian':starroots.includes(assetId)?'starroot':undefined;
    if(fit){provenance.anatomy=fitAnatomy(doc,landmarks[fit]!);changes.push('Replaced invalid bounding-box T rig with down-arm anatomical pivots and inverse binds.');}
    // The coherent 65-joint guardian already has a native segmented skin. Preserve it.
    if(!['fairy_guardian_06_faeholme','fairy_garden_sapling_gloamgarden','creature_briar_harrow','creature_boss_rootheart'].includes(assetId)){provenance.weights=repairSegmentWeights(doc);changes.push('Removed cross-limb skin influences and fitted weights to adjacent anatomical segments.');}
    const bounds = deformedBounds(doc);
    const crownedDeath = assetId === 'fairy_guardian_06_faeholme' || starroots.includes(assetId);
    const deathGroundingMaxSpeedMps = crownedDeath ? .65 * (bounds.max[1]! - bounds.min[1]!) : undefined;
    const donor = await readAsset('animation_library_1');
    if (crownedDeath) {
      provenance.crownDeath = adaptCrownedDeath(donor);
      changes.push('Adapted studio head impact to the rigid crown while preserving the body fall and endpoint poses.');
    }
    const retarget = retargetMixamoColon(doc, donor, deathGroundingMaxSpeedMps);
    provenance.retarget=retarget;
    changes.push('Baked studio Idle, Walk, Run, Attack, Hit and Death with complete poses and world-scaled root motion.');
    return {changes,provenance,warnings:['Requires every-state production devdocs visual review before promotion.'],motion:{impliedWalkMps:retarget.measurements.walk.metresPerSecond,impliedRunMps:retarget.measurements.run.metresPerSecond,contactNormalized:retarget.measurements.contactNormalized,walkClipSeconds:1.3333333730697632,runClipSeconds:.9333333373069763,attackSeconds:.8666666746139526,groundY:0}};
  },
};

