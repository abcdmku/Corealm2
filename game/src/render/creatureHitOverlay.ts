import * as THREE from "three";

export interface MaskedHitOverlayResult {
  clip: THREE.AnimationClip | null;
  status: "native-masked" | "safe-fallback" | "no-safe-mask";
  sourceClip: string;
  boneNames: string[];
  excludedBoneNames: string[];
  protectedBoneNames: string[];
}
export interface MaskedHitDelta { boneName: string; quaternion: THREE.Quaternion }

const supportName = /leg|thigh|shin|knee|foot|heel|ankle|hoof|paw|toe|coxa|femur|tibia|tarsus/i;
const headName = /neck|head|jaw|mouth/i;
const upperName = /spine|chest|ribs|shoulder|arm|hand|finger|thumb|palm/i;
const beetleSupport = /^beetle_2[2-9]_Bone/;
const beetleHead = /^beetle_[345]_Bone/;
const beetleUpper = /^beetle_(?:[2-9]|1\d|2[01])_Bone/;
function hasArmAncestor(bone:THREE.Object3D):boolean {
  for(let node=bone.parent;node;node=node.parent)if(/hand|forearm|upper_arm|(?:^|_)arm(?:_|$)/i.test(node.name))return true;
  return false;
}

/** Numbered imported rigs are recognized by their branch topology, never Bone### alone. */
function explicitExpressiveBranches(bones:THREE.Bone[]):Set<THREE.Bone>|null {
  const named=(name:string)=>bones.find(b=>b.name===name);
  const edge=(child:string,parent:string)=>named(child)?.parent===named(parent) && !!named(parent);
  let roots:THREE.Bone[]=[];
  if(named('Viper_MAINSHJnt') && named('Viper_Front_01_01SHJnt')) roots=bones.filter(b=>b.name==='Viper_Neck_01SHJnt');
  else if(named('Scorpion_MAINSHJnt') && named('Scorpion_l_FrontLeg_HipSHJnt')) roots=bones.filter(b=>/^Scorpion_[lr]_Pedipalp_01_01SHJnt$/.test(b.name));
  else if(named('hollowroot_spider_leg_L_1_coxa')) roots=bones.filter(b=>/^hollowroot_spider_(?:chelicera_|pedipalp_(?:-?1)$)/.test(b.name));
  else if(named('Snail_EyeLeft') && edge('Bone009','Bone008') && edge('Bone006','Bone005')) roots=bones.filter(b=>/^Snail_Eye(?:Left|Right)$/.test(b.name));
  else if(named('Goose_WingLeft') && edge('Bone020','Bone019') && edge('Bone024','Bone023')) roots=bones.filter(b=>['Bone006','Goose_WingLeft','Goose_WingRight'].includes(b.name));
  else if(edge('Bone022','Bone021') && edge('Bone031','Bone030') && edge('Bone020','Bone002') && edge('Bone008','Bone003')) roots=bones.filter(b=>['Bone004','Bone008'].includes(b.name));
  else if(edge('Bone004','Bone003') && edge('Bone008','Bone003') && edge('Bone015','Bone014') && named('Bone009(mirrored)(mirrored)')) roots=bones.filter(b=>b.name==='Bone003');
  else if(edge('Bone013','Bone012') && edge('Bone023','Bone022') && edge('Bone029','Bone028') && named('Bone022(mirrored)')) roots=bones.filter(b=>b.name==='Bone012');
  else if(edge('Bone007','Bone006') && edge('Bone026','Bone025') && edge('Bone031','Bone030') && named('Bone030(mirrored)')) roots=bones.filter(b=>b.name==='Bone006');
  else if(named('CATRigLLegAnkle') && named('CATRigLArmPalm')) roots=bones.filter(b=>/^CATRigHub003(?:_\d+)?$/.test(b.name));
  else return null;
  const selected=new Set<THREE.Bone>();
  for(const root of roots)root.traverse(node=>{if((node as THREE.Bone).isBone)selected.add(node as THREE.Bone);});
  return selected;
}

/** Resolve names, UUID tracks and skeleton.bones[name] bindings without guessing an unmatched node. */
function trackBone(root: THREE.Object3D, track: THREE.KeyframeTrack): THREE.Bone | null {
  try {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    if (parsed.propertyName !== "quaternion" || track.getValueSize() !== 4) return null;
    let node = THREE.PropertyBinding.findNode(root, parsed.nodeName) as THREE.Object3D | null;
    if (parsed.objectName === "bones") {
      const skeleton = (node as THREE.SkinnedMesh | null)?.skeleton;
      const index = parsed.objectIndex;
      node = skeleton?.getBoneByName(String(index))
        ?? (skeleton && /^\d+$/.test(String(index)) ? skeleton.bones[Number(index)] : null)
        ?? root.getObjectByName(String(index)) ?? null;
    }
    return (node as THREE.Bone | null)?.isBone ? node as THREE.Bone : null;
  } catch { return null; }
}

function quaternionAt(track: THREE.KeyframeTrack, seconds: number): THREE.Quaternion {
  // Track-provided interpolation retains STEP / glTF quaternion interpolation semantics.
  const interpolant = (track as THREE.KeyframeTrack & { createInterpolant(): THREE.Interpolant }).createInterpolant();
  return new THREE.Quaternion().fromArray(interpolant.evaluate(seconds)).normalize();
}

/**
 * Build once per rig/native hit. The resulting additive clip contains rotations only.
 * Its delta is inverse(Idle@0) * Hit(t), with Hit@0 as reference if Idle omits that bone.
 * All support branches and every ancestor are excluded. Forest hand digits named Toe are treated
 * as hand digits; Beetle's measured lower chains are bones 22–29, with upper chains 2–21.
 * Unknown rigs without identifiable support receive no mask.
 * Use hitOverlayWeight for mixer weight, or applyMaskedHitOverlay after evaluating the base pose.
 */
