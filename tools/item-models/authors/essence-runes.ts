import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type P = readonly [number, number];
const S = .085;
const ids = ['air_essence','earth_essence','water_essence','fire_essence','mind_rune','chaos_rune','death_rune','blood_rune','wrath_rune','cosmic_rune'] as const;
type Id = typeof ids[number];
const descriptions: Record<Id,string> = {
  air_essence: 'A stackable charge drawn from the distant Farmland cache.',
  earth_essence: 'Dense green-brown essence mined beneath the Woodlands roots.',
  water_essence: 'Cold blue essence gathered from the far Highlands cache.',
  fire_essence: 'A hot orange charge mined at the Ashlands altar ruins. It never quite cools.',
  mind_rune: "A pale rune etched with a single clear eye. It steadies the caster's thought onto one mark. Rank-one invocations spend one per cast.",
  chaos_rune: 'An orange rune scored with a jagged fork. It lets a spell break loose and scatter across a line of foes. Rank-two invocations spend one per cast.',
  death_rune: "A bone-white rune cut with a hollow skull. It holds a spell's shape while it gathers and closes. Rank-three invocations spend one per cast.",
  blood_rune: 'A dark red rune with a drop sunk into its face. It feeds invocations heavy enough to batter the ground. Rank-four invocations spend one per cast.',
  wrath_rune: 'A black rune split through with slow red light. The four finales spend one per cast, and nothing smaller touches it.',
  cosmic_rune: 'A yellow rune ringed with a wheel of stars. It spreads an invocation across an area. Every area invocation spends one beside its rank rune.',
};

function polygon(points: readonly P[]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x,y],i) => i ? shape.lineTo(x*S,y*S) : shape.moveTo(x*S,y*S));
  shape.closePath(); return shape;
}
function curved(start: P, curves: readonly (readonly [number,number,number,number,number,number])[]): THREE.Shape {
  const p = new THREE.Shape(); p.moveTo(start[0]*S,start[1]*S);
  for(const c of curves) p.bezierCurveTo(c[0]*S,c[1]*S,c[2]*S,c[3]*S,c[4]*S,c[5]*S);
  p.closePath(); return p;
}
function ellipse(x:number,y:number,rx:number,ry:number):THREE.Shape {
  const p = new THREE.Shape();p.absellipse(x*S,y*S,rx*S,ry*S,0,Math.PI*2,false,0);return p;
}
function ring(x:number,y:number,rx:number,ry:number,width:number):THREE.Shape {
  const p=ellipse(x,y,rx,ry);p.holes.push(ellipse(x,y,rx-width,ry-width));return p;
}
function star(x:number,y:number,r:number,points=4):THREE.Shape {
  return polygon(Array.from({length:points*2},(_,i):P=>{
    const a=Math.PI/2+i*Math.PI/points,rad=i%2?r*.29:r;
    return [x+Math.cos(a)*rad,y+Math.sin(a)*rad];
  }));
}
const outlines:Record<Id, readonly P[]> = {
  air_essence:[[-.97,-.45],[-.99,-.1],[-.84,.4],[-.62,.48],[-.22,1.03],[.08,1.12],[.36,.87],[.75,.72],[.96,.38],[.88,-.15],[.99,-.42],[.61,-.85],[.21,-1],[-.28,-.89],[-.49,-.69]],
  earth_essence:[[-.98,-.79],[-.88,-.26],[-.69,.05],[-.55,.55],[-.29,.88],[.05,1.13],[.26,1.06],[.59,.47],[.73,.32],[.99,-.3],[.87,-.53],[.97,-.83],[.51,-.96],[.05,-.85],[-.52,-.94]],
  water_essence:[[-.48,-.96],[-.82,-.66],[-1,-.11],[-.84,.36],[-.52,.7],[-.2,1],[.2,1.12],[.44,.97],[.64,.58],[.9,.2],[.94,-.14],[.73,-.61],[.39,-.88],[.01,-1.05]],
  fire_essence:[[-.78,-.76],[-.91,-.48],[-.77,-.14],[-.83,.1],[-.6,.39],[-.43,.97],[-.27,1.12],[.2,.98],[.43,.81],[.55,.52],[.86,.33],[.89,-.03],[.78,-.4],[.91,-.75],[.62,-1.01],[.05,-.98]],
  mind_rune:[[-.52,-1],[-.85,-.63],[-.92,-.18],[-.76,.28],[-.79,.5],[-.42,.8],[-.01,1.08],[.23,1.14],[.48,.76],[.68,.58],[.84,.1],[.82,-.39],[.63,-.83],[.21,-1.09]],
  chaos_rune:[[-.83,-.89],[-.94,-.55],[-.8,-.14],[-.86,.32],[-.63,.74],[-.3,1.05],[.13,1],[.41,1.12],[.59,.74],[.8,.6],[.94,.25],[.83,-.21],[.9,-.54],[.66,-1],[.13,-1.06]],
  death_rune:[[-.59,-.99],[-.89,-.73],[-.92,-.4],[-.81,.13],[-.68,.55],[-.34,.96],[-.15,1.1],[.36,1.04],[.6,.85],[.84,.4],[.77,.03],[.91,-.26],[.67,-.83],[.18,-1.08]],
  blood_rune:[[-.8,-.73],[-.9,-.31],[-.84,.16],[-.59,.46],[-.43,1.12],[-.19,1.06],[.21,.89],[.67,.65],[.89,.19],[.76,-.26],[.83,-.76],[.48,-1.05],[.06,-.94]],
  wrath_rune:[[-.27,-1.14],[-.57,-.85],[-.66,-.45],[-.87,-.13],[-.8,.37],[-.53,.73],[-.1,1.18],[.2,1.02],[.5,.89],[.78,.48],[.82,.13],[.67,-.19],[.81,-.45],[.52,-.85],[.03,-1.03]],
  cosmic_rune:[[-.55,-.93],[-.88,-.61],[-1,-.19],[-.84,.29],[-.61,.74],[-.31,1.02],[.08,1.08],[.52,.88],[.69,.54],[.91,.36],[.99,-.07],[.8,-.45],[.63,-.81],[.26,-1.05],[-.15,-1.01]],
};

