import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { ItemModelAuthor } from '../contracts';

const ids = ['grithe_bar','corven_bar','kaldite_bar','emberite_bar','cindersteel_bar','nightglass_bar','pale_quartz','vell_amber','cairn_garnet','fire_opal'] as const;
const descriptions: Record<string,string> = {
  grithe_bar:'One ore, one stone, one bar. The first thing anybody makes.',
  corven_bar:'Dark and dense. Rings a full tone lower than Copper on the anvil.',
  kaldite_bar:'Black with a blue sheen. Holds an edge through cairn stone, which is why Hillcrest exists.',
  emberite_bar:'Three ores and two flux stones a bar, and it comes off the furnace still glowing at the core.',
  cindersteel_bar:'Dense dark steel cast with a molten stone heart. Used for level 50 armour, weapons and tools.',
  nightglass_bar:'A solid bar of blue-black glass metal. Used for level 70 armour, weapons and tools.',
  pale_quartz:'A milky chip out of a Copper seam. Holds a charge just long enough to be useful.',
  vell_amber:'Fossil resin from under the deepwood. Warm in the hand and nobody knows why.',
  cairn_garnet:'Deep red, cut square by the rock itself. Hillcrest jewellers cage it in Cobalt.',
  fire_opal:'An orange stone with a live spark in it. Ashford cages them in Titanium claws.',
};
const v=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
function random(seed:number) { return ()=> {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}; }
function mesh(group:THREE.Group,name:string,geometry:THREE.BufferGeometry,material:THREE.Material) {
  geometry.name=name+' geometry'; const m=new THREE.Mesh(geometry,material);m.name=name;m.castShadow=true;m.receiveShadow=true;group.add(m);return m;
}
function texture(name:string,size:number,fn:(x:number,y:number)=>number[],color=false) {
  const bytes=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const c=fn(x,y); const i=(y*size+x)*4;for(let k=0;k<3;k++)bytes[i+k]=Math.max(0,Math.min(255,Math.round(c[k]!)));bytes[i+3]=255;}
  const t=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.needsUpdate=true;return t;
}
function finish(name:string,color:number,roughness:number,metalness:number,seed:number) {
  const rng=random(seed), n=128;
  const m=new THREE.MeshPhysicalMaterial({color,roughness,metalness});m.name=name;
  m.roughnessMap=texture(name+' uneven polish',n,(x,y)=>{const s=198+30*Math.sin(x*.13+Math.sin(y*.19))*Math.cos(y*.27)+rng()*20;return [s,s,s];});
  // Low amplitude tangent normals model fine tool chatter independently of albedo.
  m.normalMap=texture(name+' fine physical tool relief',n,(x,y)=>[128+4*Math.sin(x*.51+y*.11)+rng()*3,128+4*Math.sin(y*.57-x*.15)+rng()*3,255]);
  m.normalScale.set(.45,.45);return m;
}
function line(group:THREE.Group,name:string,points:THREE.Vector3[],radius:number,mat:THREE.Material) {
  return mesh(group,name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),points.length*5,radius,5,false),mat);
}

