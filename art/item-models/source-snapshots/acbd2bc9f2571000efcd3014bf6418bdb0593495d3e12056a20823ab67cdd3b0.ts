import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const V = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
type Surface = (u:number,v:number)=>THREE.Vector3;
type Mats = ReturnType<typeof materials>;
const ids = ['corven_helm','corven_plate','corven_greaves','corven_boots','corven_gauntlets'] as const;
const descriptions:Record<string,string> = {
  corven_helm:'A full helm with a narrow sight slit.',
  corven_plate:'Three bars of Iron, articulated at the waist so you can still bend to pick things up.',
  corven_greaves:'Plated legs. Slower over a root field, worth it under a husk.',
  corven_boots:'Plated over the toe, soft in the sole. Deepwood floor is not forgiving.',
  corven_gauntlets:'Fingered plate. You can hold a rod in these, badly.',
};

function materials() {
  const n=128, data=new Uint8Array(n*n*4), rough=new Uint8Array(n*n*4), normals=new Uint8Array(n*n*4);
  let seed=274919;
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grain=(seed>>>24)/255, cloud=Math.sin(x*.19+Math.sin(y*.17))*Math.cos(y*.23);
    const i=(y*n+x)*4, c=Math.round(139+grain*20+cloud*9);
    data[i]=c;data[i+1]=c+1;data[i+2]=c+2;data[i+3]=255;
    rough[i]=rough[i+1]=rough[i+2]=Math.round(160+grain*28+cloud*12);rough[i+3]=255;
    normals[i]=Math.round(128+5*Math.cos(x*.19)*Math.cos(y*.23));
    normals[i+1]=Math.round(128-5*Math.sin(x*.19)*Math.sin(y*.23));normals[i+2]=255;normals[i+3]=255;
  }
  const tex=(d:Uint8Array,name:string,color=false)=>{const t=new THREE.DataTexture(d,n,n);t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,3);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.needsUpdate=true;return t;};
  const iron=new THREE.MeshStandardMaterial({color:0xbfc1c2,map:tex(data,'Iron fine mottled forge finish',true),roughnessMap:tex(rough,'Iron uneven polishing'),normalMap:tex(normals,'Shallow iron hammer relief'),metalness:.88,roughness:.76});iron.name='Weathered charcoal iron';
  const edge=new THREE.MeshStandardMaterial({color:0x92928d,metalness:.9,roughness:.46});edge.name='Rubbed iron edges and rivets';
  const leather=new THREE.MeshStandardMaterial({color:0x302016,roughness:.94});leather.name='Dark brown leather backing and straps';
  const lining=new THREE.MeshStandardMaterial({color:0x17120f,roughness:1});lining.name='Shadowed leather interior';
  const stitch=new THREE.MeshStandardMaterial({color:0x8c6c45,roughness:.96});stitch.name='Waxed tan stitching';
  return {iron,edge,leather,lining,stitch};
}
function mesh(g:THREE.Group,name:string,geo:THREE.BufferGeometry,mat:THREE.Material) {const m=new THREE.Mesh(geo,mat);m.name=name;g.add(m);return m;}

