import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
const V = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
type Pt = THREE.Vector3;
type Mat = THREE.MeshStandardMaterial;
type Row = readonly [number,number,number,number?];

function leather(name:string, color:number):Mat {
  const size=128, pixels=new Uint8Array(size*size*4), normals=new Uint8Array(size*size*4);
  let seed=819;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grain=(seed>>>24)/255, crease=Math.sin(x*.36+Math.sin(y*.17)*3)*Math.sin(y*.41);
    const i=(y*size+x)*4, c=220+Math.round(grain*24+crease*10);
    pixels.set([c,c,c,255],i);
    normals.set([128+Math.round(crease*5),128+Math.round(Math.cos(y*.41)*4),255,255],i);
  }
  const make=(bytes:Uint8Array,name:string) => {const t=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat); t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(4,4);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;};
  const map=make(pixels,name+' fine hide grain');map.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.MeshStandardMaterial({color,map,normalMap:make(normals,name+' mild pore relief'),roughness:.53});m.name=name;return m;
}
function palette() {
  const plain=(name:string,color:number,roughness:number,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});m.name=name;return m;};
  return {hide:leather('Waxed walnut brown hide',0x6c5039),olive:leather('Weathered olive hide inserts',0x666044),edge:leather('Rolled dark leather binding',0x35251c),lining:leather('Suede interior',0x292017),thread:plain('Ochre saddle stitching',0xbd9860,.83),horn:plain('Amber brown bramble thorns',0x9b7440,.44),metal:plain('Dull aged brass hardware',0x766044,.42,.65),sole:plain('Dark leather sole and fur',0x241c17,.93)};
}
type Palette = ReturnType<typeof palette>;
function mesh(g:THREE.Group,name:string,geo:THREE.BufferGeometry,m:Mat) {const o=new THREE.Mesh(geo,m);o.name=name;g.add(o);return o;}
function pipe(g:THREE.Group,name:string,pts:Pt[],r:number,m:Mat,closed=false) {
  const c=new THREE.CatmullRomCurve3(pts,closed,'centripetal');
  return mesh(g,name,new THREE.TubeGeometry(c,Math.max(4,pts.length-1),r,5,closed),m);
}
function stitch(g:THREE.Group,name:string,pts:Pt[],m:Mat,step=.013) {
  const c=new THREE.CatmullRomCurve3(pts,false,'centripetal'),n=Math.max(2,Math.ceil(c.getLength()/step));
  for(let i=0;i<n;i++) {const a=c.getPoint((i+.16)/n),b=c.getPoint((i+.66)/n); const mid=a.clone().lerp(b,.5);const o=mesh(g,name+' stitch '+i,new THREE.CapsuleGeometry(.0015,a.distanceTo(b),1,3),m);o.position.copy(mid);o.quaternion.setFromUnitVectors(V(0,1,0),b.sub(a).normalize());}
}
/** A two-sided sewn hide panel, with real inner surface and joined perimeter. */
function sheet(g:THREE.Group,name:string,fn:(u:number,v:number)=>Pt,nu:number,nv:number,m:Mat,inner:Mat,thickness=.006) {
  const points:Pt[]=[],uv:number[]=[],idx:number[]=[];
  for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){points.push(fn(i/nu,j/nv));uv.push(i/nu,j/nv);}
  const count=points.length;
  const outward:Pt[]=[];
  for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++) {
    const du=fn(Math.min(1,(i+.1)/nu),j/nv).sub(fn(Math.max(0,(i-.1)/nu),j/nv));
    const dv=fn(i/nu,Math.min(1,(j+.1)/nv)).sub(fn(i/nu,Math.max(0,(j-.1)/nv)));
    outward.push(du.cross(dv).normalize());
  }
  const pos=points.flatMap(p=>p.toArray());
  for(let i=0;i<count;i++)pos.push(...points[i]!.clone().addScaledVector(outward[i]!,-thickness).toArray());
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;idx.push(a,b,c,b,d,c);}
  const outerCount=idx.length;
  for(let k=0;k<outerCount;k+=3)idx.push(idx[k]!+count,idx[k+2]!+count,idx[k+1]!+count);
  const edges:number[][]=[];
  for(let i=0;i<nu;i++){edges.push([i+1,i],[nv*(nu+1)+i,nv*(nu+1)+i+1]);}
  for(let j=0;j<nv;j++){edges.push([j*(nu+1),(j+1)*(nu+1)],[(j+1)*(nu+1)+nu,j*(nu+1)+nu]);}
  for(const [a,b] of edges)idx.push(a!,b!,a!+count,b!,b!+count,a!+count);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute([...uv,...uv],2));geo.setIndex(idx);geo.computeVertexNormals();geo.addGroup(0,outerCount,0);geo.addGroup(outerCount,idx.length-outerCount,1);
  const o=new THREE.Mesh(geo,[m,inner]);o.name=name;g.add(o);return fn;
}
function rowAt(rows:readonly Row[],t:number):Row {
  const q=t*(rows.length-1),i=Math.min(rows.length-2,Math.floor(q)),f=q-i,a=rows[i]!,b=rows[i+1]!;
  return [THREE.MathUtils.lerp(a[0],b[0],f),THREE.MathUtils.lerp(a[1],b[1],f),THREE.MathUtils.lerp(a[2],b[2],f),THREE.MathUtils.lerp(a[3]??0,b[3]??0,f)];
}
function tube(g:THREE.Group,name:string,rows:readonly Row[],m:Mat,p:Palette,centerX=0,start=0,end=TAU,fold=.002) {
  const fn=(u:number,v:number)=>{const [y,rx,rz,z]=rowAt(rows,v),a=start+(end-start)*u,f=fold*Math.sin(a*7+v*11)*Math.sin(Math.PI*v);return V(centerX+(rx+f)*Math.sin(a),y,(z??0)+(rz+f)*Math.cos(a));};
  // Clockwise around Y crossed with upward rows points outward.
  sheet(g,name,fn,30,Math.max(4,rows.length*3),m,p.lining);return fn;
}
function trim(g:THREE.Group,name:string,fn:(u:number,v:number)=>Pt,p:Palette,v:number,closed=false) {
  const pts=Array.from({length:49},(_,i)=>fn(i/48,v));pipe(g,name+' piping',pts,.0025,p.edge,closed);stitch(g,name,pts.map(q=>q.clone().add(V(0,.003,.0015))),p.thread);
}
function thorn(g:THREE.Group,p:Palette,pos:Pt,dir:Pt,length=.021) {
  const o=mesh(g,'Curved seam bramble thorn',new THREE.ConeGeometry(length*.24,length,6),p.horn);o.position.copy(pos).addScaledVector(dir,length*.4);o.quaternion.setFromUnitVectors(V(0,1,0),dir.clone().normalize());
}
function buckle(g:THREE.Group,p:Palette,pos:Pt,r=.022) {const o=mesh(g,'Forged brass ring fastening',new THREE.TorusGeometry(r,.004,6,20),p.metal);o.position.copy(pos);pipe(g,'Leather fastening tongue',[pos.clone().add(V(-r*1.5,0,.005)),pos.clone().add(V(r*1.5,-.004,.006))],.006,p.hide);}