/** A cast ingot: tapered mould walls, rounded arrises, shallow individual dents on every face. */
function ingotGeometry(seed:number,rough:number,glass:boolean) {
  const g=new RoundedBoxGeometry(.144,.073,.315,10,glass?.0034:.0054);
  const p=g.getAttribute('position'),norm=g.getAttribute('normal');const rng=random(seed);
  const dents=Array.from({length:rough>.7?64:34},()=>({p:v((rng()-.5)*.145,(rng()-.5)*.074,(rng()-.5)*.318),r:.009+rng()*.017,d:(.0003+rng()*.0012)*rough}));
  for(let i=0;i<p.count;i++) {
    let x=p.getX(i),y=p.getY(i),z=p.getZ(i); const t=(y+.0365)/.073;
    x*=1-.15*t;z*=1-.045*t;
    let d=0;for(const dent of dents){const q=(x-dent.p.x)**2+(y-dent.p.y)**2+(z-dent.p.z)**2;d+=dent.d*Math.exp(-q/(dent.r*dent.r));}
    const wav=glass?.00035*Math.sin(z*44+x*68):.00012*Math.sin(z*235+x*167+y*183);
    p.setXYZ(i,x-norm.getX(i)*d,y-norm.getY(i)*d+wav,z-norm.getZ(i)*d);
  }
  g.computeVertexNormals();return g;
}
function bar(group:THREE.Group,id:string) {
  const index=ids.indexOf(id as typeof ids[number]);
  const colors=[0xb65e32,0x55565a,0x263a58,0xa6a6a1,0x343130,0x081630];
  const rough=[.56,.64,.46,.38,.65,.16][index]!;
  const glass=id==='nightglass_bar';
  const m=finish(id+' cast metal',colors[index]!,rough,glass?.82:.94,197+index*31);
  if(glass){m.clearcoat=1;m.clearcoatRoughness=.1;m.normalScale.set(.16,.16);m.map=texture('Nightglass blue mineral flow',256,(x,y)=>{const a=Math.pow((Math.sin(x*.043+Math.sin(y*.038)*3)+1)/2,5);return [80+a*55,100+a*60,155+a*80];},true);}
  mesh(group,'Tapered solid ingot with worn mould arrises',ingotGeometry(711+index*41,id==='cindersteel_bar'?1.7:glass?.2:1,glass),m);
  if(id==='kaldite_bar'||id==='cindersteel_bar'){
    // Overlapping broad hammer depressions in the two end faces. Actual concave surfaces.
    const rng=random(66+index);const hammer=finish('Hammered end grain',colors[index]!,.51,.9,31);
    for(const sign of [-1,1])for(let row=0;row<4;row++)for(let col=0;col<6;col++){
      const x=(col-2.5)*.019+(row%2)*.007,y=(row-1.5)*.016;
      if(Math.abs(x)>.061)continue;
      const r=.0085+rng()*.002;
      const pos:number[]=[],uv:number[]=[],idx:number[]=[];
      const z=sign*(.1575*(1-.045*(y+.0365)/.073)+.00015);
      pos.push(x,y,z-sign*.0013);uv.push(.5,.5);
      for(let j=0;j<=9;j++){const a=j/9*Math.PI*2;pos.push(x+Math.cos(a)*r,y+Math.sin(a)*r*.84,z);uv.push(.5+Math.cos(a)*.5,.5+Math.sin(a)*.5);}
      for(let j=1;j<=9;j++)idx.push(...(sign>0?[0,j,j+1]:[0,j+1,j]));
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();mesh(group,`End ${sign} hammer hollow ${row}-${col}`,geo,hammer);
    }
  }
  if(id==='emberite_bar'||id==='cindersteel_bar'){
    const cinder=id==='cindersteel_bar';
    const dark=finish('Oxidized split walls',0x201712,.86,.35,33);
    const hot=new THREE.MeshStandardMaterial({color:0xe66c08,emissive:0xff4200,emissiveIntensity:1.6,roughness:.66,metalness:.2});hot.name='Molten material exposed in fracture';
    const ys=[-.032,-.021,-.008,.002,.015,.032];
    const xs=cinder?[-.019,-.023,-.016,-.013,-.018,-.006]:[.036,.023,.021,.008,.002,-.013];
    const points=ys.map((y,i)=>v(xs[i]!,y,.1575*(1-.045*(y+.0365)/.073)+.0004));
    line(group,'Jagged cooled fracture rim',points,cinder?.0028:.0018,dark);
    line(group,'Narrow orange core visible in split',points.map(p=>p.clone().add(v(0,0,.0011))),cinder?.0012:.00075,hot);
    line(group,'Split continuing onto casting top',[v(xs[5]!, .0365,.1505),v(xs[5]!+.003,.0365,.137),v(xs[5]!+.017,.0365,.12)],.00065,dark);
  }
}
function hull(points:number[][]) { const g=new ConvexGeometry(points.map(p=>v(p[0]!,p[1]!,p[2]!))); const p=g.getAttribute('position'),uv:number[]=[];for(let i=0;i<p.count;i++)uv.push(p.getX(i)*11+.5,p.getY(i)*11+.5);g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return g; }
function nugget(seed:number,scale:THREE.Vector3,detail=2) {
  const g=new THREE.IcosahedronGeometry(1,detail),p=g.getAttribute('position');
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const d=1+.075*Math.sin(x*7+y*5+seed)+.05*Math.sin(z*11-x*4);p.setXYZ(i,x*scale.x*d,y*scale.y*d,z*scale.z*d);}
  g.computeVertexNormals();const uv:number[]=[];for(let i=0;i<p.count;i++)uv.push(p.getX(i)*12+.5,p.getY(i)*12+.5);g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return g;
}
function quartz(group:THREE.Group) {
  const milky=finish('Milky fractured quartz',0xeee8d9,.26,.02,811);milky.transmission=.15;milky.ior=1.54;milky.thickness=.035;milky.clearcoat=.55;
  const clear=milky.clone();clear.name='Clear quartz cleavage edges';clear.color.setHex(0xdce6e9);clear.transmission=.38;clear.roughness=.17;
  const host=finish('Copper stained quartz host rock',0x77634e,.92,.13,94);
  mesh(group,'Irregular copper seam matrix on back',nugget(2,v(.043,.049,.022)),host).position.set(-.011,-.026,-.013);
  mesh(group,'Large asymmetrical milky cleavage',hull([[-.032,-.04,.012],[.017,-.06,.017],[.043,-.039,.022],[.039,.005,.025],[.019,.032,.018],[-.008,.081,.004],[-.034,.039,.017],[-.043,.001,.014],[-.032,-.033,-.02],[.018,-.047,-.026],[.035,.003,-.008],[-.006,.068,-.014],[-.03,.027,-.022],[.003,.021,.037]]),milky);
  const rng=random(421);
  for(let i=0;i<9;i++){
    const x=.023+(rng()-.5)*.027,y=-.041+i*.010;
    const shard=mesh(group,'Stepped translucent cleavage '+i,hull([[-.01,-.014,0],[.008,-.01,0],[.012,.002,.004],[0,.022,-.002],[-.009,.007,.009],[-.007,-.006,-.013],[.006,.004,-.008]]),clear);shard.position.set(x,y,.024);shard.rotation.z=-.55+rng()*.3;
  }
  const copper=finish('Copper flecks in quartz matrix',0xb36d36,.55,.8,53);
  for(let i=0;i<14;i++){const m=mesh(group,'Native copper matrix fleck '+i,nugget(i,v(.003+rng()*.003,.003+rng()*.004,.002),0),copper);m.position.set(-.045+rng()*.047,-.02-rng()*.042,.002+rng()*.016);}
}
function resinShape(opal:boolean) {
  const g=new THREE.SphereGeometry(1,64,40),p=g.getAttribute('position');
  for(let i=0;i<p.count;i++) {const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const d=opal?1+.025*Math.sin(y*4+x*3):1+.07*Math.sin(x*5+y*3)+.05*Math.sin(y*6-z*4); const taper=opal?1-.17*y:1-.11*y+.05*Math.sin(y*5);p.setXYZ(i,x*.047*d*taper,y*.059*d,z*(opal?.029:.022)*d);}
  g.computeVertexNormals();return g;
}
function amber(group:THREE.Group) {
  const resin=finish('Polished fossil honey resin',0xffae28,.15,0,31);resin.transmission=.68;resin.ior=1.54;resin.thickness=.038;resin.attenuationColor.setHex(0xb74406);resin.attenuationDistance=.065;resin.clearcoat=1;resin.clearcoatRoughness=.09;resin.normalScale.set(.07,.07);
  mesh(group,'Irregular translucent amber body',resinShape(false),resin).rotation.z=.23;
  const crust=finish('Weathered amber rind',0x75451e,.84,.03,61),rng=random(714);
  for(let i=0;i<19;i++){const a=-1.4+i*.145;const m=mesh(group,'Rough amber rind '+i,nugget(i,v(.006,.009,.006),1),crust);m.position.set(Math.cos(a)*.041,Math.sin(a)*.052,-.004);}
  const bubble=new THREE.MeshPhysicalMaterial({color:0xeabd66,roughness:.05,transmission:.92,ior:1.05,metalness:0});bubble.name='Air trapped inside resin';
  const debris=finish('Ancient bark inclusions',0x392413,.85,0,51);
  for(let i=0;i<30;i++){const x=(rng()-.5)*.062,y=(rng()-.5)*.082,z=.004+rng()*.009;const r=.0007+rng()*.0023;mesh(group,'Trapped air bubble '+i,new THREE.SphereGeometry(r,10,8),bubble).position.set(x,y,z);}
  for(let i=0;i<16;i++){const m=mesh(group,'Fossil bark inclusion '+i,nugget(i,v(.0015,.0021,.0006),0),debris);m.position.set((rng()-.5)*.06,(rng()-.5)*.078,.006+rng()*.008);m.rotation.z=rng()*6;}
}
function garnet(group:THREE.Group) {
  const m=finish('Deep wine garnet cleavage',0x660917,.24,.04,713);m.transmission=.28;m.ior=1.79;m.thickness=.055;m.attenuationColor.setHex(0x790518);m.attenuationDistance=.04;m.clearcoat=.7;
  m.map=texture('Red mineral growth and fracture grain',256,(x,y)=>{const s=.7+.24*Math.sin(x*.08+Math.sin(y*.11))*Math.sin(y*.069);return [255*s,170*s,170*s];},true);
  const points:number[][]=[];
  // Unequal bevel widths preserve broad square natural crystal faces.
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
    points.push([sx*.04,sy*.033,sz*.027],[sx*.030,sy*.042,sz*.028],[sx*.031,sy*.034,sz*.037]);
  }
  const core=mesh(group,'Solid square garnet with natural clipped corners',hull(points),m);core.rotation.set(.08,.1,-.16);
  const rind=finish('Crushed red crystal fracture rind',0x50151a,.58,.05,91),rng=random(412);
  for(let i=0;i<38;i++){
    const a=i/38*Math.PI*2;const x=Math.cos(a),y=Math.sin(a),d=Math.max(Math.abs(x),Math.abs(y));
    const chip=mesh(group,'Broken crystal edge '+i,nugget(i,v(.003+rng()*.003,.003+rng()*.003,.0025),0),rind);chip.position.set(x/d*.035,y/d*.036,.030);chip.rotation.z=rng()*6;
  }
  const fissure=finish('Garnet hairline mineral fissures',0x32060b,.47,0,52);
  for(let i=0;i<7;i++){const y=-.025+i*.008;line(group,'Natural face hairline '+i,[v(-.024,y,.0374),v(-.01,y+.003,.0376),v(.003,y-.002,.0377),v(.022,y+.006,.0374)],.00012,fissure);}
}
function opal(group:THREE.Group) {
  const m=finish('Orange fire opal polished skin',0xffffff,.12,0,751);m.ior=1.46;m.transmission=.18;m.thickness=.04;m.clearcoat=1;m.clearcoatRoughness=.075;m.normalScale.set(.045,.045);
  const rng=random(831);const cells=Array.from({length:38},()=>({x:rng()*256,y:rng()*256,c:rng()}));
  const pattern=(x:number,y:number)=>{let d1=1e9,d2=1e9,c=0;for(const cell of cells){const dx=Math.min(Math.abs(x-cell.x),256-Math.abs(x-cell.x)),dy=Math.min(Math.abs(y-cell.y),256-Math.abs(y-cell.y));const d=dx*dx+dy*dy;if(d<d1){d2=d1;d1=d;c=cell.c;}else if(d<d2)d2=d;}const edge=Math.exp(-(Math.sqrt(d2)-Math.sqrt(d1))*1.3);const cloud=(Math.sin(x*.046+Math.sin(y*.08))+1)/2;return {edge,c,cloud};};
  m.map=texture('Orange opal cellular mineral fire',256,(x,y)=>{const {edge,c,cloud}=pattern(x,y);return [210+edge*45+cloud*32,55+c*55+edge*104+cloud*28,5+cloud*15];},true);
  m.emissive.setHex(0xff8a16);m.emissiveIntensity=.28;m.emissiveMap=texture('Fire opal subsurface spark network',256,(x,y)=>{const {edge,c}=pattern(x,y);return [80+edge*170,22+edge*160,c>.94?55:8];},true);
  const stone=mesh(group,'Solid polished asymmetric oval fire opal',resinShape(true),m);stone.rotation.z=.25;
}
export const author: ItemModelAuthor = {
  ids,
  build(id:string) {
    if(!ids.includes(id as typeof ids[number]))throw new Error('bars-gems does not own '+id);
    const group=new THREE.Group();group.name=id;
    group.userData.itemModel={itemId:id,author:'bars-gems',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]!};
    if(id.endsWith('_bar'))bar(group,id);else if(id==='pale_quartz')quartz(group);else if(id==='vell_amber')amber(group);else if(id==='cairn_garnet')garnet(group);else opal(group);
    return group;
  },
};
