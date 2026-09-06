import * as THREE from 'three';

const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const mat=(name,color,metalness=0,emissive=0)=>new THREE.MeshStandardMaterial({name,color,metalness,roughness:metalness?.55:.87,emissive,emissiveIntensity:.55,side:THREE.DoubleSide});
const materials={wood:mat('Variant_oiled_yew',0x695037),wrap:mat('Variant_worn_leather',0x473d31),trim:mat('Variant_aged_brass',0x9d8a59,.65),string:mat('Variant_bowstring',0xb9b29c),iron:mat('Variant_arrowhead',0x74767b,.7),cloth:mat('Variant_indigo_wool',0x343747),edge:mat('Variant_cloth_seams',0x6a6576),crystal:mat('Variant_amethyst',0x8776bd,.15,0x4f3b7f)};
function mesh(parent,geometry,material,name){const node=new THREE.Mesh(geometry,material.clone());node.name=name;node.castShadow=true;node.receiveShadow=true;parent.add(node);return node;}
function rod(parent,a,b,r,material,name,endRadius=r){const delta=b.clone().sub(a),node=mesh(parent,new THREE.CylinderGeometry(endRadius,r,delta.length(),7),material,name);node.position.copy(a).add(b).multiplyScalar(.5);node.quaternion.setFromUnitVectors(v(0,1,0),delta.normalize());return node;}
function tube(parent,points,r,material,name){return mesh(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,r,6,false),material,name);}
function surface(parent,positions,indices,material,name){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return mesh(parent,g,material,name);}
function group(parent,name){const node=new THREE.Group();node.name=name;parent.add(node);return node;}
function attachWorld(source,boneName,name,offset=v()) {
  const bone=source.getObjectByName(boneName),node=group(bone,name),world=bone.getWorldPosition(v()).add(offset);
  node.position.copy(bone.worldToLocal(world));node.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
  node.scale.copy(bone.getWorldScale(v()).set(1/.018,1/.018,1/.018));source.updateMatrixWorld(true);return node;
}
function removeReplacedEquipment(source,role) {
  // Source equipment is disconnected geometry. Identify whole components, never trim
  // triangles by an arbitrary spatial plane through the body or through a garment.
  source.updateMatrixWorld(true);let removed=0;
  source.traverse(node=>{
    if(!node.isSkinnedMesh)return;
    const geometry=node.geometry,p=geometry.attributes.position,index=geometry.index,keep=[];
    for(const range of geometry.groups) {
      const rows=[];for(let i=range.start;i<range.start+range.count;i+=3)rows.push([0,1,2].map(j=>index?index.getX(i+j):i+j));
      if(range.materialIndex===0){keep.push(...rows.flat());continue;}
      const parent=rows.map((_,i)=>i),byVertex=new Map();
      const find=i=>{while(parent[i]!==i)i=parent[i];return i;};
      rows.forEach((row,i)=>row.forEach(vertex=>{const key=[p.getX(vertex),p.getY(vertex),p.getZ(vertex)].map(value=>Math.round(value*1e4)).join(',');if(byVertex.has(key))parent[find(i)]=find(byVertex.get(key));else byVertex.set(key,i);}));
      const components=new Map();rows.forEach((row,i)=>{const key=find(i),vertices=components.get(key)||[];vertices.push(...row);components.set(key,vertices);});
      for(const vertices of components.values()) {
        const box=new THREE.Box3();for(const vertex of vertices)box.expandByPoint(node.getVertexPosition(vertex,v()).applyMatrix4(node.matrixWorld));
        const replace=box.max.y<1.0||(role==='mage'&&box.min.y>1.5);
        if(replace)removed+=vertices.length/3;else keep.push(...vertices);
      }
    }
    // Retain exact attributes for retained vertices, removing unused weapon vertices
    // as well so CPU bounds cannot include an invisible discarded sword.
    const bodyCount=geometry.groups.find(range=>range.materialIndex===0).count;
    const remap=new Map(),ordered=[];for(const vertex of keep)if(!remap.has(vertex)){remap.set(vertex,ordered.length);ordered.push(vertex);}
    for(const [name,attribute] of Object.entries(geometry.attributes)){
      const values=new attribute.array.constructor(ordered.length*attribute.itemSize);
      ordered.forEach((vertex,i)=>{for(let k=0;k<attribute.itemSize;k++)values[i*attribute.itemSize+k]=attribute.array[vertex*attribute.itemSize+k];});
      geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized));
    }
    geometry.setIndex(keep.map(vertex=>remap.get(vertex)));geometry.clearGroups();geometry.addGroup(0,bodyCount,0);if(keep.length>bodyCount)geometry.addGroup(bodyCount,keep.length-bodyCount,1);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
  });return removed;
}
function addBow(source) {
  const holder=attachWorld(source,'Bip001_L_Hand','ArcherBow',v(0,-.075,.03));
  // The stave curves back at the tips; limb taper and wrapped grip read from the side.
  const points=[v(0,-.52,-.08),v(0,-.42,.025),v(0,-.23,.075),v(0,-.065,0),v(0,.065,0),v(0,.23,.075),v(0,.42,.025),v(0,.52,-.08)];
  tube(holder,points,.019,materials.wood,'BowStave');
  for(const sign of [-1,1]){rod(holder,v(0,sign*.41,.03),v(0,sign*.515,-.075),.013,materials.trim,'BowHornTip'+sign,.007);}
  rod(holder,v(0,-.065,0),v(0,.065,0),.026,materials.wrap,'BowGrip');
  for(let i=0;i<6;i++){const band=mesh(holder,new THREE.TorusGeometry(.026,.003,4,9),materials.trim,'GripBinding'+i);band.position.y=-.05+i*.02;band.rotation.x=Math.PI/2;}
  const strings=[-1,1].map(sign=>mesh(holder,new THREE.CylinderGeometry(.0022,.0022,1,5),materials.string,sign<0?'BowStringLower':'BowStringUpper'));
  strings.forEach((node,i)=>{node.position.set(0,i===0?-.26:.26,-.08);node.scale.y=.52;});
  const arrow=group(holder,'NockedArrow');
  const release=group(holder,'ArcherRelease');release.position.z=-.08;
  rod(arrow,v(0,0,0),v(0,0,.64),.004,materials.wood,'ArrowShaft');
  const tip=mesh(arrow,new THREE.ConeGeometry(.021,.075,4),materials.iron,'ArrowPoint');tip.rotation.x=Math.PI/2;tip.position.z=.677;
  for(let i=0;i<3;i++){const feather=surface(arrow,[0,0,.02,.024,0,.045,.024,0,.105,0,0,.13],[0,1,2,0,2,3],materials.string,'ArrowFletching'+i);feather.rotation.z=i*Math.PI*2/3;}
  arrow.scale.setScalar(0);
  const quiver=attachWorld(source,'Bip001_Spine1','ArcherQuiver',v(-.08,-.03,-.17));quiver.rotation.z+=.2;
  const tubeGeometry=new THREE.CylinderGeometry(.068,.05,.48,9,1,true),body=mesh(quiver,tubeGeometry,materials.wrap,'QuiverLeather');body.position.y=-.08;
  for(const y of [-.32,.16]){const ring=mesh(quiver,new THREE.TorusGeometry(y>0?.068:.05,.008,5,9),materials.trim,'QuiverRim'+y);ring.rotation.x=Math.PI/2;ring.position.y=y;}
  for(let i=0;i<5;i++){const x=(i-2)*.019,z=Math.sin(i*2)*.018;rod(quiver,v(x,-.15,z),v(x,.31+(i%2)*.035,z),.004,materials.wood,'QuiverArrow'+i);for(const s of [-1,1])surface(quiver,[x,.24,z,x+s*.024,.27,z,x+s*.024,.3,z,x,.31,z],[0,1,2,0,2,3],materials.string,'QuiverFeather'+i+s);}
  const harness=attachWorld(source,'Bip001_Spine1','ArcherHarness');
  surface(harness,[-.18,.17,.115,-.145,.18,.13,.14,-.23,.13,.105,-.24,.12],[0,1,2,0,2,3],materials.wrap,'DiagonalHarness');
  const buckle=mesh(harness,new THREE.TorusGeometry(.024,.005,4,4),materials.trim,'HarnessBuckle');buckle.position.set(.012,-.045,.135);buckle.rotation.z=.6;
  return {holder,strings,arrow,release};
}
function addMage(source) {
  const holder=attachWorld(source,'Bip001_R_Hand','MageStaff',v(0,-.075,.03));
  tube(holder,[v(.02,-.81,0),v(0,-.54,0),v(.018,-.14,0),v(0,.18,0),v(.025,.55,0),v(0,.73,0)],.018,materials.wood,'StaffShaft');
  for(const y of [-.05,.065,.55,.69])rod(holder,v(0,y-.015,0),v(0,y+.015,0),.025,materials.trim,'StaffFerrule'+y);
  for(const sign of [-1,1])tube(holder,[v(0,.59,0),v(sign*.08,.71,0),v(sign*.085,.83,0),v(sign*.042,.88,0)],.012,materials.trim,'StaffCrown'+sign);
  const crystal=group(holder,'StaffFocus');const gem=mesh(crystal,new THREE.OctahedronGeometry(.063),materials.crystal,'StaffGem');gem.scale.y=1.6;crystal.position.set(0,.78,0);
  const hood=attachWorld(source,'Bip001_Head','MageHood'),positions=[],indices=[],segments=14;
  const rings=[[-.065,.135,.105],[.055,.145,.12],[.15,.13,.11],[.23,.07,.065],[.27,.018,.025]];
  for(const [y,rx,rz] of rings)for(let i=0;i<=segments;i++){const a=.9+i/segments*(Math.PI*2-1.8);positions.push(Math.sin(a)*rx,y,Math.cos(a)*rz-.025);}
  for(let row=0;row<rings.length-1;row++)for(let i=0;i<segments;i++){const a=row*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}
  surface(hood,positions,indices,materials.cloth,'OpenHood');
  for(const i of [0,segments])tube(hood,rings.map(([y,rx,rz])=>{const a=i?Math.PI*2-.9:.9;return v(Math.sin(a)*rx,y,Math.cos(a)*rz-.025);}),.006,materials.edge,'HoodHem'+i);
  const mantle=attachWorld(source,'Bip001_Spine1','MageMantle');
  for(const sign of [-1,1])surface(mantle,[sign*.035,.26,-.1,sign*.21,.22,-.04,sign*.28,.06,-.055,sign*.18,-.08,-.14,sign*.09,-.42,-.19,sign*.025,-.4,-.18],[0,1,2,0,2,3,0,3,5,3,4,5],materials.cloth,'MantlePanel'+sign);
  tube(mantle,[v(-.18,.21,.08),v(-.07,.13,.12),v(.07,.13,.12),v(.18,.21,.08)],.007,materials.trim,'MantleChain');
  const seal=mesh(mantle,new THREE.CylinderGeometry(.03,.03,.012,6),materials.trim,'MantleSeal');seal.rotation.x=Math.PI/2;seal.position.set(0,.115,.13);
  attachWorld(source,'Bip001_L_Hand','MageCast',v(0,-.075,.03));
  return {holder,crystal};
}
function worldQ(node,q) {const parentQ=node.parent.getWorldQuaternion(new THREE.Quaternion());node.quaternion.copy(parentQ.invert().multiply(q));node.updateWorldMatrix(false,true);}
function aimBone(node,end,target) {
  const origin=node.getWorldPosition(v()),current=end.getWorldPosition(v()).sub(origin).normalize(),desired=target.clone().sub(origin).normalize();
  worldQ(node,new THREE.Quaternion().setFromUnitVectors(current,desired).multiply(node.getWorldQuaternion(new THREE.Quaternion())));
}
function solveArm(source,side,target,handQ) {
  const upper=source.getObjectByName('Bip001_'+side+'_UpperArm'),fore=source.getObjectByName('Bip001_'+side+'_Forearm'),hand=source.getObjectByName('Bip001_'+side+'_Hand');
  const shoulder=upper.getWorldPosition(v()),l1=shoulder.distanceTo(fore.getWorldPosition(v())),l2=fore.getWorldPosition(v()).distanceTo(hand.getWorldPosition(v()));
  const direction=target.clone().sub(shoulder),distance=THREE.MathUtils.clamp(direction.length(),.03,l1+l2-.005);direction.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const pole=v(side==='L'?1:-1,-.4,-.45),bend=pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const elbow=shoulder.clone().addScaledVector(direction,along).addScaledVector(bend,height);
  aimBone(upper,fore,elbow);aimBone(fore,hand,target);worldQ(hand,handQ);
}
const interpolate=(phase,rows)=>{let i=0;while(i<rows.length-2&&phase>rows[i+1][0])i++;const [a,...p]=rows[i],[b,...q]=rows[i+1],t=THREE.MathUtils.clamp((phase-a)/(b-a),0,1),smooth=t*t*(3-2*t);return p.map((value,j)=>THREE.MathUtils.lerp(value,q[j],smooth));};
function roleAnimations(object,source,role,clips,equipment,bindHandQ) {
  const rest=[];source.traverse(node=>rest.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]));
  const restore=()=>rest.forEach(([node,p,q,s])=>{node.position.copy(p);node.quaternion.copy(q);node.scale.copy(s);});
  const idle=clips.find(clip=>clip.name==='Idle');
  const changed=['Bip001_L_UpperArm','Bip001_L_Forearm','Bip001_L_Hand','Bip001_R_UpperArm','Bip001_R_Forearm','Bip001_R_Hand'];
  return clips.map(original=>{
    restore();const attack=original.name==='Attack';
    const input=attack?staticIdle(idle,1.55):original,clip=input.clone();clip.name=original.name;
    const samplers=input.tracks.map(track=>{const split=track.name.lastIndexOf('.');return {node:source.getObjectByName(track.name.slice(0,split)),property:track.name.slice(split+1),interpolant:track.createInterpolant()};});
    const count=Math.ceil(clip.duration*60),times=[],rotations=Object.fromEntries(changed.map(name=>[name,[]])),extra=new Map();
    const record=(node,property)=>{const key=node.name+'.'+property,row=extra.get(key)||[];row.push(...node[property].toArray());extra.set(key,row);};
    const phases=Array.from(new Set([...Array.from({length:count+1},(_,i)=>i/count),...(attack?[.2,.47,.49,.5,.515,.55,.56,.62,.85]:[])])).sort((a,b)=>a-b);
    for(const phase of phases) {
      times.push(phase*clip.duration);for(const {node,property,interpolant} of samplers)node[property].fromArray(interpolant.evaluate(phase*clip.duration));object.updateMatrixWorld(true);
      if(original.name!=='Death') {
        if(role==='archer') {
          const readyL=[.27,1.12,.2],readyR=[-.23,1.09,.16];
          const left=attack?interpolate(phase,[[0,...readyL],[.2,.12,1.36,.45],[.55,.12,1.36,.45],[.85,...readyL],[1,...readyL]]):readyL;
          const right=attack?interpolate(phase,[[0,...readyR],[.2,.12,1.36,.29],[.47,.12,1.36,.04],[.5,.09,1.36,.03],[.58,-.04,1.35,.035],[.85,...readyR],[1,...readyR]]):readyR;
          solveArm(source,'L',v(...left).add(v(0,.075,-.03)),bindHandQ.L);solveArm(source,'R',v(...right).add(v(0,.075,-.03)),bindHandQ.R);
        } else {
          const left=attack?interpolate(phase,[[0,.25,1.1,.15],[.32,.16,1.28,.31],[.56,.11,1.3,.46],[.67,.12,1.28,.4],[1,.25,1.1,.15]]):[.25,1.1,.15];
          const right=attack?interpolate(phase,[[0,-.25,1.06,.17],[.35,-.25,1.23,.29],[.56,-.23,1.21,.36],[.7,-.24,1.19,.3],[1,-.25,1.06,.17]]):[-.25,1.06,.17];
          solveArm(source,'L',v(...left).add(v(0,.075,-.03)),bindHandQ.L);solveArm(source,'R',v(...right).add(v(0,.075,-.03)),bindHandQ.R);
        }
      }
      for(const name of changed)rotations[name].push(...source.getObjectByName(name).quaternion.toArray());
      if(role==='archer') {
        const draw=attack?interpolate(phase,[[0,0],[.2,.24],[.47,1],[.5,1],[.515,0],[1,0]])[0]:0,nock=v(0,0,-.08-.33*draw);
        equipment.strings.forEach((node,j)=>{const anchor=v(0,j===0?-.52:.52,-.08),delta=anchor.clone().sub(nock);node.position.copy(anchor).add(nock).multiplyScalar(.5);node.quaternion.setFromUnitVectors(v(0,1,0),delta.clone().normalize());node.scale.y=delta.length();record(node,'position');record(node,'quaternion');record(node,'scale');});
        equipment.arrow.position.copy(nock);equipment.arrow.scale.setScalar(attack&&phase<.5?1:0);record(equipment.arrow,'position');record(equipment.arrow,'scale');
        equipment.release.position.copy(nock);record(equipment.release,'position');
      } else {equipment.crystal.scale.setScalar(attack?1+.32*Math.sin(Math.PI*THREE.MathUtils.clamp(phase/.56,0,1)):1);record(equipment.crystal,'scale');}
    }
    const replaced=new Set([...changed.map(name=>name+'.quaternion'),...extra.keys()]);clip.tracks=clip.tracks.filter(track=>!replaced.has(track.name));
    for(const name of changed)clip.tracks.push(new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,rotations[name]));
    for(const [name,values] of extra)clip.tracks.push(name.endsWith('.quaternion')?new THREE.QuaternionKeyframeTrack(name,times,values):new THREE.VectorKeyframeTrack(name,times,values));
    restore();object.updateMatrixWorld(true);return clip;
  });
}
function staticIdle(idle,duration){return new THREE.AnimationClip('role_attack_source_pose',duration,idle.tracks.map(track=>{const next=track.clone(),value=Array.from(track.createInterpolant().evaluate(0));next.times=new Float32Array([0,duration]);next.values=new Float32Array([...value,...value]);return next;}));}

export function buildSkeletonVariant(object,source,role,clips) {
  object.updateMatrixWorld(true);
  const removedTriangles=removeReplacedEquipment(source,role),bindHandQ=Object.fromEntries(['L','R'].map(side=>[side,source.getObjectByName('Bip001_'+side+'_Hand').getWorldQuaternion(new THREE.Quaternion())]));
  const equipment=role==='archer'?addBow(source):addMage(source);
  const result=roleAnimations(object,source,role,clips,equipment,bindHandQ);
  return {clips:result,meta:{role,removedSourceEquipmentTriangles:removedTriangles,attackContactPhase:role==='archer'?.5:.56,attackContactNode:role==='archer'?'ArcherRelease':'MageCast',attackContactStatus:role==='archer'?'Authored nocked arrow release and string snap at phase .5; projectile belongs to gameplay.':'Authored forward casting hand extension at phase .56; spell belongs to gameplay.',equipmentProvenance:'Corealm-authored bone-attached equipment over original Dungeon Skeleton body, skin and UVs.',roleAnimationProvenance:'Corealm-derived arm IK over original source locomotion. Role Attack is authored on source idle rig pose. Original melee attack is replaced, not renamed.'}};
}
