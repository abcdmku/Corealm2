import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type V = [number, number, number];
const TAU = Math.PI * 2;
const descriptions: Record<string, string> = {
  basic_wooden_wand: 'Plain brown wood from grip to socket, with no light or elemental charge.',
  basic_wooden_staff: 'A plain two-handed staff with an empty brown socket and no glow of its own.',
  palewood_wand: 'Pale wood with an empty socket at the tip. It stays unlit until upgraded.',
  palewood_staff: 'A pale two-handed shaft with an empty socket. The wood itself gives off no light.',
  duskoak_wand: 'Dark ash with an empty crown. Its polished wood remains unlit on its own.',
  duskoak_staff: 'Dark ash banded in Iron around an empty, unlit crown.',
};

function grain(pale: boolean, ash: boolean): THREE.DataTexture {
  const w=256,h=512,data=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const u=x/w,v=y/h;
    const wav=u*TAU + .13*Math.sin(v*15)+.055*Math.sin(v*41);
    let knot=0;
    for(const [ku,kv] of [[.22,.27],[.72,.68],[.4,.88]]) {
      const d=Math.hypot((u-ku!)*8,(v-kv!)*24);
      knot+=Math.exp(-d*d*2)*(-30+Math.sin(d*25)*14);
    }
    const stripe=Math.sin(wav*23+Math.sin(wav*7+v*12)*1.6);
    const fine=Math.sin(wav*101+v*13)*3 + Math.sin(wav*197+Math.sin(v*89))*2;
    const dark=Math.pow(.5+.5*stripe,9)*(pale?25:19);
    const n=fine-dark+knot;
    const base=pale?[223,186,129]:ash?[70,49,36]:[128,86,49];
    const i=(y*w+x)*4;
    for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,base[c]!+n));
    data[i+3]=255;
  }
  const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat);t.name='Longitudinal wood fibres and elliptical knots';
  t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
