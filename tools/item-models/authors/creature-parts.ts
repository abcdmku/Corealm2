import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';
type V = [number, number, number];
const ids = ['moose_antler_palm','crocodile_scute','salamander_secretion','tortoise_shell_plate','snail_mucus','beetle_mandible','centipede_chitin','ravager_talon','drake_scale','mantis_scythe','nightmare_plate'] as const;
const descriptions: Record<string,string> = {
 moose_antler_palm:'A flat antler section. Cut and polished, it makes a broad protective charm.',
 crocodile_scute:"A hard plate from a crocodile's back. Scute soles let one pelt cover two pairs of boots.",
 salamander_secretion:'A heat-stable mineral paste. Ashford uses it instead of mined flux stone.',
 tortoise_shell_plate:'A curved shell section. Lash several across a wooden shield in place of its metal boss.',
 snail_mucus:"A sealed dab of clear adhesive. It bonds a wooden shield's layers in place of a metal boss.",
 beetle_mandible:'A hooked jaw hard enough to score stone. Several brace a pick head with less metal.',
 centipede_chitin:'Dark overlapping plates. Small segments fit an armored ring without spoiling its grip.',
 ravager_talon:'A hooked black claw. Cut down, it replaces the wooden grip beneath a Titanium blade.',
 drake_scale:'A broad scale with a tough leather backing. Trim several into standard heavy hide sheets.',
 mantis_scythe:'A curved cutting spur. Its sharpened edge can be caged inside an aggressive hunting charm.',
 nightmare_plate:'A ridged shoulder plate. Riveted over a helm, it replaces part of the Cobalt shell.'
};
const hash=(x:number)=>{const n=Math.sin(x*127.13+41.7)*43758.5;return n-Math.floor(n);};
function tex(name:string, kind:string):THREE.DataTexture {
 const n=256, data=new Uint8Array(n*n*4);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const u=x/n,v=y/n,r=Math.hypot(u-.5,v-.5),noise=hash(x+y*n);
  let a=.82+noise*.16;
  if(kind==='bone')a-=Math.pow(Math.max(0,Math.sin(u*360+Math.sin(v*41)*2)),22)*.22;
  if(kind==='pore')a-=noise>.87?.38:0;
  if(kind==='horn')a-=Math.pow(Math.max(0,Math.sin(v*410+Math.sin(u*19)*4)),30)*.15;
  if(kind==='shell')a=.72+.12*Math.sin(u*27+Math.sin(v*31))*Math.sin(v*23)+.10*noise-.14*Math.pow(Math.max(0,Math.cos(r*410+Math.sin(u*37))),18);
  if(kind==='crack')a-=Math.pow(Math.max(0,Math.cos(u*65+Math.sin(v*48)*2)),45)*.25;
  const i=(y*n+x)*4;data[i]=data[i+1]=data[i+2]=Math.floor(255*a);data[i+3]=255;
 }
 const t=new THREE.DataTexture(data,n,n);t.name=name;t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function mat(name:string,color:number,kind='horn',roughness=.45):THREE.MeshStandardMaterial{return new THREE.MeshStandardMaterial({name,color,map:tex(name+' grain',kind),roughness});}
