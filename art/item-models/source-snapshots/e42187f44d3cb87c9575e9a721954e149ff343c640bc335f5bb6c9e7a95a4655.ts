import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type Recipe = { id: string; description: string; state: 'raw' | 'roast' | 'burnt'; prime: boolean; length: number; bone: number; radii: number[]; depth: number; seed: number };
const recipes: Recipe[] = [
  { id: 'raw_haunch', description: 'A whole hind quarter off something that lived above the treeline. Heavy.', state: 'raw', prime: false, length: .51, bone: .19, radii: [.027,.052,.087,.125,.157,.169,.153,.108,0], depth: .72, seed: 1 },
  { id: 'roast_haunch', description: "Four hours over Hillcrest coals. It is a meal and most of a day's carrying.", state: 'roast', prime: false, length: .47, bone: .18, radii: [.036,.048,.076,.106,.145,.167,.159,.113,0], depth: .84, seed: 3 },
  { id: 'burnt_haunch', description: 'Ruined, and it was the biggest thing you killed all week.', state: 'burnt', prime: false, length: .46, bone: .18, radii: [.034,.059,.095,.134,.153,.155,.149,.109,0], depth: .72, seed: 7 },
  { id: 'raw_ember_haunch', description: 'A hind quarter off a foothill beast, marbled from a life spent on warm ground.', state: 'raw', prime: true, length: .49, bone: .16, radii: [.039,.055,.105,.155,.192,.208,.206,.178,0], depth: .88, seed: 11 },
  { id: 'roast_ember_haunch', description: 'Cooked slow over walnut coals. Ashford calls it a wage, not a meal.', state: 'roast', prime: true, length: .44, bone: .085, radii: [.045,.066,.122,.179,.205,.206,.185,.134,0], depth: .92, seed: 17 },
  { id: 'burnt_ember_haunch', description: 'The one place in Ashlands where more fire was not the answer.', state: 'burnt', prime: true, length: .49, bone: .14, radii: [.038,.058,.112,.161,.195,.209,.198,.161,0], depth: .89, seed: 23 },
];
const TAU = Math.PI * 2;
const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (x: number): number => Math.max(0, Math.min(1, x));
function cells(u: number, v: number, seed: number): number {
  const x = u * 19, y = v * 15, ix = Math.floor(x), iy = Math.floor(y); let a = 99, b = 99;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const key = ((ix + i + 19) % 19) * 17 + (iy + j) * 129 + seed;
    const d = (ix + i + .18 + hash(key) * .64 - x) ** 2 + (iy + j + .18 + hash(key + 5) * .64 - y) ** 2;
    if (d < a) { b = a; a = d; } else if (d < b) b = d;
  }
  return Math.sqrt(b) - Math.sqrt(a);
}
function seam(u: number, v: number, r: Recipe): number {
  const a = u * TAU;
  const longitudinal = Math.abs(Math.sin(a * 3 + .7 * Math.sin(v * 7 + r.seed) + v * 2));
  const diagonal = Math.abs(Math.sin(v * (r.prime ? 9 : 12) + a * 1.4 + .6 * Math.sin(a * 2)));
  const fatCap = r.prime && r.state === 'raw' ? clamp((.35 - Math.abs(v - .61 - .06 * Math.sin(a))) * 4) * clamp((Math.cos(a - 1.2) - .3) * 3) : 0;
  return Math.max(clamp((.095 - longitudinal) * 15), clamp((.085 - diagonal) * 17) * .85, fatCap);
}
function tex(name: string, sample: (u: number, v: number) => number[], color = true): THREE.DataTexture {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = sample(x / size, y / size), i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, rgb[c]!)); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.name = name; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}
function material(r: Recipe): THREE.MeshPhysicalMaterial {
  const raw = r.state === 'raw', burnt = r.state === 'burnt';
  const map = tex(`${r.id} muscle grain, connective fat and crust`, (u, v) => {
    const s = seam(u,v,r), n = hash(Math.floor(u*512) + Math.floor(v*512)*1024 + r.seed);
    const fiber = Math.sin(u * 2100 + Math.sin(v * 35) * 17 + v * 140) * 5;
    const mottling = Math.sin(u*51+Math.sin(v*17)*3)*Math.sin(v*49)*14;
    const microFat = raw ? clamp((.021 - cells(u*2,v*2,r.seed)) * 24) : 0;
    const f = Math.max(s, microFat*.7);
    if (raw) return [132+f*100+mottling+n*20+fiber, 24+f*177+n*13+fiber, 31+f*154+n*12+fiber];
    const char = burnt ? clamp((cells(u,v,r.seed)-.02)*26) * clamp((Math.sin(u*19+v*7)+1.65)*.72) : clamp((Math.sin(u*39+v*29)-.53)*2);
    const roast = [128+s*64+mottling+n*16+fiber,49+s*53+n*12+fiber,20+s*20+n*8];
    return roast.map((c,k) => c*(1-char*.9)+(burnt ? [14,14,15][k]! : 7)*char);
  });
  const roughnessMap = tex(`${r.id} independent pore roughness`, (u,v) => { const n = hash(Math.floor(u*397)+Math.floor(v*401)*853); const k = (raw ? 88 : burnt ? 177 : 105)+n*37; return [k,k,k]; }, false);
  const normalMap = tex(`${r.id} fine directional muscle pores`, (u,v) => [128+Math.sin(u*1800+Math.sin(v*23)*8)*7,128+Math.sin(v*1350+u*41)*4,254], false);
  const m = new THREE.MeshPhysicalMaterial({ map, roughnessMap, normalMap, normalScale: new THREE.Vector2(.32,.32), roughness: 1, clearcoat: burnt ? .03 : .23, clearcoatRoughness: .34 }); m.name = `${r.id} ${raw ? 'wet red muscle and ivory fascia' : burnt ? 'cracked black crust with dark brown flesh' : 'basted chestnut roast with golden fat'}`; return m;
}
function mesh(root: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry,material); m.name = name; m.castShadow = true; m.receiveShadow = true; root.add(m); return m;
}
function point(r: Recipe, u: number, v: number): THREE.Vector3 {
  const t = Math.min(7.999999,v*8), i = Math.floor(t), f = t-i;
  let radius = THREE.MathUtils.lerp(r.radii[i]!,r.radii[i+1]!,f);
  const a = u*TAU;
  radius *= 1 + .055*Math.sin(a*3+v*7+r.seed)+.025*Math.sin(a*7-v*11);
  radius += Math.sin(Math.PI*v) * (seam(u,v,r)*(r.state==='raw' ? .003 : -.004) + .0008*Math.sin(a*47+v*115));
  if(r.state==='burnt') radius -= Math.sin(Math.PI*v)*clamp((.045-cells(u,v,r.seed))*28)*.0035;
  // Prime raw reference is butcher-cut across the broad end. Keep a solid,
  // nearly planar muscle cross-section instead of closing it as a rounded tip.
  const axial = r.prime && r.state==='raw' && v>.79 ? .79+.012*Math.sin((v-.79)/.21*Math.PI) : v;
  return new THREE.Vector3(Math.cos(a)*radius-.025*Math.sin(v*Math.PI),r.bone-.025+axial*r.length,Math.sin(a)*radius*r.depth+.025*Math.sin(v*Math.PI));
}
function body(r: Recipe): THREE.BufferGeometry {
  const p: number[]=[],uv: number[]=[],idx: number[]=[]; const U=160,V=128;
  for(let j=0;j<=V;j++) for(let i=0;i<=U;i++) { const q=point(r,i/U,j/V); p.push(q.x,q.y,q.z); uv.push(i/U,j/V); }
  for(let j=0;j<V;j++) for(let i=0;i<U;i++){const a=j*(U+1)+i,b=a+U+1;idx.push(a,b,a+1,b,b+1,a+1);}
  // Both ends are closed; the small proximal cap is buried around the inserted bone.
  p.push(0,r.bone-.026,0);uv.push(.5,0);const cap=p.length/3-1;
  for(let i=0;i<U;i++)idx.push(cap,i,i+1);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function build(r: Recipe): THREE.Group {
  const root = new THREE.Group(); root.name = `${r.id} solid hindquarter`;
  root.userData.itemModel = {itemId:r.id, author:'meat-b', reference:`art/item-icons/generated/${r.id}.png`, description:r.description, grip:[0,0,0]};
  const meat = new THREE.Group();meat.name='Asymmetric muscle mass and exposed shank';root.add(meat);
  mesh(meat,'Continuous lobed haunch with modeled fascia valleys and rear muscles',body(r),material(r));
  const boneMap=tex(`${r.id} bone cortex and roasted end stains`,(u,v)=>{const n=hash(Math.floor(u*250)+Math.floor(v*340)*751);const dark=r.state==='raw'?clamp((Math.sin(u*23+v*18)-.75)*3)*.25:clamp((Math.sin(u*17+v*14)+Math.sin(u*33-v*23)-.3)*1.5)*(r.state==='burnt'?.85:.5);return [236-n*15-dark*185,211-n*24-dark*177,171-n*25-dark*145];});
  const boneMat=new THREE.MeshStandardMaterial({map:boneMap,roughness:.48});boneMat.name='Ivory dense cortical bone with residual tissue staining';
  const points:THREE.Vector2[]=[];
  const sawn=r.prime&&r.state==='roast';
  const profile=sawn?[[.0,.027],[.015,.029],[.045,.025],[.09,.029],[r.bone+.03,.035]]:[[0,.031],[.013,.042],[.029,.041],[.05,.026],[r.bone*.52,.021],[r.bone*.83,.025],[r.bone+.025,.033]];
  points.push(new THREE.Vector2(0,0));for(const [y,rad]of profile)points.push(new THREE.Vector2(rad!,y!));points.push(new THREE.Vector2(0,r.bone+.025));
  const bg=new THREE.LatheGeometry(points,48);const pos=bg.getAttribute('position');
  for(let i=0;i<pos.count;i++){const y=pos.getY(i);pos.setX(i,pos.getX(i)+.008*Math.sin(y/r.bone*Math.PI));pos.setZ(i,pos.getZ(i)*(1+.1*Math.cos(y*28)));}bg.computeVertexNormals();
  mesh(meat,sawn?'Short sawn shank with sealed marrow face':'Tapered exposed shank with flared articular condyle',bg,boneMat);
  if(sawn){const marrow=new THREE.MeshStandardMaterial({color:0xb3936c,roughness:.7});marrow.name='Porous marrow in sawn bone';const disk=mesh(meat,'Inset marrow core on sawn end',new THREE.CylinderGeometry(.017,.017,.0015,32),marrow);disk.position.y=-.0008;}
  // Low, solid irregular blisters break the silhouette of the burnt crust.
  if(r.state==='burnt'){
    const crust=new THREE.MeshStandardMaterial({color:0x231b17,roughness:.79});crust.name='Raised brittle charcoal blisters';
    for(let i=0;i<54;i++){const u=hash(i*7+r.seed),v=.16+hash(i*11+9)*.7,q=point(r,u,v);const g=new THREE.IcosahedronGeometry(.006+hash(i+89)*.007,1);const b=mesh(meat,`Char blister ${i+1}`,g,crust);b.position.copy(q);b.scale.set(1,.7,.46);b.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(Math.cos(u*TAU),.1,Math.sin(u*TAU)).normalize());}
  }
  meat.rotation.x=r.prime&&r.state==='raw'?.52:.22;meat.position.y=-.04;
  return root;
}
export const author: ItemModelAuthor = { ids: recipes.map(r=>r.id), build(id) { const r=recipes.find(r=>r.id===id);if(!r)throw new Error(`meat-b does not own ${id}`);return build(r); } };