export function createMaskedHitOverlay(
  root: THREE.Object3D, nativeHit: THREE.AnimationClip, referenceIdle: THREE.AnimationClip,
): MaskedHitOverlayResult {
  const bones: THREE.Bone[] = [];
  root.traverse(node => { if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone); });
  const explicit=explicitExpressiveBranches(bones);
  const blocked = new Set<THREE.Object3D>([root]);
  const supports = bones.filter(bone => (supportName.test(bone.name)
    && !(/toe/i.test(bone.name) && hasArmAncestor(bone))) || beetleSupport.test(bone.name));
  for (const support of supports) {
    support.traverse(node => blocked.add(node));
    for (let node: THREE.Object3D | null = support; node; node = node.parent) blocked.add(node);
  }
  for(const bone of bones)if((/root|main|hips|pelvis/i.test(bone.name) && !/tree/i.test(bone.name)) || bone.name==='beetle_1_Bone')blocked.add(bone);
  const knownUpright = bones.some(bone => /^(lava_src_|earth_|forest_src_)/.test(bone.name));
  const safe = new Set(bones.filter(bone => !blocked.has(bone)
    && !/IK|target/i.test(bone.name)
    && (headName.test(bone.name) || beetleUpper.test(bone.name) || (knownUpright && (upperName.test(bone.name) || hasArmAncestor(bone))))));
  if(explicit) {
    safe.clear();blocked.clear();blocked.add(root);
    for(const bone of bones)if(explicit.has(bone))safe.add(bone);else blocked.add(bone);
  }
  const result: MaskedHitOverlayResult = { clip:null, status:"no-safe-mask", sourceClip:nativeHit.name,
    boneNames:[], excludedBoneNames:bones.filter(bone=>!safe.has(bone)).map(bone=>bone.name),protectedBoneNames:bones.filter(bone=>blocked.has(bone)).map(bone=>bone.name) };
  if ((!supports.length && !explicit) || !safe.size || !(nativeHit.duration > 0) || !Number.isFinite(nativeHit.duration)) return result;
  const reference = new Map<THREE.Bone, THREE.KeyframeTrack>();
  for (const track of referenceIdle.tracks) { const bone=trackBone(root,track);if(bone)reference.set(bone,track); }
  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  const identity = new THREE.Quaternion();
  for (const source of nativeHit.tracks) {
    const bone = trackBone(root,source);
    if (!bone || !safe.has(bone) || tracks.some(track=>track.name===`${bone.name}.quaternion`)) continue;
    const base=quaternionAt(reference.get(bone) ?? source,0).invert();
    const values:number[] = [];
    let magnitude=0;
    for(const time of source.times) {
      const delta=base.clone().multiply(quaternionAt(source,time)).normalize();
      magnitude=Math.max(magnitude,identity.angleTo(delta));values.push(delta.x,delta.y,delta.z,delta.w);
    }
    if(values.some(value=>!Number.isFinite(value)) || magnitude<1e-5)continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,Array.from(source.times),values,source.getInterpolation()));
  }
  if(tracks.length)result.status="native-masked";
  else {
    const head=[...safe].find(bone=>headName.test(bone.name) || beetleHead.test(bone.name)) ?? (explicit ? [...safe][0] : undefined);
    if(!head)return result;
    const times=[0,.18,.42,.72,1].map(phase=>phase*nativeHit.duration), values:number[]=[];
    for(const angle of [0,-.14,.075,-.025,0]) {
      const delta=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle);
      values.push(delta.x,delta.y,delta.z,delta.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${head.name}.quaternion`,times,values));
    result.status="safe-fallback";
  }
  result.clip=new THREE.AnimationClip(`${nativeHit.name}_MaskedOverlay`,nativeHit.duration,tracks,THREE.AdditiveAnimationBlendMode);
  result.boneNames=tracks.map(track=>trackBone(root,track)!.name);
  return result;
}

/** Smooth weight, exactly zero outside the action and at both endpoints. */
export function hitOverlayWeight(time: number, duration: number, strength=1): number {
  if(!Number.isFinite(time) || !Number.isFinite(duration) || !Number.isFinite(strength) || duration<=0 || time<=0 || time>=duration)return 0;
  const phase=time/duration, smooth=(x:number)=>{const t=THREE.MathUtils.clamp(x,0,1);return t*t*(3-2*t);};
  return THREE.MathUtils.clamp(strength,0,1)*smooth(phase/.18)*smooth((1-phase)/.28);
}

/** CPU equivalent of an additive mixer action. This returns deltas, never absolute bone poses. */
export function evaluateMaskedHitOverlay(overlay: MaskedHitOverlayResult, time: number, strength=1): MaskedHitDelta[] {
  if(!overlay.clip)return [];
  const weight=hitOverlayWeight(time,overlay.clip.duration,strength);
  return overlay.clip.tracks.map((track,index)=>({boneName:overlay.boneNames[index]!,
    quaternion:new THREE.Quaternion().slerp(quaternionAt(track,THREE.MathUtils.clamp(time,0,overlay.clip!.duration)),weight)}));
}

/** Apply once after the base pose is freshly evaluated; calling twice would accumulate the delta. */
export function applyMaskedHitOverlay(root: THREE.Object3D, overlay: MaskedHitOverlayResult, time: number, strength=1): void {
  for(const delta of evaluateMaskedHitOverlay(overlay,time,strength)) {
    const bone=root.getObjectByName(delta.boneName);
    if((bone as THREE.Bone | undefined)?.isBone)bone!.quaternion.multiply(delta.quaternion).normalize();
  }
}