function add(g:THREE.Group,name:string,geo:THREE.BufferGeometry,m:THREE.Material):THREE.Mesh{const mesh=new THREE.Mesh(geo,m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);return mesh;}
function geo(p:number[],uv:number[],idx:number[]):THREE.BufferGeometry{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}
// A closed curved anatomical sheet, with independently shaped front and inner surface.
function sheet(g:THREE.Group,name:string,f:(u:number,v:number)=>V,thick:number,m:THREE.Material,back:THREE.Material,nu=32,nv=32):void{
 const p:number[]=[],uv:number[]=[],idx:number[]=[];
 for(let side=0;side<2;side++)for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){const u=i/nu,v=j/nv,q=f(u,v);p.push(q[0],q[1],q[2]-side*thick);uv.push(u,v);}
 const row=nu+1,off=row*(nv+1);
 for(let s=0;s<2;s++)for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=s*off+j*row+i,b=a+1,c=a+row,d=c+1;if(s===0)idx.push(a,b,d,a,d,c);else idx.push(a,d,b,a,c,d);}
 const faceCount=nu*nv*6; const edge=(a:number,b:number)=>idx.push(a,a+off,b+off,a,b+off,b);
 for(let i=0;i<nu;i++){edge(i+1,i);edge(nv*row+i,nv*row+i+1);}for(let j=0;j<nv;j++){edge(j*row,(j+1)*row);edge((j+1)*row+nu,j*row+nu);}
 const geometry=geo(p,uv,idx);geometry.clearGroups();geometry.addGroup(0,faceCount,0);geometry.addGroup(faceCount,idx.length-faceCount,1);const mesh=new THREE.Mesh(geometry,[m,back]);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;g.add(mesh);
}
// Elliptical section sweep, permitting a hollow open root and a solid pointed tip.
function horn(g:THREE.Group,name:string,points:V[],r:(t:number)=>number,depth:number,m:THREE.Material,hollow=false):void{
 const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),p:number[]=[],uv:number[]=[],idx:number[]=[],N=32,S=12;
 const rings=hollow?2:1;
 for(let side=0;side<rings;side++)for(let i=0;i<=N;i++){
 const t=i/N,c=curve.getPoint(t),tangent=curve.getTangent(t),axis=new THREE.Vector3(-tangent.y,tangent.x,0).normalize();
 for(let j=0;j<=S;j++){const a=j/S*Math.PI*2,rr=Math.max(.00015,r(t))*(side===1?.69:1)*(1+.014*Math.cos(a*9+t*37));const q=c.clone().addScaledVector(axis,Math.cos(a)*rr);q.z+=Math.sin(a)*rr*depth;p.push(q.x,q.y,q.z);uv.push(j/S,t);}}
 const off=(N+1)*(S+1);
 for(let side=0;side<rings;side++)for(let i=0;i<N;i++)for(let j=0;j<S;j++){const a=side*off+i*(S+1)+j,b=a+1,c=a+S+1,d=c+1;if(side===0)idx.push(a,b,c,b,d,c);else idx.push(a,c,b,b,c,d);}
 if(hollow){for(let j=0;j<S;j++)idx.push(j,j+1,off+j,j+1,off+j+1,off+j);}else{p.push(...points[0]!);uv.push(.5,0);const center=p.length/3-1;for(let j=0;j<S;j++)idx.push(center,j+1,j);}
 add(g,name,geo(p,uv,idx),m);
}
function ellipsoid(g:THREE.Group,name:string,p:V,s:V,m:THREE.Material,segments=24){const a=add(g,name,new THREE.SphereGeometry(1,segments,16),m);a.position.set(...p);a.scale.set(...s);return a;}
function line(g:THREE.Group,name:string,pts:V[],r:number,m:THREE.Material){add(g,name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),32,r,6,false),m);}
// A tessellated anatomical outline with a continuous curved cortex and real cut edge.
function plate(g:THREE.Group,name:string,outline:[number,number][],height:(x:number,y:number)=>number,thickness:number,front:THREE.Material,back:THREE.Material){
 const contour=outline.map(p=>new THREE.Vector2(...p));if(THREE.ShapeUtils.isClockWise(contour))contour.reverse();
 const faces=THREE.ShapeUtils.triangulateShape(contour,[]),p:number[]=[],uv:number[]=[],idx:number[]=[],groups:[number,number,number][]=[];
 const tri=(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2,side:number,depth:number):void=>{if(depth){const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);tri(a,ab,ca,side,depth-1);tri(ab,b,bc,side,depth-1);tri(ca,bc,c,side,depth-1);tri(ab,bc,ca,side,depth-1);return;}const start=p.length/3;for(const v of [a,b,c]){p.push(v.x,v.y,height(v.x,v.y)-side*thickness);uv.push(v.x*3+.5,v.y*3+.5);}if(side)idx.push(start,start+2,start+1);else idx.push(start,start+1,start+2);};
 for(let side=0;side<2;side++){const start=idx.length;for(const f of faces)tri(contour[f[0]!]!,contour[f[1]!]!,contour[f[2]!]!,side,3);groups.push([start,idx.length-start,side]);}
 const start=idx.length;for(let i=0;i<contour.length;i++){const a=contour[i]!,b=contour[(i+1)%contour.length]!;const k=p.length/3;for(const [v,side] of [[a,0],[b,0],[b,1],[a,1]] as const){p.push(v.x,v.y,height(v.x,v.y)-side*thickness);uv.push(v.x*3+.5,v.y*3+.5);}idx.push(k,k+3,k+2,k,k+2,k+1);}groups.push([start,idx.length-start,1]);
 const geometry=geo(p,uv,idx);for(const group of groups)geometry.addGroup(...group);const mesh=new THREE.Mesh(geometry,[front,back]);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;g.add(mesh);
}
function antler(g:THREE.Group){
 const bone=mat('Porous warm ivory palm cortex',0xe3cba2,'bone',.76),root=mat('Weathered brown basal antler',0x9c7954,'bone',.82);
 const outline:[number,number][]=[[.025,.04],[.01,.12],[.085,.20],[.105,.27],[.083,.247],[.04,.215],[.01,.22],[-.005,.265],[.005,.35],[-.017,.318],[-.038,.29],[-.065,.275],[-.086,.30],[-.10,.39],[-.122,.43],[-.121,.367],[-.14,.33],[-.167,.325],[-.25,.405],[-.277,.421],[-.286,.402],[-.304,.415],[-.31,.389],[-.332,.397],[-.329,.366],[-.35,.365],[-.331,.331],[-.345,.315],[-.315,.278],[-.28,.252],[-.22,.221],[-.15,.184],[-.076,.115],[-.033,.035]];
 plate(g,'Irregular palmate antler with continuous integrated tines',outline,(x,y)=>.018+.055*(x+.1)**2+.025*Math.sin((y-.04)*7)+.018*Math.sin((x+y)*7),.019,bone,root);
 horn(g,'Solid tapering antler beam',[[0,-.04,0],[-.009,.04,.01],[-.055,.11,.026],[-.14,.18,.042]],t=>.034*(1-t*.64),.7,root);
 for(let i=0;i<20;i++){const a=i/20*Math.PI*2;ellipsoid(g,'Rough burr pearl '+i,[.033*Math.cos(a),-.029+.003*Math.sin(i*4),.024*Math.sin(a)],[.005,.006,.004],bone,8);}
}
function crocodile(g:THREE.Group){
 const scute=mat('Olive pitted osteoderm',0xa59b6a,'pore',.5),edge=mat('Dark organic scute margins',0x454431,'pore',.74),bone=mat('Fibrous osteoderm fracture',0xc5ac81,'bone',.89);
 const outline:[number,number][]=[[-.14,-.18],[-.17,-.11],[-.151,-.025],[-.163,.055],[-.133,.115],[-.12,.19],[-.025,.179],[.045,.193],[.13,.167],[.155,.09],[.143,.015],[.162,-.07],[.139,-.15],[.06,-.179],[-.015,-.192]];
 const h=(x:number,y:number)=>.018+.028*(1-(x/.18)**2)+.008*Math.sin(y*13);
 plate(g,'Irregular severed crocodile back fragment',outline,h,.019,edge,bone);
 const cells:[number,number][][]=[ [[-.14,-.17],[-.045,-.185],[-.025,-.105],[-.071,-.065],[-.16,-.103]], [[-.043,-.18],[.06,-.17],[.087,-.098],[-.023,-.103]], [[.063,-.167],[.134,-.146],[.152,-.069],[.085,-.098]], [[-.157,-.096],[-.073,-.06],[-.068,.023],[-.147,.017]], [[-.069,-.06],[-.026,-.1],[.084,-.095],[.066,-.014],[-.013,.037],[-.065,.02]], [[.088,-.091],[.154,-.064],[.137,.016],[.068,-.011]], [[-.147,.024],[-.069,.029],[-.043,.10],[-.127,.113]], [[-.065,.029],[-.01,.041],[.067,-.009],[.108,.075],[.033,.113],[-.04,.1]], [[.071,-.007],[.14,.024],[.147,.087],[.111,.072]], [[-.125,.119],[-.04,.106],[-.027,.173],[-.118,.181]], [[-.036,.106],[.033,.119],[.11,.081],[.13,.16],[.046,.186],[-.023,.173]] ];
 cells.forEach((cell,i)=>plate(g,'Irregular keeled osteoderm '+i,cell,(x,y)=>h(x,y)+.004+.022*Math.exp(-(((x+.018)/.026)**2)),.005,scute,edge));
}
function shell(g:THREE.Group){
 const amber=mat('Amber shell growth laminae',0xd6a454,'shell',.3),dark=mat('Fine dark shell sutures',0x543823,'horn',.61),bone=mat('Porous broken shell bone',0xc8ad7e,'pore',.88);
 const h=(x:number,y:number)=>.15*Math.sqrt(Math.max(.035,1-(x/.24)**2-(y/.29)**2));
 const outline:[number,number][]=[[-.17,-.16],[-.13,-.22],[-.059,-.211],[-.015,-.233],[.045,-.195],[.097,-.213],[.135,-.157],[.185,-.132],[.164,-.065],[.19,.012],[.157,.077],[.137,.153],[.078,.189],[.01,.207],[-.06,.187],[-.113,.158],[-.163,.105],[-.172,.032],[-.19,-.033]];
 plate(g,'Domed broken carapace segment',outline,h,.018,amber,bone);
 const paths:[number,number][][]=[ [[-.172,.032],[-.102,.048],[-.058,.13],[.01,.207]], [[-.058,.13],[.037,.123],[.107,.069],[.157,.077]], [[-.102,.048],[-.113,-.066],[-.06,-.135],[-.015,-.233]], [[-.113,-.066],[-.025,-.075],[.06,-.118],[.135,-.157]], [[-.025,-.075],[.055,.012],[.037,.123]], [[.055,.012],[.14,-.01],[.19,.012]] ];
 paths.forEach((path,i)=>line(g,'Irregular polygon shell suture '+i,path.map(([x,y])=>[x,y,h(x,y)+.001]),.0018,dark));
}
function secretion(g:THREE.Group){
 const paste=mat('Glossy ochre mineral paste',0xc88a20,'pore',.23),grain=mat('Mineral granules',0x8d7650,'pore',.7);
 // The folded heap is a full radial volume, not a flat puddle.
 const p:number[]=[],uv:number[]=[],idx:number[]=[],N=48,S=64;
 for(let i=0;i<=N;i++)for(let j=0;j<=S;j++){const t=i/N,a=j/S*Math.PI*2,r=.12*(1-t)**.7*(1+.11*Math.sin(a*5+t*7))+.012*Math.sin(t*Math.PI),y=.006+t*.19;const x=r*Math.cos(a)-.047*t*t,z=r*Math.sin(a)*.83;const fold=.009*Math.sin(a*2-t*25)*Math.sin(t*Math.PI);p.push(x+fold*Math.cos(a),y,z+fold*Math.sin(a));uv.push(j/S,t);}
 for(let i=0;i<N;i++)for(let j=0;j<S;j++){const a=i*(S+1)+j,b=a+1,c=a+S+1;idx.push(a,c,b,b,c,c+1);}p.push(0,.006,0);uv.push(.5,.5);const center=p.length/3-1;for(let j=0;j<S;j++)idx.push(center,j,j+1);add(g,'Swirled viscous mineral mound',geo(p,uv,idx),paste);
 for(let i=0;i<80;i++){const t=.06+hash(i)*.84,a=hash(i+130)*Math.PI*2,r=.12*(1-t)**.7*(1+.11*Math.sin(a*5+t*7))+.012*Math.sin(t*Math.PI)+.009*Math.sin(a*2-t*25)*Math.sin(t*Math.PI);const s=.001+hash(i+12)*.003;ellipsoid(g,'Embedded mineral grain '+i,[r*Math.cos(a)-.047*t*t,.006+t*.19,r*Math.sin(a)*.83],[s,s*.8,s],grain,8);}
}
function mucus(g:THREE.Group){
 const glass=new THREE.MeshPhysicalMaterial({name:'Thick clear hand blown bottle glass',color:0xe4ece2,roughness:.12,transmission:.98,ior:1.48,thickness:.005});
 const fluid=new THREE.MeshPhysicalMaterial({name:'Clear slightly grey adhesive',color:0xd1d5c1,roughness:.13,transmission:.91,ior:1.36,thickness:.10});
 const cork=mat('Cracked natural cork',0xb37b44,'pore',.9);
 const profile=[[0,0],[.052,0],[.066,.009],[.073,.03],[.073,.077],[.065,.107],[.045,.128],[.04,.151],[.046,.155],[.046,.165],[.037,.168],[.034,.161],[.035,.151],[.036,.13],[.059,.105],[.067,.076],[.067,.031],[.061,.014],[0,.01]];
 add(g,'Hollow round flask with thick lip and base',new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(p[0]!,p[1]!)),64),glass);
 const liquid=add(g,'Enclosed mucus fill',new THREE.LatheGeometry([[0,.012],[.060,.012],[.066,.027],[.067,.063],[.063,.087],[.05,.097],[0,.095]].map(p=>new THREE.Vector2(p[0]!,p[1]!)),64),fluid);liquid.name='Enclosed mucus with meniscus';
 add(g,'Tapered cork plug',new THREE.LatheGeometry([[0,.146],[.032,.146],[.037,.178],[.038,.193],[0,.195]].map(p=>new THREE.Vector2(p[0]!,p[1]!)),48),cork);
 const bubble=new THREE.MeshPhysicalMaterial({name:'Air pockets in adhesive',color:0xffffff,roughness:.04,transmission:1,ior:1.05,thickness:.001});
 for(let i=0;i<24;i++){const x=(hash(i)-.5)*.10,y=.02+hash(i+40)*.065,z=(hash(i+80)-.5)*.095;const r=.0015+hash(i+20)*.0025;ellipsoid(g,'Suspended air bubble '+i,[x,y,z],[r,r,r],bubble,12);}
}
function claw(g:THREE.Group,mantis:boolean,ravager:boolean){
 const body=mat(mantis?'Green mantis cuticle':ravager?'Black keratin talon':'Black chestnut beetle jaw',mantis?0x99a54e:ravager?0x242320:0x35211b,'horn',mantis?.38:.3);
 const edge=mat(mantis?'Amber brown predatory spur tips':'Worn brown keratin rims',mantis?0x74421c:0x806144,'horn',.42);
 const points:V[]=mantis?[[0,0,0],[.04,.17,.005],[.095,.30,0],[.2,.28,0],[.255,.19,-.004],[.24,.09,-.009]]:ravager?[[0,0,0],[0,.12,0],[.04,.26,.006],[.13,.31,.007],[.23,.245,0],[.25,.12,-.004]]:[[0,0,0],[-.02,.10,0],[-.07,.22,.008],[-.16,.29,.006],[-.26,.29,0],[-.31,.245,-.004]];
 horn(g,'Continuous curved anatomical blade',points,t=>(mantis?.038:.045)*Math.pow(1-t,.75)*(1+.45*Math.sin(t*Math.PI)),mantis?.55:.85,body,true);
 if(!ravager){const c=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));for(let i=0;i<(mantis?10:6);i++){const t=.14+i*(mantis?.062:.115),p=c.getPoint(t),d=c.getTangent(t),inward=new THREE.Vector3(d.y,-d.x,0).multiplyScalar(mantis?1:-1);const r=(mantis?.038:.045)*Math.pow(1-t,.75)*(1+.45*Math.sin(t*Math.PI));const start=p.clone().addScaledVector(inward,r*.4),end=p.clone().addScaledVector(inward,r+(.025+.029*Math.sin(t*3)));end.y-=.015;horn(g,'Inner cutting tooth '+i,[[start.x,start.y,start.z],[end.x,end.y,end.z]],u=>r*.48*(1-u)**.85,.65,edge);}}
 if(mantis){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const tipPoints:V[]=[];for(let i=0;i<=8;i++){const p=curve.getPoint(.82+i*.18/8);tipPoints.push([p.x,p.y,p.z]);}horn(g,'Amber hardened terminal cutting point',tipPoints,t=>.016*(1-t)**.8,.56,edge);}
 const cuffMat=mat('Rough socket cortex',ravager?0x685744:mantis?0x889245:0x503424,'crack',.65);
 horn(g,'Broad open anatomical root cuff',[[0,-.03,0],[0,.025,0],[.003,.076,0]],t=>(ravager?.058:.042)*(1-.15*t)+.003*Math.cos(t*Math.PI*4),ravager?.72:.65,cuffMat,true);
 for(let i=0;i<16;i++){const a=i/16*Math.PI*2;const r=ravager?.058:.042;line(g,'Raised irregular root flute '+i,[[Math.cos(a)*(r+.001),-.026,Math.sin(a)*r*.72],[Math.cos(a)*(r-.009),.023,Math.sin(a)*(r-.009)*.72],[Math.cos(a)*(r-.006),.07,Math.sin(a)*(r-.006)*.72]],.0025,cuffMat);}

}
function chitin(g:THREE.Group){
 const red=mat('Mahogany centipede tergite',0x863b23,'crack',.3),rim=mat('Amber chitin broken edge',0xa66a31,'horn',.44),inner=mat('Dark concave chitin interior',0x372119,'horn',.72);
 for(let k=0;k<3;k++){const part=new THREE.Group();part.name='Detached arched tergite '+k;part.position.set((k-1)*.055,(k-1)*.064,k*.023);part.rotation.z=(k-1)*-.23;g.add(part);
 sheet(part,'Hollow arched tergite',(u,v)=>{const width=.25*(.45+.55*Math.sin(v*Math.PI*.86));return [(u-.5)*width,(v-.5)*.28,.065*Math.sin(u*Math.PI)*Math.sin(v*Math.PI*.8)];},.008,red,inner,36,36);
 for(let side=0;side<2;side++)for(let i=0;i<5;i++){const v=.2+i*.145,x=(side===0?-1:1)*.125*(.45+.55*Math.sin(v*Math.PI*.86)),y=(v-.5)*.28;horn(part,'Lateral tergite spine '+side+' '+i,[[x,y,.008],[x+(side===0?-.023:.023),y-.032,-.005]],t=>.009*(1-t),.65,rim);}
 for(let i=1;i<5;i++){const v=i/5,pts:V[]=[];for(let j=0;j<=16;j++){const u=j/16,w=.25*(.45+.55*Math.sin(v*Math.PI*.86));pts.push([(u-.5)*w,(v-.5)*.28,.065*Math.sin(u*Math.PI)*Math.sin(v*Math.PI*.8)+.001]);}line(part,'Transverse chitin growth seam '+i,pts,.001,inner);}
 }
}
function dragon(g:THREE.Group,pale:boolean){
 const face=mat(pale?'Ivory dragon shoulder cortex':'Olive bronze overlapping dragon scales',pale?0xe8e2cd:0x8b8550,pale?'bone':'pore',pale?.59:.39),back=mat(pale?'Grey fibrous shoulder underside':'Russet leather scale backing',pale?0x96938b:0x885233,'bone',.85),rim=mat(pale?'White bone keel':'Bronze scale edges',pale?0xf1e9d6:0xb49961,'horn',.45);
 const h=(x:number,y:number)=>.025+.025*(1-(x/.17)**2)*Math.cos(y*5);
 if(pale){
 const outline:[number,number][]=[[.03,-.23],[-.08,-.19],[-.13,-.16],[-.11,-.12],[-.17,-.07],[-.135,-.025],[-.17,.022],[-.136,.057],[-.146,.109],[-.10,.14],[-.105,.222],[-.052,.184],[.005,.177],[.041,.26],[.09,.193],[.132,.126],[.15,.035],[.128,-.084],[.105,-.194],[.082,-.15]];
 plate(g,'Continuous lobed pale shoulder plate',outline,h,.017,face,back);
 for(let k=0;k<2;k++)sheet(g,'Integrated swept shoulder keel '+k,(u,v)=>{const y=-.21+v*(k===0?.435:.465),x=(k===0?-.047:.071)+.018*Math.sin(v*5);return [x+(u-.5)*.071*Math.sin(v*Math.PI)**.55,y,h(x,y)+.068*Math.sin(u*Math.PI)**2*Math.sin(v*Math.PI)**.5];},.009,rim,face,18,36);
 }else{
 const outline:[number,number][]=[[0,-.235],[-.101,-.16],[-.147,-.068],[-.142,.045],[-.105,.127],[0,.24],[.106,.127],[.142,.045],[.147,-.068],[.101,-.16]];
 plate(g,'Russet leather under every scale',outline,h,.014,back,back);
 for(let i=0;i<6;i++){const y=-.17+i*.068,w=[.099,.132,.137,.123,.096,.054][i]!;const cell:[number,number][]=[[-w,y+.043],[-w*.88,y-.012],[0,y-.067],[w*.88,y-.012],[w,y+.043],[0,y+.074]];plate(g,'Independent overlapping shield scale '+i,cell,(x,Y)=>h(x,Y)+.011+i*.001+.021*(1-Math.min(1,Math.abs(x)/w))+.014*Math.max(0,1-(Y-y+.067)/.141),.006,face,rim);}
 for(let side=0;side<2;side++)for(let k=0;k<7;k++){const y=-.15+k*.049,w=.143*Math.sin((y+.24)/.48*Math.PI)**.7,x=w*(side?1:-1);line(g,'Leather border loop '+side+' '+k,[[x*.91,y,h(x,y)+.009],[x*1.03,y,h(x,y)],[x*1.02,y,h(x,y)-.017],[x*.91,y,h(x,y)-.019]],.0038,back);}
 }
}
export const author:ItemModelAuthor={ids,build(id:string):THREE.Group{
 if(!(ids as readonly string[]).includes(id))throw new Error('creature-parts does not own '+id);
 const g=new THREE.Group();g.name=id;g.userData.itemModel={itemId:id,author:'creature-parts',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]!};
 switch(id){case 'moose_antler_palm':antler(g);break;case 'crocodile_scute':crocodile(g);break;case 'tortoise_shell_plate':shell(g);break;case 'salamander_secretion':secretion(g);break;case 'snail_mucus':mucus(g);break;case 'beetle_mandible':claw(g,false,false);break;case 'ravager_talon':claw(g,false,true);break;case 'mantis_scythe':claw(g,true,false);break;case 'centipede_chitin':chitin(g);break;case 'drake_scale':dragon(g,false);break;case 'nightmare_plate':dragon(g,true);break;}
 return g;
}};


