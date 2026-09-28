import type { Document, Node, Primitive } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { CreatureRepairProfile, CreatureRepairResult } from '../repairProfile.js';
import { addChannel, removeClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';

const assetIds = [
  'animal_crab', 'creature_amethyst_spider', 'creature_antler_beetle', 'creature_blind_cave_weaver',
  'creature_boss_tempest_roc', 'creature_cinderback_crag', 'creature_dewglass_weaver', 'creature_fen_crawler',
  'creature_flint_mandible', 'creature_hollowroot_spider', 'creature_moonweave_spider', 'creature_reed_strider',
  'creature_rift_carapace', 'creature_slag_centipede', 'creature_slag_crawler', 'creature_webweaver_spider',
] as const;
const v = (a: readonly number[]) => new Vector3().fromArray(a);
const worldPosition = (n: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(n.getWorldMatrix()));
function worldRotation(n: Node) {
  const q = new Quaternion();
  new Matrix4().fromArray(n.getWorldMatrix()).decompose(new Vector3(), q, new Vector3());
  return q.normalize();
}
function setWorldRotation(n: Node, q: Quaternion) {
  const parent = n.getParentNode();
  n.setRotation((parent ? worldRotation(parent).invert().multiply(q) : q).normalize().toArray());
}
function translateWorld(n: Node, delta: Vector3) {
  const p = worldPosition(n).add(delta), parent = n.getParentNode();
  if (parent) p.applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert());
  n.setTranslation(p.toArray());
}
function weightedPoint(meshNode:Node,primitive:Primitive,index:number) {
  const skin=meshNode.getSkin()!,source=v(primitive.getAttribute('POSITION')!.getElement(index,[])),ids=primitive.getAttribute('JOINTS_0')!.getElement(index,[]),weights=primitive.getAttribute('WEIGHTS_0')!.getElement(index,[]),out=new Vector3();
  const joints=skin.listJoints(),inverse=skin.getInverseBindMatrices()!;
  for(let i=0;i<4;i++)if(weights[i])out.addScaledVector(source.clone().applyMatrix4(new Matrix4().fromArray(joints[ids[i]!]!.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(ids[i]!,[])))),weights[i]!);
  return out;
}
function soleOffset(doc:Document,foot:Node) {
  const skin=doc.getRoot().listSkins()[0]!,joint=skin.listJoints().indexOf(foot);let minimum=Infinity,maximumWeight=0;
  const samples:{mass:number;y:number}[]=[];
  for(const node of doc.getRoot().listNodes().filter(n=>n.getSkin()===skin))for(const primitive of node.getMesh()!.listPrimitives()){
    const pos=primitive.getAttribute('POSITION')!,ids=primitive.getAttribute('JOINTS_0')!,weights=primitive.getAttribute('WEIGHTS_0')!;
    for(let i=0;i<pos.getCount();i++){const js=ids.getElement(i,[]),ws=weights.getElement(i,[]);let mass=0;for(let k=0;k<4;k++)if(js[k]===joint)mass+=ws[k]!;
      if(mass>.01){samples.push({mass,y:weightedPoint(node,primitive,i).y});maximumWeight=Math.max(maximumWeight,mass);}}
  }
  for(const sample of samples)if(sample.mass>=maximumWeight*.65)minimum=Math.min(minimum,sample.y);
  if(!Number.isFinite(minimum))throw new Error(`No weighted contact surface for ${foot.getName()}`);
  return worldPosition(foot).y-minimum;
}
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const pulse = (x: number, a: number, b: number, c: number, d: number) => smooth((x-a)/(b-a)) * (1-smooth((x-c)/(d-c)));
// Production masked native references: Black Wilderness Dragon Head reaches 20.5 degrees;
// Basalt Drake Head reaches 33.9 degrees before its 56.9-degree peak. Partial stone-head
// skin weights need a larger joint response to give the visible surface a comparable flinch.
const headRecoilRadians=.36,mineralHeadRecoilRadians=.52;

interface Leg {
  nodes: Node[];
  positions: Vector3[];
  rotations: Quaternion[];
  phase: number;
  side: number;
}

/** Two articulated segments and a fixed terminal contact. All lengths and scales stay at bind values. */
function plant(leg: Leg, contact: Vector3) {
  const [hip, knee, ankle, foot] = leg.nodes;
  const [a0, b0, c0, d0] = leg.positions;
  const hipPoint = worldPosition(hip!);
  const terminalOffset = d0!.clone().sub(c0!);
  const end = contact.clone().sub(terminalOffset);
  const upper = b0!.clone().sub(a0!), lower = c0!.clone().sub(b0!);
  const a = upper.length(), b = lower.length(), axis = end.clone().sub(hipPoint);
  const distance = Math.max(Math.abs(a-b)+1e-7, Math.min(a+b-1e-7, axis.length()));
  axis.normalize();
  const restAxis = c0!.clone().sub(a0!).normalize();
  let pole = b0!.clone().sub(a0!).addScaledVector(restAxis, -b0!.clone().sub(a0!).dot(restAxis));
  if (pole.lengthSq() < 1e-7) pole.set(leg.side, .5, 0);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-8) {pole.set(leg.side, 1, 0);pole.addScaledVector(axis, -pole.dot(axis));}
  pole.normalize();
  const along = (a*a-b*b+distance*distance)/(2*distance);
  const kneePoint = hipPoint.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0,a*a-along*along)));
  const reached = hipPoint.clone().addScaledVector(axis, distance);
  const upperQ = new Quaternion().setFromUnitVectors(upper.normalize(), kneePoint.clone().sub(hipPoint).normalize()).multiply(leg.rotations[0]!);
  setWorldRotation(hip!, upperQ);
  const lowerQ = new Quaternion().setFromUnitVectors(lower.normalize(), reached.clone().sub(kneePoint).normalize()).multiply(leg.rotations[1]!);
  setWorldRotation(knee!, lowerQ);
  setWorldRotation(ankle!, leg.rotations[2]!.clone());
  setWorldRotation(foot!, leg.rotations[3]!.clone());
  return worldPosition(foot!).distanceTo(contact);
}

