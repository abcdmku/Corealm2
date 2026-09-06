import * as THREE from 'three';
import {FOX_ANATOMY,foxAnatomyConfig,foxPawDesign} from './mammals/fox-anatomy.mjs';
import {BADGER_ANATOMY,badgerAnatomyConfig,badgerPawDesign,badgerCoat,badgerEarWidth,badgerEarColour} from './mammals/badger-anatomy.mjs';
import {porcupineAnatomyConfig,porcupinePawDesign,emitPorcupineQuills,emitPorcupineTail} from './mammals/porcupine-anatomy.mjs';

/** Original Corealm mammal meshes. All coordinates are metres, +Z is forward. */
export const SPECIES = ['redbrush_fox', 'duskoak_lynx', 'rootdelve_badger', 'quillback_porcupine'];

const TAU = Math.PI * 2;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
const noise = (x, y, z) => fract(Math.sin(x * 137.1 + y * 283.7 + z * 93.3) * 43758.5453);
const c = hex => new THREE.Color(hex);
const C = {
  fox: [c('#ba5526'), c('#6c2916'), c('#e4b07a'), c('#ebe0c2')],
  lynx: [c('#998d77'), c('#403d35'), c('#b9af96'), c('#d3c8ad')],
  badger: [c('#77776c'), c('#30352f'), c('#a8a99c'), c('#dfdec6')],
  porc: [c('#5c4b38'), c('#2e2923'), c('#a28a65'), c('#d2c4a0')],
  nose: c('#25201c'), pad: c('#3e322a'), pink: c('#ad7467'), claw: c('#c5b596'), ivory: c('#ece2c5'), black: c('#121513'), amber: c('#bd8630'), olive: c('#9aab6a')
};

// Each ring is [z, centreY, halfWidth, halfHeight]. Smooth interpolation builds
// an authored surface through shoulders, loin, neck, brow, cheek and muzzle.
const SHAPES = {
  redbrush_fox: {
    kind: 'fox', is: 'a narrow-chested red fox with long legs, a pointed muzzle, broad listening ears and a white-tipped brush',
    tags: ['mammal', 'quadruped', 'fox', 'canid', 'woodland'],
    body: [[-.58,.61,.008,.014],[-.53,.62,.095,.12],[-.42,.64,.157,.167],[-.28,.65,.135,.136],[-.12,.65,.142,.145],[.05,.65,.157,.183],[.24,.665,.162,.216],[.39,.69,.14,.211],[.52,.765,.112,.177],[.635,.825,.135,.145],[.75,.83,.14,.133],[.84,.796,.107,.087],[.97,.773,.057,.047],[1.055,.765,.006,.012]],
    hipY: .60, rearZ: -.36, frontZ: .34, stance: .122, kneeZ: .105, hockY: .19, pawY: .055, pawWidth: .072, pawLength: .145,
    headPivot: [0,.775,.60], jawPivot: [0,.742,.816],
    ears: { root: [.095,.916,.66], length:.145, width:.170, lean:-.025, inward:.014 },
    eyes: [.118,.854,.796], eyeScale: [.033,.029,.024],
    nose: [0,.778,1.049], noseScale: [.036,.026,.020],
    tail: [[0,.60,-.49],[.015,.57,-.71],[.045,.44,-.93],[.06,.34,-1.19],[.065,.37,-1.36]],
    tailR: [.085,.125,.14,.105,.001],
    gait: { walk: 1.02, run: .66, stride: .36, runStride: .60, lift:.075, runLift:.15 },
    attack: .88, contact: .49,
  },
  duskoak_lynx: {
    kind: 'lynx', is: 'a tall woodland lynx with a deep feline chest, high haunches, cheek ruffs, broad paws and a short black-tipped tail',
    tags: ['mammal', 'quadruped', 'lynx', 'feline', 'woodland'],
    // NPS Canada lynx reference: high haunch, level lumbar bridge, deep chest,
    // broad facial ruff, short muzzle and wide furred feet. Dimensions are
    // authored proportions, not measurements of the photographed animal.
    body: [[-.64,.770,.01,.012],[-.58,.774,.118,.15],[-.43,.775,.183,.207],[-.23,.754,.162,.184],[-.03,.733,.170,.202],[.20,.735,.180,.220],[.36,.769,.164,.202],[.47,.836,.133,.181],[.55,.898,.128,.166],[.665,.948,.194,.165],[.78,.948,.185,.143],[.865,.916,.129,.082],[.962,.907,.005,.01]],
    hipY:.745,rearZ:-.40,frontZ:.31,stance:.159,kneeZ:.10,hockY:.23,pawY:.073,pawWidth:.139,pawLength:.188,
    headPivot:[0,.881,.55],jawPivot:[0,.852,.780],
    ears:{root:[.139,1.025,.648],length:.075,width:.120,lean:-.025,inward:.028},
    eyes:[.112,.981,.824],eyeScale:[.032,.023,.019],
    nose:[0,.918,.949],noseScale:[.042,.025,.018],
    tail:[[0,.765,-.563],[.006,.750,-.651],[.010,.739,-.712],[.013,.738,-.751]],tailR:[.051,.048,.037,.002],
    gait:{walk:1.16,run:.67,stride:.43,runStride:.74,lift:.092,runLift:.21},attack:1.02,contact:.43,
  },
  rootdelve_badger: {
    kind:'badger',is:'a low, broad badger with a sloping wedge-shaped muzzle, black eye stripes and long digging claws',
    tags:['mammal','quadruped','badger','mustelid','burrow'],
    body:[[-.68,.36,.007,.01],[-.62,.40,.133,.166],[-.47,.415,.283,.245],[-.25,.398,.292,.256],[.01,.377,.249,.235],[.24,.351,.224,.217],[.41,.345,.172,.167],[.53,.367,.143,.143],[.65,.344,.134,.117],[.79,.311,.098,.083],[.915,.278,.045,.048],[.972,.27,.009,.014]],
    hipY:.354,rearZ:-.43,frontZ:.295,stance:.19,kneeZ:.08,hockY:.12,pawY:.041,pawWidth:.10,pawLength:.165,
    headPivot:[0,.32,.45],jawPivot:[0,.268,.70],
    ears:{root:[.129,.454,.526],length:.098,width:.106,lean:-.023,inward:.002},
    eyes:[.105,.367,.735],eyeScale:[.022,.021,.019],
    nose:[0,.281,.957],noseScale:[.05,.036,.027],
    tail:[[0,.40,-.58],[.016,.34,-.78],[.03,.29,-.91]],tailR:[.071,.059,.003],
    gait:{walk:1.15,run:.73,stride:.27,runStride:.42,lift:.038,runLift:.085},attack:1.10,contact:.46,
  },
  quillback_porcupine: {
    kind:'porc',is:'a heavy-rumped porcupine with individually curved banded quills, a blunt face and short grasping feet',
    tags:['mammal','quadruped','porcupine','rodent','quills'],
    body:[[-.60,.36,.009,.014],[-.54,.40,.155,.19],[-.39,.439,.273,.29],[-.16,.435,.267,.29],[.06,.39,.237,.258],[.255,.327,.183,.214],[.38,.29,.137,.17],[.49,.301,.127,.137],[.61,.278,.11,.108],[.72,.247,.066,.061],[.76,.243,.008,.016]],
    hipY:.35,rearZ:-.32,frontZ:.25,stance:.164,kneeZ:.07,hockY:.12,pawY:.045,pawWidth:.077,pawLength:.116,
    headPivot:[0,.267,.39],jawPivot:[0,.203,.571],
    ears:{root:[.108,.389,.45],length:.069,width:.086,lean:-.016,inward:.0},
    eyes:[.104,.311,.584],eyeScale:[.023,.023,.018],
    nose:[0,.257,.739],noseScale:[.041,.030,.023],
    tail:[[0,.347,-.50],[.01,.261,-.68],[.025,.17,-.84],[.036,.11,-.94]],tailR:[.09,.078,.055,.003],
    gait:{walk:1.25,run:.76,stride:.24,runStride:.39,lift:.030,runLift:.065},attack:1.16,contact:.54,
  },
};

