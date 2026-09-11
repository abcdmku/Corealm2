import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU=Math.PI*2;
const v=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
function add(g:THREE.Group,name:string,geo:THREE.BufferGeometry,mat:THREE.Material){geo.name=name+' geometry';const m=new THREE.Mesh(geo,mat);m.name=name;g.add(m);return m;}
function tex(data:Uint8Array,size:number,name:string,color=false){const t=new THREE.DataTexture(data,size,size);t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;if(color)t.colorSpace=THREE.SRGBColorSpace;return t;}
/** Volumetric-looking mineral colour is evaluated on a sphere, so its longitude seam closes. */
function mineral(star:boolean,rock=false){
 const n=256,d=new Uint8Array(n*n*4),sites=Array.from({length:38},(_,i)=>{const a=i*2.399963,r=Math.sqrt(1-Math.pow(1-2*(i+.5)/38,2));return v(r*Math.cos(a),1-2*(i+.5)/38,r*Math.sin(a));});
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=x/n*TAU,b=y/n*Math.PI,p=v(Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a));let first=99,second=99;
  for(const s of sites){const q=p.distanceToSquared(s);if(q<first){second=first;first=q;}else if(q<second)second=q;}
  const noise=(Math.sin(p.x*133+p.y*157)*Math.sin(p.z*193-p.y*87)+1)*.5;
  const fine=(Math.sin(p.x*613+p.z*91)*Math.sin(p.z*383-p.y*287)+1)*.5;
  const vein=Math.pow(Math.max(0,1-(second-first)/.035),3),fire=.24+.44*noise+.25*fine;
  const sheen=star?Math.pow(Math.max(0,Math.sin(p.x*12+p.z*9)*Math.cos(p.y*14)),5):0;
  const c=rock?new THREE.Color().setRGB(.075+noise*.08+vein*.83,.065+noise*.045+vein*.21,.058+noise*.025):new THREE.Color().setRGB(.46+fire*.5+vein*.28,.025+fire*fire*.25+vein*.63,.002+sheen*.69);
  if(!rock&&sheen>.3){c.g+=sheen*.55;c.b+=sheen*.3;}
  const i=(y*n+x)*4;d[i]=Math.min(255,c.r*255);d[i+1]=Math.min(255,c.g*255);d[i+2]=Math.min(255,c.b*255);d[i+3]=255;
 }return tex(d,n,rock?'Basalt plates with molten hairline fissures':'Fire opal cellular fracture and mineral play of colour',true);
}
function surfaceNormal(){const n=128,d=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=(y*n+x)*4;d[i]=128+Math.round(17*Math.sin(x*1.71+y*.17)*Math.cos(y*.63));d[i+1]=128+Math.round(17*Math.cos(y*1.83-x*.25)*Math.sin(x*.38));d[i+2]=252;d[i+3]=255;}return tex(d,n,'Fine chased metal tool marks tangent normal');}
function materials(star:boolean){const normal=surfaceNormal(),opal=mineral(star);return {
 metal:new THREE.MeshStandardMaterial({name:star?'Polished blue-black meteoric silver':'Oxidised warm dark bronze',color:star?0x354568:0x5e483e,metalness:1,roughness:.29,normalMap:normal,normalScale:new THREE.Vector2(.35,.35)}),
 edge:new THREE.MeshStandardMaterial({name:star?'Bright cold silver chased edges':'Burnished copper edges',color:star?0x8497b6:0xb28466,metalness:1,roughness:.28}),
 cord:new THREE.MeshStandardMaterial({name:star?'Twisted violet silk bindings':'Blackened braided binding cord',color:star?0x4b206e:0x36312f,roughness:.8}),
 gem:new THREE.MeshPhysicalMaterial({name:star?'Prismatic molten fire opal':'Cracked amber fire opal',color:0xffffff,map:opal,emissiveMap:opal,emissive:0xff6c18,emissiveIntensity:.25,roughness:.14,metalness:0,transmission:.16,thickness:.006,ior:1.46,clearcoat:1,clearcoatRoughness:.07,iridescence:star?.38:.1,iridescenceIOR:1.4}),
 violet:new THREE.MeshPhysicalMaterial({name:'Violet inset star enamel',color:0x501dab,metalness:.4,roughness:.16,clearcoat:1}),
 lava:new THREE.MeshStandardMaterial({name:'Recessed orange molten seams',color:0x9b2605,emissive:0xff4d00,emissiveIntensity:.65,roughness:.48}),
 rock:new THREE.MeshStandardMaterial({name:'Cracked volcanic iron band',color:0xffffff,map:mineral(false,true),normalMap:normal,normalScale:new THREE.Vector2(.8,.8),metalness:.8,roughness:.48})};}
