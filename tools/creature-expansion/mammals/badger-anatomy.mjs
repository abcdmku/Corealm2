import * as THREE from 'three';

/** Eurasian badger authoring reference, interpreted at the existing game scale.
 * https://animaldiversity.org/accounts/Meles_meles/
 * https://www.woodlandtrust.org.uk/trees-woods-and-wildlife/animals/mammals/badger/
 * Stocky trunk, short robust limbs, short tail, grizzled dorsal coat, dark
 * underside and nose-to-eye-to-ear stripes. Ratios below are authored, not
 * measurements from photographs. No external meshes or textures are embedded.
 */
export const BADGER_ANATOMY = Object.freeze({
  resolution:144,
  // Lower oblong cross sections taper down the sacrum over several stations.
  // The old tall rump ended almost vertically, like a capped cylinder.
  torso:[
    [-.707,.352,.003,.009],[-.664,.368,.078,.092],
    [-.590,.374,.174,.170],[-.480,.379,.240,.211],
    [-.350,.376,.262,.225],[-.205,.371,.250,.223],
    [-.050,.360,.238,.217],[.110,.350,.230,.208],
    [.240,.350,.221,.201],[.350,.357,.189,.182],
    [.435,.367,.163,.149],[.490,.370,.117,.112],
    [.550,.368,.055,.068],[.575,.365,.003,.010],
  ],
  skull:[
    [.400,.360,.005,.010],[.449,.374,.107,.107],
    [.510,.379,.144,.120],[.566,.374,.144,.117],
    [.622,.361,.128,.107],[.672,.347,.112,.088],
    [.716,.329,.096,.066],[.766,.306,.070,.044],
    [.818,.289,.047,.032],[.857,.283,.029,.025],
    [.880,.282,.002,.006],
  ],
  eyes:[.106,.376,.659],eyeScale:[.017,.016,.015],
  nose:[0,.287,.862],noseScale:[.039,.029,.024],
  // The ear bone roots remain unchanged. Only shell dimensions change.
  earLength:.052,earWidth:.086,earShellThickness:.005,
  tailR:[.058,.042,.003],
});

export function badgerAnatomyConfig(base){
  if(base.kind!=='badger')throw new Error('badgerAnatomyConfig requires badger');
  return {...base,
    body:[...BADGER_ANATOMY.torso.filter(row=>row[0]<.400),...BADGER_ANATOMY.skull].map(row=>[...row]),
    eyes:[...BADGER_ANATOMY.eyes],eyeScale:[...BADGER_ANATOMY.eyeScale],
    nose:[...BADGER_ANATOMY.nose],noseScale:[...BADGER_ANATOMY.noseScale],
    ears:{...base.ears,root:[...base.ears.root],length:BADGER_ANATOMY.earLength,width:BADGER_ANATOMY.earWidth},
    tailR:[...BADGER_ANATOMY.tailR],
  };
}

export function badgerPawDesign(s,leg){
  return {height:s.pawY*.75,halfWidth:s.pawWidth*(leg.front?.66:.59),
    halfLength:s.pawLength*.43,forward:.017,toeCount:5,
    toeForward:s.pawLength*.42,toeLength:s.pawLength*.12};
}

/** Elliptic crown has a vertical tangent at its apex, unlike the old cone. */
export function badgerEarWidth(s,t){
  return s.ears.width*.5*Math.sqrt(Math.max(0,1-t*t));
}

export function badgerEarColour(u,t,back){
  const rim=Math.max(smooth(.76,.97,Math.abs(u)),smooth(.83,.98,t));
  return new THREE.Color(back?'#454741':'#343632').lerp(new THREE.Color('#c9cabc'),rim*.88);
}

/** Existing profile/capsule/ell descriptors; no sampler contract change.
 * Replace the generic torso and leg fields as a unit. Add existing ears, face,
 * tail and claws afterwards. Separate toe ellipsoids must be suppressed.
 */