class Surface {
  constructor(){ this.p=[];this.co=[];this.uv=[];this.si=[];this.sw=[];this.idx=[]; }
  vertex(p, color, weights,uv=[p.x,p.z]){ const n=this.p.length/3;this.p.push(p.x,p.y,p.z);this.co.push(color.r,color.g,color.b);this.uv.push(...uv);const w=weights.slice(0,4);while(w.length<4)w.push([0,0]);this.si.push(...w.map(x=>x[0]));this.sw.push(...w.map(x=>x[1]));return n; }
  tri(a,b,d){this.idx.push(a,b,d);}
  quad(a,b,d,e){this.idx.push(a,b,d,b,e,d);}
  build(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.co,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(this.si,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(this.sw,4));g.setIndex(this.idx);g.computeVertexNormals();const normals=g.getAttribute('normal');for(let i=0;i<normals.count;i++){if(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))<.5)normals.setXYZ(i,0,1,0);}g.computeBoundingBox();g.computeBoundingSphere();return g;}
}

function profileAt(rows,z){
  let i=0;while(i<rows.length-2 && rows[i+1][0]<z)i++;
  const t=clamp((z-rows[i][0])/(rows[i+1][0]-rows[i][0]));
  const out=[z];
  for(let k=1;k<4;k++){
    const p0=rows[Math.max(0,i-1)][k],p1=rows[i][k],p2=rows[i+1][k],p3=rows[Math.min(rows.length-1,i+2)][k];
    out.push(Math.max(k>1?.0005:-Infinity, .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)));
  }return out;
}

function coat(s,p,theta=0,part='body'){
  if(s.kind==='badger')return badgerCoat(s,p,theta,part);
  const pal=C[s.kind], col=pal[0].clone();
  const belly=smooth(.10,-.65,Math.cos(theta));
  col.lerp(pal[2],belly*.52);
  const grain=(Math.sin(p.z*125+p.x*13)*Math.sin(p.y*91+p.z*9)+Math.sin(p.x*240+p.z*42))*.017;
  col.multiplyScalar(1+grain);
  if(s.kind==='fox'){
    const bib=smooth(.34,.66,p.z)*(1-smooth(.77,.88,p.y));
    if(part==='body') col.lerp(pal[3],Math.max(belly*.60,bib*.94));
    if(part==='body'&&p.z<.46)col.lerp(pal[1],smooth(.25,.95,Math.cos(theta))*.16);
    if(p.z>.82 && p.y<.80)col.lerp(pal[3],.88);
    if(part==='leg'){col.copy(pal[0]).lerp(c('#252420'),1-smooth(.19,.41,p.y));col.multiplyScalar(.93);}
  } else if(s.kind==='lynx') {
    const dapple=Math.sin(p.z*38+Math.sin(p.y*23)*1.2)*Math.sin(Math.abs(p.x)*47+p.y*31);
    const spot=smooth(.48,.83,dapple);
    col.lerp(pal[1],spot*(part==='leg'?.44:.65));
    // Keep buff on the small muzzle and chin, not a pale band over the ruff.
    if(p.z>.85 && p.y<.904)col.lerp(pal[3],.43);
    if(p.z>.60 && p.y>.94)col.lerp(pal[1],.20*(.5+.5*Math.cos(p.x*84)));
    // Broken dapples continue onto the limbs; horizontal rings read as joints.
  } else if(s.kind==='badger') {
    if(p.z>.46){
      col.copy(pal[3]);
      const centre=mix(.065,.111,clamp((.88-p.z)/.33));
      const stripe=(1-smooth(.030,.049,Math.abs(Math.abs(p.x)-centre)))*smooth(.27,.37,p.y);
      col.lerp(pal[1],stripe*.98);
    } else {col.lerp(pal[1],belly*.75);col.multiplyScalar(1+.018*Math.sin(p.z*185+p.x*105));}
    if(part==='leg')col.copy(pal[1]).lerp(pal[0],smooth(.15,.43,p.y));
  } else {
    col.lerp(pal[1],belly*.52);
    col.multiplyScalar(1+.06*Math.sin(p.z*140+p.x*38));
    if(p.z>.46)col.lerp(pal[2],.25);
    if(part==='leg')col.copy(pal[1]).lerp(pal[0],smooth(.15,.43,p.y));
  }
  return col;
}