/** Authored vector carvings, independent of the reference image pixels. */
function symbols(id:Id):THREE.Shape[] {
  switch(id){
    case 'air_essence': return [
      curved([-.68,.19],[[-.26,.68,.22,.03,.5,.41],[.73,.74,.28,.91,.28,.64],[.3,.52,.46,.59,.4,.63],[.39,.73,.58,.65,.5,.53],[.33,.26,-.3,.81,-.68,.19]]),
      curved([-.72,-.13],[[-.22,.32,.21,-.29,.49,-.12],[.73,.04,.48,.28,.37,.15],[.28,.02,.47,-.02,.43,.07],[.46,.15,.57,.05,.5,-.01],[.28,-.2,-.21,.48,-.72,-.13]]),
      curved([-.65,-.4],[[-.22,-.02,.14,-.69,.43,-.46],[.62,-.29,.33,-.14,.3,-.3],[.3,-.38,.41,-.35,.38,-.31],[.42,-.29,.47,-.38,.39,-.4],[.18,-.51,-.22,.12,-.65,-.4]])
    ];
    case 'earth_essence': {
      const triangle=polygon([[-.62,-.49],[0,.73],[.62,-.49]]);
      triangle.holes.push(polygon([[-.45,-.37],[0,.5],[.45,-.37]]));
      return [triangle,polygon([[-.46,-.35],[-.19,.1],[-.04,-.1],[.16,.23],[.46,-.35],[.3,-.35],[.16,-.03],[.02,-.25],[-.18,-.1],[-.31,-.35]]),polygon([[-.57,-.65],[.56,-.65],[.5,-.57],[-.51,-.57]])];
    }
    case 'water_essence': {
      const d=drop(); d.holes.push(curved([.02,.59],[[.01,.07,-.42,-.21,-.31,-.48],[-.21,-.7,.06,-.66,.25,-.53],[-.14,-.55,-.27,-.16,.02,.59]]));return [d];
    }
    case 'blood_rune': return [drop()];
    case 'fire_essence': return [
      curved([-.05,.88],[[.47,.64,.36,.27,.25,.13],[.17,-.08,.33,-.13,.38,-.23],[.07,-.08,-.07,.06,.05,.33],[-.38,.05,-.44,-.26,-.07,-.34],[.37,-.41,.46,-.68,.05,-.85],[-.25,-.65,-.38,-.5,-.06,-.33],[-.67,-.34,-.29,.25,-.12,.4],[.08,.61,.11,.72,-.05,.88]]),
      curved([-.36,.3],[[-.69,.09,-.66,-.63,-.17,-.79],[-.51,-.39,-.47,-.28,-.46,-.05],[-.37,-.21,-.26,-.25,-.2,-.25],[-.39,-.02,-.52,.02,-.36,.3]]),
      curved([.45,.13],[[.85,-.22,.57,-.64,.26,-.76],[.56,-.48,.51,-.34,.53,-.17],[.49,-.24,.4,-.27,.35,-.27],[.5,-.07,.54,-.03,.45,.13]])
    ];
    case 'mind_rune': {
      const eye=curved([-.68,0],[[-.25,.44,.23,.44,.68,0],[.22,-.43,-.24,-.43,-.68,0]]);
      eye.holes.push(curved([-.54,0],[[-.22,.28,.22,.28,.54,0],[.21,-.28,-.21,-.28,-.54,0]]));
      const iris=ellipse(0,0,.18,.255);iris.holes.push(curved([0,.21],[[-.1,.08,-.1,-.08,0,-.21],[.1,-.08,.1,.08,0,.21]]));
      return [eye,iris,polygon([[-.035,.4],[0,.92],[.038,.4],[.13,.33],[-.13,.33]]),polygon([[-.035,-.4],[0,-.9],[.038,-.4],[.13,-.33],[-.13,-.33]]),star(-.68,0,.16),star(.68,0,.16)];
    }
    case 'chaos_rune': return [polygon([[-.49,-.8],[-.31,-.26],[-.5,.08],[-.28,.3],[-.43,.57],[-.25,.91],[-.27,.55],[-.1,.31],[-.2,.1],[-.05,-.03],[.15,.29],[.15,.48],[.55,.78],[.42,.47],[.28,.39],[.27,.17],[.03,-.15],[.4,-.09],[.49,.07],[.74,.19],[.51,-.15],[-.13,-.28],[-.24,-.6]])];
    case 'death_rune': {
      const skull=curved([-.46,-.14],[[-.59,.19,-.48,.65,-.19,.72],[.06,.87,.51,.68,.52,.24],[.52,.05,.61,-.12,.43,-.27],[.28,-.32,.31,-.54,.24,-.59],[-.15,-.7,-.33,-.55,-.32,-.4],[-.34,-.27,-.5,-.27,-.46,-.14]]);
      // The recess surrounds a bone relief, leaving eye sockets genuinely hollow.
      skull.holes.push(ellipse(0,.37,.37,.32));
      return [skull,curved([-.36,.26],[[-.2,.2,-.18,.07,-.07,.01],[-.15,-.2,-.42,-.19,-.43,-.07],[-.42,.05,-.4,.12,-.36,.26]]),curved([.36,.26],[[.2,.2,.18,.07,.07,.01],[.15,-.2,.42,-.19,.43,-.07],[.42,.05,.4,.12,.36,.26]]),polygon([[0,.01],[-.09,-.29],[0,-.24],[.075,-.29]]),...[-.18,-.06,.06,.18].map(x=>polygon([[x-.02,-.35],[x+.02,-.35],[x+.025,-.56],[x-.025,-.56]]))];
    }
    case 'wrath_rune': return [polygon([[-.63,.38],[-.43,-.31],[-.07,-.23],[-.17,-.58],[.03,-.27],[.4,-.32],[.65,.4],[.29,.15],[.43,.16],[.3,-.12],[.08,-.15],[.03,.39],[.16,.2],[.03,.73],[-.16,.22],[-.02,.36],[-.06,-.14],[-.34,-.1],[-.43,.18],[-.29,.13]])];
    case 'cosmic_rune': return [ring(0,0,.76,.83,.11),ring(0,0,.32,.35,.035),star(0,0,.31,6),...Array.from({length:6},(_,i)=>{const a=Math.PI/2+i*Math.PI/3;return star(Math.cos(a)*.65,Math.sin(a)*.71,.19,4);})];
  }
}
function drop():THREE.Shape {
  return curved([-.03,.79],[[.05,.41,.49,.02,.43,-.36],[.42,-.79,-.35,-.82,-.44,-.39],[-.52,.03,.02,.34,-.03,.79]]);
}

