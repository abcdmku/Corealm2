import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// Four individually configured volumes matched to the approved species icon masters.
// Shared fracture mathematics; distinct plate populations, trunk contours and wood anatomy.
const TAU = Math.PI * 2;
function hash(n: number): number { return ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1; }
function texture(name: string, size: number, sample: (u: number, v: number) => number[]): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = sample(x / (size - 1), y / (size - 1)); const i = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) pixels[i + k] = Math.max(0, Math.min(255, c[k]!));
    pixels[i + 3] = 255;
  }
  const t = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  t.name = name; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; return t;
}
function geometry(p: number[], uv: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
type Species = 'maple_log' | 'teak_log' | 'yew_log' | 'magic_log';
interface Profile { seed: number; plateCount: number; stretch: number; relief: number; warp: number; lobes: number; bark: [number,number,number]; edge: string; description: string }
const profiles: Record<Species,Profile> = {
  maple_log: { seed: 713, plateCount: 160, stretch: .58, relief: .0055, warp: .045, lobes: .003, bark: [119,108,96], edge: '#805333', description: 'Maple section with broad irregular grey-brown plates over orange cambium, cream and pink-brown growth zones, slightly eccentric fine rings and narrow drying checks.' },
  teak_log: { seed: 1291, plateCount: 182, stretch: .33, relief: .007, warp: .037, lobes: .002, bark: [117,103,83], edge: '#845323', description: 'Teak section with long narrow coarse brown-grey bark ridges, fibrous gold fissures, dense amber endgrain, dark chocolate heart and numerous fine radial checks.' },
  yew_log: { seed: 2017, plateCount: 95, stretch: .25, relief: .0048, warp: .085, lobes: .006, bark: [151,69,49], edge: '#9c4229', description: 'Yew section with thin long peeling russet plates and dark weathered flakes. Lobed red-orange heartwood and dark sinuous annual bands inside a broad cream sapwood ring.' },
  magic_log: { seed: 3253, plateCount: 120, stretch: .43, relief: .0065, warp: .13, lobes: .004, bark: [79,94,112], edge: '#554b42', description: 'Magic section with charcoal slate blue irregular bark, raised winding silver-blue veins, blue-grey endgrain with ivory rings and deep radial drying cracks.' },
};
function cylindrical(a: number, r: number, z: number): number[] { return [Math.cos(a) * r, Math.sin(a) * r, z]; }
function mesh(root: THREE.Group, name: string, g: THREE.BufferGeometry, m: THREE.Material): void {
  const value = new THREE.Mesh(g, m); value.name = name; value.castShadow = true; value.receiveShadow = true; root.add(value);
}
function build(itemId: Species): THREE.Group {
  const profile = profiles[itemId];
  const radius = (a: number, z: number): number => .115 + profile.lobes * Math.sin(a*3+.7+profile.seed) + .002*Math.cos(a*7-z*4) + .001*Math.sin(z*19+a*2) + .0007*Math.sin(a*29) + .0011*Math.sin(a*43+z*9);
  const root = new THREE.Group(); root.name = `${itemId} solid cut trunk`;
  root.userData.itemModel = { itemId, author: 'logs-b', reference: `art/item-icons/generated/${itemId}.png`, description: profile.description + ' Solid 0.54 m volume along Z, both ends authored, front +Z and grounded Y=0.' };

  const barkMap = texture(`${itemId} fibrous bark face`, 512, (u,v) => {
    const wave=u*(itemId==='teak_log'?37:24)+.15*Math.sin(v*39+profile.seed)+.04*Math.sin(v*131);
    const split=Math.max(0,Math.cos(wave*TAU))**38;
    const fine=Math.sin(u*1700+Math.sin(v*110)*2)*3;
    const fleck=hash(Math.floor(u*512)+Math.floor(v*512)*512+profile.seed);
    const scar=Math.max(0,Math.sin(v*161+Math.sin(u*73)*3))**26;
    const weather=Math.max(0,Math.sin(u*23+v*13)*Math.sin(v*29-u*7));
    const brightness=fleck*20+fine+scar*28-split*38;
    const grey=itemId==='yew_log'?weather*55:weather*19;
    return [profile.bark[0]+brightness-grey*.45,profile.bark[1]+brightness+grey*.45,profile.bark[2]+brightness+grey*.65];
  });
  barkMap.wrapS = THREE.RepeatWrapping;
  const woodMap = texture(`${itemId} eccentric endgrain and drying checks`, 1024, (u,v) => {
    const x=(u-.469)*2,y=(v-.445)*2,a=Math.atan2(y,x),r=Math.hypot(x,y);
    const waviness=itemId==='yew_log'?.043:.012;
    const rr=r*(1+waviness*Math.sin(a*7+.7)+waviness*.6*Math.sin(a*3))+.008*Math.sin(a*2+r*17);
    const growth=rr*(itemId==='teak_log'?26:itemId==='magic_log'?23:20)+.25*Math.sin(rr*19)+.18*Math.sin(rr*39);
    const late=Math.exp(-Math.pow(((growth%1)-.8)/.055,2));
    const fine=Math.sin(rr*1900+Math.sin(a*9)*2)*3;
    const grain=hash(Math.floor(u*1024)+1024*Math.floor(v*1024)+profile.seed)*13;
    let check=0;
    for(let k=0;k<(itemId==='magic_log'?11:8);k++){
      const direction=k*2.399+profile.seed*.03;
      const delta=Math.atan2(Math.sin(a-direction),Math.cos(a-direction));
      const length=itemId==='magic_log'?(k%3===0?.04:.31+hash(k+profile.seed)*.3):.23+hash(k+profile.seed)*.49;
      if(r>length&&Math.abs(delta+.006*Math.sin(r*31+k))<(itemId==='magic_log'?.006:.0024)+.002*r)check=1;
    }
    const saw=Math.sin(u*2600+v*35)*2;
    const c=fine+grain+saw-check*(itemId==='magic_log'?98:84);
    if(itemId==='yew_log'){
      const sap=THREE.MathUtils.smoothstep(rr,.80,.84),heart=Math.max(0,1-rr*1.9);
      return [(190-heart*29-late*28)*(1-sap)+sap*239+c,(72+rr*28-heart*20-late*24)*(1-sap)+sap*194+c,(39+rr*11-late*15)*(1-sap)+sap*137+c];
    }
    if(itemId==='teak_log'){
      const heart=Math.max(0,1-rr*1.12),band=Math.sin(rr*29)*11;
      return [203-heart*66-late*28+band+c,126-heart*65-late*22+band+c,47-heart*27-late*13+band*.5+c];
    }
    if(itemId==='magic_log'){
      const rim=THREE.MathUtils.smoothstep(rr,.92,1.02),band=Math.sin(rr*34)*8;
      return [105+late*70+rim*63+band+c,126+late*66+rim*49+band+c,148+late*48+rim*21+band+c];
    }
    const heart=Math.max(0,1-rr*2),zone=(.5+.5*Math.sin(rr*22+.6))**3*(1-THREE.MathUtils.smoothstep(rr,.86,1));
    return [232-heart*25-zone*12-late*24+c,197-heart*35-zone*27-late*31+c,157-heart*29-zone*27-late*26+c];
  });
  const bark = new THREE.MeshStandardMaterial({name:`${itemId} irregular weathered bark`,map:barkMap,vertexColors:true,roughness:.94});
  const dark = new THREE.MeshStandardMaterial({name:`${itemId} continuous fibrous fissure bed`,map:barkMap,color:itemId==='yew_log'?'#cb7257':'#aa9280',roughness:1});
  const edge = new THREE.MeshStandardMaterial({name:`${itemId} broken cambium and bark edges`,color:profile.edge,roughness:.97});
  const wood = new THREE.MeshStandardMaterial({name:`${itemId} species growth rings`,map:woodMap,roughness:.86});

  // Entire closed wood volume underneath the bark, including two independently UV-mapped cut ends.
  const p: number[] = [], uv: number[] = [], ids: number[] = []; const n = 128, rows = 24;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= n; i++) {
    const a = i / n * TAU, z = -.269 + j / rows * .538;
    p.push(...cylindrical(a, radius(a,z), z)); uv.push(i/n,j/rows);
    if (i < n && j < rows) { const q = j*(n+1)+i; ids.push(q,q+1,q+n+1,q+1,q+n+2,q+n+1); }
  }
  mesh(root, `${itemId} continuous solid dark bark bed`, geometry(p,uv,ids),dark);
  for (const sign of [-1,1]) {
    const ep: number[] = [0,0,sign*.270], eu: number[] = [.5,.5], ei: number[] = [];
    for (let j = 1; j <= 14; j++) for (let i = 0; i <= n; i++) {
      const a = i/n*TAU, r = radius(a,sign*.269) * j/14;
      ep.push(...cylindrical(a,r,sign*(.270 + .00022*Math.sin(r*900)))); eu.push(.5+Math.cos(a)*r/.23,.5+Math.sin(a)*r/.23);
      const q = 1+(j-1)*(n+1)+i;
      if(i<n) { if(j===1) ei.push(0,q,q+1); else ei.push(q-n-1,q,q+1,q-n-1,q+1,q-n); }
    }
    if(sign<0) for(let k=0;k<ei.length;k+=3) [ei[k+1],ei[k+2]]=[ei[k+2]!,ei[k+1]!];
    mesh(root,sign>0?`${itemId} ringed front cut face`:`${itemId} ringed rear cut face`,geometry(ep,eu,ei),wood);
  }

  // Anisotropic Voronoi fractures from scattered seeds. No rows, columns, courses or
  // repeated outlines. Axial stretching makes long splinters among broader flakes.
  const bp: number[]=[], bu: number[]=[], bi: number[]=[], bc: number[]=[], wp: number[]=[], wu: number[]=[], wi: number[]=[];
  type Point = [number,number];
  const circumference=TAU*.115, stretch=profile.stretch;
  const seeds: Point[]=Array.from({length:profile.plateCount},(_,i)=>[hash(i*19+23+profile.seed)*circumference,(-.270+hash(i*17+67+profile.seed)*.540)*stretch]);
  function clip(poly:Point[],nx:number,ny:number,limit:number):Point[] {
    const out:Point[]=[];
    for(let k=0;k<poly.length;k++) {
      const a=poly[k]!,b=poly[(k+1)%poly.length]!,da=a[0]*nx+a[1]*ny-limit,db=b[0]*nx+b[1]*ny-limit;
      if(da<=0)out.push(a);
      if((da<0)!==(db<0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
    }
    return out;
  }
  for(let index=0;index<seeds.length;index++) {
      const [sx,sy]=seeds[index]!,seed=index*71+profile.seed,cz=sy/stretch;
      let polygon:Point[]=[[sx-circumference/2,-.270*stretch],[sx+circumference/2,-.270*stretch],[sx+circumference/2,.270*stretch],[sx-circumference/2,.270*stretch]];
      for(let other=0;other<seeds.length;other++)for(const wrap of [-1,0,1]) {
        if(other===index&&wrap===0)continue;
        const [qx,qy]=seeds[other]!,ox=qx+wrap*circumference;
        polygon=clip(polygon,ox-sx,qy-sy,(ox*ox+qy*qy-sx*sx-sy*sy)/2);
      }
      const warp=(x:number,z:number)=>x/.115+profile.warp*Math.sin(z*18+x*21)+.023*Math.sin(z*43+x*51);
      const ca=warp(sx,cz),top=.0018+hash(seed+4)*profile.relief;
      const points: [number,number][]=[];
      for(let edgeIndex=0;edgeIndex<polygon.length;edgeIndex++)for(let k=0;k<4;k++) {
        const pa=polygon[edgeIndex]!,pb=polygon[(edgeIndex+1)%polygon.length]!,t=k/4;
        const inset=.987-(k===2?hash(seed+edgeIndex*43)*.13:hash(seed+k*11+edgeIndex)*.035);
        const x=sx+(pa[0]+(pb[0]-pa[0])*t-sx)*inset;
        const z=cz+(pa[1]+(pb[1]-pa[1])*t-sy)/stretch*inset;
        points.push([warp(x,z),z]);
      }
      const sides=points.length;
      const shade=hash(seed+40),grey=hash(seed+17)>.50;
      const tint=new THREE.Color().setRGB(.73+shade*.27,grey?.80+shade*.20:.69+shade*.27,grey?.90+shade*.10:.64+shade*.29);
      if(itemId==='yew_log'&&grey)tint.multiplyScalar(.65);
      const push=(a:number,z:number,r:number)=>{bp.push(...cylindrical(a,r,z));bu.push(a/TAU*3,(z+.27)/.54);bc.push(tint.r,tint.g,tint.b);};
      const start=bp.length/3;push(ca,cz,radius(ca,cz)+top);
      for(let ring=0;ring<2;ring++) for(let k=0;k<sides;k++) {
        const [oa,oz]=points[k]!,fac=ring===0?.88:1;
        const a=ca+(oa-ca)*fac,z=cz+(oz-cz)*fac;
        push(a,z,radius(a,z)+top*(ring===0?1:.52)+.00035*Math.sin(seed+k*7));
        if(ring===0)bi.push(start,start+1+k,start+1+(k+1)%sides);
        else {const q=start+1+k,b=start+1+(k+1)%sides;bi.push(q,q+sides,b+sides,q,b+sides,b);}
      }
      for(let k=0;k<sides;k++) {
        const [a,z]=points[k]!,[a2,z2]=points[(k+1)%sides]!,q=wp.length/3;
        wp.push(...cylindrical(a,radius(a,z)+top*.52,z),...cylindrical(a,radius(a,z),z),...cylindrical(a2,radius(a2,z2)+top*.52,z2),...cylindrical(a2,radius(a2,z2),z2));
        wu.push(0,1,0,0,1,1,1,0);wi.push(q,q+1,q+2,q+2,q+1,q+3);
      }
  }
  const plates=geometry(bp,bu,bi);plates.setAttribute('color',new THREE.Float32BufferAttribute(bc,3));
  mesh(root,`${itemId} irregular fractured and peeling bark plates`,plates,bark);
  mesh(root,`${itemId} exposed undercut plate edges`,geometry(wp,wu,wi),edge);
  // Raised mineral-like silver-blue veins follow the twisting magic bark, with actual tubular relief.
  if(itemId==='magic_log') {
    const vein=new THREE.MeshStandardMaterial({name:'Magic silver blue winding bark veins',color:'#9dbad3',metalness:.24,roughness:.48});
    const blue=new THREE.MeshStandardMaterial({name:'Magic blue vein borders',color:'#3e6d9e',metalness:.12,roughness:.62});
    for(let k=0;k<7;k++){
      const points:THREE.Vector3[]=[];
      for(let j=0;j<=65;j++){
        const z=-.263+j/65*.526,a=k*TAU/7+.21*Math.sin(z*15+k*1.71)+.045*Math.sin(z*43+k);
        const r=radius(a,z)+.009;
        points.push(new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r,z));
      }
      const path=new THREE.CatmullRomCurve3(points);
      mesh(root,`Magic winding blue vein ${k}`,new THREE.TubeGeometry(path,100,.0018,5,false),blue);
      mesh(root,`Magic winding silver thread ${k}`,new THREE.TubeGeometry(path,100,.00085,5,false),vein);
    }
  }
  root.updateMatrixWorld(true); const bounds=new THREE.Box3().setFromObject(root);
  for(const child of root.children) child.position.y-=bounds.min.y;
  return root;
}

export const author: ItemModelAuthor = {
  ids: ['maple_log','teak_log','yew_log','magic_log'],
  build(itemId) { if(!(itemId in profiles)) throw new Error(`Unsupported log: ${itemId}`); return build(itemId as Species); },
};