type BendTransport={pole?:Vector3;upperInverse?:Quaternion;lowerInverse?:Quaternion;upperRotation?:Quaternion;lowerRotation?:Quaternion};
function limbFrame(direction:Vector3,normal:Vector3){
  const y=direction.clone().normalize(),x=y.clone().cross(normal).normalize(),z=x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));
}
function plantTwo(leg: Leg, target: Vector3, endRotation = leg.rotations[2]!, foldUp=0,transport?:BendTransport) {
  const [hip,knee,foot]=leg.nodes, [a0,b0,c0]=leg.positions;
  const at=worldPosition(hip!),upper=b0!.clone().sub(a0!),lower=c0!.clone().sub(b0!);
  const a=upper.length(),b=lower.length(),axis=target.clone().sub(at),distance=Math.max(Math.abs(a-b)+1e-6,Math.min(a+b-1e-6,axis.length()));
  axis.normalize();
  const restAxis=c0!.clone().sub(a0!).normalize();
  let pole=b0!.clone().sub(a0!).addScaledVector(restAxis,-b0!.clone().sub(a0!).dot(restAxis));
  if(pole.lengthSq()<1e-6) pole.set(leg.side,1,0);
  if(foldUp>0){
    pole.normalize().lerp(new Vector3(0,1,0),foldUp);
    // Arc the bend plane along the shell while folding. A direct blend toward +Y
    // crosses the moving limb axis and reverses the projected knee pole mid-fall.
    pole.addScaledVector(new Vector3(0,0,1),Math.sin(Math.PI*foldUp));
  }
  pole.addScaledVector(axis,-pole.dot(axis)).normalize();
  if(transport?.pole){
    const previous=transport.pole.clone().addScaledVector(axis,-transport.pole.dot(axis)).normalize();
    if(pole.dot(previous)<0)pole.negate();
    pole.copy(previous.lerp(pole,.24).normalize());
  }
  const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
  const bend=at.clone().addScaledVector(axis,along).addScaledVector(pole,height),end=at.clone().addScaledVector(axis,distance);
  const bentUpper=bend.clone().sub(at),bentLower=end.clone().sub(bend),normal=bentUpper.clone().cross(bentLower).normalize();
  if(transport?.upperInverse){
    // The full bend frame preserves bone roll even when a segment passes opposite its bind direction.
    setWorldRotation(hip!,limbFrame(bentUpper,normal).multiply(transport.upperInverse).multiply(transport.upperRotation!));
    setWorldRotation(knee!,limbFrame(bentLower,normal).multiply(transport.lowerInverse!).multiply(transport.lowerRotation!));
  }else{
    setWorldRotation(hip!,new Quaternion().setFromUnitVectors(upper.normalize(),bentUpper.normalize()).multiply(leg.rotations[0]!));
    setWorldRotation(knee!,new Quaternion().setFromUnitVectors(lower.normalize(),bentLower.normalize()).multiply(leg.rotations[1]!));
    if(transport){
      transport.upperInverse=limbFrame(bentUpper,normal).invert();transport.lowerInverse=limbFrame(bentLower,normal).invert();
      transport.upperRotation=worldRotation(hip!);transport.lowerRotation=worldRotation(knee!);
    }
  }
  if(transport)transport.pole=pole.clone();
  setWorldRotation(foot!,endRotation.clone());
  return worldPosition(foot!).distanceTo(target);
}

/** Weld UV seams for the weight solve, then diffuse only across actual mesh edges. No geometric neighbours across air gaps. */
function rebuildWeights(doc: Document, classify: (p: Vector3) => [string,number][], passes=3) {
  const skin=doc.getRoot().listSkins()[0]!,jointIndex=new Map(skin.listJoints().map((n,i)=>[n.getName(),i]));
  let count=0;
  for(const mesh of doc.getRoot().listMeshes()) for(const primitive of mesh.listPrimitives()) {
    const positions=primitive.getAttribute('POSITION')!,groups:number[][]=[],groupOf:number[]=[],keys=new Map<string,number>();
    for(let i=0;i<positions.getCount();i++) {
      const p=positions.getElement(i,[]),key=p.map(x=>Math.round(x*100000)).join(',');
      let g=keys.get(key); if(g===undefined){g=groups.length;keys.set(key,g);groups.push([]);} groups[g]!.push(i);groupOf.push(g);
    }
    const edges=groups.map(()=>new Set<number>()),indices=primitive.getIndices()!.getArray()!;
    for(let i=0;i<indices.length;i+=3) for(let k=0;k<3;k++) {
      const a=groupOf[indices[i+k]!]!,b=groupOf[indices[i+(k+1)%3]!]!;
      if(a!==b){edges[a]!.add(b);edges[b]!.add(a);}
    }
    let weights=groups.map(g=>{
      const result=new Map<number,number>();for(const [name,weight] of classify(v(positions.getElement(g[0]!,[])))) {
        const ix=jointIndex.get(name);if(ix===undefined) throw new Error(`Unknown anatomical weight joint ${name}`);
        result.set(ix,(result.get(ix)??0)+weight);
      }return result;
    });
    for(let pass=0;pass<passes;pass++) weights=weights.map((own,i)=>{
      if(!edges[i]!.size)return own;
      const next=new Map([...own].map(([j,w])=>[j,w*.45]));
      for(const adjacent of edges[i]!) for(const [j,w] of weights[adjacent]!) next.set(j,(next.get(j)??0)+w*.55/edges[i]!.size);
      return next;
    });
    const ids=new Uint16Array(positions.getCount()*4),values=new Float32Array(ids.length);
    groups.forEach((group,g)=>{
      const chosen=[...weights[g]!].sort((a,b)=>b[1]-a[1]).slice(0,4),total=chosen.reduce((s,a)=>s+a[1],0);
      for(const i of group) chosen.forEach(([j,w],k)=>{ids[i*4+k]=j;values[i*4+k]=w/total;});
    });
    const buffer=doc.getRoot().listBuffers()[0]!;
    primitive.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(ids).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(values).setBuffer(buffer));
    count+=positions.getCount();
  }
  return {vertices:count,method:'Anatomical segments with smooth joint collars; UV-seam-welded topology diffusion, never nearest neighbours across separate limbs',passes};
}

