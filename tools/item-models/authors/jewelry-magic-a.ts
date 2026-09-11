import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU=Math.PI*2;
const V=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
type Point=readonly [number,number,number];
function mesh(g:THREE.Group,name:string,geometry:THREE.BufferGeometry,material:THREE.Material){
  geometry.name=name+' geometry'; const m=new THREE.Mesh(geometry,material);m.name=name;g.add(m);return m;
}
function tube(g:THREE.Group,name:string,points:readonly Point[],radius:number,mat:THREE.Material,closed=false,linear=false){
  const curve=linear?new THREE.CurvePath<THREE.Vector3>():new THREE.CatmullRomCurve3(points.map(p=>V(...p)),closed);
  if(linear){const c=curve as THREE.CurvePath<THREE.Vector3>;for(let i=1;i<points.length;i++)c.add(new THREE.LineCurve3(V(...points[i-1]!),V(...points[i]!)));}
  return mesh(g,name,new THREE.TubeGeometry(curve,Math.min(256,Math.max(16,points.length*6)),radius,8,closed),mat);
}
function tex(name:string,size:number,data:Uint8Array,srgb=false){const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;}
/** Mineral veins and wear are in maps, never tessellated surface noise. */
function surface(kind:'copper'|'silver'|'stone'|'cord'|'quartz'|'garnet'){
  const n=256,color=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),rough=new Uint8Array(n*n*4);
  const heights=new Float32Array(n*n);let seed=94171;
  const base=kind==='copper'?[182,103,64]:kind==='silver'?[129,143,157]:kind==='stone'?[113,116,112]:kind==='cord'?[90,61,42]:kind==='quartz'?[239,228,208]:[145,9,15];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed>>>24)/255-.5;
    const w=Math.sin(y*.039+Math.sin(x*.026)*1.6)+.5*Math.sin(x*.085-y*.027);
    const vein=Math.exp(-Math.pow((Math.sin(x*.047+y*.037+Math.sin(y*.045)*1.1+Math.sin(x*.031)*.7))/.037,2));
    const scratch=Math.pow(Math.max(0,Math.sin(x*.37+y*.07+Math.sin(y*.035))),18);
    const i=(y*n+x)*4;const stone=kind==='stone';const textile=kind==='cord';
    const variation=stone?noise*28+w*9:noise*11+w*6;
    for(let c=0;c<3;c++)color[i+c]=Math.max(0,Math.min(255,base[c]!+variation+(stone?vein*(c===2?54:63):kind==='garnet'?vein*(c===0?25:8):0)));
    color[i+3]=255;const r=stone?190+noise*28:textile?218+noise*18:kind==='quartz'||kind==='garnet'?120+noise*8:190+noise*25-w*15;
    rough[i]=rough[i+1]=rough[i+2]=r;rough[i+3]=255;
    heights[y*n+x]=textile?(Math.sin(x*.43+y*.16)*.7+noise*.5):stone?noise*.5-vein*.12:noise*.17+scratch*.1;
  }
  const sample=(x:number,y:number)=>heights[((y+n)%n)*n+(x+n)%n]!;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const p=(y*n+x)*4;const d=V((sample(x-1,y)-sample(x+1,y))*.28,(sample(x,y-1)-sample(x,y+1))*.28,1).normalize();normal[p]=(d.x*.5+.5)*255;normal[p+1]=(d.y*.5+.5)*255;normal[p+2]=(d.z*.5+.5)*255;normal[p+3]=255;}
  return {map:tex(kind+' natural color',n,color,true),normalMap:tex(kind+' fine surface normal',n,normal),roughnessMap:tex(kind+' polish and grain',n,rough)};
}
function metal(kind:'copper'|'silver'){return new THREE.MeshStandardMaterial({name:kind==='copper'?'Worn red copper':'Polished storm silver',...surface(kind),color:0xffffff,metalness:1,roughness:.36,normalScale:new THREE.Vector2(.5,.5)});}
function mineral(kind:'quartz'|'garnet'){return new THREE.MeshPhysicalMaterial({name:kind==='quartz'?'Clouded clear quartz':'Deep red garnet',...surface(kind),color:0xffffff,roughness:.17,metalness:0,transmission:kind==='quartz'?.65:.3,thickness:kind==='quartz'?.007:.010,ior:kind==='quartz'?1.544:1.78,attenuationColor:new THREE.Color(kind==='quartz'?0xf6e7cc:0xa80a0d),attenuationDistance:kind==='quartz'?.025:.018,clearcoat:.4,clearcoatRoughness:.12,normalScale:new THREE.Vector2(.1,.1)});}
function geometry(pos:number[],uv:number[],idx:number[],flat=false){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);const result=flat?g.toNonIndexed():g;result.computeVertexNormals();return result;}
/** Rounded rectangular section, a smooth open 20 mm bore and broad shoulders. */
function band(width:number,thickness:number,shoulder:number){const p:number[]=[],uv:number[]=[],ix:number[]=[];const aN=192,bN=24;
 for(let i=0;i<=aN;i++){const a=i/aN*TAU,up=Math.pow(Math.max(0,Math.sin(a)),4);for(let j=0;j<=bN;j++){const b=j/bN*TAU;const x=Math.sign(Math.cos(b))*Math.pow(Math.abs(Math.cos(b)),.38),z=Math.sign(Math.sin(b))*Math.pow(Math.abs(Math.sin(b)),.38);const r=10+(thickness+up*.4)*(x+1)/2;p.push(r*Math.cos(a),r*Math.sin(a),z*(width+up*shoulder)/2);uv.push(i/aN*3,j/bN);}}
 for(let i=0;i<aN;i++)for(let j=0;j<bN;j++){const a=i*(bN+1)+j,b=a+bN+1;ix.push(a,b,a+1,a+1,b,b+1);}return geometry(p,uv,ix);}
