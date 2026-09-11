import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Element = 'air' | 'earth' | 'water' | 'fire';
const v = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
const tau = Math.PI*2;
const palettes = {
  air: { wood:'#efd0a0', leather:'#79523c', metal:'#969b9d', trim:'#c8cdd0', glass:'#3887a7', current:'#ecfaff' },
  earth: { wood:'#a6947b', leather:'#664d3c', metal:'#a17d48', trim:'#ceb578', glass:'#365721', current:'#9bd842' },
  water: { wood:'#d69a53', leather:'#294e87', metal:'#b8c2ca', trim:'#e3e8ec', glass:'#073b99', current:'#51e9ff' },
  fire: { wood:'#876244', leather:'#963d2e', metal:'#b98045', trim:'#eabc77', glass:'#a61106', current:'#ffb827' },
} as const;

function texture(kind:'wood'|'leather'|'mineral'|'current',element:Element):THREE.DataTexture {
  const n=512, data=new Uint8Array(n*n*4);
  const colors = kind==='current' ? [new THREE.Color(palettes[element].glass),new THREE.Color(palettes[element].current)] : kind==='mineral' ? [new THREE.Color('#583b25'),new THREE.Color('#caad78')] : [new THREE.Color('#594a37'),new THREE.Color('#fff4d8')];
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const u=x/n,t=y/n;
    const noise=(Math.sin(x*127.1+y*311.7)*43758.5453)%1;
    let f=.5;
    if(kind==='wood') f=element==='earth'?.66+.16*Math.sin(t*167+Math.sin(u*13)*2)+.1*Math.sin(t*493+Math.sin(u*24)*5)+noise*.04:.82+.06*Math.sin(t*330+Math.sin(u*13)*3)+.055*Math.sin(t*880+Math.sin(u*24)*5)+noise*.025;
    if(kind==='leather') f=.77+noise*.12+.045*Math.sin(x*1.9)*Math.sin(y*2.7);
    if(kind==='mineral') f=.55+noise*.28+.12*Math.sin(x*.72+y*.67)*Math.cos(y*.86-x*.36);
    if(kind==='current') { const a=u*tau, b=t*Math.PI; const warp=Math.sin(a*3+b*5)*1.8+Math.sin(a*7-b*9)*.55;const cloud=Math.sin(b*21+a*2+warp)+.5*Math.sin(b*57+a*9+warp*3)+.24*Math.sin(b*131-a*17+warp*7)+.12*Math.sin(b*267+a*31);f=THREE.MathUtils.clamp(.35+cloud*.3,0,1);if(element==='fire')f=Math.pow(f,1.6); }
    const c=colors[0]!.clone().lerp(colors[1]!,THREE.MathUtils.clamp(f,0,1)); c.convertLinearToSRGB();
    const i=(y*n+x)*4; data[i]=c.r*255;data[i+1]=c.g*255;data[i+2]=c.b*255;data[i+3]=255;
  }
  const out=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);out.name=`${element} ${kind} fine color`;out.colorSpace=THREE.SRGBColorSpace;out.wrapS=out.wrapT=THREE.RepeatWrapping;out.magFilter=THREE.LinearFilter;out.minFilter=THREE.LinearMipmapLinearFilter;out.generateMipmaps=true;out.needsUpdate=true;return out;
}
function mat(name:string,color:string,roughness:number,metalness=0,map?:THREE.Texture) { const m=new THREE.MeshStandardMaterial({color,roughness,metalness,...(map?{map}:{})});m.name=name;return m; }
function add(g:THREE.Group,name:string,geo:THREE.BufferGeometry,m:THREE.Material,p= v(0,0,0)) { const mesh=new THREE.Mesh(geo,m);mesh.name=name;mesh.position.copy(p);g.add(mesh);return mesh; }
function tube(g:THREE.Group,name:string,pts:THREE.Vector3[],r:number,m:THREE.Material,taper=false) {
  const curve=new THREE.CatmullRomCurve3(pts);const steps=48,sides=name.includes('ash')||name.startsWith('earth solid')?7:10;
  const geo=new THREE.TubeGeometry(curve,steps,r,sides,false);
  if(taper) {const pos=geo.attributes.position!;for(let i=0;i<=steps;i++){const c=curve.getPointAt(i/steps);const scale=Math.max(.025,Math.pow(1-i/steps,.65));for(let j=0;j<=sides;j++){const k=i*(sides+1)+j;const p=v(pos.getX(k),pos.getY(k),pos.getZ(k)).sub(c).multiplyScalar(scale).add(c);pos.setXYZ(k,p.x,p.y,p.z);}}geo.computeVertexNormals();}
  return add(g,name,geo,m);
}
function band(g:THREE.Group,name:string,y:number,r:number,h:number,m:THREE.Material) {return add(g,name,new THREE.CylinderGeometry(r,r,h,40,1),m,v(0,y,0));}
function spiral(g:THREE.Group,name:string,y0:number,y1:number,r:number,turns:number,m:THREE.Material,width:number,phase=0) {const pts=Array.from({length:100},(_,i)=>{const t=i/99,a=phase+t*tau*turns;return v(Math.sin(a)*r,y0+(y1-y0)*t,Math.cos(a)*r);});tube(g,name,pts,width,m);}

