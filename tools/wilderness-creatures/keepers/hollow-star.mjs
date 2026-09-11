import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Original six-limb skeleton and weighted hollow shell. No source body is used. */
export async function buildHollowStar(h){
 const {Document,T,V,loft,tube,plate,roughen,materialSet,addSkinGeometry,measureGround,finish}=h;
 const c={id:'hollow_star',deep:true,hover:true,factor:1,tempo:1,contact:.67,
  design:'A six-limbed creature folded around an empty centre. Split obsidian ribs rise into a broken crown and descend into hooked limbs. A narrow blue-violet interior remains behind the physical hole; there is no animal head or human torso.',
  motion:'An original articulated six-limb suspension rig. The arms unfold in opposing phases, fan back during the telegraph, converge forward at contact and slowly refold. Death folds all six limbs inward and pitches the empty body onto the ground.'};
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('Hollow Star'),root=doc.createNode('hollow_root'),body=doc.createNode('hollow_thorax').setTranslation([0,2.6,0]);scene.addChild(root);root.addChild(body);
 const joints=[root,body],limbs=[];
 for(let i=0;i<6;i++){
  const sign=i%2===0?-1:1,row=Math.floor(i/2),y=3.23-row*.63,z=row===1?.11:-.16,shoulder=V(sign*.59,y,z),elbow=V(sign*(row===1?1.48:1.38),y+(row===0?.60:row===2?-.52:.08),row===1?.35:.04),wrist=V(sign*(row===1?2.05:1.59),y+(row===0?.92:row===2?-1.13:-.31),row===1?.85:.50),tip=V(sign*(row===1?1.84:1.36),wrist.y-.33,wrist.z+.51);
  const upper=doc.createNode(`hollow_arm_${i}`).setTranslation(shoulder.clone().sub(V(0,2.6,0)).toArray()),lower=doc.createNode(`hollow_forearm_${i}`).setTranslation(elbow.clone().sub(shoulder).toArray()),hand=doc.createNode(`hollow_hook_${i}`).setTranslation(wrist.clone().sub(elbow).toArray());body.addChild(upper);upper.addChild(lower);lower.addChild(hand);joints.push(upper,lower,hand);limbs.push({i,sign,row,upper,lower,hand,shoulder,elbow,wrist,tip});
 }
 const skin=doc.createSkin('hollow_star_original_six_limb_rig');for(const j of joints)skin.addJoint(j);skin.setSkeleton(root).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(Float32Array.from(joints.flatMap(j=>new T.Matrix4().fromArray(j.getWorldMatrix()).invert().toArray()))).setBuffer(buffer));
 const mats=await materialSet(doc,c),parts=[];
 const add=(name,g,m,j)=>{parts.push(name);return addSkinGeometry(doc,skin,`hollow_star_${name}`,g,m,typeof j==='function'?j:[[j,1]]);};
 const ell=(p,r)=>{const g=new T.IcosahedronGeometry(1,2);g.scale(...r);g.translate(...p);return roughen(g,.011);};
 // Its segmented barrel is physically empty. Six bent structural ribs leave long sightlines through it.
 for(let i=0;i<8;i++){const a=i/8*Math.PI*2,x=Math.cos(a),z=Math.sin(a),points=[[x*.27,1.75,z*.23],[x*.68,2.10,z*.53],[x*.83,2.72,z*.65],[x*.72,3.30,z*.54],[x*.35,3.69,z*.25]];
  // Front centre pair split apart instead of closing into a familiar rib cage.
  add(`empty_thorax_rib_${i}`,tube(points,.115+(i%3)*.018,25,9),i%3===0?mats.ash:mats.stone,body);
  if(i===1||i===4||i===6)add(`inner_blue_fissure_${i}`,tube(points.map(p=>[p[0]*.89,p[1],p[2]*.88]),.021,24,6),mats.core,body);
 }
 for(const sign of [-1,1]){add(`crown_fracture_${sign}`,tube([[sign*.28,3.5,-.14],[sign*.48,3.86,-.21],[sign*.42,4.20,-.36],[sign*.16,4.46,-.47]],.13,22,8),mats.stone,body);add(`lower_sternal_hook_${sign}`,tube([[sign*.30,1.9,-.18],[sign*.46,1.62,-.18],[sign*.29,1.40,.05],[sign*.10,1.47,.21]],.095,16,8),mats.ash,body);}
 add('distant_inner_void',ell([0,2.7,-.40],[.30,.47,.12]),mats.dark,body);
 add('narrow_inner_light',loft([[2.34,.027,.017,0,-.27],[2.56,.065,.032,.02,-.28],[2.89,.026,.025,-.02,-.29],[3.09,.012,.01,0,-.31]],12),mats.core,body);
 for(const l of limbs){const {i,sign,row,upper,lower,hand,shoulder,elbow,wrist,tip}=l;
  add(`upper_bone_${i}`,tube([shoulder,shoulder.clone().lerp(elbow,.35).add(V(0,.045,-.045)),elbow],.17-(row===2?.015:0),16,9),mats.stone,upper);
  add(`elbow_socket_${i}`,ell(elbow.toArray(),[.225,.235,.215]),mats.iron,lower);
  add(`curved_forearm_${i}`,tube([elbow,elbow.clone().lerp(wrist,.45).add(V(sign*.07,.035,-.08)),wrist],.19,18,10),mats.stone,lower);
  add(`forearm_dorsal_split_${i}`,tube([elbow.clone().add(V(0,0,.14)),elbow.clone().lerp(wrist,.5).add(V(sign*.04,0,.15)),wrist.clone().add(V(0,0,.12))],.022,16,6),mats.core,lower);
  for(let k=0;k<3;k++){const offset=V(sign*(k-1)*.06,.035*(k-1),(k-1)*.13),a=wrist.clone().add(offset),b=tip.clone().add(offset),d=b.clone().add(V(-sign*.17,-.15,-.045));add(`terminal_hook_${i}_${k}`,tube([a,a.clone().lerp(b,.53).add(V(sign*.08,.10,0)),b,d],.070-k*.008,17,8),k===1?mats.ash:mats.stone,hand);}
  // Continuous tapered underside joins both arm bones with a two-joint weight blend.
  const p=[],idx=[];for(let k=0;k<=12;k++){const t=k/12,centre=shoulder.clone().lerp(wrist,t),width=Math.sin(t*Math.PI)*.075;for(const s of [-1,1])p.push(centre.x,centre.y-width*s,centre.z-.09);}for(let k=0;k<12;k++){const a=k*2;if(k>0)idx.push(a,a+1,a+2);if(k<11)idx.push(a+1,a+3,a+2);}const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();add(`weighted_tendon_${i}`,g,mats.dark,q=>{const t=T.MathUtils.clamp(q.distanceTo(shoulder)/shoulder.distanceTo(wrist),0,1),weight=T.MathUtils.smoothstep(t,.32,.76);return [[upper,1-weight],[lower,weight]];});
 }
 const clips=[['Idle',3.8],['Walk',2.7],['Run',1.9],['Attack',2.95],['Hit',.62],['HitLeft',.7],['HitRight',.7],['Death',3.1]];
 const smooth=t=>t*t*(3-2*t),bell=(t,a,b,d)=>t<a?0:t<b?smooth((t-a)/(b-a)):t<d?1-smooth((t-b)/(d-b)):0;
 for(const [name,duration]of clips){const a=doc.createAnimation(name),count=Math.ceil(duration*60)+1,times=Float32Array.from({length:count},(_,i)=>i/(count-1)*duration),death=name==='Death',attack=name==='Attack',hit=name.startsWith('Hit'),move=name==='Walk'||name==='Run';
  const channel=(node,path,fn)=>{const values=[],type=path==='rotation'?'VEC4':'VEC3';for(let i=0;i<count;i++)values.push(...fn(i/(count-1)));const s=doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer)).setOutput(doc.createAccessor().setType(type).setArray(Float32Array.from(values)).setBuffer(buffer));a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s));};
  channel(body,'rotation',t=>{let x=.035*Math.sin(t*Math.PI*2),y=.04*Math.sin(t*Math.PI*2),z=0;if(attack){x=-.22*bell(t,.04,.42,.64)+.37*bell(t,.56,.67,.98);y=.08*Math.sin(t*Math.PI*2);}if(hit){x=-.22*Math.sin(t*Math.PI);z=(name==='HitLeft'?1:name==='HitRight'?-1:0)*.18*Math.sin(t*Math.PI);}if(death){x=1.2*smooth(Math.min(1,t/.77));z=.22*smooth(t);}return new T.Quaternion().setFromEuler(new T.Euler(x,y,z)).toArray();});
  channel(body,'translation',t=>[0,2.6+(death?-1.65*smooth(t):attack?-.24*bell(t,.53,.68,.95):.035*Math.sin(t*Math.PI*2)),attack?.30*bell(t,.45,.67,.95):0]);
  for(const l of limbs){const {i,sign,row,upper,lower,hand}=l;channel(upper,'rotation',t=>{const w=Math.sin(t*Math.PI*2+i*Math.PI/3);let x=(move?.14:.06)*w,y=sign*.07*w,z=sign*.055*Math.sin(t*Math.PI*2+i*.7);if(attack){x=-.48*bell(t,.06,.42,.64)+.62*bell(t,.55,.67,.97);z=sign*(.29*bell(t,.02,.39,.62)-.36*bell(t,.56,.67,.98));y=-sign*.27*bell(t,.54,.67,.97);}if(hit)z+=sign*.13*Math.sin(t*Math.PI);if(death){x=.50*smooth(t);z=-sign*(row===0?.65:.38)*smooth(t);}return new T.Quaternion().setFromEuler(new T.Euler(x,y,z)).toArray();});
   channel(lower,'rotation',t=>{let x=.10*Math.sin(t*Math.PI*2+i*.65),z=sign*.05*Math.sin(t*Math.PI*2+i*.7);if(attack){x=.36*bell(t,.15,.46,.66)-.62*bell(t,.58,.69,1);z=-sign*.11*bell(t,.54,.69,1);}if(death){x=.86*smooth(t);z=sign*.24*smooth(t);}return new T.Quaternion().setFromEuler(new T.Euler(x,0,z)).toArray();});
   channel(hand,'rotation',t=>{const x=attack?.33*bell(t,.20,.47,.68)-.42*bell(t,.61,.70,.99):death?.9*smooth(t):.035*Math.sin(t*Math.PI*2+i);return new T.Quaternion().setFromEuler(new T.Euler(x,0,0)).toArray();});
  }
 }
 const measurements=await measureGround(doc,c),digest=createHash('sha256').update(await readFile('tools/wilderness-creatures/keepers/hollow-star.mjs')).digest('hex'),parent={id:'corealm_original_hollow_star',pack:'corealm-original-wilderness-keepers',category:'character',sha256:digest,sourceProvenance:{author:'Corealm project',license:'LicenseRef-Corealm-Original',sourceAssets:[],sourceFiles:[{file:'tools/wilderness-creatures/keepers/hollow-star.mjs',sha256:digest}],modifications:'Original hand-authored six-limb body, weighted tendons, skeleton and all eight motion clips'}};
 const result=await finish(doc,c,parent,{addedBodyParts:parts,sourceMeshesRetained:0,sourceTriangles:0,measurements,rig:'Original twenty-joint six-limb skeleton, continuous weighted arm tendons'});return {...result,pack:{id:'corealm-original-wilderness-keepers',name:'Corealm original Wilderness keeper anatomy',author:'Corealm project',source:'tools/wilderness-creatures/keepers/hollow-star.mjs',license:'LicenseRef-Corealm-Original',generatorSha256:digest}};
}