function segmentWeights(p:Vector3, chain:Node[], rootWeight:number, bodyName:string):[string,number][] {
  // Mesh-local bind coordinates: the authored rigs share the mesh's identity parent basis.
  const positions=chain.map(n=>new Vector3().setFromMatrixPosition(new Matrix4().fromArray(n.getWorldMatrix())));
  let nearest:{index:number;t:number;distance:number}|undefined;
  for(let i=0;i<positions.length-1;i++) {
    const a=positions[i]!,d=positions[i+1]!.clone().sub(a),t=Math.max(0,Math.min(1,p.clone().sub(a).dot(d)/d.lengthSq()));
    const distance=p.distanceTo(a.clone().addScaledVector(d,t));if(!nearest||distance<nearest.distance)nearest={index:i,t,distance};
  }
  const n=nearest!,blend=smooth((n.t-.72)/.28),mass=1-rootWeight;
  return [[chain[n.index]!.getName(),mass*(1-blend)],[chain[n.index+1]!.getName(),mass*blend],[bodyName,rootWeight]];
}

function repairStrider(doc:Document):CreatureRepairResult {
  const root=doc.getRoot(),nodes=new Map(root.listNodes().map(n=>[n.getName(),n]));
  const sourceBodyWeights=new Map<string,[string,number][]>(),jointNames=root.listSkins()[0]!.listJoints().map(n=>n.getName());
  for(const mesh of root.listMeshes())for(const primitive of mesh.listPrimitives()){
    const pos=primitive.getAttribute('POSITION')!,ids=primitive.getAttribute('JOINTS_0')!,ws=primitive.getAttribute('WEIGHTS_0')!;
    for(let i=0;i<pos.getCount();i++){
      const ix=ids.getElement(i,[]),weights=ws.getElement(i,[]);
      const bodyWeights:[string,number][]=ix.flatMap((joint,k)=>['Thorax','Abdomen','AbdomenTip','Head','Mandible_L','Mandible_R'].includes(jointNames[joint]??'')&&weights[k]!>0?[[jointNames[joint]!,weights[k]!] as [string,number]]:[]);
      const mass=bodyWeights.reduce((sum,[,weight])=>sum+weight,0);
      if(mass>0)sourceBodyWeights.set(pos.getElement(i,[]).map(x=>Math.round(x*100000)).join(','),bodyWeights.map(([name,weight])=>[name,weight/mass]));
    }
  }
  const chains=new Map<string,Node[]>();
  for(const side of ['L','R'])for(const family of ['Fore','Mid','Hind'])chains.set(`${family}_${side}`,
    (family==='Fore'?['Upper','Elbow','Blade']:['Upper','Knee','Foot']).map(part=>nodes.get(`${family}${part}_${side}`)!));
  const weights=rebuildWeights(doc,p=>{
    const side=p.z<0?'L':'R',lateral=Math.abs(p.z),rootWeight=1-smooth((lateral-.075)/.09);
    if(lateral>.075&&p.y>.56)return segmentWeights(p,chains.get(`Fore_${side}`)!,rootWeight,'Thorax');
    if(lateral>.10&&p.y>.38&&p.y<.56)return segmentWeights(p,chains.get(`Mid_${side}`)!,rootWeight,'Thorax');
    if(lateral>.08&&p.y<.38)return segmentWeights(p,chains.get(`Hind_${side}`)!,rootWeight,'Thorax');
    return sourceBodyWeights.get(p.toArray().map(x=>Math.round(x*100000)).join(','))??[['Thorax',1]];
  },4);
  const container=nodes.get('ReedStrider_Rig')!;
  container.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-Math.PI/2).toArray());
  const legs=[...chains].map(([name,chain],i)=>({name,nodes:chain,positions:chain.map(worldPosition),rotations:chain.map(worldRotation),phase:(name.startsWith('Mid')?0:.5)+(name.endsWith('_L')?0:.5),side:name.endsWith('_L')?1:-1,contactY:name.startsWith('Fore')?0:soleOffset(doc,chain[2]!)+.002}));
  const supportSurfaces=new Map<string,{meshNode:Node;primitive:Primitive;index:number}[]>();
  const joints=root.listSkins()[0]!.listJoints();
  for(const leg of legs.filter(l=>!l.name.startsWith('Fore'))){
    const indices=new Set(leg.nodes.map(n=>joints.indexOf(n))),surface:{meshNode:Node;primitive:Primitive;index:number}[]=[];
    for(const meshNode of root.listNodes().filter(n=>n.getSkin()))for(const primitive of meshNode.getMesh()!.listPrimitives()){
      const positions=primitive.getAttribute('POSITION')!,ids=primitive.getAttribute('JOINTS_0')!,weights=primitive.getAttribute('WEIGHTS_0')!;
      for(let i=0;i<positions.getCount();i++){const ix=ids.getElement(i,[]),ws=weights.getElement(i,[]);if(ws.reduce((sum,weight,k)=>sum+(indices.has(ix[k]!)?weight:0),0)>.60)surface.push({meshNode,primitive,index:i});}
    }
    if(!surface.length)throw new Error(`No skinned support surface for ${leg.name}`);
    supportSurfaces.set(leg.name,surface);
  }
  const body=nodes.get('Thorax')!,rootJoint=nodes.get('StriderRoot')!,rest=storedPose(doc);
  for(const clip of [...root.listAnimations()])removeClip(doc,clip.getName());
  const clips=[];let attackContactNormalized=.53,attackReach=-Infinity;
  for(const [name,seconds] of Object.entries({Idle:3,Walk:1.12,Run:.72,Attack:.95,Hit:.55,Death:1.45})) {
    const clip=doc.createAnimation(name),times=Array.from({length:65},(_,i)=>seconds*i/64),tracks=root.listSkins()[0]!.listJoints().map(node=>({node,t:[] as number[],r:[] as number[]}));
    let solverTargetError=0,maxFloorCorrection=0,maxSupportSurfaceError=0;
    for(let i=0;i<times.length;i++) {
      restorePose(rest);const phase=i/64,wave=Math.sin(phase*Math.PI*2),locomotion=name==='Walk'||name==='Run',running=name==='Run';
      const attack=name==='Attack'?pulse(phase,.07,.30,.53,.85):0,hit=name==='Hit'?pulse(phase,0,.14,.20,.8):0,death=name==='Death'?smooth((phase-.08)/.58):0;
      translateWorld(body,new Vector3(0,-.0545-.02*death+(name==='Idle'?.0025*wave:0),.025*attack));
      nodes.get('Head')!.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-headRecoilRadians*hit+.05*attack-.07*death).toArray());
      const surfaceTargets=new Map<string,number>();
      for(const leg of legs) {
        let target:Vector3,swingLift=0;
        if(leg.name.startsWith('Fore')) {
          // Raised bind limbs fold into a mantis guard; the strike extends the forearms in front of the face.
          target=new Vector3(leg.side*(.22+.015*attack),.40-.04*death+.10*attack,.29+.12*attack);
          if(name==='Idle')target.y+=.006*wave;
        } else {
          const mid=leg.name.startsWith('Mid');target=new Vector3(leg.side*(mid?.19:.24),leg.contactY,mid?.17:.15);
          if(locomotion){const p=(phase+leg.phase)%1,duty=running?.60:.69,stride=running?.10:.065;
            if(p<duty)target.z+=stride*(.5-p/duty);else{const s=(p-duty)/(1-duty);target.z+=stride*(-.5+smooth(s));swingLift=(running?.052:.035)*Math.sin(Math.PI*s)**2;target.y+=swingLift;}}
          if(death){target.x-=leg.side*.06*death;target.z-=.02*death;target.y+=.12*death;}
        }
        let solveError=plantTwo(leg,target);
        if(!leg.name.startsWith('Fore')&&!death){
          surfaceTargets.set(leg.name,.002+swingLift);
          // Large folds move mixed-weight toe surfaces relative to the terminal joint.
          // Calibrate the actual posed mesh against the floor, not the bind-pose bone height.
          for(let iteration=0;iteration<4;iteration++){
            const minimum=Math.min(...supportSurfaces.get(leg.name)!.map(p=>weightedPoint(p.meshNode,p.primitive,p.index).y));
            const correction=.002+swingLift-minimum;if(Math.abs(correction)<.00005)break;
            target.y+=correction;solveError=plantTwo(leg,target);
          }
        }
        solverTargetError=Math.max(solverTargetError,solveError);
      }
      if(death)setWorldRotation(rootJoint,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),1.3*death).multiply(worldRotation(rootJoint)));
      const correction=Math.max(0,.002-deformedBounds(doc).min[1]!);translateWorld(rootJoint,new Vector3(0,correction,0));maxFloorCorrection=Math.max(maxFloorCorrection,correction);
      for(const [legName,targetY] of surfaceTargets){const minimum=Math.min(...supportSurfaces.get(legName)!.map(p=>weightedPoint(p.meshNode,p.primitive,p.index).y));maxSupportSurfaceError=Math.max(maxSupportSurfaceError,Math.abs(minimum-targetY));}
      if(name==='Attack'){const reach=Math.max(...legs.filter(l=>l.name.startsWith('Fore')).map(l=>worldPosition(l.nodes[2]!).z));if(reach>attackReach+1e-8){attackReach=reach;attackContactNormalized=phase;}}
      for(const tr of tracks){tr.t.push(...tr.node.getTranslation());tr.r.push(...tr.node.getRotation());}
    }
    for(const tr of tracks){addChannel(doc,clip,tr.node,'translation',times,tr.t);addChannel(doc,clip,tr.node,'rotation',times,tr.r);}
    clips.push({name,solverTargetError,maxFloorCorrection,supportSurfaceError:name==='Death'?null:maxSupportSurfaceError});
  }
  restorePose(rest);
  return {changes:['Corrected +X source facing to production +Z','Reweighted limb shafts to their parent joint and smoothed connected mesh collars','Replaced airborne middle-leg bind stance with planted four-foot support and folded forelimb guard in all six states'],
    provenance:{weights,clips,attackContactNormalized,hitRecoilRadians:headRecoilRadians,hitReference:'Measured native Black Wilderness Dragon Head: 20.5 degrees at Hit phase .23; preserve all support branches',contactBasis:'First maximum forward forelimb endpoint over 65 phases',supportContacts:'Iterative fixed-length solve against actual skinned limb surfaces at each pose; terminal bone heights alone do not represent mixed-weight toe contact',sourceAnatomy:'User-confirmed upright six-limb Reed Strider, four walking limbs and two grasping forelimbs; positions, triangles, UVs and generated maps unchanged'},
    motion:{walkClipSeconds:1.12,runClipSeconds:.72,impliedWalkMps:.065/(1.12*.69),impliedRunMps:.10/(.72*.60),attackSeconds:.95,contactNormalized:attackContactNormalized,groundY:0}};
}