function orb(g:THREE.Group,e:Element,c:THREE.Vector3,r:number,loose:boolean) {
  const p=palettes[e];const flowing=texture(e==='earth'?'mineral':'current',e);
  // A dense scattering interior preserves elemental color in daylight. The clear skin
  // supplies refraction and polish; it does not erase the enclosed material.
  const core=new THREE.MeshPhysicalMaterial({color:'#ffffff',roughness:.23,map:flowing,clearcoat:.75,clearcoatRoughness:.13});core.name=`${e} dense patterned elemental interior`;
  core.emissive=new THREE.Color('#ffffff');core.emissiveMap=flowing;core.emissiveIntensity=e==='fire'?.8:e==='earth'?.25:.38;
  if(e!=='earth') add(g,`${e} deep colored volume`,new THREE.SphereGeometry(r*.89,64,40),core,c);
  const shell=new THREE.MeshPhysicalMaterial({color:'#ffffff',roughness:.06,transmission:.93,thickness:r*.04,ior:1.33,clearcoat:1,clearcoatRoughness:.04});shell.name=`${e} thin polished glass skin`;
  if(e==='earth')shell.color.set('#bcdfa0');
  add(g,`${e} spherical glass envelope`,new THREE.SphereGeometry(r,64,40),shell,c);
  const current=mat(`${e} sculpted elemental flow`,e==='earth'?'#b7ed55':e==='air'?'#d4eff7':e==='water'?'#55c9e7':'#ffb227',.27,.05,e==='earth'?undefined:flowing);
  current.emissive=new THREE.Color(e==='earth'?'#72cf19':p.current);current.emissiveIntensity=e==='fire'?.65:e==='earth'?.5:.2;
  const internal=new THREE.Group();internal.name=`${e} enclosed sculpted contents`;internal.position.copy(c);g.add(internal);
  if(e==='earth') {
    const rock=mat('Earth brown weathered mineral rock','#dfba79',.86,.03,texture('mineral',e));rock.emissive=new THREE.Color('#70502b');rock.emissiveIntensity=.28;
    // Twenty broad solid rock wedges share an irregular central mass. Narrow
    // gaps expose the green interior as connected branching fractures.
    const stoneSeed=new THREE.IcosahedronGeometry(r*.86,0), pa=stoneSeed.attributes.position!;
    const green=add(internal,'Earth luminous mineral within connected fractures',new THREE.IcosahedronGeometry(r*.70,2),current);green.scale.set(1,.97,1);
    for(let i=0;i<pa.count;i+=3){
      const corners=[0,1,2].map(k=>v(pa.getX(i+k),pa.getY(i+k),pa.getZ(i+k)));
      const center=corners[0]!.clone().add(corners[1]!).add(corners[2]!).multiplyScalar(1/3);
      const shift=center.clone().normalize().multiplyScalar(r*(.012+.027*Math.sin(i*4.7)));
      const outer=corners.map(q=>q.clone().lerp(center,.043).add(shift));
      const ridge=center.clone().add(shift).multiplyScalar(1.09+(i%4)*.018);
      const verts: number[]=[], cols:number[]=[],uv:number[]=[];
      const tri=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>{for(const q of [a,b,c]){verts.push(q.x,q.y,q.z);uv.push((q.x+q.z*.36)/r*.5+.5,q.y/r*.5+.5);const shade=.83+.12*Math.sin(q.x/r*36+q.y/r*42+q.z/r*13);cols.push(shade,shade,shade);}};
      for(let k=0;k<3;k++){tri(outer[k]!,outer[(k+1)%3]!,ridge);tri(outer[(k+1)%3]!,outer[k]!,v(0,0,0));}
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
      add(internal,`Earth substantial fractured brown lobe ${i/3}`,geo,rock);
    }
    rock.vertexColors=true;
    stoneSeed.dispose();
    // A few chips remain close to the large central mass, below the glass skin.
    for(let i=0;i<7;i++){const a=i*2.399,y=(i/6-.5)*1.25,rr=Math.sqrt(1-y*y);const m=add(internal,`Earth suspended mineral chip ${i}`,new THREE.DodecahedronGeometry(r*.07,0),rock,v(Math.cos(a)*rr*r*.88,y*r*.88,Math.sin(a)*rr*r*.88));m.rotation.set(i,i*.7,i*.3);}
  } else {
    // Thick, uneven curled lobes occupy the outer depth of the sphere. Each follows
    // a spherical path, so the effect has volume from the back and sides as well.
    for(let j=0;j<(e==='air'?9:12);j++){
      const pts=Array.from({length:80},(_,i)=>{const t=i/79;const y=(t-.5)*1.55;const latitude=Math.asin(y);const angle=t*tau*(e==='air'?1.3:.75)+j*2.399+Math.sin(t*11+j)*.08;const radius=r*(.88+.025*Math.sin(t*19+j));return v(Math.cos(angle)*Math.cos(latitude)*radius,Math.sin(latitude)*radius,Math.sin(angle)*Math.cos(latitude)*radius);});
      const lobe=tube(internal,`${e} broad turbulent ${e==='fire'?'flame tongue':e==='water'?'wave crest':'cloud curl'} ${j}`,pts,r*(e==='air'?.065:.059),current,true);
      if(e!=='air')lobe.rotation.z=(j%3-1)*.65;
    }
    if(e==='water')for(let i=0;i<42;i++){const a=i*2.39,yy=1-2*(i+.5)/42,rr=Math.sqrt(1-yy*yy);add(internal,`Contained bright water bubble ${i}`,new THREE.SphereGeometry(r*(.013+(i%4)*.007),12,8),shell,v(Math.cos(a)*rr*r*.965,yy*r*.965,Math.sin(a)*rr*r*.965));}
    if(e==='fire'){
      for(let j=0;j<3;j++){const pts=[v(-.3*r,-.6*r,.2*r),v(.2*r,-.25*r,.25*r),v(-.13*r,.18*r,.3*r),v(.2*r,.65*r,.12*r)];const flame=tube(internal,`Central molten flame tongue ${j}`,pts,.20*r,current,true);flame.rotation.y=j*tau/3;}
    }
  }
  if(e==='fire'&&loose){
    const bronze=mat('Fire orb broad hammered copper flame bands','#c28a51',.35,.73);
    for(let j=0;j<3;j++){
      const pts=Array.from({length:90},(_,i)=>{const a=i/89*tau;const q=v(Math.cos(a),Math.sin(a),Math.sin(a*3+j)*.15).normalize().multiplyScalar(r*1.012);return q;});
      const rail=tube(internal,`Copper swept cage band ${j}`,pts,r*.053,bronze);rail.rotation.y=j*tau/3;
      for(let k=0;k<2;k++){const a=k*Math.PI+.6;const pts2=[v(Math.cos(a)*r,Math.sin(a)*r,0),v(Math.cos(a+.2)*r*.9,Math.sin(a+.2)*r*.9,r*.38),v(Math.cos(a+.46)*r*.82,Math.sin(a+.46)*r*.82,r*.52)];const tip=tube(internal,`Copper cage flame shoulder ${j}-${k}`,pts2,r*.09,bronze,true);tip.rotation.y=j*tau/3;}
    }
  }
}

