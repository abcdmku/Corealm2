import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Wood = 'pine' | 'ash' | 'oak' | 'walnut' | 'teak' | 'magic';
const specs: Record<string, {wood: Wood; description: string}> = {
  palewood_shaft: {wood: 'pine', description: 'A shaved length of pine. Handle, haft, or half a staff.'},
  duskoak_shaft: {wood: 'ash', description: 'Ash, turned down and oiled. Will not warp in Woodlands damp.'},
  cairnpine_shaft: {wood: 'oak', description: 'Resinous, springy, and heavy. Takes a Cobalt ferrule without splitting.'},
  cinderpine_shaft: {wood: 'walnut', description: 'A straight walnut shaft, shaped and seasoned for rods and staves.'},
  palewood_handle: {wood: 'pine', description: 'A short pine grip, shaped for a Copper tang or tool head.'},
  duskoak_handle: {wood: 'ash', description: 'Oiled ash with enough weight to balance an Iron head.'},
  cairnpine_handle: {wood: 'oak', description: 'Oak shaped around the grain so a Cobalt tang will not split it.'},
  cinderpine_handle: {wood: 'walnut', description: 'An oiled walnut grip shaped to hold a Titanium tang securely.'},
  teak_handle: {wood: 'teak', description: 'Oiled teak cut for a Cindersteel sword, pickaxe or hatchet.'},
  magic_handle: {wood: 'magic', description: 'A carved magic-wood grip for Nightglass weapons and gathering tools.'},
};
const TAU = Math.PI * 2;
const palette: Record<Wood, readonly [number, number, number]> = {
  pine: [219, 174, 112], ash: [199, 164, 112], oak: [139, 90, 48],
  walnut: [94, 61, 41], teak: [161, 94, 39], magic: [51, 66, 88],
};
function hash(x: number): number { const v = Math.sin(x * 127.1 + 98.37) * 43758.5453; return v - Math.floor(v); }
function tex(name: string, sample: (u: number,v: number) => number[], color = true): THREE.DataTexture {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = sample(x / (size - 1), y / (size - 1));
    for (let c = 0; c < 3; c++) data[(y * size + x) * 4 + c] = Math.max(0, Math.min(255, value[c]!));
    data[(y * size + x) * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.name = name; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
function materials(wood: Wood, shaft: boolean): {side: THREE.MeshPhysicalMaterial; end: THREE.MeshStandardMaterial} {
  const base = palette[wood];
  const map = tex(`${wood} continuous longitudinal wood grain and pores`, (u,v) => {
    let w = u * TAU;
    let knot = 0;
    if (wood === 'pine') for (let i = 0; i < (shaft ? 6 : 3); i++) {
      const ku = .12 + hash(i + 42) * .76, kv = .1 + hash(i + 67) * .8;
      const dx = (u - ku) * 26, dy = (v - kv) * (shaft ? 48 : 17);
      const r = Math.sqrt(dx*dx + dy*dy);
      w += .11 * Math.exp(-r * .5) * Math.sin(Math.atan2(dy, dx));
      knot += Math.exp(-r*r * 3) * 58 + Math.exp(-r*r * .8) * (10 + 9 * Math.sin(r * 22));
    }
    const flow = w * (wood === 'walnut' ? 6 : 11) + 1.5 * Math.sin(v * 6 + Math.sin(w * 3)) + .38 * Math.sin(v * 21 + w * 2);
    const late = Math.pow(.5 + .5 * Math.sin(flow), 12);
    const fine = Math.sin(w * 117 + 2 * Math.sin(v * 27 + w * 4));
    const fiber = Math.sin(w * 269 + 4 * Math.sin(v * 8 + w));
    const pore = hash(Math.floor(u * 511) + Math.floor(v * 511) * 512);
    const ray = wood === 'oak' ? Math.pow(Math.max(0, Math.sin(v * 155 + w * 9)), 18) * Math.pow(Math.max(0, Math.sin(w * 14)), 8) * 29 : 0;
    const broad = Math.sin(flow * .38) * (wood === 'walnut' ? 15 : 8);
    const c = 13 - late * (wood === 'ash' ? 61 : 38) + fine * 5 + fiber * 3 + broad - knot + ray - (pore > .93 ? 19 : 0);
    return base.map((b, i) => b + c * (i === 2 ? .76 : 1));
  });
  const rough = tex(`${wood} fine independent pore roughness`, (u,v) => {
    const c = (wood === 'pine' ? 165 : wood === 'oak' ? 148 : 110) + 15 * Math.sin(u * 720 + Math.sin(v * 21)) + hash(Math.floor(u * 512) + Math.floor(v * 512) * 713) * 22;
    return [c,c,c];
  }, false);
  const normal = tex(`${wood} shallow polished fiber normal`, (u,v) => [128 + 5 * Math.sin(u * 680 + Math.sin(v * 22)), 128 + 2 * Math.cos(v * 135 + u * 54), 255], false);
  const side = new THREE.MeshPhysicalMaterial({map, roughnessMap: rough, normalMap: normal, roughness: 1, normalScale: new THREE.Vector2(.42,.42), clearcoat: wood === 'pine' ? .08 : .22, clearcoatRoughness: .45});
  side.name = `${wood} worked longitudinal grain`;
  const endMap = tex(`${wood} exposed growth rings`, (u,v) => {
    const x = (u-.46)*2, z = (v-.43)*2, a = Math.atan2(z,x);
    const r = Math.sqrt(x*x+z*z) * (1+.05*Math.sin(a*3));
    const ring = Math.pow(.5+.5*Math.sin(r*99 + .5*Math.sin(a*4+r*10)), 9);
    const c = -ring*38 + 8*Math.sin(r*490) + hash(Math.floor(u*512)+Math.floor(v*512)*512)*12 - 8;
    return base.map(b => b+c);
  });
  const end = new THREE.MeshStandardMaterial({map: endMap, roughness: .68}); end.name = `${wood} endgrain on both sawn ends`;
  return {side,end};
}
function mesh(root: THREE.Group,name: string,g: THREE.BufferGeometry,m: THREE.Material): THREE.Mesh {
  const obj = new THREE.Mesh(g,m); obj.name = name; obj.castShadow = true; obj.receiveShadow = true; root.add(obj); return obj;
}
type Section = readonly [number, number];
function radiusAt(profile: readonly Section[], t: number): number {
  for (let k=1;k<profile.length;k++) {
    const a=profile[k-1]!,b=profile[k]!;
    if(t<=b[0]) {const q=(t-a[0])/(b[0]-a[0]); return THREE.MathUtils.lerp(a[1],b[1],q*q*(3-2*q));}
  }
  return profile[profile.length-1]![1];
}
function turned(root: THREE.Group, name: string, profile: readonly Section[], bottom: number, length: number, sides: number, mat: THREE.Material, end: THREE.Material, magic=false, facet=false): void {
  const p:number[]=[],uv:number[]=[],ix:number[]=[]; const rows=192;
  for(let j=0;j<=rows;j++) for(let i=0;i<=sides;i++) {
    const t=j/rows,a=i/sides*TAU; let r=radiusAt(profile,t);
    if(magic) {
      // Carving follows three winding leaf channels around the whole grip, including its back.
      const wave=a*3-1.8*Math.sin(t*TAU)-t*4;
      r -= .0017*Math.exp(-Math.pow(Math.sin(wave)*7,2))*Math.sin(Math.PI*t)**.4;
    }
    if(facet) r *= 1+.005*Math.sin(a*5+t*12);
    p.push(Math.sin(a)*r,bottom+t*length,Math.cos(a)*r); uv.push(i/sides,t);
    if(j<rows && i<sides) {const n=j*(sides+1)+i; ix.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);}
  }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(ix); g.computeVertexNormals();
  mesh(root,name,g,mat);
  for(const top of [false,true]) {
    const r=radiusAt(profile,top?1:0), y=bottom+(top?length:0);
    const cap=new THREE.CircleGeometry(r,sides); cap.rotateX(top?-Math.PI/2:Math.PI/2); cap.translate(0,y,0);
    mesh(root,`${name} ${top?'top':'heel'} endgrain`,cap,end);
  }
}
function tenon(root:THREE.Group, width:number,bottom:number,length:number,mat:THREE.Material,end:THREE.Material):void {
  const b=width/2,c=.0015;
  const shape=new THREE.Shape(); shape.moveTo(-b+c,-b);shape.lineTo(b-c,-b);shape.quadraticCurveTo(b,-b,b,-b+c);shape.lineTo(b,b-c);shape.quadraticCurveTo(b,b,b-c,b);shape.lineTo(-b+c,b);shape.quadraticCurveTo(-b,b,-b,b-c);shape.lineTo(-b,-b+c);shape.quadraticCurveTo(-b,-b,-b+c,-b);
  const g=new THREE.ExtrudeGeometry(shape,{depth:length,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.0007,bevelThickness:.0007,curveSegments:4});
  g.rotateX(-Math.PI/2);g.translate(0,bottom,0);
  // Reproject the side UVs so the grain runs along the tenon instead of across it.
  const pos=g.getAttribute('position'),uv=g.getAttribute('uv');
  for(let i=0;i<pos.count;i++) uv.setXY(i,(pos.getX(i)+pos.getZ(i))/(width*4)+.5,(pos.getY(i)-bottom)/length);
  mesh(root,'Chamfered square wooden attachment tenon',g,mat);
  const cap=new THREE.ShapeGeometry(shape);cap.rotateX(-Math.PI/2);cap.translate(0,bottom+length+.00072,0);
  const cp=cap.getAttribute('position'),cu=cap.getAttribute('uv');for(let i=0;i<cp.count;i++)cu.setXY(i,cp.getX(i)/width+.5,cp.getZ(i)/width+.5);
  mesh(root,'Square tenon exposed crossgrain',cap,end);
}
export const author: ItemModelAuthor = {
  ids: Object.keys(specs),
  build(id) {
    const spec=specs[id];if(!spec)throw new Error(`Unknown wood component ${id}`);
    const shaft=id.endsWith('_shaft'),root=new THREE.Group();root.name=id;
    root.userData.itemModel={itemId:id,author:'wood-components',reference:`art/item-icons/generated/${id}.png`,description:spec.description,grip:[0,0,0]};
    const {side,end}=materials(spec.wood,shaft);
    if(shaft) {
      const r=spec.wood==='pine'?.025:spec.wood==='ash'?.024:.027;
      const profile:Section[]=spec.wood==='ash' ? [[0,r*.94],[.005,r],[.065,r],[.071,r*1.12],[.081,r*1.12],[.087,r],[.913,r],[.919,r*1.12],[.929,r*1.12],[.935,r],[.995,r],[1,r*.94]] : [[0,r*.92],[.004,r],[.24,r*.996],[.6,r*.982],[.996,r*.99],[1,r*.90]];
      turned(root,`${spec.wood} ${spec.wood==='ash'?'turned shaft with integral end beads':'shaved shaft with chamfered ends'}`,profile,-.15,1.12,spec.wood==='pine'?16:spec.wood==='ash'?48:8,side,end,false,true);
    } else {
      const profiles:Record<Wood,Section[]>={
        pine:[[0,.026],[.015,.028],[.045,.028],[.20,.021],[.44,.026],[.58,.026],[.80,.022],[.95,.029],[1,.026]],
        ash:[[0,.026],[.02,.027],[.21,.019],[.45,.023],[.58,.024],[.82,.019],[.97,.025],[1,.023]],
        oak:[[0,.029],[.025,.031],[.065,.030],[.24,.021],[.46,.028],[.61,.028],[.84,.023],[.98,.030],[1,.027]],
        walnut:[[0,.028],[.03,.030],[.22,.022],[.45,.030],[.57,.031],[.83,.023],[.97,.028],[1,.026]],
        teak:[[0,.029],[.025,.030],[.22,.021],[.51,.026],[.7,.029],[.92,.027],[1,.024]],
        magic:[[0,.028],[.025,.030],[.20,.021],[.43,.026],[.58,.027],[.81,.021],[.98,.029],[1,.027]],
      };
      const profile=profiles[spec.wood],bottom=-.11,length=spec.wood==='teak'?.24:.22;
      turned(root,`${spec.wood} sculpted palm swell and flared grip`,profile,bottom,length,96,side,end,spec.wood==='magic');
      tenon(root,.031,bottom+length-.001,.035,side,end);
      if(spec.wood==='magic') {
        const edge=new THREE.MeshStandardMaterial({color:0x8b99aa,roughness:.49,metalness:.12});edge.name='Pale exposed magic wood on carved leaf edges';
        for(let k=0;k<6;k++) {
          const points:THREE.Vector3[]=[];
          for(let j=0;j<=100;j++) {const t=.035+j/100*.93,a=(k*Math.PI+1.8*Math.sin(t*TAU)+t*4)/3+.018;const r=radiusAt(profile,t)-.00018;points.push(new THREE.Vector3(Math.sin(a)*r,bottom+t*length,Math.cos(a)*r));}
          mesh(root,`Carved winding leaf lip ${k+1}`,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),100,.00026,5,false),edge);
        }
      }
    }
    return root;
  },
};