/** Closed solid plate from a curved surface, with actual edge walls and an inward skin. */
function plate(g:THREE.Group,name:string,f:Surface,mat:THREE.Material,thickness=.003,nu=24,nv=8) {
  const p:number[]=[],uv:number[]=[],idx:number[]=[];
  for(let side=0;side<2;side++) for(let j=0;j<=nv;j++) for(let i=0;i<=nu;i++) {
    const u=i/nu,v=j/nv,q=f(u,v),du=f(Math.min(1,u+.0001),v).sub(f(Math.max(0,u-.0001),v)),dv=f(u,Math.min(1,v+.0001)).sub(f(u,Math.max(0,v-.0001)));
    const norm=du.cross(dv).normalize();q.addScaledVector(norm,side===0?0:-thickness);p.push(q.x,q.y,q.z);uv.push(u,v);
  }
  const stride=nu+1,N=stride*(nv+1);
  for(let j=0;j<nv;j++) for(let i=0;i<nu;i++) {const a=j*stride+i,b=a+1,c=a+stride,d=c+1;idx.push(a,b,d,a,d,c,N+a,N+d,N+b,N+a,N+c,N+d);}
  const wall=(a:number,b:number)=>idx.push(a,N+a,N+b,a,N+b,b);
  for(let i=0;i<nu;i++){wall(i+1,i);wall(nv*stride+i,nv*stride+i+1);}
  for(let j=0;j<nv;j++){wall(j*stride,(j+1)*stride);wall((j+1)*stride+nu,j*stride+nu);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return mesh(g,name,geo,mat);
}
function line(g:THREE.Group,name:string,pts:THREE.Vector3[],r:number,mat:THREE.Material) {return mesh(g,name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),Math.max(6,pts.length),r,4,false),mat);}
function edge(g:THREE.Group,name:string,f:Surface,mat:THREE.Material,r=.0015) {
  for(const k of [0,1]) {line(g,name+' horizontal '+k,Array.from({length:25},(_,i)=>f(i/24,k)),r,mat);line(g,name+' vertical '+k,Array.from({length:9},(_,i)=>f(k,i/8)),r,mat);}
}
function rivet(g:THREE.Group,name:string,p:THREE.Vector3,m:Mats,r=.004) {const q=mesh(g,name,new THREE.SphereGeometry(r,8,6),m.edge);q.position.copy(p);}
function wrap(cx:number,cz:number,y0:number,y1:number,rx0:number,rx1:number,rz0:number,rz1:number,a0=-Math.PI,a1=Math.PI,ridge=0):Surface {
  return (u,v)=>{const a=a0+(a1-a0)*u,rx=THREE.MathUtils.lerp(rx0,rx1,v),rz=THREE.MathUtils.lerp(rz0,rz1,v);return V(cx+Math.sin(a)*rx,y0+(y1-y0)*v,cz+Math.cos(a)*rz+ridge*Math.max(0,1-Math.abs(a)/.8));};
}
function band(g:THREE.Group,name:string,f:Surface,m:Mats,metal=true) {plate(g,name,f,metal?m.iron:m.leather,.003,16,4);if(metal)edge(g,name+' rolled border',f,m.edge);for(const u of [.08,.3,.7,.92])rivet(g,name+' fastening',f(u,.5),m);}
function buckle(g:THREE.Group,name:string,p:THREE.Vector3,m:Mats,scale=1,rotY=0) {
  const b=new THREE.Group();b.name=name;b.position.copy(p);b.rotation.y=rotY;g.add(b);
  const x=.012*scale,y=.017*scale;
  line(b,'Forged buckle frame',[V(-x,-y,0),V(x,-y,0),V(x,y,0),V(-x,y,0),V(-x,-y,0)],.002*scale,m.edge);
  line(b,'Buckle tongue',[V(0,-y,0),V(0,y*.4,.002)],.0015*scale,m.edge);
}

