import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// Each species is authored from its approved icon. The fracture construction is
// derived from the accepted pilot, with independent silhouettes, scale density,
// axial stretch, bark relief, pith position, sapwood and growth/check structure.
type Species = { seed:number; label:string; r:number; plates:number; stretch:number; relief:number; bark:readonly number[]; wood:readonly number[]; heart:readonly number[]; sap:number; rings:number; checks:number; pith:readonly [number,number]; description:string };
const species:Record<string,Species> = {
  duskoak_log:{seed:113,label:'Duskoak',r:.124,plates:185,stretch:.73,relief:.006,bark:[101,91,80],wood:[224,193,150],heart:[140,96,52],sap:.73,rings:17,checks:9,pith:[.466,.43],description:'Broad dark grey oak fracture plates, buff outer sapwood and eccentric honey-brown heartwood with strong annual rings.'},
  cairnpine_log:{seed:271,label:'Cairnpine',r:.116,plates:163,stretch:.53,relief:.005,bark:[108,97,84],wood:[166,119,69],heart:[151,101,54],sap:1.1,rings:28,checks:17,pith:[.483,.47],description:'Dense weathered brown-grey pine scales and dry ochre endgrain with fine close rings, pale medullary rays and deep radial checking.'},
  cinderpine_log:{seed:431,label:'Cinderpine',r:.12,plates:211,stretch:.40,relief:.0065,bark:[91,80,73],wood:[235,196,148],heart:[92,43,20],sap:.86,rings:26,checks:8,pith:[.48,.451],description:'Narrow charcoal-brown fissured bark plates, a narrow cream sapwood ring and dense dark burnt-umber heartwood with amber rings.'},
  willow_log:{seed:617,label:'Willow',r:.119,plates:112,stretch:.33,relief:.006,bark:[147,139,127],wood:[238,203,166],heart:[213,157,129],sap:.77,rings:19,checks:10,pith:[.47,.436],description:'Long pale silver-grey flaky bark strips over warm brown crevices, soft salmon-pink eccentric grain and a pale cream outer band.'},
};
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
function cylindrical(a: number, r: number, z: number): number[] { return [Math.cos(a) * r, Math.sin(a) * r, z]; }
function mesh(root: THREE.Group, name: string, g: THREE.BufferGeometry, m: THREE.Material): void {
  const value = new THREE.Mesh(g, m); value.name = name; value.castShadow = true; value.receiveShadow = true; root.add(value);
}
function build(itemId:string, cfg:Species): THREE.Group {
  function radius(a:number,z:number):number {return cfg.r + .0037*Math.sin(a*3+cfg.seed)+.0022*Math.cos(a*7-z*4)+.0014*Math.sin(z*19+a*2)+.0007*Math.sin(a*29)+.0011*Math.sin(a*43+z*9); }
  const root=new THREE.Group(); root.name=cfg.label+' solid cut log';
  root.userData.itemModel={itemId,author:'logs-a',reference:`art/item-icons/generated/${itemId}.png`,description:cfg.description+' Solid horizontal 0.54 m log, Y-up, front cut at +Z, grounded at zero.'};
  const barkHeight=(u:number,v:number):number=>{
    const wave=u*(cfg.label==='Willow'?37:51)+.16*Math.sin(v*27)+.045*Math.sin(v*139);
    const fissure=Math.pow(Math.max(0,Math.cos(wave*TAU)),24);
    const grain=Math.sin(u*750+Math.sin(v*93)*1.4)*.12+Math.sin(u*1530+v*50)*.06;
    const cross=Math.max(0,Math.sin(v*187+Math.sin(u*61)*3))**20;
    return .55-fissure*.38+grain-cross*.13;
  };
  const barkMap=texture(cfg.label+' mottled weathered fibrous bark',1024,(u,v)=>{
    const h=barkHeight(u,v),noise=hash(Math.floor(u*1024)+Math.floor(v*1024)*1031+cfg.seed);
    const patch=Math.sin(u*33+Math.sin(v*23))*Math.sin(v*43-u*7);
    const c=(h-.5)*47+noise*20+patch*12;
    return [cfg.bark[0]!+c,cfg.bark[1]!+c,cfg.bark[2]!+c];
  });
  barkMap.wrapS=THREE.RepeatWrapping;
  const normal=texture(cfg.label+' fine split fibre normals',1024,(u,v)=>{
    const dx=(barkHeight(u+.0009,v)-barkHeight(u-.0009,v))*.64;
    const dy=(barkHeight(u,v+.0009)-barkHeight(u,v-.0009))*.64;
    const n=new THREE.Vector3(-dx,-dy,1).normalize();return [(n.x*.5+.5)*255,(n.y*.5+.5)*255,(n.z*.5+.5)*255];
  });normal.colorSpace=THREE.NoColorSpace;normal.wrapS=THREE.RepeatWrapping;
  const woodMap=texture(cfg.label+' species annual rings and drying checks',1024,(u,v)=>{
    const x=(u-cfg.pith[0])*2,y=(v-cfg.pith[1])*2,a=Math.atan2(y,x),r=Math.hypot(x,y);
    const rr=r*(1+.020*Math.sin(a*3)+.008*Math.sin(a*7))+.007*Math.sin(a*2+r*17);
    const growth=rr*cfg.rings+.22*Math.sin(rr*15)+.13*Math.sin(rr*39);
    const late=Math.exp(-Math.pow(((growth%1)-.78)/.065,2));
    const fine=Math.sin(rr*1500+Math.sin(a*13)*3)*2.2;
    let check=0;
    for(let k=0;k<cfg.checks;k++) {
      const direction=k*2.399+hash(k+cfg.seed)*.25;
      const delta=Math.atan2(Math.sin(a-direction),Math.cos(a-direction));
      const start=cfg.label==='Cairnpine'?.055+hash(k+11)*.3:.22+hash(k+11)*.51;
      if(r>start&&Math.abs(delta+.006*Math.sin(r*31+k))<.0025+.003*r)check=1;
    }
    const ray=cfg.label==='Cairnpine'?Math.max(0,Math.cos(a*107+Math.sin(r*41)*.14))**32*27:0;
    const grain=hash(Math.floor(u*1024)+1024*Math.floor(v*1024))*8;
    const c=-late*(cfg.label==='Cinderpine'?-21:24)+fine+grain+Math.sin(u*2900+v*15)*1.5+ray-check*76;
    const heart=cfg.label==='Cinderpine'?1-THREE.MathUtils.smoothstep(rr,cfg.sap-.018,cfg.sap+.018):1-THREE.MathUtils.smoothstep(rr,cfg.sap-.34,cfg.sap);
    return [0,1,2].map(k=>cfg.wood[k]!*(1-heart)+cfg.heart[k]!*heart+c);
  });
  const bark = new THREE.MeshStandardMaterial({ name: cfg.label+' flaky bark faces', map: barkMap, normalMap:normal, normalScale:new THREE.Vector2(.85,.85), vertexColors: true, roughness: .94 });
  const dark = new THREE.MeshStandardMaterial({ name: cfg.label+' dark fibrous bark bed', map: barkMap, normalMap:normal, color: '#817366', roughness: 1 });
  const edge = new THREE.MeshStandardMaterial({ name: cfg.label+' chipped bark fracture edges', color: '#795037', roughness: .95 });
  const wood = new THREE.MeshStandardMaterial({ name: cfg.label+' cut annual endgrain', map: woodMap, roughness: .84 });

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
      ep.push(...cylindrical(a,r,sign*(.270 + .00022*Math.sin(r*900)))); eu.push(.5+Math.cos(a)*r/(cfg.r*2),.5+Math.sin(a)*r/(cfg.r*2));
      const q = 1+(j-1)*(n+1)+i;
      if(i<n) { if(j===1) ei.push(0,q,q+1); else ei.push(q-n-1,q,q+1,q-n-1,q+1,q-n); }
    }
    if(sign<0) for(let k=0;k<ei.length;k+=3) [ei[k+1],ei[k+2]]=[ei[k+2]!,ei[k+1]!];
    mesh(root,cfg.label+(sign>0?' ringed front cut face':' ringed rear cut face'),geometry(ep,eu,ei),wood);
  }

  // Anisotropic Voronoi fractures from scattered seeds. No rows, columns, courses or
  // repeated outlines. Axial stretching makes long splinters among broader flakes.
  const bp: number[]=[], bu: number[]=[], bi: number[]=[], bc: number[]=[], wp: number[]=[], wu: number[]=[], wi: number[]=[];
  type Point = [number,number];
  const circumference=TAU*cfg.r, stretch=cfg.stretch;
  const seeds: Point[]=Array.from({length:cfg.plates},(_,i)=>[hash(i*19+cfg.seed)*circumference,(-.270+hash(i*17+cfg.seed+41)*.540)*stretch]);
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
      const warp=(x:number,z:number)=>x/cfg.r+.055*Math.sin(z*18+x*21)+.023*Math.sin(z*43+x*51);
      const ca=warp(sx,cz),top=.002+hash(seed+4)*cfg.relief;
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
      const tint=new THREE.Color().setRGB(.77+shade*.23,.76+shade*.24,grey?.84+shade*.16:.74+shade*.23);
      const push=(a:number,z:number,r:number)=>{bp.push(...cylindrical(a,r,z));bu.push(a/TAU,(z+.27)/.54);bc.push(tint.r,tint.g,tint.b);};
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
  mesh(root,cfg.label+' irregular axial fracture plates',plates,bark);
  mesh(root,cfg.label+' exposed plate undercuts',geometry(wp,wu,wi),edge);
  root.updateMatrixWorld(true); const bounds=new THREE.Box3().setFromObject(root);
  for(const child of root.children) child.position.y-=bounds.min.y;
  return root;
}

export const author:ItemModelAuthor={
  ids:Object.keys(species),
  build(itemId){const cfg=species[itemId];if(!cfg)throw new Error(`Unsupported logs-a item: ${itemId}`);return build(itemId,cfg);},
};