function ellipsePoints(rx:number,ry:number,z:number,cy=0,count=64):Point[]{return Array.from({length:count},(_,i)=>{const a=i/count*TAU;return [rx*Math.cos(a),cy+ry*Math.sin(a),z] as Point;});}
function ovalGem(rx:number,ry:number,depth:number,facets=14){
 const p:number[]=[],uv:number[]=[],ix:number[]=[];const rings:[[number,number],[number,number],[number,number],[number,number],[number,number]]=[[.03,-depth*.65],[.79,-depth*.45],[1,0],[.83,depth*.62],[.43,depth]];
 rings.forEach(([r,z],j)=>{for(let i=0;i<facets;i++){const a=(i+(j%2)*.5)/facets*TAU;p.push(rx*r*Math.cos(a),ry*r*Math.sin(a),z);uv.push(.5+r*Math.cos(a)*.5,.5+r*Math.sin(a)*.5);}});
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<facets;i++){const a=j*facets+i,b=j*facets+(i+1)%facets,c=a+facets,d=b+facets;ix.push(a,b,c,b,d,c);}for(let i=1;i<facets-1;i++){ix.push(0,i+1,i);const o=(rings.length-1)*facets;ix.push(o,o+i,o+i+1);}return geometry(p,uv,ix,true);
}
function cabochon(rx:number,ry:number,depth:number){const g=new THREE.SphereGeometry(1,64,40);g.scale(rx,ry,depth);return g;}
function ringSeat(g:THREE.Group,rx:number,rz:number,y:number,mat:THREE.Material){const pts=Array.from({length:64},(_,i)=>{const a=i/64*TAU;return [rx*Math.cos(a),y,rz*Math.sin(a)] as Point;});tube(g,'Rolled oval bezel lip',pts,.29,mat,true);}
function inclusions(g:THREE.Group,name:string,rx:number,ry:number,rz:number,mat:THREE.Material,cy=0){
 for(let i=0;i<13;i++){const a=i*2.399,center=V(Math.sin(a)*rx*.62,cy+Math.cos(a*1.7)*ry*.65,Math.sin(a*1.3)*rz*.58);const f=new THREE.TetrahedronGeometry(1);f.scale(.12+(i%3)*.05,.42+(i%4)*.10,.025);f.rotateZ(a);f.translate(...center.toArray());mesh(g,`${name} mineral feather ${i+1}`,f,mat);}}