function helmet(g:THREE.Group,m:Mats) {
  const dome:Surface=(u,v)=>{const a=u*Math.PI*2-Math.PI,t=v*Math.PI/2;return V(Math.sin(a)*.111*Math.cos(t),1.714+.13*Math.sin(t),-.013+Math.cos(a)*.133*Math.cos(t));};
  plate(g,'Raised full iron skull bowl',dome,m.iron,.004,40,18);
  const rear=wrap(0,-.013,1.559,1.719,.106,.111,.119,.133,Math.PI*.43,Math.PI*1.57);
  band(g,'Solid rear and side neck wall',rear,m);
  const visor:Surface=(u,v)=>{const a=(u-.5)*2.64;return V(Math.sin(a)*.116,1.565+v*.137+Math.abs(a)*.011,-.013+Math.cos(a)*.151+.018*Math.max(0,1-Math.abs(a)));};
  band(g,'Ridged lower face plate below open sight slit',visor,m);
  const brow=wrap(0,-.013,1.716,1.743,.115,.113,.153,.139,-1.54,1.54,.012);band(g,'Heavy riveted brow above sight slit',brow,m);
  const neck=wrap(0,-.013,1.532,1.568,.123,.107,.14,.119,-Math.PI,Math.PI,.014);band(g,'Flared throat and neck guard',neck,m);
  const crest:Surface=(u,v)=>{const a=-Math.PI/2+v*Math.PI;return V((.5-u)*.021,1.715+.135*Math.cos(a),-.013+.138*Math.sin(a));};band(g,'Fore to aft reinforcing skull band',crest,m);
  for(const s of [-1,1]){const strap=wrap(0,-.013,1.718,1.738,.116,.116,.142,.142,s*.95,s*1.67);plate(g,'Temple leather hinge strap',strap,m.leather,.004);buckle(g,'Temple buckle',V(s*.112,1.726,.039),m,.55,s*1.1);}
}

function revisedIron(m:Mats):Mats {
  const iron=m.iron.clone();iron.name='Corven softly polished forged iron';iron.normalMap=null;iron.roughness=.65;
  return {...m,iron};
}
function cuirass(g:THREE.Group,input:Mats) {
  const m=revisedIron(input);
  // Each breast/back panel runs continuously from waist to neck with a shaped armhole.
  for(const front of [true,false]) {
    const f:Surface=(u,v)=>{
      const a=(u-.5)*Math.PI*(front?1:-1),side=Math.abs(Math.sin(a));
      const top=1.441+.058*Math.sin(Math.abs(a)*1.8)-.123*Math.pow(side,8);
      const y=1.094+v*(top-1.094),belly=Math.sin(v*Math.PI*.87);
      const rx=.163+.043*belly,rz=.126+.039*belly;
      return V(Math.sin(a)*rx,y,-.018+(front?1:-1)*(Math.cos(a)*rz+.022*Math.max(0,1-Math.abs(a)/.7)));
    };
    plate(g,front?'Continuous peaked breastplate':'Continuous fitted backplate',f,m.iron,.005,32,16);
    edge(g,'Forged panel perimeter',f,m.edge,.002);
    for(const u of [.045,.17,.83,.955])for(const v of [.08,.92])rivet(g,'Panel perimeter rivet',f(u,v),m,.0045);
  }
  // The neck rim and shoulder bridges connect to the panels rather than floating above them.
  const collar:Surface=(u,v)=>{const a=u*Math.PI*2;return V(Math.sin(a)*(.082+v*.004),1.434+v*.035+Math.max(0,-Math.cos(a))*.022,-.018+Math.cos(a)*(.156-v*.012));};
  band(g,'Raised open gorget rim',collar,m);
  for(const sign of [-1,1]) {
    const bridge:Surface=(u,v)=>V(sign*(.093+(sign>0?1-u:u)*.096),1.46+.048*Math.sin(v*Math.PI)-u*.018,-.168+v*.326);
    plate(g,'Solid iron shoulder bridge '+sign,bridge,m.iron,.004,12,16);edge(g,'Shoulder bridge edge '+sign,bridge,m.edge);
    const strap:Surface=(u,v)=>bridge(.31+u*.24,v).add(V(0,.006,0));plate(g,'Leather shoulder suspension '+sign,strap,m.leather,.004);
    buckle(g,'Shoulder suspension buckle '+sign,V(sign*.136,1.49,.106),m,.8);
    for(let k=0;k<3;k++) {
      const f:Surface=(u,v)=>{const a=(u-.5)*Math.PI*1.22*sign;return V(sign*(.183+k*.045+v*.07),1.448+Math.cos(a)*(.085-k*.011),-.057+Math.sin(a)*(.116-k*.008));};
      band(g,'Nested curved pauldron '+sign+' '+k,f,m);
    }
    for(const y of [1.17,1.276]) {
      const t=(y-1.094)/.35,rx=.163+.043*Math.sin(t*Math.PI*.87)+.004,rz=.126+.039*Math.sin(t*Math.PI*.87)+.004;
      const f=wrap(0,-.018,y-.013,y+.013,rx,rx,rz,rz,sign*1.03,sign*2.1);
      plate(g,'Attached side leather closure '+sign+' '+y,f,m.leather,.004);
      buckle(g,'Side closure buckle '+sign+' '+y,V(sign*rx,y,-.018),m,.85,sign*Math.PI/2);
    }
  }
  for(let k=0;k<3;k++) {
    const f:Surface=(u,v)=>{const a=u*Math.PI*2-Math.PI;const flare=k*.011+(1-v)*.013;return V(Math.sin(a)*(.163+flare),1.099-k*.053+v*.018-(1-v)*.042-.02*Math.max(0,Math.cos(a)), -.018+Math.cos(a)*(.126+flare)+.022*Math.max(0,1-Math.abs(a)/.7));};
    band(g,'Three-bar articulated fauld '+k,f,m);
  }
  // A visible rear waist closure is seated against the backplate.
  const rear=wrap(0,-.018,1.135,1.161,.18,.18,.145,.145,2.4,3.88);plate(g,'Rear leather waist reinforcement',rear,m.leather,.004);
  buckle(g,'Rear waist buckle',V(0,1.148,-.165),m,.8,Math.PI);
}