function addRig(s,group){
  const bones=[], by={}, rest={}, add=(name,parent,pos)=>{const b=new THREE.Bone();b.name=name;by[name]=b;bones.push(b);const world=v(...pos);if(parent){by[parent].add(b);b.position.copy(world).sub(rest[parent]);}else group.add(b);rest[name]=world;return b;};
  add('Root',null,[0,0,0]);add('Pelvis','Root',[0,s.hipY,-.29]);add('Spine','Pelvis',[0,s.hipY,.0]);add('Chest','Spine',[0,s.hipY+.025,.30]);add('Neck','Chest',[0,...s.headPivot.slice(1).map((x,i)=>i===0?x-.08:x-.1)]);add('Head','Neck',s.headPivot);add('Jaw','Head',s.jawPivot);
  add('Ear_L','Head',s.ears.root);add('Ear_R','Head',[-s.ears.root[0],s.ears.root[1],s.ears.root[2]]);
  s.tail.forEach((p,i)=>add(`Tail_${i+1}`,i?'Tail_'+i:'Pelvis',p));
  const legs=[];
  for(const front of [true,false])for(const sign of [-1,1]){
    const name=(front?'F':'H')+(sign<0?'R':'L'), x=sign*s.stance,z=front?s.frontZ:s.rearZ;
    const hip=v(x,s.hipY+(front?.018:0),z),
      knee=v(x,front?s.hipY*.55:s.hipY*.64,z+(front?(s.kind==='lynx'?-.035:-s.kneeZ):s.kneeZ)),
      hock=v(x,s.kind==='lynx'&&front?.15:s.hockY,z+(front?(s.kind==='lynx'?.037:.015):-.075)),
      paw=v(x,s.pawY,z+(front?.066:.035));
    add(name+'_Upper',front?'Chest':'Pelvis',hip.toArray());add(name+'_Lower',name+'_Upper',knee.toArray());add(name+'_Ankle',name+'_Lower',hock.toArray());add(name+'_Paw',name+'_Ankle',paw.toArray());
    legs.push({name,front,sign,hip,knee,hock,paw,l1:hip.distanceTo(knee),l2:knee.distanceTo(hock),distal:paw.clone().sub(hock)});
  }
  group.updateMatrixWorld(true);
  return {bones,by,rest,legs,index:name=>bones.indexOf(by[name])};
}

function bodyWeights(r,s,z){
  const keys=[[-.60,'Pelvis'],[-.31,'Pelvis'],[.00,'Spine'],[Math.min(.34,s.headPivot[2]-.18),'Chest'],[s.headPivot[2]-.10,'Neck'],[s.headPivot[2]+.07,'Head'],[1.30,'Head']];
  let i=0;while(i<keys.length-2&&z>keys[i+1][0])i++;
  const t=smooth(keys[i][0],keys[i+1][0],z);const a=r.index(keys[i][1]),b=r.index(keys[i+1][1]);return a===b?[[a,1]]:[[a,1-t],[b,t]];
}

function tube(out,points,radii,weights,color,{rings=30,sides=20,elliptic=1}={}){
  const curve=new THREE.CatmullRomCurve3(points),base=out.p.length/3;
  const radiusAt=t=>{const a=t*(radii.length-1),i=Math.min(radii.length-2,Math.floor(a));return mix(radii[i],radii[i+1],a-i);};
  for(let i=0;i<=rings;i++){
    const t=i/rings,p=curve.getPoint(t),dir=curve.getTangent(t).normalize();
    let u=v(1,0,0);if(Math.abs(dir.dot(u))>.88)u=v(0,1,0);u.addScaledVector(dir,-dir.dot(u)).normalize();const w=new THREE.Vector3().crossVectors(dir,u).normalize();
    const rad=radiusAt(t);
    for(let j=0;j<=sides;j++){
      const a=j/sides*TAU,q=p.clone().addScaledVector(u,Math.cos(a)*rad).addScaledVector(w,Math.sin(a)*rad*elliptic);
      out.vertex(q,typeof color==='function'?color(q,t,a):color,weights(t,q),[j/sides,i/rings]);
    }
  }
  for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){const a=base+i*(sides+1)+j;out.quad(a,a+1,a+sides+1,a+sides+2);}
}

function ellipsoid(out,center,scale,color,weights,segments=20,rings=12,rotation=null,deform=null){
  const base=out.p.length/3;
  for(let i=0;i<=rings;i++){
    const b=mix(.00001,Math.PI-.00001,i/rings);
    for(let j=0;j<=segments;j++){
      const a=TAU*j/segments,p=v(Math.sin(b)*Math.cos(a)*scale[0],Math.cos(b)*scale[1],Math.sin(b)*Math.sin(a)*scale[2]);if(deform)deform(p);if(rotation)p.applyQuaternion(rotation);p.add(center);
      out.vertex(p,typeof color==='function'?color(p,a,b):color,weights,[j/segments,i/rings]);
    }
  }
  for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){const a=base+i*(segments+1)+j;out.quad(a,a+1,a+segments+1,a+segments+2);}
}

function pawDesign(s,leg){
  if(s.kind==='fox')return foxPawDesign(s,leg);
  if(s.kind==='badger')return badgerPawDesign(s,leg);
  if(s.kind==='porc')return porcupinePawDesign(s,leg);
  const fox=s.kind==='fox',cat=s.kind==='lynx',badger=s.kind==='badger';
  return {
    height:s.pawY*(fox?.91:cat?.64:badger?1.05:.95),
    halfWidth:s.pawWidth*(badger&&leg.front?.74:cat?.68:fox?.66:.65),
    halfLength:s.pawLength*(badger&&leg.front?.44:cat?.53:fox?.44:.42),
    forward:badger?.018:cat?.025:fox?.010:.012,
    toeCount:badger?5:s.kind==='porc'&&!leg.front?5:4,
    toeForward:s.pawLength*(badger?.47:cat?.48:fox?.43:.44),
    toeLength:s.pawLength*(badger?.22:cat?.21:fox?.22:.25),
  };
}