function mesh(root:THREE.Group,name:string,g:THREE.BufferGeometry,m:THREE.Material):THREE.Mesh {
  const o=new THREE.Mesh(g,m);o.name=name;o.castShadow=true;o.receiveShadow=true;root.add(o);return o;
}
// Closed swept solid. Custom radii and slightly lobed cross-sections preserve the carved branch form.
function sweep(root:THREE.Group,name:string,points:V[],radii:number[],m:THREE.Material,flatten=1,segments=80):void {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  const frames=curve.computeFrenetFrames(segments,false),pos:number[]=[],uv:number[]=[],ix:number[]=[];const sides=24;
  for(let j=0;j<=segments;j++) {
    const t=j/segments,q=curve.getPoint(t),ridx=t*(radii.length-1),i=Math.min(radii.length-2,Math.floor(ridx));
    const r=THREE.MathUtils.lerp(radii[i]!,radii[i+1]!,ridx-i);
    for(let k=0;k<=sides;k++) {
      const a=k/sides*TAU,rr=r*(1+.035*Math.sin(a*5+t*17)+.018*Math.sin(a*11-t*29));
      const v=q.clone().addScaledVector(frames.normals[j]!,Math.cos(a)*rr).addScaledVector(frames.binormals[j]!,Math.sin(a)*rr*flatten);
      pos.push(v.x,v.y,v.z);uv.push(k/sides,t);
      if(j<segments&&k<sides){const b=j*(sides+1)+k;ix.push(b,b+1,b+sides+1,b+1,b+sides+2,b+sides+1);}
    }
  }
  for(const end of [0,segments]){const q=curve.getPoint(end/segments),c=pos.length/3;pos.push(q.x,q.y,q.z);uv.push(.5,end/segments);for(let k=0;k<sides;k++){const a=end*(sides+1)+k;if(end===0)ix.push(c,a+1,a);else ix.push(c,a,a+1);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();mesh(root,name,g,m);
}
function bead(root:THREE.Group,name:string,y:number,r:number,t:number,m:THREE.Material):void {
  const o=mesh(root,name,new THREE.TorusGeometry(r,t,10,48),m);o.rotation.x=Math.PI/2;o.position.y=y;
}
function helix(root:THREE.Group,name:string,lo:number,hi:number,r:number,turns:number,t:number,m:THREE.Material,phase=0):void {
  const p:V[]=[];for(let i=0;i<=100;i++){const u=i/100,a=u*TAU*turns+phase;p.push([Math.cos(a)*r,lo+(hi-lo)*u,Math.sin(a)*r]);}
  sweep(root,name,p,[t,t],m,1,96);
}
function build(id:string):THREE.Group {
  if(!descriptions[id])throw new Error(`Unsupported wood magic item ${id}`);
  const staff=id.endsWith('_staff'),pale=id.startsWith('palewood'),ash=id.startsWith('duskoak');
  const basicStaff=id==='basic_wooden_staff';
  const root=new THREE.Group();root.name=id;
  const wood=new THREE.MeshStandardMaterial({name:pale?'Honey ivory pine with ochre fibres':ash?'Polished dark ash heartwood':'Worn warm brown wood',map:grain(pale,ash),roughness:ash?.37:pale?.49:.7});
  const trim=new THREE.MeshStandardMaterial({name:'Raised polished carved wood edges',map:wood.map,color:pale?'#fff0d4':ash?'#b7a292':'#e1c2a0',roughness:.43});
  const leather=new THREE.MeshStandardMaterial({name:pale?'Pale tan spiral grip binding':'Brown leather spiral grip binding',color:pale?'#ba8851':'#765034',roughness:.82});
  const iron=new THREE.MeshStandardMaterial({name:'Dark forged iron collars',color:'#525457',metalness:.86,roughness:.43});
  const ironEdge=new THREE.MeshStandardMaterial({name:'Worn iron rim and rivet heads',color:'#8b8c8e',metalness:.9,roughness:.34});
  const lo=staff?-.72:-.09,neck=staff?.92:.35,r=staff?.018:.011;
  const gripHalf=staff?(ash?.24:basicStaff?.185:.16):.065;
  if(staff) {
    sweep(root,'Long tapered wooden shaft',[[0,lo,0],[.003,-.42,.002],[0,0,0],[-.002,.5,-.002],[0,neck,0]],[.019,.018,.0185,.0165,.024],wood);
    if(ash){helix(root,'Deep spiral carved handhold',-gripHalf,gripHalf,.019,10,.0031,trim);}
    else if(basicStaff) {
      const edge=new THREE.MeshStandardMaterial({name:'Burnished raised leather overlap edges',color:'#aa7850',roughness:.66});
      sweep(root,'Long substantial brown leather handgrip',[[0,-gripHalf,0],[0,gripHalf,0]],[.024,.024],leather);
      // Broad, rounded overlapping strap lips cast an actual diagonal shadow on the underwrap.
      helix(root,'Raised spiral leather strap overlaps',-gripHalf+.007,gripHalf-.007,.025,9,.0038,edge);
      helix(root,'Inset shadow beside each leather overlap',-gripHalf+.003,gripHalf-.011,.0244,9,.0011,leather);
    } else {
      sweep(root,'Leather underwrap',[[0,-gripHalf,0],[0,gripHalf,0]],[.020,.020],leather);
      helix(root,'Overlapping diagonal grip seams',-gripHalf,gripHalf,.0204,8,.0019,pale?trim:leather);
    }
  } else {
    sweep(root,'Contoured solid wooden wand handle',[[0,lo,0],[pale?.004:0,-.05,0],[-.002,0,.001],[0,.058,0],[0,.082,0]], [.018,.014,.020,.012,.014],wood,1,64);
    sweep(root,'Tapered wand shaft',[[0,.071,0],[-.002,.12,0],[.002,.24,0],[0,neck,0]],[.014,.011,.008,.012],wood);
    if(ash)for(let k=0;k<4;k++)helix(root,`Raised handle fluting ${k+1}`,-.064,.059,.0165,.58,.0019,trim,k*TAU/4);
  }
  const band=(y:number,rad:number,width:number,metal:boolean)=>{
    if(metal){const o=mesh(root,'Iron collar sleeve',new THREE.CylinderGeometry(rad,rad,width,48),iron);o.position.y=y;
      for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const b=mesh(root,'Domed collar rivet',new THREE.SphereGeometry(width*.135,12,8),ironEdge);b.scale.set(1,1,.5);b.position.set(Math.sin(a)*(rad+.0009),y,Math.cos(a)*(rad+.0009));b.rotation.y=a;}}
    for(const dy of [-width/2,width/2])bead(root,metal?'Rolled iron collar lip':'Carved double wood bead',y+dy,rad,metal?.0012:.0022,metal?ironEdge:trim);
  };
  if(staff){band(lo+.023,.022,.024,ash);band(-gripHalf,basicStaff?.027:.022,.020,ash);band(gripHalf,basicStaff?.027:.022,.020,ash);if(pale||ash)band(neck-.025,.027,ash?.043:.016,ash);}
  else{band(-.071,.017,.010,false);band(.068,.015,.010,false);}
  if(!ash){const b=mesh(root,'Rounded wooden butt',new THREE.SphereGeometry(basicStaff?.030:staff?.021:.0185,32,20),wood);b.position.y=lo-(basicStaff?.012:0);b.scale.y=staff?1.2:.72;}
  // Splayed hollow crown: every tine has a full rear surface and converges into the shaft.
  const size=staff?(ash?.18:.14):(ash?.077:pale?.065:.050),spread=size*.32;
  const count=ash&&staff?4:2;
  for(let k=0;k<count;k++) {
    const side=k%2===0?-1:1,z=count===4?(k<2?.010:-.015):0;
    const top=neck+size*(side<0?1:.89)-(k>=2?.013:0);
    sweep(root,`Solid carved crown tine ${k+1}`,[[0,neck-.025,0],[side*spread*.63,neck+size*.28,z],[side*spread,neck+size*.64,z],[side*spread*.82,top,z]], [r*1.16,r*.94,r*.63,ash?.0009:.0035],wood,ash?.8:1,56);
  }
  // Pine and ash icons show a concave brown socket back. A thick open curved wall, never a gem.
  if(pale||ash){
    const pts:number[]=[],uv:number[]=[],ix:number[]=[];const rows=20,cols=24;
    for(let side=0;side<2;side++)for(let j=0;j<=rows;j++)for(let k=0;k<=cols;k++){
      const v=j/rows,u=k/cols,x=(u-.5)*spread*1.65*(.5+.5*v),y=neck+size*(.14+v*.66),z=-spread*.58+Math.pow((u-.5)*2,2)*spread*.42+side*.003;
      pts.push(x,y,z);uv.push(u,v);
      if(j<rows&&k<cols){const b=side*(rows+1)*(cols+1)+j*(cols+1)+k;if(side===0)ix.push(b,b+cols+1,b+1,b+1,b+cols+1,b+cols+2);else ix.push(b,b+1,b+cols+1,b+1,b+cols+2,b+cols+1);}
    }
    const n=(rows+1)*(cols+1);for(let j=0;j<rows;j++)for(const k of [0,cols]){const a=j*(cols+1)+k,b=a+cols+1;ix.push(a,b,a+n,b,b+n,a+n);}for(let k=0;k<cols;k++)for(const j of [0,rows]){const a=j*(cols+1)+k;ix.push(a,a+n,a+1,a+1,a+n,a+n+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();mesh(root,'Thick concave empty wooden socket back',g,wood);
  }
  if(ash&&!staff)for(const face of [-1,1])for(let k=0;k<2;k++){
    const base=.115+k*.10,pts:V[]=[];
    for(let j=0;j<=60;j++){const t=j/60,a=t*TAU*1.2,rr=.007*(1-t);pts.push([Math.cos(a)*rr,base+Math.sin(a)*rr,.009*face]);}
    sweep(root,'Carved curling vine scroll',pts,[.0013,.0005],trim,1,60);
    sweep(root,'Swept vine stem',[[-.008,base-.035,.008*face],[.005,base-.012,.009*face],[.007,base+.025,.008*face],[0,base+.065,.008*face]],[.0016,.001],trim,1,44);
  }
  root.userData.itemModel={itemId:id,author:'wood-magic-a',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id],grip:[0,0,0],focus:[0,neck+size*.60,0]};
  return root;
}
export const author:ItemModelAuthor={ids:Object.keys(descriptions),build};