function greaves(g:THREE.Group,input:Mats) {
  const m=revisedIron(input);
  m.edge=m.edge.clone();m.edge.name='Bright exposed Corven greave bevels';m.edge.color.setHex(0xd2d4ce);m.edge.roughness=.3;
  const framed=(name:string,f:Surface,nu=24,nv=12)=>{
    plate(g,name,f,m.iron,.006,nu,nv);
    // Wide raised steel bevel strips, rather than hairline tubes, read at gameplay scale.
    for(const side of [0,1]) {
      const horizontal:Surface=(u,v)=>f(u,side===0?v*.065:1-v*.065).add(V(0,0,.002));
      const vertical:Surface=(u,v)=>f(side===0?u*.033:1-u*.033,v).add(V(0,0,.002));
      plate(g,name+' transverse bevel '+side,horizontal,m.edge,.002,nu,2);
      plate(g,name+' edge bevel '+side,vertical,m.edge,.002,2,nv);
    }
    for(const u of [.075,.925])for(const v of [.1,.88])rivet(g,name+' peened fixing',f(u,v).add(V(0,0,.003)),m,.005);
  };
  for(const sign of [-1,1]) {
    const x=sign*.1143,z=-.036;
    const oldRadius=(y:number)=>y>.60? .077+.028*Math.min(1,(y-.60)/.32):.051+.033*Math.sin(Math.min(1,Math.max(0,(y-.15)/.37))*Math.PI*.65);
    const foundation=(y0:number,y1:number):Surface=>(u,v)=>{const y=THREE.MathUtils.lerp(y0,y1,v),a=u*Math.PI*2,r=oldRadius(y);return V(x+Math.sin(a)*r,y,z+Math.cos(a)*(r+.012));};
    // Keep the accepted fitted leather lining, with armor volumes shaped independently above it.
    plate(g,'Fitted leather thigh lining '+sign,foundation(.589,.938),m.leather,.004,32,14);
    plate(g,'Fitted leather calf lining '+sign,foundation(.145,.51),m.leather,.004,32,14);
    const thigh:Surface=(u,v)=>{
      const a=(u-.5)*3.5,waist=.081+.03*Math.pow(v,1.5),crest=.023*Math.max(0,1-Math.abs(a)/.7);
      return V(x+Math.sin(a)*waist,.615+v*.315+.017*Math.sin(a)*sign-.02*(1-v)*Math.cos(a),z+Math.cos(a)*(waist+.022)+crest);
    };
    framed('Tapered forged thigh cuisse '+sign,thigh);
    const thighTop:Surface=(u,v)=>thigh(u,.895+v*.105).add(V(0,0,.005));
    framed('Raised angled cuisse mouth band '+sign,thighTop,24,3);
    const calfRadius=(v:number)=>.057+.037*Math.exp(-Math.pow((v-.7)/.31,2))+.012*v;
    const shin:Surface=(u,v)=>{
      const a=(u-.5)*3.5,r=calfRadius(v),ridge=.028*Math.max(0,1-Math.abs(a)/.62);
      return V(x+Math.sin(a)*r,.16+v*.347+.015*Math.abs(a)*(1-v),z+Math.cos(a)*(r+.023)+ridge);
    };
    framed('Anatomical calf and tapered ridged shin '+sign,shin,24,18);
    // Distinct narrow facets meet at the shin ridge and catch separate highlights.
    for(const side of [-1,1]) {
      const ridge:Surface=(u,v)=>shin(.5+side*u*.043,v).add(V(0,0,.0025));plate(g,'Forged shin ridge facet '+sign+' '+side,ridge,m.edge,.002,2,18);
    }
    // Each knee has a projecting shield face and two separate pointed overlap lames.
    plate(g,'Flexible leather knee rear '+sign,wrap(x,z,.488,.613,.088,.086,.094,.094),m.leather,.004);
    for(const y of [.473,.597]) {
      const f:Surface=(u,v)=>{const a=(u-.5)*3.7;return V(x+Math.sin(a)*(.094-.004*v),y+v*.043-.03*Math.max(0,Math.cos(a)),z+Math.cos(a)*(.123-.009*v));};
      framed('Pointed knee articulation lame '+sign+' '+y,f,24,4);
    }
    const knee:Surface=(u,v)=>{
      const a=(u-.5)*2.95,t=(v-.5)*2,w=.093*(1-.3*Math.pow(Math.abs(t),1.4));
      return V(x+Math.sin(a)*w,.547+t*.062,z+Math.cos(a)*(.119+.046*Math.cos(t*Math.PI/2))+.012*Math.max(0,1-Math.abs(a)/.5));
    };
    framed('Projecting shield-shaped poleyn '+sign,knee,24,14);
    for(const y of [.206,.39,.547,.675,.866]) {
      const r=(y>.51&&y<.61?.092:oldRadius(y)+.008);
      const f=wrap(x,z,y-.013,y+.013,r,r,r+.015,r+.015,1.35,Math.PI*2-1.35);
      plate(g,'Attached rear closure strap '+sign+' '+y,f,m.leather,.005,24,3);
      const a=sign*1.65;const pos=V(x+Math.sin(a)*(r+.003),y,z+Math.cos(a)*(r+.018));
      buckle(g,'Rear side closure buckle '+sign+' '+y,pos,m,.83,sign*Math.PI/2);
      // Paired visible metal anchor tabs bridge leather to the side edge of each shell.
      for(const a of [1.5,Math.PI*2-1.5]) {
        const tab=wrap(x,z,y-.019,y+.019,r+.003,r+.003,r+.019,r+.019,a-.12,a+.12);
        plate(g,'Riveted strap anchor tab '+sign+' '+y,tab,m.iron,.004,4,3);
        rivet(g,'Closure anchor rivet '+sign+' '+y,tab(.5,.5),m,.0045);
      }
    }
    const flare:Surface=(u,v)=>{const a=(u-.5)*3.55;return V(x+Math.sin(a)*(.074-v*.013),.139+v*.045+.012*Math.abs(a),z+Math.cos(a)*(.098-v*.016)+.023*Math.max(0,1-Math.abs(a)/.65));};
    framed('Flared armored ankle mouth '+sign,flare,24,4);
    // Back panels are split at the knee; each has a physical seam and leather closures.
    for(const [lo,hi] of [[.165,.49],[.62,.918]] as const) {
      const seam=Array.from({length:18},(_,i)=>{const y=lo+(hi-lo)*i/17;return V(x,y,z-oldRadius(y)-.014);});
      line(g,'Rear leather seam '+sign+' '+lo,seam,.002,m.stitch);
    }
  }
}

