import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const ids = ['silt_minnow', 'seared_minnow', 'burnt_minnow', 'bramble_trout', 'seared_trout', 'burnt_trout'] as const;
const descriptions = ['A palm-sized fish out of the River shallows. Raw, it is mostly bone.', 'Two minutes over a range and it stops being mostly bone.', 'Charred through. Nothing left worth eating.', 'Black-backed trout from the Blackwater pools. Fights the line the whole way in.', "Split, salted, and laid on the stone. Oakwood's entire cuisine.", 'You left it on. It happens until Cooking 20.'];
const hash = (n: number) => ((Math.sin(n * 127.1 + 31.7) * 43758.5453) % 1 + 1) % 1;
type P = [number, number, number];
function geo(p: number[], uv: number[], ix: number[]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); g.computeVertexNormals(); return g; }
function skinMap(trout: boolean, cooked: boolean, burnt: boolean) {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, back = (Math.cos(v * Math.PI * 2) + 1) / 2;
    const row = Math.floor(v * 36), sx = u * 64 + (row % 2) * .5, sy = (v * 36) % 1;
    const edge = Math.abs(Math.sqrt(((sx % 1) - .5) ** 2 + (sy * .7) ** 2) - .48) < .045;
    const noise = hash(x + y * size), spotX = Math.floor(u * 30), spotY = Math.floor(v * 18);
    const spot = Math.hypot((u * 30) % 1 - .2 - hash(spotX + spotY * 33) * .5, (v * 18) % 1 - .5) < .12 && back > .25;
    let r = trout ? 220 - back * 180 : 235 - back * 170, g = trout ? 216 - back * 169 : 233 - back * 124, b = trout ? 198 - back * 157 : 218 - back * 66;
    if (trout && back > .3 && back < .7) { r += 20; b += 8; }
    if (cooked) { const scorch = Math.max(0, Math.sin(u * 31 + v * 11)) * back; r = 232 - back * 95 - scorch * 65; g = 171 - back * 98 - scorch * 50; b = 78 - back * 52; }
    if (burnt) { const cell = hash(Math.floor(u * 83) + Math.floor(v * 42) * 311); r = 20 + cell * 27; g = 17 + cell * 22; b = 15 + cell * 20; if (edge) { r += 35; g += 29; b += 22; } }
    const f = (edge ? .72 : 1) * (trout && spot ? .19 : 1) * (.9 + noise * .2);
    const i = (y * size + x) * 4; data[i] = r * f; data[i+1] = g * f; data[i+2] = b * f; data[i+3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.name = 'hand-authored scale rows, dorsal gradient and cooking mottling'; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
export const author: ItemModelAuthor = { ids, build(id) {
  const index = ids.indexOf(id as typeof ids[number]); if (index < 0) throw new Error(`fish-a does not own ${id}`);
  const trout = index >= 3, cooked = index % 3 > 0, burnt = index % 3 === 2;
  const root = new THREE.Group(); root.name = id;
  root.userData.itemModel = { itemId: id, author: 'fish-a', reference: `art/item-icons/generated/${id}.png`, description: descriptions[index], grip: [0,0,0] };
  const body = new THREE.MeshPhysicalMaterial({ map: skinMap(trout,cooked,burnt), roughness: burnt ? .87 : cooked ? .37 : .3, metalness: cooked ? .04 : .24, clearcoat: burnt ? .02 : .38, clearcoatRoughness: .24 }); body.name = 'scaled skin with continuous back and belly';
  const finMat = new THREE.MeshStandardMaterial({color: burnt ? 0x302119 : cooked ? 0xad6120 : trout ? 0x797166 : 0xb3ac84, roughness:.52}); finMat.name='ribbed fin membrane';
  const rayMat = new THREE.MeshStandardMaterial({color: burnt ? 0x645343 : cooked ? 0xe1a34c : 0xd1c6a5, roughness:.49}); rayMat.name='fin rays and lip rim';
  const dark = new THREE.MeshStandardMaterial({color: burnt ? 0x110e0c : 0x22190f, roughness: burnt ? .92 : .28}); dark.name='mouth, gill creases and pupils';
  const gold = new THREE.MeshPhysicalMaterial({color: burnt ? 0x65503a : 0xcb9b3a, roughness: .29, metalness: .3}); gold.name='iris ring';
  const flesh = new THREE.MeshStandardMaterial({color: burnt ? 0x34231a : 0xffd49a, roughness: burnt ? .92 : .39}); flesh.name='exposed cooked muscle';
  const crust = new THREE.MeshStandardMaterial({color: burnt ? 0x343130 : 0x8d3e15, roughness: burnt ? .95 : .45}); crust.name='raised char plates';
  const salt = new THREE.MeshStandardMaterial({color:0xf5e8ce, roughness:.65}); salt.name='salt crystals';
  function mesh(name:string,g:THREE.BufferGeometry,m:THREE.Material) { const o=new THREE.Mesh(g,m); o.name=name;o.castShadow=true;o.receiveShadow=true;root.add(o);return o; }
  function ell(name:string,p:P,s:P,m:THREE.Material) {const o=mesh(name,new THREE.SphereGeometry(1,16,8),m);o.position.set(...p);o.scale.set(...s);return o;}
  function line(name:string,points:P[],r:number,m:THREE.Material) {return mesh(name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(8,points.length*5),r,5,false),m);}
  // Body is a closed elliptical loft, with species-specific peduncle and muzzle.
  const length = trout ? .41 : .19, height = trout ? .073 : burnt ? .034 : .029, depth=height*.47;
  const profile = [[0,.08],[.06,.42],[.17,.83],[.3,1],[.48,.93],[.65,.73],[.83,.4],[.95,.21],[1,.2]];
  function rad(u:number) {for(let i=1;i<profile.length;i++){const a=profile[i-1]!,b=profile[i]!;if(u<=b[0]!)return a[1]!+(b[1]!-a[1]!)*(u-a[0]!)/(b[0]!-a[0]!);}return .2;}
  function point(u:number,a:number,extra=0):P {const r=rad(u), curl=burnt ? Math.pow(u,4)*height*.4 : u*height*.26;let d=depth*r; if(trout&&cooked&&u>.22&&u<.91&&Math.sin(a)>.48)d*=.62;return [(u-.48)*length,Math.cos(a)*(height*r+extra)+curl,Math.sin(a)*(d+extra)];}
  const pos:number[]=[], uv:number[]=[], ix:number[]=[];const nx=100, na=64;
  for(let i=0;i<=nx;i++)for(let j=0;j<=na;j++){pos.push(...point(i/nx,j/na*Math.PI*2));uv.push(i/nx,j/na);if(i<nx&&j<na){const k=i*(na+1)+j;ix.push(k,k+1,k+na+1,k+1,k+na+2,k+na+1);}}
  mesh('continuous volumetric fish body',geo(pos,uv,ix),body);
  for(const u of [0,1]) {const p=point(u,0);ell('closed muzzle or tail root',[(u-.48)*length,p[1]-height*rad(u),0],[length*.009,height*rad(u),depth*rad(u)],body);}
  function fin(name:string,base:P,outline:P[]) {const p:number[]=[],t:number[]=[],idx:number[]=[];for(const side of [-1,1]){p.push(base[0],base[1],base[2]+side*height*.02);t.push(0,0);for(const q of outline){p.push(q[0],q[1],q[2]+side*height*.015);t.push(1,1);}}const n=outline.length+1;for(let k=1;k<n-1;k++){idx.push(0,k,k+1,n,n+k+1,n+k);}for(let k=0;k<n;k++){const j=(k+1)%n;idx.push(k,j,n+k,j,n+j,n+k);}mesh(name,geo(p,t,idx),finMat);outline.forEach((q,i)=>line(`${name} ray ${i}`,[base,[(base[0]+q[0])*.5,(base[1]+q[1])*.5,(base[2]+q[2])*.5+height*.017],q],height*.008,rayMat));}
  const tail=point(1,0);const tx=tail[0],ty=tail[1]-height*.2;
  const tailOutline:P[]=[];for(let j=0;j<=20;j++){const f=j/20,yy=(1-2*f)*height*(trout ? 1.16:1.5);let xx=tx+length*(.12+.065*Math.abs(1-2*f));if(burnt)xx-=length*.017*(j%3);tailOutline.push([xx,ty+yy,Math.sin(f*6)*depth*.13]);}fin('forked caudal fin',[tx,ty,0],tailOutline);
  const dorsal=point(.48,0);fin('dorsal fin',point(.42,0),Array.from({length:12},(_,i)=>{const t=i/11;return [dorsal[0]+length*(t*.16-.04),dorsal[1]+height*(.72*(1-t)+(burnt ? .06*(i%2):0)),0] as P;}));
  if(trout) {const p=point(.85,0);ell('adipose fin',[p[0],p[1]+height*.1,0],[length*.02,height*.2,depth*.13],finMat);}
  for(const sign of [-1,1]) {const p=point(.25,Math.PI*.67*sign);fin('pectoral fin',p,Array.from({length:12},(_,i)=>{const t=i/11;return [p[0]+length*(.05+.13*Math.sin(t*Math.PI*.7)),p[1]-height*.38*t,p[2]+sign*depth*.27*Math.sin(t*Math.PI)] as P;}));const b=point(.59,Math.PI*.8*sign);fin('pelvic fin',b,Array.from({length:9},(_,i)=>[b[0]+length*.09*i/8,b[1]-height*.42*Math.sin(i/8*Math.PI*.7),b[2]+sign*depth*.4*i/8] as P));}
  const anal=point(.8,Math.PI);fin('anal fin',anal,Array.from({length:10},(_,i)=>[anal[0]+length*.08*i/9,anal[1]-height*.55*(1-i/9),0] as P));
  for(const sign of [-1,1]) {
    const ep=point(.105,sign*1.1);ep[0]-=length*.004;ep[2]+=sign*depth*.07;
    ell('raised eye socket',ep,[height*.245,height*.24,depth*.16],dark);ell('gold iris',[ep[0],ep[1],ep[2]+sign*depth*.09],[height*.19,height*.19,depth*.11],gold);ell('convex pupil',[ep[0],ep[1],ep[2]+sign*depth*.16],[height*.125,height*.14,depth*.075],dark);
    const gill:P[]=[];for(let j=0;j<=18;j++){const a=(.33+j/18*2.35)*sign;const u=.205+.028*Math.sin(j/18*Math.PI);gill.push(point(u,a,height*.008));}line('curved operculum groove',gill,height*.019,dark);line('raised gill-cover edge',gill.map(p=>[p[0]-length*.009,p[1],p[2]]),height*.014,rayMat);
    const mouth:P[]=[point(.005,sign*1.75),point(.04,sign*2),point(trout?.14:.075,sign*2.12)];line('mouth opening',mouth,height*(trout?.045:.019),dark);line('lower jaw lip',mouth.map(p=>[p[0],p[1]-height*.05,p[2]]),height*.023,rayMat);
  }
  if(cooked&&!trout)for(const u of [burnt?.32:.37,burnt?.48:.59,...(burnt?[.65]:[])])for(const sign of [-1,1]) {const cut:P[]=[];for(let k=0;k<=20;k++){const t=k/20;cut.push(point(u+(t-.5)*.09,sign*(.45+t*2.15),height*.014));}line('diagonal scoring exposing flesh',cut,height*(burnt?.027:.045),flesh);line('browned cut lip',cut.map(p=>[p[0]-length*.011,p[1],p[2]]),height*.011,crust);}
  if(trout&&cooked) {
    // Open flank has a recessed center and two rows of thick overlapping myotomes.
    for(let k=0;k<12;k++) {const u=.27+k*.051;for(const row of [-1,1]) {const p=point(u,Math.PI/2);p[1]+=row*height*rad(u)*.36;p[2]+=depth*.12;const o=ell('exposed layered flank muscle',p,[length*.045,height*rad(u)*.36,depth*.22],flesh);o.rotation.z=row*.21;}}
    const seam:P[]=[];for(let i=0;i<=24;i++)seam.push(point(.25+i/24*.64,Math.PI/2,depth*.07));line('split backbone channel',seam,height*.027,burnt?dark:crust);
    for(const a of [.62,2.55]){const rim:P[]=[];for(let i=0;i<=24;i++)rim.push(point(.24+i/24*.66,a,height*.008));line('curled edge of split skin',rim,height*.03,crust);}
  }
  if(burnt) {for(let i=0;i<250;i++){const u=.2+hash(i*9)*.73,a=hash(i*13+4)*Math.PI*2,p=point(u,a,height*.035);const o=mesh('fractured carbon crust flake',new THREE.IcosahedronGeometry(1,0),crust);o.position.set(...p);o.scale.set(length*(.008+hash(i)*.013),height*(.045+hash(i+3)*.055),depth*.05);o.rotation.x=-a+Math.PI/2;o.rotation.z=hash(i+2);}}
  if(cooked&&!burnt) {for(let i=0;i<(trout?65:35);i++){const u=.24+hash(i*3)*.65,a=.4+hash(i*7)*2.3;const p=point(u,a,height*.016);if(trout)p[2]+=depth*.17;ell('roasted skin blister',p,[height*.023,height*.022,height*.014],crust);}if(trout)for(let i=0;i<19;i++){const p=point(.28+hash(i*4)*.54,.85+hash(i*5)*1.25,depth*.15);const o=mesh('coarse salt grain',new THREE.OctahedronGeometry(height*.025),salt);o.position.set(...p);o.rotation.set(i,i*.4,i*.7);}}
  root.rotation.z = burnt&&!trout ? 0 : .18;
  return root;
} };