function hood(g:THREE.Group,p:Palette) {
  // One continuous horizontal-ring surface runs from shoulder hem to crown.
  // The varying front cut opens around the cheeks and closes at the brow;
  // there are no separate dome, cylinder, or nape pieces to leave a slit.
  const profile = new THREE.CatmullRomCurve3([
    V(.238,1.425,.174),V(.209,1.45,.16),V(.159,1.48,.139),
    V(.121,1.515,.123),V(.11,1.56,.13),V(.12,1.62,.145),
    V(.127,1.69,.151),V(.124,1.745,.151),V(.108,1.788,.147),
    V(.079,1.822,.122),V(.045,1.843,.078),V(.001,1.852,.001),
  ],false,'centripetal');
  const smooth=(a:number,b:number,t:number)=>{const q=THREE.MathUtils.clamp((t-a)/(b-a),0,1);return q*q*(3-2*q);};
  const fn=(u:number,v:number)=>{
    const q=profile.getPoint(v),y=q.y;
    const opening=(.15+.76*smooth(1.49,1.63,y))*(1-smooth(1.755,1.832,y));
    const angle=opening+(TAU-2*opening)*u;
    const zCenter=-.024+.012*smooth(1.54,1.66,y)-.027*smooth(1.79,1.852,y);
    const foldEnvelope=Math.exp(-Math.pow((y-1.51)/.061,2));
    const fold=.007*foldEnvelope*Math.sin(angle*3+v*18)+.002*Math.sin(angle*5+v*7)*Math.sin(Math.PI*v);
    return V((q.x+fold)*Math.sin(angle),y+foldEnvelope*.002*Math.sin(angle*4),zCenter+(q.z+fold)*Math.cos(angle));
  };
  sheet(g,'Continuous tailored hood crown nape and shoulder cowl',fn,64,80,p.hide,p.lining,.007);
  trim(g,'Cowl bound shoulder hem',fn,p,0);
  for(const side of [0,1]) {
    const facing=(u:number,v:number)=>{const q=fn(side===0?u*.055:1-u*.055,.03+v*.825);const d=V(q.x,0,q.z+.024).normalize();return q.addScaledVector(d,.003+.005*Math.sin(u*Math.PI));};
    sheet(g,'Broad turned hood aperture facing '+side,facing,6,42,p.hide,p.lining,.007);
    const edge=Array.from({length:44},(_,i)=>facing(1,i/43));pipe(g,'Raised inner face binding',edge,.0035,p.edge);stitch(g,'Face facing outer saddle stitch',edge,p.thread,.012);
  }
  for(let k=0;k<3;k++) {
    const fold=(u:number,v:number)=>{const q=fn(u,.105+k*.05+v*.048+.018*Math.sin(u*TAU+k));return q.addScaledVector(V(q.x,0,q.z+.024).normalize(),.004+.012*Math.sin(v*Math.PI));};
    sheet(g,'Heavy draped nape and shoulder fold '+k,fold,40,5,k===1?p.olive:p.hide,p.lining,.006);
    const edge=Array.from({length:36},(_,i)=>fold(i/35,0));pipe(g,'Cowl folded hide lip',edge,.003,p.edge);
  }

  // The paired front edges form one shaped face aperture and its open cowl slit.
  for(const edge of [0,1]) {
    const lip=Array.from({length:65},(_,i)=>fn(edge,i/64*.862));
    pipe(g,'Continuous rolled face and cowl edge',lip,.0045,p.edge);
    stitch(g,'Face aperture saddle stitching',lip.map(q=>q.clone().add(V(edge===0?.003:-.003,0,-.001))),p.thread,.011);
  }
  // Long meridian seams follow the same continuous cloth surface from the
  // shoulder through the crown, including the inferred complete rear tailoring.
  for(const u of [.2,.5,.8]) {
    const pts=Array.from({length:48},(_,i)=>fn(u,.035+i/47*.957));
    pipe(g,'Continuous hood panel joining welt',pts,.0027,p.edge);
    stitch(g,'Crown and nape joining stitch',pts.map(q=>q.clone().add(V(u<.5?.003:-.003,.001,0))),p.thread,.013);
    for(const v of [.43,.58,.70,.79,.86]){const q=fn(u,v);thorn(g,p,q,V(q.x,(q.y-1.66)*1.7,q.z+.025).normalize(),.026);}
  }
  const crown=Array.from({length:25},(_,i)=>fn(.5,.70+i/24*.295));
  pipe(g,'Rear crown folded leather ridge',crown,.0035,p.edge);
  const clasp=V(0,1.463,.14);buckle(g,p,clasp,.015);
  for(const sign of [-1,1]){const tab=(u:number,v:number)=>V(sign*(.011+.049*u),1.45+.026*v-.006*Math.sin(u*Math.PI),.142-.009*u);sheet(g,'Clasp sewn leather anchor '+sign,tab,5,3,p.hide,p.lining,.005);for(const v of [0,1])stitch(g,'Clasp anchor stitching',Array.from({length:8},(_,i)=>tab(i/7,v)),p.thread,.008);}
  thorn(g,p,V(.013,1.463,.153),V(1,0,.1).normalize(),.019);
}