function boots(g:THREE.Group,input:Mats) {
  const m=revisedIron(input);
  for(const sign of [-1,1]) {
    const x=sign*.1143;
    // Continuous toe-to-heel upper: transverse vaults follow a rising instep and close at both ends.
    const upper:Surface=(u,v)=>{const a=(.5-u)*Math.PI,z=-.151+v*.343;const width=.062*Math.pow(Math.sin(v*Math.PI),.34)+.003;const h=.064+.081*Math.exp(-Math.pow((v-.24)/.23,2));return V(x+Math.sin(a)*width,.027+Math.cos(a)*h,z);};
    plate(g,'Continuous leather boot upper',upper,m.leather,.005,24,28);
    const sole=wrap(x,.02,.009,.031,.069,.069,.173,.173);plate(g,'Thick layered leather sole',sole,m.leather,.006,40,3);
    const shaft:Surface=(u,v)=>{const a=u*Math.PI*2;const y=.085+v*.216;const r=.053+.013*v+.005*Math.sin(v*Math.PI*3);return V(x+Math.sin(a)*r,y,-.077+Math.cos(a)*(r+.014)+.02*(1-v)*Math.max(0,Math.cos(a)));};
    plate(g,'Shaped ankle shaft with leather folds',shaft,m.leather,.006,32,14);
    line(g,'Rolled leather cuff',Array.from({length:41},(_,i)=>shaft(i/40,1)),.003,m.leather);
    // A toe cap and two sloped instep plates conform to the same upper and have no central holes.
    for(const [label,v0,v1] of [['Iron toe cap',.77,.985],['Iron forward instep plate',.53,.72],['Iron raised instep plate',.32,.51]] as const) {
      const f:Surface=(u,v)=>upper(u,THREE.MathUtils.lerp(v0,v1,v)).add(V(0,.004,0));band(g,label+' '+sign,f,m);
    }
    const ankle:Surface=(u,v)=>{const a=(u-.5)*2.9,y=.163+v*.1-.023*Math.cos(a)*(1-v),r=.061+.008*v;return V(x+Math.sin(a)*r,y,-.077+Math.cos(a)*(r+.017));};band(g,'Shield-shaped front ankle plate',ankle,m);
    const heel=wrap(x,-.077,.037,.137,.061,.059,.073,.078,1.55,4.73);band(g,'Iron heel counter',heel,m);
    for(const y of [.131,.267]) {
      const v=(y-.085)/.216,r=.053+.013*v+.005*Math.sin(v*Math.PI*3)+.004;
      const f=wrap(x,-.077,y-.012,y+.012,r,r,r+.016,r+.016,-Math.PI,Math.PI);plate(g,'Fitted leather ankle buckle strap',f,m.leather,.004,32,3);
      buckle(g,'Ankle buckle with tongue',V(x+sign*(r+.002),y,-.061),m,.8,sign*Math.PI/2);
    }
    for(let i=0;i<46;i++) {const a=i*Math.PI*2/46;line(g,'Stitched sole welt '+i,[V(x+Math.sin(a)*.069,.032,.02+Math.cos(a)*.173),V(x+Math.sin(a+.035)*.069,.033,.02+Math.cos(a+.035)*.173)],.0015,m.stitch);if(i%3===0)rivet(g,'Sole welt stud '+i,V(x+Math.sin(a)*.069,.022,.02+Math.cos(a)*.173),m,.0023);}
    for(const u of [.1,.9]) {
      for(let i=0;i<16;i++)line(g,'Shaft stitched seam '+u+' '+i,[shaft(u,.04+i*.059).add(V(0,0,.001)),shaft(u,.067+i*.059).add(V(0,0,.001))],.0009,m.stitch);
    }
  }
}