function emberRing(g:THREE.Group){const copper=metal('copper'),q=mineral('quartz');const dark=new THREE.MeshStandardMaterial({name:'Oxidized copper recesses',color:0x44251f,roughness:.7,metalness:.65});const cloud=new THREE.MeshStandardMaterial({name:'Quartz pale inclusions',color:0xdccfbb,roughness:.4});
 mesh(g,'Solid copper shank with flared shoulders',band(3.5,1.5,2.6),copper);
 const bezel=new THREE.CylinderGeometry(4.1,4.4,1.5,64,1,true);bezel.scale(1,1,.82);bezel.translate(0,12.15,0);mesh(g,'Deep oval copper bezel',bezel,copper);
 const back=new THREE.SphereGeometry(1,40,18);back.scale(4.3,.65,3.55);back.translate(0,11.55,0);mesh(g,'Closed rounded copper setting back',back,copper);
 const gem=cabochon(3.64,1.9,2.96);gem.translate(0,13.04,0);mesh(g,'Oval polished quartz cabochon',gem,q);ringSeat(g,3.88,3.18,12.82,copper);
 for(const s of [-1,1])for(const z of [-1,1]){
 const pts:Point[]=[[s*10.7,2.8,z*1.8],[s*9.9,6.0,z*2.0],[s*7.2,9.3,z*2.7],[s*4.5,10.7,z*3.1],[s*3.15,12.05,z*2.4]];
 tube(g,'Dark carved flame channel',pts,.45,dark);tube(g,'Raised flowing copper shoulder ridge',pts.map(p=>[p[0],p[1]+.22,p[2]+z*.20]),.38,copper);
 }
 inclusions(g,'Cabochon',2.8,1.3,2.2,cloud,13.0);
}
function emberCharm(g:THREE.Group){const copper=metal('copper'),q=mineral('quartz');const soot=new THREE.MeshStandardMaterial({name:'Scorched black quartz termination',color:0x201613,roughness:.85,...surface('stone')});soot.color.setHex(0x352018);const amber=new THREE.MeshPhysicalMaterial({name:'Heat stained amber quartz',color:0x9b3b06,roughness:.32,transmission:.22,thickness:.003,ior:1.54});const cloud=new THREE.MeshStandardMaterial({name:'Quartz fracture inclusions',color:0xd9d0c0,roughness:.5});
 const raw=ovalGem(7.2,15.3,4.1,9);mesh(g,'Long irregular faceted quartz bead',raw,q);
 // The scorched termination is an irregular closed mineral volume on the end of the bead.
 const burnt=ovalGem(5.6,6.5,3.35,9);burnt.translate(-.5,-10.1,0);mesh(g,'Black scorched lower mineral tip',burnt,soot);
 const transition=ovalGem(6.15,5.2,3.3,10);transition.translate(-.35,-7.8,-.15);mesh(g,'Amber heat stain above blackened tip',transition,amber);
 for(const z of [-1,1])tube(g,'Copper longitudinal wire cage',[[0,14,z*1.5],[4.3,9,z*3.0],[6.6,1,z*2.3],[5.1,-9,z*1.4],[0,-14,z*.5]],.49,copper);
 const spiral:Point[]=[];for(let i=0;i<=160;i++){const t=i/160,a=t*TAU*2.25;spiral.push([Math.cos(a)*(3.4+t*2.4),14-t*11,Math.sin(a)*(2.2+t*2.1)]);}tube(g,'Continuous hand wound copper binding',spiral,.56,copper);
 tube(g,'Copper bail loop',ellipsePoints(2.5,4.5,0,19,48),.73,copper,true);
 tube(g,'Wire neck collar',Array.from({length:70},(_,i)=>{const a=i/69*TAU*2.5;return [2.5*Math.cos(a),14.7+i/69*2.5,1.7*Math.sin(a)] as Point;}),.5,copper);
 tube(g,'Right hand wire spiral flourish',Array.from({length:50},(_,i)=>{const a=i/49*TAU*1.4,r=2.0*(1-i/60);return [5.8+Math.cos(a)*r,2.0+Math.sin(a)*r,3.1] as Point;}),.43,copper);
 inclusions(g,'Raw quartz',5.2,11,3.5,cloud);
}
/** A rounded river pebble with an actual open bore and domed front and back. */
function piercedPebble(){const p:number[]=[],uv:number[]=[],ix:number[]=[];const n=128,layers=22;
 // A closed annulus in section runs from bore front, out around the pebble, back to the bore.
 for(let j=0;j<=layers*2;j++){const t=j/(layers*2)*TAU;const f=(1-Math.cos(t))/2,front=Math.sin(t);for(let i=0;i<=n;i++){const a=i/n*TAU;const ox=(9.6-2.25*Math.sin(a))*Math.cos(a),oy=-1+16*Math.sin(a);const hx=1.75*Math.cos(a),hy=10.4+2.1*Math.sin(a);p.push(hx+(ox-hx)*f,hy+(oy-hy)*f,front*(3.5+.6*Math.cos(a)));uv.push((hx+(ox-hx)*f)/22+.5,(hy+(oy-hy)*f)/35+.5);}}
 for(let j=0;j<layers*2;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+n+1;ix.push(a,b,a+1,a+1,b,b+1);}return geometry(p,uv,ix);
}
function stoneCharm(g:THREE.Group){const stone=new THREE.MeshStandardMaterial({name:'Grey river stone with pale quartz veins',...surface('stone'),roughness:.67,metalness:0,normalScale:new THREE.Vector2(.6,.6)});const cord=new THREE.MeshStandardMaterial({name:'Brown twisted leather thong',...surface('cord'),roughness:.82});mesh(g,'Smooth asymmetric pierced river pebble',piercedPebble(),stone);
 const loop:Point[]=[[0,9.7,2.7],[-1.5,14.2,1.7],[-3.7,23,0],[-2.6,28.4,-.3],[.7,30,0],[3.5,27.8,.5],[3.7,23,1.1],[1.4,15,2],[0,10,-2.8],[0,8.8,-1.5],[0,9.7,2.7]];
 const curve=new THREE.CatmullRomCurve3(loop.map(p=>V(...p)));for(let strand=0;strand<2;strand++){const points:Point[]=[];for(let i=0;i<=220;i++){const t=i/220,p=curve.getPoint(t),a=t*TAU*13+strand*Math.PI;p.x+=Math.cos(a)*.32;p.z+=Math.sin(a)*.32;points.push([p.x,p.y,p.z]);}tube(g,'Twisted leather loop strand '+strand,points,.61,cord);}
 tube(g,'Tight double leather knot',Array.from({length:100},(_,i)=>{const t=i/99,a=t*TAU*2.2;return [2.1*Math.cos(a),15.3+t*2.0,1.8*Math.sin(a)] as Point;}),.67,cord);
}
function stoneRing(g:THREE.Group){const stone=new THREE.MeshStandardMaterial({name:'Carved grey stone with quartz veins',...surface('stone'),roughness:.60,metalness:0,normalScale:new THREE.Vector2(.5,.5)});const recess=new THREE.MeshStandardMaterial({name:'Dark stone carving grooves',color:0x343938,roughness:.84});mesh(g,'Continuous stone bore and carved band foundation',band(5.9,2.0,1.7),stone);tube(g,'Incised central stone channel',ellipsePoints(12.03,12.03,0),.12,recess,true);
 // Beveled masonry-shaped facets follow the curved band. Gaps are real incised channels.
 for(let k=0;k<14;k++){const center=(k+.5)/14*TAU,top=Math.pow(Math.max(0,Math.sin(center)),4),half=(5.9+top*1.7)/2;for(const side of [-1,1]){
 const a0=k/14*TAU+.020,a1=(k+1)/14*TAU-.020;const p:number[]=[],uv:number[]=[],ix:number[]=[];const na=12;
 const cross:[[number,number],[number,number],[number,number],[number,number],[number,number],[number,number]]=[[.16,11.87],[.43,12.22],[half-.38,12.22],[half,11.89],[half,10.33],[.16,10.33]];
 for(let a=0;a<=na;a++){const t=a/na,theta=a0+(a1-a0)*t,bevel=Math.min(1,t*7,(1-t)*7);for(let b=0;b<cross.length;b++){const [z,r0]=cross[b]!;const r=r0-(b<3?(1-bevel)*.32:0);p.push(r*Math.cos(theta),r*Math.sin(theta),side*z);uv.push(theta/TAU*3,z/5);}}
 for(let a=0;a<na;a++)for(let b=0;b<cross.length;b++){const c=a*cross.length+b,d=a*cross.length+(b+1)%cross.length,e=c+cross.length,f=d+cross.length;if(side===1)ix.push(c,e,d,d,e,f);else ix.push(c,d,e,d,f,e);}for(let b=1;b<cross.length-1;b++){ix.push(0,b,b+1);const o=na*cross.length;ix.push(o,o+b+1,o+b);}mesh(g,`Beveled stone carved panel ${k} ${side}`,geometry(p,uv,ix),stone);
 }}
 // Top square boss is carved from the stone, with an open dark groove around its base.
 const shape=new THREE.Shape();shape.moveTo(-2.1,-2.1);shape.lineTo(2.1,-2.1);shape.lineTo(2.1,2.1);shape.lineTo(-2.1,2.1);shape.closePath();const boss=new THREE.ExtrudeGeometry(shape,{depth:.4,bevelEnabled:true,bevelThickness:.55,bevelSize:.55,bevelSegments:1,steps:1});boss.rotateX(-Math.PI/2);boss.translate(0,12,0);mesh(g,'Raised square carved stone crown',boss,stone);
}
function stormRing(g:THREE.Group){const silver=metal('silver'),ruby=mineral('garnet');const dark=new THREE.MeshStandardMaterial({name:'Blackened silver lightning grounds',color:0x27313b,metalness:.82,roughness:.60,...surface('silver')});dark.color.setHex(0x404958);mesh(g,'Broad storm silver signet band',band(5.0,1.7,3.7),dark);
 for(const z of [-1,1]){tube(g,'Polished band border',Array.from({length:96},(_,i)=>{const a=i/96*TAU;return [11.5*Math.cos(a),11.5*Math.sin(a),z*(2.5+1.85*Math.pow(Math.max(0,Math.sin(a)),4))] as Point;}),.28,silver,true);}
 const plate=new THREE.Shape();plate.moveTo(0,4.9);plate.lineTo(4.9,0);plate.lineTo(0,-4.9);plate.lineTo(-4.9,0);plate.closePath();const pl=new THREE.ExtrudeGeometry(plate,{depth:.6,bevelEnabled:true,bevelSize:.3,bevelThickness:.25,bevelSegments:1});pl.rotateX(-Math.PI/2);pl.translate(0,11.65,0);mesh(g,'Angular diamond signet platform',pl,silver);
 const gem=ovalGem(2.85,2.85,1.65,12);gem.rotateX(-Math.PI/2);gem.translate(0,13,0);mesh(g,'Round faceted blood red garnet',gem,ruby);ringSeat(g,3.03,3.03,12.9,silver);
 for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;const claw=new THREE.ConeGeometry(.91,1.7,4);claw.rotateZ(-.45);claw.translate(3.0,13.5,0);claw.rotateY(a);mesh(g,'Pointed silver garnet corner claw '+i,claw,silver);}
 // Each branch is fitted to the convex shoulder, not placed on a front card.
 for(const s of [-1,1])for(const face of [-1,1]){
 const convert=(a:number,z:number):Point=>[s*(11.82+.4*Math.pow(Math.sin(a),4))*Math.cos(a),(11.82+.4*Math.pow(Math.sin(a),4))*Math.sin(a),face*z];
 const a=[.08,.23,.36,.46,.58,.71,.82,.94,1.10];const z=[.2,.15,.7,.25,.7,.45,1.0,.6,.85];tube(g,'Silver lightning trunk',a.map((v,i)=>convert(v,z[i]!)),.17,silver,false,true);
 for(let j=1;j<7;j+=2){const t=a[j]!;tube(g,'Forked lightning engraving',[[...convert(t,z[j]!)],[...convert(t+.03,1.65)],[...convert(t+.16,2.2)]],.13,silver,false,true);tube(g,'Lightning small counter branch',[[...convert(t+.08,z[j+1]!)],[...convert(t+.12,-.55)],[...convert(t+.22,-1.3)]],.12,silver,false,true);}
 }
}
function splitGarnet(side:number){const p:number[]=[],uv:number[]=[],ix:number[]=[];const rows=12,cols=4;const seam=[-.3,.1,-.55,-.1,.4,-.25,.5,.2,.95,.3,.8,.2,0];
 for(const front of [1,-1])for(let j=0;j<=rows;j++){const y=-15+j/rows*30;const width=11*Math.pow(Math.max(.007,1-Math.pow(y/15.4,2)),.65);for(let i=0;i<=cols;i++){const t=i/cols;const x=(seam[j]!+side*.22)*(1-t)+side*width*t;const z=front*(1.1+4.2*Math.sqrt(Math.max(0,1-Math.pow(x/11.5,2)-Math.pow(y/16.1,2))));p.push(x+side*.1,y,z);uv.push(x/23+.5,y/32+.5);}}
 const sheet=(rows+1)*(cols+1);for(let f=0;f<2;f++)for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=f*sheet+j*(cols+1)+i,b=a+cols+1;const forward=side*(f===0?1:-1)>0;if(forward)ix.push(a,a+1,b,a+1,b+1,b);else ix.push(a,b,a+1,a+1,b,b+1);}
 const perimeter:number[]=[];for(let j=0;j<=rows;j++)perimeter.push(j*(cols+1));for(let i=1;i<=cols;i++)perimeter.push(rows*(cols+1)+i);for(let j=rows-1;j>=0;j--)perimeter.push(j*(cols+1)+cols);for(let i=cols-1;i>0;i--)perimeter.push(i);for(let k=0;k<perimeter.length;k++){const a=perimeter[k]!,b=perimeter[(k+1)%perimeter.length]!;ix.push(a,b,a+sheet,b,b+sheet,a+sheet);}return geometry(p,uv,ix,true);
}
function stormCharm(g:THREE.Group){const silver=metal('silver'),ruby=mineral('garnet');const dark=new THREE.MeshStandardMaterial({name:'Oxidized recessed cage silver',color:0x27313b,metalness:.85,roughness:.5});const glow=new THREE.MeshStandardMaterial({name:'Pale hot lightning split',color:0xffcf76,emissive:0xff720d,emissiveIntensity:1.0,roughness:.25});mesh(g,'Left fractured garnet half',splitGarnet(-1),ruby);mesh(g,'Right fractured garnet half',splitGarnet(1),ruby);
 tube(g,'Lightning visible deep inside garnet split',[[-.3,-14,0],[.1,-12,0],[-.55,-10,0],[-.1,-7.5,0],[.4,-5,0],[-.25,-2.5,0],[.5,0,0],[.2,2.5,0],[.95,5,0],[.3,7.5,0],[.8,10,0],[.2,12.5,0]],.11,glow,false,true);
 for(const z of [-1,1]){tube(g,'Silver cage outer oval rail',ellipsePoints(10.7,15,1.6*z),.56,silver,true);tube(g,'Blackened cage inner oval rail',ellipsePoints(10.15,14.6,.8*z),.58,dark,true);}
 for(const s of [-1,1]){const pts:Point[]=[[0,15,1.7],[s*3.6,10,3.7],[s*9.3,4.7,3.45],[s*10.3,-1,2.6],[s*8.3,-8,3.0],[s*3.7,-13,3.3],[0,-15,1.5]];tube(g,'Sweeping silver garnet cage ribbon',pts,.79,silver);tube(g,'Dark chased line along cage ribbon',pts.map(p=>[p[0]-.14*s,p[1],p[2]+.70]),.18,dark);}
 for(const s of [-1,1])tube(g,'Turned silver retaining clasp',[[s*10,3,-1.6],[s*10.7,3.2,0],[s*10.2,3,2.9],[s*8.9,2.7,3.8]],.70,silver);
 tube(g,'Lower curled silver clasp',[[0,-15,-2],[0,-16,.2],[-1.4,-14.7,2.8],[-2.2,-11.5,4.0],[-1.2,-10,4.6],[0,-10.5,4.4]],.80,silver);
 tube(g,'Pendant suspension jump ring',ellipsePoints(2.4,3.0,0,17.5),.64,silver,true);
 // Hollow strap bail with chased border, turned perpendicular to the pendant face.
 const bail:Point[]=[[0,18,0],[0,22,2.1],[0,27,2.6],[0,28.6,0],[0,27,-2.5],[0,22,-2.0],[0,18,0]];
 for(const x of [-2,2])tube(g,'Polished bail strap edge',bail.map(p=>[x,p[1],p[2]]),.49,silver);
 const bp:number[]=[],bu:number[]=[],bi:number[]=[];const c=new THREE.CatmullRomCurve3(bail.map(p=>V(...p)),true);for(let i=0;i<=64;i++){const p=c.getPoint(i/64);for(const x of [-2,2]){bp.push(x,p.y,p.z);bu.push((x+2)/4,i/64);}}for(let i=0;i<64;i++){const a=i*2;bi.push(a,a+1,a+2,a+1,a+3,a+2);}const strap=geometry(bp,bu,bi);const bailMat=dark.clone();bailMat.name='Blackened silver bail strap';bailMat.side=THREE.DoubleSide;mesh(g,'Hollow folded broad silver bail',strap,bailMat);
 tube(g,'Bail engraved silver curl',[[-1.6,22,2.7],[-.8,24.4,2.9],[.8,26.3,2.85],[1.0,25,2.95],[.2,24.5,3.0],[-.2,25,3]],.17,silver);
}