function robe(g:THREE.Group,p:Palette) {
  const rows:Row[]=[[.175,.345,.23,-.015],[.34,.301,.211,-.019],[.56,.253,.195,-.02],[.78,.206,.169,-.02],[1.01,.164,.134,-.015],[1.10,.149,.119,-.004],[1.24,.172,.146,-.004],[1.38,.191,.16,-.019],[1.465,.169,.134,-.027]];
  const body=(u:number,v:number)=>{const [y,rx,rz,z]=rowAt(rows,v),a=.12+(TAU-.24)*u;const drape=.019*Math.sin(a*9+.8*Math.sin(v*4))*(1-.58*v),gather=.009*Math.exp(-Math.pow((y-1.02)/.11,2))*Math.sin(a*15+v*22);return V((rx+drape+gather)*Math.sin(a),y,(z??0)+(rz+drape+gather)*Math.cos(a));};
  sheet(g,'Long deeply folded waxed leather coat',body,56,58,p.hide,p.lining,.009);
  // Closed chest underlap and shoulder yoke prevent see-through gaps when the
  // layered front panels and sleeves move independently in a casting pose.
  tube(g,'Continuous chest and shoulder leather lining',[[1.04,.157,.132,-.007],[1.20,.178,.147,-.006],[1.36,.199,.166,-.02],[1.445,.216,.148,-.024],[1.494,.083,.086,-.029]],p.hide,p,0,0,TAU,.003);
  for(const [from,to] of [[.025,.195],[.21,.38],[.40,.60],[.62,.79],[.805,.975]]) {
    const petal=(u:number,v:number)=>{const q=body(from!+(to!-from!)*u,.025+v*.60+.025*Math.sin(u*Math.PI));const d=V(q.x,0,q.z+.018).normalize();return q.addScaledVector(d,.009+.009*Math.sin(u*Math.PI)*Math.sin(v*Math.PI));};
    sheet(g,'Overlapping heavy coat skirt panel '+from,petal,12,30,(from===.21||from===.62)?p.olive:p.hide,p.lining,.009);
    for(const edge of [0,1]){const pts=Array.from({length:31},(_,i)=>petal(edge,i/30));pipe(g,'Skirt overlap raised binding',pts,.004,p.edge);stitch(g,'Skirt overlap saddle stitching',pts,p.thread,.015);}
    trim(g,'Layered skirt panel lower border',petal,p,0);
  }

  trim(g,'Double weight robe hem',body,p,0);
  for(const a of [0,.14,.32,.5,.68,.86,1]) {const pts=Array.from({length:42},(_,i)=>body(a,i/41));pipe(g,'Long tailored panel welt',pts,.0027,p.edge);stitch(g,'Long robe panel saddle stitch',pts.map(q=>q.clone().add(V(0,0,.0015))),p.thread,.015);}
  // Broad olive inset gores retain the long skirt folds and rear paneling.
  for(const [a,b] of [[.09,.19],[.34,.43],[.57,.66],[.81,.91]]) {
    const fn=(u:number,v:number)=>{const q=body(a!+(b!-a!)*u,v*.61);return q.addScaledVector(V(q.x,0,q.z+.018).normalize(),.004);};sheet(g,'Olive inset skirt gore',fn,8,28,p.olive,p.lining,.002);
  }
  const belt=tube(g,'Wraparound narrow waist belt',[[1.062,.17,.145,-.005],[1.106,.168,.143,-.005]],p.edge,p);trim(g,'Belt bottom stitching',belt,p,0);trim(g,'Belt top stitching',belt,p,1);buckle(g,p,V(.032,1.085,.151),.025);
  const tail=(u:number,v:number)=>V(.03+u*.034+.02*v,1.075-v*.28,.165+.012*Math.sin(v*3));sheet(g,'Loose stitched belt tail',tail,3,14,p.hide,p.lining);for(const u of [.1,.9])stitch(g,'Belt tail seam',Array.from({length:14},(_,i)=>tail(u,i/13)),p.thread);
  for(const side of [-1,1]) {
    const chest=(u:number,v:number)=>{const x=side*(.014+u*(.142+.018*v)),y=1.105+v*.287,z=.151-.012*u+.027*Math.sin(u*Math.PI)*Math.sin(v*Math.PI);return V(x,y,z);};
    sheet(g,'Padded diagonal wrap chest panel '+side,chest,12,18,p.hide,p.lining,.011);
    for(let k=0;k<2;k++){const pleat=(u:number,v:number)=>{const q=chest(u,.18+k*.25+v*.115+.17*u);q.z+=.006+.01*Math.sin(v*Math.PI);return q;};sheet(g,'Gathered underarm chest fold',pleat,12,5,p.olive,p.lining,.005);}
    const hip=(u:number,v:number)=>{const a=side*(.32+u*1.05),y=.90+v*.17+.04*Math.sin(u*Math.PI),r=.19-.018*v;return V(r*Math.sin(a),y,-.008+(.157+.01*Math.sin(u*Math.PI))*Math.cos(a));};sheet(g,'Overlapping curved hip flap '+side,hip,15,8,p.hide,p.lining,.01);trim(g,'Hip flap heavy border',hip,p,0);
  }
  const collar=tube(g,'Open standing leather collar',[[1.421,.114,.107,-.027],[1.495,.092,.088,-.032],[1.536,.09,.086,-.034]],p.hide,p,0,.28,TAU-.28,0);trim(g,'Standing collar lip',collar,p,1);
  for(const s of [-1,1]) {
    const lapel=(u:number,v:number)=>V(s*(.02+v*.135+u*(.027+.055*v)),1.205+v*.26,.181-.014*v+u*.008+.014*Math.sin(u*Math.PI));
    sheet(g,'Broad folded front lapel '+s,lapel,5,15,p.olive,p.lining,.007);for(const u of [0,1]){const pts=Array.from({length:16},(_,i)=>lapel(u,i/15));pipe(g,'Lapel binding',pts,.003,p.edge);stitch(g,'Lapel stitching',pts,p.thread);}
    const sleeve=new THREE.Group();sleeve.name='Native sideways sleeve '+s;g.add(sleeve);
    const sf=tube(sleeve,'Folded sleeve hide',[[0,.092,.094],[.12,.083,.083],[.23,.07,.073],[.33,.068,.068],[.43,.08,.073]],p.olive,p,0,0,TAU,.005);trim(sleeve,'Flared sleeve cuff',sf,p,1);
    const cuff=tube(sleeve,'Deep turned leather cuff',[[.32,.073,.074],[.37,.078,.078],[.43,.086,.08]],p.hide,p);trim(sleeve,'Cuff lower stitched border',cuff,p,0);trim(sleeve,'Cuff upper stitched border',cuff,p,1);
    for(let k=0;k<3;k++) {const mantle=tube(sleeve,'Overlapping shoulder leaf '+k,[[k*.054,.104-k*.005,.111-k*.003],[.085+k*.054,.107-k*.009,.107-k*.004]],p.hide,p,0,-Math.PI/2,Math.PI/2,.002);trim(sleeve,'Shoulder leaf border',mantle,p,1);if(k===0)for(let j=0;j<3;j++)thorn(sleeve,p,mantle(.2+j*.3,.65),V(0,0,1),.019);}
    for(let k=0;k<2;k++) {
      const shell=(u:number,v:number)=>{const a=-Math.PI*.90+u*Math.PI*1.8,r=.108-k*.01+.008*Math.sin(v*Math.PI);return V(r*Math.sin(a),.025+k*.082+v*.115-.022*Math.cos(a),r*Math.cos(a));};
      sheet(sleeve,'Broad padded overlapping shoulder cape '+k,shell,26,10,p.hide,p.lining,.011);trim(sleeve,'Heavy shoulder cape scallop',shell,p,1);
      for(const u of [.25,.75]){const seam=Array.from({length:15},(_,i)=>shell(u,i/14));stitch(sleeve,'Shoulder cape panel seam',seam,p.thread);}
    }
    for(let k=0;k<2;k++){const roll=(u:number,v:number)=>{const a=u*TAU,y=.215+k*.044+v*.022,r=.073+.008*Math.sin(v*Math.PI);return V(r*Math.sin(a),y,.074*Math.cos(a));};sheet(sleeve,'Gathered elbow sleeve fold',roll,24,5,p.olive,p.lining,.004);}
    sleeve.rotation.z=-s*Math.PI/2;sleeve.position.set(s*.215,1.4555,-.0654);
  }
}

