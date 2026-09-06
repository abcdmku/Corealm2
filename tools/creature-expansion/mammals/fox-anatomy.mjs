import * as THREE from 'three';

/** Isolated red fox candidate. Not registered in production until lab review.
 * Authoring references, used for silhouette rather than literal dimensions:
 * https://www.nps.gov/yose/learn/nature/redfox-biology.htm
 * https://animaldiversity.org/accounts/Vulpes/
 * https://www.nps.gov/gate/red-fox.htm
 * NPS describes slender trunk/limbs, narrow muzzle, large ears and flowing brush.
 * ADW describes the flattened skull. No external geometry or textures are used.
 */
export const FOX_ANATOMY = Object.freeze({
  resolution: 144,
  // Explicit loin tuck and continuous descending sacrum replace the round
  // rump termination. The shoulder supports a narrow, deeper rib cage.
  torso: [
    [-.660,.608,.003,.007],[-.600,.624,.057,.078],
    [-.525,.642,.112,.135],[-.420,.654,.140,.154],
    [-.310,.667,.132,.132],[-.205,.674,.116,.115],
    [-.075,.660,.123,.138],[.065,.647,.141,.172],
    [.215,.650,.150,.199],[.330,.677,.132,.199],
    [.430,.719,.112,.167],[.510,.754,.077,.117],
    [.562,.774,.030,.060],[.584,.780,.003,.009],
  ],
  // One axial profile runs through occiput, orbit and the nasal bridge.
  // There is no separate round cranium perched on a conical snout.
  skull: [
    [.527,.802,.003,.010],[.565,.815,.067,.073],
    [.625,.834,.113,.100],[.694,.842,.128,.103],
    [.748,.830,.119,.086],[.801,.810,.097,.061],
    [.852,.791,.073,.043],[.909,.782,.053,.031],
    [.969,.776,.035,.022],[1.035,.774,.021,.016],
    [1.052,.774,.003,.005],
  ],
  eyes: [.087,.849,.789],
  eyeScale: [.025,.022,.014],
  ears: {root:[.095,.916,.66],length:.128,width:.145,lean:-.025,inward:.014},
  // Preserve every existing tail pivot. Sink the smaller root into the sacrum,
  // then expand into the brush progressively, rather than attaching a plug.
  tailR: [.056,.092,.126,.084,.001],
  earShellThickness: .007,
  earRimRadius: .0035,
});

/** Return a fresh config; never mutate the shared source or frozen contracts. */
export function foxAnatomyConfig(base) {
  if(base.kind!=='fox')throw new Error('foxAnatomyConfig requires a fox config');
  return {...base,
    body:[...FOX_ANATOMY.torso.filter(row=>row[0]<.527),...FOX_ANATOMY.skull].map(row=>[...row]),
    eyes:[...FOX_ANATOMY.eyes],eyeScale:[...FOX_ANATOMY.eyeScale],
    ears:{...FOX_ANATOMY.ears,root:[...FOX_ANATOMY.ears.root]},
    tailR:[...FOX_ANATOMY.tailR],
  };
}

/** Same keys as mammals.mjs pawDesign. Existing paw pivots and sole y=0 remain. */
export function foxPawDesign(s,leg) {
  if(s.kind!=='fox')throw new Error('foxPawDesign requires a fox config');
  return {
    height:s.pawY*.63,
    halfWidth:s.pawWidth*(leg.front?.60:.56),
    halfLength:s.pawLength*.47,
    forward:.016,
    toeCount:4,
    toeForward:s.pawLength*.43,
    toeLength:s.pawLength*.12,
  };
}

/**
 * Return descriptors consumed directly by joinedMammal's existing sampler.
 * Required context: s config, r rig with index()/legs, bodyWeights(r,s,z).
 * Only existing profile, ell and capsule types are emitted. This owns torso,
 * skull, integrated legs and paws. Do not additionally emit the generic ones.
 * Eyes, ears, jaw, claws and the flowing tail remain in mammals.mjs.
 */
