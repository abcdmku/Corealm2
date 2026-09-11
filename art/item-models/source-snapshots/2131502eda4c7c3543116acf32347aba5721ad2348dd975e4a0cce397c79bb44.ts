import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
type P = [number, number, number];
type Skin = { hide: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; edge: THREE.MeshStandardMaterial; wire: THREE.MeshStandardMaterial; inside: THREE.MeshStandardMaterial; ember: THREE.MeshStandardMaterial };
const ids = ['charhide_hood', 'charhide_robe', 'charhide_leggings', 'charhide_boots', 'charhide_wraps'] as const;
function hash(x: number, y: number): number { return ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1; }
function noise(x: number, y: number): number {
  const a = Math.floor(x), b = Math.floor(y), u = x-a, v = y-b, s = u*u*(3-2*u), t = v*v*(3-2*v);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(a,b),hash(a+1,b),s),THREE.MathUtils.lerp(hash(a,b+1),hash(a+1,b+1),s),t);
}
function materials(): Skin {
  const n = 512, col = new Uint8Array(n*n*4), normal = new Uint8Array(n*n*4), rough = new Uint8Array(n*n*4);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const i=(y*n+x)*4, u=x/n, v=y/n;
    const scorch = Math.max(0,(noise(u*8,v*10)-.40)*2.5), grain=noise(u*150,v*150), crease=Math.pow(Math.abs(Math.sin(u*166+Math.sin(v*93)*1.8)*Math.sin(v*177+Math.sin(u*77))),14);
    const f=1-scorch*.68, d=grain*22-crease*27;
    col[i]=(125+d)*f; col[i+1]=(58+d*.6)*f; col[i+2]=(32+d*.4)*f; col[i+3]=255;
    normal[i]=128+(noise((u+.002)*150,v*150)-grain)*18; normal[i+1]=128+(noise(u*150,(v+.002)*150)-grain)*18; normal[i+2]=255; normal[i+3]=255;
    rough[i]=rough[i+1]=rough[i+2]=170+grain*38+scorch*15; rough[i+3]=255;
  }
  const tex=(name:string,data:Uint8Array,color=false)=>{const t=new THREE.DataTexture(data,n,n);t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;if(color)t.colorSpace=THREE.SRGBColorSpace;return t;};
  const map=tex('Seared heavy hide: orange grain and charcoal scorch',col,true), nm=tex('Subtle independent leather pebble normal',normal), rm=tex('Hide grain roughness',rough);
  const mat=(name:string,color:number,roughness:number,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});m.name=name;return m;};
  const hide=mat('Burnt russet pebbled heavy hide',0xffffff,.8);hide.map=map;hide.normalMap=nm;hide.roughnessMap=rm;
  const dark=mat('Charred brown facing leather',0x51433b,.76);dark.map=map;dark.normalMap=nm;
  const edge=mat('Worn warm brown rolled leather edges',0x754227,.7);edge.normalMap=nm;
  const inside=mat('Dark suede interior',0x261b17,.96);inside.normalMap=nm;
  const wire=mat('Titanium stitch wire and buckles',0xa9a69a,.38,.7);
  const ember=mat('Fire opal fragments',0xeb4d0c,.27,.12);ember.emissive.setHex(0xb93104);ember.emissiveIntensity=.5;
  return {hide,dark,edge,wire,inside,ember};
}
function add(g:THREE.Group,name:string,geo:THREE.BufferGeometry,mat:THREE.Material):THREE.Mesh {const m=new THREE.Mesh(geo,mat);m.name=name;m.castShadow=m.receiveShadow=true;g.add(m);return m;}
function surface(g:THREE.Group,name:string,fn:(u:number,v:number)=>P,nu:number,nv:number,mat:THREE.Material):void {
  const p:number[]=[],uv:number[]=[],idx:number[]=[];
  for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){p.push(...fn(i/nu,j/nv));uv.push(i/nu,j/nv);}
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+nu+1;idx.push(a,a+1,b,a+1,b+1,b);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();add(g,name,geo,mat);
}
function tube(g:THREE.Group,name:string,ps:P[],r:number,mat:THREE.Material,closed=false):void {const curve=new THREE.CatmullRomCurve3(ps.map(p=>new THREE.Vector3(...p)),closed);add(g,name,new THREE.TubeGeometry(curve,Math.max(3,ps.length),r,5,closed),mat);}
function line(g:THREE.Group,name:string,a:P,b:P,r:number,m:THREE.Material):void {const aa=new THREE.Vector3(...a),bb=new THREE.Vector3(...b),d=bb.clone().sub(aa);const mesh=add(g,name,new THREE.CylinderGeometry(r,r,d.length(),5,1),m);mesh.position.copy(aa.add(bb).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());}
function stitches(g:THREE.Group,name:string,ps:P[],m:THREE.Material,cross=true,step=.023):void {
 const curve=new THREE.CatmullRomCurve3(ps.map(p=>new THREE.Vector3(...p)));const count=Math.max(2,Math.floor(curve.getLength()/step));
 for(let i=0;i<count;i++){const t=(i+.5)/count,p=curve.getPointAt(t),d=curve.getTangentAt(t),side=new THREE.Vector3(-d.y,d.x,0);if(side.length()<.1)side.set(1,0,0);side.normalize().multiplyScalar(.0045);d.multiplyScalar(.004);
 const a=p.clone().sub(d).sub(side),b=p.clone().add(d).add(side);line(g,name+' wire '+i,a.toArray() as P,b.toArray() as P,.0011,m);
 if(cross)line(g,name+' crossed wire '+i,p.clone().sub(d).add(side).toArray() as P,p.clone().add(d).sub(side).toArray() as P,.0011,m);
 }
}
type Ring=[number,number,number,number]; // y, x radius, z radius, z center
function interp(rings:Ring[],v:number):Ring {const t=v*(rings.length-1),i=Math.min(rings.length-2,Math.floor(t)),f=t-i;return rings[i]!.map((x,k)=>THREE.MathUtils.lerp(x,rings[i+1]![k]!,f)) as Ring;}
function loft(g:THREE.Group,name:string,rings:Ring[],m:Skin,x=0,fold=.002,start=0,end=TAU): (u:number,v:number)=>P {
 const fn=(u:number,v:number,inside=false):P=>{const [y,rx,rz,z]=interp(rings,v),a=start+u*(end-start),f=fold*(Math.sin(a*9+v*8)+.5*Math.sin(v*42+a*3)),t=inside?.005:0;return [x+(rx+f-t)*Math.sin(a),y,z+(rz+f-t)*Math.cos(a)];};
 surface(g,name+' exterior',(u,v)=>fn(u,v),36,Math.max(5,rings.length*3),m.hide);
 surface(g,name+' suede interior',(u,v)=>fn(1-u,v,true),36,Math.max(5,rings.length*3),m.inside);
 for(const v of [0,1])surface(g,name+' turned opening '+v,(u,w)=>{const a=fn(u,v),b=fn(u,v,true);return a.map((n,k)=>THREE.MathUtils.lerp(n,b[k]!,w)) as P;},36,1,m.edge);
 if(end-start<TAU-.01)for(const u of [0,1])surface(g,name+' cut edge '+u,(v,w)=>{const a=fn(u,v),b=fn(u,v,true);return a.map((n,k)=>THREE.MathUtils.lerp(n,b[k]!,w)) as P;},30,1,m.edge);
 return (u,v)=>fn(u,v);
}
function outline(g:THREE.Group,name:string,fn:(u:number,v:number)=>P,v:number,m:Skin,wire=true):void {const ps=Array.from({length:65},(_,i)=>fn(i/64,v));tube(g,name+' piping',ps,.0026,m.edge);if(wire)stitches(g,name,ps,m.wire,false,.017);}
function ribbon(g:THREE.Group,name:string,ps:P[],width:number,m:Skin,wire=true):void {
 const curve=new THREE.CatmullRomCurve3(ps.map(p=>new THREE.Vector3(...p)));const at=(u:number,v:number):P=>{const p=curve.getPoint(u),t=curve.getTangent(u),s=new THREE.Vector3(-t.y,t.x,0);if(s.length()<.1)s.set(1,0,0);s.normalize().multiplyScalar((v-.5)*width);return p.add(s).toArray() as P;};
 surface(g,name,at,Math.max(16,ps.length*4),3,m.dark);for(const v of [0,1]){const pp=Array.from({length:41},(_,i)=>at(i/40,v));tube(g,name+' rolled side '+v,pp,.002,m.edge);if(wire)stitches(g,name,pp,m.wire,false,.018);}
}
function stud(g:THREE.Group,name:string,p:P,r:number,m:THREE.Material):void {const s=add(g,name,new THREE.SphereGeometry(r,10,6),m);s.position.set(...p);s.scale.z=.4;}
function hood(g:THREE.Group,m:Skin):void {
 // Open face, peaked crown, rear dome and shoulder cape are separate hollow hide panels.
 const fn=(u:number,v:number,inner=false):P=>{const a=u*TAU,depth=v*Math.PI/2,r=Math.cos(depth),t=inner?.006:0;const rx=.119-t,ry=.168-t;return [Math.sin(a)*rx*r,1.689+Math.cos(a)*ry*r+.012*Math.sin(depth),.117-.26*Math.sin(depth)+.009*Math.cos(a)*r];};
 surface(g,'Hood domed crown and closed back',(u,v)=>fn(u,v),64,24,m.hide);surface(g,'Hood dark inner crown',(u,v)=>fn(1-u,v,true),64,24,m.inside);
 const face=Array.from({length:81},(_,i)=>fn(i/80,0));tube(g,'Thick turned face opening',face,.008,m.edge);stitches(g,'Face opening running stitch',face,m.wire,false,.017);
 for(const a of [.12,.88]) {const ps=Array.from({length:31},(_,j)=>{const p=fn(a,j/30);p[2]+=.003;return p;});tube(g,'Crown raised panel seam',ps,.003,m.dark);stitches(g,'Crown cross stitching',ps,m.wire,true,.023);}
 const cowl=loft(g,'Shoulder cowl',[[1.438,.228,.17,-.025],[1.472,.185,.139,-.025],[1.51,.118,.112,-.029],[1.55,.103,.105,-.03]],m,0,.003);outline(g,'Cowl hem',cowl,0,m);
 for(const v of [.52,.73])outline(g,'Gathered neck fold',cowl,v,m,false);
 ribbon(g,'Front laced cowl closure',[[0,1.442,.15],[.002,1.486,.127],[0,1.541,.081]],.03,m);stitches(g,'Front cowl X lacing',[[0,1.448,.154],[0,1.535,.089]],m.wire,true,.023);
}
function robe(g:THREE.Group,m:Skin):void {
 const body=loft(g,'Fitted wrap robe bodice',[[1.03,.159,.107,-.014],[1.14,.148,.11,-.006],[1.29,.183,.134,-.012],[1.40,.192,.126,-.023],[1.46,.157,.096,-.03],[1.51,.077,.074,-.035]],m,0,.002);
 const skirt=loft(g,'Heavy flared ankle skirt',[[.16,.325,.232,-.018],[.26,.305,.216,-.019],[.48,.264,.184,-.014],[.73,.214,.144,-.014],[.96,.169,.113,-.01],[1.055,.159,.11,-.014]],m,0,.009,.038,TAU-.038);
 outline(g,'Weighted skirt hem',skirt,0,m);outline(g,'Collar upper rolled lip',body,1,m);
 for(let k=0;k<8;k++){const u=(k+.25)/8,ps=Array.from({length:26},(_,j)=>{const p=skirt(u,j/25);p[0]*=1.012;p[2]=-.014+(p[2]+.014)*1.014;return p;});tube(g,'Skirt joined hide panel seam '+k,ps,.004,m.dark);stitches(g,'Skirt titanium seam '+k,ps,m.wire,true,.027);}
 ribbon(g,'Broad diagonal wrap collar',[[ -.065,1.507,.045],[-.083,1.445,.09],[-.029,1.357,.133],[.063,1.237,.119],[.115,1.096,.091]],.041,m);
 ribbon(g,'Underlapping collar',[[.064,1.507,.044],[.088,1.454,.08],[.032,1.362,.13]],.032,m);
 for(const s of [-1,1]) {
 const sleeve=new THREE.Group();sleeve.name=(s===1?'Left':'Right')+' loose T-pose sleeve';
 const f=loft(sleeve,'Wide folded sleeve',[[0,.113,.105,0],[.08,.102,.099,0],[.19,.086,.081,0],[.27,.077,.08,0],[.37,.091,.087,0],[.42,.1,.092,0]],m,0,.006);outline(sleeve,'Bell cuff',f,1,m);outline(sleeve,'Cuff facing stitch',f,.94,m);
 // Local sleeve +Y points outward along the arm.
 sleeve.rotation.z=-s*Math.PI/2;sleeve.position.set(s*.207,1.4555,-.0654);g.add(sleeve);
 const ps=Array.from({length:15},(_,i)=>[s*(.12+i*.010),1.475+.021*Math.sin(i/14*Math.PI),-.058+.10*Math.cos(i/14*Math.PI)] as P);ribbon(g,'Shoulder reinforced facing '+s,ps,.045,m);
 const seam=Array.from({length:16},(_,i)=>body(s===1?.155:.845,i/15));stitches(g,'Bodice cross seams '+s,seam,m.wire,true,.025);
 }
 const belt=loft(g,'Dark encircling waist belt',[[1.055,.166,.12,-.01],[1.09,.166,.12,-.01]],{...m,hide:m.dark},0,0);outline(g,'Belt lower seam',belt,0,m);outline(g,'Belt upper seam',belt,1,m);
 for(const x of [.058,.08]){const ps=Array.from({length:25},(_,i)=>[x+.017*Math.sin(i/24*TAU),1.073+.025*Math.cos(i/24*TAU),.119] as P);tube(g,'Double D-ring belt buckle',ps,.0034,m.wire);}
 ribbon(g,'Hanging belt tongue',[[.082,1.071,.127],[.091,.91,.143],[.105,.72,.166],[.09,.669,.18]],.037,m);stitches(g,'Belt tail lacing',[[.09,.74,.175],[.094,.79,.17]],m.wire,true,.025);
 // Back yoke seam follows body curvature rather than a blank back panel.
 tube(g,'Rear shoulder yoke seam',[[-.16,1.411,-.102],[-.08,1.403,-.145],[0,1.397,-.157],[.08,1.403,-.145],[.16,1.411,-.102]],.003,m.dark);
 stitches(g,'Rear yoke wire',[[-.16,1.411,-.105],[0,1.397,-.16],[.16,1.411,-.105]],m.wire,true,.022);
}
function leggings(g:THREE.Group,m:Skin):void {
 const pelvis=loft(g,'Hip and seat hide shell',[[.857,.177,.11,-.035],[.926,.188,.125,-.027],[1.014,.17,.111,-.019]],m,0,.002);
 const waist=loft(g,'Stitched broad waistband',[[.977,.178,.12,-.02],[1.023,.175,.118,-.02]],{...m,hide:m.dark},0,0);outline(g,'Waist upper stitch',waist,1,m);outline(g,'Waist lower stitch',waist,0,m);
 for(const s of [-1,1]){
 const x=s*.1143,f=loft(g,'Separate hide trouser leg '+s,[[.15,.061,.062,-.043],[.23,.069,.071,-.043],[.35,.078,.078,-.043],[.49,.079,.081,-.043],[.59,.09,.093,-.039],[.73,.102,.112,-.039],[.88,.108,.12,-.035]],m,x,.0035);
 for(const a of [.23,.72]){const ps=Array.from({length:25},(_,j)=>f(a,j/24));tube(g,'Raised side seam '+s,ps,.003,m.dark);stitches(g,'Trouser side wire '+s,ps,m.wire,true,.026);}
 for(const y of [.165,.203,.512,.574]){const r=y>.3?.085:.066;const band=loft(g,'Leg retaining strap '+s+' '+y,[[y,r,r+.002,-.043],[y+.023,r+.002,r+.004,-.043]],{...m,hide:m.dark},x,0);outline(g,'Strap stitch',band,0,m);stud(g,'Strap rivet',[x+s*.04,y+.012,.026],.005,m.wire);}
 // Bulged knee reinforcement with closed rolled outline and wire stitch.
 surface(g,'Moulded leather kneepad '+s,(u,v)=>{const a=u*TAU,r=v;return [x+Math.sin(a)*.071*r,.548+Math.cos(a)*.092*r,.049+.026*(1-r*r)];},36,8,m.dark);
 const rim=Array.from({length:41},(_,i)=>[x+Math.sin(i/40*TAU)*.071,.548+Math.cos(i/40*TAU)*.092,.05] as P);tube(g,'Kneepad rolled perimeter',rim,.003,m.edge);stitches(g,'Kneepad perimeter stitch',rim,m.wire,false,.017);
 for(const y of [.27,.34,.72,.80]){const ps=Array.from({length:15},(_,i)=>[x+(i/14-.5)*.12,y+.009*Math.sin(i/14*Math.PI*2+s),.026+.017*Math.sin(i/14*Math.PI)] as P);tube(g,'Soft folded hide ridge '+s,ps,.0035,m.hide);}
 const loopX=s*.118;ribbon(g,'Belt suspension loop '+s,[[loopX,1.021,.073],[loopX,.97,.099],[loopX,.95,.1]],.017,m);
 const ring=Array.from({length:21},(_,i)=>[loopX+.016*Math.sin(i/20*TAU),.943+.019*Math.cos(i/20*TAU),.103] as P);tube(g,'Waist D ring '+s,ring,.0024,m.wire);
 }
 ribbon(g,'Overlapping front fly',[[0,1.025,.104],[0,.96,.11],[0,.9,.102],[.01,.862,.073]],.03,m);for(const y of [1.008,.987])stud(g,'Fly metal button',[0,y,.11],.005,m.wire);
 stitches(g,'Rear seat seam',[[0,.872,-.152],[0,.93,-.156],[0,1.008,-.137]],m.wire,true,.025);
 outline(g,'Seat waistband joining',pelvis,.92,m,false);
}
function boots(g:THREE.Group,m:Skin):void {
 for(const s of [-1,1]){
 const x=s*.1143;
 const shell=loft(g,'Shaped foot vamp and boot shaft '+s,[[.021,.067,.16,.026],[.044,.07,.158,.025],[.08,.064,.143,.018],[.113,.058,.105,-.015],[.16,.059,.073,-.046],[.22,.067,.074,-.047],[.30,.073,.078,-.049],[.345,.08,.081,-.047]],m,x,.002);
 const sole=loft(g,'Layered thick leather sole '+s,[[.005,.068,.163,.027],[.021,.07,.166,.027],[.029,.069,.163,.026]],{...m,hide:m.dark},x,0);outline(g,'Sole welt stitching '+s,sole,.8,m);surface(g,'Closed sole bottom '+s,(u,v)=>[x+.067*v*Math.sin(u*TAU),.006,.027+.16*v*Math.cos(u*TAU)],48,4,m.dark);
 const cuff=loft(g,'Turned flared boot cuff '+s,[[.288,.079,.083,-.048],[.324,.085,.089,-.049],[.361,.092,.094,-.049]],m,x,.001);outline(g,'Boot cuff opening',cuff,1,m);outline(g,'Cuff bottom seam',cuff,0,m);
 for(const turn of [-1,1]){const ps=Array.from({length:65},(_,i)=>{const a=i/64*TAU;return [x+.073*Math.sin(a),.22+turn*.037*Math.cos(a),-.047+.078*Math.cos(a)] as P;});ribbon(g,'Crossed boot binding '+s+' '+turn,ps,.022,m);}
 ribbon(g,'Boot hanging knot ends '+s,[[x+s*.045,.248,.018],[x+s*.057,.21,.016],[x+s*.061,.155,.01]],.021,m);
 const seam=Array.from({length:27},(_,j)=>shell(.28,j/26));tube(g,'Boot rear quarter join '+s,seam,.003,m.edge);stitches(g,'Boot quarter wire '+s,seam,m.wire,false,.015);
 const toe=Array.from({length:25},(_,i)=>{const a=-Math.PI/2+i/24*Math.PI;return [x+.061*Math.sin(a),.045+.042*Math.cos(a),.113+.025*Math.cos(a)] as P;});ribbon(g,'Protective dark toe facing '+s,toe,.025,m);
 for(const v of [.20,.26]){const ps=Array.from({length:21},(_,i)=>shell(.82+i/20*.36,v));tube(g,'Instep soft fold '+s,ps,.003,m.hide);}
 }
}
function wraps(g:THREE.Group,m:Skin):void {
 for(const s of [-1,1]){
 const arm=new THREE.Group();arm.name=(s>0?'Left':'Right')+' fingerless charhide wrap';
 const f=loft(arm,'Wrapped wrist and palm',[[0,.054,.052,0],[.06,.046,.044,0],[.12,.035,.035,0],[.16,.041,.035,0],[.20,.041,.033,0]],m,0,.0017);outline(arm,'Open forearm cuff',f,0,m);outline(arm,'Fingerless palm lip',f,1,m);
 for(let j=0;j<4;j++){
 const ps=Array.from({length:49},(_,i)=>{const a=i/48*TAU,y=.022+j*.043+.014*Math.cos(a),r=.053-j*.004;return [r*Math.sin(a),y,r*.94*Math.cos(a)] as P;});ribbon(arm,'Cross-wound seared leather strip '+j,ps,.025,m);
 const channel=ps.map(p=>[p[0]*1.035,p[1]+.008,p[2]*1.035] as P);tube(arm,'Opal inset dark channel '+j,channel,.0026,m.dark);
 for(let k=0;k<16;k++){const p=channel[k*3]!;const gem=add(arm,'Fire opal chip '+j+' '+k,new THREE.IcosahedronGeometry(.0024+(k%3)*.0004,0),m.ember);gem.position.set(...p);gem.scale.set(1,1.3,.8);}
 }
 // Four distinct open-ended finger stalls. They stop below exposed fingertips.
 for(let k=0;k<4;k++){
 const x=(k-1.5)*.021,y=.191+(k===0||k===3?-.006:.003);
 const finger=loft(arm,'Open finger stall '+k,[[y,.0105,.015,0],[y+.026,.0102,.0145,0]],m,x,0);outline(arm,'Finger stall cut edge '+k,finger,1,m,false);
 }
 const thumb=new THREE.Group();const th=loft(thumb,'Open thumb loop',[[0,.016,.018,0],[.043,.015,.017,0]],m,0,0);outline(thumb,'Thumb cut edge',th,1,m);thumb.rotation.z=-.8;thumb.position.set(.031,.135,.005);arm.add(thumb);
 stitches(arm,'Cuff closure cross lacing',[[0,.012,.056],[.004,.065,.049]],m.wire,true,.016);
 // Local +Y is finger direction. Local X spans knuckles vertically in the native T pose.
 arm.rotation.z=-s*Math.PI/2;arm.position.set(s*.565,1.4555,-.0654);g.add(arm);
 }
}
export const author: ItemModelAuthor = {
 ids,
 build(id:string):THREE.Group {
  if(!ids.includes(id as typeof ids[number]))throw new Error('Unknown charhide item '+id);
  const g=new THREE.Group();g.name=id+' native T-pose';const m=materials();
  if(id==='charhide_hood')hood(g,m);else if(id==='charhide_robe')robe(g,m);else if(id==='charhide_leggings')leggings(g,m);else if(id==='charhide_boots')boots(g,m);else wraps(g,m);
  g.userData.itemModel={itemId:id,author:'armor-charhide',reference:'art/item-icons/generated/'+id+'.png',description:'Seared russet heavy hide with charcoal patches, pebbled grain, turned suede openings, volumetric folds and titanium wire seams. Authored in native male T-pose with complete rear construction.',wearable:true};
  return g;
 }
};

