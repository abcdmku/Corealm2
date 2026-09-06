import * as THREE from 'three';

/** Crested porcupine silhouette study. Authored proportions, not measurements.
 * https://animaldiversity.org/accounts/Hystrix_cristata/
 * ADW describes a crest on the head/nape/back, stout defensive quills on the
 * flanks and rump, and a short tail with rattle quills. No imported artwork.
 * Existing front/side/rear/gameplay/run captures were inspected before authoring.
 */
export const PORCUPINE_ANATOMY = Object.freeze({
  resolution:144,
  torso:[
    [-.609,.380,.004,.009],[-.566,.411,.110,.158],
    [-.477,.444,.220,.250],[-.369,.452,.260,.277],
    [-.231,.442,.261,.273],[-.090,.420,.244,.257],
    [.047,.386,.213,.226],[.166,.355,.182,.202],
    [.271,.334,.153,.176],[.351,.317,.124,.142],
    [.420,.306,.078,.092],[.459,.307,.004,.008],
  ],
  skull:[
    [.323,.309,.006,.011],[.372,.309,.092,.101],
    [.435,.306,.122,.109],[.489,.298,.121,.098],
    [.549,.284,.108,.081],[.602,.270,.085,.061],
    [.660,.259,.062,.048],[.711,.253,.043,.034],
    [.750,.254,.027,.023],[.772,.254,.004,.008],
  ],
  eyes:[.087,.304,.589],eyeScale:[.016,.017,.012],
  earLength:.047,earWidth:.067,
  tailR:[.058,.023,.001,.0003],
  counts:{guard:300,defensive:230,crest:44,rattle:28},
});

const vector=a=>new THREE.Vector3(...a);
const hash=(i,salt=0)=>{const x=Math.sin(i*127.1+salt*311.7+19.19)*43758.5453123;return x-Math.floor(x);};
const lerp=THREE.MathUtils.lerp;

export function porcupineAnatomyConfig(base){
  if(base.kind!=='porc')throw new Error('Porcupine config required');
  // This combined profile supports coat coordinates and quill roots. The field
  // builder below uses overlapping independent trunk and skull profiles.
  return {...base,body:[...PORCUPINE_ANATOMY.torso.filter(row=>row[0]<.323),...PORCUPINE_ANATOMY.skull].map(row=>[...row]),
    eyes:[...PORCUPINE_ANATOMY.eyes],eyeScale:[...PORCUPINE_ANATOMY.eyeScale],
    ears:{...base.ears,root:[...base.ears.root],length:PORCUPINE_ANATOMY.earLength,width:PORCUPINE_ANATOMY.earWidth},
    tailR:[...PORCUPINE_ANATOMY.tailR]};
}

export function porcupinePawDesign(s,leg){
  return {height:s.pawY*.65,halfWidth:s.pawWidth*(leg.front?.53:.58),
    halfLength:s.pawLength*.43,forward:.014,toeCount:leg.front?4:5,
    toeForward:s.pawLength*.45,toeLength:s.pawLength*.13};
}