type BoneDefinition={name:string;parent:string|null;p:[number,number,number]};
function replaceRig(doc:Document,definitions:BoneDefinition[]) {
  const root=doc.getRoot(),meshNodes=root.listNodes().filter(n=>n.getMesh()),container=meshNodes[0]!.getParentNode()!;
  for(const clip of [...root.listAnimations()])removeClip(doc,clip.getName());
  const oldJoints=new Set(root.listSkins().flatMap(s=>s.listJoints()));
  for(const n of meshNodes)n.setSkin(null);
  for(const skin of [...root.listSkins()])skin.dispose();
  for(const n of [...oldJoints].reverse())n.dispose();
  const nodes=new Map<string,Node>(),points=new Map(definitions.map(d=>[d.name,d.p]));
  for(const d of definitions){const p=v(d.p).sub(d.parent?v(points.get(d.parent)!):new Vector3()),n=doc.createNode(d.name).setTranslation(p.toArray());nodes.set(d.name,n);(d.parent?nodes.get(d.parent)!:container).addChild(n);}
  const skin=doc.createSkin('Anatomical contact rig').setSkeleton(nodes.get(definitions[0]!.name)!);
  for(const d of definitions)skin.addJoint(nodes.get(d.name)!);
  const meshWorld=new Matrix4().fromArray(meshNodes[0]!.getWorldMatrix());
  const inverse=Float32Array.from(definitions.flatMap(d=>new Matrix4().fromArray(nodes.get(d.name)!.getWorldMatrix()).invert().multiply(meshWorld).toArray()));
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(inverse).setBuffer(root.listBuffers()[0]!));
  for(const n of meshNodes)n.setSkin(skin);
  return {nodes,container,meshWorld};
}

