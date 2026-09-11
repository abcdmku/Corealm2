import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Surface = (u: number, v: number) => THREE.Vector3;
const V = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
const mix = (a:number,b:number,t:number) => a+(b-a)*t;
const ids = ['cindersteel_helm','cindersteel_plate','cindersteel_greaves','cindersteel_boots','cindersteel_gauntlets'] as const;
function texture(kind:'steel'|'copper'|'leather'|'normal'|'rough'):THREE.DataTexture {
  const n=128, data=new Uint8Array(n*n*4);
  const hash=(x:number,y:number)=>{const t=Math.sin(x*127.1+y*311.7)*43758.5453; return t-Math.floor(t);};
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const i=(y*n+x)*4, grain=hash(x,y), wave=Math.sin(x*.19+Math.sin(y*.22))*Math.cos(y*.17), scratch=Math.abs(Math.sin(x*.47+y*.83+Math.sin(y*.24)))<.025;
    if(kind==='normal') {data[i]=128+Math.round(Math.cos(x*.19+Math.sin(y*.22))*Math.cos(y*.17)*7);data[i+1]=128+Math.round(Math.sin(y*.17)*6);data[i+2]=254;}
    else { const base=kind==='steel'?[85,88,91]:kind==='copper'?[181,105,66]:kind==='leather'?[39,25,20]:[151,151,151]; const k=kind==='rough'?.9+grain*.14:.86+grain*.17+wave*.065+(scratch?.13:0);for(let c=0;c<3;c++)data[i+c]=Math.min(255,Math.round(base[c]!*k)); } data[i+3]=255;
  }
  const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.name=`cindersteel-${kind}-fine-forge-grain`;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;if(!['normal','rough'].includes(kind))t.colorSpace=THREE.SRGBColorSpace;return t;
}
function materials(){
 const normal=texture('normal'),rough=texture('rough');
 const metal=(name:string,color:string,map:THREE.DataTexture)=>{const m=new THREE.MeshStandardMaterial({color,map,normalMap:normal,normalScale:new THREE.Vector2(.35,.35),roughnessMap:rough,roughness:.73,metalness:.9});m.name=name;return m;};
 const steel=metal('blackened hammered cindersteel','#ffffff',texture('steel')), copper=metal('worn copper rolled borders','#ffffff',texture('copper'));
 const ember=new THREE.MeshStandardMaterial({color:0x973820,metalness:.65,roughness:.5});ember.name='red copper recessed channels';
 const leather=new THREE.MeshStandardMaterial({map:texture('leather'),roughness:.96,metalness:0});leather.name='dark stitched hide lining';
 return {steel,copper,ember,leather};
}
type Mats=ReturnType<typeof materials>;
function mesh(g:THREE.Group,name:string,geo:THREE.BufferGeometry,mat:THREE.Material){const m=new THREE.Mesh(geo,mat);m.name=name;g.add(m);return m;}
function path(g:THREE.Group,name:string,points:THREE.Vector3[],r:number,mat:THREE.Material,closed=false){const curve=new THREE.CatmullRomCurve3(points,closed,'centripetal');return mesh(g,name,new THREE.TubeGeometry(curve,Math.max(8,Math.ceil(points.length*1.25)),r,6,closed),mat);}
function line(g:THREE.Group,name:string,points:THREE.Vector3[],r:number,mat:THREE.Material){for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,m=mesh(g,`${name}-${i}`,new THREE.CylinderGeometry(r,r,a.distanceTo(b),6),mat);m.position.copy(a).lerp(b,.5);m.quaternion.setFromUnitVectors(V(0,1,0),b.clone().sub(a).normalize());}}
function rivet(g:THREE.Group,p:THREE.Vector3,m:Mats,r=.004){const o=mesh(g,'domed copper peened rivet',new THREE.SphereGeometry(r,8,6),m.copper);o.scale.z=.55;o.position.copy(p);}
// Closed two-sided shell with continuous thick edge surfaces. No single-sided cards.
function shell(g:THREE.Group,name:string,f:Surface,mat:THREE.Material,thickness=.004,nu=24,nv=12){
 const p:number[]=[],uv:number[]=[],ix:number[]=[],count=(nu+1)*(nv+1);
 for(let side=0;side<2;side++)for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
  const u=i/nu,v=j/nv,a=f(u,v),du=f(Math.min(1,u+.0005),v).sub(f(Math.max(0,u-.0005),v)),dv=f(u,Math.min(1,v+.0005)).sub(f(u,Math.max(0,v-.0005)));const n=du.cross(dv).normalize();a.addScaledVector(n,side===0?thickness/2:-thickness/2);p.push(a.x,a.y,a.z);uv.push(u,v);
 }
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;ix.push(a,b,d,a,d,c,count+a,count+d,count+b,count+a,count+c,count+d);}
 const edge=(a:number,b:number)=>ix.push(a,a+count,b+count,a,b+count,b);
 for(let i=0;i<nu;i++){edge(i+1,i);edge(nv*(nu+1)+i,nv*(nu+1)+i+1);}for(let j=0;j<nv;j++){edge(j*(nu+1),(j+1)*(nu+1));edge((j+1)*(nu+1)+nu,j*(nu+1)+nu);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();return mesh(g,name,geo,mat);
}
function border(g:THREE.Group,name:string,f:Surface,m:Mats,r=.0025){const pts:THREE.Vector3[]=[];for(let i=0;i<=20;i++)pts.push(f(i/20,0));for(let i=1;i<=12;i++)pts.push(f(1,i/12));for(let i=19;i>=0;i--)pts.push(f(i/20,1));for(let i=11;i>=1;i--)pts.push(f(0,i/12));path(g,name,pts,r,m.copper,true);}
function plate(g:THREE.Group,name:string,f:Surface,m:Mats,nu=24,nv=12){shell(g,name,f,m.steel,.005,nu,nv);border(g,`${name} rolled copper rim`,f,m);}
function tube(g:THREE.Group,name:string,y0:number,y1:number,rx0:number,rx1:number,rz0:number,rz1:number,m:Mats,cx=0,cz=0,mat:THREE.Material=m.steel){const f:Surface=(u,v)=>{const a=u*Math.PI*2;return V(cx+Math.sin(a)*mix(rx0,rx1,v),mix(y0,y1,v),cz+Math.cos(a)*mix(rz0,rz1,v));};shell(g,name,f,mat,.004,24,4);for(const v of [0,1])path(g,`${name} opening rolled edge`,Array.from({length:40},(_,i)=>f(i/40,v)),.0025,m.copper,true);return f;}
function facet(g:THREE.Group,name:string,points:THREE.Vector3[],m:Mats,ridge=.008){const center=points.reduce((a,p)=>a.add(p),V(0,0,0)).multiplyScalar(1/points.length);center.z+=ridge;const p:number[]=[],uv:number[]=[],ix:number[]=[];for(const v of [...points,center,...points.map(q=>q.clone().add(V(0,0,-.004)))]){p.push(v.x,v.y,v.z);uv.push(v.x*3,v.y*3);}const n=points.length;for(let i=0;i<n;i++){const j=(i+1)%n;ix.push(i,j,n,i,n+1+i,n+1+j,i,n+1+j,j);if(i>0&&i<n-1)ix.push(n+1,n+1+i+1,n+1+i);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();mesh(g,name,geo,m.steel);line(g,`${name} angular copper edge`,[...points,points[0]!],.0024,m.copper);}
function buckle(g:THREE.Group,p:THREE.Vector3,m:Mats,size=.022){const pts=[V(-size/2,-size*.7,0),V(size/2,-size*.7,0),V(size/2,size*.7,0),V(-size/2,size*.7,0)].map(q=>q.add(p));line(g,'square copper strap buckle',[...pts,pts[0]!],.0023,m.copper);line(g,'buckle tongue',[p.clone().add(V(-size/2,0,0)),p.clone().add(V(size*.35,0,.001))],.0016,m.copper);}
function straps(g:THREE.Group,cx:number,cz:number,ys:number[],rx:number,rz:number,m:Mats){for(const y of ys){tube(g,'circumferential leather closing strap',y-.009,y+.009,rx,rx,rz,rz,m,cx,cz,m.leather);buckle(g,V(cx+rx*.68,y,cz+rz*.8),m);rivet(g,V(cx-rx*.6,y,cz+rz*.84),m);}}
function helm(g:THREE.Group,m:Mats){
 const cap:Surface=(u,v)=>{const a=mix(-Math.PI,Math.PI,u),t=mix(.025,Math.PI/2,v);return V(.105*Math.sin(t)*Math.sin(a),1.695+.142*Math.cos(t),-.014+.123*Math.sin(t)*Math.cos(a));};plate(g,'faceted domed skull',cap,m,32,15);
 const back:Surface=(u,v)=>{const a=mix(.93,Math.PI*2-.93,u);return V(Math.sin(a)*mix(.109,.119,v),mix(1.711,1.535,v),-.014+Math.cos(a)*mix(.123,.132,v));};plate(g,'wraparound cheek and nape shell',back,m);
 for(const s of [-1,1]){
  const brow:Surface=(u,v)=>{const x=s*mix(.004,.104,u);return V(x,mix(1.695-.024*(1-u),1.732-.025*u,v),.136-.052*u*u);};plate(g,'angled brow visor',brow,m);
  const cheek:Surface=(u,v)=>{const x=s*mix(.009,.105,u);return V(x,mix(1.535+.04*u,1.655+.025*u,v),.143-.055*u*u+.012*(1-v)*(1-u));};plate(g,'solid pointed face guard',cheek,m);
  line(g,'inset red cheek channel',[V(s*.018,1.551,.15),V(s*.039,1.628,.141),V(s*.097,1.655,.103)],.003,m.ember);
  rivet(g,V(s*.083,1.71,.107),m);rivet(g,V(s*.077,1.579,.118),m);
  const hinge=mesh(g,'copper visor hinge',new THREE.CylinderGeometry(.012,.012,.009,12),m.copper);hinge.rotation.z=Math.PI/2;hinge.position.set(s*.112,1.691,.007);
 }
 facet(g,'pointed nasal keel',[V(0,1.736,.145),V(.01,1.674,.149),V(.007,1.552,.16),V(0,1.525,.165),V(-.007,1.552,.16),V(-.01,1.674,.149)],m,.003);
 const crest:Surface=(u,v)=>{const a=mix(-1.35,1.4,v),w=.009*(.5+.5*Math.cos(a));return V(mix(-w,w,u),1.704+.147*Math.cos(a)+.011*(1-Math.abs(u*2-1)),-.014+.127*Math.sin(a));};shell(g,'raised copper sagittal crest',crest,m.copper,.005,4,30);
 tube(g,'flared articulated neck flange',1.523,1.546,.123,.109,.139,.12,m,0,-.015);
}
function chest(g:THREE.Group,m:Mats){
 for(const s of [1,-1]){const f:Surface=(u,v)=>{const a=(u*2-1),w=.158+.035*Math.sin(v*Math.PI*.8),y=mix(1.025,1.46,v)-.045*(1-a*a)*Math.pow(v,9);return V(a*w,y,s*(.094+.043*Math.sin(v*Math.PI*.8))*(1-.37*Math.pow(Math.abs(a),2))+.014);};plate(g,s===1?'cuirass breastplate':'shaped full backplate',f,m,24,20);}
 for(const s of [-1,1]){const f:Surface=(u,v)=>V(s*mix(.163,.177,v),mix(1.045,1.345,v),mix(-.072,.103,u));shell(g,'leather side closure under armhole',f,m.leather,.006);for(const y of [1.10,1.22,1.32])buckle(g,V(s*.165,y,.113),m);}
 tube(g,'standing gorget with open neck',1.423,1.492,.105,.093,.09,.085,m,0,-.007);
 for(const s of [-1,1]){
 line(g,'forked red copper breast inlay',[V(s*.163,1.389,.115),V(s*.078,1.348,.145),V(s*.061,1.273,.147),V(s*.014,1.231,.149)],.005,m.ember);
 line(g,'copper chest channel piping',[V(s*.168,1.398,.116),V(s*.073,1.356,.149),V(s*.056,1.281,.151),V(s*.010,1.238,.153)],.002,m.copper);
 const strap:Surface=(u,v)=>V(s*mix(.125,.149,u),mix(1.356,1.464,v),.13-.075*v);shell(g,'shoulder suspension leather strap',strap,m.leather,.006);buckle(g,V(s*.137,1.396,.12),m,.022);
 for(let l=0;l<3;l++){const f:Surface=(u,v)=>{const a=mix(-1.53,1.53,u),x=s*(.205+l*.037+v*.065);return V(x,1.443+Math.cos(a)*(.105-l*.013)-.02*v,-.055+Math.sin(a)*(.134-l*.006));};plate(g,`shoulder overlapping lame ${s} ${l}`,f,m,20,6);rivet(g,f(.15,.75),m);rivet(g,f(.85,.75),m);}
 for(let l=0;l<3;l++){const f:Surface=(u,v)=>{const a=mix(.17,1.44,u)*s,ry=1.066-l*.044-v*.056;return V(Math.sin(a)*(.176+l*.01+v*.014),ry,.012+Math.cos(a)*(.121+l*.009+v*.009));};plate(g,`flared hip fauld ${s} ${l}`,f,m,16,4);for(const u of [.12,.85])rivet(g,f(u,.3),m);}
 }
 facet(g,'central raised copper-bordered breast keel',[V(0,1.43,.157),V(.014,1.401,.154),V(.012,1.236,.155),V(0,1.209,.158),V(-.012,1.236,.155),V(-.014,1.401,.154)],m,.009);
 for(let i=0;i<3;i++)facet(g,`pointed abdominal overlapping plate ${i}`,[V(-.057+i*.007,1.232-i*.075,.135),V(0,1.245-i*.075,.151),V(.057-i*.007,1.232-i*.075,.135),V(.049-i*.007,1.164-i*.075,.135),V(0,1.126-i*.075,.158),V(-.049+i*.007,1.164-i*.075,.135)],m,.006);
}
function legs(g:THREE.Group,m:Mats){m={...m,steel:m.steel.clone(),copper:m.copper.clone()};m.steel.flatShading=true;m.copper.roughness=.48;for(const s of [-1,1]){const x=s*.1143,z=-.036;
 const shape=(part:'thigh'|'shin',a:number,v:number)=>{const thigh=part==='thigh';
  const rx=thigh?(v<.68?mix(.052,.086,v/.68):mix(.086,.105,(v-.68)/.32)):(v<.67?mix(.038,.083,v/.67):mix(.083,.065,(v-.67)/.33));
  const rz=thigh?mix(.059,.105,v):(v<.67?mix(.050,.092,v/.67):mix(.092,.071,(v-.67)/.33));
  const q=a/(Math.PI/4),k=Math.floor(q),t=q-k,sn=mix(Math.sin(k*Math.PI/4),Math.sin((k+1)*Math.PI/4),t),cs=mix(Math.cos(k*Math.PI/4),Math.cos((k+1)*Math.PI/4),t),front=Math.max(0,cs);
  return V(x+sn*rx, (thigh?mix(.582,.926,v):mix(.15,.51,v))+(thigh?-.015*front*(1-v)+.035*Math.abs(sn)*v:.020*front*(1-v)),z+cs*rz+.023*front*Math.pow(1-Math.abs(sn),2));};
 for(const part of ['thigh','shin'] as const){
  const liner:Surface=(u,v)=>shape(part,u*Math.PI*2,v).add(V(0,0,-.001));shell(g,`${part} stitched leather underplate`,liner,m.leather,.004,24,10);
  const front:Surface=(u,v)=>shape(part,mix(-1.72,1.72,u),v).add(V(0,0,.003));plate(g,`${part} tapered angular steel front`,front,m,16,12);border(g,`${part} broad rolled copper perimeter`,front,m,.0042);
  const rear:Surface=(u,v)=>shape(part,mix(1.76,4.52,u),v).add(V(0,0,-.004));plate(g,`${part} shaped hinged rear closing plate`,rear,m,10,12);
  // A raised bevel and inset copper line follow the actual shell profile.
  const route=part==='thigh'?[[.08,.91],[.32,.66],[.58,.51],[.71,.13]]:[[.20,.90],[.43,.73],[.49,.22],[.26,.05]];
  for(let j=1;j<route.length;j++){const aa=route[j-1]!,bb=route[j]!;
   const ribbon:Surface=(u,v)=>front(mix(aa[0]!,bb[0]!,v)+(u-.5)*.032,mix(aa[1]!,bb[1]!,v)).add(V(0,0,.010));shell(g,`${part} solid raised copper diagonal border`,ribbon,m.copper,.003,2,20);
   const inset:Surface=(u,v)=>front(mix(aa[0]!,bb[0]!,v)+(u-.5)*.013,mix(aa[1]!,bb[1]!,v)).add(V(0,0,.012));shell(g,`${part} red copper inset stripe`,inset,m.ember,.002,2,20);
  }
  if(part==='shin'){const keel:Surface=(u,v)=>front(.5+(u-.5)*mix(.028,.062,v),mix(.04,.94,v)).add(V(0,0,.009));shell(g,'broad raised faceted tibial copper keel',keel,m.copper,.003,2,20);}
  for(const v of [.16,.49,.83]){
   // Short leather tabs span each side seam instead of unattached circular rings.
   for(const side of [-1,1]){const tab:Surface=(u,w)=>shape(part,side*mix(1.28,2.13,u),v+(w-.5)*.058).add(V(side*.004,0,0));shell(g,`${part} side seam leather buckle tab`,tab,m.leather,.005,8,2);
    const anchor=tab(.18,.5);anchor.z+=.003;rivet(g,anchor,m,.0034);
    const fastener=new THREE.Group();fastener.name=`${part} attached side ${side===s?'buckle':'hinge'}`;const bp=tab(.56,.5);fastener.position.copy(bp);fastener.rotation.y=side*1.78;g.add(fastener);
    if(side===s)buckle(fastener,V(0,0,.003),m,.016);else{for(const dy of [-.007,0,.007]){const h=mesh(fastener,'three barrel copper hinge',new THREE.CylinderGeometry(.0028,.0028,.006,8),m.copper);h.position.set(0,dy,.002);}}
   }
  }
  for(const h of [.12,.74]){const cuff:Surface=(u,v)=>rear(u,h+v*.105).add(V(0,0,-.006));plate(g,`${part} overlapping rear closing lame`,cuff,m,12,3);}
  // Rear overlap seam and its visible flush rivets.
  const seam=Array.from({length:12},(_,i)=>rear(.47,i/11).add(V(0,0,-.003)));path(g,`${part} rear copper overlap seam`,seam,.0018,m.copper);
  for(const v of [.13,.5,.88]){const rp=rear(.56,v).add(V(0,0,-.005));rivet(g,rp,m,.003);}
 }
 const kneeBack:Surface=(u,v)=>V(x+Math.sin(u*Math.PI*2)*.060,mix(.48,.61,v),z+Math.cos(u*Math.PI*2)*.069);shell(g,'flexible leather knee joint',kneeBack,m.leather,.004,24,5);
 facet(g,'projecting pointed knee cop',[V(x-.061,.562,.049),V(x,.592,.067),V(x+.061,.562,.049),V(x+.049,.514,.06),V(x,.480,.084),V(x-.049,.514,.06)],m,.026);
 facet(g,'upper knee articulated brow',[V(x-.055,.580,.053),V(x,.603,.069),V(x+.055,.580,.053),V(x+.051,.561,.066),V(x,.577,.078),V(x-.051,.561,.066)],m,.009);
 for(const q of [-1,1])rivet(g,V(x+q*.05,.548,.066),m,.0037);
 }}
function boots(g:THREE.Group,m:Mats){m={...m,steel:m.steel.clone(),copper:m.copper.clone()};m.steel.flatShading=true;m.copper.roughness=.48;for(const s of [-1,1]){const x=s*.1143;
 const shaftAt=(a:number,v:number)=>{const rx=v<.3?mix(.045,.043,v/.3):mix(.043,.078,(v-.3)/.7),rz=v<.3?mix(.057,.052,v/.3):mix(.052,.083,(v-.3)/.7);const q=a/(Math.PI/4),k=Math.floor(q),t=q-k,sn=mix(Math.sin(k*Math.PI/4),Math.sin((k+1)*Math.PI/4),t),cs=mix(Math.cos(k*Math.PI/4),Math.cos((k+1)*Math.PI/4),t);return V(x+sn*rx,mix(.09,.312,v)+.016*Math.max(0,cs)*v,-.068+cs*rz);};
 shell(g,'open tailored leather boot shaft',(u,v)=>shaftAt(u*Math.PI*2,v),m.leather,.005,24,12);
 const shaft:Surface=(u,v)=>shaftAt(mix(-1.53,1.53,u),v).add(V(0,0,.006+Math.max(0,1-Math.abs(u*2-1))*.006));plate(g,'beveled tapered boot shin shield',shaft,m,16,12);border(g,'broad copper boot shield bevel',shaft,m,.004);const lip:Surface=(u,v)=>shaft(u,mix(.92,1,v)).add(V(0,0,.004));shell(g,'broad flared copper cuff lip',lip,m.copper,.003,16,2);
 const route=[[.10,.47],[.47,.27],[.60,.42],[.63,.98]];for(let j=1;j<route.length;j++){const aa=route[j-1]!,bb=route[j]!;const strip:Surface=(u,v)=>shaft(mix(aa[0]!,bb[0]!,v)+(u-.5)*.04,mix(aa[1]!,bb[1]!,v)).add(V(0,0,.010));shell(g,'broad angular copper boot shield border',strip,m.copper,.003,2,20);const hot:Surface=(u,v)=>shaft(mix(aa[0]!,bb[0]!,v)+(u-.5)*.016,mix(aa[1]!,bb[1]!,v)).add(V(0,0,.012));shell(g,'red inset along boot border',hot,m.ember,.002,2,20);}
 const rear:Surface=(u,v)=>shaftAt(mix(1.58,4.70,u),v).add(V(0,0,-.004));plate(g,'shaped rear boot heel and calf counter',rear,m,12,10);
 for(const h of [.12,.62,.88]){const lame:Surface=(u,v)=>rear(u,h+v*.115).add(V(0,0,-.006));plate(g,'overlapping rear calf closure plate',lame,m,12,3);for(const u of [.15,.85])rivet(g,lame(u,.5),m,.0037);}
 for(const vv of [.23,.78]){const tab:Surface=(u,v)=>shaftAt(s*mix(1.1,2.55,u),vv+(v-.5)*.105).add(V(s*.005,0,0));shell(g,'integrated side closing leather strap',tab,m.leather,.005,10,2);rivet(g,tab(.10,.5).add(V(0,0,.004)),m,.004);const bg=new THREE.Group();bg.name='anchored boot buckle';bg.position.copy(tab(.53,.5));bg.rotation.y=s*1.88;g.add(bg);buckle(bg,V(0,0,.004),m,.020);}
 const outline=new THREE.Shape();outline.moveTo(-.052,-.132);outline.quadraticCurveTo(-.067,-.10,-.065,.07);outline.quadraticCurveTo(-.065,.168,0,.173);outline.quadraticCurveTo(.065,.168,.065,.07);outline.quadraticCurveTo(.067,-.10,.052,-.132);outline.closePath();
 const soleGeo=new THREE.ExtrudeGeometry(outline,{depth:.018,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.004,bevelThickness:.003,curveSegments:16});soleGeo.rotateX(Math.PI/2);const sole=mesh(g,'rounded welt sole',soleGeo,m.leather);sole.position.set(x,.033,-.016);
 const heel=new THREE.Shape();heel.moveTo(-.047,-.13);heel.lineTo(.047,-.13);heel.quadraticCurveTo(.059,-.10,.053,-.060);heel.lineTo(-.053,-.060);heel.quadraticCurveTo(-.059,-.10,-.047,-.13);const hg=new THREE.ExtrudeGeometry(heel,{depth:.012,bevelEnabled:true,bevelSize:.003,bevelThickness:.002,bevelSegments:2});hg.rotateX(Math.PI/2);const hm=mesh(g,'separate stacked heel below sole',hg,m.leather);hm.position.set(x,.016,-.016);
 // Leather sits inside the armor; the instep plates are the outermost surface.
 const foot:Surface=(u,v)=>{const a=mix(-Math.PI/2,Math.PI/2,u),zz=mix(-.11,.143,v),h=mix(.082,.047,v);return V(x+Math.sin(a)*.059,.037+Math.cos(a)*h,zz);};shell(g,'fully enclosed leather vamp',foot,m.leather,.005,20,12);
 for(let i=0;i<4;i++){const f:Surface=(u,v)=>{const a=mix(-1.48,1.48,u),zz=mix(-.069+i*.045,-.011+i*.045,v),h=.109-i*.013-v*.008;return V(x+Math.sin(a)*.066,.038+Math.cos(a)*h,zz);};plate(g,`visible overlapping instep sabaton plate ${i}`,f,m,12,5);for(const u of [.10,.9])rivet(g,f(u,.63).add(V(0,.001,.002)),m,.0035);
 const cp=[f(.5,.03),f(.5,.95)].map(q=>q.add(V(0,.003,0)));line(g,'instep plate recessed center copper seam',cp,.0025,m.ember);}
 const toe:Surface=(u,v)=>{const a=mix(-Math.PI/2,Math.PI/2,u),t=v*Math.PI/2;return V(x+Math.sin(a)*.066*Math.cos(t),.038+Math.cos(a)*.068*Math.cos(t),.110+.048*Math.sin(t));};plate(g,'faceted domed closed sabaton toe cap',toe,m,12,8);
 path(g,'toe cap copper center rib',Array.from({length:10},(_,i)=>toe(.5,i/9).add(V(0,.002,0))),.0024,m.copper);
 const heelPlate:Surface=(u,v)=>{const a=mix(1.32,4.96,u);return V(x+Math.sin(a)*mix(.060,.049,v),mix(.037,.123,v),-.069+Math.cos(a)*mix(.070,.058,v));};plate(g,'wrapped armored heel cup',heelPlate,m,12,6);
 const welt=Array.from({length:48},(_,i)=>{const a=i*Math.PI/24;return V(x+Math.sin(a)*.064,.035,-.014+Math.cos(a)*.145);});path(g,'continuous stitched sole welt',welt,.0012,m.copper,true);
 for(let i=0;i<24;i++){const a=i*Math.PI/12;rivet(g,V(x+Math.sin(a)*.064,.036,-.014+Math.cos(a)*.145),m,.0012);}
 }}
function gloves(g:THREE.Group,m:Mats){for(const s of [-1,1]){
 const hand=new THREE.Group();hand.name=s===1?'left native T pose gauntlet':'right native T pose gauntlet';g.add(hand);hand.position.set(s*.7065,1.4555,-.0654);hand.rotation.z=-s*Math.PI/2;
 tube(hand,'flared open forearm cuff',-.132,-.019,.064,.042,.056,.035,m,0,0,m.leather);
 const cuff:Surface=(u,v)=>{const a=mix(-2.03,2.03,u);return V(Math.sin(a)*mix(.064,.044,v),mix(-.135,-.018,v)-.008*Math.cos(a),Math.cos(a)*mix(.059,.039,v));};plate(hand,'flared angular vambrace',cuff,m);
 for(const q of [-1,1])line(hand,'cuff inset red copper fork',[V(q*.039,-.128,.047),V(q*.02,-.052,.045),V(0,-.028,.045)],.0025,m.ember);
 tube(hand,'leather wrist articulation',-.025,.015,.043,.042,.035,.032,m,0,0,m.leather);
 const palm=mesh(hand,'padded leather palm',new THREE.SphereGeometry(1,16,10),m.leather);palm.scale.set(.043,.055,.024);palm.position.set(0,.042,0);
 facet(hand,'ridged metacarpal dorsal plate',[V(-.04,.006,.026),V(0,-.006,.036),V(.04,.006,.026),V(.043,.075,.022),V(0,.09,.031),V(-.043,.075,.022)],m,.008);
 for(let f=0;f<4;f++){const fx=(f-1.5)*.022,len=[.077,.095,.089,.07][f]!;const start=.073;for(let j=0;j<3;j++){const y=start+(j+.5)*len/3;const digit=mesh(hand,`leather finger ${f} joint ${j}`,new THREE.CapsuleGeometry(.0105,len/3-.01,4,8),m.leather);digit.position.set(fx,y,-.002-j*.002);const pa:Surface=(u,v)=>{const a=mix(-1.65,1.65,u);return V(fx+Math.sin(a)*.0115,y+mix(-len/6+.002,len/6-.001,v),-.002-j*.002+Math.cos(a)*.013);};plate(hand,`articulated finger ${f} dorsal lame ${j}`,pa,m,8,2);}
 facet(hand,`angular knuckle shield ${f}`,[V(fx-.010,.069,.029),V(fx,.063,.032),V(fx+.010,.069,.029),V(fx+.009,.087,.026),V(fx,.094,.03),V(fx-.009,.087,.026)],m,.006);
 }
 const thumb=new THREE.Group();thumb.name='separate articulated thumb';thumb.position.set(-.037,.021,-.001);thumb.rotation.z=.63;hand.add(thumb);for(let j=0;j<2;j++){const t=mesh(thumb,`leather thumb phalanx ${j}`,new THREE.CapsuleGeometry(.013,.021,4,8),m.leather);t.position.y=.019+j*.031;const f:Surface=(u,v)=>{const a=mix(-1.5,1.5,u);return V(Math.sin(a)*.014,mix(.004+j*.03,.034+j*.03,v),Math.cos(a)*.015);};plate(thumb,`thumb plate ${j}`,f,m,8,3);}
 for(const q of [-1,1])rivet(hand,V(q*.039,-.016,.025),m,.0035);
 }}
export const author:ItemModelAuthor={ids,build(id){if(!ids.includes(id as typeof ids[number]))throw new Error(`Unknown cindersteel armor: ${id}`);const g=new THREE.Group();g.name=id;g.userData.itemModel={itemId:id,author:'armor-cindersteel',reference:`art/item-icons/generated/${id}.png`,description:`${id.replaceAll('_',' ')} forged for level 50 melee combat. Blackened hammered steel with copper rolled borders, red copper inlay, articulated plates and dark leather fastenings.`,wearable:true};const m=materials();if(id==='cindersteel_helm')helm(g,m);else if(id==='cindersteel_plate')chest(g,m);else if(id==='cindersteel_greaves')legs(g,m);else if(id==='cindersteel_boots')boots(g,m);else gloves(g,m);return g;}};