function pawCoat(s,p){
  const col=coat(s,p,Math.PI,'leg');
  if(s.kind!=='lynx')col.lerp(c('#4c4c40'),smooth(.015,.095,p.y)*.22);
  return col;
}

function pawsAndClaws(s,r,out,detail){
  for(const leg of r.legs){
    const {name,paw,front}=leg;
    const w=[[r.index(name+'_Paw'),1]],design=pawDesign(s,leg),digits=design.toeCount;
    if(s.kind==='lynx')continue; // Toe divisions are cut into the single paw field.
    for(let digit=0;digit<digits;digit++){
      const dx=(digit-(digits-1)/2)*s.pawWidth*(digits===5?.205:.26);
      const toe=v(paw.x+dx,s.pawY*(s.kind==='lynx'?.43:.56),paw.z+design.toeForward-(Math.abs(dx)/s.pawWidth)*.028);
      if(s.kind!=='fox'&&s.kind!=='badger'&&s.kind!=='porc')ellipsoid(out,toe,[s.pawWidth*(digits===5?.168:.195),s.pawY*(s.kind==='lynx'?.40:.53),design.toeLength],p=>pawCoat(s,p),w,10,6);
      if(s.kind!=='lynx'){
        const len=s.kind==='badger'&&front?.058:s.kind==='porc'?.020:s.kind==='fox'?.014:.025;
        const root=s.kind==='fox'||s.kind==='badger'||s.kind==='porc'?v(paw.x+dx,design.height*.65,paw.z+design.forward+design.halfLength*Math.sqrt(Math.max(.1,1-(dx/design.halfWidth)**2))-.007):toe.clone().add(v(0,s.pawY*.20,design.toeLength*.80));
        tube(detail,[root,root.clone().add(v(0,-.006,len*.55)),root.clone().add(v(0,-.014,len))],s.kind==='fox'?[.004,.0026,.0005]:[.0068,.005,.0008],()=>w,s.kind==='fox'?c('#998e75'):C.claw,{rings:6,sides:7});
      }
    }
  }
}

function ears(s,r,out,detail){
  for(const sign of [-1,1]){
    const b=r.index(sign>0?'Ear_L':'Ear_R'),w=[[b,1]],root=v(sign*s.ears.root[0],s.ears.root[1],s.ears.root[2]);
    const round=s.kind==='badger'||s.kind==='porc',N=round?14:18,M=round?12:16;
    const shellBases=[];
    const earPoint=(x,y,z)=>{const p=v(x,y,z);if(s.kind==='fox'||s.kind==='lynx')p.applyAxisAngle(v(0,1,0),sign*(s.kind==='lynx'?.52:.38));return p.add(root);};
    for(const back of [false,true]){
      const base=out.p.length/3;
      shellBases.push(base);
      for(let i=0;i<=N;i++){
        const t=i/N,width=s.kind==='badger'?badgerEarWidth(s,t):s.ears.width*(round?Math.sin(Math.PI*(.13+.87*t))*.52:s.kind==='lynx'?Math.pow(1-t,.79)*.55:Math.pow(1-t,.86)*.54);
        for(let j=0;j<=M;j++){
          const u=j/M*2-1;
          const shell=s.kind==='fox'?(back?.004-FOX_ANATOMY.earShellThickness:.004):s.kind==='badger'?(back?-BADGER_ANATOMY.earShellThickness:.002):(back?-.014:.004);
          const p=earPoint(sign*(u*width+s.ears.inward*t),s.ears.length*t,s.ears.lean*t+shell+((s.kind==='fox'?.016:.026)*Math.sin(Math.PI*t)*(1-u*u)));
          const edge=s.kind==='fox'?smooth(.45,.90,Math.abs(u)):smooth(.68,.98,Math.abs(u));
          const color=s.kind==='badger'?badgerEarColour(u,t,back):back?(s.kind==='fox'?c('#26211c'):C[s.kind][1].clone().lerp(C[s.kind][0],round?.4:.72)):C.pink.clone().lerp(C[s.kind][3],Math.max(edge*.94,s.kind==='lynx'?.53:0)).multiplyScalar(round?.68:1);
          if(s.kind==='fox'&&!back)color.multiplyScalar(.73);
          out.vertex(p,color,w,[j/M,i/N]);
        }
      }
      for(let i=0;i<N;i++)for(let j=0;j<M;j++){const a=base+i*(M+1)+j;if(back)out.quad(a+1,a,a+M+2,a+M+1);else out.quad(a,a+1,a+M+1,a+M+2);}
    }
    if(s.kind==='fox'||s.kind==='lynx'||s.kind==='badger')for(let i=0;i<N;i++)for(const j of [0,M]){
      const a=shellBases[0]+i*(M+1)+j,b=shellBases[1]+i*(M+1)+j;
      out.quad(a,b,a+M+1,b+M+1);
    }
    if(s.kind==='lynx'){
      for(let k=0;k<5;k++){
        const a=earPoint(sign*s.ears.inward,s.ears.length-.010,s.ears.lean);
        const b=a.clone().add(v(sign*(.013+k*.003),.043-k*.004,-.007+k*.002));
        tube(detail,[a,a.clone().lerp(b,.55),b],[.0048-k*.0006,.002,.0002],()=>w,C[s.kind][1],{rings:5,sides:5});
      }
    }
    if(s.kind==='fox'||s.kind==='lynx'){
      const rim=[];
      for(let i=0;i<=24;i++){
        const left=i<=12,t=left?i/12:(24-i)/12,u=left?-1:1,width=s.ears.width*(s.kind==='lynx'?Math.pow(1-t,.79)*.55:Math.pow(1-t,.86)*.54);
        rim.push(earPoint(sign*(u*width+s.ears.inward*t),s.ears.length*t,s.ears.lean*t+.006));
      }
      tube(out,rim,s.kind==='fox'?[1,.8,.55,.8,1].map(x=>x*FOX_ANATOMY.earRimRadius):[.008,.0065,.004,.0065,.008],()=>w,C[s.kind][3].clone().lerp(C[s.kind][0],.42),{rings:30,sides:8,elliptic:.75});
    }
  }
}

