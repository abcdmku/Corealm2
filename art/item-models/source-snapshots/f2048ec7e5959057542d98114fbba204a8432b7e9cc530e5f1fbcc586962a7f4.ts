import * as T from 'three';
import type { ItemModelAuthor } from '../contracts';
type Surface = (u:number,v:number)=>T.Vector3;
const V=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
const ids=['grithe_helm','grithe_greaves','grithe_boots','grithe_gloves','nightmarshal_plate'] as const;
function texture(kind:'copper'|'leather'|'steel',normal=false,rough=false) {
 const n=128,data=new Uint8Array(n*n*4),base=kind==='copper'?[206,109,62]:kind==='leather'?[66,39,25]:[41,55,79];
 const hash=(x:number,y:number)=>{const q=Math.sin(x*127.1+y*311.7)*43758.545;return q-Math.floor(q);};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=(y*n+x)*4;const fine=hash(x,y),cell=hash(Math.floor(x/5),Math.floor(y/5));
 if(normal){data[i]=128+Math.round(Math.sin(x*1.11+Math.cos(y*.87))*8);data[i+1]=128+Math.round(Math.cos(y*1.07+Math.sin(x*.79))*8);data[i+2]=254;}
 else if(rough){data[i]=data[i+1]=data[i+2]=kind==='leather'?195+fine*35:105+cell*42;}
 else {const k=kind==='leather'?.76+fine*.35:.78+cell*.27+fine*.08;for(let c=0;c<3;c++)data[i+c]=base[c]!*k;}
 data[i+3]=255;}
 const t=new T.DataTexture(data,n,n);t.name=`${kind}-${normal?'subtle-hammer-normal':rough?'independent-roughness':'patina-grain'}`;t.wrapS=t.wrapT=T.RepeatWrapping;t.generateMipmaps=true;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.colorSpace=normal||rough?T.NoColorSpace:T.SRGBColorSpace;t.needsUpdate=true;return t;
}
function materials(){
 const metal=(kind:'copper'|'steel')=>{const m=new T.MeshStandardMaterial({map:texture(kind),normalMap:texture(kind,true),roughnessMap:texture(kind,false,true),metalness:.92,roughness:1,normalScale:new T.Vector2(.45,.45)});m.name=`hammered-${kind}`;return m;};
 const copper=metal('copper'),steel=metal('steel');
 const leather=new T.MeshStandardMaterial({map:texture('leather'),roughnessMap:texture('leather',false,true),roughness:1,metalness:0});leather.name='dark-sewn-leather';
 const trim=new T.MeshStandardMaterial({color:0xd68b58,metalness:.88,roughness:.37});trim.name='worn-copper-rolled-edges';
 const iron=new T.MeshStandardMaterial({color:0x777369,metalness:.9,roughness:.42});iron.name='worn-silver-iron';
 const dark=new T.MeshStandardMaterial({color:0x211b17,roughness:.91});dark.name='dark-leather-lining';
 const thread=new T.MeshStandardMaterial({color:0x9c7650,roughness:.9});thread.name='waxed-tan-stitching';
 return {copper,steel,leather,trim,iron,dark,thread};
}
type Mats=ReturnType<typeof materials>;
function mesh(g:T.Group,name:string,geo:T.BufferGeometry,mat:T.Material){const m=new T.Mesh(geo,mat);m.name=name;g.add(m);return m;}
// Thick parametric shells have separate outer, inner and joined rim vertices.
function shell(g:T.Group,name:string,f:Surface,mat:T.Material,thick=.004,nu=32,nv=12){
 const p:number[]=[],uv:number[]=[],ix:number[]=[];const count=(nu+1)*(nv+1);
 for(let s=0;s<2;s++)for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){const u=i/nu,v=j/nv,q=f(u,v),du=f(Math.min(1,u+.001),v).sub(f(Math.max(0,u-.001),v)),dv=f(u,Math.min(1,v+.001)).sub(f(u,Math.max(0,v-.001))),n=du.cross(dv).normalize();q.addScaledVector(n,s===0?thick/2:-thick/2);p.push(q.x,q.y,q.z);uv.push(u,v);}
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;ix.push(a,b,c,b,d,c,a+count,c+count,b+count,b+count,c+count,d+count);}
 const edge=(a:number,b:number)=>ix.push(a,a+count,b,b,b+count,a+count);
 for(let i=0;i<nu;i++){edge(i,i+1);edge(nv*(nu+1)+i+1,nv*(nu+1)+i);}for(let j=0;j<nv;j++){edge((j+1)*(nu+1),j*(nu+1));edge(j*(nu+1)+nu,(j+1)*(nu+1)+nu);}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();return mesh(g,name,geo,mat);
}
function tube(g:T.Group,name:string,points:T.Vector3[],r:number,mat:T.Material,closed=false){return mesh(g,name,new T.TubeGeometry(new T.CatmullRomCurve3(points,closed),Math.max(8,points.length),r,6,closed),mat);}
function rim(g:T.Group,name:string,f:Surface,mat:T.Material,r=.0025){const pts:T.Vector3[]=[];for(let i=0;i<=24;i++)pts.push(f(i/24,0));for(let i=1;i<=12;i++)pts.push(f(1,i/12));for(let i=1;i<=24;i++)pts.push(f(1-i/24,1));for(let i=1;i<12;i++)pts.push(f(0,1-i/12));tube(g,name,pts,r,mat,true);}
function ball(g:T.Group,name:string,p:T.Vector3,scale:T.Vector3,mat:T.Material){const m=mesh(g,name,new T.SphereGeometry(1,10,7),mat);m.position.copy(p);m.scale.copy(scale);return m;}
function rivet(g:T.Group,p:T.Vector3,mat:T.Material,r=.004){ball(g,'domed-peened-rivet',p,V(r,r,r*.6),mat);}
function belt(g:T.Group,name:string,cx:number,y:number,rx:number,rz:number,h:number,mat:T.Material,z=-.035){const f:Surface=(u,v)=>{const a=u*Math.PI*2;return V(cx+rx*Math.sin(a),y+(v-.5)*h,z+rz*Math.cos(a));};shell(g,name,f,mat,.004,40,3);return f;}
function buckle(g:T.Group,p:T.Vector3,mat:T.Material,w=.028,h=.035){tube(g,'forged-open-rectangular-buckle',[V(p.x-w/2,p.y-h/2,p.z),V(p.x+w/2,p.y-h/2,p.z),V(p.x+w/2,p.y+h/2,p.z),V(p.x-w/2,p.y+h/2,p.z)],.0025,mat,true);tube(g,'buckle-tongue',[p.clone(),p.clone().add(V(w*.5,0,.001))],.0018,mat);}
function stitches(g:T.Group,name:string,pts:T.Vector3[],mat:T.Material){for(let i=0;i<pts.length-1;i+=2)tube(g,name,[pts[i]!,pts[i+1]!],.0007,mat);}
function helmet(g:T.Group,m:Mats){
 const dome:Surface=(u,v)=>{const a=u*Math.PI*2,phi=.012+v*Math.PI*.51;return V(.112*Math.sin(phi)*Math.sin(a),1.692+.158*Math.cos(phi),-.018+.127*Math.sin(phi)*Math.cos(a));};
 shell(g,'hammered-open-face-helmet-dome',dome,m.copper,.006,48,22);
 const apron:Surface=(u,v)=>{const a=.84+u*(Math.PI*2-1.68),drop=.062+.071*Math.pow(Math.abs(Math.sin(a)),3);return V(.113*Math.sin(a),1.696-v*drop,-.018+.128*Math.cos(a));};shell(g,'ear-and-nape-skirt-open-front',apron,m.copper,.006,44,12);rim(g,'rolled-ear-and-nape-border',apron,m.trim);
 const liner:Surface=(u,v)=>{const p=apron(u,v);p.x*=.959;p.z=-.018+(p.z+.018)*.959;p.y+=.002;return p;};shell(g,'stitched-leather-ear-lining',liner,m.leather,.003,44,12);
 const brow:Surface=(u,v)=>{const a=u*Math.PI*2;return V(.115*Math.sin(a),1.695+v*.026,-.018+.13*Math.cos(a));};shell(g,'continuous-riveted-brow-band',brow,m.trim,.004,48,3);rim(g,'brow-rolled-lip',brow,m.trim,.002);
 const crest:Surface=(u,v)=>{const a=(v-.5)*Math.PI;return V((u-.5)*.027,1.698+.158*Math.cos(a),-.018+.13*Math.sin(a));};shell(g,'fore-aft-crown-reinforcing-band',crest,m.trim,.005,5,40);rim(g,'crown-band-seams',crest,m.trim,.0015);
 for(let i=0;i<10;i++){const a=i*Math.PI/5;rivet(g,V(.118*Math.sin(a),1.709,-.018+.133*Math.cos(a)),m.trim,.005);}
 for(let i=0;i<5;i++){const a=-1.15+i*.575;ball(g,'crown-band-rivet',V(0,1.702+.161*Math.cos(a),-.018+.133*Math.sin(a)),V(.005,.004,.005),m.trim);}
 for(const s of [-1,1])rivet(g,V(s*.106,1.593,.039),m.trim,.0048);
}
function refinedCopper(m:Mats){
 const size=192,data=new Uint8Array(size*size*4),normal=new Uint8Array(size*size*4);
 const rand=(a:number,b:number)=>{const q=Math.sin(a*127.1+b*311.7)*43758.5453;return q-Math.floor(q);};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let d=100,variation=0;const cx=Math.floor(x/7),cy=Math.floor(y/7);for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const px=(cx+i+rand(cx+i,cy+j))*7,py=(cy+j+rand(cx+i+81,cy+j+17))*7,dd=Math.hypot(x-px,y-py);if(dd<d){d=dd;variation=rand(cx+i+19,cy+j+7);}}const k=.93+variation*.065+rand(x,y)*.018,p=(y*size+x)*4;data[p]=218*k;data[p+1]=119*k;data[p+2]=69*k;data[p+3]=255;normal[p]=128+Math.sin(x*.8+Math.cos(y*.7))*4;normal[p+1]=128+Math.cos(y*.9+Math.sin(x*.7))*4;normal[p+2]=255;normal[p+3]=255;}
 const map=new T.DataTexture(data,size,size),nm=new T.DataTexture(normal,size,size);for(const t of [map,nm]){t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;}map.colorSpace=T.SRGBColorSpace;map.name='irregular-soft-copper-hammer-facets';nm.name='gentle-independent-hammer-dents';m.copper.map=map;m.copper.normalMap=nm;m.copper.normalScale.set(.4,.4);
}
function greaves(g:T.Group,m:Mats){refinedCopper(m);m.copper.roughness=.64;m.copper.metalness=.8;m.trim.color.setHex(0xf5b980);m.trim.roughness=.24;m.trim.metalness=.7;belt(g,'march-issue-waist-belt',0,1.013,.173,.13,.042,m.leather);buckle(g,V(0,1.013,.101),m.trim,.043,.034);
 for(const s of [-1,1]){const x=s*.1143;
 // Shield outlines vary independently at top, waist and hem, with a pronounced forged centre ridge.
 const thigh:Surface=(u,v)=>{const t=u*2-1,a=t*1.19,w=.061+.047*v+.008*Math.sin(v*Math.PI),top=.959-.061*Math.pow(Math.abs(t),1.8),bottom=.609+.025*Math.abs(t);return V(x+w*Math.sin(a),bottom+(top-bottom)*v,-.036+(.087+.014*v)*Math.cos(a)+.023*(1-Math.abs(t)));};
 const shin:Surface=(u,v)=>{const t=u*2-1,a=t*1.19,w=.047+.04*Math.exp(-Math.pow((v-.8)/.34,2))+.022*Math.exp(-Math.pow(v/.15,2)),top=.512-.039*Math.pow(Math.abs(t),1.5),bottom=.153+.027*(1-Math.abs(t));return V(x+w*Math.sin(a),bottom+(top-bottom)*v,-.036+(.063+.018*v)*Math.cos(a)+.022*(1-Math.abs(t)));};
 const knee:Surface=(u,v)=>{const t=u*2-1,a=t*1.2,w=.052+.024*Math.sin(v*Math.PI);return V(x+w*Math.sin(a),.48+v*.127+.027*Math.abs(t)*(1-2*v),-.036+(.076+.039*Math.sin(v*Math.PI))*Math.cos(a)+.013*(1-Math.abs(t)));};
 for(const [name,f] of [['scalloped-thigh-cuisse',thigh],['waisted-flared-shin-greave',shin],['pointed-articulated-knee-cop',knee]] as const){
 shell(g,name,f,m.copper,.006,32,22);
 const raised:Surface=(u,v)=>f(u,v).add(V(0,0,.0045));
 // Broad forged perimeter bands stand proud of the base shell; rolled beads remain fully visible.
 for(const side of [0,1]){const band:Surface=(u,v)=>raised(side===0?u*.048:1-u*.048,v);shell(g,name+'-wide-vertical-forged-border',band,m.trim,.0025,4,24);}
 for(const end of [0,1]){const band:Surface=(u,v)=>raised(u,end===0?v*.024:1-v*.024);shell(g,name+'-wide-scalloped-forged-border',band,m.trim,.0025,32,3);}
 rim(g,name+'-proud-rounded-perimeter-bead',raised,m.trim,.0032);
 const ridge:Surface=(u,v)=>f(.487+u*.026,v).add(V(0,0,.0028));shell(g,name+'-bright-planished-centre-ridge',ridge,m.trim,.0018,3,24);
 for(const u of [.075,.925])for(const v of [.085,.89])rivet(g,f(u,v).add(V(0,0,.007)),m.trim,.005);
 }
 // Only the rear arc is leather. Its two ends overlap the actual side edges of each plate.
 for(const [plate,v] of [[thigh,.23],[thigh,.77],[knee,.55],[shin,.23],[shin,.78]] as const){const l=plate(0,v),r=plate(1,v),cy=(l.y+r.y)/2,rx=(r.x-l.x)/2;
 const strap:Surface=(u,w)=>{const a=Math.PI*.5+u*Math.PI;return V(x+(rx+.001)*Math.sin(a),cy+(w-.5)*.024,l.z+(.068+(cy>.6?.018:0))*Math.cos(a));};shell(g,'flush-rear-plate-fastening-strap',strap,m.leather,.004,24,3);const tab:Surface=(u,w)=>plate(s>0?.89+u*.11:u*.11,Math.max(0,Math.min(1,v+(w-.5)*.075))).add(V(0,0,.003));shell(g,'riveted-side-leather-anchor-tab',tab,m.leather,.003,4,4);const bp=plate(s>0?.94:.06,v).add(V(0,0,.006));buckle(g,bp,m.iron,.02,.028);
 }
 const hanger:Surface=(u,v)=>{const p=thigh(.46+u*.08,.97);return V(p.x,p.y+(1.031-p.y)*v,p.z+(.101-p.z)*v);};shell(g,'belt-to-thigh-leather-hanger',hanger,m.leather,.005,4,8);rim(g,'hanger-cut-edge',hanger,m.leather,.0014);rivet(g,hanger(.5,.16).add(V(0,0,.004)),m.trim);rivet(g,hanger(.5,.86).add(V(0,0,.004)),m.trim);
 }
}
function boots(g:T.Group,m:Mats){refinedCopper(m);for(const s of [-1,1]){const x=s*.1143;
 // One continuous hollow leather upper closes around the heel and toe. Only the cuff is open.
 const rows=[V(.071,.024,.252),V(.076,.054,.249),V(.075,.082,.227),V(.068,.112,.158),V(.055,.154,.039),V(.052,.19,.021),V(.062,.261,.026),V(.077,.338,.042)];
 const profile=new T.CatmullRomCurve3(rows),rear=new T.CatmullRomCurve3([V(0,.024,-.151),V(0,.054,-.153),V(0,.082,-.15),V(0,.112,-.14),V(0,.154,-.125),V(0,.19,-.119),V(0,.261,-.127),V(0,.338,-.136)]);
 const upper:Surface=(u,v)=>{const p=profile.getPoint(v),b=rear.getPoint(v),a=u*Math.PI*2,c=Math.cos(a),center=(p.z+b.z)/2,depth=(p.z-b.z)/2,wr=.0024*Math.sin(v*53+Math.sin(a)*2)*Math.sin(v*Math.PI);return V(x+(p.x+wr)*Math.sin(a)*(c<0?.86:1),p.y,center+(depth+wr)*c);};
 shell(g,'continuous-shaped-leather-boot-upper',upper,m.leather,.005,40,32);
 tube(g,'rolled-open-leather-cuff',Array.from({length:48},(_,i)=>upper(i/48,1)),.003,m.leather,true);stitches(g,'cuff-saddle-stitch',Array.from({length:80},(_,i)=>upper(i/80,.985)),m.thread);
 const toe:Surface=(u,v)=>{const a=-.235+u*.47;return upper((a+1)%1,v*.235).add(V(0,.0015,.002));};shell(g,'continuous-wrapped-copper-toe-cap',toe,m.copper,.004,28,12);rim(g,'toe-cap-copper-border',toe,m.trim,.002);for(const u of [.055,.945])rivet(g,toe(u,.66).add(V(0,0,.003)),m.iron,.0035);
 const instep:Surface=(u,v)=>{const t=u*2-1,a=t*(.135-.02*v);return upper((a+1)%1,.30+v*.25).add(V(0,.002,.006));};shell(g,'curved-copper-instep-and-ankle-guard',instep,m.copper,.004,22,14);rim(g,'instep-rolled-copper-edge',instep,m.trim,.0025);for(const u of [.06,.94])for(const v of [.08,.90])rivet(g,instep(u,v).add(V(0,0,.004)),m.iron,.0038);
 const outline=(u:number)=>{const p=upper(u,0),a=u*Math.PI*2;p.x+=.004*Math.sin(a);p.z+=.004*Math.cos(a);return p;};
 const sole:Surface=(u,v)=>{const p=outline(u);p.y=.006+v*.022;return p;};shell(g,'continuous-iron-outsole-rim',sole,m.iron,.006,48,3);
 const bottom:Surface=(u,v)=>{const p=outline(u);return V(x+(p.x-x)*v,.008,.047+(p.z-.047)*v);};shell(g,'solid-leather-and-iron-outsole-bottom',bottom,m.dark,.008,48,8);
 for(let i=0;i<18;i++){const p=outline(i/18);p.y=.02;rivet(g,p,m.iron,.0035);ball(g,'integrated-iron-hobnail',V(p.x,.004,p.z),V(.005,.004,.006),m.iron);}
 // Straps follow the same shaft surface, rather than orbiting it as detached loops.
 for(const at of [.57,.84]){const strap:Surface=(u,v)=>upper(u,at+(v-.5)*.052).add(V(Math.sin(u*Math.PI*2)*.002,0,Math.cos(u*Math.PI*2)*.002));shell(g,'fitted-buckled-shaft-strap',strap,m.leather,.003,40,3);const bp=strap(s>0?.16:.84,.5);const bg=new T.Group();bg.name='outer-shaft-buckle';bg.position.copy(bp);bg.rotation.y=s*.9;g.add(bg);buckle(bg,V(0,0,.003),m.iron,.028,.033);}
 const seam=Array.from({length:60},(_,i)=>upper(s>0?.19:.81,.45+i/59*.55).add(V(0,0,.001)));tube(g,'overlapped-shaft-side-seam',seam,.0016,m.leather);stitches(g,'waxed-shaft-stitching',seam,m.thread);
 const heel:Surface=(u,v)=>upper(.27+u*.46,.05+v*.39).add(V(0,0,-.003));shell(g,'stitched-reinforced-leather-heel-counter',heel,m.leather,.003,24,10);rim(g,'heel-counter-seam',heel,m.thread,.0008);
 }}
