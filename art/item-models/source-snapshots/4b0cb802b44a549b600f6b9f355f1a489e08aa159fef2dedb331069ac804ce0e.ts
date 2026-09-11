import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// Authored from the approved cut-pine photograph: short, thick section, plate bark,
// thin ragged cambium rim, eccentric pale growth rings and drying checks.
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
function radius(a: number, z: number): number {
  return .115 + .0037 * Math.sin(a * 3 + .7) + .0019 * Math.cos(a * 7 - z * 4) + .001 * Math.sin(z * 19 + a * 2) + .0007 * Math.sin(a * 29) + .0011 * Math.sin(a * 43 + z * 9);
}
function cylindrical(a: number, r: number, z: number): number[] { return [Math.cos(a) * r, Math.sin(a) * r, z]; }
function mesh(root: THREE.Group, name: string, g: THREE.BufferGeometry, m: THREE.Material): void {
  const value = new THREE.Mesh(g, m); value.name = name; value.castShadow = true; value.receiveShadow = true; root.add(value);
}
function build(): THREE.Group {
  const root = new THREE.Group(); root.name = 'Palewood log • cut pine';
  root.userData.itemModel = { itemId: 'palewood_log', author: 'pilot-log', reference: 'art/item-icons/generated/palewood_log.png',
    description: 'Solid 0.55 m cut pine section along Z, cut face at +Z, grounded at Y=0. Thick layered rusty cinnamon and grey-brown bark plates, deep longitudinal fissures, chipped cambium rim, eccentric honey-gold endgrain and radial drying checks.' };

  const barkMap = texture('Pine bark • laminated scales and fine longitudinal splits', 512, (u, v) => {
    const wave = u * 21 + .23 * Math.sin(v * 34) + .07 * Math.sin(v * 121);
    const fissure = Math.pow(Math.max(0, Math.cos(wave * TAU)), 35);
    const ridge = .5 + .5 * Math.sin(u * 93 + v * 19 + Math.sin(v * 23));
    const flake = Math.max(0, Math.sin(v * 150 + Math.sin(u * 79) * 2)) ** 22;
    const fleck = hash(Math.floor(u * 460) + Math.floor(v * 460) * 512);
    const grey = Math.max(0, Math.sin(u * 19 + v * 14) * Math.sin(v * 26 - u * 5));
    const brightness = ridge * 25 + fleck * 11 - fissure * 49 + flake * 29;
    return [131 + brightness - grey * 9, 86 + brightness + grey * 10, 61 + brightness + grey * 18];
  });
  barkMap.wrapS = THREE.RepeatWrapping;
  const woodMap = texture('Pale pine cut end • eccentric annual rings and radial checks', 1024, (u, v) => {
    const x = (u - .455) * 2, y = (v - .425) * 2;
    const a = Math.atan2(y, x); const r = Math.sqrt(x*x + y*y);
    const rr = r * (1 + .025 * Math.sin(a * 3) + .008 * Math.sin(a * 7)) + .010 * Math.sin(a * 2 + r * 17);
    const growth = rr * 19 + .28 * Math.sin(rr * 15) + .14 * Math.sin(rr * 37);
    const late = Math.exp(-Math.pow(((growth % 1) - .78) / .060, 2));
    const fine = .5 + .5 * Math.sin(rr * 1750 + Math.sin(a * 13) * 3);
    let check = 0;
    for (let k = 0; k < 8; k++) {
      const direction = k * 2.399 + .11 * Math.sin(k * 11);
      const delta = Math.atan2(Math.sin(a - direction), Math.cos(a - direction));
      const length = .43 + hash(k + 10) * .34;
      if (r > length && Math.abs(delta + .009 * Math.sin(r * 33 + k)) < .004 + .003 * r) check = 1;
    }
    const saw = Math.sin(u * 2900 + v * 15) * 2.5;
    const grain = hash(Math.floor(u * 1024) + 1024 * Math.floor(v * 1024)) * 8;
    const c = -late * 39 + fine * 8 + grain + saw - check * 96;
    const heart = Math.max(0, 1 - r * 1.7);
    return [230 + c - heart * 12, 187 + c - heart * 24, 121 + c - heart * 18];
  });
  const bark = new THREE.MeshStandardMaterial({ name: 'Cinnamon and weathered grey pine plate faces', map: barkMap, vertexColors: true, roughness: .94 });
  const dark = new THREE.MeshStandardMaterial({ name: 'Connected fibrous brown trunk beneath shallow plate fissures', map: barkMap, color: '#a08b79', roughness: 1 });
  const edge = new THREE.MeshStandardMaterial({ name: 'Thin ochre bark fracture edges', color: '#795037', roughness: .95 });
  const wood = new THREE.MeshStandardMaterial({ name: 'Warm pale pine annual endgrain', map: woodMap, roughness: .84 });

  // Entire closed wood volume underneath the bark, including two independently UV-mapped cut ends.
  const p: number[] = [], uv: number[] = [], ids: number[] = []; const n = 128, rows = 24;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= n; i++) {
    const a = i / n * TAU, z = -.269 + j / rows * .538;
    p.push(...cylindrical(a, radius(a,z), z)); uv.push(i/n,j/rows);
    if (i < n && j < rows) { const q = j*(n+1)+i; ids.push(q,q+1,q+n+1,q+1,q+n+2,q+n+1); }
  }
  mesh(root, 'Continuous solid dark bark bed', geometry(p,uv,ids),dark);
  for (const sign of [-1,1]) {
    const ep: number[] = [0,0,sign*.270], eu: number[] = [.5,.5], ei: number[] = [];
    for (let j = 1; j <= 14; j++) for (let i = 0; i <= n; i++) {
      const a = i/n*TAU, r = radius(a,sign*.269) * j/14;
      ep.push(...cylindrical(a,r,sign*(.270 + .00022*Math.sin(r*900)))); eu.push(.5+Math.cos(a)*r/.23,.5+Math.sin(a)*r/.23);
      const q = 1+(j-1)*(n+1)+i;
      if(i<n) { if(j===1) ei.push(0,q,q+1); else ei.push(q-n-1,q,q+1,q-n-1,q+1,q-n); }
    }
    if(sign<0) for(let k=0;k<ei.length;k+=3) [ei[k+1],ei[k+2]]=[ei[k+2]!,ei[k+1]!];
    mesh(root,sign>0?'Pale ringed front cut face':'Pale ringed rear cut face',geometry(ep,eu,ei),wood);
  }

  // Anisotropic Voronoi fractures from scattered seeds. No rows, columns, courses or
  // repeated outlines. Axial stretching makes long splinters among broader flakes.
  const bp: number[]=[], bu: number[]=[], bi: number[]=[], bc: number[]=[], wp: number[]=[], wu: number[]=[], wi: number[]=[];
  type Point = [number,number];
  const circumference=TAU*.115, stretch=.51;
  const seeds: Point[]=Array.from({length:138},(_,i)=>[hash(i*19+23)*circumference,(-.270+hash(i*17+67)*.540)*stretch]);
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
      const [sx,sy]=seeds[index]!,seed=index*71,cz=sy/stretch;
      let polygon:Point[]=[[sx-circumference/2,-.270*stretch],[sx+circumference/2,-.270*stretch],[sx+circumference/2,.270*stretch],[sx-circumference/2,.270*stretch]];
      for(let other=0;other<seeds.length;other++)for(const wrap of [-1,0,1]) {
        if(other===index&&wrap===0)continue;
        const [qx,qy]=seeds[other]!,ox=qx+wrap*circumference;
        polygon=clip(polygon,ox-sx,qy-sy,(ox*ox+qy*qy-sx*sx-sy*sy)/2);
      }
      const warp=(x:number,z:number)=>x/.115+.055*Math.sin(z*18+x*21)+.023*Math.sin(z*43+x*51);
      const ca=warp(sx,cz),top=.0022+hash(seed+4)*.0042;
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
      const tint=new THREE.Color().setRGB(.65+shade*.35,grey?.79+shade*.19:.58+shade*.27,grey?.91+shade*.08:.47+shade*.31);
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
  mesh(root,'Irregular connected pine bark strips with angular chipped flaking faces',plates,bark);
  mesh(root,'Exposed undercut edges of pine bark plates',geometry(wp,wu,wi),edge);
  root.updateMatrixWorld(true); const bounds=new THREE.Box3().setFromObject(root);
  for(const child of root.children) child.position.y-=bounds.min.y;
  return root;
}

export const author: ItemModelAuthor = {
  ids: ['palewood_log'],
  build(itemId) { if(itemId!=='palewood_log') throw new Error(`Unsupported log: ${itemId}`); return build(); },
};
