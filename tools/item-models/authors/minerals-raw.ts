import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const ids = ['marks','grithe_ore','march_stone','corven_ore','kaldite_ore','emberite_ore','kilnstone','cindervein_ore','nightglass_ore'] as const;
const descriptions: Record<string,string> = {
  marks:'Stamped Trade Company scrip. Every settlement between here and the moor takes it.',
  grithe_ore:'Grey ore, streaked rust-red. Smelts easily, which is the only nice thing about it.',
  march_stone:'Crumbly limestone from the Copper Pit. Every furnace on the frontier runs on it as flux.',
  corven_ore:'Dark deepwood ore. Heavier than it looks and slightly oily on the break.',
  kaldite_ore:'Black Highlands ore with a blue fracture. It takes a furnace twice to give anything up.',
  emberite_ore:'Rust-orange Ashlands ore, warm off the seam. It smells faintly of a banked fire.',
  kilnstone:'Grey-black flux off the Quarry Seams. Titanium refuses to run without it.',
  cindervein_ore:'Black ore shot through with copper-red seams. Smelt three with a Molten Heart into Cindersteel.',
  nightglass_ore:'Violet ore with a blue fracture. Smelt three with an Astral Core into a Nightglass Bar.',
};
const h=(n:number)=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
function surface(name:string,color:number,metalness:number,roughness:number,grain=1):THREE.MeshStandardMaterial {
  const c=new THREE.Color(color), n=256, a=new Uint8Array(n*n*4), r=new Uint8Array(n*n*4), normal=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const i=(y*n+x)*4, fleck=h(x+y*n), broad=Math.sin(x*.15+Math.sin(y*.07)*3)*Math.sin(y*.11), stria=Math.sin(x*.75+y*.36);
    const f=.84+fleck*.25+broad*.09+stria*.035;
    a[i]=Math.min(255,c.r*255*f);a[i+1]=Math.min(255,c.g*255*f);a[i+2]=Math.min(255,c.b*255*f);a[i+3]=255;
    r[i]=r[i+1]=r[i+2]=Math.max(0,Math.min(255,(roughness+(fleck-.5)*.14)*255));r[i+3]=255;
    normal[i]=128+Math.round(grain*(7*Math.cos(x*.25+y*.13)+4*Math.sin(x*.91)));
    normal[i+1]=128+Math.round(grain*(7*Math.sin(y*.29+x*.11)+4*Math.cos(y*.77)));normal[i+2]=254;normal[i+3]=255;
  }
  function tex(data:Uint8Array,label:string){const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.name=name+' '+label;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
  const map=tex(a,'mineral grains'); // Linear bytes preserve the chosen physical base color.
  const m=new THREE.MeshStandardMaterial({map,roughnessMap:tex(r,'independent roughness'),roughness:1,normalMap:tex(normal,'fine physical fracture normal'),metalness});m.name=name;return m;
}
function add(root:THREE.Group,name:string,g:THREE.BufferGeometry,m:THREE.Material){const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;}
function poly(root:THREE.Group,name:string,points:THREE.Vector3[],depth:number,m:THREE.Material,up=false){
  const center=new THREE.Vector3();points.forEach(p=>center.add(p));center.divideScalar(points.length);const normal=new THREE.Vector3().subVectors(points[1]!,points[0]!).cross(new THREE.Vector3().subVectors(points[2]!,points[0]!)).normalize();
  if(up ? normal.y<0 : normal.dot(center)<0){normal.negate();points=[...points].reverse();}const positions:number[]=[],uv:number[]=[];
  function tri(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3){positions.push(...a.toArray(),...b.toArray(),...c.toArray());for(const p of [a,b,c])uv.push(p.x*17+p.z*9,p.y*17+p.z*7);}
  const inner=points.map(p=>p.clone().addScaledVector(normal,-depth));
  const crown=center.clone().addScaledVector(normal,depth*.07);
  for(let i=0;i<points.length;i++){const j=(i+1)%points.length;tri(crown,points[i]!,points[j]!);tri(points[i]!,inner[i]!,inner[j]!);tri(points[i]!,inner[j]!,points[j]!);tri(center.clone().addScaledVector(normal,-depth),inner[j]!,inner[i]!);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();
  return add(root,name,g,m);
}
function mineral(root:THREE.Group,id:string){
  const night=id==='nightglass_ore', cobalt=id==='kaldite_ore', copper=id==='grithe_ore', cinder=id==='cindervein_ore', ember=id==='emberite_ore';
  const seed=ids.indexOf(id as typeof ids[number])*19;
  const stone=surface(night?'Violet black vitreous crust':ember?'Rust orange iron oxide crust':copper?'Grey copper bearing host':'Dark fractured host rock',night?0x30203f:ember?0xa83509:copper?0x64625e:0x303136,night?.46:ember?.22:.39,night?.27:ember?.83:.64,ember?1.7:1);
  const vein=surface(night?'Blue glass fracture':cobalt?'Cobalt blue mineral band':copper||cinder?'Copper red native mineral':'Fresh silvery cleavage',night?0x064ee5:cobalt?0x073bbe:copper||cinder?0xbe531e:0x606873,night?.5:.74,night?.17:.34,.7);
  const dark=surface('Deep mineral clefts',0x17171a,.25,.8);
  const size=new THREE.Vector3(.13,night?.16:.135,.10);
  // Six irregular gridded faces form a clipped boulder. The front and rear use
  // the same geological band, with independent breaks rather than a flat back.
  function point(face:number,u:number,v:number):THREE.Vector3{
    const p=face===0?new THREE.Vector3(u,v,1):face===1?new THREE.Vector3(-u,v,-1):face===2?new THREE.Vector3(1,v,-u):face===3?new THREE.Vector3(-1,v,u):face===4?new THREE.Vector3(u,1,-v):new THREE.Vector3(u,-1,v);
    const length=Math.pow(Math.pow(Math.abs(p.x),5)+Math.pow(Math.abs(p.y),5)+Math.pow(Math.abs(p.z),5),.2);p.divideScalar(length);
    const f=1+.055*Math.sin(p.x*7+p.y*4+seed)+.045*Math.cos(p.z*7-p.y*6)+.028*Math.sin(p.x*13+p.z*9);p.multiplyScalar(f);p.x+=p.y*.13;p.y+=.065*p.z;return p.multiply(size);
  }
  for(let f=0;f<6;f++){
    const corners=[point(f,-1,-1),point(f,1,-1),point(f,1,1),point(f,-1,1)];poly(root,'Continuous buried ore mass '+f,corners,.10, copper||cinder||cobalt||night?vein:dark);
    for(let row=0;row<4;row++)for(let col=0;col<4;col++){
      const k=f*37+row*7+col+seed, gap=copper?.055:cinder?.065:.025;
      const u=-1+col*.5, v=-1+row*.5;
      const pairs:[[number,number],[number,number],[number,number],[number,number],[number,number],[number,number]]=[[u+gap,v+.06],[u+.38,v+gap],[u+.5-gap,v+.14],[u+.46,v+.48-gap],[u+.09,v+.5-gap],[u+gap,v+.34]];
      const points=pairs.map(([a,b],i)=>point(f,a+(h(k*5+i)-.5)*.06,b+(h(k*7+i)-.5)*.06));
      const center=point(f,u+.25,v+.25), band=night?center.y-.78*center.x+.005:center.y+.63*center.x-.025;
      const exposed=(night||cobalt)?Math.abs(band)<(night?.029:.032):ember?(f===0&&col>=2&&row>0):false;
      const mat=exposed?vein:stone;
      const lift=exposed?.0008:.007+(h(k)*.009);points.forEach(p=>p.multiplyScalar(1+lift/.12));
      poly(root,(exposed?'Broad exposed mineral cleavage ':'Angular host crust ')+f+' '+row+' '+col,points,.035,mat);
    }
  }
}
function layered(root:THREE.Group,id:string){
  const lime=id==='march_stone', main=surface(lime?'Porous ivory limestone':'Grey black kilnstone laminae',lime?0xd7ccb7:0x46484b,.03,lime?.95:.83,1.4), seam=surface(lime?'Weathered sediment bedding':'Coal dark fracture pocket',lime?0x9f947f:0x151719,.05,.97);
  // Unequal sediment slabs with chipped polygonal edges, solid all the way through.
  const count=lime?9:6, ring=20;
  for(let layer=0;layer<count;layer++){
    const y=-.12+layer*.24/count, radius=1-.15*Math.abs(layer-count*.48)/(count*.5);
    const points:THREE.Vector3[]=[];
    for(let i=0;i<ring;i++){const a=i*Math.PI*2/ring, r=radius*(1+.065*Math.sin(i*2.7+layer*.6)+.04*h(i+layer*41));const x=Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.55)*.13*r,z=Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.55)*.105*r;points.push(new THREE.Vector3(x,y+.24/count+.018*x/.13,z));}
    poly(root,'Broken sediment bed '+layer,points,.24/count+.002,main,true);
    const edge=points.map(p=>new THREE.Vector3(p.x*.99,p.y-.24/count-.001,p.z*.99));poly(root,'Recessed bedding seam '+layer,edge,.004,seam,true);
  }
  if(!lime)for(let i=0;i<21;i++){const g=new THREE.DodecahedronGeometry(.011+ h(i)*.005,0);const m=add(root,'Crumbly coal in opened seam '+i,g,seam);m.position.set(-.07+h(i*3)*.08,-.063+h(i*7)*.035,.098);m.rotation.set(i*.7,i*.4,i);m.scale.set(1,.7,.6);}
}
function coin(root:THREE.Group){
  const gold=surface('Worn golden Trade Company stamp',0xb58a36,.78,.48,.7), recess=surface('Tarnish inside deep die impressions',0x493c22,.59,.7);
  const outline=new THREE.Shape();for(let i=0;i<=128;i++){const a=i*Math.PI*2/128,r=.038*(1-.008*h(i%128)-.02*(i%23===0?1:0));const x=Math.cos(a)*r,y=Math.sin(a)*r;if(i===0)outline.moveTo(x,y);else outline.lineTo(x,y);}
  const edge=add(root,'Solid chipped coin blank',new THREE.ExtrudeGeometry(outline,{depth:.004,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.00055,bevelThickness:.0004,curveSegments:64}),gold);edge.position.z=-.002;
  for(const side of [-1,1]){
    const face=new THREE.Group();face.name=side===1?'Recessed front stamp':'Matching worn reverse stamp';face.rotation.y=side===1?0:Math.PI;root.add(face);
    const disk=new THREE.Shape();disk.absarc(0,0,.0318,0,Math.PI*2,false);
    for(let i=0;i<4;i++){const a=i*Math.PI/2, points=[[0,.0265],[-.0065,.0135],[.0065,.0135]];const hole=new THREE.Path();points.forEach(([x=0,y=0],j)=>{const xx=x*Math.cos(a)-y*Math.sin(a),yy=x*Math.sin(a)+y*Math.cos(a);if(j===0)hole.moveTo(xx,yy);else hole.lineTo(xx,yy);});hole.closePath();disk.holes.push(hole);}
    const diamond=new THREE.Path();diamond.moveTo(0,.012);diamond.lineTo(.011,0);diamond.lineTo(0,-.012);diamond.lineTo(-.011,0);diamond.closePath();disk.holes.push(diamond);
    const inset=add(face,'Dark bottom of stamped recesses',new THREE.CylinderGeometry(.033,.033,.0005,96),recess);inset.rotation.x=Math.PI/2;inset.position.z=.0026;
    const top=add(face,'Die cut face with four triangular impressions',new THREE.ExtrudeGeometry(disk,{depth:.0007,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.0003,bevelThickness:.0002,curveSegments:96}),gold);top.position.z=.0028;
    const gem=new THREE.Shape();gem.moveTo(0,.009);gem.lineTo(.0083,0);gem.lineTo(0,-.009);gem.lineTo(-.0083,0);gem.closePath();const center=add(face,'Raised central diamond inside recessed diamond',new THREE.ExtrudeGeometry(gem,{depth:.0006,bevelEnabled:true,bevelSize:.00025,bevelThickness:.0002,bevelSegments:1}),gold);center.position.z=.0029;
    const rim=add(face,'Rounded worn perimeter lip',new THREE.TorusGeometry(.036,.0011,8,128),gold);rim.position.z=.0026;
  }
}
export const author:ItemModelAuthor={ids,build(id){if(!ids.includes(id as typeof ids[number]))throw new Error('Unknown raw mineral '+id);const root=new THREE.Group();root.name=id;root.userData.itemModel={itemId:id,author:'minerals-raw',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]!};if(id==='marks')coin(root);else if(id==='march_stone'||id==='kilnstone')layered(root,id);else mineral(root,id);return root;}};