function wand(e:Element,id:string):THREE.Group {
  const g=new THREE.Group(),p=palettes[e];g.name=id;
  const wood=mat(`${e} carved wood`,p.wood,e==='water'?.31:.61,0,texture('wood',e));
  const leather=mat(`${e} grip leather`,p.leather,.68,0,texture('leather',e));
  const metal=mat(`${e} aged collar`,p.metal,.4,.8);const trim=mat(`${e} polished relief`,p.trim,.27,.82);
  band(g,'Leather grip foundation',0,.022,.145,leather);
  spiral(g,'Overlapping helical leather edge',-.07,.07,.0223,5.1,leather,.0013);
  for(const y of [-.078,.078]){band(g,'Grip end ferrule',y,.024,.014,e==='air'?wood:metal);band(g,'Ferrule raised edge',y-.007,.0247,.0018,e==='air'?wood:trim);band(g,'Ferrule raised edge',y+.007,.0247,.0018,e==='air'?wood:trim);}
  const pommel=add(g,'Solid shaped pommel',new THREE.SphereGeometry(.024,24,16),e==='earth'||e==='fire'?metal:wood,v(0,-.091,0));pommel.scale.y=.7;
  const shaftPts=[v(0,.076,0),v(-.001,.14,0),v(.003,.22,0),v(0,.285,0)];tube(g,'Tapered carved wooden shaft',shaftPts,.021,wood);
  if(e==='earth')for(let i=0;i<5;i++){
    const a=i*tau/5,pts=[.09,.12,.156,.20,.233,.285].map((y,j)=>{const theta=a+Math.sin(j*1.4+i)*.6;return v(Math.sin(theta)*.020,y,Math.cos(theta)*.020);});
    tube(g,`Angular raised ash root ${i}`,pts,.0058,wood);
    tube(g,`Forked ash root ${i}`,[pts[2]!,v(Math.sin(a+.8)*.021,.18,Math.cos(a+.8)*.021),pts[4]!],.0038,wood,true);
    tube(g,`Dark carved ash root cleft ${i}`,pts.map(q=>q.clone().add(v(Math.cos(a)*.004,0,-Math.sin(a)*.004))),.00085,leather);
  }
  else if(e==='fire'){
    for(let i=0;i<4;i++){
      const a=i*tau/4,point=(angle:number,y:number,r=.022)=>v(Math.sin(angle)*r,y,Math.cos(angle)*r);
      tube(g,`Sculpted walnut flame ridge ${i}`,[point(a,.09),point(a+.28,.14),point(a-.15,.205),point(a+.35,.278)],.0054,wood,true);
      tube(g,`Broad copper flame inlay ${i}`,[point(a,.108,.024),point(a+.32,.156,.026),point(a+.08,.206,.024),point(a+.5,.24,.022)],.0036,trim,true);
      tube(g,`Copper branching flame ${i}`,[point(a+.3,.15,.025),point(a+.8,.181,.025),point(a+.7,.21,.023)],.0024,trim,true);
    }
  }
  else for(let i=0;i<2;i++){
    spiral(g,`${e} sculpted flowing wood relief ${i}`,.093,.277,.0205,1.05,wood,.0038,i*Math.PI+.18);
    spiral(g,`${e} broad flowing silver inlay ${i}`,.093,.277,.022,1.05,trim,.0022,i*Math.PI);
  }
  if(e!=='fire'){band(g,'Head joining collar',.279,.024,.027,metal);for(const y of [.265,.293])band(g,'Collar edge bead',y,.0249,.0025,trim);}
  for(let i=0;i<3;i++){
    const a=i*tau/3+.55;const radial=(r:number,y:number,offset=0)=>v(Math.sin(a+offset)*r,y,Math.cos(a+offset)*r);
    const pts=[radial(.013,.28),radial(.034,.308),radial(.044,.339),radial(.030,.370-i*.009,i===0?.14:0)];
    tube(g,`${e} solid carved orb retaining prong ${i}`,pts,e==='earth'?.014:.013,wood,true);
    if(e==='water'){const curl=[radial(.023,.295),radial(.043,.319),radial(.039,.334,.4),radial(.026,.336,.55),radial(.030,.326,.45)];tube(g,`Oak scroll clasp ${i}`,curl,.007,wood,true);}
    if(e==='fire'){tube(g,`Copper flame ridge on prong ${i}`,pts.map(q=>q.clone().multiply(v(1.04,1,1.04))),.0036,trim,true);const tip=add(g,`Copper pointed prong shoe ${i}`,new THREE.ConeGeometry(.006,.022,5),trim,radial(.033,.363-i*.009));tip.rotation.z=Math.sin(a)*.5;tip.rotation.x=-Math.cos(a)*.5;}
  }
  // All relief wraps around the shaft, giving the rear the same joinery as the front.
  for(let side=0;side<2;side++){
    const z=side===0?1:-1;
    if(e==='earth'){for(const y of [.078,.279])tube(g,'Angular bronze chevron',[v(-.017,y+.007,z*.017),v(0,y-.006,z*.025),v(.017,y+.007,z*.017)],.0016,trim);}
    else if(e==='water'||e==='air') {for(const y of [.145,.266]){const pts=Array.from({length:32},(_,i)=>{const t=i/31,a=t*Math.PI*2.0;return v(Math.cos(a)*(.009*(1-t)+.002),y+Math.sin(a)*.012,z*.0215);});tube(g,'Inlaid curling scroll',pts,.0014,trim);}}
    if(e==='fire'){for(const y of [.078,.254]){const bezel=add(g,'Diamond ember setting',new THREE.OctahedronGeometry(.009),trim,v(0,y,z*.024));bezel.scale.set(.7,1.5,.28);const jewel=add(g,'Red cut garnet',new THREE.OctahedronGeometry(.0065),leather,v(0,y,z*.026));jewel.scale.set(.7,1.5,.3);}}
  }
  orb(g,e,v(0,.333,0),.041,false);
  g.userData.itemModel={itemId:id,author:'orbs-wands',reference:`art/item-icons/generated/${id}.png`,description:`Short ${e} wand with ${e==='air'?'pale pine and pewter wind scrolls':e==='earth'?'pale ash root carving and aged bronze':e==='water'?'honey oak wave scrolls, silver and blue leather':'dark walnut flame carving, copper and oxblood leather'}, three solid prongs securing its contained elemental orb.`,grip:[0,0,0],focus:[0,.333,0]};
  return g;
}
export const author:ItemModelAuthor={ids:['air_orb','earth_orb','water_orb','fire_orb','air_wand','earth_wand','water_wand','fire_wand'],build(id){if(!this.ids.includes(id))throw new Error(`Unsupported orb/wand ${id}`);const e=id.split('_')[0] as Element;if(id.endsWith('_wand'))return wand(e,id);const g=new THREE.Group();g.name=id;orb(g,e,v(0,0,0),.075,true);g.userData.itemModel={itemId:id,author:'orbs-wands',reference:`art/item-icons/generated/${id}.png`,description:`Spherical ${e} region-boss core used to craft a charged ${e} wand or staff, with polished glass enclosing ${e==='air'?'a silver-white cyclone':e==='earth'?'rough brown mineral fragments and luminous green veins':e==='water'?'a turquoise water vortex and bubbles':'a molten orange flame and red lava curls, held in copper flame bands'}.`,grip:[0,0,0],focus:[0,0,0]};return g;}};