function face(s,r,out,detail){
  const hw=[[r.index('Head'),1]],jw=[[r.index('Jaw'),1]];
  const snout=s.nose[2]-s.jawPivot[2];
  if(s.kind==='fox'){
    tube(out,[v(0,.750,.821),v(0,.750,.868),v(0,.755,.949),v(0,.758,1.034),v(0,.759,1.045)],[.044,.047,.035,.016,.0005],()=>jw,(p,t,a)=>C.fox[3].clone().multiplyScalar(.88).lerp(C.nose.clone().lerp(C.pink,.24),smooth(.10,.80,Math.sin(a))),{rings:18,sides:16,elliptic:.26});
  }else ellipsoid(out,v(0,s.jawPivot[1]+(s.kind==='lynx'?.010:-.002),s.jawPivot[2]+snout*.47),[s.noseScale[0]*(s.kind==='lynx'?1.55:1.12),s.kind==='lynx'?.019:.025,snout*(s.kind==='lynx'?.47:.51)],p=>{
    const underside=C[s.kind][s.kind==='porc'?0:3].clone().multiplyScalar(s.kind==='fox'?.92:.78);
    return s.kind==='lynx'?underside:underside.lerp(C.nose.clone().lerp(C.pink,.25),smooth(s.jawPivot[1]+.003,s.jawPivot[1]+.018,p.y));
  },jw,24,12);
  ellipsoid(detail,v(...s.nose),s.noseScale,C.nose,hw,24,14,null,p=>{const y=p.y/s.noseScale[1]*.5+.5;p.x*=.62+.38*y;p.z*=.72+.28*y;});
  for(const sign of [-1,1]){
    if(s.kind==='lynx')ellipsoid(out,v(sign*.037,.892,.907),[.041,.021,.034],C.lynx[3].clone().lerp(C.lynx[0],.43).multiplyScalar(.87),hw,24,14);
    const toward=v(sign*.53,.035,.85).normalize(),q=new THREE.Quaternion().setFromUnitVectors(v(0,0,1),toward);
    const eye=v(sign*s.eyes[0],s.eyes[1],s.eyes[2]).addScaledVector(toward,-.005);
    ellipsoid(out,eye.clone().addScaledVector(toward,-.006),s.eyeScale.map((x,i)=>x*(i===2?.40:1.05)),C[s.kind][0].clone().multiplyScalar(.76),hw,20,12);
    ellipsoid(detail,eye,s.eyeScale.map(x=>x*.77),C.black,hw,24,14);
    const iris=eye.clone().addScaledVector(toward,s.eyeScale[2]*.69);
    ellipsoid(detail,iris,[s.eyeScale[0]*.46,s.eyeScale[1]*.50,.0035],s.kind==='lynx'?C.olive:C.amber,hw,20,12,q);
    ellipsoid(detail,iris.clone().addScaledVector(toward,.003),[s.eyeScale[0]*(s.kind==='lynx'?.10:.23),s.eyeScale[1]*.37,.0025],C.black,hw,16,10,q);
    ellipsoid(detail,iris.clone().addScaledVector(toward,.005).add(v(-.003,.006,.0)),[.0028,.0028,.0015],C.ivory,hw,10,7,q);
    // Muzzle freckling and whisker roots remain attached to the head.
    if(s.kind!=='porc')for(let k=0;k<5;k++){
      const p=v(sign*(s.noseScale[0]+.014+(k%2)*.009),s.nose[1]-.014+Math.floor(k/2)*.012,s.nose[2]-.05-Math.floor(k/2)*.018);
      ellipsoid(detail,p,[.0025,.0025,.0025],C.nose,hw,6,5);
    }
    const whiskers=s.kind==='lynx'?5:s.kind==='badger'?4:3;
    for(let k=0;k<whiskers;k++){
      const p=v(sign*(s.noseScale[0]+.007),s.nose[1]-.023+k*.009,s.nose[2]-.055-k*.012);
      const length=s.kind==='lynx'?.16:s.kind==='badger'?.093:.10;
      tube(detail,[p,p.clone().add(v(sign*length*.55,.012-k*.006,-.018)),p.clone().add(v(sign*length,.017-k*.009,-.038))],[.0012,.0008,.00015],()=>hw,C.ivory.clone().multiplyScalar(.76),{rings:5,sides:4});
    }
    // Lynx cheek fur is part of the continuous field. Separate repeating
    // tapered locks produced a tooth-like comb in the production side view.
    // Thin lip curves follow the authored tapered muzzle, and the mandible opens separately.
    const p0=v(sign*s.noseScale[0]*.7,s.nose[1]-.028,s.nose[2]-.012),p1=s.kind==='lynx'?v(sign*.064,.883,.892):v(sign*s.noseScale[0]*1.1,s.jawPivot[1]+.015,s.jawPivot[2]+.05);
    tube(detail,[p0,p0.clone().lerp(p1,.5).add(v(0,-.004,0)),p1],[.0024,.0023,.0015],()=>jw,C.nose,{rings:10,sides:5});
    if(s.kind==='fox'||s.kind==='lynx'){
      const fang=v(sign*s.noseScale[0]*.8,s.jawPivot[1]+.025,s.jawPivot[2]+snout*.60);
      tube(detail,[fang,fang.clone().add(v(0,-.022,.002)),fang.clone().add(v(0,-.030,-.001))],[.007,.004,.0004],()=>hw,C.ivory,{rings:6,sides:7});
    }
  }
}