/** Spatial mineral veins and pores. Fine relief is independent of color contrast. */
function stoneMaterial(name:string,color:number,seed:number,glow=0):THREE.MeshStandardMaterial {
  const n=192,rgba=new Uint8Array(n*n*4),rough=new Uint8Array(n*n*4),norm=new Uint8Array(n*n*4);
  const base=new THREE.Color(color);
  const sites=Array.from({length:34},(_,i)=>[(Math.sin(i*78.21+seed)*.5+.5)*n,(Math.sin(i*53.7+seed*4)*.5+.5)*n]);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    let d=1e9,d2=1e9;
    for(const p of sites){const dx=x-p[0]!,dy=y-p[1]!,q=dx*dx+dy*dy;if(q<d){d2=d;d=q;}else if(q<d2)d2=q;}
    const vein=Math.sqrt(d2)-Math.sqrt(d)<.5;
    const noise=(Math.sin(x*127.1+y*311.7+seed)*43758.5453)%1;
    const broad=Math.sin(x*.067+Math.cos(y*.11))*Math.cos(y*.079);
    const k=.78+broad*.14+Math.abs(noise)*.19+(vein?.23:0),j=(y*n+x)*4;
    rgba[j]=Math.min(255,Math.round(THREE.MathUtils.clamp(base.r*k,0,1)**(1/2.2)*255));
    rgba[j+1]=Math.min(255,Math.round(THREE.MathUtils.clamp(base.g*k,0,1)**(1/2.2)*255));
    rgba[j+2]=Math.min(255,Math.round(THREE.MathUtils.clamp(base.b*k,0,1)**(1/2.2)*255));rgba[j+3]=255;
    rough[j]=rough[j+1]=rough[j+2]=Math.round(185+Math.abs(noise)*45+broad*15);rough[j+3]=255;
    norm[j]=Math.round(128+Math.sin(x*.8+Math.cos(y*.24))*7);norm[j+1]=Math.round(128+Math.cos(y*.71+Math.sin(x*.2))*7);norm[j+2]=255;norm[j+3]=255;
  }
  function tex(data:Uint8Array,label:string):THREE.DataTexture{const t=new THREE.DataTexture(data,n,n);t.name=`${name} ${label}`;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;}
  const map=tex(rgba,'mineral grain and hairline veins');map.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.MeshStandardMaterial({map,roughnessMap:tex(rough,'independent crystalline roughness'),normalMap:tex(norm,'fine stone relief'),roughness:glow?.5:.95,metalness:0,emissive:glow?color:0,emissiveIntensity:glow});m.name=name;return m;
}
function solid(g:THREE.Group,name:string,shape:THREE.Shape,depth:number,z:number,mat:THREE.Material,bevel=.001):THREE.Mesh {
  const geo=new THREE.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:bevel>0,bevelSegments:2,bevelSize:bevel,bevelThickness:bevel,curveSegments:30});
  // Use physical planar coordinates on every face so the fine grain is visible at item scale.
  const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++){uv.setXY(i,uv.getX(i)*8,uv.getY(i)*8);}uv.needsUpdate=true;
  geo.name=`${name} solid geometry`;const mesh=new THREE.Mesh(geo,mat);mesh.name=name;mesh.position.z=z;g.add(mesh);return mesh;
}

