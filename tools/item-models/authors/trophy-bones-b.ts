import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Id = 'ibex_horn' | 'aurochs_horn' | 'ashback_claw' | 'cinder_tusk' | 'emberhorn' | 'kiln_fang';
type Point = readonly [number, number, number];
interface Shape { points: readonly Point[]; radii: readonly number[]; depth: number; rings: number; description: string }
const shapes: Record<Id, Shape> = {
  ibex_horn: { points: [[0,0,.035],[.065,.19,0],[.16,.38,-.01],[.31,.53,0],[.47,.565,0],[.575,.515,.005],[.605,.465,.012]], radii: [.092,.080,.066,.050,.033,.017,.0002], depth: .76, rings: 11, description: 'Ridged the whole length, one ring a winter. This one counted eleven.' },
  aurochs_horn: { points: [[-.27,-.12,.05],[-.11,-.10,0],[.10,-.045,-.015],[.27,.09,0],[.34,.29,.005],[.325,.43,0],[.28,.51,0]], radii: [.13,.117,.089,.063,.036,.018,.0002], depth: .88, rings: 0, description: 'As long as your arm and heavier. The terrace herds are the last ones anywhere.' },
  ashback_claw: { points: [[.085,.15,.025],[.025,.125,0],[-.065,.08,-.005],[-.145,.005,0],[-.19,-.09,.005],[-.195,-.165,.01],[-.183,-.19,.012]], radii: [.063,.060,.046,.035,.022,.008,.00015], depth: .55, rings: 0, description: 'Grey to the root, like the bear it came off. Ashford doors hang two, crossed.' },
  cinder_tusk: { points: [[-.14,.19,.025],[-.125,.07,0],[-.07,-.07,-.005],[.065,-.145,0],[.205,-.14,.01],[.295,-.075,.02],[.325,-.015,.025]], radii: [.068,.061,.057,.045,.029,.014,.0002], depth: .73, rings: 0, description: 'A boar tusk stained kiln-black. The point still goes through boot leather.' },
  emberhorn: { points: [[0,0,.045],[.025,.18,.01],[.11,.39,0],[.25,.57,-.01],[.40,.635,0],[.545,.59,.01],[.61,.495,.025]], radii: [.102,.091,.074,.060,.040,.023,.0002], depth: .73, rings: 11, description: 'Ridged ibex horn with a red cast the foothill dust never washes out of.' },
  kiln_fang: { points: [[-.11,.205,.024],[-.075,.12,0],[-.025,.015,-.009],[.04,-.065,0],[.145,-.14,.01],[.205,-.20,.015],[.225,-.247,.019]], radii: [.052,.047,.037,.027,.017,.007,.0001], depth: .66, rings: 0, description: 'An viper fang the colour of cooling slag. Hot to the touch for a day after the kill.' },
};
const TAU = 2 * Math.PI;
const hash = (n: number): number => { const q = Math.sin(n * 127.13 + 41.71) * 43758.5453; return q - Math.floor(q); };
const smooth = (a: number, b: number, t: number): number => { const q = THREE.MathUtils.clamp((t-a)/(b-a),0,1); return q*q*(3-2*q); };
function texture(name: string, fn: (u: number, t: number) => readonly number[], linear = false): THREE.DataTexture {
  const w=512,h=1024, data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const c=fn(x/w,y/(h-1)), k=(y*w+x)*4; for(let j=0;j<3;j++) data[k+j]=THREE.MathUtils.clamp(c[j]!,0,255); data[k+3]=255; }
  const tex=new THREE.DataTexture(data,w,h); tex.name=name; tex.colorSpace=linear?THREE.NoColorSpace:THREE.SRGBColorSpace;
  tex.wrapS=THREE.RepeatWrapping; tex.magFilter=THREE.LinearFilter; tex.minFilter=THREE.LinearMipmapLinearFilter; tex.generateMipmaps=true; tex.needsUpdate=true; return tex;
}
function rib(t: number, count: number): number {
  let amount=0;
  for(let i=0;i<count;i++) { const center=.055+i*.076; const d=(t-center)/(.009+.006*(1-center)); amount+=Math.exp(-d*d); }
  return amount;
}
function pigment(id: Id, u: number, t: number): number[] {
  let base:number[];
  const a=u*TAU, grain=Math.sin(a*49 + Math.sin(t*17)*.45)+.4*Math.sin(a*117+t*9), grit=hash(Math.floor(u*512)+Math.floor(t*1024)*577);
  const streak=Math.pow(Math.max(0,Math.sin(a*77+.3*Math.sin(t*20))),28);
  const checks=Math.pow(Math.max(0,Math.sin(t*321+Math.sin(a*13)*.7)),44)*smooth(.1,.4,hash(Math.floor(u*37)+Math.floor(t*48)*41));
  if(id==='ibex_horn') { const tip=smooth(.77,1,t); base=[111-69*tip,79-45*tip,48-20*tip]; const crest=rib(t,11); base=base.map((v,k)=>v+crest*[40,34,25][k]!); }
  else if(id==='emberhorn') {
    const crest=smooth(.12,.72,rib(t,11)),tip=smooth(.82,1,t);
    // Broad rusty channels remain legible in outdoor light between dark worn crests.
    const mottling=Math.sin(a*21+t*179)*Math.sin(a*43-t*97)*11;
    base=[202-91*crest-139*tip+mottling,99-25*crest-64*tip+mottling*.5,51+2*crest-27*tip];
    const chipped=1-smooth(.013,.039+.009*Math.sin(a*7),t);
    base=base.map((v,k)=>THREE.MathUtils.lerp(v,[229,204,162][k]!,chipped));
  }
  else if(id==='aurochs_horn') { const dark=smooth(.48,.83,t+.055*Math.sin(a*5)); base=[205-166*dark,176-139*dark,126-91*dark]; }
  else if(id==='ashback_claw') { const tip=smooth(.04,.95,t); base=[133-74*tip,125-68*tip,112-58*tip]; }
  else if(id==='cinder_tusk') {
    const weather=.035*Math.sin(a*31+t*101)+.055*Math.sin(a*9-t*71);
    const ivory=Math.max(smooth(.71,.90,t),smooth(-.30,.24,Math.cos(a)+weather)*(.42+.58*smooth(.09,.3,t)));
    base=[47+193*ivory,44+173*ivory,39+128*ivory];
    const broken=(1-smooth(.025,.095,t))*(.3+.7*smooth(-.2,.6,Math.sin(a*6+t*29)));
    base=base.map((v,k)=>THREE.MathUtils.lerp(v,[185,152,107][k]!,broken));
  }
  else { base=[60+21*smooth(.65,1,t),57+1*smooth(.65,1,t),51-10*smooth(.65,1,t)]; const furrow=Math.exp(-Math.pow((u-.25)/.018,2)); base=base.map(v=>v*(1-.7*furrow)); }
  const root=(1-smooth(.025,.105,t));
  const pores=grit>.87?-25:0;
  return base.map((v,k)=>v+grain*5+(grit-.5)*17+streak*24-checks*19+root*([40,29,15][k]!+pores));
}
function materials(id:Id): { outer:THREE.MeshStandardMaterial; inner:THREE.MeshStandardMaterial; lip:THREE.MeshStandardMaterial } {
  const outer=new THREE.MeshStandardMaterial({map:texture(`${id} worn keratin color`,(u,t)=>pigment(id,u,t)), roughness:.62, metalness:0}); outer.name=`${id} natural keratin`;
  outer.roughnessMap=texture(`${id} independent growth roughness`,(u,t)=>{const g=.63+.12*Math.sin(u*TAU*37+t*11)+.12*(1-smooth(0,.15,t)); return [g*255,g*255,g*255];},true);
  // Low-amplitude normals describe aligned fibers, independent of the mottled pigment.
  outer.normalMap=texture(`${id} fine longitudinal fiber normals`,(u,t)=>[128+8*Math.sin(u*TAU*83+.5*Math.sin(t*21)),128+3*Math.sin(t*205+u*13),254],true); outer.normalScale.set(.4,.4);
  const inner=new THREE.MeshStandardMaterial({color:id==='ashback_claw'?0x797369:0x725035,roughness:.91,map:texture(`${id} root cavity grain`,(u,t)=>{const n=hash(Math.floor(u*512)+Math.floor(t*1024)*513);return [130+n*43,105+n*36,76+n*26];})}); inner.name=`${id} porous root interior`;
  const lip=new THREE.MeshStandardMaterial({color:id==='ashback_claw'?0xa6a094:0xc2a276,roughness:.9,map:texture(`${id} broken edge pores`,(u,t)=>{const n=hash(Math.floor(u*512)+Math.floor(t*1024)*517); const d=n>.83?.35:.7+n*.3;return [255*d,238*d,204*d];})}); lip.name=`${id} exposed chipped root`;
  if(id==='emberhorn') {
    outer.roughness=.87;
    inner.color.set(0xdfcba9); lip.color.set(0xfff0d2);
    inner.map=texture(`${id} pale open root trabeculae`,(u,t)=>{const cell=Math.sin(u*TAU*31+t*43)*Math.sin(u*TAU*19-t*79);const n=smooth(-.4,.5,cell);return [105+115*n,75+120*n,44+114*n];});
    lip.map=texture(`${id} coarse porous ivory break`,(u,t)=>{const pore=smooth(.35,.7,Math.sin(u*TAU*37+t*33)*Math.cos(u*TAU*21-t*37));return [239-139*pore,213-133*pore,168-117*pore];});
  }
  if(id==='cinder_tusk') {outer.roughness=.76;lip.color.set(0xf5e3c3);}
  return {outer,inner,lip};
}
function geo(p:number[],uv:number[],idx:number[]):THREE.BufferGeometry {const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));for(let i=0;i<idx.length;i+=3){const v=idx[i+1]!;idx[i+1]=idx[i+2]!;idx[i+2]=v;}g.setIndex(idx);g.computeVertexNormals();return g;}
function add(root:THREE.Group,name:string,g:THREE.BufferGeometry,m:THREE.Material):void {const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
function build(id:Id):THREE.Group {
  const spec=shapes[id], root=new THREE.Group(), mat=materials(id);
  root.name=`${id} anatomical trophy`;
  root.userData.itemModel={itemId:id,author:'trophy-bones-b',reference:`art/item-icons/generated/${id}.png`,description:spec.description};
  const path=new THREE.CatmullRomCurve3(spec.points.map(p=>new THREE.Vector3(...p)),false,'centripetal');
  const sample=(t:number,a:number,inside=false):THREE.Vector3=>{
    const p=path.getPoint(t), tangent=path.getTangent(t).normalize(), sideways=new THREE.Vector3(tangent.y,-tangent.x,0).normalize(), front=new THREE.Vector3().crossVectors(sideways,tangent).normalize();
    const fi=t*(spec.radii.length-1), i=Math.min(spec.radii.length-2,Math.floor(fi)), f=fi-i;
    let r=THREE.MathUtils.lerp(spec.radii[i]!,spec.radii[i+1]!,f);
    const edge=(1-smooth(0,.06,t));
    const fluting=(.012*Math.sin(a*19+t*8)+.006*Math.sin(a*47-t*4))*(1-t);
    const uneven=(.033*Math.sin(a*3+.2)+.018*Math.sin(a*7-t*6));
    const ring=rib(t,spec.rings)*(.11+.14*Math.max(0,Math.sin(a))) ;
    const flare=edge*(.13+.09*Math.sin(a*5+.6));
    r*=1+uneven+fluting+ring+flare;
    if(id==='emberhorn'&&t<.055) r*=1-.055*(1-smooth(.015,.055,t))*Math.pow(Math.max(0,Math.sin(a*31+t*227)),4);
    if(id==='ashback_claw') r*=1+.12*Math.cos(a*3)*(1-t);
    if(id==='cinder_tusk') r*=1+.09*Math.cos(a*3+.7);
    if(id==='kiln_fang') { const delta=Math.atan2(Math.sin(a-Math.PI/2),Math.cos(a-Math.PI/2)); r*=1-.19*Math.exp(-Math.pow(delta/.12,2))*smooth(.025,.1,t)*(1-smooth(.86,.98,t)); }
    if(inside) r*=.77*(1-smooth(.035,.19,t));
    if(t===1) r=0;
    p.addScaledVector(sideways,Math.cos(a)*r).addScaledVector(front,Math.sin(a)*r*spec.depth);
    if(t<.03) p.addScaledVector(tangent,edge*(.002*Math.sin(a*11)+.0018*Math.sin(a*23)));
    return p;
  };
  const sides=112, steps=220, pos:number[]=[],uv:number[]=[],index:number[]=[];
  for(let y=0;y<=steps;y++) for(let x=0;x<=sides;x++) {const p=sample(y/steps,x/sides*TAU);pos.push(p.x,p.y,p.z);uv.push(x/sides,y/steps);}
  for(let y=0;y<steps;y++) for(let x=0;x<sides;x++){const k=y*(sides+1)+x;index.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
  add(root,'Continuous tapered keratin with anatomical growth grooves',geo(pos,uv,index),mat.outer);
  const ip:number[]=[],iu:number[]=[],ii:number[]=[],is=32;
  for(let y=0;y<=is;y++) for(let x=0;x<=sides;x++){const p=sample(y/is*.19,x/sides*TAU,true);ip.push(p.x,p.y,p.z);iu.push(x/sides,y/is);}
  for(let y=0;y<is;y++) for(let x=0;x<sides;x++){const k=y*(sides+1)+x;ii.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}
  add(root,'Deep tapering root socket with closed internal end',geo(ip,iu,ii),mat.inner);
  const rp:number[]=[],ru:number[]=[],ri:number[]=[],bands=5;
  for(let y=0;y<=bands;y++)for(let x=0;x<=sides;x++) {const a=x/sides*TAU,p=sample(0,a).lerp(sample(0,a,true),y/bands); p.z+=.001*Math.sin(a*29)*Math.sin(y/bands*Math.PI);rp.push(p.x,p.y,p.z);ru.push(x/sides,y/bands);}
  for(let y=0;y<bands;y++)for(let x=0;x<sides;x++){const k=y*(sides+1)+x;ri.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}
  add(root,'Irregular thick broken root rim',geo(rp,ru,ri),mat.lip);
  return root;
}
export const author:ItemModelAuthor={ids:['ibex_horn','aurochs_horn','ashback_claw','cinder_tusk','emberhorn','kiln_fang'],build(id:string):THREE.Group {if(!(id in shapes))throw new Error(`Unknown trophy-bones-b item: ${id}`);return build(id as Id);}};