function tail(s,r,out){
  if(s.kind==='porc')return emitPorcupineTail({s,r,out,tube,palette:C.porc});
  const weights=t=>{
    const a=t*(s.tail.length-1),i=Math.min(s.tail.length-2,Math.floor(a)),u=smooth(0,1,a-i);return [[r.index('Tail_'+(i+1)),1-u],[r.index('Tail_'+(i+2)),u]];
  };
  tube(out,s.tail.map(p=>v(...p)),s.tailR,weights,(p,t,a)=>{
    const col=C[s.kind][0].clone().lerp(C[s.kind][1],.18+.1*Math.sin(a));
    if(s.kind==='fox')col.lerp(C.fox[3],smooth(.56,.69,t));
    if(s.kind==='lynx')col.lerp(C.lynx[1],smooth(.48,.66,t));
    if(s.kind==='badger')col.lerp(C.badger[3],.23);
    return col;
  },{rings:s.kind==='fox'?38:20,sides:s.kind==='fox'?32:20});
  if(s.kind==='fox'){
    const curve=new THREE.CatmullRomCurve3(s.tail.map(p=>v(...p)));
    const radius=t=>{const a=t*(s.tailR.length-1),i=Math.min(s.tailR.length-2,Math.floor(a));return mix(s.tailR[i],s.tailR[i+1],a-i);};
    const at=(t,a,extra)=>{const point=curve.getPoint(t),dir=curve.getTangent(t),u=v(1,0,0).addScaledVector(dir,-dir.x).normalize(),w=new THREE.Vector3().crossVectors(dir,u).normalize();return point.addScaledVector(u,Math.cos(a)*(radius(t)+extra)).addScaledVector(w,Math.sin(a)*(radius(t)+extra));};
    for(let k=0;k<30;k++){
      const start=.37+Math.floor(k/6)*.125,end=start+.105,angle=(k%6)/6*TAU+Math.floor(k/6)*.31;
      tube(out,[at(start,angle,-.017),at(mix(start,end,.58),angle,-.004),at(end,angle,.009)],[.016,.010,.0003],t=>weights(mix(start,end,t)),(p,t)=>C.fox[0].clone().lerp(C.fox[3],smooth(.56,.69,mix(start,end,t))),{rings:4,sides:6,elliptic:.30});
    }
  }
}

function quills(s,r,out){
  if(s.kind==='porc')return emitPorcupineQuills({s,r,out,tube,profileAt,bodyWeights,palette:C.porc});
  if(s.kind!=='porc')return;
  for(let row=0;row<12;row++)for(let j=0;j<14;j++){
    const z=mix(-.50,.30,row/11),a=mix(-1.40,1.40,(j+.24*(row%2))/13.24),q=profileAt(s.body,z);
    const root=v(Math.sin(a)*q[2]*.985,q[1]+Math.cos(a)*q[3]*.982,z);
    const n=noise(row,j,3),len=mix(.21,.37,1-row/13)*(1+.22*(n-.5));
    const dir=v(Math.sin(a)*.68,Math.cos(a)*.58+.10,-.92).normalize();
    const tip=root.clone().addScaledVector(dir,len);
    const points=[root,root.clone().addScaledVector(dir,len*.47).add(v(0,.017,0)),tip];
    const weights=bodyWeights(r,s,z);
    tube(out,points,[.0058+(1-row/13)*.002,.0046,.00035],()=>weights,(p,t)=>{
      const band=t<.17?1:t<.34?0:t<.51?1:t<.69?0:t<.88?1:0;return band?C.porc[1]:C.porc[3].clone().multiplyScalar(.83+.16*n);
    },{rings:5,sides:5});
  }
  // Short guard hairs frame the face without hiding its eyes or nose.
  for(let k=0;k<32;k++){
    const a=k/32*TAU,z=.33+noise(k,1,2)*.10,q=profileAt(s.body,z),p=v(Math.sin(a)*q[2],q[1]+Math.cos(a)*q[3],z);
    const end=p.clone().add(v(Math.sin(a)*.045,Math.cos(a)*.035,-.06));
    tube(out,[p,p.clone().lerp(end,.55),end],[.003,.002,.0002],()=>bodyWeights(r,s,z),C.porc[2],{rings:3,sides:4});
  }
}

function solveLeg(r,leg,target,roll=0){
  const upper=r.by[leg.name+'_Upper'],lower=r.by[leg.name+'_Lower'],ankle=r.by[leg.name+'_Ankle'],paw=r.by[leg.name+'_Paw'];
  const hip=upper.getWorldPosition(v()),distal=leg.distal.clone().applyAxisAngle(v(1,0,0),roll),hockTarget=target.clone().sub(distal);
  const delta=hockTarget.clone().sub(hip),d=clamp(delta.length(),Math.abs(leg.l1-leg.l2)+.0001,leg.l1+leg.l2-.0001),dir=delta.normalize();
  hockTarget.copy(hip).addScaledVector(dir,d);
  const across=v(0,0,leg.front?-1:1).addScaledVector(dir,-dir.z*(leg.front?-1:1)).normalize();
  const along=(leg.l1*leg.l1-leg.l2*leg.l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,leg.l1*leg.l1-along*along));
  const knee=hip.clone().addScaledVector(dir,along).addScaledVector(across,height);
  const q1=new THREE.Quaternion().setFromUnitVectors(leg.knee.clone().sub(leg.hip).normalize(),knee.clone().sub(hip).normalize());
  const parentQ=upper.parent.getWorldQuaternion(new THREE.Quaternion());upper.quaternion.copy(parentQ.invert()).multiply(q1);upper.updateMatrixWorld(true);
  const q2=new THREE.Quaternion().setFromUnitVectors(leg.hock.clone().sub(leg.knee).normalize(),hockTarget.clone().sub(knee).normalize());lower.quaternion.copy(q1.clone().invert()).multiply(q2);lower.updateMatrixWorld(true);
  const qa=new THREE.Quaternion().setFromAxisAngle(v(1,0,0),roll);ankle.quaternion.copy(q2.clone().invert()).multiply(qa);ankle.updateMatrixWorld(true);
  paw.quaternion.copy(qa.invert());paw.updateMatrixWorld(true);
}