export function buildFoxFields({s,r,bodyWeights}) {
  if(s.kind!=='fox')throw new Error('buildFoxFields requires a fox config');
  const shapes=[];
  const weights=name=>[[r.index(name),1]];
  const profile=(rows,skin,blend)=>shapes.push({type:'profile',rows:rows.map(row=>[...row]),weights:skin,blend,leg:false});
  const capsule=(a,b,r0,r1,skin,blend=.008)=>{
    const direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    if(direction.lengthSq()<1e-10)throw new Error('Zero-length fox limb field');
    const field={type:'capsule',a:[...a],b:[...b],r0,r1,direction,lengthSq:direction.lengthSq(),weights:skin,blend,leg:true};
    shapes.push(field);return field;
  };
  const ell=(centre,scale,skin,blend=.008)=>{
    const field={type:'ell',centre,scale,inv:new THREE.Quaternion(),weights:skin,blend,leg:true};
    shapes.push(field);return field;
  };
  profile(FOX_ANATOMY.torso,p=>bodyWeights(r,s,p[2]),.025);
  profile(FOX_ANATOMY.skull,weights('Head'),.015);

  // A sloping neck is a short bridge to the skull, with no cheek balls.
  capsule([0,.748,.452],[0,.805,.604],.095,.078,
    [[r.index('Chest'),.12],[r.index('Neck'),.88]],.022).leg=false;

  for(const leg of r.legs){
    const {name,front,hip,knee,hock,paw}=leg;
    const origin=hip.clone();origin.x*=.61;origin.y+=.034;
    // One continuous upper taper contains the elbow/stifle. No spheres at
    // either joint. Tighter lower blends preserve a fine metacarpal outline.
    capsule(origin.toArray(),knee.toArray(),front?.053:.069,front?.029:.032,
      [[r.index(front?'Chest':'Pelvis'),.20],[r.index(name+'_Upper'),.80]],.021);
    capsule(knee.toArray(),hock.toArray(),front?.029:.030,.021,
      weights(name+'_Lower'),.006);
    capsule(hock.toArray(),paw.toArray(),.021,.024,
      weights(name+'_Ankle'),.006);

    const pad=foxPawDesign(s,leg);
    const foot=ell([paw.x,pad.height,paw.z+pad.forward],
      [pad.halfWidth,pad.height,pad.halfLength],weights(name+'_Paw'));
    foot.paw=true;
    // The existing toeGrooves sampler may use these proportional offsets.
    // Until that tiny generic extension is integrated the paw remains unified.
    foot.toeGrooves=true;foot.toeGrooveOffsets=[-.018,0,.018];
    foot.toeGrooveDepth=.0025;
    const instep=capsule([paw.x,paw.y+.012,paw.z-.009],
      [paw.x,pad.height+.008,paw.z+.009],.021,.027,
      [[r.index(name+'_Ankle'),.22],[r.index(name+'_Paw'),.78]],.006);
    instep.paw=true;
  }
  return shapes;
}

/** Exact central integration checklist. Not an automatic source patch. */
export const FOX_INTEGRATION = Object.freeze([
  'mammals.mjs: import foxAnatomyConfig and foxPawDesign from ./mammals/fox-anatomy.mjs. In buildSpecies use const base=SHAPES[id]; const s=base?.kind===\'fox\'?foxAnatomyConfig(base):base before addRig.',
  'mammals.mjs: at start of pawDesign return foxPawDesign(s,leg) for fox. In pawsAndClaws suppress fox toe ellipsoids while retaining small claws rooted at the unified foot front. Never emit old toe balls over the new field.',
  'implicit.mjs: import buildFoxFields and FOX_ANATOMY from ./fox-anatomy.mjs. For fox use shapes.push(...buildFoxFields({s,r,bodyWeights})) instead of default torso, fox head fields and generic leg loop. Keep the field sampler, smoothing, weights and sole flattening unchanged.',
  'implicit.mjs: use FOX_ANATOMY.resolution for fox. In toeGrooves use f.toeGrooveOffsets??[-.038,0,.038] and f.toeGrooveDepth??.004. Existing Lynx groove behavior stays unchanged.',
  'mammals.mjs ears: use FOX_ANATOMY.earShellThickness for fox back/front separation, and FOX_ANATOMY.earRimRadius for fox rim radii. Existing pink inset brightness should be reduced to fur-lined dark pink. Keep Ear_L/Ear_R names and roots.',
  'Do not change leg, head or tail pivots or gait curves in this integration. Rest forelegs still have the inherited bend; assess the slimmer continuous limb field in the production lab before deciding whether a rig revision is needed.',
  'Root must run eight-clip whole-vertex audit after integration, export only redbrush_fox, then inspect hardware front/side/rear/gameplay/run through the real feature lab. This module has no visual acceptance yet.',
]);