const descriptions:Record<string,string>={ember_ring:'Warm copper ring with a polished oval cloudy quartz cabochon, oval bezel and flowing carved shoulders; 20 mm open bore.',ember_charm:'Faceted quartz bead scorched black at one end, heat stained amber, wrapped with continuous copper wire, side scroll and open bail.',stone_ring:'Heavy grey stone band with pale quartz veins, beveled geometric carvings and a square crown boss; 20 mm bore.',stone_charm:'Asymmetric veined grey river pebble, truly pierced through its top and suspended from a twisted brown leather thong and double knot.',storm_ring:'Blackened silver broad band with polished borders and branching lightning inlay, angular signet setting and faceted red garnet.',storm_charm:'A garnet split by lightning into two closed faceted volumes, re-caged in chased silver ribbons with curled retaining clasps and a hollow engraved bail.'};
export const author:ItemModelAuthor={ids:['ember_ring','ember_charm','stone_ring','stone_charm','storm_ring','storm_charm'],build(itemId){const builders:Record<string,(g:THREE.Group)=>void>={ember_ring:emberRing,ember_charm:emberCharm,stone_ring:stoneRing,stone_charm:stoneCharm,storm_ring:stormRing,storm_charm:stormCharm};const build=builders[itemId];if(!build)throw new Error('Unsupported jewelry model '+itemId);const g=new THREE.Group();g.name=itemId+' handmade jewelry';g.scale.setScalar(.001);g.userData.itemModel={itemId,author:'jewelry-magic-a',reference:`art/item-icons/generated/${itemId}.png`,description:descriptions[itemId]!};build(g);return g;}};


