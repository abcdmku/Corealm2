import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
const v = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
type Outline = (a:number)=>THREE.Vector2;
const ellipse = (x:number,y:number):Outline => a=>new THREE.Vector2(x*Math.cos(a),y*Math.sin(a));
const pear:Outline = a=>new THREE.Vector2(.0118*Math.cos(a)*(1-.30*Math.sin(a)),.017*Math.sin(a));
const marquise:Outline = a=>new THREE.Vector2(.0103*Math.cos(a)*Math.pow(Math.abs(Math.cos(a)),.30),.018*Math.sin(a));
function add(root:THREE.Group,name:string,g:THREE.BufferGeometry,m:THREE.Material) {
  g.name=name+' geometry'; const object=new THREE.Mesh(g,m);object.name=name;root.add(object);return object;
}
function metalTexture(normal:boolean,coarse=false) {
  const n=256,data=new Uint8Array(n*n*4),height=new Float32Array(n*n);let seed=92371;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const r=(seed>>>24)/255;
    height[y*n+x]=(r*.35+Math.sin(x*.19+Math.sin(y*.11)*2)*Math.sin(y*.17)*.25+Math.pow(Math.max(0,Math.sin(x*.8+y*.13)),24)*.16)*(coarse?.000025:.000010);
  }
  const h=(x:number,y:number)=>height[((y+n)%n)*n+(x+n)%n]!;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const i=(y*n+x)*4;
    if(normal) {const p=v(-(h(x+1,y)-h(x-1,y))/(.024/n),-(h(x,y+1)-h(x,y-1))/(.024/n),1).normalize();data[i]=(p.x*.5+.5)*255;data[i+1]=(p.y*.5+.5)*255;data[i+2]=(p.z*.5+.5)*255;}
    else {const r=210+30*Math.sin(x*.16+Math.sin(y*.12))*Math.sin(y*.15);data[i]=data[i+1]=data[i+2]=r;}
    data[i+3]=255;
  }
  const t=new THREE.DataTexture(data,n,n);t.name=normal?'Micrometre forging and file relief':'Uneven hand polish';t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