function repairCrustacean(doc:Document,crab:boolean,delver=false):CreatureRepairResult {
  const rift=!crab&&!delver;
  const oldLegRegions=new Map<string,string>();
  const oldExpressiveWeights=new Map<string,[string,number][]>();
  if(delver){const oldNames=doc.getRoot().listSkins()[0]!.listJoints().map(n=>n.getName());
    for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
      const pos=primitive.getAttribute('POSITION')!,ids=primitive.getAttribute('JOINTS_0')!,weights=primitive.getAttribute('WEIGHTS_0')!;
      for(let i=0;i<pos.getCount();i++){const js=ids.getElement(i,[] as number[]),ws=weights.getElement(i,[] as number[]),best=ws.indexOf(Math.max(...ws)),name=oldNames[js[best]!];
        const key=pos.getElement(i,[]).map(x=>Math.round(x*100000)).join(',');
        if(name?.includes('Leg_')&&ws[best]!>.5)oldLegRegions.set(key,name.replace('Leg_','_'));
        const expressive: [string,number][]=js.flatMap((joint,k)=>['Head','Tail'].includes(oldNames[joint]??'')&&ws[k]!>0?[[oldNames[joint]!,ws[k]!] as [string,number]]:[]);
        if(expressive.length)oldExpressiveWeights.set(key,[['Carapace',1-expressive.reduce((sum,[,weight])=>sum+weight,0)],...expressive]);}
    }}
  const defs:BoneDefinition[]=[{name:'ContactRoot',parent:null,p:[0,0,0]},{name:'Carapace',parent:'ContactRoot',p:delver?[0,.28,0]:crab?[-.04,.44,0]:[-.035,.43,0]}];
  if(delver)defs.push({name:'Head',parent:'Carapace',p:[0,.33,-.405]},{name:'Tail',parent:'Carapace',p:[0,.28,.455]});
  const groups:{name:string;kind:'leg'|'claw';side:number;phase:number;names:string[]}[]=[];
  const append=(name:string,kind:'leg'|'claw',side:number,phase:number,points:[number,number,number][])=>{
    const names=points.map((_,i)=>`${name}_${['Upper','Knee','Tip'][i]}`);points.forEach((p,i)=>defs.push({name:names[i]!,parent:i?names[i-1]!:'Carapace',p}));groups.push({name,kind,side,phase,names});
  };
  for(const side of [-1,1]) {
    const s=side<0?'L':'R';
    if(delver){for(const [i,pair] of ['Front','Middle','Rear'].entries()){
      const z=[-.285,-.03,.31][i]!;append(`${pair}_${s}`,'leg',side,(i+(side>0?1:0))%2*.5,[[side*.198,.245,z],[side*.23,.125,z-.012],[side*.22,.015,z]]);
    }} else if(crab) {
      // The source has three walking appendages per side. The retired rig cut each middle shaft into competing X buckets.
      append(`Front_${s}`,'leg',side,side<0?0:.5,[[-.09,.47,side*.18],[-.10,.51,side*.33],[-.14,.43,side*.42]]);
      append(`Middle_${s}`,'leg',side,side<0?.5:0,[[.005,.35,side*.18],[.045,.34,side*.45],[.115,.145,side*.46]]);
      append(`Rear_${s}`,'leg',side,side<0?0:.5,[[.075,.29,side*.18],[.21,.22,side*.32],[.335,.025,side*.28]]);
      append(`Claw_${s}`,'claw',side,0,[[-.18,.59,side*.19],[-.26,.68,side*.33],[-.30,.85,side*.26]]);
    } else {
      append(`Middle_${s}`,'leg',side,side<0?0:.5,[[.02,.36,side*.20],[.09,.37,side*.42],[.19,.045,side*.475]]);
      append(`Rear_${s}`,'leg',side,side<0?.5:0,[[-.15,.39,side*.22],[-.21,.40,side*.42],[-.26,.025,side*.47]]);
      append(`Claw_${s}`,'claw',side,0,[[.145,.35,side*.17],[.26,.36,side*.25],[.35,.22,side*.26]]);
    }
  }
  const {nodes,container,meshWorld}=replaceRig(doc,defs);
  const weights=rebuildWeights(doc,p=>{
    const side=p.z<0?-1:1,lateral=Math.abs(p.z),suffix=side<0?'L':'R';
    let name:string|undefined;
    if(delver)name=oldLegRegions.get(p.toArray().map(x=>Math.round(x*100000)).join(','));
    else if(crab){if(p.x<-.16&&p.y>.54&&lateral>.10)name=`Claw_${suffix}`;
      else if(lateral>.18&&p.y>.40&&p.y<.68)name=`Front_${suffix}`;
      else if(lateral>.18&&p.x<.14&&p.y<.46)name=`Middle_${suffix}`;
      else if(lateral>.16&&p.x>=.10&&p.y<.37)name=`Rear_${suffix}`;
    }else{if(p.x>.17&&lateral>.12&&lateral<.37&&p.y<.49)name=`Claw_${suffix}`;
      else if(lateral>.23&&p.x>-.01&&p.y<.50)name=`Middle_${suffix}`;
      else if(lateral>.23&&p.x<-.01&&p.y<.54)name=`Rear_${suffix}`;}
    if(!name)return delver?oldExpressiveWeights.get(p.toArray().map(x=>Math.round(x*100000)).join(','))??[['Carapace',1]]:[['Carapace',1]];
    const group=groups.find(g=>g.name===name)!,chain=group.names.map(n=>nodes.get(n)!);
    const blend=delver?1:smooth((lateral-(crab?.14:.16))/.11);
    return segmentWeights(p.clone().applyMatrix4(meshWorld),chain,1-blend,'Carapace');
  },7);
  let pitch=0;
  if(crab){
    // Foot markers expose the tilted source support plane. Rotate the whole source basis; never rotate mesh data independently from its rig.
    const toes=groups.filter(g=>g.kind==='leg'&&g.side===1).map(g=>defs.find(d=>d.name===g.names[2])!.p),mx=toes.reduce((a,p)=>a+p[0],0)/toes.length,my=toes.reduce((a,p)=>a+p[1],0)/toes.length;
    pitch=Math.atan(-toes.reduce((a,p)=>a+(p[0]-mx)*(p[1]-my),0)/toes.reduce((a,p)=>a+(p[0]-mx)**2,0));
    container.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),pitch)).toArray());
  }
  if(delver)container.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI).toArray());
  const rootJoint=nodes.get('ContactRoot')!,body=nodes.get('Carapace')!,scale=Math.hypot(...container.getWorldMatrix().slice(0,3));
  translateWorld(rootJoint,new Vector3(0,-deformedBounds(doc).min[1]!,0));
  const limbs=groups.map(g=>({...g,nodes:g.names.map(n=>nodes.get(n)!),positions:g.names.map(n=>worldPosition(nodes.get(n)!)),rotations:g.names.map(n=>worldRotation(nodes.get(n)!)),contactY:g.kind==='leg'?soleOffset(doc,nodes.get(g.names[2]!)!)+.002*scale:0}));
  const reachableStride=Math.min(...limbs.filter(l=>l.kind==='leg').map(l=>{
    const hip=l.positions[0]!.clone().add(new Vector3(0,-(delver?.035:0)*scale,0));
    const target=l.positions[2]!.clone();target.x*=crab?.95:.98;target.y=l.contactY;
    const radius=l.positions[0]!.distanceTo(l.positions[1]!)+l.positions[1]!.distanceTo(l.positions[2]!);
    const along=Math.sqrt(Math.max(0,radius*radius-(target.x-hip.x)**2-(target.y-hip.y)**2));
    return 1.90*Math.max(0,along-Math.abs(target.z-hip.z));
  }));
  const runStride=Math.min(.13*scale,reachableStride),walkStride=Math.min(.08*scale,runStride);
  if(walkStride<.015*scale)throw new Error('Authored limb stance leaves no usable forward stride');
  const rest=storedPose(doc),clipReports=[];
  const walkSeconds=delver?1.52:crab?1.1:1.05,runSeconds=delver?.88:.68,attackSeconds=delver?.78:crab?.95:1.18;
  let attackContactNormalized=.51,attackReach=-Infinity;
  for(const [name,seconds] of Object.entries({Idle:3,Walk:walkSeconds,Run:runSeconds,Attack:attackSeconds,Hit:.5,Death:1.55})) {
    const clip=doc.createAnimation(name),times=Array.from({length:65},(_,i)=>seconds*i/64),tracks=doc.getRoot().listSkins()[0]!.listJoints().map(node=>({node,t:[] as number[],r:[] as number[]}));
    const fallTransport=new Map<string,BendTransport>(rift&&name==='Death'?limbs.map(l=>[l.name,{}]):[]);
    let solverTargetError=0,maxFloorCorrection=0;
    for(let i=0;i<65;i++) {
      restorePose(rest);const phase=i/64,wave=Math.sin(phase*Math.PI*2),moving=name==='Walk'||name==='Run',running=name==='Run';
      const strike=name==='Attack'?pulse(phase,.06,.40,.51,.84):0,hit=name==='Hit'?pulse(phase,0,.15,.22,.80):0,death=name==='Death'?smooth((phase-.06)/.6):0;
      translateWorld(body,new Vector3(0,(name==='Idle'?.003*wave:0)*scale-(delver?.035:0)*scale-.01*hit*scale-(crab?.10:delver?.14:.06)*death*scale,(delver?.055:.022)*(strike-hit)*scale));
      if(delver){
        nodes.get('Head')!.setRotation(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.12*strike-mineralHeadRecoilRadians*hit+.13*death+(name==='Idle'?.012*wave:0)).toArray());
        nodes.get('Tail')!.setRotation(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-.09*death).toArray());
      }
      for(const limb of limbs){
        const target=limb.positions[2]!.clone();
        if(limb.kind==='leg'){
          target.y=limb.contactY;
          // Bring the stance inboard before taking steps; a source pose is not a contact pose.
          target.x*=crab?.95:.98;
          if(moving){const p=(phase+limb.phase)%1,duty=running?.60:.68,stride=running?runStride:walkStride;
            if(p<duty)target.z+=stride*(.5-p/duty);else{const s=(p-duty)/(1-duty);target.z+=stride*(-.5+smooth(s));target.y+=(running?.055:.035)*scale*Math.sin(Math.PI*s)**2;}}
          target.y+=death*.04*scale;target.x*=1-.20*death;
        } else {
          target.z+=scale*(.11*strike-.08*hit-.045*death);target.x*=1-.18*strike-.07*hit-.12*death;target.y+=((name==='Idle'?.007*wave:0)+.055*hit-.12*death)*scale;
        }
        if(rift&&death){
          // Pull the rigid appendages against the shell before it lands on its flank.
          // Claws reaching down would prop the body upright even after a large root roll.
          const folded=worldPosition(body).add(new Vector3(
            Math.sign(limb.positions[0]!.x)*(limb.kind==='claw'?.11:.13)*scale,
            (limb.kind==='claw'?.03:.14)*scale,
            (limb.kind==='claw'?.24:limb.name.startsWith('Rear')?-.12:.10)*scale,
          ));
          // A straight interpolation from the floor to the tucked pose passes through
          // the hip's unreachable inner sphere. Sweep the toes around the outside instead.
          const control=worldPosition(body).add(new Vector3(
            Math.sign(limb.positions[0]!.x)*(limb.kind==='claw'?.30:.58)*scale,
            .18*scale,folded.z-worldPosition(body).z,
          ));
          target.multiplyScalar((1-death)**2).addScaledVector(control,2*death*(1-death)).addScaledVector(folded,death**2);
        }
        solverTargetError=Math.max(solverTargetError,plantTwo(limb,target,undefined,rift?death:0,fallTransport.get(limb.name)));
      }
      // The low crab settles on its underside; Rift's tall shell falls onto its broad flank.
      if(death)setWorldRotation(rootJoint,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),(rift?1.66:.13)*death).multiply(worldRotation(rootJoint)));
      const correction=Math.max(0,.002*scale-deformedBounds(doc).min[1]!);translateWorld(rootJoint,new Vector3(0,correction,0));maxFloorCorrection=Math.max(maxFloorCorrection,correction);
      if(name==='Attack'){const reach=delver?worldPosition(body).z:Math.max(...limbs.filter(l=>l.kind==='claw').map(l=>worldPosition(l.nodes[2]!).z));
        if(reach>attackReach+1e-8){attackReach=reach;attackContactNormalized=phase;}}
      for(const tr of tracks){tr.t.push(...tr.node.getTranslation());tr.r.push(...tr.node.getRotation());}
    }
    for(const tr of tracks){addChannel(doc,clip,tr.node,'translation',times,tr.t);addChannel(doc,clip,tr.node,'rotation',times,tr.r);}
    clipReports.push({name,solverTargetError,maxFloorCorrection});
  }
  restorePose(rest);
  return {changes:['Replaced rigid limbs with articulated appendage chains and continuous topology-aware joint collars','Baked planted foot contacts, attack reach, and held constant-scale shell settlement with folded limbs',...(crab?['Aligned tilted source support plane using the three pairs of anatomical toe markers']:[]),...(delver?['Corrected -Z source facing to production +Z; kept six original disconnected stone limb regions and original independent head/tail weight regions']:[])],
    provenance:{weights,clips:clipReports,sourcePitchRadians:pitch,walkingLegs:groups.filter(g=>g.kind==='leg').length,originalGeometryAndTexturesPreserved:true,attackContactNormalized,...(delver?{hitRecoilRadians:mineralHeadRecoilRadians,hitReference:'Measured native Basalt Drake Head: 33.9 degrees at Hit phase .18; stone head uses partial original skin weights'}:{}),contactBasis:'First maximum forward position of attacking claw endpoints or mineral head carrier, sampled at 65 clip phases',strideFit:{walkStride,runStride,maximumCommonStride:reachableStride,method:'Forward extent of each fixed-length support chain at sole height, with a 5 percent reach margin'}},
    motion:{walkClipSeconds:walkSeconds,runClipSeconds:runSeconds,impliedWalkMps:walkStride/(walkSeconds*.68),impliedRunMps:runStride/(runSeconds*.60),attackSeconds,contactNormalized:attackContactNormalized,groundY:0}};
}