function gloves(g:T.Group,m:Mats){for(const s of [-1,1]){const hand=new T.Group();hand.name=s===1?'left-T-pose-glove':'right-T-pose-glove';g.add(hand);hand.position.set(s*.7065,1.4555,-.0654);hand.scale.x=s;
 const cuff:Surface=(u,v)=>{const a=u*Math.PI*2;return V(-.08+v*.079,(.036-v*.01)*Math.cos(a),(.042-v*.011)*Math.sin(a));};shell(hand,'flared-open-leather-gauntlet-cuff',cuff,m.leather,.004,32,10);tube(hand,'cuff-rolled-opening',Array.from({length:32},(_,i)=>cuff(i/32,0)),.0022,m.leather,true);stitches(hand,'cuff-stitches',Array.from({length:64},(_,i)=>cuff(i/64,.035)),m.thread);
 const strap:Surface=(u,v)=>{const a=u*Math.PI*2;return V(-.047+v*.021,.034*Math.cos(a),.039*Math.sin(a));};shell(hand,'wrist-retaining-strap',strap,m.leather,.003,32,3);rivet(hand,V(-.033,.034,.014),m.trim,.004);
 ball(hand,'fitted-leather-palm',V(.03,0,0),V(.047,.022,.043),m.leather);
 const back:Surface=(u,v)=>V(.002+v*.058,.021+.004*Math.sin(u*Math.PI),-.039+u*.078);shell(hand,'sewn-studded-back-of-hand-panel',back,m.leather,.003,14,10);rim(hand,'hand-panel-seam',back,m.thread,.0008);for(let j=0;j<2;j++)for(let i=0;i<3;i++)ball(hand,'copper-backhand-stud',V(.014+j*.024,.027,-.027+i*.027),V(.004,.003,.004),m.trim);
 for(let finger=0;finger<4;finger++){const z=-.032+finger*.021,len=[.074,.091,.096,.086][finger]!;for(let seg=0;seg<3;seg++){const xx=.067+seg*len/3,l=len/3;ball(hand,`finger-${finger}-leather-phalanx-${seg}`,V(xx+l/2,0,z),V(l*.58,.0115,.0095),m.leather);ball(hand,'finger-copper-rivet',V(xx+l/2,.012,z),V(.0031,.002,.0031),m.trim);const joint:Surface=(u,v)=>{const a=u*Math.PI*2;return V(xx+v*.003,.012*Math.cos(a),z+.01*Math.sin(a));};shell(hand,'finger-flexion-seam',joint,m.thread,.0007,12,2);}
 const knuckle:Surface=(u,v)=>{const a=(u-.5)*2.6;return V(.061+v*.022,.006+.011*Math.cos(a),z+.0105*Math.sin(a));};shell(hand,'hammered-copper-knuckle-plate',knuckle,m.copper,.002,12,4);rim(hand,'knuckle-rolled-edge',knuckle,m.trim,.001);
 }
 const a=V(.014,-.004,.035),b=V(.037,-.007,.067),c=V(.077,-.008,.082);tube(hand,'separate-articulated-leather-thumb',[a,b,c],.012,m.leather);for(const p of [b,c.clone().lerp(b,.35)])ball(hand,'thumb-copper-stud',p.clone().add(V(0,.011,0)),V(.004,.003,.004),m.trim);tube(hand,'palm-reinforcement-seam',[V(.008,-.022,-.034),V(.032,-.024,-.006),V(.056,-.017,.029)],.0008,m.thread);
 }}
