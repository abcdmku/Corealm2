import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Surface = (u: number, v: number) => THREE.Vector3;
const V = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
const mix = (a:number,b:number,t:number) => a+(b-a)*t;
const ids = ['cindersteel_helm','cindersteel_plate','cindersteel_greaves','cindersteel_boots','cindersteel_gauntlets'] as const;
function texture(kind:'steel'|'copper'|'leather'|'normal'|'rough'):THREE.DataTexture {
 const n=256,data=new Uint8Array(n*n*4),hash=(x:number,y:number)=>{const t=Math.sin(x*127.1+y*311.7+13.14)*43758.5453;return t-Math.floor(t);};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(y*n+x)*4,grain=hash(x,y),cx=Math.floor(x/10),cy=Math.floor(y/10);let dent=0,dx=0,dy=0;
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const sx=cx+ox,sy=cy+oy,px=x-(sx+.18+hash(sx,sy)*.64)*10,py=y-(sy+.18+hash(sy+18,sx)*.64)*10,w=10+hash(sx+5,sy+8)*14,amp=.5+hash(sx+3,sy)*.5,bell=Math.exp(-(px*px+py*py)/w)*amp;dent+=bell;dx+=px*bell*.032;dy+=py*bell*.032;}
  const scratch=Math.abs(Math.sin(x*.31+y*.69+Math.sin(y*.07)*1.6))<.025&&hash(Math.floor(x/12),Math.floor(y/13))>.45;
  if(kind==='normal'){const normal=V(dx,dy,1).normalize();data[i]=Math.round(128+normal.x*127);data[i+1]=Math.round(128+normal.y*127);data[i+2]=Math.round(128+normal.z*127);}
  else{const base=kind==='steel'?[151,155,158]:kind==='copper'?[219,153,108]:kind==='leather'?[43,29,23]:[191,191,191];const k=kind==='rough'?.92+grain*.13-dent*.1:kind==='leather'?.72+grain*.30:.79+grain*.16+dent*.17+(scratch?.21:0);for(let c=0;c<3;c++)data[i+c]=Math.min(255,Math.round(base[c]!*k));}data[i+3]=255;
 }
 const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.name=`cindersteel-${kind}-hammer-dents-worn-grain`;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;if(!['normal','rough'].includes(kind))t.colorSpace=THREE.SRGBColorSpace;return t;
}
function materials(){
 const normal=texture('normal'),rough=texture('rough');
 const metal=(name:string,color:string,map:THREE.DataTexture)=>{const m=new THREE.MeshStandardMaterial({color,map,normalMap:normal,normalScale:new THREE.Vector2(.65,.65),roughnessMap:rough,roughness:.72,metalness:.84});m.name=name;return m;};
 const steel=metal('blackened hammered cindersteel','#ffffff',texture('steel')), copper=metal('worn copper rolled borders','#ffffff',texture('copper'));
 const ember=new THREE.MeshStandardMaterial({color:0x973820,metalness:.65,roughness:.5});ember.name='red copper recessed channels';
 const leather=new THREE.MeshStandardMaterial({map:texture('leather'),roughness:.96,metalness:0});leather.name='dark stitched hide lining';
 return {steel,copper,ember,leather};
}
type Mats=ReturnType<typeof materials>;
function assembly(g:THREE.Group,name:string,bone:string){const a=new THREE.Group();a.name=name;a.userData.itemModelBone=bone;g.add(a);return a;}
function mesh(g:THREE.Group,name:string,geo:THREE.BufferGeometry,mat:THREE.Material){const m=new THREE.Mesh(geo,mat);m.name=name;let parent:THREE.Object3D|null=g;while(parent){if(typeof parent.userData.itemModelBone==='string'){if(mat instanceof THREE.MeshStandardMaterial&&mat.metalness>.2)m.userData.itemModelBone=parent.userData.itemModelBone;break;}parent=parent.parent;}g.add(m);return m;}
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
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();if(mat instanceof THREE.MeshStandardMaterial&&mat.flatShading){const flat=geo.toNonIndexed();flat.computeVertexNormals();geo.dispose();return mesh(g,name,flat,mat);}return mesh(g,name,geo,mat);
}
function border(g:THREE.Group,name:string,f:Surface,m:Mats,r=.0025){const pts:THREE.Vector3[]=[];for(let i=0;i<=20;i++)pts.push(f(i/20,0));for(let i=1;i<=12;i++)pts.push(f(1,i/12));for(let i=19;i>=0;i--)pts.push(f(i/20,1));for(let i=11;i>=1;i--)pts.push(f(0,i/12));path(g,name,pts,r,m.copper,true);}
function plate(g:THREE.Group,name:string,f:Surface,m:Mats,nu=24,nv=12){shell(g,name,f,m.steel,.006,nu,nv);border(g,`${name} rolled copper rim`,f,m,.003);
 for(const end of [0,1]){const across:Surface=(u,v)=>f(u,end===0?v*.036:1-v*.036);shell(g,`${name} broad copper end bevel`,across,m.copper,.008,nu,2);const side:Surface=(u,v)=>f(end===0?u*.027:1-u*.027,v);shell(g,`${name} copper side bevel`,side,m.copper,.008,2,nv);}
}
function tube(g:THREE.Group,name:string,y0:number,y1:number,rx0:number,rx1:number,rz0:number,rz1:number,m:Mats,cx=0,cz=0,mat:THREE.Material=m.steel){const f:Surface=(u,v)=>{const a=u*Math.PI*2;return V(cx+Math.sin(a)*mix(rx0,rx1,v),mix(y0,y1,v),cz+Math.cos(a)*mix(rz0,rz1,v));};shell(g,name,f,mat,.004,24,4);for(const v of [0,1])path(g,`${name} opening rolled edge`,Array.from({length:40},(_,i)=>f(i/40,v)),.0025,m.copper,true);return f;}
function facet(g:THREE.Group,name:string,points:THREE.Vector3[],m:Mats,ridge=.008){const center=points.reduce((a,p)=>a.add(p),V(0,0,0)).multiplyScalar(1/points.length);center.z+=ridge;const p:number[]=[],uv:number[]=[],ix:number[]=[];for(const v of [...points,center,...points.map(q=>q.clone().add(V(0,0,-.004)))]){p.push(v.x,v.y,v.z);uv.push(v.x*3,v.y*3);}const n=points.length;for(let i=0;i<n;i++){const j=(i+1)%n;ix.push(i,j,n,i,n+1+i,n+1+j,i,n+1+j,j);if(i>0&&i<n-1)ix.push(n+1,n+1+i+1,n+1+i);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ix);const flat=geo.toNonIndexed();flat.computeVertexNormals();geo.dispose();mesh(g,name,flat,m.steel);line(g,`${name} angular copper edge`,[...points,points[0]!],.0024,m.copper);}
function buckle(g:THREE.Group,p:THREE.Vector3,m:Mats,size=.022){const pts=[V(-size/2,-size*.7,0),V(size/2,-size*.7,0),V(size/2,size*.7,0),V(-size/2,size*.7,0)].map(q=>q.add(p));line(g,'square copper strap buckle',[...pts,pts[0]!],.0023,m.copper);line(g,'buckle tongue',[p.clone().add(V(-size/2,0,0)),p.clone().add(V(size*.35,0,.001))],.0016,m.copper);}
function straps(g:THREE.Group,cx:number,cz:number,ys:number[],rx:number,rz:number,m:Mats){for(const y of ys){tube(g,'circumferential leather closing strap',y-.009,y+.009,rx,rx,rz,rz,m,cx,cz,m.leather);buckle(g,V(cx+rx*.68,y,cz+rz*.8),m);rivet(g,V(cx-rx*.6,y,cz+rz*.84),m);}}
function helm(parent:THREE.Group,m:Mats){const g=assembly(parent,'complete rigid cindersteel helmet','Head');
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
 for(const side of [-1,1]){
 const crown:Surface=(u,v)=>{const a=side*mix(.24,1.31,u),t=mix(.22,1.45,v);return V(.110*Math.sin(t)*Math.sin(a),1.695+.148*Math.cos(t),-.014+.129*Math.sin(t)*Math.cos(a));};plate(g,'separate overlapping crown cheek panel',crown,m,12,12);
 const red:Surface=(u,v)=>{const a=side*mix(.19,.235,u),t=mix(.25,1.36,v);return V(.112*Math.sin(t)*Math.sin(a),1.695+.151*Math.cos(t),-.014+.132*Math.sin(t)*Math.cos(a));};shell(g,'copper red channel alongside crown crest',red,m.ember,.003,2,18);
 const temple:Surface=(u,v)=>{const a=side*mix(1.12,1.82,u);return V(Math.sin(a)*.120,mix(1.565,1.691,v),-.015+Math.cos(a)*.129);};plate(g,'hinged copper bordered temple defense',temple,m,8,8);
 const stud=mesh(g,'large hammered copper hinge rosette',new THREE.CylinderGeometry(.012,.012,.011,12),m.copper);stud.rotation.z=Math.PI/2;stud.position.set(side*.123,1.670,.01);
 }
 for(let i=0;i<2;i++){const nape:Surface=(u,v)=>{const a=mix(1.35,4.93,u);return V(Math.sin(a)*(.115+i*.008+v*.005),mix(1.585-i*.027,1.555-i*.027,v),-.014+Math.cos(a)*(.128+i*.009+v*.005));};plate(g,'overlapping rear neck defense lame',nape,m,16,3);}
 tube(g,'flared articulated neck flange',1.523,1.546,.123,.109,.139,.12,m,0,-.015);
}
function chest(parent:THREE.Group,m:Mats){
 // Inset backing shares the rigid plate bone. Only the narrow waist gusset blends.
 for(const span of [{lo:1.099,hi:1.413,rx:.162,rz:.139,bone:'spine_03'},{lo:.954,hi:1.119,rx:.147,rz:.112,bone:'spine_01'}]){const backing:Surface=(u,v)=>{const a=u*Math.PI*2;return V(Math.sin(a)*span.rx,mix(span.lo,span.hi,v),-.009+Math.cos(a)*span.rz);};const lining=shell(parent,'inset rigid torso plate backing',backing,m.leather,.004,24,10);lining.userData.itemModelBone=span.bone;}
 const waistGusset:Surface=(u,v)=>{const a=u*Math.PI*2;return V(Math.sin(a)*.143,mix(1.089,1.116,v),-.009+Math.cos(a)*.108);};shell(parent,'narrow flexible waist gusset',waistGusset,m.leather,.004,24,2);
 const g=assembly(parent,'rigid breast and back cuirass','spine_03');
 const front:Surface=(u,v)=>{const a=u*2-1,w=.157+.031*Math.sin(v*Math.PI*.85),y=mix(1.115,1.468,v)-.039*(1-a*a)*Math.pow(v,8),ridge=.013*(1-Math.abs(a));return V(a*w,y,.031+(.115+.025*Math.sin(v*Math.PI))*(1-.38*a*a)+ridge);};
 const back:Surface=(u,v)=>{const a=u*2-1;return V(a*(.171+.018*Math.sin(v*Math.PI)),mix(1.105,1.459,v)-.025*(1-a*a)*Math.pow(v,8),-.028-(.132+.018*Math.sin(v*Math.PI))*(1-.25*a*a));};
 plate(g,'sculpted heavy breastplate',front,m,24,16);plate(g,'complete shoulder blade backplate',back,m,24,16);
 // Distinct raised pectoral panels form the angular fork around the central keel.
 for(const side of [-1,1]){
  const panel:Surface=(u,v)=>{const xx=mix(.027,.177,u),yy=mix(1.232+.073*u,1.394+.025*u,v);return V(side*xx,yy,.178-.037*Math.pow(xx/.177,2)+.006*Math.sin(v*Math.PI));};plate(g,'raised angular pectoral panel',panel,m,14,6);
  const points=[V(side*.028,1.246,.185),V(side*.073,1.285,.18),V(side*.096,1.353,.167),V(side*.176,1.398,.149)];line(g,'broad copper breast fork underlay',points,.005,m.copper);line(g,'ember red breast fork inset',points.map(p=>p.clone().add(V(0,0,.003))),.0023,m.ember);
  const sideShell:Surface=(u,v)=>V(side*(.181+.008*Math.sin(v*Math.PI)),mix(1.116,1.351,v),mix(-.135,.12,u));plate(g,'rigid flank closing plate',sideShell,m,8,8);
  const strap:Surface=(u,v)=>V(side*mix(.128,.153,u),mix(1.337,1.462,v),mix(.163,.087,v));shell(g,'stitched shoulder suspension leather strap',strap,m.leather,.007,3,10).userData.itemModelBone='spine_03';buckle(g,V(side*.14,1.397,.139),m,.025);for(const yy of [1.345,1.442])rivet(g,V(side*.14,yy,yy<1.4?.16:.103),m,.0045);
  for(let k=0;k<2;k++){const bg=assembly(parent,`waist fastening ${side} ${k}`,'spine_01');buckle(bg,V(side*.168,1.08-k*.075,.122),m,.025);}
  const cap=assembly(parent,`inner shoulder cap ${side}`,'spine_03');const capSurface:Surface=(u,v)=>{const a=mix(-1.52,1.52,u),xx=side*mix(.105,.258,v);return V(xx,1.459+Math.cos(a)*(.064+.035*Math.sin(v*Math.PI*.75)),-.053+Math.sin(a)*(.089+.039*v));};plate(cap,'fixed copper bordered upper shoulder bridge',capSurface,m,18,8);for(const u of [.15,.85])rivet(cap,capSurface(u,.65),m,.0045);
  const pauldron=assembly(parent,`layered ${side===1?'left':'right'} shoulder armor`,`upperarm_${side===1?'l':'r'}`);
  for(let l=0;l<3;l++){const f:Surface=(u,v)=>{const a=mix(-1.55,1.55,u),xx=side*(.195+l*.04+v*.079),crest=.018*Math.pow(Math.max(0,Math.cos(a)),5)*(1-v);return V(xx,1.448+Math.cos(a)*(.106-l*.009)+crest-.009*v,-.063+Math.sin(a)*(.14-l*.009));};plate(pauldron,`articulated shoulder plate ${l}`,f,m,18,5);for(const u of [.13,.87])rivet(pauldron,f(u,.77),m,.0048);}
  const fauld=assembly(parent,`overlapping ${side===1?'left':'right'} hip fauld`,'pelvis');
  for(let l=0;l<3;l++){const f:Surface=(u,v)=>{const a=side*mix(.17,1.5,u);return V(Math.sin(a)*(.176+l*.013+v*.015),1.064-l*.047-v*.061,.002+Math.cos(a)*(.135+l*.01+v*.009));};plate(fauld,`flared fauld lame ${l}`,f,m,14,4);for(const u of [.13,.88])rivet(fauld,f(u,.3),m,.0045);}
 }
 tube(g,'raised open padded gorget',1.428,1.498,.105,.098,.096,.091,m,0,-.012);
 facet(g,'long faceted copper bordered breast keel',[V(0,1.451,.191),V(.016,1.411,.187),V(.013,1.25,.192),V(0,1.216,.194),V(-.013,1.25,.192),V(-.016,1.411,.187)],m,.012);
 const abdomen=assembly(parent,'articulated abdominal plates','spine_01');for(let i=0;i<3;i++)facet(abdomen,`pointed abdominal plate ${i}`,[V(-.073+i*.011,1.226-i*.073,.142),V(0,1.239-i*.073,.168),V(.073-i*.011,1.226-i*.073,.142),V(.063-i*.011,1.151-i*.073,.149),V(0,1.119-i*.073,.18),V(-.063+i*.011,1.151-i*.073,.149)],m,.008);
}
function legs(parent:THREE.Group,m:Mats){const g=parent;
 const saddle:Surface=(u,v)=>{const a=u*Math.PI*2;return V(Math.sin(a)*mix(.163,.159,v),mix(.887,.995,v),-.035+Math.cos(a)*mix(.125,.118,v));};shell(parent,'rigid inset leather hip and crotch backing',saddle,m.leather,.005,32,8).userData.itemModelBone='pelvis';m={...m,steel:m.steel.clone(),copper:m.copper.clone()};m.steel.flatShading=true;m.copper.roughness=.48;for(const s of [-1,1]){const x=s*.1143,z=-.036;
 const shape=(part:'thigh'|'shin',a:number,v:number)=>{const thigh=part==='thigh';
  const rx=thigh?(v<.68?mix(.052,.086,v/.68):mix(.086,.105,(v-.68)/.32)):(v<.67?mix(.038,.083,v/.67):mix(.083,.065,(v-.67)/.33));
  const rz=thigh?mix(.059,.105,v):(v<.67?mix(.050,.092,v/.67):mix(.092,.071,(v-.67)/.33));
  const q=a/(Math.PI/4),k=Math.floor(q),t=q-k,sn=mix(Math.sin(k*Math.PI/4),Math.sin((k+1)*Math.PI/4),t),cs=mix(Math.cos(k*Math.PI/4),Math.cos((k+1)*Math.PI/4),t),front=Math.max(0,cs);
  return V(x+sn*rx, (thigh?mix(.582,.926,v):mix(.15,.51,v))+(thigh?-.015*front*(1-v)+.035*Math.abs(sn)*v:.020*front*(1-v)),z+cs*rz+.023*front*Math.pow(1-Math.abs(sn),2)-Math.max(0,-cs)*(thigh?.021:.041));};
 for(const part of ['thigh','shin'] as const){const g=assembly(parent,`${part} rigid plate assembly ${s}`,`${part==='thigh'?'thigh':'calf'}_${s===1?'l':'r'}`);
  const liner:Surface=(u,v)=>{const a=u*Math.PI*2,p=shape(part,a,v);return p.add(V(-Math.sin(a)*.014,0,-Math.cos(a)*.014));};shell(g,`${part} inset rigid leather underplate`,liner,m.leather,.004,24,10).userData.itemModelBone=`${part==='thigh'?'thigh':'calf'}_${s===1?'l':'r'}`;
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
   for(const side of [-1,1]){const tab:Surface=(u,w)=>shape(part,side*mix(1.28,2.13,u),v+(w-.5)*.058).add(V(side*.004,0,0));shell(g,`${part} side seam leather buckle tab`,tab,m.leather,.005,8,2).userData.itemModelBone=`${part==='thigh'?'thigh':'calf'}_${s===1?'l':'r'}`;
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
 const kneeGroup=assembly(parent,`rigid knee assembly ${s}`,`calf_${s===1?'l':'r'}`);
 const kneeBack:Surface=(u,v)=>V(x+Math.sin(u*Math.PI*2)*.046,mix(.494,.600,v),z+Math.cos(u*Math.PI*2)*.056);shell(g,'flexible leather knee joint',kneeBack,m.leather,.004,24,5);
 facet(kneeGroup,'projecting pointed knee cop',[V(x-.061,.562,.049),V(x,.592,.067),V(x+.061,.562,.049),V(x+.049,.514,.06),V(x,.480,.084),V(x-.049,.514,.06)],m,.026);
 facet(kneeGroup,'upper knee articulated brow',[V(x-.055,.580,.053),V(x,.603,.069),V(x+.055,.580,.053),V(x+.051,.561,.066),V(x,.577,.078),V(x-.051,.561,.066)],m,.009);
 for(const q of [-1,1])rivet(kneeGroup,V(x+q*.05,.548,.066),m,.0037);
 }}
function boots(parent:THREE.Group,m:Mats){m={...m,steel:m.steel.clone(),copper:m.copper.clone()};m.steel.flatShading=true;m.copper.roughness=.48;for(const s of [-1,1]){const g=assembly(parent,`complete boot assembly ${s}`,`foot_${s===1?'l':'r'}`),x=s*.1143;
 const shaftAt=(a:number,v:number)=>{const rx=v<.3?mix(.045,.043,v/.3):mix(.043,.078,(v-.3)/.7),rz=v<.3?mix(.057,.052,v/.3):mix(.052,.083,(v-.3)/.7);const q=a/(Math.PI/4),k=Math.floor(q),t=q-k,sn=mix(Math.sin(k*Math.PI/4),Math.sin((k+1)*Math.PI/4),t),cs=mix(Math.cos(k*Math.PI/4),Math.cos((k+1)*Math.PI/4),t);return V(x+sn*rx,mix(.09,.312,v)+.016*Math.max(0,cs)*v,-.068+cs*rz);};
 shell(g,'inset rigid leather boot shaft',(u,v)=>{const a=u*Math.PI*2;return shaftAt(a,v).add(V(-Math.sin(a)*.014,0,-Math.cos(a)*.014));},m.leather,.005,24,12).userData.itemModelBone=`foot_${s===1?'l':'r'}`;
 const shaft:Surface=(u,v)=>shaftAt(mix(-1.53,1.53,u),v).add(V(0,0,.006+Math.max(0,1-Math.abs(u*2-1))*.006));plate(g,'beveled tapered boot shin shield',shaft,m,16,12);border(g,'broad copper boot shield bevel',shaft,m,.004);const lip:Surface=(u,v)=>shaft(u,mix(.92,1,v)).add(V(0,0,.004));shell(g,'broad flared copper cuff lip',lip,m.copper,.003,16,2);
 const route=[[.10,.47],[.47,.27],[.60,.42],[.63,.98]];for(let j=1;j<route.length;j++){const aa=route[j-1]!,bb=route[j]!;const strip:Surface=(u,v)=>shaft(mix(aa[0]!,bb[0]!,v)+(u-.5)*.04,mix(aa[1]!,bb[1]!,v)).add(V(0,0,.010));shell(g,'broad angular copper boot shield border',strip,m.copper,.003,2,20);const hot:Surface=(u,v)=>shaft(mix(aa[0]!,bb[0]!,v)+(u-.5)*.016,mix(aa[1]!,bb[1]!,v)).add(V(0,0,.012));shell(g,'red inset along boot border',hot,m.ember,.002,2,20);}
 const rear:Surface=(u,v)=>shaftAt(mix(1.58,4.70,u),v).add(V(0,0,-.004));plate(g,'shaped rear boot heel and calf counter',rear,m,12,10);
 for(const h of [.12,.62,.88]){const lame:Surface=(u,v)=>rear(u,h+v*.115).add(V(0,0,-.006));plate(g,'overlapping rear calf closure plate',lame,m,12,3);for(const u of [.15,.85])rivet(g,lame(u,.5),m,.0037);}
 for(const vv of [.23,.78]){const tab:Surface=(u,v)=>shaftAt(s*mix(1.1,2.55,u),vv+(v-.5)*.105).add(V(s*.005,0,0));shell(g,'integrated side closing leather strap',tab,m.leather,.005,10,2);rivet(g,tab(.10,.5).add(V(0,0,.004)),m,.004);const bg=new THREE.Group();bg.name='anchored boot buckle';bg.position.copy(tab(.53,.5));bg.rotation.y=s*1.88;g.add(bg);buckle(bg,V(0,0,.004),m,.020);}
 const outline=new THREE.Shape();outline.moveTo(-.052,-.132);outline.quadraticCurveTo(-.067,-.10,-.065,.07);outline.quadraticCurveTo(-.065,.168,0,.173);outline.quadraticCurveTo(.065,.168,.065,.07);outline.quadraticCurveTo(.067,-.10,.052,-.132);outline.closePath();
 const soleGeo=new THREE.ExtrudeGeometry(outline,{depth:.018,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.004,bevelThickness:.003,curveSegments:16});soleGeo.rotateX(Math.PI/2);const sole=mesh(g,'rounded welt sole',soleGeo,m.leather);sole.position.set(x,.033,-.016);
 const heel=new THREE.Shape();heel.moveTo(-.047,-.13);heel.lineTo(.047,-.13);heel.quadraticCurveTo(.059,-.10,.053,-.060);heel.lineTo(-.053,-.060);heel.quadraticCurveTo(-.059,-.10,-.047,-.13);const hg=new THREE.ExtrudeGeometry(heel,{depth:.012,bevelEnabled:true,bevelSize:.003,bevelThickness:.002,bevelSegments:2});hg.rotateX(Math.PI/2);const hm=mesh(g,'separate stacked heel below sole',hg,m.leather);hm.position.set(x,.016,-.016);
 // Leather sits inside the armor; the instep plates are the outermost surface.
 const foot:Surface=(u,v)=>{const a=mix(-Math.PI/2,Math.PI/2,u),zz=mix(-.11,.143,v),h=mix(.082,.047,v);return V(x+Math.sin(a)*.059,.037+Math.cos(a)*h,zz);};shell(g,'fully enclosed leather vamp',foot,m.leather,.005,20,12).userData.itemModelBone=`foot_${s===1?'l':'r'}`;
 for(let i=0;i<4;i++){const f:Surface=(u,v)=>{const a=mix(-1.48,1.48,u),zz=mix(-.069+i*.045,-.011+i*.045,v),h=.109-i*.013-v*.008;return V(x+Math.sin(a)*.066,.038+Math.cos(a)*h,zz);};plate(g,`visible overlapping instep sabaton plate ${i}`,f,m,12,5);for(const u of [.10,.9])rivet(g,f(u,.63).add(V(0,.001,.002)),m,.0035);
 const cp=[f(.5,.03),f(.5,.95)].map(q=>q.add(V(0,.003,0)));line(g,'instep plate recessed center copper seam',cp,.0025,m.ember);}
 const toe:Surface=(u,v)=>{const a=mix(-Math.PI/2,Math.PI/2,u),t=v*Math.PI/2;return V(x+Math.sin(a)*.066*Math.cos(t),.038+Math.cos(a)*.068*Math.cos(t),.110+.048*Math.sin(t));};plate(g,'faceted domed closed sabaton toe cap',toe,m,12,8);
 path(g,'toe cap copper center rib',Array.from({length:10},(_,i)=>toe(.5,i/9).add(V(0,.002,0))),.0024,m.copper);
 const heelPlate:Surface=(u,v)=>{const a=mix(1.32,4.96,u);return V(x+Math.sin(a)*mix(.060,.049,v),mix(.037,.123,v),-.069+Math.cos(a)*mix(.070,.058,v));};plate(g,'wrapped armored heel cup',heelPlate,m,12,6);
 const welt=Array.from({length:48},(_,i)=>{const a=i*Math.PI/24;return V(x+Math.sin(a)*.064,.035,-.014+Math.cos(a)*.145);});path(g,'continuous stitched sole welt',welt,.0012,m.copper,true);
 for(let i=0;i<24;i++){const a=i*Math.PI/12;rivet(g,V(x+Math.sin(a)*.064,.036,-.014+Math.cos(a)*.145),m,.0012);}
 }}
function gloves(g:THREE.Group,m:Mats){for(const s of [-1,1]){
 const hand=new THREE.Group();hand.name=s===1?'left native T pose gauntlet':'right native T pose gauntlet';hand.userData.itemModelBone=`hand_${s===1?'l':'r'}`;g.add(hand);hand.position.set(s*.7065,1.4555,-.0654);hand.rotation.z=-s*Math.PI/2;
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
 facet(hand,'pointed raised cuff shield',[V(-.020,-.060,.054),V(0,-.077,.061),V(.020,-.060,.054),V(.020,-.031,.044),V(0,-.018,.048),V(-.020,-.031,.044)],m,.008);
 facet(hand,'overlapping wrist chevron',[V(-.041,-.002,.033),V(0,.010,.039),V(.041,-.002,.033),V(.042,.014,.033),V(0,.025,.041),V(-.042,.014,.033)],m,.006);
 for(const q of [-1,1]){line(hand,'raised copper fork on dorsal hand',[V(q*.028,.025,.037),V(q*.019,.050,.043),V(q*.011,.075,.035)],.0025,m.copper);rivet(hand,V(q*.039,-.016,.025),m,.0042);}
 }}
export const author:ItemModelAuthor={ids,build(id){if(!ids.includes(id as typeof ids[number]))throw new Error(`Unknown cindersteel armor: ${id}`);const g=new THREE.Group();g.name=id;g.userData.itemModel={itemId:id,author:'armor-cindersteel',reference:`art/item-icons/generated/${id}.png`,description:`${id.replaceAll('_',' ')} forged for level 50 melee combat. Blackened hammered steel with copper rolled borders, red copper inlay, articulated plates and dark leather fastenings.`,wearable:true,...(id==='cindersteel_plate'?{bodyCoverage:[{region:'torso',minY:.959,maxY:1.408}]}:id==='cindersteel_greaves'?{bodyCoverage:[{region:'legs',minY:.155,maxY:.978}]}:{})};const m=materials();if(id==='cindersteel_helm')helm(g,m);else if(id==='cindersteel_plate')chest(g,m);else if(id==='cindersteel_greaves')legs(g,m);else if(id==='cindersteel_boots')boots(g,m);else gloves(g,m);return g;}};


