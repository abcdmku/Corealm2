import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
type P = readonly [number, number, number];
const h = (n: number) => { const q = Math.sin(n * 127.17 + 73.13) * 43758.5453; return q - Math.floor(q); };
const v = (p: P) => new THREE.Vector3(...p);
function tex(name: string, sample: (u: number, v: number) => number[]): THREE.DataTexture {
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = sample(x / size, y / size), i = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, Math.max(0, c[k]!)); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.name = name; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; return t;
}
function material(name: string, color: string, roughness = .65, map?: THREE.DataTexture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ name, color, roughness, map: map ?? null, clearcoat: roughness < .4 ? .35 : 0, clearcoatRoughness: .25 });
}
function speckle(name: string, rgb: P, strength: number): THREE.DataTexture {
  return tex(name, (u, w) => { const n = h(Math.floor(u * 512) + 512 * Math.floor(w * 512)); const broad = Math.sin(u * 51 + Math.sin(w * 28)) * Math.sin(w * 39); const d = (n - .5) * strength + broad * strength * .35; return rgb.map(c => c + d); });
}
function mesh(root: THREE.Group, name: string, geometry: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat); m.name = name; m.castShadow = m.receiveShadow = true; root.add(m); return m;
}
function ell(root: THREE.Group, name: string, p: P, s: P, mat: THREE.Material, detail = 24): THREE.Mesh {
  const m = mesh(root, name, new THREE.SphereGeometry(1, detail, Math.ceil(detail * .7)), mat); m.position.set(...p); m.scale.set(...s); return m;
}
/** Closed varying elliptical swept volume, with smooth independent path frame. */
function sweep(root: THREE.Group, name: string, points: P[], radii: number[] | ((t: number) => number), depth: number, mat: THREE.Material, rows = 48, sides = 16, cap = true): { curve: THREE.CatmullRomCurve3; frames: ReturnType<THREE.CatmullRomCurve3['computeFrenetFrames']> } {
  const curve = new THREE.CatmullRomCurve3(points.map(v)), frames = curve.computeFrenetFrames(rows, false);
  // Keep the broad anatomical side in XY and its thickness along Z.
  for(let i=0;i<=rows;i++){const tangent=curve.getTangentAt(i/rows);const normal=new THREE.Vector3(tangent.y,-tangent.x,0).normalize();if(normal.lengthSq()>.5){frames.normals[i]=normal;frames.binormals[i]=new THREE.Vector3().crossVectors(tangent,normal).normalize();}}
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  const rad = (t: number) => { if (typeof radii === 'function') return radii(t); const x = t * (radii.length - 1), a = Math.min(radii.length - 2, Math.floor(x)); return THREE.MathUtils.lerp(radii[a]!, radii[a + 1]!, x - a); };
  for (let i = 0; i <= rows; i++) { const t = i / rows, p = curve.getPointAt(t), r = rad(t);
    for (let j = 0; j <= sides; j++) { const a = j / sides * TAU; const q = p.clone().addScaledVector(frames.normals[i]!, Math.cos(a) * r).addScaledVector(frames.binormals[i]!, Math.sin(a) * r * depth); pos.push(q.x,q.y,q.z); uv.push(j / sides,t);
      if (i < rows && j < sides) { const k = i * (sides + 1) + j; indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1); }
    }
  }
  if (cap) for (const i of [0,rows]) { const p = curve.getPointAt(i / rows), k = pos.length / 3; pos.push(p.x,p.y,p.z); uv.push(.5,i/rows); for(let j=0;j<sides;j++) { const q=i*(sides+1)+j; if(i===0) indices.push(k,q+1,q); else indices.push(k,q,q+1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(indices); g.computeVertexNormals(); mesh(root,name,g,mat); return {curve,frames};
}
function rope(root: THREE.Group, center: P, radius: number, mat: THREE.Material, turns = 3): void {
  for (let strand = 0; strand < 3; strand++) {
    const points: P[] = [];
    for(let i=0;i<=120;i++) { const t=i/120, a=t*TAU*turns, b=a*9+strand*TAU/3, r=radius+.0012*Math.cos(b); points.push([center[0]+Math.cos(a)*r,center[1]+(t-.5)*.013+.0012*Math.sin(b),center[2]+Math.sin(a)*r]); }
    sweep(root,`Twisted cord strand ${strand}`,points,[.0011,.0011],1,mat,120,5);
  }
}
function egg(root: THREE.Group): void {
  const map=tex('Ivory shell fine pores and warm ochre freckles',(u,w)=>{const n=h(Math.floor(u*512)+512*Math.floor(w*512)); const x=u*110,y=w*90, dx=x-Math.floor(x)-.5,dy=y-Math.floor(y)-.5;const s=h(Math.floor(x)+Math.floor(y)*111), spot=s>.7&&dx*dx+dy*dy<.015+s*.015; const d=spot?-45*s:(n-.5)*7; return [244+d,223+d*.9,186+d*.8];});
  const m=material('Warm speckled eggshell','#ffffff',.48,map);
  const g=new THREE.SphereGeometry(1,64,48), p=g.getAttribute('position');
  for(let i=0;i<p.count;i++){const y=p.getY(i), r=.022*(1-.18*y); p.setXYZ(i,p.getX(i)*r,y*.030,p.getZ(i)*r); }g.computeVertexNormals(); const e=mesh(root,'Continuous asymmetric chicken eggshell',g,m);e.rotation.z=-.17;
}
function foot(root: THREE.Group): void {
  const furmap=tex('Rabbit underfur cream with longitudinal tawny guard hairs',(u,w)=>{const stripe=Math.sin(u*TAU*230+Math.sin(w*18)*2); const brown=Math.max(0,Math.sin(u*TAU*3+.8)); const d=stripe*15+h(Math.floor(u*512)+Math.floor(w*512)*512)*9;return [218-brown*69+d,195-brown*76+d,156-brown*69+d];});
  const fur=material('Warm tawny and cream rabbit fur','#ffffff',.95,furmap), cream=material('Cream fine guard hairs','#dac5a2',.9), dark=material('Tawny guard hairs','#967456',.93), cord=material('Brown plaited hanging cord','#775239',.88);
  sweep(root,'Tapered furry hindfoot',[[0,-.025,0],[0,.02,0],[.012,.075,-.003],[.017,.105,0]],[.031,.027,.019,.016],.66,fur,40,24);
  for(let i=0;i<3;i++) ell(root,`Distinct furred toe ${i}`,[(i-1)*.020,-.043+(i===1?-.005:0),.004],[.012,.028,.015],fur);
  // Each hair is a closed tapered filament, including the rear and heel.
  for(let i=0;i<650;i++){const t=h(i*3),a=h(i*3+1)*TAU,r=.026-.012*t, x=.015*t+Math.cos(a)*r,z=Math.sin(a)*r*.66,y=-.025+t*.125; const len=.007+h(i+81)*.009;
    sweep(root,`Rabbit guard hair ${i}`,[[x,y,z],[x+Math.cos(a)*.002,y-len*.5,z+Math.sin(a)*.002],[x+Math.cos(a)*.003,y-len,z+Math.sin(a)*.003]],[.00045,.00028,.00003],1,i%4===0?dark:cream,4,3);
  }
  rope(root,[.017,.086,0],.019,cord);sweep(root,'Knotted hanging loop',[[.035,.093,.005],[.051,.077,.005],[.067,.020,0],[.081,.025,0],[.073,.063,0],[.035,.093,.005]],[.0022,.0022],1,cord,48,8);
  ell(root,'Cord knot',[.037,.091,.004],[.004,.005,.004],cord,12);
}
function gland(root: THREE.Group, venom: boolean): void {
  const map=speckle('Mottled gland membrane',venom?[224,218,112]:[204,210,160],21);
  const skin=material('Wet translucent outer membrane','#ffffff',.2,map);skin.transmission=.27;skin.thickness=.012;skin.ior=1.36;
  const fluid=material(venom?'Yellow green venom inside sac':'Pale olive marsh fluid',venom?'#a0b711':'#a0ac68',.15);fluid.transmission=.18;fluid.thickness=.035;
  const vein=material('Fine branching membrane vessels',venom?'#ae7462':'#99915b',.44), rim=material('Folded pale duct tissue',venom?'#d7b88d':'#b6ba85',.28);
  const profile=(t:number)=>.003+.049*Math.sin(Math.PI*Math.pow(t,.64))*(1-.64*t);
  sweep(root,'Whole pear shaped tissue sac',[[0,-.067,0],[-.016,-.036,0],[0,.011,0],[.031,.051,0],[.047,.085,0]],profile,.7,skin,64,40);
  ell(root,'Contained fluid reservoir',[-.008,-.019,0],[.033,.039,.023],fluid,40);
  const neck=new THREE.Mesh(new THREE.TorusGeometry(.0075,.002,10,32),rim);neck.name='Open fleshy duct rolled lip';neck.position.set(.047,.085,0);neck.rotation.x=Math.PI/2;root.add(neck);
  const inner=material('Dark interior of open gland duct',venom?'#6e751b':'#686b3e',.35);ell(root,'Recessed duct lumen',[.046,.081,0],[.0055,.003,.0055],inner,16);
  // Surface vessels conform to the curved front and rear membranes.
  for(const side of [-1,1])for(let j=0;j<7;j++){const a=j*TAU/7, pts:P[]=[];for(let k=0;k<=14;k++){const t=.12+k/14*.78,r=profile(t),p=new THREE.CatmullRomCurve3([[0,-.067,0],[-.016,-.036,0],[0,.011,0],[.031,.051,0],[.047,.085,0]].map(q=>new THREE.Vector3(...q))).getPointAt(t);pts.push([p.x+Math.cos(a+.1*Math.sin(k))*r*.83,p.y,p.z+side*Math.sqrt(1-Math.pow(Math.cos(a)*.83,2))*r*.71]);}
    sweep(root,`Membrane vessel ${side} ${j}`,pts,[.00055,.0003],1,vein,28,4);
    const start=pts[6]!;sweep(root,`Fine capillary fork ${side} ${j}`,[start,[start[0]+.006,start[1]-.004,start[2]],[start[0]+.009,start[1]-.014,start[2]-.002*side]],[.00025,.00003],1,vein,8,3);
  }
  for(let i=0;i<14;i++){const a=h(i+21)*TAU,r=.021*Math.sqrt(h(i+88));ell(root,`Fluid bubble ${i}`,[-.008+Math.cos(a)*r,-.025+Math.sin(a)*r,.020], [.001+h(i)*.002,.001+h(i)*.002,.001+h(i)*.002],skin,10);}
}
function tail(root: THREE.Group): void {
  const map=tex('Pink grey rat tail scales and annular creases',(u,t)=>{const crease=Math.pow(.5+.5*Math.cos(t*TAU*66),20),cell=Math.pow(.5+.5*Math.sin(u*TAU*26+Math.floor(t*66)*1.8),8);const d=h(Math.floor(u*512)+512*Math.floor(t*512))*16-crease*34-cell*6;return [176+d,137+d,128+d];});
  const skin=material('Dry pink grey rat tail skin','#ffffff',.53,map),cut=material('Pale exposed tail tissue','#ad9679',.89),hair=material('Sparse stiff tail hairs','#a99277',.9);
  const points:P[]=[[-.09,-.09,.007],[.005,-.083,0],[.071,-.043,-.002],[.064,.011,0],[-.014,.056,0],[-.025,.102,.005],[.036,.126,.004],[.085,.091,0]];
  const {curve,frames}=sweep(root,'Solid continuously tapered S curved tail',points,t=>.015*Math.pow(1-t,.85)+.0003,1,skin,160,24);
  for(let j=0;j<64;j++){const t=j/65, p=curve.getPointAt(t),r=.015*Math.pow(1-t,.85)+.0004;const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.00032,4,24),skin);ring.name=`Raised tail scale annulus ${j}`;ring.position.copy(p);ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),curve.getTangentAt(t));root.add(ring);}
  const p=curve.getPointAt(0);const cap=ell(root,'Severed pale tail base',[p.x-.0001,p.y,p.z],[.014,.014,.001],cut);cap.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),curve.getTangentAt(0));
  for(let i=0;i<65;i++){const t=h(i),j=Math.round(t*160),p=curve.getPointAt(t),a=h(i+80)*TAU,r=.015*Math.pow(1-t,.85);const n=frames.normals[j]!.clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[j]!,Math.sin(a));const q=p.clone().addScaledVector(n,r);const e=q.clone().addScaledVector(n,.003);sweep(root,`Sparse tail hair ${i}`,[[q.x,q.y,q.z],[e.x,e.y+.002,e.z]],[.00012,.000015],1,hair,2,3);}
}
function skin(root: THREE.Group): void {
  const scales=tex('Viper shed diamond scales with creamy cell edges',(u,t)=>{const row=Math.floor(t*105),x=(u*16+row*.5)%1,y=(t*105)%1;const edge=Math.abs(x-.5)+Math.abs(y-.5)*.8>.73;const patch=Math.sin(t*46+Math.sin(u*TAU*2))*Math.sin(u*TAU*3);const d=patch*23+h(row*100+Math.floor(u*16))*12;return edge?[219,208,183]:[156+d,143+d,123+d];});
  const outer=material('Papery beige shed scale membrane','#ffffff',.62,scales),inner=material('Pale inside out belly membrane','#c0b49b',.82,scales);
  const path:P[]=[[.081,-.12,.012],[-.032,-.09,0],[-.078,-.054,0],[-.054,-.016,0],[.062,.005,0],[.084,.045,0],[.023,.076,0],[-.034,.111,0],[-.021,.145,0],[.050,.146,0],[.112,.114,0],[.118,.085,.003]];
  const c=new THREE.CatmullRomCurve3(path.map(v)), rows=200,sides=32,fr=c.computeFrenetFrames(rows,false);for(let i=0;i<=rows;i++){const tangent=c.getTangentAt(i/rows);fr.normals[i]=new THREE.Vector3(tangent.y,-tangent.x,0).normalize();fr.binormals[i]=new THREE.Vector3().crossVectors(tangent,fr.normals[i]!).normalize();}const pos:number[]=[],uv:number[]=[],idx:number[]=[];
  for(let layer=0;layer<2;layer++)for(let i=0;i<=rows;i++){const t=i/rows,p=c.getPointAt(t),r=(.021*(1-.84*t)+.001)*(layer===0?1:.92);for(let j=0;j<=sides;j++){const a=j/sides*TAU,w=1+.055*Math.sin(j*2.7+i*.8);const q=p.clone().addScaledVector(fr.normals[i]!,Math.cos(a)*r*w).addScaledVector(fr.binormals[i]!,Math.sin(a)*r*.61*w);pos.push(q.x,q.y,q.z);uv.push(j/sides,t);if(i<rows&&j<sides){const k=layer*(rows+1)*(sides+1)+i*(sides+1)+j;if(layer===0)idx.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);else idx.push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);}}}
  const count=idx.length/2,offset=(rows+1)*(sides+1);for(const i of [0,rows])for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+offset;idx.push(a,a+1,b,a+1,b+1,b);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.addGroup(0,count,0);g.addGroup(count,idx.length-count,1);g.computeVertexNormals();mesh(root,'Hollow folded S coil skin with open irregular mouth and inner wall',g,[outer,inner]);
  // Thin raised belly scutes continue around both sides of the hollow shed.
  for(let i=1;i<105;i++){const t=i/105,p=c.getPointAt(t),j=Math.round(t*rows),r=.021*(1-.84*t)+.001;const pts:P[]=[];for(let k=0;k<=8;k++){const a=Math.PI*.15+k/8*Math.PI*.7;const q=p.clone().addScaledVector(fr.normals[j]!,Math.cos(a)*r*1.015).addScaledVector(fr.binormals[j]!,Math.sin(a)*r*.62);pts.push([q.x,q.y,q.z]);}sweep(root,`Raised shed ventral scale edge ${i}`,pts,[.00038,.00038],1,inner,8,3);}
}
function stinger(root: THREE.Group): void {
  const shell=material('Amber scorpion chitin','#ffffff',.31,speckle('Honey chitin pores',[184,116,36],43)),dark=material('Burnished black brown venom barb','#38271d',.26),edge=material('Dark amber shell sutures','#8b4d20',.39);
  sweep(root,'Oval scorpion venom bulb',[[-.043,.065,0],[-.024,.039,0],[.009,-.015,0]],[.010,.031,.014],.78,shell,44,28);
  sweep(root,'Continuous hooked aculeus',[[.005,-.004,0],[.026,-.030,0],[.049,-.054,0],[.060,-.081,0],[.055,-.102,0]],[.015,.013,.007,.003,.00004],.74,dark,56,20);
  sweep(root,'Amber barb root',[[.006,-.008,0],[.025,-.030,0],[.037,-.043,0]],[.015,.010,.0065],.74,shell,24,20);
  for(const s of [-1,1]){sweep(root,`Longitudinal bulb ridge ${s}`,[[-.047,.057,.005*s],[-.044,.032,.018*s],[-.023,-.001,.020*s],[.009,-.017,.007*s]],[.0017,.0012],1,edge,32,7);sweep(root,`Dorsal telson keel ${s}`,[[-.034,.065,.006*s],[-.012,.040,.024*s],[.007,-.012,.012*s]],[.001,.001],1,shell,28,6);}
  for(let i=0;i<35;i++){const t=h(i),a=h(i+70)*TAU,p:P=[-.037+.042*t+Math.cos(a)*.025,.057-.07*t,Math.sin(a)*.020];sweep(root,`Chitin sensory bristle ${i}`,[p,[p[0]+Math.cos(a)*.009,p[1]+.004,p[2]+Math.sin(a)*.008]],[.0005,.00002],1,edge,3,4);}
}
function claw(root: THREE.Group): void {
  const red=material('Deep red mottled crab carapace','#ffffff',.36,speckle('Crab shell red mineral mottles',[163,51,25],48)),black=material('Dark pincer contact edge','#332b25',.44),ivory=material('Worn cream crushing teeth','#bc9f75',.59),joint=material('Dry fibrous claw joint','#a39070',.92);
  // Two separated solid jaws with a broad muscular heel and a deep open bite.
  sweep(root,'Broad upper fixed chela',[[.065,-.060,0],[.045,.002,0],[.008,.060,0],[-.059,.085,0],[-.102,.055,0]],[.033,.038,.033,.018,.0006],.62,red,70,28);
  sweep(root,'Lower articulated chela',[[.068,-.062,0],[.012,-.058,0],[-.059,-.038,0],[-.104,.012,0]],[.030,.034,.021,.0006],.65,red,64,28);
  sweep(root,'Upper black hardened pincer edge',[[.026,.011,.001],[-.008,.039,0],[-.062,.059,0],[-.102,.055,0]],[.009,.010,.008,.0005],.8,black,40,16);
  sweep(root,'Lower black hardened pincer edge',[[.021,-.033,0],[-.030,-.027,0],[-.079,-.010,0],[-.104,.012,0]],[.007,.007,.006,.0005],.8,black,40,16);
  for(let i=0;i<6;i++){const x=-.077+i*.019;const y=.046-.017*Math.pow((x+.045)/.065,2);sweep(root,`Upper crushing cusp ${i}`,[[x,y,0],[x-.001,y-.010,0],[x-.005,y-.017,0]],[.007,.005,.0003],.9,ivory,8,8);const by=-.019-.016*(i/5);sweep(root,`Lower crushing cusp ${i}`,[[x,by,0],[x+.001,by+.008,0],[x-.001,by+.014,0]],[.006,.004,.0003],1,ivory,8,8);}
  const cuff=mesh(root,'Oval broken attachment rim',new THREE.TorusGeometry(.030,.005,10,40),red);cuff.position.set(.080,-.077,0);cuff.rotation.y=Math.PI/2;cuff.rotation.z=-.45;
  const cut=ell(root,'Recessed fibrous articulation',[.078,-.075,0],[.008,.027,.025],joint);cut.rotation.z=-.45;
  for(let i=0;i<95;i++){const t=h(i),a=h(i+44)*TAU;const x=.063-.145*t,y=.002+.057*Math.sin(t*Math.PI*.8),z=Math.sin(a)*.021;ell(root,`Carapace granule ${i}`,[x,y+Math.cos(a)*.027,z],[.0018,.0017,.0015],i%4===0?ivory:red,8);}
  for(let i=0;i<8;i++){const x=.048-i*.016,y=.029+.040*Math.sin(i/7*Math.PI*.8);sweep(root,`Dorsal shell spine ${i}`,[[x,y,0],[x+.003,y+.012,0]],[.004,.0001],1,red,5,6);}
}
function bristles(root: THREE.Group): void {
  const mats=[material('Black boar guard hair','#24201b',.65),material('Brown black boar hair','#3a3025',.73),material('Sun worn brown hair edges','#6a5337',.72)];const twine=material('Rough flax binding','#ad8b58',.9,speckle('Flax fibre mottling',[221,200,161],34));
  for(let i=0;i<320;i++){const a=h(i*5)*TAU,r=.018*Math.sqrt(h(i*5+1)),x=Math.cos(a)*r,z=Math.sin(a)*r*.65,length=.125+h(i*5+2)*.075,fan=(h(i*5+3)-.5)*.09;const start=-.035+h(i+17)*.010;const pts:P[]=[[x,start,z],[x,.009,z],[x+fan*.35,.064,z*1.8],[x+fan,length*.79,z*2.5],[x+fan+.008*Math.sin(i),length,z*3]];sweep(root,`Individual curved boar bristle ${i}`,pts,[.0012,.00115,.00085,.00045,.000025],.82,mats[i%11===0?2:i%4===0?1:0]!,12,4);}
  rope(root,[0,.003,0],.020,twine,3);sweep(root,'Binding knot and tucked ends',[[.018,.007,.007],[.026,.011,.012],[.026,-.001,.018],[.012,-.002,.021],[.015,.011,.018],[.032,-.020,.008]],[.002,.002],1,twine,28,7);
}
const descriptions: Record<string,string> = {
  hen_egg: 'Warm when you find it, which is how you know you were quick enough.',
  coney_foot: 'Carried for luck by everyone who has ever admitted the moor frightens them.',
  marsh_gland: "Pale sac from behind a frog's jaw. Keeps essence wet, which is most of the trick.",
  viper_skin: 'Shed whole and inside out. Copper fletchers back their nocks with it.',
  venom_gland: 'Still full. Handled with the same care you would give a lit lamp in a barn.',
  rat_tail: 'Stone Cavern pays a bounty per tail. Nobody in Hillcrest asks what the count is for.',
  scorpion_stinger: 'Barb and bulb both intact. Dry, it is a needle; wet, it is still a problem.',
  crab_claw: 'Off a giant crab, and big enough to have taken a pick handle in half.',
  boar_bristle: "A fistful of black wire off a wild boar's shoulder. It will not lie flat.",
};
function combineDetails(root: THREE.Group): void {
  const batches=new Map<THREE.Material,THREE.Mesh[]>();
  root.updateMatrixWorld(true);
  for(const child of root.children) if(child instanceof THREE.Mesh && !Array.isArray(child.material)) {
    const list=batches.get(child.material)??[];list.push(child);batches.set(child.material,list);
  }
  for(const [mat,parts] of batches) if(parts.length>1){
    const geometries=parts.map(p=>p.geometry.clone().applyMatrix4(p.matrix));const merged=mergeGeometries(geometries,false);
    if(!merged)throw new Error(`Cannot merge biological detail ${mat.name}`);
    for(const part of parts){root.remove(part);part.geometry.dispose();}for(const g of geometries)g.dispose();
    const result=mesh(root,`${mat.name}: ${parts.length} attached anatomical details`,merged,mat);result.userData.parts=parts.map(p=>p.name);
  }
}
export const author: ItemModelAuthor = {
  ids: ['hen_egg','coney_foot','marsh_gland','viper_skin','venom_gland','rat_tail','scorpion_stinger','crab_claw','boar_bristle'],
  build(id: string): THREE.Group {
    if(!descriptions[id])throw new Error(`Unknown trophy biology item ${id}`);const root=new THREE.Group();root.name=id;
    root.userData.itemModel={itemId:id,author:'trophy-biology',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]};
    if(id==='hen_egg')egg(root);else if(id==='coney_foot')foot(root);else if(id==='marsh_gland'||id==='venom_gland')gland(root,id==='venom_gland');else if(id==='viper_skin')skin(root);else if(id==='rat_tail')tail(root);else if(id==='scorpion_stinger')stinger(root);else if(id==='crab_claw')claw(root);else bristles(root);combineDetails(root);return root;
  },
};