function leggings(g:THREE.Group,p:Palette) {
  for(const s of [-1,1]){
    const cx=s*.1143;
    const rows:Row[]=[[.12,.057,.061,-.051],[.17,.062,.068,-.047],[.23,.072,.078,-.043],[.32,.074,.08,-.04],[.43,.078,.081,-.037],[.54,.072,.077,-.036],[.64,.085,.09,-.033],[.75,.098,.106,-.03],[.87,.106,.118,-.03],[.95,.106,.12,-.03]];
    const fn=(u:number,v:number)=>{const [y,rx,rz,z]=rowAt(rows,v),a=u*TAU;const gathered=Math.exp(-Math.pow((y-.235)/.11,2))+.7*Math.exp(-Math.pow((y-.69)/.1,2))+.7*Math.exp(-Math.pow((y-.86)/.065,2));const fold=.015*gathered*Math.sin(y*93+Math.sin(a)*2.4)*Math.pow(Math.abs(Math.cos(a)),.65);return V(cx+(rx+fold*.6)*Math.sin(a),y,(z??0)+(rz+fold)*Math.cos(a));};
    sheet(g,'Gathered shaped leather trouser leg '+s,fn,36,58,p.hide,p.lining,.006);
    const ankle=tube(g,'Fitted turned ankle band '+s,[[.12,.06,.064,-.051],[.149,.061,.066,-.049]],p.hide,p,cx);trim(g,'Ankle band top stitch',ankle,p,1);
    // Long olive side gussets and curved overlapping thigh patches follow the
    // same folded skin, so their seams cannot float clear of the trousers.
    for(const side of [.25,.75]){const gusset=(u:number,v:number)=>{const q=fn(side+(u-.5)*.13,.25+v*.68);return q.add(V(Math.sign(Math.sin(side*TAU))*.002,0,0));};sheet(g,'Olive side stride gusset '+side,gusset,6,30,p.olive,p.lining,.003);for(const u of [0,1])stitch(g,'Gusset stitched edge',Array.from({length:24},(_,i)=>gusset(u,i/23)),p.thread);}
    const thigh=(u:number,v:number)=>{const a=(u-.5)*2.7,y=.615+v*.25+.022*Math.cos(a),r=.089+v*.02;return V(cx+r*Math.sin(a),y,-.03+(.108+v*.02+.007*Math.sin(v*Math.PI))*Math.cos(a));};sheet(g,'Shaped front thigh reinforcement '+s,thigh,20,14,p.hide,p.lining,.005);trim(g,'Curved thigh lower seam',thigh,p,0);

    trim(g,'Ankle cuff',fn,p,0);
    for(const u of [.25,.75]){const pts=Array.from({length:35},(_,i)=>fn(u,i/34));pipe(g,'Trouser side welt',pts,.0025,p.edge);stitch(g,'Trouser side stitching',pts,p.thread);}
    const knee=(u:number,v:number)=>{const a=(u-.5)*2.6;return V(cx+(.078+.004*Math.sin(v*4))*Math.sin(a),.51+v*.09,-.036+(.094+.008*Math.sin(v*Math.PI))*Math.cos(a)+.004*Math.sin(v*5));};sheet(g,'Olive flexion knee inset '+s,knee,16,8,p.olive,p.lining);
    for(let k=0;k<2;k++) {
      const pad=(u:number,v:number)=>{const a=(u-.5)*2.7;return V(cx+.082*Math.sin(a),.435+k*.05+v*.071-.02*Math.cos(a),-.036+(.103+.011*Math.sin(v*Math.PI))*Math.cos(a));};sheet(g,'Overlapping shaped knee hide '+s+' '+k,pad,18,6,p.hide,p.lining,.006);trim(g,'Knee leaf lower stitching',pad,p,0);
    }
    for(const row of [.61,.81]) {
      const sidePanel=(u:number,v:number)=>{const a=s*(.8+u*1.15),y=row+v*.075-.025*Math.sin(u*Math.PI);return V(cx+(.101+.006*Math.sin(v*Math.PI))*Math.sin(a),y,-.03+.107*Math.cos(a));};sheet(g,'Thorned layered thigh side panel',sidePanel,14,6,p.hide,p.lining,.008);trim(g,'Thigh side panel bound edge',sidePanel,p,0);
    }
    const rear=(u:number,v:number)=>{const a=Math.PI+(u-.5)*2.4;return V(cx+(.095+.013*v)*Math.sin(a),.69+v*.20,-.029+(.116+.012*Math.sin(v*Math.PI))*Math.cos(a));};sheet(g,'Rear reinforced seat panel '+s,rear,16,10,p.hide,p.lining,.008);trim(g,'Rear seat curved seam',rear,p,0);
    for(let k=0;k<4;k++)thorn(g,p,V(cx+s*.09,.48+k*.09,-.02),V(s,.25,.3).normalize(),.018);
  }
  // A saddle bridge makes the upper trousers continuous while keeping both legs separate.
  const pelvis=tube(g,'Trouser pelvis with open waist',[[.9,.216,.133,-.026],[.96,.212,.134,-.028],[1.016,.192,.121,-.025]],p.hide,p);trim(g,'Trouser waistband upper stitch',pelvis,p,1);
  const belt=tube(g,'Narrow leather waistband',[[.987,.199,.127,-.025],[1.023,.195,.125,-.025]],p.edge,p);trim(g,'Waistband lower stitching',belt,p,0);trim(g,'Waistband upper stitching',belt,p,1);
  for(const x of [-.14,-.06,.08,.155]){const pts=[V(x,.976,.09),V(x,1.03,.091)];pipe(g,'Sewn waistband belt loop',pts,.007,p.hide);stitch(g,'Belt loop stitch',pts,p.thread,.01);}
  const fly=[V(.016,.90,.11),V(.029,.946,.118),V(.029,.995,.113)];pipe(g,'Curved overlapping fly seam',fly,.006,p.edge);stitch(g,'Fly stitching',fly.map(q=>q.clone().add(V(.008,0,.003))),p.thread);
  const button=mesh(g,'Waist brass button',new THREE.SphereGeometry(.007,12,8),p.metal);button.scale.z=.35;button.position.set(.035,1.006,.115);
}

