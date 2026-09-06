import * as THREE from 'three';

/** Canada lynx proportions in metres, on the existing 29-joint skeleton. */
export const LYNX_ANATOMY=Object.freeze({
  resolution:104,
  torso:[
    [-.64,.792,.008,.014],[-.58,.798,.113,.152],
    [-.43,.803,.174,.214],[-.23,.811,.151,.185],
    [-.03,.797,.151,.195],[.20,.778,.158,.225],
    [.36,.785,.150,.213],[.47,.836,.124,.181],
    [.54,.878,.090,.132],[.61,.91,.001,.025],
  ],
  skull:[
    [.554,.947,.006,.009],[.60,.945,.121,.110],
    [.65,.943,.183,.119],[.691,.943,.190,.120],
    [.733,.945,.171,.115],[.775,.949,.152,.100],
    [.81,.943,.137,.084],[.85,.930,.108,.064],
    [.891,.915,.079,.043],[.937,.916,.038,.024],
    [.959,.916,.002,.005],
  ],
  eyes:[.112,.981,.824],eyeScale:[.032,.023,.019],
  ears:{root:[.139,1.025,.648],length:.075,width:.120,lean:-.025,inward:.028},
  tailR:[.047,.045,.038,.029],
  tuftLength:.055,
});

export function lynxAnatomyConfig(base){
  if(base.kind!=='lynx')throw new Error('lynxAnatomyConfig requires a lynx config');
  return {...base,
    body:[...LYNX_ANATOMY.torso.filter(row=>row[0]<.554),...LYNX_ANATOMY.skull].map(row=>[...row]),
    eyes:[...LYNX_ANATOMY.eyes],eyeScale:[...LYNX_ANATOMY.eyeScale],
    ears:{...LYNX_ANATOMY.ears,root:[...LYNX_ANATOMY.ears.root]},
    tail:base.tail.map(row=>[...row]),tailR:[...LYNX_ANATOMY.tailR],
  };
}

export function lynxPawDesign(s,leg){
  if(s.kind!=='lynx')throw new Error('lynxPawDesign requires a lynx config');
  return {height:.052,halfWidth:.052,halfLength:.055,forward:.020,
    toeCount:4,toeForward:.070,toeLength:.018};
}

export function buildLynxFields({s,r,bodyWeights}){
  if(s.kind!=='lynx')throw new Error('buildLynxFields requires a lynx config');
  const shapes=[],w=name=>[[r.index(name),1]];
  const profile=(rows,weights,blend)=>shapes.push({type:'profile',rows:rows.map(row=>[...row]),weights,blend,leg:false});
  const capsule=(a,b,r0,r1,weights,blend=.010)=>{
    const direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    if(direction.lengthSq()<1e-10)throw new Error('Zero-length lynx limb');
    const f={type:'capsule',a,b,r0,r1,direction,lengthSq:direction.lengthSq(),weights,blend,leg:true};
    shapes.push(f);return f;
  };
  profile(LYNX_ANATOMY.torso,p=>bodyWeights(r,s,p[2]),.025);
  profile(LYNX_ANATOMY.skull,w('Head'),.015);
  capsule([0,.83,.46],[0,.935,.60],.109,.104,
    [[r.index('Chest'),.20],[r.index('Neck'),.80]],.024).leg=false;
  for(const {name,front,hip,knee,hock,paw} of r.legs){
    const origin=hip.clone();origin.x*=.62;origin.y+=.040;
    capsule(origin.toArray(),knee.toArray(),front?.080:.106,.056,
      [[r.index(front?'Chest':'Pelvis'),.24],[r.index(name+'_Upper'),.76]],.024);
    capsule(knee.toArray(),hock.toArray(),.056,.053,w(name+'_Lower'),.008);
    capsule(hock.toArray(),paw.toArray(),.053,.053,w(name+'_Ankle'),.008);
  }
  return shapes;
}

/** Dense paw perimeter keeps millimetre toe clefts independent of body voxel size.
 * The sole is a closed, filled pad; clefts start above its bevel at 4 mm.
 * The dome overlaps the distal limb field through the full instep width.
 */
export function emitLynxPaws({s,r,out,pawCoat}){
  if(s.kind!=='lynx')throw new Error('emitLynxPaws requires a lynx config');
  const N=512;
  for(const leg of r.legs){
    const pad=lynxPawDesign(s,leg),base=out.p.length/3,w=[[r.index(leg.name+'_Paw'),1]];
    const rings=[[0,.037,.034,0],[.004,.050,.053,1],[.008,.052,.055,1],
      [.012,.052,.055,1],[.020,.052,.055,1],[.030,.052,.055,1],
      [.045,.050,.048,.7],[.060,.043,.036,.3],[.075,.024,.024,0],[.083,.002,.002,0]];
    for(const [y,rx,rz,groove] of rings)for(let j=0;j<N;j++){
      const a=j/N*Math.PI*2,cs=Math.cos(a),sn=Math.sin(a);
      const x=rx*Math.sign(cs)*Math.sqrt(Math.abs(cs));
      let z=rz*Math.sign(sn)*Math.sqrt(Math.abs(sn));
      if(sn>0)z-=groove*.012*Math.max(...[-.026,0,.026].map(g=>Math.exp(-(((x-g)/.008)**2))));
      const p=new THREE.Vector3(leg.paw.x+x,y,leg.paw.z+pad.forward+z);
      out.vertex(p,pawCoat(s,p),w,[j/N,y/.083]);
    }
    for(let i=0;i<rings.length-1;i++)for(let j=0;j<N;j++){
      const a=base+i*N+j,b=base+i*N+(j+1)%N;
      out.quad(a,b,a+N,b+N);
    }
    for(const top of [false,true]){
      const y=top?.084:0,offset=base+(top?rings.length-1:0)*N;
      const p=new THREE.Vector3(leg.paw.x,y,leg.paw.z+pad.forward);
      const centre=out.vertex(p,pawCoat(s,p),w);
      for(let j=0;j<N;j++)out.tri(centre,offset+(top?j:(j+1)%N),offset+(top?(j+1)%N:j));
    }
  }
}

/** A capped bobtail. Colour boundaries use arc length, not spline parameter. */
export function emitLynxTail({s,r,out,tube,palette,black}){
  if(s.kind!=='lynx')throw new Error('emitLynxTail requires a lynx config');
  const points=s.tail.map(p=>new THREE.Vector3(...p)),curve=new THREE.CatmullRomCurve3(points);
  const lengths=curve.getLengths(200),total=lengths.at(-1),base=out.p.length/3;
  const weights=t=>{
    const a=t*(s.tail.length-1),i=Math.min(s.tail.length-2,Math.floor(a)),f=a-i,u=f*f*(3-2*f);
    return [[r.index('Tail_'+(i+1)),1-u],[r.index('Tail_'+(i+2)),u]];
  };
  tube(out,points,s.tailR,weights,(p,t,a)=>{
    const k=Math.min(199,Math.floor(t*200)),arc=THREE.MathUtils.lerp(lengths[k],lengths[k+1],t*200-k)/total;
    const u=THREE.MathUtils.smoothstep(arc,.60,.69);
    return palette[0].clone().lerp(palette[1],.18+.1*Math.sin(a)).lerp(black,u);
  },{rings:20,sides:20});
  const cap=out.vertex(points.at(-1),black,[[r.index('Tail_4'),1]]);
  for(let j=0;j<20;j++)out.tri(cap,base+20*21+j,base+20*21+j+1);
}