function metal(name:string,color:number,roughness:number,coarse=false) {return new THREE.MeshStandardMaterial({name,color,metalness:1,roughness,normalMap:metalTexture(true,coarse),roughnessMap:metalTexture(false),normalScale:new THREE.Vector2(1,1)});}
function tube(root:THREE.Group,name:string,points:THREE.Vector3[],radius:number,mat:THREE.Material,closed=false,steps=64,sides=10) {
  return add(root,name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,closed),steps,radius,sides,closed),mat);
}
function rim(root:THREE.Group,name:string,outline:Outline,z:number,r:number,mat:THREE.Material) {
  return tube(root,name,Array.from({length:80},(_,i)=>{const p=outline(i/80*TAU);return v(p.x,p.y,z);}),r,mat,true,128,10);
}
/** Closed smoothly domed cabochon or forged medallion, including a shallow convex rear. */
function dome(outline:Outline,front:number,back:number,hammer=0) {
  const p:number[]=[],uv:number[]=[],idx:number[]=[];const around=128,rows=40;
  for(let j=0;j<=rows;j++)for(let i=0;i<=around;i++) {
    const a=i/around*TAU,t=j/rows*Math.PI,xy=outline(a),r=Math.sin(t),c=Math.cos(t);
    let z=c*(c>=0?front:back);
    if(c>0)z+=hammer*Math.pow(r,.5)*(Math.sin(xy.x*2100+xy.y*800)*Math.sin(xy.y*1750)+.4*Math.sin(xy.x*5200-xy.y*2700));
    p.push(xy.x*r,xy.y*r,z);uv.push(i/around,j/rows);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<around;i++){const a=j*(around+1)+i,b=a+around+1;idx.push(a,b,a+1,a+1,b,b+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
/** Step-cut crown and triangular pavilion, with independently flat optical facets. */
function gem(outline:Outline,height:number) {
  const n=16,points:THREE.Vector3[]=[];
  for(const [scale,z,phase] of [[.025,-height*.60,0],[1,0,0],[.77,height*.61,.5],[.43,height,0]] as const)
    for(let i=0;i<n;i++){const q=outline((i+phase)/n*TAU);points.push(v(q.x*scale,q.y*scale,z));}
  const p:number[]=[],uv:number[]=[];
  const tri=(a:number,b:number,c:number)=>{for(const i of [a,b,c]){const q=points[i]!;p.push(...q.toArray());uv.push(q.x/.04+.5,q.y/.04+.5);}};
  for(let row=0;row<3;row++)for(let i=0;i<n;i++){const a=row*n+i,b=row*n+(i+1)%n,c=(row+1)*n+i,d=(row+1)*n+(i+1)%n;tri(a,b,c);tri(b,d,c);}
  for(let i=1;i<n-1;i++){tri(3*n,3*n+i,3*n+i+1);tri(0,i+1,i);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
/** A real hollow band with forged shoulders rising into a broad flush setting. */
function shank(cobalt:boolean) {
  const p:number[]=[],uv:number[]=[],idx:number[]=[];const around=192,sides=20;
  for(let i=0;i<=around;i++) {
    const a=i/around*TAU,s=Math.pow(Math.max(0,Math.sin(a)),5),width=.00225+s*(cobalt?.0037:.0032),thick=.00165+s*.0031;
    for(let j=0;j<=sides;j++) {
      const b=j/sides*TAU,c=Math.sign(Math.cos(b))*Math.pow(Math.abs(Math.cos(b)),.30),z=Math.sign(Math.sin(b))*Math.pow(Math.abs(Math.sin(b)),.30);
      const r=.01+thick*(c+1)/2; p.push(r*Math.cos(a),r*Math.sin(a),z*width);uv.push(i/around*5,j/sides);
    }
  }
  for(let i=0;i<around;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;idx.push(a,b,a+1,a+1,b,b+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
/** Broad tapered strap folded through an open teardrop bore, with metal thickness. */
function bail(root:THREE.Group,y:number,mat:THREE.Material,chain:boolean) {
  const p:number[]=[],uv:number[]=[],idx:number[]=[];const steps=72;
  for(let i=0;i<=steps;i++) {
    const a=i/steps*TAU,yy=y+.0045*Math.cos(a),zz=.0025*Math.sin(a),w=.0015+.0010*(.5+.5*Math.cos(a));
    for(const [side,layer] of [[-1,-1],[1,-1],[1,1],[-1,1]] as const){p.push(side*w,yy+Math.cos(a)*layer*.00038,zz+Math.sin(a)*layer*.00038);uv.push(i/steps,side*.5+.5);}
  }
  for(let i=0;i<steps;i++)for(let j=0;j<4;j++){const a=i*4+j,b=i*4+(j+1)%4;idx.push(a,b,a+4,b,b+4,a+4);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();add(root,'Folded tapered suspension bail',g,mat);
  for(const side of [-1,1])tube(root,'Bail rolled edge '+side,Array.from({length:40},(_,i)=>{const a=i/40*TAU;return v(side*(.0015+.0010*(.5+.5*Math.cos(a))),y+.00488*Math.cos(a),.00288*Math.sin(a));}),.00014,mat,true,64,6);
  if(chain)for(let i=0;i<12;i++) {
    const a=i/12*TAU,c=v(.0048*Math.sin(a),y+.0067+.0056*Math.cos(a),-.0005);
    const link=add(root,'Interlocked chain link '+(i+1),new THREE.TorusGeometry(.00165,.00043,8,24),mat);
    link.scale.set(.76,1.22,1);link.rotation.z=-a;link.rotation.y=i%2===0?0:Math.PI*.40;link.position.copy(c);
  }
}
function claw(root:THREE.Group,name:string,outer:THREE.Vector3,inner:THREE.Vector3,width:number,mat:THREE.Material,angular:boolean) {
  const d=inner.clone().sub(outer),t=v(-d.y,d.x,0).normalize(),mid=outer.clone().lerp(inner,.48);mid.z+=width*.55;
  const pts=[outer.clone().addScaledVector(t,-width*.6),outer.clone().addScaledVector(t,width*.6),mid.clone().addScaledVector(t,width*.56),inner.clone(),mid.clone().addScaledVector(t,-width*.56)];
  const p:number[]=[],uv:number[]=[];
  const top=mid.clone();top.z+=angular?width*.30:width*.10;
  for(let i=0;i<5;i++) {
    for(const q of [pts[i]!,pts[(i+1)%5]!,top]){p.push(...q.toArray());uv.push(q.x*100,q.y*100);}
    const a=pts[i]!,b=pts[(i+1)%5]!,aa=a.clone().add(v(0,0,-width*.35)),bb=b.clone().add(v(0,0,-width*.35));
    for(const q of [a,aa,b,b,aa,bb]){p.push(...q.toArray());uv.push(q.x*100,q.y*100);}
  }
  for(let i=1;i<4;i++)for(const q of [pts[0]!,pts[i+1]!,pts[i]!]){p.push(q.x,q.y,q.z-width*.35);uv.push(q.x*100,q.y*100);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(root,name,g,mat);
}
function amberMaterial() {return new THREE.MeshPhysicalMaterial({name:'Honey amber translucent resin',color:0xffad24,roughness:.13,transmission:.79,thickness:.007,ior:1.54,attenuationColor:new THREE.Color(0xd65d04),attenuationDistance:.025,clearcoat:.55,clearcoatRoughness:.09});}
function garnetMaterial() {return new THREE.MeshPhysicalMaterial({name:'Deep red transparent garnet',color:0xc21820,roughness:.085,transmission:.72,thickness:.006,ior:1.79,attenuationColor:new THREE.Color(0x950713),attenuationDistance:.018,clearcoat:.30,clearcoatRoughness:.07});}
function inclusions(root:THREE.Group,outline:Outline,depth:number,amber:boolean,fern:boolean) {
  const dark=new THREE.MeshStandardMaterial({name:amber?'Amber suspended bark and ancient fern':'Garnet internal dark mineral feathers',color:amber?0x693203:0x4a0611,roughness:.6});
  const warm=new THREE.MeshStandardMaterial({name:amber?'Golden resin fracture flakes':'Scarlet garnet fracture flakes',color:amber?0xdb7907:0xb52122,roughness:.27,metalness:.05});
  for(let i=0;i<70;i++) {
    const a=i*2.39996,r=.17+.68*((i*37%71)/71),q=outline(a),g=new THREE.IcosahedronGeometry(1,0),scale=amber?.00012:.00009;
    g.scale(scale*(1+i%3),scale*(1+(i*7)%4),scale*.25);g.rotateY(a);g.rotateZ(a*.4);g.translate(q.x*r,q.y*r,depth*(.12+.43*(i%7)/7));add(root,'Embedded mineral inclusion '+i,g,i%4===0?dark:warm);
  }
  if(fern) {
    const base=v(-.0026,-.0037,depth*.65),tip=v(.0010,.0032,depth*.65);
    tube(root,'Amber fossil fern stem',[base,base.clone().lerp(tip,.5).add(v(-.0003,0,0)),tip],.000075,dark,false,20,5);
    for(let i=0;i<9;i++)for(const side of [-1,1]) {
      const start=base.clone().lerp(tip,.12+i*.085),end=start.clone().add(v(side*.0018*(1-i*.075),.0012,0));
      tube(root,'Fern fossil pinna '+i+' '+side,[start,start.clone().lerp(end,.5),end],.000055,dark,false,8,4);
      for(let j=1;j<4;j++){const b=start.clone().lerp(end,j/4);tube(root,'Fern fossil leaflet '+i+' '+side+' '+j,[b,b.clone().add(v(side*.00038,.00050,0))],.000036,dark,false,3,4);}
    }
  }
}
function copperPendant(root:THREE.Group) {
  const m=metal('Reddish hand hammered copper',0xc88b6c,.36,true),dark=metal('Darkened copper recessed border',0x765044,.49),outline=ellipse(.014,.018);
  add(root,'Hammered convex copper medallion',dome(outline,.0022,.0012,.000055),m);
  rim(root,'Dark narrow inset border',ellipse(.0132,.0172),.00088,.00023,dark);
  rim(root,'Raised broad rounded copper frame',outline,.00060,.00068,m);
  const link=add(root,'Pendant suspension jump ring',new THREE.TorusGeometry(.0021,.00055,10,40),m);link.position.y=.0192;
  bail(root,.024,m,true);
  // Recess-coloured geometric serial strokes on the rear face, consistent with the item description.
  const digits=['1111011','1101101','0110000','1111111'];
  const segs=[[-.0004,.0008,.0004,.0008],[.0004,.0008,.0004,0],[.0004,0,.0004,-.0008],[-.0004,-.0008,.0004,-.0008],[-.0004,0,-.0004,-.0008],[-.0004,.0008,-.0004,0],[-.0004,0,.0004,0]];
  digits.forEach((digit,i)=>segs.forEach((s,j)=>{if(digit[j]==='1')tube(root,'Trade Company rear serial '+i+' stroke '+j,[v(s[0]!+(i-1.5)*.0012,s[1]!,-.00122),v(s[2]!+(i-1.5)*.0012,s[3]!,-.00122)],.000075,dark,false,2,4);}));
}
function pendant(root:THREE.Group,cobalt:boolean) {
  const m=metal(cobalt?'Polished cool blue cobalt':'Worn charcoal iron',cobalt?0x738ba5:0x777779,cobalt?.29:.38),o=cobalt?marquise:pear,depth=cobalt?.0047:.0045;
  add(root,cobalt?'Faceted marquise garnet':'Pear shaped polished amber',cobalt?gem(o,depth):dome(o,depth,.0023),cobalt?garnetMaterial():amberMaterial());
  inclusions(root,o,depth,!cobalt,!cobalt);
  rim(root,'Full closed supporting bezel',o,-.0004,cobalt?.00078:.00058,m);
  rim(root,'Rear stone retention lip',a=>o(a).multiplyScalar(.90),-.00165,.00048,m);
  const angles=cobalt?[Math.PI/2,Math.PI,Math.PI*1.5,0]:[Math.PI/2,Math.PI*1.15,Math.PI*1.85];
  angles.forEach((a,i)=>{const q=o(a),inside=q.clone().multiplyScalar(cobalt?.77:.82);claw(root,'Folded stone retention claw '+i,v(q.x*1.05,q.y*1.05,-.0002),v(inside.x,inside.y,.0027),cobalt?.0034:.0030,m,cobalt);});
  const link=add(root,'Round pendant suspension eye',new THREE.TorusGeometry(.0023,.00063,10,40),m);link.position.y=.020;
  bail(root,.026,m,!cobalt);
  // Open back with crossed supports leaves the transparent stone exposed.
  for(const side of [-1,1])tube(root,'Rear basket strut '+side,[v(side*.008,-.009,-.0011),v(0,0,-.0030),v(-side*.006,.011,-.0011)],.00043,m,false,24,8);
}
function ring(root:THREE.Group,cobalt:boolean) {
  const m=metal(cobalt?'Blue steel cobalt band':'Softly polished dark iron',cobalt?0x738ba5:0x777779,cobalt?.30:.39),edge=metal(cobalt?'Bright bevels of cobalt':'Worn iron setting edge',cobalt?0xa0acb6:0x999793,.27);
  add(root,'Solid forged open 20 mm bore ring',shank(cobalt),m);
  const setting=new THREE.Group();setting.name='Integrated stone setting';setting.rotation.x=-Math.PI/2;setting.position.y=.0141;root.add(setting);
  const o=ellipse(cobalt?.0057:.0051,cobalt?.0052:.0040);
  if(cobalt) {
    const shape=new THREE.Shape();for(let i=0;i<8;i++){const a=i/8*TAU+Math.PI/8,x=.0067*Math.cos(a),y=.0062*Math.sin(a);if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}shape.closePath();
    const hole=new THREE.Path();hole.absellipse(0,0,.0055,.0049,0,TAU,true);shape.holes.push(hole);
    const g=new THREE.ExtrudeGeometry(shape,{depth:.0010,bevelEnabled:true,bevelThickness:.00025,bevelSize:.00028,bevelSegments:2,steps:1,curveSegments:24});g.translate(0,0,-.001);add(setting,'Octagonal bevelled garnet crown',g,m);
  } else rim(setting,'Flush oval iron bezel',o,.00005,.00055,edge);
  add(setting,cobalt?'Round brilliant garnet':'Flush oval amber cabochon',cobalt?gem(o,.0029):dome(o,.0018,.0008),cobalt?garnetMaterial():amberMaterial());
  inclusions(setting,o,cobalt?.0029:.0018,!cobalt,false);
  if(cobalt)for(let i=0;i<4;i++){const a=i/4*TAU+Math.PI/4,q=o(a);claw(setting,'Heavy garnet corner claw '+i,v(q.x*1.13,q.y*1.13,-.0003),v(q.x*.80,q.y*.80,.00195),.0018,m,true);}
  if(cobalt)for(const side of [-1,1]) {
    // Raised diamond and chevrons follow the curved shoulder, on both visible sides.
    const p=(a:number,z:number,extra=0)=>v(side*(.0122+extra)*Math.cos(a),(.0122+extra)*Math.sin(a),z);
    for(const zSide of [-1,1]) {
      const z=zSide*.00325;
      tube(root,'Shoulder recessed chevron border '+side+' '+zSide,[p(.38,z),p(.70,zSide*.0043),p(1.05,zSide*.0051)],.00020,edge,false,24,6);
      const pts=[p(.50,z),p(.73,zSide*.00415,.00018),p(.95,z),p(.73,zSide*.0026,.00018)],positions:number[]=[];
      const center=p(.73,zSide*.0034,.00065);
      for(let i=0;i<4;i++)for(const q of [pts[i]!,pts[(i+1)%4]!,center])positions.push(...q.toArray());
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();add(root,'Raised shoulder diamond '+side+' '+zSide,g,edge);
    }
  }
  if(cobalt)for(let i=0;i<5;i++)tube(root,'Filed inner quarry tally '+i,[v(.00994*Math.cos(.1+i*.10),.00994*Math.sin(.1+i*.10),-.0010),v(.00994*Math.cos(.1+i*.10),.00994*Math.sin(.1+i*.10),.00075)],.000055,edge,false,2,4);
}
export const author:ItemModelAuthor={
  ids:['grithe_pendant','corven_ring','corven_pendant','kaldite_ring','kaldite_pendant'],
  build(itemId) {
    if(!this.ids.includes(itemId))throw new Error('Unsupported jewelry '+itemId);
    const root=new THREE.Group();root.name=itemId+' authored metal jewelry';
    const descriptions:Record<string,string>={grithe_pendant:'Oval hammered copper medallion with raised border, folded bail, interlocked short chain and inferred rear Trade Company serial.',corven_ring:'Heavy open iron band with broad tapered shoulders and flush oval amber cabochon containing mineral fragments.',corven_pendant:'Pear shaped honey amber pendant with fossil fern, three folded iron claws, closed rear basket, broad hollow bail and iron chain.',kaldite_ring:'Heavy blue cobalt ring with octagonal setting, four angular claws, faceted red garnet, shoulder diamonds and inferred inner quarry tally.',kaldite_pendant:'Faceted marquise red garnet in four angular cobalt claws with open rear support, round suspension eye and tapered hollow cobalt bail.'};
    root.userData.itemModel={itemId,author:'jewelry-metal-a',reference:`art/item-icons/generated/${itemId}.png`,description:descriptions[itemId]!};
    if(itemId==='grithe_pendant')copperPendant(root);else if(itemId.endsWith('_ring'))ring(root,itemId.startsWith('kaldite'));else pendant(root,itemId.startsWith('kaldite'));
    return root;
  },
};