function buildClips(s,r,group){
  const clips=[];
  const reset=()=>{for(const b of r.bones){b.quaternion.identity();const world=r.rest[b.name],parent=r.rest[b.parent?.name];b.position.copy(world);if(parent)b.position.sub(parent);}};
  const make=(name,duration,pose,cyclic=false)=>{
    // Joint interpolation does not preserve the planted IK target between
    // keys. At 40Hz it buried rigid soles by 7.7mm despite exact key contacts.
    // Densely bake contact-bearing motion; preserve durations and trajectories.
    const sampleHz=name==='Run'&&s.kind==='lynx'?320:['Walk','Run','Attack'].includes(name)?160:40;
    const frames=Math.ceil(duration*sampleHz),times=[],values=new Map(r.bones.map(b=>[b.name,{p:[],q:[]} ]));
    for(let i=0;i<=frames;i++){
      const t=i/frames;reset();pose(cyclic&&i===frames?0:t,duration);group.updateMatrixWorld(true);
      if(name==='Death'){
        // Keep the collapsing skinned silhouette on the authored ground plane.
        // A roll about the ground root cannot reuse the standing-height offset.
        let lowest=Infinity;const p=v();
        group.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.skeleton.update();const pos=mesh.geometry.getAttribute('position');for(let j=0;j<pos.count;j++){p.fromBufferAttribute(pos,j);mesh.applyBoneTransform(j,p);lowest=Math.min(lowest,p.y);}});
        r.by.Root.position.y-=lowest;group.updateMatrixWorld(true);
      }
      times.push(t*duration);
      for(const b of r.bones){values.get(b.name).p.push(...b.position.toArray());values.get(b.name).q.push(...b.quaternion.toArray());}
    }
    const tracks=[];for(const b of r.bones){const val=values.get(b.name);tracks.push(new THREE.VectorKeyframeTrack(b.name+'.position',times,val.p));tracks.push(new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,val.q));}
    clips.push(new THREE.AnimationClip(name,duration,tracks));
  };
  const allFeet=()=>{group.updateMatrixWorld(true);for(const leg of r.legs)solveLeg(r,leg,leg.paw.clone());};
  const breathe=t=>{
    r.by.Spine.rotation.x=.013*Math.sin(t*TAU);r.by.Neck.rotation.x=.016*Math.sin(t*TAU+.4);r.by.Head.rotation.y=.035*Math.sin(t*TAU);
    r.by.Ear_L.rotation.z=.03*Math.sin(t*TAU);r.by.Ear_R.rotation.z=-.024*Math.sin(t*TAU+.5);
    for(let i=1;i<=s.tail.length;i++)r.by['Tail_'+i].rotation.y=.033*Math.sin(t*TAU-i*.48);
  };
  make('Idle',3.4,t=>{breathe(t);allFeet();},true);
  for(const running of [false,true]){
    const duration=running?s.gait.run:s.gait.walk,stride=running?s.gait.runStride:s.gait.stride,duty=running?.44:.66;
    make(running?'Run':'Walk',duration,t=>{
      const bob=running?.012:.005;r.by.Root.position.y=-(running?s.hipY*.15:.008)+bob*(1-Math.cos(t*TAU*2));
      r.by.Spine.rotation.x=(running?.055:.011)*Math.sin(t*TAU);r.by.Chest.rotation.x=-(running?.04:.01)*Math.sin(t*TAU);
      r.by.Head.rotation.x=-(running?.023:.01)*Math.sin(t*TAU*2);r.by.Head.rotation.y=(running?.015:.027)*Math.sin(t*TAU);
      for(let i=1;i<=s.tail.length;i++){r.by['Tail_'+i].rotation.y=(running?.08:.09)*Math.sin(t*TAU-i*.48);r.by['Tail_'+i].rotation.x=(running?.07:.026)*Math.sin(t*TAU*2-i*.3);}
      group.updateMatrixWorld(true);
      for(const leg of r.legs){
        // Walk is a four-beat gait. Run is a diagonal trot in small mustelids,
        // and a paired gallop in the taller fox and lynx.
        let phase;
        if(running&&(s.kind==='fox'||s.kind==='lynx'))phase=leg.front?(leg.sign>0?.05:.15):(leg.sign>0?.55:.65);
        else phase=leg.front?(leg.sign>0?0:.5):(leg.sign>0?.5:0);
        if(!running)phase=leg.front?(leg.sign>0?0:.5):(leg.sign>0?.75:.25);
        const u=fract(t+phase),foot=leg.paw.clone();let roll=0;
        if(u<duty){foot.z+=stride*(.5-u/duty);}
        else{const swing=(u-duty)/(1-duty),ease=smooth(0,1,swing);foot.z+=stride*(-.5+ease);foot.y+=(running?s.gait.runLift:s.gait.lift)*Math.sin(Math.PI*swing);roll=-.20*Math.sin(Math.PI*swing);}
        // Stride is the full stance sweep. Clip speed = sweep / stance time.
        solveLeg(r,leg,foot,roll);
      }
    },true);
  }
  make('Attack',s.attack,t=>{
    const wind=smooth(0,.23,t)*(1-smooth(.25,.47,t)),strike=smooth(.23,s.contact,t)*(1-smooth(s.contact,.74,t));
    const pitchScale=s.kind==='badger'||s.kind==='porc'?.38:1;
    r.by.Root.position.y=-.028*wind+.023*strike;
    r.by.Spine.rotation.x=(-.10*wind+.12*strike)*pitchScale;r.by.Chest.rotation.x=(-.11*wind+.16*strike)*pitchScale;
    r.by.Neck.rotation.x=(-.10*wind+.16*strike)*pitchScale;r.by.Head.rotation.x=(-.14*wind+.20*strike)*pitchScale;r.by.Jaw.rotation.x=.43*strike+.13*wind;
    if(s.kind==='porc'){r.by.Pelvis.rotation.y=.48*strike;r.by.Spine.rotation.y=-.20*strike;r.by.Head.rotation.y=-.22*strike;r.by.Tail_1.rotation.y=-.70*strike;}
    group.updateMatrixWorld(true);
    for(const leg of r.legs){
      const foot=leg.paw.clone();let roll=0;
      if(leg.front){foot.y+=(s.kind==='lynx'?.16:s.kind==='badger'?.083:.06)*wind;foot.z+=.11*strike;roll=-.24*wind;}
      solveLeg(r,leg,foot,roll);
    }
    for(let i=1;i<=s.tail.length;i++)r.by['Tail_'+i].rotation.x=.08*wind-.09*strike;
  });
  for(const [name,side] of [['Hit',0],['HitLeft',1],['HitRight',-1]])make(name,.70,t=>{
    const hit=Math.sin(Math.PI*smooth(0,.70,t))*Math.exp(-1.3*t);
    r.by.Root.position.y=-.038*hit;r.by.Pelvis.rotation.z=side*.07*hit;r.by.Chest.rotation.z=side*.10*hit;
    r.by.Chest.rotation.x=-.15*hit;r.by.Neck.rotation.x=-.14*hit;r.by.Head.rotation.y=side*.21*hit;r.by.Jaw.rotation.x=.12*hit;allFeet();
  });
  make('Death',1.50,t=>{
    const fold=smooth(.03,.55,t),fall=smooth(.30,.80,t),settle=Math.sin(clamp((t-.78)/.22)*Math.PI)*.025;
    r.by.Root.position.y=-s.hipY*.64*fold+settle;r.by.Root.rotation.z=1.37*fall;r.by.Root.position.x=s.hipY*.35*fall;
    r.by.Spine.rotation.x=.10*fold;r.by.Head.rotation.x=.23*fall;r.by.Jaw.rotation.x=.16*fall;
    for(const leg of r.legs){r.by[leg.name+'_Upper'].rotation.x=(leg.front?-.72:.71)*fold;r.by[leg.name+'_Lower'].rotation.x=(leg.front?1.04:-1.15)*fold;r.by[leg.name+'_Ankle'].rotation.x=(leg.front?-.30:.30)*fold;}
    for(let i=1;i<=s.tail.length;i++)r.by['Tail_'+i].rotation.y=-.10*fall;
  });
  reset();group.updateMatrixWorld(true);return clips;
}