/** The old gaits rotated nearly straight legs through the floor and death nonuniformly squashed the shell. */
function repairSixLegMotion(doc: Document, weaver: boolean): CreatureRepairResult {
  const root = doc.getRoot(), nodes = new Map(root.listNodes().map(n => [n.getName(), n]));
  const body = nodes.get('BodyCore')!;
  const rootJoint = nodes.get(weaver ? 'VaultweaverRoot' : nodes.has('ScarabRoot') ? 'ScarabRoot' : 'FlintRoot')!;
  const prefixes = weaver ? ['ForeL','ForeR','MidL','MidR','HindL','HindR'] : ['FrontLeft','FrontRight','MiddleLeft','MiddleRight','RearLeft','RearRight'];
  const suffixes = weaver ? ['Hip','Knee','Ankle','Foot'] : ['Hip','Femur','Tibia','Tarsus'];
  const legs: Leg[] = prefixes.map((prefix, i) => {
    const chain = suffixes.map(s => nodes.get(`${prefix}_${s}`)!);
    if (chain.some(n => !n)) throw new Error(`Incomplete articulated arthropod leg: ${prefix}`);
    return {nodes: chain, positions: chain.map(worldPosition), rotations: chain.map(worldRotation), phase: (Math.floor(i/2) + i%2)%2*.5, side:i%2 ? 1 : -1};
  });
  const meshNode=root.listNodes().find(n=>n.getSkin())!,meshWorld=new Matrix4().fromArray(meshNode.getWorldMatrix());
  const weights=rebuildWeights(doc,p=>{
    const wp=p.clone().applyMatrix4(meshWorld);
    let nearest:{leg:Leg;distance:number}|undefined;
    for(const leg of legs)for(let i=0;i<leg.positions.length-1;i++){
      const a=leg.positions[i]!,d=leg.positions[i+1]!.clone().sub(a),t=Math.max(0,Math.min(1,wp.clone().sub(a).dot(d)/d.lengthSq()));
      const distance=wp.distanceTo(a.clone().addScaledVector(d,t));if(!nearest||distance<nearest.distance)nearest={leg,distance};
    }
    const radial=weaver?Math.hypot(p.x/.20,(p.z-.08)/.31):Math.hypot(p.x/.16,(p.z+.005)/.30);
    const activation=smooth((.48-p.y)/.20)*smooth((radial-.72)/.38);
    const limb=segmentWeights(wp,nearest!.leg.nodes,1-activation,'BodyCore');
    const central=1-smooth((Math.abs(p.x)-(weaver?.10:.08))/(weaver?.15:.12));
    const head=central*smooth((p.z-(weaver?.14:.12))/(weaver?.22:.22))*(weaver?smooth((.68-p.y)/.18):1);
    const jaw=weaver?0:head*smooth((p.z-.30)/.12)*smooth((.40-p.y)/.18);
    return limb.flatMap(([name,weight]):[string,number][]=>name==='BodyCore'?[
      ['BodyCore',weight*(1-head)],[weaver?'Hood':'Head',weight*(head-jaw)],...(!weaver?[['Mandible',weight*jaw] as [string,number]]:[]),
    ]:[[name,weight]]);
  },4);
  const joints=root.listSkins()[0]!.listJoints(),attackingIndices=new Set(joints.flatMap((joint,i)=>[weaver?'Hood':'Head','Mandible'].includes(joint.getName())?[i]:[]));
  const attackSurface:{meshNode:Node;primitive:Primitive;index:number}[]=[];
  for(const n of root.listNodes().filter(n=>n.getSkin()))for(const primitive of n.getMesh()!.listPrimitives()){
    const pos=primitive.getAttribute('POSITION')!,ids=primitive.getAttribute('JOINTS_0')!,ws=primitive.getAttribute('WEIGHTS_0')!;
    for(let i=0;i<pos.getCount();i++){const ix=ids.getElement(i,[]),w=ws.getElement(i,[]);if(w.reduce((sum,value,k)=>sum+(attackingIndices.has(ix[k]!)?value:0),0)>.5)attackSurface.push({meshNode:n,primitive,index:i});}
  }
  if(attackSurface.length<10)throw new Error('Repaired head has no weighted striking surface');
  const rest = storedPose(doc);
  const scale = Math.hypot(...rootJoint.getWorldMatrix().slice(0,3));
  const height = legs.reduce((sum,l)=>sum+l.positions[0]!.y-l.positions[3]!.y,0)/legs.length;
  // A bent stance creates actual reach for support translation and swing instead of stretching a straight chain.
  const crouch = height*(weaver?.23:.11), stride = height*.27, runStride = height*.42;
  const walkSeconds = weaver ? 1.08 : 1.16, runSeconds = weaver ? .72 : .72;
  const durations: Record<string,number> = {Idle:3,Walk:walkSeconds,Run:runSeconds,Attack:.94,Hit:.5,Death:1.55};
  let attackContactNormalized=.49,attackReach=-Infinity;
  const provenance: Record<string,unknown> = {method:'Planted alternating-tripod contacts, analytic joint rotations at original bind lengths, neutral flexed stance, constant-scale supported death',
    reference:'tools/creature-expansion/crawlers.mjs plant/animate; studio animal_scorpion Idle/Walk/Run support sequencing',
    oldDefects:weaver ? ['Five-key sinusoidal leg rotations without foot contacts','Death scaled body to [0.88,0.62,0.90] and amplified all limb rotations'] : ['Five-key sinusoidal leg rotations without foot contacts','Death applied one global-axis hip fold to opposite-sided chains'],
    solverTargetError:0, scaleChannels:0, weights, clips:[],hitRecoilRadians:headRecoilRadians,hitReference:'Measured native Black Wilderness Dragon Head: 20.5 degrees at Hit phase .23; preserve all support branches'};
  for (const clip of [...root.listAnimations()]) removeClip(doc, clip.getName());
  for (const [name,seconds] of Object.entries(durations)) {
    const clip = doc.createAnimation(name), times = Array.from({length:65},(_,i)=>seconds*i/64);
    const tracks = root.listSkins()[0]!.listJoints().map(node => ({node,t:[] as number[],r:[] as number[]}));
    let maxError = 0, maxFloorCorrection = 0;
    for (let frame=0;frame<times.length;frame++) {
      restorePose(rest);
      const phase=frame/64, wave=Math.sin(phase*Math.PI*2), locomotion=name==='Walk'||name==='Run', running=name==='Run';
      const death=name==='Death'?smooth((phase-.06)/.53):0;
      const attack=name==='Attack'?pulse(phase,.05,.29,.49,.84):0;
      const hit=name==='Hit'?pulse(phase,0,.16,.20,.80):0;
      const bob=name==='Idle' ? height*.007*wave : locomotion ? height*.009*Math.cos(phase*Math.PI*4) : 0;
      translateWorld(body,new Vector3(0,-crouch+bob-height*.10*death-height*.055*hit,height*.15*attack-height*.045*hit));
      const bodyQ=worldRotation(body).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-.065*attack+.075*hit+.10*death));
      setWorldRotation(body,bodyQ);
      const head=nodes.get(weaver?'Hood':'Head');
      if(head) head.setRotation(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),(name==='Idle'?.017*wave:0)-.20*attack+headRecoilRadians*hit+.08*death).toArray());
      const jaw=nodes.get('Mandible');
      if(jaw) jaw.setRotation(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.10*attack).toArray());
      for (const leg of legs) {
        const target=leg.positions[3]!.clone();
        if(locomotion) {
          const p=(phase+leg.phase)%1,duty=running?.60:.68,s=running?runStride:stride;
          if(p<duty) target.z+=s*(.5-p/duty);
          else {const swing=(p-duty)/(1-duty);target.z+=s*(-.5+smooth(swing));target.y+=height*(running?.19:.13)*Math.sin(Math.PI*swing)**2;}
        }
        if(death) {target.x-=leg.side*height*.03*death;target.z-=height*.035*death;target.y+=height*.12*death;}
        maxError=Math.max(maxError,plant(leg,target));
      }
      if(death)setWorldRotation(rootJoint,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),1.35*death).multiply(worldRotation(rootJoint)));
      // The generated surface can extend just below the terminal joints. Correct only actual penetration.
      const minY=deformedBounds(doc).min[1]!;
      const correction=Math.max(0,.0015*scale-minY);
      if(correction) translateWorld(rootJoint,new Vector3(0,correction,0));
      maxFloorCorrection=Math.max(maxFloorCorrection,correction);
      if(name==='Attack'){const reach=Math.max(...attackSurface.map(point=>weightedPoint(point.meshNode,point.primitive,point.index).z));if(reach>attackReach+1e-8){attackReach=reach;attackContactNormalized=phase;}}
      for(const track of tracks){track.t.push(...track.node.getTranslation());track.r.push(...track.node.getRotation());}
    }
    for(const track of tracks){addChannel(doc,clip,track.node,'translation',times,track.t);addChannel(doc,clip,track.node,'rotation',times,track.r);}
    (provenance.clips as unknown[]).push({name,seconds,solverTargetError:maxError,maxFloorCorrection});
    provenance.solverTargetError=Math.max(provenance.solverTargetError as number,maxError);
  }
  restorePose(rest);
  provenance.attackContactNormalized=attackContactNormalized;
  provenance.contactBasis='First maximum forward skinned vertex of the weighted head or mandible surface over 65 phases';
  provenance.attackingSurfaceVertices=attackSurface.length;
  return {changes:['Replaced all six states with a flexed neutral stance, planted alternating-tripod walk/run, supported attacks/hits, and articulated death without body scaling'],
    provenance,
    motion:{walkClipSeconds:walkSeconds,runClipSeconds:runSeconds,impliedWalkMps:stride/(walkSeconds*.68),impliedRunMps:runStride/(runSeconds*.60),attackSeconds:.94,contactNormalized:attackContactNormalized,groundY:0}};
}

export const profile: CreatureRepairProfile = {
  id:'arthropods',assetIds,
  async repair(doc,{assetId}) {
    const names = doc.getRoot().listSkins()[0]!.listJoints().map(n=>n.getName());
    if(names.includes('VaultweaverRoot')) return repairSixLegMotion(doc,true);
    if(names.includes('FlintRoot')||names.includes('ScarabRoot')) return repairSixLegMotion(doc,false);
    if(assetId==='creature_reed_strider')return repairStrider(doc);
    if(assetId==='animal_crab'||assetId==='creature_rift_carapace')return repairCrustacean(doc,assetId==='animal_crab');
    if(names.includes('DelverRoot'))return repairCrustacean(doc,false,true);
    if(assetId==='creature_antler_beetle'||assetId==='creature_slag_centipede') return {changes:[],provenance:{decision:'Retain existing articulated IK contacts and rigid sculpted segment weights; CPU edge lengths remain constant in every state. Requires devdocs visual verdict.'}};
    return {changes:[],warnings:['Anatomical rebuild pending devdocs source-pose evidence.']};
  },
};