type Mats=ReturnType<typeof materials>;
/** Closed rounded rectangular wire, with width carried continuously through bends. */
function ribbon(g:THREE.Group,name:string,points:THREE.Vector3[],w:number,h:number,mat:THREE.Material,closed=false,steps=90,sides=12){
 const c=new THREE.CatmullRomCurve3(points,closed),f=c.computeFrenetFrames(steps,closed),pos:number[]=[],uv:number[]=[],idx:number[]=[];
 for(let i=0;i<=steps;i++){const p=c.getPoint(i/steps);for(let j=0;j<=sides;j++){const a=j/sides*TAU,cs=Math.cos(a),sn=Math.sin(a),q=p.clone().addScaledVector(f.normals[i]!,Math.sign(cs)*Math.pow(Math.abs(cs),.45)*w).addScaledVector(f.binormals[i]!,Math.sign(sn)*Math.pow(Math.abs(sn),.45)*h);pos.push(q.x,q.y,q.z);uv.push(i/steps*4,j/sides);}}
 for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const p=i*(sides+1)+j,q=p+sides+1;idx.push(p,p+1,q,p+1,q+1,q);}
 if(!closed)for(let j=1;j<sides-1;j++){idx.push(0,j+1,j);const p=steps*(sides+1);idx.push(p,p+j,p+j+1);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return add(g,name,geo,mat);
}
function loop(g:THREE.Group,name:string,rx:number,ry:number,z:number,w:number,h:number,mat:THREE.Material,cy=0){return ribbon(g,name,Array.from({length:40},(_,i)=>{const a=i/40*TAU;return v(rx*Math.cos(a),cy+ry*Math.sin(a),z);}),w,h,mat,true);}
function stone(g:THREE.Group,m:Mats,rx:number,ry:number,depth:number,faceted=false,pear=false){
 const geo=new THREE.SphereGeometry(1,faceted?14:80,faceted?10:48);const p=geo.getAttribute('position');for(let i=0;i<p.count;i++){const y=p.getY(i),t=pear?1-.23*y:1;p.setXYZ(i,p.getX(i)*rx*t,y*ry,p.getZ(i)*depth);}geo.computeVertexNormals();
 const final=faceted?geo.toNonIndexed():geo;if(faceted)final.computeVertexNormals();add(g,'Solid fire opal with polished crown and full pavilion',final,m.gem);
}
function binding(g:THREE.Group,m:Mats,center:THREE.Vector3,axis:THREE.Vector3,radius:number,turns=4){
 const ax=axis.clone().normalize(),u=v(0,0,1);if(Math.abs(ax.dot(u))>.9)u.set(1,0,0);u.cross(ax).normalize();const b=ax.clone().cross(u).normalize();
 for(let strand=0;strand<3;strand++){const pts=Array.from({length:turns*25+1},(_,i)=>{const t=i/(turns*25),a=t*turns*TAU;return center.clone().addScaledVector(ax,(t-.5)*.0016).addScaledVector(u,Math.cos(a)*(radius+.00008*Math.cos(a*5+strand*TAU/3))).addScaledVector(b,Math.sin(a)*(radius+.00008*Math.sin(a*5+strand*TAU/3)));});ribbon(g,'Individual twisted cord filament '+strand,pts,.000105,.000085,m.cord,false,turns*20,6);}
}
function ringBand(g:THREE.Group,m:Mats,cinder:boolean,star:boolean){
 if(cinder){
  const pos:number[]=[],uv:number[]=[],idx:number[]=[];const N=192,S=24;
  for(let i=0;i<=N;i++){const a=i/N*TAU,top=Math.pow(Math.max(0,Math.sin(a)),4),half=.0022+top*.0013;for(let j=0;j<=S;j++){const b=j/S*TAU,x=Math.sign(Math.cos(b))*Math.pow(Math.abs(Math.cos(b)),.32),z=Math.sign(Math.sin(b))*Math.pow(Math.abs(Math.sin(b)),.32),r=.010+(.0019+top*.001)*(x+1)/2;pos.push(r*Math.cos(a),r*Math.sin(a),z*half);uv.push(i/N,j/S);}}
  for(let i=0;i<N;i++)for(let j=0;j<S;j++){const a=i*(S+1)+j,b=a+S+1;idx.push(a,b,a+1,a+1,b,b+1);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();add(g,'Broad fissured iron band with smooth twenty millimetre bore',geo,m.rock);
  for(let k=0;k<18;k++){const a=k/18*TAU;const pts=Array.from({length:7},(_,i)=>{const z=(i/6-.5)*.004,aa=a+.045*Math.sin(i*2.7+k),r=.01192+Math.pow(Math.max(0,Math.sin(aa)),4)*.001;return v(r*Math.cos(aa),r*Math.sin(aa),z);});ribbon(g,'Inset branching molten band fissure '+k,pts,.00006,.00005,m.lava,false,18);}return;
 }
 for(let strand=0;strand<3;strand++){
  const pts=Array.from({length:96},(_,i)=>{const a=i/96*TAU,phase=a*(star?3:2)+strand*TAU/3;return v((.0112+.00032*Math.cos(phase))*Math.cos(a),(.0112+.00032*Math.cos(phase))*Math.sin(a),Math.sin(phase)*(star?.002:.0016));});ribbon(g,'Interlaced openwork shank strand '+strand,pts,.00072,.00063,m.metal,true,190);
 }
 if(star)for(const a of [.55,2.59])binding(g,m,v(Math.cos(a)*.0113,Math.sin(a)*.0113,0),v(-Math.sin(a),Math.cos(a),0),.0020,5);
}
function setting(g:THREE.Group,m:Mats,rx:number,ry:number,d:number,cinder:boolean,star:boolean){
 loop(g,'Rear oval bearing rim',rx*.86,ry*.86,-d*.52,.00045,.00038,m.metal);
 for(let k=0;k<4;k++){
  const a=k/4*TAU+Math.PI/4,x=rx*Math.cos(a),y=ry*Math.sin(a);
  ribbon(g,'Curved gallery strut '+k,[v(x*.86,y*.86,-d*.55),v(x*1.04,y*1.04,0),v(x*.87,y*.87,d*.68)],cinder?.00036:.00056,.00032,m.metal,false,36);
 }
 loop(g,'Polished edge around open setting',rx,ry,0,.00034,.0003,m.edge);
 if(!cinder)for(let k=0;k<4;k++){
  const a=k*TAU/4+Math.PI/4,pts=Array.from({length:12},(_,i)=>{const t=i/11,angle=a+t*.68;return v(rx*Math.cos(angle)*(1-.21*t),ry*Math.sin(angle)*(1-.21*t),d*(.1+.8*t));});ribbon(g,'Swept leaf claw '+k,pts,.00065,.00034,m.metal,false,40);
  if(star)binding(g,m,pts[4]!,pts[6]!.clone().sub(pts[2]!),.00078,3);
 }
}
function bail(g:THREE.Group,m:Mats,y:number,star:boolean,cinder:boolean){
 const link=loop(g,'Articulated solid jump ring',.0023,.0027,0,.00052,.00048,m.metal,y);link.rotation.y=Math.PI/2;
 const cy=y+.0058;loop(g,'Open oval pendant bail',.0030,.0050,0,.00085,.0010,m.metal,cy);
 loop(g,'Bail polished front rim',.003,.005,.00095,.00022,.0002,m.edge,cy);
 loop(g,'Bail polished rear rim',.003,.005,-.00095,.00022,.0002,m.edge,cy);
 if(cinder)ribbon(g,'Raised angular fire rune on bail',[v(-.0008,cy+.003,.0011),v(.0007,cy+.001,.0011),v(-.0005,cy,.0011),v(.0007,cy-.002,.0011)],.00018,.00013,m.edge,false,24);
 if(star)for(const side of [-1,1])ribbon(g,'Faceted bail chase '+side,[v(side*.001,cy+.004,.001),v(side*.0026,cy+.0015,.0013),v(side*.0016,cy-.0025,.001)],.00028,.00017,m.edge,false,20);
}
function starOrnament(g:THREE.Group,m:Mats,x:number,y:number,z:number,size:number){
 const p:number[]=[],idx:number[]=[];for(let k=0;k<8;k++){const a=Math.PI/2+k/8*TAU,r=k%2===0?size:size*.38;p.push(x+Math.cos(a)*r,y+Math.sin(a)*r,z);}p.push(x,y,z+.00085,x,y,z-.00035);for(let k=0;k<8;k++){idx.push(k,(k+1)%8,8,k,9,(k+1)%8);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setIndex(idx);geo.computeVertexNormals();add(g,'Four pointed raised violet star',geo.toNonIndexed(),m.violet);
 const pts=Array.from({length:8},(_,k)=>v(p[k*3]!,p[k*3+1]!,p[k*3+2]!));ribbon(g,'Silver star border',pts,.00018,.00015,m.edge,true,48);
 for(let k=0;k<8;k+=2)ribbon(g,'Star engraved facet rib '+k,[pts[k]!,v(x,y,z+.00085)],.00010,.00009,m.edge,false,4);
}
function buildRing(itemId:string,g:THREE.Group,m:Mats){const c=itemId==='cinder_ring',s=itemId==='starweave_ring';ringBand(g,m,c,s);const crown=new THREE.Group();crown.name='Raised gemstone crown and open backed gallery';crown.rotation.x=-Math.PI/2;crown.position.y=c?.0128:.0130;g.add(crown);const rx=c?.0035:.0056,ry=c?.0044:.0070,d=c?.0022:.0035;stone(crown,m,rx,ry,d);setting(crown,m,rx,ry,d,c,s);
 if(c){for(const side of [-1,1])ribbon(crown,'Angular iron bezel shoulder '+side,[v(side*rx,ry*.9,0),v(side*rx*1.14,ry*.35,.0008),v(side*rx*1.12,-ry*.6,.0008),v(side*rx*.65,-ry*1.1,0)],.00055,.00045,m.metal,false,42);}
 else {for(const side of [-1,1]){ribbon(g,'Split shoulder rising to gallery '+side,[v(side*.0088,.006,0),v(side*.009,.010,-.002),v(side*.005,.013,-.005)],.00063,.00046,m.metal,false,42);if(!s)binding(g,m,v(side*.0045,.013,.004),v(1,0,0),.00115,5);}}
}
function buildCharm(itemId:string,g:THREE.Group,m:Mats){const c=itemId==='cinder_charm',s=itemId==='starweave_charm',rx=s?.010:.0087,ry=s?.013:.014,d=.0047;stone(g,m,rx,ry,d,s,c);setting(g,m,rx,ry,d,c,false);
 if(c){
  for(const side of [-1,1]){const pts=Array.from({length:32},(_,i)=>{const t=i/31,y=ry*(1-2*t),x=side*rx*.80*Math.sin((t-.5)*Math.PI),z=d*Math.sqrt(Math.max(.02,1-(y/ry)**2-(x/rx)**2))+.00035;return v(x,y,z);});ribbon(g,'Crossing forged cage strap '+side,pts,.0005,.00032,m.metal,false,90);
   for(const t of [.22,.78]){const p=pts[Math.round(t*31)]!;const clasp=add(g,'Cage strap folded locking collar',new THREE.BoxGeometry(.0021,.0013,.0011,1,1,1),m.edge);clasp.position.copy(p);clasp.rotation.z=side*.55;}}
  loop(g,'Rear cage perimeter',rx*.85,ry,-.0012,.0005,.00038,m.metal);
 }else if(!s){
  for(const side of [-1,1])for(let strand=0;strand<2;strand++){
   const pts=Array.from({length:24},(_,i)=>{const t=i/23,a=(t*1.05-.48)*Math.PI;return v(side*(rx*Math.cos(a)+strand*.00085),ry*Math.sin(a),.0018+.0013*Math.cos(a*2+strand));});ribbon(g,'Flame shaped folded bronze bezel '+side+' '+strand,pts,.00087,.00038,m.metal,false,78);
   ribbon(g,'Copper light on flame bezel '+side+' '+strand,pts.map(p=>p.clone().add(v(0,0,.0004))),.00013,.00012,m.edge,false,78);
  }
  for(const side of [-1,1])ribbon(g,'Lower hooked flame talon '+side,[v(side*.004,-.011,0),v(side*.003,-.014,.002),v(side*.0018,-.010,.0045)],.00083,.0004,m.metal,false,46);
 }else{
  for(const side of [-1,1])ribbon(g,'Angular star silver side prong '+side,[v(side*.006,-.011,-.001),v(side*.010,-.007,.001),v(side*.009,-.004,.004),v(side*.0075,-.003,.0045)],.0008,.00045,m.metal,false,38);
  ribbon(g,'High diagonal star clasp',[v(.008,-.002,.002),v(.007,.008,.003),v(.002,.012,.003),v(-.004,.011,.002)],.00076,.0004,m.metal,false,60);
  starOrnament(g,m,.003,.008,.0043,.003);starOrnament(g,m,-.005,-.009,.003,.0025);starOrnament(g,m,.008,-.005,.0028,.0023);
 }
 // Back is a load-bearing open basket with crossed ribs, not a flat backing card.
 for(const side of [-1,1])ribbon(g,'Rear diagonal basket rib '+side,[v(-rx*.8,-ry*.6,-d*.55),v(side*rx*.28,0,-d*1.03),v(rx*.7,ry*.67,-d*.55)],.0004,.0003,m.metal,false,60);
 for(let k=0;k<2;k++)loop(g,'Coiled neck ferrule '+k,.0027,.0011,.0002,.00046,.0004,m.metal,ry+.0007+k*.0012);
 bail(g,m,ry+.0022,s,c);
}
export const author:ItemModelAuthor={ids:['cinder_ring','cinder_charm','emberweave_ring','emberweave_charm','starweave_ring','starweave_charm'],build(itemId){if(!this.ids.includes(itemId))throw new Error('Unknown jewelry '+itemId);const g=new THREE.Group();g.name=itemId+' complete forged jewelry';const m=materials(itemId.startsWith('starweave'));if(itemId.endsWith('_ring'))buildRing(itemId,g,m);else buildCharm(itemId,g,m);g.userData.itemModel={itemId,author:'jewelry-magic-b',reference:`art/item-icons/generated/${itemId}.png`,description:itemId==='cinder_ring'?'A dark band that is always a shade warmer than the hand wearing it. Cracked iron shank, small fire opal and angular raised bezel.':itemId==='cinder_charm'?'A fire opal cracked in the kiln and wire-caged. Emberlash comes easier holding it. Full pear-shaped mineral, crossing iron straps, locking collars and articulated rune bail.':itemId.startsWith('emberweave')?'Fire opal held by woven oxidised bronze flames with burnished edges, open gallery, and complete rear construction matching the approved icon.':'Prismatic fire opal in blue-black silver. Ring has open interwoven shank and violet silk lashings; pendant has a faceted stone, four-pointed violet stars and chased open bail. Unseen rear basket inferred.'};return g;}};