export async function buildSpecies(id){
  const base=SHAPES[id];if(!base)throw new Error('Unknown mammal species '+id);
  const s=base.kind==='fox'?foxAnatomyConfig(base):base.kind==='badger'?badgerAnatomyConfig(base):base.kind==='porc'?porcupineAnatomyConfig(base):base;
  const object=new THREE.Group();object.name=id;
  const r=addRig(s,object),coatSurface=new Surface(),detailSurface=new Surface();
  const {joinedMammal}=await import('./mammals/implicit.mjs');joinedMammal(s,r,coatSurface,coat,profileAt,bodyWeights,pawDesign,pawCoat);
  pawsAndClaws(s,r,coatSurface,detailSurface);tail(s,r,coatSurface);ears(s,r,coatSurface,detailSurface);face(s,r,coatSurface,detailSurface);quills(s,r,coatSurface);
  const skeleton=new THREE.Skeleton(r.bones);
  const texels=new Uint8Array(256*256*4);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const longGrain=noise(x,Math.floor((y+Math.floor(noise(x,1,9)*5))/6),4),fine=noise(x,y,7);
    const shade=Math.round(s.kind==='lynx'?211+longGrain*30+fine*14:226+longGrain*22+fine*7),i=(y*256+x)*4;texels[i]=shade;texels[i+1]=shade;texels[i+2]=shade;texels[i+3]=255;
  }
  const furTexture=new THREE.DataTexture(texels,256,256,THREE.RGBAFormat);furTexture.name=id+'_original_fur_grain';furTexture.colorSpace=THREE.SRGBColorSpace;furTexture.wrapS=furTexture.wrapT=THREE.RepeatWrapping;furTexture.magFilter=THREE.LinearFilter;furTexture.minFilter=THREE.LinearMipmapLinearFilter;furTexture.generateMipmaps=true;furTexture.needsUpdate=true;
  if(s.kind==='lynx')furTexture.repeat.set(3,3);
  const coatMaterial=new THREE.MeshStandardMaterial({name:id+'_painted_fur',map:furTexture,vertexColors:true,roughness:.90,metalness:0,side:THREE.DoubleSide});
  const detailMaterial=new THREE.MeshStandardMaterial({name:id+'_eyes_claws_whiskers',vertexColors:true,roughness:.48,metalness:0,side:THREE.DoubleSide});
  for(const [name,surface,material] of [['Anatomy',coatSurface,coatMaterial],['Face_Claws',detailSurface,detailMaterial]]){
    const mesh=new THREE.SkinnedMesh(surface.build(),material);mesh.name=id+'_'+name;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;object.add(mesh);mesh.bind(skeleton);
  }
  const clips=buildClips(s,r,object);
  const meta={
    is:s.is,tags:s.tags,provenance:'Original Corealm anatomy authored from cross-section fields, integrated shoulder and haunch muscle fields, and tapered articulated limb fields. Their smooth union emits one continuous weighted body mesh. Original painted vertex coats, procedural fur grain, detail surfaces and skeletal animation. No source animal mesh or third-party animation was reused.',
    attackSeconds:s.attack,contactNormalized:s.contact,
    impliedWalkMps:s.gait.stride/(s.gait.walk*.66),impliedRunMps:s.gait.runStride/(s.gait.run*.44),walkClipSeconds:s.gait.walk,runClipSeconds:s.gait.run,
    notes:'Feet follow flat-ground stance trajectories at a constant backwards velocity, with smooth lifted swing arcs. Three limb segments use authored knee bend planes and two-link IK to the hock, plus a controlled distal segment; paw orientation cancels the parent rotation during gait. Root does not translate horizontally in locomotion. Contact is an authored flat-plane assumption, not runtime terrain IK. Stride matching requires the stated implied speed. Idle, Walk and Run have identical first/last poses. Death is an authored collapse rather than a physics ragdoll. Coat colour, markings, ears, feet, face and tail are individually shaped for this species.'
  };
  object.userData={species:id,authoring:'corealm-original',forward:'+Z',groundY:0};
  return {object,clips,meta};
}
