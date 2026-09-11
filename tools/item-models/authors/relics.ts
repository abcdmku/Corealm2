import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const TAU = Math.PI * 2;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type P = readonly [number, number];
const descriptions: Record<string, string> = {
  molten_heart: 'A cooled kernel from a living stone creature. It replaces flux when smelting Cindersteel.',
  grave_thread: 'Black binding drawn from the Wilderness dead. Stitch Dragonhide or wind it into a Teak casting weapon.',
  astral_core: 'A blue-violet heart from a deep Wilderness creature. It fuses Nightglass Ore without shattering it.',
  void_thread: 'A dark strand pulled from a deep spirit. Binds Starhide and the crowns of Magic casting weapons.',
  ashseal_iron: "The Ashseal Warden's dense shield iron. Rivet it across a Teak Shield to make an Ashseal Guard.",
  furnace_crown: "A piece of the Furnace Regent's crucible crown. Set three around a Teak Staff to make a Regent Staff.",
  chainbound_link: 'A living link carried by the foundry guard and Chainbound Archon. Three bind a Nightglass Sword into a Chainbound Sword.',
  nightforge_seal: 'A breastplate stamp taken from the bastion guard or Nightforge Marshal. Reinforces Nightglass Plate into Nightmarshal Plate.',
  hollow_star_fragment: 'A heavy black shard carried by the sanctum guard and Hollow Star. Three form the crown of a Hollowstar Staff.',
};

/** Small independent polish variation; albedo never drives the normal map. */
function finish(name: string, color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const shade = Math.round(218 + 23 * Math.sin(x * .73 + y * .21) * Math.sin(y * 1.11));
    data[i] = data[i + 1] = data[i + 2] = shade; data[i + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size); map.name = `${name} polish`; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, roughnessMap: map }); m.name = name; return m;
}
function add(g: THREE.Group, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, p = V(0, 0, 0)): THREE.Mesh {
  geo.name = `${name} solid`; const mesh = new THREE.Mesh(geo, mat); mesh.name = name; mesh.position.copy(p); g.add(mesh); return mesh;
}
function shape(points: readonly P[]): THREE.Shape {
  const s = new THREE.Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s;
}
function solid(points: readonly P[], depth: number, bevel = .001, holes: readonly P[] = [], holeRadius = .003): THREE.ExtrudeGeometry {
  const s = shape(points);
  for (const [x, y] of holes) { const h = new THREE.Path(); h.absarc(x, y, holeRadius, 0, TAU, true); s.holes.push(h); }
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSegments: 2, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2); return geo;
}
function cord(g: THREE.Group, name: string, points: THREE.Vector3[], radius: number, mat: THREE.Material, closed = false, segments = 64): THREE.Mesh {
  return add(g, name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'centripetal'), segments, radius, 6, closed), mat);
}
function eye(g: THREE.Group, name: string, x: number, y: number, z: number, mat: THREE.Material, radius = .0045): void {
  add(g, name, new THREE.TorusGeometry(radius, .0015, 8, 24), mat, V(x, y, z));
}

function threads(g: THREE.Group, isVoid: boolean): void {
  const silk = finish(isVoid ? 'Purple-black spirit silk' : 'Charcoal funerary binding', isVoid ? 0x30213f : 0x282a2d, .13, .55);
  const glint = finish(isVoid ? 'Violet silk filaments' : 'Silver-grey twisted fibers', isVoid ? 0x554265 : 0x414348, .16, .5);
  if (isVoid) {
    // Wound toroidal ball, a real central bore with depth and loose outer crossing.
    for (let j = 0; j < 32; j++) {
      const phase = j / 32 * TAU, pts: THREE.Vector3[] = [];
      for (let i = 0; i < 97; i++) {
        const t = i / 96 * TAU, a = t + phase, r = .032 + .009 * Math.cos(3 * t + phase);
        pts.push(V(Math.cos(a) * r, Math.sin(a) * r, .013 * Math.sin(3 * t + phase)));
      }
      cord(g, `Wound silk strand ${j}`, pts, .0011, j % 5 ? silk : glint, true, 96);
    }
    cord(g, 'Loose end crossing the winding', [V(-.033, .015, .011), V(-.014, -.012, .019), V(.025, -.024, .014), V(.039, -.043, .004), V(.021, -.057, .001)], .0015, silk);
  } else {
    // Doubled elongated skein. Individual loops narrow through the central binding.
    for (let j = 0; j < 30; j++) {
      const p = j / 30 * TAU, pts: THREE.Vector3[] = [];
      for (let i = 0; i < 97; i++) {
        const t = i / 96 * TAU, y = .056 * Math.cos(t), width = .007 + .014 * Math.pow(Math.abs(Math.cos(t)), .55);
        pts.push(V(width * Math.sin(t) + .003 * Math.cos(p), y + .002 * Math.sin(p), (.006 + .004 * Math.abs(Math.cos(t))) * Math.sin(p + t * .3)));
      }
      cord(g, `Doubled skein loop ${j}`, pts, .00085, j % 6 ? silk : glint, true, 96);
    }
    const tie: THREE.Vector3[] = [];
    for (let i = 0; i <= 240; i++) { const t = i / 240 * TAU * 7; tie.push(V(.012 * Math.cos(t), -.007 + .014 * i / 240, .011 * Math.sin(t))); }
    cord(g, 'Seven-turn waist binding', tie, .0012, silk, false, 220);
    cord(g, 'Hanging binding tail', [V(-.01, -.004, .002), V(-.018, -.016, .012), V(-.017, -.027, .008), V(-.024, -.034, .005)], .001, glint);
    g.rotation.z = .65;
  }
}