function boots(g:THREE.Group,p:Palette) {
  for(const s of [-1,1]){
    const x=s*.1143;
    const rows:Row[]=[[.06,.062,.078,-.055],[.115,.054,.064,-.06],[.165,.049,.056,-.058],[.23,.054,.060,-.049],[.32,.066,.07,-.039],[.41,.075,.078,-.033],[.49,.076,.079,-.032]];
    const shaft=(u:number,v:number)=>{const [y,rx,rz,z]=rowAt(rows,v),a=u*TAU,f=.0045*Math.exp(-Math.pow((y-.17)/.10,2))*Math.sin(y*115+2*Math.sin(a));return V(x+(rx+f)*Math.sin(a),y,(z??0)+(rz+f)*Math.cos(a));};sheet(g,'Calf fitted boot with gathered ankle '+s,shaft,32,36,p.olive,p.lining,.007);
    const cuff=tube(g,'Folded boot top cuff '+s,[[.451,.079,.082,-.033],[.495,.081,.085,-.033]],p.hide,p,x);trim(g,'Turned cuff lower seam',cuff,p,0);trim(g,'Boot top lip',cuff,p,1);
    for(const side of [-1,1]) {
      const flap=(u:number,v:number)=>{const a=side*(.20+u*1.48);return V(x+(.085+.004*Math.sin(v*Math.PI))*Math.sin(a),.438+v*.066-.016*Math.sin(u*Math.PI),-.033+.088*Math.cos(a));};sheet(g,'Turned split boot cuff flap',flap,16,8,p.hide,p.lining,.01);trim(g,'Thick turned cuff corner seam',flap,p,0);
      for(let k=0;k<2;k++) {const panel=(u:number,v:number)=>{const q=shaft((side>0?.03:.65)+u*.31,.29+k*.29+v*.24+.025*Math.sin(u*Math.PI));return q.addScaledVector(V(q.x-x,0,q.z+.04).normalize(),.005+.005*Math.sin(v*Math.PI));};sheet(g,'Layered calf hide quarter',panel,14,12,k===0?p.hide:p.olive,p.lining,.006);trim(g,'Calf quarter stitched overlap',panel,p,0);}
    }
    const fur=tube(g,'Dense padded fur lining roll',[[.478,.076,.08,-.033],[.497,.078,.082,-.033],[.505,.073,.077,-.033]],p.sole,p,x);trim(g,'Leather outside fur welt',fur,p,0);
    // Rounded broad toe, narrow instep, and a distinct heel share one footprint.
    const outline=(a:number)=>{const z=.014+.166*Math.cos(a),width=.062+.013*Math.exp(-Math.pow((z-.10)/.08,2))-.012*Math.exp(-Math.pow((z+.065)/.048,2));return V(x+width*Math.sin(a),0,z);};
    const foot=(u:number,v:number)=>{const a=TAU*u,b=v*Math.PI/2,q=outline(a),rad=Math.cos(b),z=.012+(q.z-.012)*rad,height=.062+.039*Math.exp(-Math.pow((z+.046)/.073,2));return V(x+(q.x-x)*rad,.028+height*Math.sin(b),z);};sheet(g,'Shaped rounded toe vamp and heel upper '+s,foot,48,22,p.hide,p.lining,.007);trim(g,'Boot welt stitching',foot,p,0);
    const sole=(u:number,v:number)=>{const q=outline(u*TAU),arch=.008*Math.exp(-Math.pow((q.z+.037)/.047,2));return V(x+(q.x-x)*1.04,.008+arch+v*.021,q.z);};sheet(g,'Integrated contoured leather outsole '+s,sole,56,3,p.sole,p.sole,.003);trim(g,'Outsole leather welt',sole,p,1);
    const bottom=(u:number,v:number)=>{const q=sole(u,0);return V(x+(q.x-x)*(1-v),q.y,.014+(q.z-.014)*(1-v));};sheet(g,'Closed sole underside '+s,bottom,56,3,p.sole,p.sole,.003);
    const heelShape=new THREE.Shape();heelShape.moveTo(-.042,.148);heelShape.quadraticCurveTo(-.06,.12,-.053,.076);heelShape.lineTo(.053,.076);heelShape.quadraticCurveTo(.06,.12,.042,.148);heelShape.quadraticCurveTo(0,.16,-.042,.148);
    const heelGeo=new THREE.ExtrudeGeometry(heelShape,{depth:.018,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:2,steps:1,curveSegments:8});heelGeo.rotateX(-Math.PI/2);const heel=mesh(g,'Rounded stacked rear heel '+s,heelGeo,p.sole);heel.position.set(x,.003,0);
    // Follow the curved instep down to the vamp, then the tapered shin upward.
    const laceCenter=(t:number)=>{if(t<.23){const f=t/.23;return V(x,.079+.055*f,.113-.102*f);}const y=.134+(t-.23)/.77*.34;let j=0;while(j<rows.length-2&&rows[j+1]![0]<y)j++;const lo=rows[j]!,hi=rows[j+1]!,f=(y-lo[0])/(hi[0]-lo[0]);return V(x,y,THREE.MathUtils.lerp((lo[3]??0)+lo[2],(hi[3]??0)+hi[2],f)+.006);};
    for(const side of [-1,1]){const strip=(u:number,v:number)=>{const q=laceCenter(v);q.x+=side*(.022+u*.017);q.z-=u*.004;return q;};sheet(g,'Continuous instep and shin lace facing',strip,4,40,p.hide,p.lining,.004);for(const u of [0,1])stitch(g,'Facing stitching',Array.from({length:40},(_,i)=>strip(u,i/39)),p.thread,.011);}
    for(let j=0;j<13;j++) {const q=laceCenter(j/12),next=laceCenter(Math.min(1,(j+1)/12));for(const side of [-1,1]){const ring=mesh(g,'Boot metal eyelet',new THREE.TorusGeometry(.0045,.0015,5,10),p.metal);ring.position.copy(q).add(V(side*.027,0,.002));}if(j<12){pipe(g,'Crossed leather boot lace',[q.clone().add(V(-.027,0,.005)),next.clone().add(V(.027,0,.006))],.0028,p.thread);pipe(g,'Crossed leather boot lace',[q.clone().add(V(.027,0,.006)),next.clone().add(V(-.027,0,.008))],.0028,p.thread);}}
    for(let k=0;k<3;k++){const pts=Array.from({length:28},(_,j)=>shaft(j/27,.25+k*.25+.035*Math.sin(j/27*TAU)));pipe(g,'Diagonal boot panel seam',pts,.0027,p.edge);stitch(g,'Boot panel saddle stitching',pts,p.thread);const q=shaft(s>0?.25:.75,.29+k*.25);thorn(g,p,q,V(s,.2,.2).normalize(),.016);}
    for(let k=0;k<48;k++){const a=k/48*TAU;const o=mesh(g,'Short dark fur lining tuft',new THREE.ConeGeometry(.0075,.020,5),p.sole);o.position.set(x+.073*Math.sin(a),.501+.002*Math.sin(k*7),-.033+.077*Math.cos(a));o.rotation.z=.35*Math.sin(a);}
    const toe=Array.from({length:27},(_,i)=>{const a=-1.25+2.5*i/26;return V(x+.069*Math.sin(a),.04+.043*Math.cos(a),.11+.003*Math.cos(a));});pipe(g,'Curved sewn toe cap seam',toe,.0025,p.edge);stitch(g,'Toe cap stitch',toe,p.thread,.009);
  }
}

