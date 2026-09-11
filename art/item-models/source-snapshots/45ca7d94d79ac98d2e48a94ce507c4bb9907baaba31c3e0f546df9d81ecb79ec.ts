import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

// Cairnpelt is cut hide, with a dark suede reverse and directional guard hairs.
type Surface = (u: number, v: number) => THREE.Vector3;
const TAU = Math.PI * 2;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp;
function grain(name: string, base: number, fur = false, srgb = false): THREE.DataTexture {
  const size = 128, bytes = new Uint8Array(size * size * 4), c = new THREE.Color(base);
  if(srgb)c.convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const r = n - Math.floor(n);
    const strand = fur ? Math.sin(x * 2.6 + Math.sin(y * .065 + x * .12) * 2) * .12 : 0;
    const f = .78 + r * .27 + strand;
    const i = (y * size + x) * 4;
    bytes[i] = Math.min(255, Math.round(c.r * f * 255));
    bytes[i + 1] = Math.min(255, Math.round(c.g * f * 255));
    bytes[i + 2] = Math.min(255, Math.round(c.b * f * 255)); bytes[i + 3] = 255;
  }
  const t = new THREE.DataTexture(bytes, size, size); t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace; t.needsUpdate = true;
  return t;
}
function materials(revised = false) {
  const make = (name: string, color: number, roughness: number, textured = false, fur = false) => {
    const m = new THREE.MeshStandardMaterial({ color: textured ? 0xffffff : color, roughness, map: textured ? grain(name, color, fur,revised) : null }); m.name = name;
    if(revised && fur) {
      const data=new Uint8Array(128*128*4);
      for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*4;data[i]=128+Math.round(16*Math.sin(x*1.9+Math.sin(y*.16)*2));data[i+1]=128+Math.round(5*Math.sin(y*.33+x));data[i+2]=253;data[i+3]=255;}
      const map=new THREE.DataTexture(data,128,128);map.name=name+' shallow independent fur relief';map.wrapS=map.wrapT=THREE.RepeatWrapping;map.needsUpdate=true;m.normalMap=map;m.normalScale.set(.6,.6);
    }
    return m;
  };
  return { fur: make('Cairnpelt brown grey guard fur', 0x716353, .94, true, true),
    pale: make('Cairnpelt silver beige underfur', 0xb5a48d, .97, true, true),
    hide: make('Dark worn chestnut leather', 0x39291f, .89, true),
    lining: make('Soft dark suede lining', 0x211a14, 1, true),
    thread: make('Waxed flax saddle stitching', 0xa47c50, .92),
    iron: Object.assign(make('Weathered iron buckles and hem weights', 0x555452, .65), { metalness: .75 }),
    cobalt: Object.assign(make('Cobalt pelt seam wire', 0x397898, .45), { metalness: .65 }),
    garnet: Object.assign(make('Garnet dust in woven backing', 0x632b29, .75, true), { metalness: .1 }) };
}
type Mats = ReturnType<typeof materials>;
function add(g: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material) {
  const mesh = new THREE.Mesh(geo, mat); mesh.name = name; g.add(mesh); return mesh;
}
function normal(s: Surface, u: number, v: number) {
  const e = .0001;
  return s(u + e, v).sub(s(u - e, v)).cross(s(u, v + e).sub(s(u, v - e))).normalize();
}
function surface(g: THREE.Group, name: string, s: Surface, mat: THREE.Material, inside: THREE.Material, nu = 48, nv = 16, thick = .006, hole?: (u: number,v: number) => boolean) {
  const p: number[] = [], uv: number[] = [], index: number[] = [];
  const count = (nu + 1) * (nv + 1);
  for (let side = 0; side < 2; side++) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, a = s(u, v).addScaledVector(normal(s, u, v), -side * thick);
    p.push(a.x, a.y, a.z); uv.push(u * 3, v * 4);
  }
  for (let side = 0; side < 2; side++) for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if(hole?.((i+.5)/nu,(j+.5)/nv))continue;
    const a = side * count + j * (nu + 1) + i, b = a + 1, d = a + nu + 1, c = d + 1;
    if (!side) index.push(a, b, d, b, c, d); else index.push(a, d, b, b, d, c);
  }
  const exteriorCount = index.length / 2;
  const rimStart = index.length;
  const edge = (a: number, b: number) => index.push(a, a + count, b, b, a + count, b + count);
  for (let i = 0; i < nu; i++) { edge(i + 1, i); edge(nv * (nu + 1) + i, nv * (nu + 1) + i + 1); }
  for (let j = 0; j < nv; j++) { edge(j * (nu + 1), (j + 1) * (nu + 1)); edge((j + 1) * (nu + 1) + nu, j * (nu + 1) + nu); }
  if(hole)for(let j=0;j<nv;j++)for(let i=0;i<nu;i++)if(!hole((i+.5)/nu,(j+.5)/nv)) {
    const a=j*(nu+1)+i,b=a+1,d=a+nu+1,c=d+1;
    if(i>0&&hole((i-.5)/nu,(j+.5)/nv))edge(a,d);
    if(i<nu-1&&hole((i+1.5)/nu,(j+.5)/nv))edge(c,b);
    if(j>0&&hole((i+.5)/nu,(j-.5)/nv))edge(b,a);
    if(j<nv-1&&hole((i+.5)/nu,(j+1.5)/nv))edge(d,c);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(index); geo.computeVertexNormals();
  geo.addGroup(0, exteriorCount, 0); geo.addGroup(exteriorCount, exteriorCount, 1); geo.addGroup(rimStart, index.length - rimStart, 1);
  const mesh = new THREE.Mesh(geo, [mat, inside]); mesh.name = name; g.add(mesh);
}
// Guard hairs are closed bent triangular locks. No alpha cards or billboard fur.
function hairs(g: THREE.Group, name: string, s: Surface, mat: THREE.Material, count: number, length = .015, width = .002, hole?: (u: number,v: number) => boolean) {
  const p: number[] = [], ix: number[] = [];
  const rand = (i: number) => { const n = Math.sin(i * 78.233 + 12.12) * 43758.5453; return n - Math.floor(n); };
  for (let i = 0; i < count; i++) {
    const u = rand(i * 3 + 1), v = rand(i * 3 + 2), a = s(u, v), n = normal(s, u, v);
    if(hole?.(u,v))continue;
    const down = s(u, v - .001).sub(s(u, v + .001)).normalize();
    const side = n.clone().cross(down).normalize(), len = length * (.6 + rand(i * 3 + 3) * .9), base = p.length / 3;
    for (let row = 0; row < 3; row++) {
      const t = row / 2, center = a.clone().addScaledVector(n, .002 + Math.sin(t * Math.PI * .65) * len * .30).addScaledVector(down, t * len);
      const w = width * (1 - t * .98);
      for (let k = 0; k < 3; k++) { const angle = k * TAU / 3, q = center.clone().addScaledVector(side, Math.cos(angle) * w).addScaledVector(n, Math.sin(angle) * w * .45); p.push(q.x, q.y, q.z); }
    }
    for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) { const a0 = base + j * 3 + k, b = base + j * 3 + (k + 1) % 3; ix.push(a0, b, a0 + 3, b, b + 3, a0 + 3); }
    ix.push(base + 2, base + 1, base, base + 6, base + 7, base + 8);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setIndex(ix); geo.computeVertexNormals();
  if(g.userData.itemModel.itemId!=='cairnpelt_hood'){const uv:number[]=[];for(let i=0;i<p.length;i+=3)uv.push(p[i]!*17,p[i+1]!*17);geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));}
  add(g, name, geo, mat);
}
function tube(g: THREE.Group, name: string, points: THREE.Vector3[], radius: number, mat: THREE.Material, closed = false) {
  add(g, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), Math.max(8, points.length * 3), radius, 5, closed), mat);
}
function line(g: THREE.Group, name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material) {
  const delta=b.clone().sub(a), mesh=add(g,name,new THREE.CylinderGeometry(radius,radius,delta.length(),5,1),mat);
  mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(V(0,1,0),delta.normalize());
}
function seam(g: THREE.Group, name: string, points: THREE.Vector3[], mat: THREE.Material, thread: THREE.Material, stitches: number, span = .009) {
  const c = new THREE.CatmullRomCurve3(points); tube(g, name + ' raised welt', points, .0023, mat);
  for (let i = 0; i < stitches; i++) { const t = (i + .5) / stitches, p = c.getPoint(t); line(g, name + ' stitch ' + i, p.clone().add(V(-span / 2, -.002, .002)), p.clone().add(V(span / 2, .003, .003)), .0012, thread); }
}
type Ring = readonly [number, number, number, number?];
function loft(rings: readonly Ring[], cx = 0, cz = -.035, gap = 0, folds = 0): Surface {
  return (u, v) => {
    const t = THREE.MathUtils.clamp(v, 0, 1) * (rings.length - 1), j = Math.min(rings.length - 2, Math.floor(t)), f = t - j;
    const a = rings[j]!, b = rings[j + 1]!, y = mix(a[0], b[0], f), rx = mix(a[1], b[1], f), rz = mix(a[2], b[2], f);
    const theta = gap + u * (TAU - gap * 2), ripple = folds * (Math.sin(theta * 13 + v * 1.4) + .3 * Math.sin(theta * 23 - v * 4));
    return V(cx + (rx + ripple) * Math.sin(theta), y, cz + (rz + ripple) * Math.cos(theta));
  };
}
function pelt(g: THREE.Group, name: string, s: Surface, m: Mats, count: number, pale = false, length = .016, nu = 40, nv = 12, hole?: (u: number,v: number) => boolean) {
  surface(g, name + ' cut hide shell', s, pale ? m.pale : m.fur, m.lining, nu, nv,.006,hole);
  if(g.userData.itemModel.itemId!=='cairnpelt_hood') {
    hairs(g,name+' dense brown flowing pelt locks',s,m.fur,Math.floor(count*1.05),length*1.75,.0048,hole);
    hairs(g,name+' dense silver underfur locks',s,m.pale,Math.floor(count*.60),length*1.6,.0038,hole);
    return;
  }
  hairs(g, name + ' brown guard locks', s, m.fur, Math.floor(count * .65), length,.002,hole);
  hairs(g, name + ' silver tipped locks', s, m.pale, Math.floor(count * .35), length * .9, .0016,hole);
}
function band(g: THREE.Group, name: string, y: number, rx: number, rz: number, h: number, m: Mats, cx = 0, cz = -.035) {
  const s = loft([[y - h / 2, rx, rz], [y + h / 2, rx, rz]], cx, cz);
  surface(g, name, s, m.hide, m.hide, 48, 2, .006);
  for (const v of [.12, .88]) for (let i = 0; i < 50; i++) line(g, name + ' saddle stitch', s(i / 50, v).addScaledVector(normal(s, i / 50, v), .002), s((i + .5) / 50, v).addScaledVector(normal(s, i / 50, v), .002), .0009, m.thread);
}
function buckle(g: THREE.Group, y: number, z: number, m: Mats, size = 1) {
  const w = .027 * size, h = .021 * size;
  tube(g, 'Forged rounded rectangle buckle', [V(-w,y-h,z), V(w,y-h,z), V(w,y+h,z), V(-w,y+h,z)], .0035 * size, m.iron, true);
  line(g, 'Buckle tongue', V(-w,y,z+.002), V(.012*size,y,z+.004), .0025*size, m.iron);
  const strap = add(g, 'Belt return tongue', new THREE.BoxGeometry(.047*size, .032*size, .006), m.hide); strap.position.set(.037*size,y,z-.002);
  for (let i=0;i<3;i++) { const hole=add(g,'Punched belt hole',new THREE.SphereGeometry(.0019*size,8,6),m.lining); hole.position.set((.023+i*.01)*size,y,z+.002); hole.scale.z=.3; }
}
function hood(g: THREE.Group, m: Mats) {
  const s = loft([[1.49,.113,.115],[1.58,.143,.153],[1.72,.136,.164],[1.80,.097,.132],[1.852,.003,.004]],0,-.015,.52,.0015);
  pelt(g,'Bear hood',s,m,1300,false,.021);
  for (const u of [0,1]) {
    const pts=Array.from({length:20},(_,i)=>s(u,i/19)); tube(g,'Rolled leather face edge',pts,.005,m.hide);
    seam(g,'Hood face hand stitching',pts,m.hide,m.thread,23,.007);
    for(let i=0;i<19;i++) { const p=pts[i]!; const tuft=loft([[p.y-.008,.012,.017],[p.y+.008,.015,.019]],p.x,p.z); hairs(g,'Face rim long fur '+i,tuft,m.pale,14,.021,.002); }
  }
  const mantle=loft([[1.382,.25,.143],[1.425,.275,.16],[1.49,.178,.138],[1.53,.106,.108]],0,-.03,.16,.002);
  pelt(g,'Scalloped shoulder cape',mantle,m,760,true,.022);
  seam(g,'Hood crown back seam',[s(.5,.05),s(.5,.35),s(.5,.7),s(.5,.94)],m.hide,m.thread,22,.012);
  for(let i=0;i<4;i++) { const y=1.403+i*.023; line(g,'Throat crossed rawhide tie',V(-.019,y,.12),V(.019,y+.020,.122),.0026,m.thread); line(g,'Throat crossed rawhide tie',V(.019,y,.124),V(-.019,y+.020,.126),.0026,m.thread); }
}
function robe(g: THREE.Group, m: Mats) {
  const skirt=loft([[.18,.286,.20],[.40,.263,.188],[.67,.218,.167],[.9,.19,.148],[1.078,.163,.133]],0,-.025,.145,.012);
  pelt(g,'Three pelt open skirt',skirt,m,780,false,.023,48,20);
  const chest=loft([[1.04,.166,.135],[1.20,.188,.149],[1.40,.218,.147],[1.455,.211,.125],[1.523,.093,.094]],0,-.025,.15,.006);
  pelt(g,'Open fur chest and shoulder yoke',chest,m,390,false,.018);
  for(const side of [-1,1]) {
    const sleeve:Surface=(u,v)=>{const x=mix(.21,.658,v), r=mix(.09,.063,v),a=u*TAU;return V(side*x,1.4555+r*Math.sin(a),-.0654+r*Math.cos(a));};
    // Parameter order mirrored on the left to keep the shell's outward normals.
    const sleeveOut:Surface=(u,v)=>sleeve(side===1?1-u:u,v);
    pelt(g,`Sleeve ${side}`,sleeveOut,m,340,false,.018,32,10);
    const cuff:Surface=(u,v)=>sleeveOut(u,.88+v*.12).addScaledVector(normal(sleeveOut,u,.94),.012);
    pelt(g,`Thick turned sleeve cuff ${side}`,cuff,m,150,true,.019,32,4);
    const lapel:Surface=(u,v)=> { const y=mix(1.09,1.51,v), x=side*(.024+.091*Math.sin(v*Math.PI*.7)+u*(.016+.036*Math.sin(v*Math.PI)));return V(x,y,.112+.034*Math.sin(v*Math.PI)+.012*Math.sin(u*Math.PI)); };
    const lapelOut:Surface=(u,v)=>lapel(side===1?u:1-u,v);
    pelt(g,`Long folded fur lapel ${side}`,lapelOut,m,160,true,.027,10,16);
    const seamPts=Array.from({length:12},(_,i)=>{const v=i/11;const u=side===1?.125:.875;return skirt(u,v).addScaledVector(normal(skirt,u,v),.018);});
    seam(g,`Cobalt front skirt pelt join ${side}`,seamPts,m.hide,m.cobalt,36,.015);
    const armPts=Array.from({length:12},(_,i)=>V(side*mix(.24,.625,i/11),1.485,-.0654+mix(.087,.064,i/11)));
    seam(g,`Cobalt sleeve pelt join ${side}`,armPts,m.hide,m.cobalt,17,.012);
    const edgePts=Array.from({length:20},(_,i)=>skirt(side===1?0:1,i/19));tube(g,'Open skirt leather binding',edgePts,.004,m.hide);
  }
  for(const u of [.34,.66]) seam(g,'Rear joined pelt seam',Array.from({length:15},(_,i)=>skirt(u,i/14).addScaledVector(normal(skirt,u,i/14),.018)),m.hide,m.cobalt,28,.016);
  const hem:Surface=(u,v)=>skirt(u,v*.018).addScaledVector(normal(skirt,u,0),.004);pelt(g,'Long turned fur hem',hem,m,190,true,.022,48,2);
  band(g,'Leather waist belt',1.079,.177,.148,.043,m);buckle(g,1.079,.134,m);
  const tail:Surface=(u,v)=>V(.055+u*.032+v*.025,1.074-v*.177,.139+Math.sin(v*Math.PI)*.014);
  surface(g,'Hanging belt end with folded return',tail,m.hide,m.hide,6,16,.006);
}
function leggings(g: THREE.Group, m: Mats) {
  const hip=loft([[.845,.184,.134],[.938,.193,.145],[1.03,.172,.132]],0,-.039,0,.002);
  pelt(g,'Open waist shaped pelt seat',hip,m,420,false,.017);
  for(const side of [-1,1]) {
    const cx=side*.1143;
    const leg=loft([[.23,.074,.084],[.35,.081,.091],[.51,.084,.094],[.56,.087,.102],[.69,.093,.103],[.87,.104,.113],[.94,.093,.112]],cx,-.038,0,.006);
    pelt(g,`Separate tapered fur trouser leg ${side}`,leg,m,1030,false,.023);
    const pts=Array.from({length:16},(_,i)=>leg(side===1?.16:.84,i/15).addScaledVector(normal(leg,side===1?.16:.84,i/15),.004));
    seam(g,'Leather bound outer trouser seam',pts,m.hide,m.thread,32,.009);
    band(g,'Weighted leather ankle band',.261,.079,.09,.045,m,cx,-.038);
    for(let i=0;i<7;i++) { const a=i*TAU/7, x=cx+.083*Math.sin(a),z=-.038+.094*Math.cos(a);const loop=add(g,'Bronze weight suspension eye',new THREE.TorusGeometry(.006,.0018,5,10),m.iron);loop.position.set(x,.256,z);loop.rotation.y=a;
      const weight=add(g,'Hanging rounded iron hem weight',new THREE.CapsuleGeometry(.006,.011,3,7),m.iron);weight.position.set(x,.236,z); }
  }
  band(g,'Stitched waist leather belt',1.016,.179,.14,.038,m);buckle(g,1.016,.112,m,.85);
  seam(g,'Front fly leather welt',[V(0,1.005,.108),V(0,.935,.108),V(0,.854,.06)],m.hide,m.thread,12,.007);
  seam(g,'Rear seat leather seam',[V(0,1.028,-.176),V(0,.94,-.189),V(0,.852,-.155)],m.hide,m.thread,15,.008);
}
function boots(g: THREE.Group, m: Mats) {
  for(const side of [-1,1]) { const cx=side*.1143;
    const shaft=loft([[.07,.065,.077],[.13,.066,.081],[.25,.072,.080],[.355,.075,.084]],cx,-.047,0,.004);
    pelt(g,'High fur boot shaft '+side,shaft,m,420,false,.017);
    const cuff=loft([[.30,.083,.092],[.333,.092,.10],[.371,.086,.094]],cx,-.047);pelt(g,'Deep rolled fur boot cuff '+side,cuff,m,200,true,.020,32,6);
    const shoe=loft([[.014,.076,.161],[.039,.078,.162],[.070,.075,.150],[.102,.061,.121],[.139,.044,.072]],cx,.012);
    pelt(g,'Fur vamp and heel '+side,shoe,m,240,false,.014,40,10);
    const sole=loft([[.005,.077,.164],[.025,.081,.167],[.036,.078,.165]],cx,.012);surface(g,'Thick shaped leather sole '+side,sole,m.hide,m.hide,48,4,.015);
    const bottom=add(g,'Solid leather outsole bottom '+side,new THREE.SphereGeometry(1,32,8),m.hide);bottom.scale.set(.078,.011,.165);bottom.position.set(cx,.014,.012);
    // Toe cover occupies only the forward cap and has a solid curved welt.
    const toe:Surface=(u,v)=>{const a=mix(-1.10,1.10,u), yy=mix(.031,.092,v);return V(cx+Math.sin(a)*.077*Math.sqrt(1-v*.48),yy,.047+Math.cos(a)*(.128-v*.026));};
    surface(g,'Reinforced leather toe cap '+side,toe,m.hide,m.lining,24,12,.006);
    seam(g,'Toe cap upper saddle seam',Array.from({length:15},(_,i)=>toe(i/14,1)),m.hide,m.thread,19,.004);
    for(let i=0;i<46;i++) {const a=sole(i/46,.92),b=sole((i+.5)/46,.92);line(g,'Sole perimeter hand stitch',a,b,.0013,m.thread);}
    for(const y of [.146,.242,.300]) band(g,'Narrow shaft binding',y,.077,.09,.009,m,cx,-.047);
    for(let i=0;i<4;i++) {const y=.108+i*.047;line(g,'Crossed boot thong',V(cx-.034,y,.041),V(cx+.034,y+.047,.047),.003,m.hide);line(g,'Crossed boot thong',V(cx+.034,y,.043),V(cx-.034,y+.047,.049),.003,m.hide);}
    tube(g,'Tied boot lace left loop',[V(cx,.287,.052),V(cx-.036,.283,.062),V(cx-.027,.251,.064),V(cx,.287,.052)],.0026,m.hide);
    tube(g,'Tied boot lace right loop',[V(cx,.287,.052),V(cx+.028,.267,.067),V(cx+.022,.247,.063),V(cx,.287,.052)],.0026,m.hide);
    line(g,'Loose lace end',V(cx,.287,.055),V(cx-.009,.222,.063),.0025,m.hide);
    seam(g,'Boot rear vertical welt',[V(cx,.065,-.126),V(cx,.19,-.130),V(cx,.30,-.136)],m.hide,m.thread,18,.007);
  }
}
function wraps(g: THREE.Group, m: Mats) {
  for(const side of [-1,1]) {
    // Fingerless palm, thumb opening and forearm wrap, along the T-pose arm.
    const wrap:Surface=(u,v)=> {const a=(side===1?1-u:u)*TAU,x=mix(.625,.789,v),palm=Math.max(0,Math.min(1,(v-.46)/.32)),ry=mix(.049,.030,v),rz=mix(.052,.031,Math.min(1,v/.46))+.022*palm;return V(side*x,1.4555+ry*Math.sin(a),-.0654+rz*Math.cos(a));};
    const thumbHole=(u:number,v:number)=>((u-(side===1?.14:.86))/.10)**2+((v-.71)/.15)**2<1;
    surface(g,'Garnet flecked woven wrap backing '+side,wrap,m.garnet,m.lining,48,24,.005,thumbHole);
    for(let j=0;j<8;j++)for(let i=0;i<24;i++) {
      const u=i/24,v=.04+j*.12;if(thumbHole(u,v))continue;
      const a=wrap(u,v).addScaledVector(normal(wrap,u,v),.003),b=wrap(u+.018,v+.045).addScaledVector(normal(wrap,u+.018,v+.045),.003);
      line(g,'Diagonal garnet worked weave yarn '+side,a,b,.0015,i%3===0?m.garnet:m.hide);
    }
    for(const v of [0,1]) {const pts=Array.from({length:49},(_,i)=>wrap(i/48,v));tube(g,'Rolled leather wrap opening '+side,pts,.0035,m.hide);}
    for(let j=0;j<4;j++) {
      const strip:Surface=(u,v)=> { const t=.045+j*.24+.16*u+v*.13;return wrap(u,t).addScaledVector(normal(wrap,u,t),.004); };
      pelt(g,'Spiral pelt binding '+side+' '+j,strip,m,170,true,.014,48,5,(u,v)=>thumbHole(u,.045+j*.24+.16*u+v*.13));
      for(let i=0;i<48;i++){const u=i/48,v=.05+j*.24+.16*u;if(thumbHole(u,v))continue;const un=(i+1)/48,vn=.05+j*.24+.16*un;line(g,'Leather spiral tie '+side,wrap(u,v).addScaledVector(normal(wrap,u,v),.009),wrap(un,vn).addScaledVector(normal(wrap,un,vn),.009),.0025,m.hide);}
    }
    // Native thumb exits the palm on its forward lower edge. The short open cuff is hollow.
    const thumb:Surface=(u,v)=> {const a=u*TAU;return V(side*(.738+.018*v+.021*Math.sin(a)),1.428-.011*v+.017*Math.cos(a),-.025+v*.044);};
    surface(g,'Open leather thumb welt '+side,thumb,m.hide,m.lining,24,6,.004);
    const lip=Array.from({length:25},(_,i)=>thumb(i/24,1));tube(g,'Thumb hole rolled piping '+side,lip,.003,m.hide);
    for(let i=0;i<14;i++) {const u=i/14;const a=wrap(u,.08).addScaledVector(normal(wrap,u,.08),.007),b=wrap(u+.027,.12).addScaledVector(normal(wrap,u,.12),.007);line(g,'Wrap cuff saddle stitch',a,b,.001,m.thread);}
  }
}
const descriptions: Record<string,string> = {
  cairnpelt_hood: "Cut from a bear's winter coat. It does not take dye and it does not tear.",
  cairnpelt_robe: "Three pelts, stitched with Cobalt wire. Quarry Warden's floor is survivable in this.",
  cairnpelt_leggings: 'Pelt to the ankle, weighted at the hem so it does not lift on the moor.',
  cairnpelt_boots: 'Silent on stone. The quarry crews would have hated them.',
  cairnpelt_wraps: 'Pelt strips to the wrist. Garnet dust worked into the weave.',
};
export const author: ItemModelAuthor = {
  ids: Object.keys(descriptions),
  build(id) {
    if (!descriptions[id]) throw new Error('Unknown cairnpelt item '+id);
    const g=new THREE.Group(),m=materials(id!=='cairnpelt_hood');g.name=id;
    g.userData.itemModel={itemId:id,author:'armor-cairnpelt',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id],wearable:true};
    if(id==='cairnpelt_hood')hood(g,m);else if(id==='cairnpelt_robe')robe(g,m);else if(id==='cairnpelt_leggings')leggings(g,m);else if(id==='cairnpelt_boots')boots(g,m);else wraps(g,m);
    return g;
  },
};