function gloves(g:THREE.Group,m:Mats) {
  for(const s of [-1,1]) {
    const hand=new THREE.Group();hand.name='Articulated T pose gauntlet '+s;hand.position.set(s*.7065,1.4555,-.0654);hand.rotation.z=-s*Math.PI/2;g.add(hand);
    plate(hand,'Open leather wrist cuff',wrap(0,0,-.13,.012,.045,.035,.043,.027),m.leather,.003);
    band(hand,'Flared iron forearm cuff',wrap(0,0,-.132,-.035,.048,.035,.046,.031,-1.9,1.9,.006),m);
    band(hand,'Riveted cuff mouth',wrap(0,0,-.133,-.116,.05,.048,.048,.045,-1.9,1.9),m);
    for(const y of [-.039,-.012])band(hand,'Overlapping wrist lame '+y,wrap(0,0,y,y+.029,.037,.039,.032,.03,-1.8,1.8,.004),m);
    const palm:Surface=(u,v)=>{const a=u*Math.PI*2;return V(Math.sin(a)*(.036+.006*Math.sin(v*Math.PI)),.009+v*.079,Math.cos(a)*.025);};plate(hand,'Leather palm and back',palm,m.leather,.004);
    band(hand,'Back of hand plate',wrap(0,0,.017,.066,.039,.043,.03,.029,-1.5,1.5,.006),m);
    const knuckle:Surface=(u,v)=>{const x=(u-.5)*.087;return V(x,.063+v*.027,.027+.006*Math.cos(u*Math.PI*8)+.006*Math.sin(v*Math.PI));};band(hand,'Scalloped four knuckle shield',knuckle,m);
    for(let f=0;f<4;f++) {
      const fx=(f-1.5)*.021,length=[.066,.083,.077,.057][f]!;
      const finger=new THREE.Group();finger.name='Finger '+f;finger.position.set(fx,.082,0);finger.rotation.z=(1.5-f)*.055;hand.add(finger);
      const core=mesh(finger,'Leather finger',new THREE.CapsuleGeometry(.009,length-.018,4,8),m.leather);core.position.y=length/2;
      for(let k=0;k<3;k++){const y=k*length/3+.003;band(finger,'Finger articulated iron segment '+k,wrap(0,0,y,y+length/3-.003,.01,.009,.012,.011,-1.7,1.7),m);}
    }
    const thumb=new THREE.Group();thumb.name='Opposed thumb';thumb.position.set(-.035,.038,0);thumb.rotation.z=.55;hand.add(thumb);
    const core=mesh(thumb,'Leather thumb',new THREE.CapsuleGeometry(.012,.045,4,8),m.leather);core.position.y=.028;
    for(let k=0;k<3;k++)band(thumb,'Thumb hinged plate '+k,wrap(0,0,k*.02,k*.02+.022,.014,.012,.015,.014,-1.8,1.8),m);
    plate(hand,'Leather wrist fastening',wrap(0,0,-.068,-.052,.043,.043,.037,.037,.8,5.6),m.leather,.003);buckle(hand,'Wrist buckle',V(.041,-.06,.012),m,.45,1.2);
  }
}

export const author:ItemModelAuthor = {
  ids,
  build(id:string) {
    if(!ids.includes(id as typeof ids[number]))throw new Error('Unknown Corven armor '+id);
    const g=new THREE.Group();g.name=id;const m=materials();
    g.userData.itemModel={itemId:id,author:'armor-corven',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]!,wearable:true};
    if(id==='corven_helm')helmet(g,m);else if(id==='corven_plate')cuirass(g,m);else if(id==='corven_greaves')greaves(g,m);else if(id==='corven_boots')boots(g,m);else gloves(g,m);
    return g;
  },
};