/** Sampler-compatible fields. Replaces all generic torso, skull and legs. */
export function buildPorcupineFields({s,r,bodyWeights}){
  if(s.kind!=='porc')throw new Error('Porcupine config required');
  const shapes=[];
  const skin=name=>[[r.index(name),1]];
  const capsule=(a,b,r0,r1,weights,blend=.008)=>{
    const direction=vector(b).sub(vector(a));
    if(direction.lengthSq()<1e-10)throw new Error('Zero-length porcupine field');
    const field={type:'capsule',a,b,r0,r1,direction,lengthSq:direction.lengthSq(),weights,blend,leg:true};
    shapes.push(field);return field;
  };
  shapes.push({type:'profile',rows:PORCUPINE_ANATOMY.torso.map(row=>[...row]),blend:.021,weights:p=>bodyWeights(r,s,p[2]),leg:false});
  shapes.push({type:'profile',rows:PORCUPINE_ANATOMY.skull.map(row=>[...row]),blend:.016,weights:skin('Head'),leg:false});
  for(const leg of r.legs){
    const {name,front,hip,knee,hock,paw}=leg,start=hip.clone();start.x*=.58;start.y+=.018;
    // Shoulder and thigh emerge from the trunk in one taper. No joint spheres.
    capsule(start.toArray(),knee.toArray(),front?.048:.066,.027,
      [[r.index(front?'Chest':'Pelvis'),.25],[r.index(name+'_Upper'),.75]],.019);
    capsule(knee.toArray(),hock.toArray(),.027,.020,skin(name+'_Lower'),.007);
    capsule(hock.toArray(),paw.toArray(),.020,.023,skin(name+'_Ankle'),.006);
    const pad=porcupinePawDesign(s,leg);
    shapes.push({type:'ell',centre:[paw.x,pad.height,paw.z+pad.forward],scale:[pad.halfWidth,pad.height,pad.halfLength],
      inv:new THREE.Quaternion(),blend:.007,weights:skin(name+'_Paw'),leg:true,paw:true,
      toeGrooves:true,toeGrooveOffsets:Array.from({length:pad.toeCount-1},(_,i)=>(i-(pad.toeCount-2)/2)*.018),toeGrooveDepth:.0025});
    capsule([paw.x,paw.y+.007,paw.z-.009],[paw.x,pad.height+.006,paw.z+.012],.022,.025,
      [[r.index(name+'_Ankle'),.20],[r.index(name+'_Paw'),.80]],.006).paw=true;
  }
  return shapes;
}

/** Deterministic descriptors make placement inspectable without a browser.
 * profileAt must be the production interpolation function. Body quills root
 * below the authored skin. Separate lengths and directions break uniform rows.
 */
export function porcupineQuillLayout(s,profileAt){
  if(s.kind!=='porc')throw new Error('Porcupine config required');
  const result=[];
  const surface=(z,a)=>{const rows=z<.33?PORCUPINE_ANATOMY.torso:PORCUPINE_ANATOMY.skull,q=profileAt(rows,z);return vector([Math.sin(a)*(q[2]-.003),q[1]+Math.cos(a)*(q[3]-.003),z]);};
  function bodyLayer(count,kind){
    for(let i=0;i<count;i++){
      const salt=kind==='guard'?7:17,u=hash(i,salt),v=hash(i,salt+1);
      const z=lerp(kind==='guard'?-.548:-.54,kind==='guard'?.355:.242,u);
      const a=lerp(-1.72,1.72,v),root=surface(z,a);
      const rear=THREE.MathUtils.clamp((.25-z)/.80,0,1);
      const length=kind==='guard'?lerp(.042,.105,hash(i,salt+2)):lerp(.155,.330,rear)*lerp(.78,1.18,hash(i,salt+2));
      const direction=vector([Math.sin(a)*lerp(.50,.78,hash(i,salt+3)),Math.cos(a)*(kind==='guard'?.24:.41)+.06,-1]).normalize();
      const tip=root.clone().addScaledVector(direction,length);
      result.push({kind,root:root.toArray(),points:[root.toArray(),root.clone().lerp(tip,.51).add(vector([0,kind==='guard'?.005:.011,0])).toArray(),tip.toArray()],
        radii:kind==='guard'?[.0022,.0016,.00018]:[lerp(.0040,.0062,rear),.0035,.00022],z,phase:hash(i,salt+4),rings:kind==='guard'?3:7,sides:kind==='guard'?4:5});
    }
  }
  bodyLayer(PORCUPINE_ANATOMY.counts.guard,'guard');
  bodyLayer(PORCUPINE_ANATOMY.counts.defensive,'defensive');
  for(let i=0;i<PORCUPINE_ANATOMY.counts.crest;i++){
    const z=lerp(.09,.445,hash(i,30)),a=lerp(-.49,.49,hash(i,31)),root=surface(z,a);
    const length=lerp(.10,.23,hash(i,32)),tip=root.clone().add(vector([Math.sin(a)*.065,length*.77,-length*.74]));
    result.push({kind:'crest',root:root.toArray(),points:[root.toArray(),root.clone().lerp(tip,.52).toArray(),tip.toArray()],
      radii:[.0027,.0017,.00016],z,phase:hash(i,33),rings:4,sides:4});
  }
  return result;
}

