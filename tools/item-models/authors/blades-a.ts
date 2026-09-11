import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Station = readonly [number, number, number, number?];
function noise(x: number, y: number) { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }
function maps(rgb: readonly number[], leather = false) {
  const n = 128, color = new Uint8Array(n*n*4), normal = new Uint8Array(n*n*4), rough = new Uint8Array(n*n*4), metal = new Uint8Array(n*n*4);
  for (let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const i=(y*n+x)*4, broad=noise(Math.floor(x/7),Math.floor(y/9)), grain=noise(x,y);
    const scratch = Math.pow(Math.max(0,Math.sin(x*1.6+Math.sin(y*.045)*2)),24);
    const shade=.89+.075*broad+.035*grain-scratch*.035;
    for(let c=0;c<3;c++) color[i+c]=Math.round(rgb[c]!*shade);
    color[i+3]=255;
    const strength=leather?14:5;
    normal.set([128+Math.round((grain-.5)*strength),128+Math.round((noise(x+1,y)-.5)*strength),255,255],i);
    const r=leather?185+grain*30:118+broad*38+grain*12;
    rough.set([r,r,r,255],i); const m=leather?0:239;metal.set([m,m,m,255],i);
  }
  const tex=(data:Uint8Array,name:string,srgb=false)=>{const t=new THREE.DataTexture(data,n,n);t.name=name;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;};
  return {map:tex(color,'subtle-forge-or-hide-colour',true),normalMap:tex(normal,'fine-surface-normal'),roughnessMap:tex(rough,'variable-polish'),metalnessMap:tex(metal,'metal-or-hide-mask')};
}
function mat(name:string,rgb:readonly number[], leather=false) {const m=new THREE.MeshStandardMaterial({...maps(rgb,leather),metalness:leather?0:.86,roughness:leather?.9:.7,normalScale:new THREE.Vector2(.48,.48)});m.name=name;return m;}
function solid(shape:THREE.Shape,depth:number,bevel=.0015) {const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:3,curveSegments:20,steps:1});g.translate(0,0,-depth/2);const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*10,uv.getY(i)*10);return g;}
/** Closed, honed blade cross section, with the fuller physically depressed into both faces. */
function blade(stations:readonly Station[],fuller:boolean) {
  const section: readonly (readonly [number,number])[]=fuller?[[-1,0],[-.89,.24],[-.23,.95],[-.13,.51],[.13,.51],[.23,.95],[.89,.24],[1,0],[.89,-.24],[.23,-.95],[.13,-.51],[-.13,-.51],[-.23,-.95],[-.89,-.24]]:[[-1,0],[-.87,.18],[0,1],[.87,.18],[1,0],[.87,-.18],[0,-1],[-.87,-.18]];
  const p:number[]=[],uv:number[]=[],idx:number[]=[],g=new THREE.BufferGeometry();
  for(let f=0;f<section.length;f++) {const start=idx.length;for(let j=0;j<stations.length-1;j++) {const base=p.length/3;for(const [s,k] of [[j,f],[j+1,f],[j,(f+1)%section.length],[j+1,(f+1)%section.length]]) {const [y,w,z,c=0]=stations[s!]!,[sx,sz]=section[k!]!;p.push(c+sx*w,y,sz*z);uv.push((sx+1)/2,y*6);}idx.push(base,base+2,base+1,base+2,base+3,base+1);}const edge=fuller?[0,6,7,13].includes(f):[0,3,4,7].includes(f);g.addGroup(start,idx.length-start,edge?1:fuller&&[2,3,4,9,10,11].includes(f)?2:0);}
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
const ids=['worn_sword','grithe_dagger','corven_dagger','corven_sword','kaldite_dagger'] as const;
export const author:ItemModelAuthor={ids,build(itemId) {
  if(!ids.includes(itemId as typeof ids[number]))throw new Error(`Unsupported blade ${itemId}`);
  const worn=itemId==='worn_sword',copper=itemId==='grithe_dagger',ironD=itemId==='corven_dagger',ironS=itemId==='corven_sword',needle=itemId==='kaldite_dagger',sword=worn||ironS;
  const root=new THREE.Group();root.name=`${itemId}-icon-forging`;
  const descriptions:Record<string,string>={worn_sword:'Notched, re-hafted twice, and lighter than it looks. It was somebody else\'s first. Riveted iron hilt, chipped fullered blade and overlapping worn leather.',grithe_dagger:'Copper leaf blade, gently curved brass crossguard, spiral leather grip and round brass pommel. Icon copper colour overrides legacy dull-grey description.',corven_dagger:'Deepwood steel, dark and slightly oily to the touch. Broad leaf blade with recessed fuller, curled guard and pyramidal iron pommel.',corven_sword:'A long Iron blade. The standard by which a Woodlands hand is judged. Narrow fullered blade, swept guard and faceted scent-stopper pommel.',kaldite_dagger:'A punch of black Cobalt with a needle point. It goes through moor-rot like paper. Asymmetric finger-ring guard, grooved pear pommel and dark red inset.'};
  root.userData.itemModel={itemId,author:'blades-a',reference:`art/item-icons/generated/${itemId}.png`,description:descriptions[itemId]!,grip:[0,0,0]};
  const steel=mat(copper?'warm-worked-copper':needle?'black-cobalt':worn?'worn-grey-iron':'oiled-dark-iron',copper?[228,139,85]:needle?[68,79,92]:worn?[146,147,143]:[105,112,117]);
  const edge=mat(copper?'honed-copper-edge':'silver-honed-edge',copper?[251,183,122]:[188,197,200]);edge.roughness=.37;
  const recess=mat('unpolished-fuller',copper?[170,94,52]:[66,71,74]);
  const fittings=copper?mat('antique-brass-fittings',[188,148,77]):steel;
  const leather=mat('brown-leather-grip',ironS?[42,29,22]:[77,43,27],true),seam=mat('leather-overlap-lip',[53,29,17],true);
  const add=(name:string,g:THREE.BufferGeometry,m:THREE.Material|THREE.Material[])=>{const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;};
  const h=sword?(worn?.185:.185):.126,guardY=h/2+.011;
  let stations:Station[];
  if(worn)stations=[[guardY,.044,.010],[.18,.045,.010],[.34,.043,.010],[.347,.037,.009],[.354,.043,.010],[.48,.041,.009],[.488,.033,.008],[.498,.041,.009],[.62,.038,.009],[.627,.032,.008],[.635,.038,.009],[.75,.032,.007],[.82,.016,.004],[.87,0,0]];
  else if(copper)stations=[[guardY,.027,.005],[.11,.031,.006],[.17,.035,.006],[.235,.032,.005],[.295,.023,.004],[.338,.010,.002,.004],[.36,0,0,.007]];
  else if(ironD)stations=[[guardY,.025,.007],[.10,.027,.008],[.145,.036,.009],[.20,.039,.008],[.26,.028,.006],[.309,.014,.003],[.345,0,0]];
  else if(ironS)stations=[[guardY,.046,.012],[.17,.044,.012],[.62,.034,.009],[.88,.027,.007],[1.02,.017,.004],[1.105,0,0]];
  else stations=[[guardY,.028,.008],[.11,.025,.009],[.18,.019,.007],[.27,.011,.0045],[.36,0,0]];
  add('beveled-blade-'+(needle?'needle':copper?'copper-leaf':ironD?'iron-leaf':worn?'chipped-shortsword':'long-fullered'),blade(stations,!copper&&!needle),[steel,edge,recess]);
  const sh=new THREE.Shape();
  if(ironD){sh.moveTo(-.084,guardY-.020);sh.bezierCurveTo(-.11,guardY+.010,-.09,guardY+.038,-.059,guardY+.024);sh.quadraticCurveTo(-.033,guardY+.012,0,guardY+.010);sh.quadraticCurveTo(.033,guardY+.012,.059,guardY+.024);sh.bezierCurveTo(.09,guardY+.038,.11,guardY+.010,.084,guardY-.020);sh.quadraticCurveTo(.078,guardY-.023,.08,guardY-.010);sh.quadraticCurveTo(.085,guardY+.006,.066,guardY+.006);sh.quadraticCurveTo(.029,guardY-.014,0,guardY-.012);sh.quadraticCurveTo(-.029,guardY-.014,-.066,guardY+.006);sh.quadraticCurveTo(-.085,guardY+.006,-.08,guardY-.010);sh.closePath();}
  else if(needle){sh.moveTo(-.063,guardY+.018);sh.quadraticCurveTo(-.026,guardY+.013,0,guardY+.009);sh.quadraticCurveTo(.030,guardY-.002,.068,guardY-.020);sh.quadraticCurveTo(.053,guardY-.022,.031,guardY-.013);sh.lineTo(-.031,guardY-.010);sh.lineTo(-.055,guardY-.018);sh.closePath();}
  else {const w=worn?.108:ironS?.169:.062,dy=ironS?.022:copper?.005:.005;sh.moveTo(-w,guardY+dy+.009);sh.quadraticCurveTo(-w*.65,guardY+dy,0,guardY+.010);sh.quadraticCurveTo(w*.65,guardY+dy,w,guardY+dy+.009);sh.lineTo(w,guardY+dy-.009);sh.quadraticCurveTo(w*.6,guardY-.006,0,guardY-.012);sh.quadraticCurveTo(-w*.6,guardY-.006,-w,guardY+dy-.009);sh.closePath();}
  add('sculpted-'+(ironD?'hooked':needle?'asymmetric':ironS?'swept':'bar')+'-guard',solid(sh,sword?.022:.013,sword?.002:.001),fittings);
  if(needle){const ring=add('open-finger-ring',new THREE.TorusGeometry(.0225,.0042,12,64),steel);ring.position.set(-.061,guardY-.005,0);}
  if(worn)for(const x of [-.025,.025]){const riv=add('guard-rehafting-rivet',new THREE.SphereGeometry(.006,16,10),x<0?recess:edge);riv.scale.z=.45;riv.position.set(x,guardY,.014);}
  if(ironS||needle){const w=ironS?.045:.025;add('faceted-guard-blade-collar',blade([[guardY-.007,w,.014],[guardY+.017,w*.9,.017],[guardY+.039,0,.012]],false),[steel,edge,recess]);}
  const r=sword?.021:.0175;
  const profile:THREE.Vector2[]=[];for(let i=0;i<=48;i++){const t=i/48;profile.push(new THREE.Vector2(r*(.91+.14*Math.sin(t*Math.PI)),(t-.5)*h));}
  const handle=add('oval-leather-handle',new THREE.LatheGeometry(profile,48),leather);handle.scale.z=.79;
  const points:THREE.Vector3[]=[];const turns=worn?7.4:ironS?10:6.3;
  for(let i=0;i<=480;i++){const t=i/480,a=t*Math.PI*2*turns,rr=r*(.91+.14*Math.sin(t*Math.PI))+.0006;points.push(new THREE.Vector3(Math.sin(a)*rr,(t-.5)*h,Math.cos(a)*rr*.79));}
  add('continuous-spiral-leather-overlap',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),480,worn?.0028:.00135,8,false),seam);
  const collar=(y:number,rad:number,height:number)=>{const c=add('rolled-hilt-ferrule',new THREE.LatheGeometry([[0,-height/2],[rad*.92,-height/2],[rad,-height*.3],[rad,height*.3],[rad*.92,height/2],[0,height/2]].map(([x,z])=>new THREE.Vector2(x!,z!)),40),fittings);c.position.y=y;c.scale.z=.83;};
  collar(-h/2-.002,r*1.07,.008);collar(h/2+.001,r*1.07,.007);
  if(copper){const p=add('domed-brass-coin-pommel',new THREE.LatheGeometry([[0,-.011],[.02,-.010],[.029,-.004],[.031,0],[.030,.005],[.025,.010],[.013,.013],[0,.014]].map(([x,y])=>new THREE.Vector2(x!,y!)),64),fittings);p.rotation.x=Math.PI/2;p.position.y=-h/2-.026;}
  else if(ironD){add('faceted-pyramidal-pommel',blade([[-h/2-.048,0,0],[-h/2-.032,.027,.020],[-h/2-.006,.018,.014]],false),[steel,edge,recess]);}
  else {const py=-h/2-(needle?.023:.028),pr=needle?.023:worn?.030:.028;const pp=needle?[[0,-.028],[pr*.4,-.026],[pr*.85,-.016],[pr,-.003],[pr*.84,.010],[pr*.67,.022],[0,.022]]:worn?[[0,-.021],[pr*.78,-.021],[pr,-.013],[pr,.015],[pr*.8,.021],[0,.021]]:[[0,-.05],[pr*.40,-.048],[pr*.92,-.027],[pr,.005],[pr*.62,.027],[0,.031]];
    const pom=add(needle?'pear-shaped-pommel':worn?'octagonal-iron-cap':'faceted-scent-stopper',new THREE.LatheGeometry(pp.map(([x,y])=>new THREE.Vector2(x!,y!)),needle?48:8),steel);pom.position.y=py;pom.scale.z=needle?.82:.8;
    if(needle){for(const y of [py-.005,py+.003]){const band=add('pommel-engraved-band-lip',new THREE.TorusGeometry(pr*.96,.0008,8,48),edge);band.rotation.x=Math.PI/2;band.position.y=y;band.scale.y=.82;}
      const gemmat=new THREE.MeshPhysicalMaterial({color:'#430308',metalness:.15,roughness:.18,clearcoat:1,clearcoatRoughness:.08});gemmat.name='dark-garnet-pommel-inset';const gem=add('inset-red-pommel-stone',new THREE.SphereGeometry(.0075,24,16),gemmat);gem.scale.set(1,1.2,.38);gem.position.set(0,py-.014,.017);const bezel=add('silver-stone-bezel',new THREE.TorusGeometry(.0082,.0011,8,40),edge);bezel.scale.y=1.18;bezel.position.copy(gem.position);}
    if(worn){const riv=add('pommel-cap-rivet',new THREE.SphereGeometry(.0067,16,10),edge);riv.scale.z=.5;riv.position.set(0,py,.026);}
  }
  return root;
}};