const palettes:Record<Id,readonly [number,number,number]>={
  air_essence:[0xaab9be,0x8aeaff,.7],earth_essence:[0x4b5030,0x98e967,.5],water_essence:[0x465971,0x55bdf2,.6],fire_essence:[0x39302b,0xff6308,1.1],mind_rune:[0xd5cbb5,0x54bafa,.6],chaos_rune:[0xc4540c,0x301709,.13],death_rune:[0xc7bda8,0x36312a,0],blood_rune:[0x551719,0x99060b,.18],wrath_rune:[0x211f22,0xff1607,.8],cosmic_rune:[0xd9a323,0x3b2b15,.04],
};

export const author:ItemModelAuthor={ids,build(itemId:string):THREE.Group{
  if(!ids.includes(itemId as Id))throw new Error(`Unknown essence/rune: ${itemId}`);
  const id=itemId as Id,index=ids.indexOf(id),[color,light,emission]=palettes[id];
  const g=new THREE.Group();g.name=`${id} carved mineral talisman`;
  g.userData.itemModel={itemId:id,author:'essence-runes',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id],grip:[0,0,0],focus:[0,0,.023]};
  const stone=stoneMaterial(`${id} fractured mineral`,color,index+12);
  const inlay=stoneMaterial(`${id} recessed rune mineral`,light,index+80,emission);
  const edge=stoneMaterial(`${id} weathered fracture edges`,new THREE.Color(color).multiplyScalar(.66).getHex(),index+24);
  const outline=polygon(outlines[id]);
  // Thick, solid back with a chamfered perimeter. Face and rear share the actual stone volume.
  solid(g,'Irregular thick stone core and rear',outline,.025,-.021,edge,.0035);
  const face=polygon(outlines[id]);
  const authoredGlyphs=symbols(id);
  // A single pocket avoids intersecting hole contours around the star wheel and skull.
  const glyphs=id==='cosmic_rune'?[ellipse(0,0,.8,.88)]:id==='death_rune'?[new THREE.Shape(authoredGlyphs[0]!.getPoints(48))]:authoredGlyphs;
  for(const glyph of glyphs){
    const path=new THREE.Path(glyph.getPoints(48));face.holes.push(path);
  }
  solid(g,'Chiseled front with open rune recesses',face,.012,.004,stone,.0007);
  glyphs.forEach((glyph,i)=>{
    solid(g,`Recessed symbol ${i+1}`,glyph,.0025,.0045,inlay,.00025);
    // Islands in a rune cutout retain their full stone height.
    glyph.holes.forEach((h,j)=>{const island=new THREE.Shape(h.getPoints(48));solid(g,`Raised stone inside symbol ${i+1}.${j+1}`,island,.012,.004,stone,.0006);});
  });
  if(id==='cosmic_rune'){
    const gold=stoneMaterial('Golden cosmic crystal relief',0xf4c837,101,.16);
    solid(g,'Unbroken golden wheel',ring(0,0,.59,.65,.23),.007,.008,stone,.0008);
    authoredGlyphs.slice(2).forEach((s,i)=>solid(g,`Faceted stellar relief ${i+1}`,s,.004,.012,gold,.0012));
  }
  if(id==='death_rune'){
    const skull=new THREE.Shape(authoredGlyphs[0]!.getPoints(48).map(p=>p.multiplyScalar(.88)));
    for(const socket of authoredGlyphs.slice(1))skull.holes.push(new THREE.Path(socket.getPoints(48)));
    solid(g,'Bone skull relief with hollow eyes nose and teeth',skull,.011,.005,stone,.0007);
  }
  // Rear has broad natural cleavage plates, not an untextured flat cap.
  for(let i=0;i<7;i++){
    const a=i*Math.PI*2/7+.12,r=.48;
    const x=Math.cos(a)*r,y=Math.sin(a)*r;
    const p=polygon([[x-.18,y-.11],[x-.12,y+.2],[x+.13,y+.16],[x+.19,y-.07],[x+.03,y-.2]]);
    const m=solid(g,`Rear cleavage flake ${i+1}`,p,.001,-.025-(i%3)*.0007,stone,.001);
    m.rotation.z=Math.sin(i*11)*.14;
  }
  // Geometric mineral seams continue across the thickness in the volcanic stones.
  if(id==='wrath_rune'||id==='fire_essence'){
    for(let side=0;side<2;side++){
      const seam=polygon(side?[[.47,.8],[.5,.63],[.68,.4],[.71,.12],[.69,-.15],[.74,-.47],[.72,-.64],[.7,-.45],[.65,-.14],[.67,.13],[.64,.39],[.46,.62]]:[[-.12,1.04],[.03,.79],[-.01,.54],[.02,.34],[-.02,.16],[.02,-.15],[-.09,-.43],[.06,-.63],[-.02,-.97],[.09,-.65],[-.055,-.42],[.045,-.15],[.005,.15],[.047,.35],[.01,.55],[.06,.8]]);
      solid(g,`Split glowing vein ${side+1}`,seam,.0008,.017,inlay,.00015);
      const rear=solid(g,`Rear glowing seam ${side+1}`,seam,.0008,-.026,inlay,.0001);rear.rotation.y=Math.PI;
    }
  }
  if(id==='earth_essence'){
    const moss=stoneMaterial('Root cache moss',0x52611d,63);
    for(let i=0;i<36;i++){
      const a=i*2.399,r=.81+.04*Math.sin(i*8),x=Math.cos(a)*r,y=Math.sin(a)*r;
      if(y>.8||Math.abs(x)>.55&&y>.1)continue;
      const m=new THREE.Mesh(new THREE.IcosahedronGeometry(.0025+(i%3)*.0008,1),moss);m.name=`Moss on chipped edge ${i}`;m.position.set(x*S,y*S,.016);m.scale.z=.45;g.add(m);
    }
  }
  return g;
}};