function wraps(g:THREE.Group,p:Palette) {
  for(const s of [-1,1]) {
    const hand=new THREE.Group();hand.name='Fingerless casting glove '+s;g.add(hand);
    const palm=tube(hand,'Hollow palm and wrist hide',[[0,.043,.041],[.045,.041,.035],[.09,.047,.031],[.148,.05,.029]],p.olive,p,0,0,TAU,.0015);trim(hand,'Open wrist rolled edge',palm,p,0);
    const cuff=tube(hand,'Leather wrist fastening cuff',[[.005,.046,.044],[.035,.044,.042]],p.hide,p);trim(hand,'Cuff saddle seam',cuff,p,0);trim(hand,'Cuff saddle seam',cuff,p,1);
    for(let k=0;k<3;k++){
      const band=(u:number,v:number)=>{const a=TAU*u,y=.035+k*.032+.027*Math.sin(a)+v*.028;return V((.048+k*.001+.004*Math.sin(v*Math.PI))*Math.sin(a),y,(.039-k*.001+.004*Math.sin(v*Math.PI))*Math.cos(a));};sheet(hand,'Overlapping diagonal hand binding '+k,band,40,6,k%2?p.olive:p.hide,p.lining,.006);trim(hand,'Wrap binding stitched edge',band,p,0);trim(hand,'Wrap binding stitched edge',band,p,1);
    }
    const wristTab=(u:number,v:number)=>V(-.034+u*.069,.009+v*.031,.046+.007*Math.sin(u*Math.PI));sheet(hand,'Broad wrist toggle fastening tab',wristTab,10,5,p.hide,p.lining,.007);for(const v of [0,1]){const pts=Array.from({length:16},(_,i)=>wristTab(i/15,v));pipe(hand,'Turned wrist strap lip',pts,.0027,p.edge);stitch(hand,'Wrist strap stitched border',pts,p.thread,.009);}
    const knuckle=(u:number,v:number)=>{const a=(u-.5)*2.75;return V(.052*Math.sin(a),.103+v*.035+.01*Math.sin(a),(.036+.005*Math.sin(v*Math.PI))*Math.cos(a));};sheet(hand,'Padded diagonal knuckle wrap',knuckle,18,7,p.hide,p.lining,.006);trim(hand,'Knuckle wrap bound lip',knuckle,p,1);
    // Local +Y follows the fingers; local X spans the four knuckles.
    for(let f=0;f<4;f++){
      const xx=(f-1.5)*.024,len=[.031,.044,.045,.036][f]!;
      const finger=tube(hand,'Open second knuckle finger sleeve '+f,[[.126,.013,.014],[.126+len,.012,.013]],p.hide,p,xx,0,TAU,0);trim(hand,'Finger opening stitching',finger,p,1);
    }
    const thumb=new THREE.Group();thumb.name='Open diagonal thumb sleeve';hand.add(thumb);thumb.position.set(-.041,.081,.002);thumb.rotation.z=.62;
    const tf=tube(thumb,'Thumb leather tube',[[0,.018,.016],[.057,.014,.014]],p.hide,p);trim(thumb,'Thumb opening edge',tf,p,1);
    buckle(hand,p,V(.018,.02,.044),.008);thorn(hand,p,V(.04,.107,.017),V(.4,.3,1).normalize(),.012);thorn(hand,p,V(.039,.074,.026),V(.4,.3,1).normalize(),.01);
    hand.rotation.z=-s*Math.PI/2;hand.position.set(s*.661,1.4555,-.0654);
  }
}

const descriptions:Record<string,string>={bramblehide_hood:'Deepwood hide, still faintly thorned along the seam.',bramblehide_robe:"Heavy hide, waxed. Sheds a Thornbound's spores and most of the rain.",bramblehide_leggings:'Long hide leggings cut for a full stride.',bramblehide_boots:'Laced to the knee against the root field.',bramblehide_wraps:'Wrapped to the second knuckle. Casting hand stays free.'};
export const author:ItemModelAuthor={
  ids:['bramblehide_hood','bramblehide_robe','bramblehide_leggings','bramblehide_boots','bramblehide_wraps'],
  build(id:string):THREE.Group {
    const builders:Record<string,(g:THREE.Group,p:Palette)=>void>={bramblehide_hood:hood,bramblehide_robe:robe,bramblehide_leggings:leggings,bramblehide_boots:boots,bramblehide_wraps:wraps};
    const builder=builders[id];if(!builder)throw new Error('Unsupported bramblehide item '+id);
    const g=new THREE.Group();g.name=id;builder(g,palette());g.userData.itemModel={itemId:id,author:'armor-bramblehide',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]!,wearable:true};return g;
  },
};