function tower(g:T.Group,p:T.Vector3,m:Mats,r=.021){const med=mesh(g,'old-bastion-round-seal',new T.CylinderGeometry(r,r,.005,32),m.iron);med.rotation.x=Math.PI/2;med.position.copy(p);const face=mesh(g,'recessed-seal-field',new T.CylinderGeometry(r*.81,r*.81,.0055,32),m.dark);face.rotation.x=Math.PI/2;face.position.copy(p);const shape=new T.Shape();shape.moveTo(-r*.38,-r*.48);shape.lineTo(r*.38,-r*.48);shape.lineTo(r*.28,r*.3);shape.lineTo(r*.45,r*.3);shape.lineTo(r*.45,r*.57);shape.lineTo(r*.22,r*.57);shape.lineTo(r*.22,r*.43);shape.lineTo(r*.07,r*.43);shape.lineTo(r*.07,r*.62);shape.lineTo(-r*.07,r*.62);shape.lineTo(-r*.07,r*.43);shape.lineTo(-r*.22,r*.43);shape.lineTo(-r*.22,r*.57);shape.lineTo(-r*.45,r*.57);shape.lineTo(-r*.45,r*.3);shape.lineTo(-r*.28,r*.3);shape.closePath();const hole=new T.Path();hole.moveTo(-r*.08,-r*.48);hole.lineTo(-r*.08,-r*.13);hole.absarc(0,-r*.13,r*.08,Math.PI,0,true);hole.lineTo(r*.08,-r*.48);hole.closePath();shape.holes.push(hole);const relief=mesh(g,'raised-crenellated-tower-and-arched-gate',new T.ExtrudeGeometry(shape,{depth:.002,bevelEnabled:false}),m.iron);relief.position.copy(p).add(V(0,0,.004));}
function nightmarshal(g:T.Group,m:Mats){
 // Separate front and back ribs leave real armholes and a leather-supported waist.
 belt(g,'leather-waist-foundation',0,1.066,.166,.115,.13,m.leather,0);
 for(const front of [1,-1])for(let layer=0;layer<5;layer++){const y=1.074+layer*.07,width=.154+layer*.008,depth=front===1?.143:.119;
 const f:Surface=(u,v)=>{const t=u*2-1;return V(t*width,y+v*.098+.032*Math.abs(t),front*(depth*(1-.25*t*t)+.017*(1-Math.abs(t))));};shell(g,`${front===1?'front':'back'}-overlapping-chevron-rib-${layer}`,f,m.steel,.006,30,8);rim(g,'silver-edged-chevron-rib',f,m.iron,.0025);for(const u of [.055,.945])rivet(g,f(u,.48).add(V(0,0,front*.004)),m.iron,.0045);}
 const collar:Surface=(u,v)=>{const a=u*Math.PI*2;return V((.076+v*.004)*Math.sin(a),1.446+v*.065,(-.013)+(.075+v*.004)*Math.cos(a));};shell(g,'hollow-standing-gorget',collar,m.steel,.006,40,9);rim(g,'gorget-silver-welt',collar,m.iron,.0023);
 for(const s of [-1,1]){
 const shoulder:Surface=(u,v)=>{const a=(u-.5)*Math.PI*1.18;return V(s*(.124+v*.132),1.433+(.075-.014*v)*Math.cos(a),-.042+(.114-.008*v)*Math.sin(a));};shell(g,'curved-shoulder-bridge',shoulder,m.leather,.005,24,16);
 for(let l=0;l<2;l++){const f:Surface=(u,v)=>{const a=(u-.5)*Math.PI*1.25;return V(s*(.18+l*.07+v*.097),1.445+(.079-l*.006)*Math.cos(a)-v*.019,-.043+(.123-l*.003)*Math.sin(a));};shell(g,'overlapping-blue-steel-pauldron',f,m.steel,.005,28,10);rim(g,'pauldron-silver-border',f,m.iron,.0025);for(const u of [.05,.95])for(const v of [.13,.88])rivet(g,f(u,v),m.iron,.004);}
 tower(g,V(s*.262,1.447,.079),m,.024);tower(g,V(s*.137,1.429,.116),m,.022);
 for(const y of [1.145,1.213]){const f:Surface=(u,v)=>V(s*(.147+u*.023),y+(v-.5)*.026,.04+u*.044);shell(g,'side-adjustment-leather-strap',f,m.leather,.005,6,3);buckle(g,V(s*.166,y,.086),m.iron,.027,.035);}
 const susp:Surface=(u,v)=>V(s*(.126+u*.027),1.35+v*.143,.109-.051*v);shell(g,'shoulder-seal-leather-suspension',susp,m.leather,.005,4,12);buckle(g,V(s*.14,1.482,.071),m.iron,.025,.033);
 for(let l=0;l<3;l++){const tasset:Surface=(u,v)=>{const a=s*(.36+u*.88);return V((.181+v*.016)*Math.sin(a),1.074-l*.046-v*.065,.003+(.142+v*.011)*Math.cos(a));};shell(g,'articulated-flared-hip-tasset',tasset,m.steel,.004,16,8);rim(g,'tasset-silver-rim',tasset,m.iron,.0022);}
 tower(g,V(s*.112,1.061,.132),m,.024);
 }
 const apron:Surface=(u,v)=>{const t=u*2-1;return V(t*(.071+v*.006),.918+v*.133+.028*Math.abs(t),.159-.024*t*t);};shell(g,'pointed-central-faulds',apron,m.steel,.005,20,12);rim(g,'central-fauld-silver-edge',apron,m.iron,.0023);
 const diamond=new T.Shape();diamond.moveTo(0,-.035);diamond.lineTo(.027,0);diamond.lineTo(0,.035);diamond.lineTo(-.027,0);diamond.closePath();const d=mesh(g,'diamond-belt-seal-mount',new T.ExtrudeGeometry(diamond,{depth:.005,bevelEnabled:true,bevelSize:.0015,bevelThickness:.001,bevelSegments:1}),m.iron);d.position.set(0,1.04,.158);tower(g,V(0,1.04,.164),m,.019);
}
export const author:ItemModelAuthor={ids,build(id){if(!ids.includes(id as typeof ids[number]))throw new Error(`Unsupported armor-grithe item: ${id}`);const g=new T.Group();g.name=id;const m=materials();if(id==='grithe_helm')helmet(g,m);else if(id==='grithe_greaves')greaves(g,m);else if(id==='grithe_boots')boots(g,m);else if(id==='grithe_gloves')gloves(g,m);else nightmarshal(g,m);const description:Record<string,string>={grithe_helm:'Open-faced hammered copper cap with riveted crown band, ear skirt and leather lining.',grithe_greaves:'Paired copper thigh, knee and shin plates suspended from a march-issue leather belt.',grithe_boots:'Paired leather boots with copper toe and instep plates, buckled shafts and iron-studded soles.',grithe_gloves:'Paired studded leather T-pose gloves with copper knuckle plates and articulated fingers.',nightmarshal_plate:'Overlapping blue Nightglass ribs, silver borders, layered pauldrons and raised bastion tower seals.'};g.userData.itemModel={itemId:id,author:'armor-grithe',reference:`art/item-icons/generated/${id}.png`,description:description[id]!,wearable:true};return g;}};



