import * as THREE from 'three';
import { buildSourceDemon } from './demon.mjs';
import { buildSourceGargoyle } from './gargoyle.mjs';

function horn(parent,name,points,radii,material){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'catmullrom',.25),rings=40,sides=14;
  const frames=curve.computeFrenetFrames(rings-1,false),positions=[],uv=[],indices=[];
  for(let i=0;i<rings;i++){
    const t=i/(rings-1),p=curve.getPointAt(t),ri=t*(radii.length-1),j=Math.min(radii.length-2,Math.floor(ri));
    const r=THREE.MathUtils.lerp(radii[j],radii[j+1],ri-j)*(1+.035*Math.sin(t*57));
    for(let k=0;k<sides;k++){
      const a=k/sides*Math.PI*2,q=p.clone().addScaledVector(frames.normals[i],Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r);
      positions.push(...q.toArray());uv.push(k/sides,t);
      if(i<rings-1){const a=i*sides+k,b=i*sides+(k+1)%sides;indices.push(a,b,a+sides,b,b+sides,a+sides);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,material);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function attach(object,boneName,name,at){
  const bone=object.getObjectByName(boneName);if(!bone)throw new Error(`Variant requires ${boneName}`);
  const group=new THREE.Group();group.name=name;group.position.fromArray(at);object.add(group);object.updateMatrixWorld(true);bone.attach(group);return group;
}
function headScale(object,clips,factor){
  const head=object.getObjectByName('headx');head.scale.multiplyScalar(factor);
  for(const clip of clips){const track=clip.tracks.find(t=>t.name==='headx.scale');if(!track)throw new Error('Source head scale track absent');for(let i=0;i<track.values.length;i++)track.values[i]*=factor;}
}
function animateAppendage(group,clips,side=1){
  const base=group.quaternion.clone();
  for(const clip of clips){
    const times=[],values=[];
    for(let i=0;i<=40;i++){
      const t=i/40,angle=clip.name==='Death'?.55*t:clip.name==='Attack'?.16*Math.sin(t*Math.PI):.06*Math.sin(t*Math.PI*2);
      const q=base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),side*angle));times.push(t*clip.duration);values.push(...q.toArray());
    }
    clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${group.name}.quaternion`,times,values));
  }
}
function describe(result,id,changes){
  const {object}=result;object.name=id;object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true),size=box.getSize(new THREE.Vector3());
  result.meta={...result.meta,id,height:size.y,width:size.x,depth:size.z,dimensions:size.toArray(),bounds:{min:box.min.toArray(),max:box.max.toArray()},
    provenance:{...result.meta.provenance,variantModifications:changes},variantGeometry:changes,
    distinctSilhouette:true,acceptance:'variant candidate; visual and animation acceptance pending',revision:`${id}-source-variant-1`};
  return result;
}
function sealImpHeadContact(result){
  // The juvenile head is larger relative to the body. Lift the corpse by its
  // measured contact difference instead of allowing that new anatomy to sink.
  const {object,clips}=result,clip=clips.find(c=>c.name==='Death'),mixer=new THREE.AnimationMixer(object);
  const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const times=[],values=[];let maximumLift=0;
  for(let i=0;i<=240;i++){
    const t=i/240*clip.duration;mixer.setTime(t);object.updateMatrixWorld(true);
    const floor=new THREE.Box3().setFromObject(object,true).min.y,lift=Math.max(0,.002-floor);
    maximumLift=Math.max(maximumLift,lift);times.push(t);values.push(0,lift,0);
  }
  action.stop();mixer.uncacheRoot(object);clip.tracks.push(new THREE.VectorKeyframeTrack('imp.position',times,values));
  result.meta.juvenileHeadDeathContact={samples:241,maximumLift,clearance:.002};
}

export function buildMythicVariant(id){
  if(!['imp','abyssal_demon','obsidian_gargoyle','ancient_gargoyle'].includes(id))throw new Error(`Unknown source mythic variant ${id}`);
  const gargoyle=id.endsWith('gargoyle'),result=gargoyle?buildSourceGargoyle():buildSourceDemon(),{object,clips}=result;
  const hornMaterial=new THREE.MeshStandardMaterial({name:`animal_rpg_${id}_horn`,color:gargoyle?0x656658:0x44342f,roughness:gargoyle?.94:.80,metalness:0});
  if(id==='imp'){
    // Juvenile cranial proportion and a balancing curled tail are actual anatomy
    // changes; the accepted weighted hands/feet remain source geometry.
    headScale(object,clips,1.10);
    // The source pelvis is driven by rootx. Embed the tail root inside its
    // posterior volume so torso twist cannot pull the join off the hip skin.
    const tail=attach(object,'rootx','ImpTail',[0,1.23,-.04]);
    horn(tail,'ImpWhipTail',[[0,0,0],[.13,-.11,-.24],[.35,-.17,-.48],[.53,-.05,-.58],[.53,.16,-.44],[.43,.18,-.34]],[.065,.050,.036,.025,.017,.002],hornMaterial);
    animateAppendage(tail,clips);
    // The small swept brow horns grow from the existing source crest roots.
    for(const side of [-1,1]){
      const ears=attach(object,'headx',`ImpSweptHorn${side}`,[side*.22,2.16,.19]);
      horn(ears,`ImpHorn${side}`,[[0,0,0],[side*.07,.08,-.07],[side*.13,.06,-.20]],[.047,.030,.001],hornMaterial);
    }
    object.scale.setScalar(.66);
    sealImpHeadContact(result);
    return describe(result,id,'Juvenile head-to-body ratio 1.10, small swept rooted cranial horns, articulated curled balancing tail, .66 body scale. Original source atlas and weighted body/clips retained.');
  }
  if(id==='abyssal_demon'){
    // Adult crown and paired dorsal horn roots sit behind the original shoulder
    // masses, leaving the source face and claw animation unobstructed.
    for(const side of [-1,1]){
      const crown=attach(object,'headx',`AbyssalCrown${side}`,[side*.20,2.16,.18]);
      horn(crown,`AbyssalCrownHorn${side}`,[[0,0,0],[side*.13,.16,-.08],[side*.17,.37,-.16],[side*.07,.52,-.08]],[.074,.059,.035,.002],hornMaterial);
      // Keep the exposed tips, but seat each root inside the dorsal torso.
      // The former outward-spaced roots followed the spine while floating
      // beyond the arm skin as the shoulders rotated during source clips.
      const mantle=attach(object,'spine_03x',`AbyssalDorsalMantle${side}`,[.065,1.72,.05]);
      for(let j=0;j<3;j++)horn(mantle,`AbyssalMantleHorn${side}_${j}`,[[side*j*.02,-j*.035,0],[side*(.34+j*.065)-.065,.10-j*.04,-.22],[side*(.41+j*.08)-.065,.21-j*.045,-.35]],[.061-j*.008,.038-j*.005,.002],hornMaterial);
    }
    const tail=attach(object,'rootx','AbyssalTail',[0,1.23,-.04]);
    horn(tail,'AbyssalArmoredTail',[[0,0,0],[-.17,-.09,-.24],[-.38,-.04,-.48],[-.49,.13,-.54],[-.43,.29,-.45]],[.095,.071,.048,.029,.002],hornMaterial);animateAppendage(tail,clips,-1);
    object.scale.set(1.12,1.13,1.08);
    return describe(result,id,'Tall hooked crown grown from source cranial crests, paired three-spine dorsal mantles rooted behind shoulders, articulated armored curled tail, broad adult body proportions. Source anatomy, UV atlas and full clips retained.');
  }
  const ancient=id==='ancient_gargoyle';
  // Change the membrane silhouette in its own authored coordinates while
  // leaving its mount and accepted fold track in place.
  for(const name of ['GargoyleWingL','GargoyleWingR']){
    const wing=object.getObjectByName(name);wing.traverse(n=>{
      if(!n.isMesh)return;const pos=n.geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
        pos.setXYZ(i,x*(ancient?1.23:.81),y*(ancient?.92:1.12),z-(ancient?0:.075)*Math.abs(x));
      }
      pos.needsUpdate=true;n.geometry.computeVertexNormals();n.geometry.computeBoundingBox();n.geometry.computeBoundingSphere();
    });
  }
  object.traverse(n=>{if(n.isMesh){n.material=n.material.clone();n.material.color.set(ancient?0xc6c2a4:0x747985);n.material.roughness=ancient?.98:.66;}});
  for(const side of [-1,1]){
    const crest=attach(object,'headx',`StoneCrest${side}`,[side*.20,2.16,.18]);
    horn(crest,`StoneScrollHorn${side}`,ancient
      ? [[0,0,0],[side*.13,.13,-.07],[side*.15,.26,-.18],[side*.04,.33,-.23]]
      : [[0,0,0],[side*.055,.19,-.09],[side*.01,.34,-.18]],ancient?[.072,.059,.037,.002]:[.057,.030,.002],hornMaterial);
  }
  if(ancient){
    // Tall paired spine buttresses evoke an old carved guardian; rooted into
    // the source scapulae instead of adding a flat decorative chest badge.
    for(const side of [-1,1]){
      const back=attach(object,'spine_03x',`AncientScapularButtress${side}`,[side*.19,1.68,-.15]);
      horn(back,`AncientBackRidge${side}`,[[0,-.23,0],[side*.035,.02,-.035],[side*.07,.25,-.07],[side*.035,.40,-.015]],[.038,.071,.044,.002],hornMaterial);
    }
  }
  object.scale.setScalar(ancient?1.08:1.0);
  return describe(result,id,ancient
    ? 'Broad 1.23-span swept membranes, curved stone scroll horns, paired carved scapular buttresses, weathered limestone source-texture response; full original weighted body and graft fold retained.'
    : 'Narrow high bat membranes .81-span with rear sweep, tall paired obsidian cranial spires, dark weathered source-texture response; original weighted body and graft fold retained.');
}