function heartPoint(u: number, t: number, molten: boolean): THREE.Vector3 {
  const phi = t * Math.PI, a = u * TAU;
  const breadth = Math.sin(phi) * (1 + .3 * Math.cos(phi));
  const x = Math.cos(a) * breadth * .042;
  let y = .055 * Math.cos(phi);
  if (molten) y -= .022 * Math.exp(-Math.pow(x / .014, 2)) * Math.pow(Math.max(0, Math.cos(phi)), 5);
  else y += x * .19;
  return V(x, y, Math.sin(a) * breadth * .029);
}
function patch(u0: number, u1: number, t0: number, t1: number, molten: boolean, inset: number, n = 5): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (let side = 0; side < 2; side++) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * i / n, t = t0 + (t1 - t0) * j / n;
    const p = heartPoint(u, t, molten).multiplyScalar(side ? .86 : inset * (1 + .015 * Math.sin(u * 87 + t * 53)));
    positions.push(p.x, p.y, p.z); uv.push(u, t);
  }
  const k = (n + 1) ** 2;
  for (let side = 0; side < 2; side++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = side * k + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    if (side) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
  }
  const perimeter: number[] = [];
  for (let i = 0; i <= n; i++) perimeter.push(i);
  for (let j = 1; j <= n; j++) perimeter.push(j * (n + 1) + n);
  for (let i = n - 1; i >= 0; i--) perimeter.push(n * (n + 1) + i);
  for (let j = n - 1; j > 0; j--) perimeter.push(j * (n + 1));
  for (let i = 0; i < perimeter.length; i++) { const a = perimeter[i]!, b = perimeter[(i + 1) % perimeter.length]!; indices.push(a, b, a + k, b, b + k, a + k); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}
function hearts(g: THREE.Group, molten: boolean): void {
  const base = finish(molten ? 'Orange molten stone' : 'Blue-violet heart crystal', molten ? 0xe94b08 : 0x535fc2, molten ? .05 : .25, molten ? .66 : .24);
  base.emissive.setHex(molten ? 0xff4300 : 0x252a92); base.emissiveIntensity = molten ? 2.1 : .55;
  const skin = finish(molten ? 'Charred porous basalt shell' : 'Dark violet vascular ridges', molten ? 0x292725 : 0x29223f, molten ? .18 : .5, molten ? .91 : .36);
  add(g, 'Full three-dimensional heart kernel', patch(0, 1, 0, 1, molten, .975, 32), base);
  if (molten) {
    for (let row = 0; row < 6; row++) for (let col = 0; col < 9; col++) {
      const offset = row % 2 * .045;
      add(g, `Separate basalt crust plate ${row}-${col}`, patch(col / 9 + offset + .006, (col + 1) / 9 + offset - .006, row / 6 + .009, (row + 1) / 6 - .009, true, 1.035), skin);
    }
  } else {
    for (let j = 0; j < 7; j++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const t = .12 + i / 24 * .81; pts.push(heartPoint(j / 7 + .035 * Math.sin(t * 12 + j), t, false).multiplyScalar(1.01)); }
      cord(g, `Raised branching vein ${j}`, pts, .0015, skin, false, 44);
    }
    for (let j = 0; j < 5; j++) {
      const r = j === 1 ? .01 : .006, h = j === 1 ? .035 : .022;
      const profile = [V(r * .85, 0, 0), V(r, h * .55, 0), V(r * 1.12, h, 0), V(r * .79, h, 0), V(r * .69, h * .53, 0), V(r * .59, 0, 0)].map(p => new THREE.Vector2(p.x, p.y));
      const vessel = add(g, `Hollow severed artery ${j}`, new THREE.LatheGeometry(profile, 20), base, V((j - 2) * .013, .039 - Math.abs(j - 1) * .003, 0)); vessel.rotation.z = (2 - j) * .21;
    }
  }
}