/** Replace quills(), do not layer this over the old grid. palette is C.porc. */
export function emitPorcupineQuills({s,r,out,tube,profileAt,bodyWeights,palette}){
  const layout=porcupineQuillLayout(s,profileAt);
  for(const q of layout){
    const weights=bodyWeights(r,s,q.z);
    tube(out,q.points.map(vector),q.radii,()=>weights,(_p,t)=>{
      if(q.kind==='guard')return palette[1].clone().lerp(palette[2],.18+q.phase*.22);
      if(q.kind==='crest')return palette[1].clone().lerp(palette[3],t>.76?.65:.15);
      const band=Math.floor(t*5.3+q.phase*.70)%2;
      return band?palette[3].clone().multiplyScalar(.78+q.phase*.15):palette[1];
    },{rings:q.rings,sides:q.sides});
  }
  return {guard:300,defensive:230,crest:44,total:layout.length};
}

/** Short skin-covered stump and short terminal quills. Tail bone names/rest
 * transforms stay intact. Tail_3 and Tail_4 remain valid animation channels but
 * carry no geometry. The old long cone must not also be emitted.
 */
export function emitPorcupineTail({s,r,out,tube,palette}){
  const start=vector(s.tail[0]),end=vector(s.tail[1]);
  const weights=t=>[[r.index('Tail_1'),1-t],[r.index('Tail_2'),t]];
  tube(out,[start,start.clone().lerp(end,.6),end],[.058,.041,.008],weights,palette[1],{rings:10,sides:12});
  for(let i=0;i<PORCUPINE_ANATOMY.counts.rattle;i++){
    const t=lerp(.25,.93,hash(i,50)),angle=i*2.3999632297;
    const root=start.clone().lerp(end,t).add(vector([Math.sin(angle)*.025,Math.cos(angle)*.022,0]));
    const tip=root.clone().add(vector([Math.sin(angle)*.018,Math.cos(angle)*.018,-lerp(.04,.083,hash(i,51))]));
    tube(out,[root,root.clone().lerp(tip,.6),tip],[.003,.004,.001],()=>weights(t),palette[3].clone().multiplyScalar(.66),{rings:4,sides:5});
  }
}

export const PORCUPINE_INTEGRATION=Object.freeze([
  'mammals.mjs buildSpecies: apply porcupineAnatomyConfig(base) for kind porc before addRig. No core rig pivot or gait changes.',
  'mammals.mjs pawDesign: dispatch porcupinePawDesign. pawsAndClaws: suppress porc toe ellipsoids but retain the existing short claws at the unified foot front. Use the new design toeLength and toeForward.',
  'implicit.mjs: use buildPorcupineFields({s,r,bodyWeights}) instead of generic torso/head/leg fields for porc. Use PORCUPINE_ANATOMY.resolution. Preserve sampler, skinning, smoothing and sole flattening.',
  'implicit.mjs toeGrooves: read f.toeGrooveOffsets ?? [-.038,0,.038] and f.toeGrooveDepth ?? .004. Default behavior for other species remains unchanged.',
  'mammals.mjs: dispatch emitPorcupineQuills({s,r,out,tube,profileAt,bodyWeights,palette:C.porc}) and emitPorcupineTail({s,r,out,tube,palette:C.porc}) instead of old porc quills and tail. Keep tube and Surface production implementations.',
  'Tail_3 and Tail_4 have no drawn vertices with the short tail helper. All rest pivots and clip tracks are preserved. New paw surfaces rest at y=0 through existing sole flattening; all eight clips need whole-vertex audit after integration.',
  'No export, browser or visual acceptance performed here. Parent must review front/side/rear/gameplay/run in hardware Chromium plus natural lifecycle before promotion.',
]);