export function buildBadgerFields({s,r,bodyWeights}){
  if(s.kind!=='badger')throw new Error('buildBadgerFields requires badger');
  const shapes=[],w=name=>[[r.index(name),1]];
  const profile=(rows,weights,blend)=>shapes.push({type:'profile',rows:rows.map(row=>[...row]),weights,blend,leg:false});
  const capsule=(a,b,r0,r1,weights,blend=.011)=>{
    const direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    if(direction.lengthSq()<1e-10)throw new Error('Zero-length badger field');
    const shape={type:'capsule',a:[...a],b:[...b],direction,lengthSq:direction.lengthSq(),r0,r1,weights,blend,leg:true};
    shapes.push(shape);return shape;
  };
  profile(BADGER_ANATOMY.torso,p=>bodyWeights(r,s,p[2]),.024);
  profile(BADGER_ANATOMY.skull,w('Head'),.019);
  for(const leg of r.legs){
    const {name,front,hip,knee,hock,paw}=leg,origin=hip.clone();
    origin.x*=.59;origin.y+=.020;
    // Shoulder/thigh transitions remain inside the coat. A single taper
    // replaces the ball shoulder, spherical knee and pinched ankle stack.
    capsule(origin.toArray(),knee.toArray(),front?.092:.104,front?.052:.054,
      [[r.index(front?'Chest':'Pelvis'),.25],[r.index(name+'_Upper'),.75]],.025);
    capsule(knee.toArray(),hock.toArray(),front?.052:.050,.037,w(name+'_Lower'),.011);
    capsule(hock.toArray(),paw.toArray(),.037,.037,w(name+'_Ankle'),.008);
    const pad=badgerPawDesign(s,leg);
    shapes.push({type:'ell',centre:[paw.x,pad.height,paw.z+pad.forward],
      scale:[pad.halfWidth,pad.height,pad.halfLength],inv:new THREE.Quaternion(),
      weights:w(name+'_Paw'),blend:.009,leg:true,paw:true,toeGrooves:true,
      toeGrooveOffsets:[-.031,-.010,.010,.031],toeGrooveDepth:.0025});
    const instep=capsule([paw.x,paw.y+.018,paw.z-.008],
      [paw.x,pad.height+.009,paw.z+.009],.034,.039,
      [[r.index(name+'_Ankle'),.22],[r.index(name+'_Paw'),.78]],.008);
    instep.paw=true;
  }
  return shapes;
}

const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const hash=(x,y,z)=>{const q=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453123;return q-Math.floor(q);};
const grey=new THREE.Color('#85847b'),black=new THREE.Color('#252724'),white=new THREE.Color('#d8d7c6');

/** Species colour callback. Replaces the generic periodic woodgrain path.
 * Staggered coarse/fine guard-hair cells avoid parallel stripes across ribs.
 * Vertex colour remains a base coat; this is not a fur texture replacement.
 */
export function badgerCoat(s,p,theta=0,part='body'){
  const broad=hash(Math.floor(p.x*81),Math.floor(p.y*77),Math.floor(p.z*43));
  const fine=hash(Math.floor(p.x*217),Math.floor(p.y*199),Math.floor(p.z*107));
  const col=grey.clone().multiplyScalar(.86+.22*broad+.12*fine);
  const underside=1-smooth(.18,.37,p.y);
  col.lerp(black,underside*.94);
  if(part==='leg')return col.lerp(black,1-smooth(.18,.36,p.y));
  const face=smooth(.417,.505,p.z);
  if(face>0){
    const head=white.clone().multiplyScalar(.96+.055*fine);
    const axis=THREE.MathUtils.lerp(.128,.025,clamp((p.z-.50)/.365,0,1));
    const half=THREE.MathUtils.lerp(.041,.018,clamp((p.z-.54)/.32,0,1));
    const stripe=(1-smooth(half,half+.009,Math.abs(Math.abs(p.x)-axis)))*smooth(.27,.31,p.y);
    head.lerp(black,stripe*.98);col.lerp(head,face);
  }
  return col;
}

export const BADGER_INTEGRATION=Object.freeze([
  'mammals.mjs: import badgerAnatomyConfig, badgerPawDesign, badgerCoat and BADGER_ANATOMY. Apply badgerAnatomyConfig to SHAPES[id] before addRig. No leg, head, jaw, ear-root or tail pivot changes.',
  'mammals.mjs: dispatch badgerPawDesign at the start of pawDesign and badgerCoat at the start of coat. Preserve the current paw sole flattening and all gait curves.',
  'implicit.mjs: dispatch buildBadgerFields({s,r,bodyWeights}) instead of the complete generic torso/head/leg field block for badger. Use BADGER_ANATOMY.resolution. Existing field sampler is sufficient.',
  'implicit.mjs: share the fox toe groove extension: offsets=f.toeGrooveOffsets??[-.038,0,.038], depth=f.toeGrooveDepth??.004. This gives five subtle divisions within each unified badger paw.',
  'mammals.mjs pawsAndClaws: suppress only the badger toe ellipsoid call; retain all five claws, positions derived from badgerPawDesign. Their existing front length .058 and rear length .025 remain. Do not continue the entire loop as Lynx does.',
  'mammals.mjs ears: import badgerEarWidth and badgerEarColour. Use badgerEarWidth(s,t) in the width expression, badgerEarColour(u,t,back) for colour, and replace the shell z offset with back?-.005:.002 for badger. Join front/back shell edge quads as for fox/lynx. Keep its bone roots and generic earPoint transform.',
  'Root: run whole-skinned-vertex eight-clip audit before export. Inspect hardware front, side, rear, gameplay and run images plus natural lifecycle. This isolated CPU module has no visual acceptance.',
]);