function ash(g: THREE.Group): void {
  const iron = finish('Rough ash-black shield iron', 0x403b35, .76, .79), edge = finish('Oxidized broken iron edges', 0x65432b, .65, .86);
  const outline: P[] = [[-.042,.058],[-.009,.05],[.049,.039],[.047,.007],[.051,-.042],[.041,-.061],[.02,-.05],[.002,-.055],[-.021,-.037],[-.028,-.019],[-.046,.012],[-.038,.032]];
  const holes: P[] = [[-.029,.043],[.035,.026],[.035,-.034]];
  add(g, 'Broken dense shield plate with three bored holes', solid(outline,.008,.0015,holes,.004), iron);
  for (const [x,y] of holes) { eye(g,'Front forged eyelet',x,y,.006,edge); eye(g,'Back forged eyelet',x,y,-.006,iron); }
  cord(g,'Raised surviving top rim',[V(-.041,.058,.005),V(-.005,.049,.005),V(.048,.039,.005),V(.047,.007,.005),V(.05,-.041,.005)],.002,edge);
  for(let j=0;j<6;j++) {
    const x=-.038+j*.008,y=.005-j*.01;
    add(g,`Broken scale ${j}`,solid([[x,y],[x+.014,y+.01],[x+.018,y-.003],[x+.006,y-.013]],.0017,.0005),edge,V(0,0,.005));
  }
}
function crown(g: THREE.Group): void {
  const iron=finish('Scorched copper iron crown',0x593824,.74,.72),trim=finish('Burnished hot copper edges',0xb36a35,.78,.47);
  const points:P[]=[[-.13,0],[-.131,.016],[-.113,.022],[-.102,.034],[-.095,.086],[-.086,.105],[-.078,.085],[-.077,.045],[-.065,.031],[-.033,.025],[-.018,.04],[-.01,.099],[0,.125],[.01,.099],[.018,.04],[.033,.025],[.065,.031],[.077,.045],[.078,.085],[.086,.105],[.095,.086],[.102,.034],[.113,.022],[.131,.016],[.126,.002],[.119,.005],[.113,-.001],[.101,.001],[-.103,.001],[-.11,.006],[-.122,-.002]];
  const geo=solid(points,.005,.001);
  const pos=geo.getAttribute('position');
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),a=x/.062;pos.setXYZ(i,Math.sin(a)*(.062+z),pos.getY(i)-.025,Math.cos(a)*(.062+z));} geo.computeVertexNormals();
  add(g,'Broken curved three-point crucible crown',geo,iron);
  for(const a of [-1.39,0,1.39]) {
    const x=Math.sin(a)*.067,z=Math.cos(a)*.067;
    const rivet=add(g,'Copper peened crown rivet',new THREE.SphereGeometry(.004,12,8),trim,V(x,-.01,z));rivet.scale.set(1,1,.5);rivet.rotation.y=a;
    const pts:THREE.Vector3[]=[];
    for(let j=0;j<=12;j++){const y=-.003+j/12*(a===0?.101:.08);pts.push(V(Math.sin(a)*.068,y,Math.cos(a)*.068));}
    cord(g,'Raised spear ridge',pts,.0014,trim,false,12);
  }
  const rim:THREE.Vector3[]=[];for(let i=0;i<=60;i++){const a=-2.02+i/60*4.04;rim.push(V(Math.sin(a)*.067,-.019,Math.cos(a)*.067));}cord(g,'Continuous bottom rim',rim,.0018,trim,false,60);
}
function link(g: THREE.Group): void {
  const iron=finish('Hammered black chain iron',0x3b3938,.82,.53),dark=finish('Incised groove borders',0x18151c,.65,.63),magic=finish('Violet living seams',0x552489,.4,.36);magic.emissive.setHex(0x5f19ac);magic.emissiveIntensity=.7;
  const pts:THREE.Vector3[]=[];
  for(let i=0;i<96;i++){const t=i/96*TAU;pts.push(V(.025*Math.sin(t),.054*Math.cos(t),0));}
  cord(g,'Massive oval forged link',pts,.0105,iron,true,128);
  for(let j=0;j<2;j++){
    const seam:THREE.Vector3[]=[];
    for(let i=0;i<=160;i++){const t=i/160*TAU,a=t*6+j*Math.PI,r=.0107;seam.push(V((.025+r*Math.cos(a))*Math.sin(t),(.054+r*Math.cos(a))*Math.cos(t),r*Math.sin(a)));}
    cord(g,`Inlaid winding groove ${j}`,seam,.0011,dark,true,200);
    cord(g,`Living violet vein ${j}`,seam,.0005,magic,true,200);
  }
  g.rotation.z=-.5;
}
function seal(g: THREE.Group): void {
  const iron=finish('Blue-black bastion stamp',0x283541,.8,.64),edge=finish('Worn silver iron relief',0x737779,.9,.48);
  const outline:P[]=[[0,.069],[.031,.05],[.05,.045],[.051,.023],[.046,.016],[.046,-.043],[0,-.072],[-.046,-.043],[-.046,.016],[-.051,.023],[-.05,.045],[-.031,.05]];
  const holes:P[]=[[-.037,.033],[.037,.033],[-.036,-.035],[.036,-.035]];
  add(g,'Breastplate stamp with four through fasteners',solid(outline,.005,.001,holes,.0033),iron);
  const border=shape(outline);border.holes.push(new THREE.Path(outline.map(([x,y])=>new THREE.Vector2(x*.9,y*.9)).reverse()));
  const rim=new THREE.ExtrudeGeometry(border,{depth:.002,bevelEnabled:true,bevelSize:.0008,bevelThickness:.0008,bevelSegments:1,steps:1});
  add(g,'Raised shield perimeter',rim,edge,V(0,0,.003));
  for(const [x,y]of holes){eye(g,'Front fastening rim',x,y,.004,edge,.0038);eye(g,'Rear fastening rim',x,y,-.003,iron,.0038);}
  add(g,'Forge emblem circular rim',new THREE.TorusGeometry(.032,.0018,6,64),edge,V(0,-.002,.004));
  add(g,'Raised anvil stamp',solid([[-.027,-.005],[-.006,-.005],[-.004,0],[.027,0],[.024,-.009],[.009,-.018],[.008,-.025],[.018,-.03],[.018,-.035],[-.02,-.035],[-.02,-.03],[-.01,-.025],[-.008,-.02],[-.01,-.015],[-.022,-.01]],.003,.0006),edge,V(0,0,.006));
  const hammer=new THREE.Group();hammer.name='Diagonal raised hammer';g.add(hammer);hammer.position.set(.002,.018,.006);hammer.rotation.z=-.75;
  add(hammer,'Hammer haft',solid([[-.002,-.021],[.002,-.021],[.002,.012],[-.002,.012]],.003,.0008),edge);
  add(hammer,'Hammer head',solid([[-.012,.008],[.012,.008],[.012,.021],[-.012,.021]],.004,.001),edge);
  for(const y of [-.054,.054]){const diamond=add(g,'Pointed vertical seal ornament',new THREE.OctahedronGeometry(.006),edge,V(0,y,.005));diamond.scale.set(.55,1.7,.5);}
}
function shard(g: THREE.Group): void {
  const black=finish('Black glass-metal fracture',0x15181c,.8,.26),broken=finish('Fresh granular broken end',0x242628,.55,.79);
  // Unequal fork tips and a deeply cut saddle; closed faceted prism with a wandering ridge.
  const outline:P[]=[[-.033,-.061],[-.041,-.04],[-.019,.014],[.002,.063],[.025,.097],[.022,.039],[.029,.024],[.041,.058],[.039,-.008],[.018,-.052],[.004,-.066]];
  const front=outline.map(([x,y])=>V(x,y,.005+(.018*(1-Math.min(1,Math.abs(y)/.1)))));
  const back=outline.map(([x,y])=>V(x,y,-.016));
  const positions:number[]=[],indices:number[]=[];
  for(const p of [...front,...back,V(.004,-.015,.031),V(-.006,-.017,-.025)])positions.push(p.x,p.y,p.z);
  const n=outline.length;
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,2*n,j,n+j,2*n+1,n+i,i,j,n+i,j,n+j,n+i);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
  add(g,'Forked massive black shard',geo.toNonIndexed(),black);
  for(let j=0;j<7;j++){const chip=add(g,`Broken basal crystal ${j}`,new THREE.DodecahedronGeometry(.009,0),broken,V(-.024+j*.008,-.055+Math.sin(j*3)*.005,0));chip.scale.set(.8,.65,1.5);}
}

export const author: ItemModelAuthor = {
  ids: Object.keys(descriptions),
  build(id: string): THREE.Group {
    const description=descriptions[id];if(!description)throw new Error(`Unknown relic ${id}`);
    const g=new THREE.Group();g.name=id;g.userData['itemModel']={itemId:id,author:'relics',reference:`art/item-icons/generated/${id}.png`,description};
    if(id==='grave_thread'||id==='void_thread')threads(g,id==='void_thread');
    else if(id==='molten_heart'||id==='astral_core')hearts(g,id==='molten_heart');
    else if(id==='ashseal_iron')ash(g);else if(id==='furnace_crown')crown(g);else if(id==='chainbound_link')link(g);else if(id==='nightforge_seal')seal(g);else shard(g);
    return g;
  },
};
