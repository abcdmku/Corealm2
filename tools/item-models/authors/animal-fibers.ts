import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
const ids = ['fox_guardhair', 'lynx_sinew', 'badger_bristle', 'porcupine_quill', 'horse_tailhair', 'monitor_sinew', 'spider_thread'] as const;
const rand = (n: number): number => { const x = Math.sin(n * 71.713 + 13.1) * 43758.545; return x - Math.floor(x); };
type Path = (t: number) => THREE.Vector3;
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Closed swept strand volumes, batched per material. No alpha cards or silhouette meshes. */
class Strands {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; index: number[] = [];
  add(path: Path, radius: (t: number) => number, colour: (t: number) => THREE.Color, steps = 16, sides = 5, flatten = 1): void {
    const start = this.p.length / 3;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, center = path(t), tangent = path(Math.min(1, t + .0001)).sub(path(Math.max(0, t - .0001))).normalize();
      const normal = new THREE.Vector3(0, 0, 1).cross(tangent).normalize();
      if (normal.lengthSq() < .1) normal.set(1, 0, 0);
      const binormal = tangent.clone().cross(normal).normalize(), r = radius(t), col = colour(t);
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * TAU, offset = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a) * flatten);
        this.p.push(center.x + offset.x * r, center.y + offset.y * r, center.z + offset.z * r);
        this.n.push(...offset.normalize().toArray()); this.uv.push(k / sides, t); this.c.push(col.r, col.g, col.b);
        if (j < steps && k < sides) { const q = start + j * (sides + 1) + k; this.index.push(q, q + 1, q + sides + 1, q + 1, q + sides + 2, q + sides + 1); }
      }
    }
    for (const end of [0, steps]) {
      const t = end / steps, center = path(t), col = colour(t), q = this.p.length / 3;
      const normal = path(end === 0 ? 0 : 1).sub(path(end === 0 ? .0001 : .9999)).normalize();
      this.p.push(...center.toArray()); this.n.push(...normal.toArray()); this.uv.push(.5, t); this.c.push(col.r, col.g, col.b);
      for (let k = 0; k < sides; k++) { const a = start + end * (sides + 1) + k; if (end === 0) this.index.push(q, a + 1, a); else this.index.push(q, a, a + 1); }
    }
  }
  mesh(root: THREE.Group, name: string, material: THREE.Material): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.index);
    add(root, name, g, material);
  }
}
function add(root: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
}
function fiberMaterial(name: string, roughness = .63): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, vertexColors: true, roughness });
}
function map(name: string, fn: (u: number, t: number) => THREE.Color): THREE.DataTexture {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn(x / 255, y / 255).convertLinearToSRGB(), i = (y * size + x) * 4;
    data[i] = Math.round(c.r * 255); data[i + 1] = Math.round(c.g * 255); data[i + 2] = Math.round(c.b * 255); data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size); t.name = name; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping; return t;
}
function tuft(root: THREE.Group, fox: boolean): void {
  const fibers = new Strands(), count = fox ? 280 : 270;
  const dark = new THREE.Color(fox ? '#632d16' : '#191918'), body = new THREE.Color(fox ? '#b95420' : '#343430'), tip = new THREE.Color(fox ? '#513020' : '#e4e1d6'), cream = new THREE.Color('#c5ae8d');
  for (let i = 0; i < count; i++) {
    const seed = i * 19, theta = rand(seed + 2) * TAU, depth = Math.sqrt(rand(seed + 3)), spread = (rand(seed + 1) - .5) * 2;
    const length = (fox ? .17 : .145) * (.69 + .31 * rand(seed + 4));
    const path: Path = t => {
      const width = fox ? .014 + .049 * Math.sin(t * 2.0) : .013 + .055 * t;
      const x = spread * width + (fox ? .035 * t * t : .009 * t);
      const z = Math.sin(theta) * depth * (.010 + .017 * Math.sin(t * Math.PI)) + .002 * Math.sin(t * 11 + seed) * t;
      return v(x, t * length + .007 * Math.cos(theta) * depth, z);
    };
    const shade = .76 + rand(seed + 7) * .45;
    fibers.add(path, t => (fox ? .00095 : .00082) * (.72 + rand(seed + 8) * .45) * Math.pow(1 - t, .65) + .000025,
      t => {
        let c: THREE.Color;
        if (fox) c = t < .24 ? cream.clone().lerp(body, t / .24) : body.clone().lerp(i % 5 === 0 ? dark : tip, Math.max(0, (t - .73) / .27));
        else c = dark.clone().lerp(body, t * .4).lerp(tip, THREE.MathUtils.smoothstep(t, .69 + rand(seed + 10) * .09, .88));
        return c.multiplyScalar(shade);
      }, 12, 5);
  }
  fibers.mesh(root, fox ? 'Dense red guardhair with cream roots and curled dark tapered tips' : 'Stiff black bristles with irregular silver terminal bands, full rear fan', fiberMaterial(fox ? 'Fox red and cream keratin' : 'Badger black and silver keratin', .7));
  // A compact organic root bed is buried by the fibers, with granular rear cut surface.
  const base = new THREE.SphereGeometry(1, 24, 12); base.scale(.016, .006, .009);
  add(root, 'Small fibrous root bed', base, new THREE.MeshStandardMaterial({ name: 'Dry natural root attachment', color: fox ? '#87715b' : '#382d22', roughness: 1 }));
  root.rotation.z = fox ? -.39 : -.22;
}
function tendon(root: THREE.Group, monitor: boolean): void {
  const fibers = new Strands(), detail = new Strands(), white = new THREE.Color('#ffffff');
  const mat = fiberMaterial(monitor ? 'Golden dry monitor tendon longitudinal fibers' : 'Cream gold split lynx tendon', .68);
  mat.map = map('Fine lengthwise tendon fibrils', (u, t) => new THREE.Color('#dfba7c').multiplyScalar(.80 + .18 * Math.sin(u * 320 + Math.sin(t * 40) * 2) ** 2 + .07 * rand(Math.floor(u * 255) + Math.floor(t * 255) * 256)));
  if (monitor) {
    // Seven connected turns, laid at changing depths; the final free end leaves the coil.
    for (let turn = 0; turn < 7; turn++) {
      const path: Path = t => {
        const a = t * TAU + .4, ripple = .003 * Math.sin(a * 3 + turn);
        return v((.082 + ripple + .003 * Math.cos(turn)) * Math.cos(a), (.052 + ripple) * Math.sin(a), (turn - 3) * .006 + .005 * Math.sin(a * 2 + turn));
      };
      fibers.add(path, t => .0044 * (1 + .08 * Math.sin(t * 44 + turn)), () => white, 100, 8, .85);
      for (let k = 0; k < 4; k++) detail.add(t => { const p = path(t), a = t * TAU * 5 + k * TAU / 4; return p.add(v(.0036 * Math.cos(a), .0036 * Math.sin(a), .002 * Math.cos(a))); }, () => .00032, () => new THREE.Color('#edcc94'), 100, 4);
    }
    const curve = new THREE.CatmullRomCurve3([v(.076,.02,.02),v(.083,-.018,.02),v(.059,-.061,.024),v(.011,-.083,.018)]);
    fibers.add(t => curve.getPoint(t), t => .0045 * (1 - .92 * t), () => white, 30, 8);
  } else {
    // Open loop of four split ribbons braided around the centerline, with two distinct cut ends.
    const center: Path = t => { const a = 2.7 - t * TAU * 1.19; return v(.080 * Math.cos(a), .057 * Math.sin(a), .013 * Math.sin(t * TAU)); };
    for (let strand = 0; strand < 4; strand++) {
      const path: Path = t => { const p = center(t), a = t * TAU * 3.2 + strand * TAU / 4; return p.add(v(.007 * Math.cos(a), .008 * Math.sin(a), .008 * Math.cos(a))); };
      fibers.add(path, t => .0058 * (1 + .10 * Math.sin(t * 35 + strand)), () => white, 100, 8, .58);
      for (let k = 0; k < 4; k++) detail.add(t => path(t).add(v(.0028 * Math.cos(k * TAU / 8), .0028 * Math.sin(k * TAU / 8), .0023 * Math.cos(k * TAU / 8))), () => .00026, () => new THREE.Color('#f2d8af'), 100, 4);
      for (const end of [0,1]) for (let j = 0; j < 9; j++) {
        const p = path(end), d = path(end === 0 ? 0 : 1).sub(path(end === 0 ? .002 : .998)).normalize();
        detail.add(t => p.clone().addScaledVector(d, t * (.003 + rand(j + strand * 11) * .003)).add(v((rand(j + 9) - .5) * .006, (rand(j + 3) - .5) * .005, (rand(j + 4) - .5) * .005)), t => .00065 * (1 - .7 * t), () => new THREE.Color('#f1d8ad'), 3, 4);
      }
    }
  }
  fibers.mesh(root, 'Dry tendon coils with exposed continuous rear turns', mat); detail.mesh(root, 'Raised fine fibrils and split cut ends', fiberMaterial('Pale tendon surface fibrils', .8));
}
function horse(root: THREE.Group): void {
  const fibers = new Strands(), binding = new Strands();
  for (let i = 0; i < 170; i++) {
    const a = i * 2.399, rad = .016 * Math.sqrt(rand(i + 23)), ox = Math.cos(a) * rad, oz = Math.sin(a) * rad;
    const c = new THREE.Color().setRGB(.065 + rand(i) * .075, .028 + rand(i + 1) * .035, .013 + rand(i + 2) * .021);
    // A folded hank: each solid hair travels up one side, around the bend, then down the other.
    fibers.add(t => {
      if (t < .25 || t > .75) { const s = t < .25 ? 1 - t * 4 : (t - .75) * 4, sign = t < .25 ? -1 : 1; return v(ox + sign * .008 * (1 - s) + .018 * Math.sin(s * 3 + i * .019) * s, -.125 * s * (.8 + rand(i + 8) * .2), oz + .008 * s * Math.sin(a)); }
      const s = (t - .25) * 2, angle = Math.PI + s * Math.PI; return v(.028 * Math.cos(angle) + ox, .086 * Math.sin(s * Math.PI), oz + .004 * Math.sin(angle));
    }, t => .00058 * Math.max(.05, Math.min(1, t * 22, (1 - t) * 22)), () => c, 35, 4);
  }
  for (let j = 0; j < 30; j++) {
    const c = new THREE.Color(j % 5 === 0 ? '#996b45' : '#503825');
    binding.add(t => { const a = t * TAU; return v(.024 * Math.cos(a), -.005 + j * .00068 + .005 * Math.cos(a), .020 * Math.sin(a)); }, () => .00072, () => c, 30, 5);
  }
  fibers.mesh(root, 'Folded brown horsehair hank with open upper loop and individual loose ends', fiberMaterial('Brown horse tail keratin', .52));
  binding.mesh(root, 'Thirty hair wraps cinching the hank with continuous rear fastening', fiberMaterial('Brown hair binding', .55)); root.rotation.z = -.34;
}
function quill(root: THREE.Group): void {
  const n = 64, rows = 60, p: number[] = [], uv: number[] = [], index: number[] = [];
  const r = (t: number, a: number) => (.013 * Math.pow(1 - t, .65) + .00003) * (1 + .013 * Math.sin(a * 47) + .008 * Math.sin(a * 71));
  for (let j = 0; j <= rows; j++) for (let k = 0; k <= n; k++) { const t = j / rows, a = k / n * TAU, rr = r(t,a); p.push(Math.cos(a) * rr, t * .25, Math.sin(a) * rr); uv.push(k/n,t); if(j<rows&&k<n) {const q=j*(n+1)+k;index.push(q,q+n+1,q+1,q+1,q+n+1,q+n+2);} }
  // Actual interior, thick cut annulus, and blind inner cavity extending most of the shaft.
  const start=p.length/3;
  for(let j=0;j<=40;j++)for(let k=0;k<=n;k++){const t=j/40*.82,a=k/n*TAU,rr=Math.max(.0002,r(t,a)-.0014);p.push(Math.cos(a)*rr,t*.25,Math.sin(a)*rr);uv.push(k/n,t);if(j<40&&k<n){const q=start+j*(n+1)+k;index.push(q,q+1,q+n+1,q+1,q+n+2,q+n+1);}if(j===0&&k<n)index.push(k,k+1,start+k,start+k,k+1,start+k+1);}
  const g = new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
  const texture = map('Ivory and dark brown irregular quill bands and longitudinal ridges',(u,t)=>{
    const band = t + .008 * Math.sin(u*TAU*13) + .003*Math.sin(u*TAU*49), dark = (band>.085&&band<.235)||(band>.36&&band<.51)||(band>.635&&band<.72)||band>.82;
    return new THREE.Color(dark ? '#2c211b':'#e4c99c').multiplyScalar(.84+.16*Math.sin(u*TAU*63)**2);
  });
  add(root,'Hollow tapering banded quill with thick open basal rim',g,new THREE.MeshStandardMaterial({name:'Striated banded keratin',map:texture,roughness:.41}));
  root.rotation.z = .48;
}
function silk(root: THREE.Group): void {
  const woodMap=map('Worn warm wood grain',(u,t)=>new THREE.Color('#916035').multiplyScalar(.68+.23*Math.sin(u*91+Math.sin(t*12)*2)**2+.18*rand(Math.floor(u*255)+Math.floor(t*255)*256)));
  const wood=new THREE.MeshStandardMaterial({name:'Worn brown reel wood',map:woodMap,roughness:.79});
  // Lathed closed flanges with a real axial bore, beveled lips and matching rear face.
  for(const sign of [-1,1]) {
    const y=sign*.053, points=[[.012,y-.006],[.049,y-.006],[.054,y-.003],[.055,y+.003],[.050,y+.007],[.012,y+.007],[.012,y-.006]].map(([x,h])=>new THREE.Vector2(x!,h!));
    add(root,sign===1?'Upper reel flange with beveled outer rim and open bore':'Lower reel flange with open bore and rear grain',new THREE.LatheGeometry(points,80),wood);
  }
  add(root,'Hollow wooden reel core',new THREE.LatheGeometry([new THREE.Vector2(.012,-.055),new THREE.Vector2(.020,-.055),new THREE.Vector2(.020,.055),new THREE.Vector2(.012,.055),new THREE.Vector2(.012,-.055)],64),wood);
  const silkMat=new THREE.MeshStandardMaterial({name:'Ivory dry silk layers',color:'#eee3cd',roughness:.6});
  silkMat.map=map('Fine silk circumferential filaments',(u,t)=>new THREE.Color('#fff7e8').multiplyScalar(.86+.14*Math.sin(t*1800+Math.sin(u*22))**2));
  const profile:THREE.Vector2[]=[]; for(let j=0;j<=30;j++){const y=-.046+j/30*.092;profile.push(new THREE.Vector2(.043+.003*Math.sin(j/30*Math.PI)+.0002*Math.sin(j*3),y));}
  add(root,'Dense continuous wound silk bed',new THREE.LatheGeometry(profile,96),silkMat);
  const strands=new Strands(),c=new THREE.Color('#f2e8d4');
  for(let j=0;j<60;j++)strands.add(t=>{const a=t*TAU,y=-.045+j/59*.090+.001*Math.sin(a*2+j*.4),r=.044+.003*Math.sin((y+.046)/.092*Math.PI);return v(r*Math.cos(a),y,r*Math.sin(a));},()=>.00042,()=>c,40,4);
  for(let j=0;j<5;j++)strands.add(t=>{const a=t*TAU*1.2+j*.27,y=-.044+t*.088,r=.047;return v(r*Math.cos(a),y,r*Math.sin(a));},()=>.00048,()=>c,40,4);
  const tail=new THREE.CatmullRomCurve3([v(.031,.031,.035),v(.038,0,.042),v(.045,-.039,.047),v(.079,-.076,.035)]);
  strands.add(t=>tail.getPoint(t),()=>.0011,()=>c,32,6);
  for(let j=0;j<12;j++)strands.add(t=>tail.getPoint(1).add(v(t*.009,t*(rand(j)*.009-.004),t*(rand(j+10)*.012-.006))),t=>.00030*(1-.9*t),()=>c,6,4);
  strands.mesh(root,'Individual silk windings, crossed loose thread and frayed end',fiberMaterial('Fine ivory silk',.59));
  root.rotation.z=-1.03;root.rotation.x=.3;
}
const descriptions: Record<string,string> = {
  fox_guardhair: 'Coarse red fox back hair: dense swept russet guardhair tuft, cream root fibers and dark curling tips.',
  lynx_sinew: 'Springy cleaned dried lynx tendon in an open cream-gold twisted loop with two split cut ends.',
  badger_bristle: 'Stiff black and silver badger bristles in a thick fan, dark root bed and silver pointed tips.',
  porcupine_quill: 'Thick hollow ivory porcupine quill with broad brown bands, a visible cut bore and hard tapered dark point.',
  horse_tailhair: 'Long strong brown horsehair folded into an open hank, cinched with hair wraps above loose tapered ends.',
  monitor_sinew: 'Heat-tough golden monitor tail tendon wound in seven loose coils with a free tapered tail.',
  spider_thread: 'Strong dry ivory spider silk on a worn wooden reel with open axial bore and a loose frayed strand.',
};
export const author: ItemModelAuthor = {
  ids,
  build(itemId) {
    if(!ids.includes(itemId as typeof ids[number]))throw new Error(`Unsupported animal fiber: ${itemId}`);
    const root=new THREE.Group();root.name=itemId;
    root.userData.itemModel={itemId,author:'animal-fibers',reference:`art/item-icons/generated/${itemId}.png`,description:descriptions[itemId]};
    if(itemId==='fox_guardhair'||itemId==='badger_bristle')tuft(root,itemId==='fox_guardhair');
    else if(itemId==='lynx_sinew'||itemId==='monitor_sinew')tendon(root,itemId==='monitor_sinew');
    else if(itemId==='horse_tailhair')horse(root);
    else if(itemId==='porcupine_quill')quill(root);
    else silk(root);
    return root;
  },
};


