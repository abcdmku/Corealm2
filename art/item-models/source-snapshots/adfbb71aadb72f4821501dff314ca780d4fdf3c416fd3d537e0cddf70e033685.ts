import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ItemModelAuthor } from '../contracts.ts';

// Authored against the five approved dragonhide PNGs. Coordinates are the native male T-pose.
type V = THREE.Vector3;
type Surface = (u: number, v: number) => { p: V; n: V };
type Mat = 'hide' | 'scale' | 'scaleDark' | 'leather' | 'silver' | 'thread';
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
function materials(): Record<Mat, THREE.MeshStandardMaterial> {
  const make = (name: Mat, color: number, roughness: number, metalness = 0) => {
    const bytes = new Uint8Array(64 * 64 * 4);
    const rough = new Uint8Array(64 * 64 * 4);
    const c = new THREE.Color(color).convertLinearToSRGB();
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const grain = Math.sin(x * 13.31 + y * 7.13) * Math.sin(x * 2.13 - y * 17.9);
      const f = .88 + .11 * grain + .025 * Math.sin(x * .31 + y * .17);
      bytes[i] = Math.round(c.r * f * 255);
      bytes[i + 1] = Math.round(c.g * f * 255);
      bytes[i + 2] = Math.round(c.b * f * 255); bytes[i + 3] = 255;
      const r = Math.round(255 * (.87 + .09 * Math.sin(x * 9.7 + y * 15.3)));
      rough.set([r, r, r, 255], i);
    }
    const map = new THREE.DataTexture(bytes, 64, 64); map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true;
    const roughnessMap = new THREE.DataTexture(rough, 64, 64); roughnessMap.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map, roughnessMap, roughness, metalness });
    m.name = `dragonhide-${name}`; return m;
  };
  return { hide: make('hide', 0x3b1417, .92), scale: make('scale', 0x792c2a, .48, .12),
    scaleDark: make('scaleDark', 0x552023, .52, .1), leather: make('leather', 0x30221f, .76),
    silver: make('silver', 0xb8aaa0, .37, .82), thread: make('thread', 0xb8af96, .9) };
}
class Work {
  readonly root = new THREE.Group();
  readonly mats = materials();
  readonly parts = new Map<string, { mat: Mat; geos: THREE.BufferGeometry[] }>();
  add(name: string, geo: THREE.BufferGeometry, mat: Mat) {
    const key = `${name}-${mat}`;
    if (!this.parts.has(key)) this.parts.set(key, { mat, geos: [] });
    this.parts.get(key)!.geos.push(geo.index ? geo.toNonIndexed() : geo);
  }
  poly(name: string, vertices: V[], indices: number[], mat: Mat) {
    const positions: number[] = []; const uv: number[] = [];
    for (const i of indices) { const p = vertices[i]!; positions.push(p.x, p.y, p.z); uv.push(p.x * 17 + p.z * 11, p.y * 17 + p.z * 7); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); this.add(name, g, mat);
  }
  pipe(name: string, points: V[], radius: number, mat: Mat, closed = false) {
    if (points.length < 2) return;
    if(points.length===2) {
      const d=points[1]!.clone().sub(points[0]!); const g=new THREE.CylinderGeometry(radius,radius,d.length(),4,1,false);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(vec(0,1,0),d.normalize()));g.translate(...points[0]!.clone().add(points[1]!).multiplyScalar(.5).toArray());this.add(name,g,mat);return;
    }
    this.add(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), Math.max(2, points.length), radius, 5, closed), mat);
  }
  finish() {
    for (const [name, part] of this.parts) {
      const geo = mergeGeometries(part.geos); if (!geo) throw new Error(`Cannot merge ${name}`);
      const mesh = new THREE.Mesh(geo, this.mats[part.mat]); mesh.name = name; this.root.add(mesh);
    }
    return this.root;
  }
}
function offset(s: Surface, u: number, v: number, amount = 0): V {
  const a = s(u, v); return a.p.addScaledVector(a.n, amount);
}
function shell(w: Work, name: string, s: Surface, nu = 40, nv = 12, thickness = .004, mat: Mat = 'hide') {
  const p: V[] = []; const ids: number[] = []; const stride = nu + 1; const layer = stride * (nv + 1);
  for (let k = 0; k < 2; k++) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) p.push(offset(s, i / nu, j / nv, k ? -thickness : 0));
  const quad = (a: number, b: number, c: number, d: number) => ids.push(a, b, c, a, c, d);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * stride + i; quad(a, a + 1, a + stride + 1, a + stride);
    quad(a + layer, a + stride + layer, a + stride + 1 + layer, a + 1 + layer);
  }
  for (let i = 0; i < nu; i++) { quad(i, i + layer, i + layer + 1, i + 1); const a = nv * stride + i; quad(a, a + 1, a + 1 + layer, a + layer); }
  for (let j = 0; j < nv; j++) { const a = j * stride; quad(a, a + stride, a + stride + layer, a + layer); const b = a + nu; quad(b, b + layer, b + stride + layer, b + stride); }
  const facing=p[1]!.clone().sub(p[0]!).cross(p[stride+1]!.clone().sub(p[0]!)).dot(s(.01,.01).n);
  if(facing<0) for(let i=0;i<ids.length;i+=3) [ids[i+1],ids[i+2]]=[ids[i+2]!,ids[i+1]!];
  w.poly(name, p, ids, mat);
}
function scales(w: Work, name: string, s: Surface, cols: number, rows: number, startV = .015, endV = .98) {
  // Closed, convex shield scales with lifted centers and dark actual edges, overlapping in staggered rows.
  const shape = [[-.48,.45],[.48,.45],[.53,.06],[.39,-.34],[0,-.67],[-.39,-.34],[-.53,.06]];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = (c + .5 + (r % 2) * .48) / cols; if (u > .99) continue;
    const v = startV + (r + .6) / rows * (endV - startV);
    const vertices = shape.map(([x,y]) => offset(s, Math.max(.001, Math.min(.999, u + x! / cols)), Math.max(.001, Math.min(.999, v + y! * (endV - startV) / rows)), .003));
    vertices.push(offset(s, u, v, .006));
    for (let i = 0; i < 7; i++) vertices.push(vertices[i]!.clone().addScaledVector(s(u, v).n, -.0025));
    const faces: number[] = []; const edges: number[] = [];
    const outward=vertices[1]!.clone().sub(vertices[7]!).cross(vertices[0]!.clone().sub(vertices[7]!)).dot(s(u,v).n)>0;
    for (let i = 0; i < 7; i++) { const j = (i + 1) % 7; faces.push(7, j, i); edges.push(i,j,j+8,i,j+8,i+8); }
    for (let i = 1; i < 6; i++) edges.push(8, i + 8, i + 9);
    if(!outward) { for(let i=0;i<faces.length;i+=3) [faces[i+1],faces[i+2]]=[faces[i+2]!,faces[i+1]!]; for(let i=0;i<edges.length;i+=3) [edges[i+1],edges[i+2]]=[edges[i+2]!,edges[i+1]!]; }
    w.poly(name, vertices, faces, (r * 7 + c * 3) % 5 === 0 ? 'scaleDark' : 'scale');
    w.poly(`${name}-edges`, vertices, edges, 'scaleDark');
  }
}
function trim(w: Work, name: string, s: Surface, path: (t: number) => [number, number], width = .012, stitches = 20) {
  const points: V[] = [];
  for (let i = 0; i <= 36; i++) { const [u,v] = path(i/36); points.push(offset(s,u,v,.008)); }
  w.pipe(name, points, width * .5, 'leather');
  for (let i = 0; i < stitches; i++) {
    const t = (i + .5) / stitches; const [u,v] = path(t); const p = offset(s,u,v,.009 + width*.5);
    const tangent = points[Math.min(36,Math.floor(t*36)+1)]!.clone().sub(points[Math.max(0,Math.floor(t*36)-1)]!).normalize();
    const across = s(u,v).n.clone().cross(tangent).normalize();
    for (const sign of [-1,1]) w.pipe('grave-thread-cross-stitches', [p.clone().addScaledVector(tangent,-width*.26).addScaledVector(across,sign*width*.29),p.clone().addScaledVector(tangent,width*.26).addScaledVector(across,-sign*width*.29)], .001, 'thread');
  }
}
function ring(x: number, z: number, y0: number, y1: number, profile: (v: number) => [number,number], gap = 0): Surface {
  return (u,v) => { const a = gap + u * (TAU - 2*gap); const [rx,rz] = profile(v);
    return { p: vec(x + rx*Math.sin(a), y0+(y1-y0)*v,z+rz*Math.cos(a)), n:vec(Math.sin(a)/rx,0,Math.cos(a)/rz).normalize() }; };
}
function band(w: Work, name: string, s: Surface, v: number, width = .025) {
  const b: Surface = (u,t) => { const q=s(u,v+(t-.5)*width); return { p:q.p.addScaledVector(q.n,.009),n:q.n }; };
  shell(w,name,b,40,2,.004,'leather'); trim(w,`${name}-rim`,b,t=>[t,.07],.004,25);
}
function clasp(w: Work, p: V, size = .027) {
  const shape = new THREE.Shape(); shape.moveTo(0,size); shape.lineTo(size*.7,0); shape.lineTo(0,-size); shape.lineTo(-size*.7,0); shape.closePath();
  const hole = new THREE.Path(); hole.moveTo(0,size*.62); hole.lineTo(-size*.38,0); hole.lineTo(0,-size*.62); hole.lineTo(size*.38,0); hole.closePath(); shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape,{depth:.003,bevelEnabled:true,bevelThickness:.001,bevelSize:.001,bevelSegments:1,steps:1}); g.translate(p.x,p.y,p.z); w.add('engraved-silver-diamond-fasteners',g,'silver');
  w.pipe('silver-fastener-crossbar',[p.clone().add(vec(-size*.4,0,.004)),p.clone().add(vec(size*.4,0,.004))],.0015,'silver');
}
function hood(w: Work) {
  const s: Surface = (u,v) => {
    const y=1.485+v*.37; const radius=Math.sqrt(Math.max(.002,1-((y-1.665)/.191)**2));
    const gap=.12+Math.sin(Math.PI*v)*.98; const a=gap+u*(TAU-2*gap);
    return {p:vec(.145*radius*Math.sin(a),y,-.013+.171*radius*Math.cos(a)),n:vec(Math.sin(a),((y-1.665)/.191)*.65,Math.cos(a)).normalize()};
  };
  shell(w,'hollow-scale-hood-lined-interior',s,48,22,.006); scales(w,'hood-overlapping-scales',s,28,17);
  trim(w,'left-stitched-face-opening',s,t=>[0,t],.016,26); trim(w,'right-stitched-face-opening',s,t=>[1,t],.016,26);
  trim(w,'hood-rear-center-seam',s,t=>[.5,t],.011,20);
  const cape=ring(0,-.028,1.40,1.525,v=>[.275-.17*v,.18-.091*v],.13);
  shell(w,'hollow-shoulder-mantle',cape,48,7,.006); scales(w,'mantle-large-dragon-scales',cape,28,6);
  trim(w,'mantle-scalloped-hem',cape,t=>[t,0],.012,46);
  for (const u of [0,1]) trim(w,'mantle-front-border',cape,t=>[u,t],.012,10);
  clasp(w,vec(0,1.455,.146),.026);
}
function robe(w: Work) {
  const chest: Surface = (u,v) => {
    const a=.065+u*(TAU-.13); const rx=.145+.045*Math.sin(v*Math.PI*.66); const rz=.115+.025*Math.sin(v*Math.PI*.78);
    const top=1.50-.23*Math.pow(Math.max(0,Math.cos(a)),6);
    return {p:vec(rx*Math.sin(a),1.035+(top-1.035)*v,-.015+rz*Math.cos(a)),n:vec(Math.sin(a),0,Math.cos(a)).normalize()};
  };
  shell(w,'fitted-open-front-bodice',chest,40,12,.006); scales(w,'bodice-fine-scales',chest,28,11);
  trim(w,'raised-v-neck-leather-facing',chest,t=>[t,1],.016,40);
  for (const u of [0,1,.22,.78]) trim(w,'bodice-panel-seams',chest,t=>[u,t],.013,18);
  const skirt=ring(0,-.02,.16,1.055,v=>[.34-.191*v+.012*Math.sin(v*Math.PI),.237-.115*v],.095);
  shell(w,'long-hollow-split-robe-skirt',skirt,44,16,.006); scales(w,'skirt-dragon-scales',skirt,32,23);
  trim(w,'weighted-stitched-robe-hem',skirt,t=>[t,0],.015,64);
  for (const u of [0,1,.14,.86,.5]) trim(w,'long-stitched-gore-borders',skirt,t=>[u,t],.016,38);
  const waist=ring(0,-.02,1.018,1.08,()=>[.157,.13]); shell(w,'broad-leather-waist-belt',waist,48,3,.005,'leather');
  trim(w,'belt-upper-stitched-border',waist,t=>[t,.9],.005,38); trim(w,'belt-lower-stitched-border',waist,t=>[t,.1],.005,38);
  clasp(w,vec(0,1.048,.119),.037);
  for (const y of [1.17,1.265]) { w.pipe('chest-toggle-leather-cord',[vec(-.035,y,.143),vec(0,y-.009,.151),vec(.035,y,.143)],.003,'leather'); clasp(w,vec(-.04,y,.146),.015); clasp(w,vec(.04,y,.146),.015); }
  for (const sign of [-1,1]) {
    const sleeve: Surface = (u,v) => { const a=u*TAU; const r=.066+.025*v+.04*Math.pow(1-v,4); return {p:vec(sign*(.66-.45*v),1.455+r*Math.sin(a),-.065+r*Math.cos(a)),n:vec(0,Math.sin(a),Math.cos(a))}; };
    shell(w,'hollow-flared-sleeve',sleeve,26,10,.005); scales(w,'sleeve-scales',sleeve,18,11);
    trim(w,'wide-sleeve-cuff',sleeve,t=>[t,0],.014,30); trim(w,'sleeve-lengthwise-leather-seam',sleeve,t=>[.12,t],.012,23);
  }
}
function leggings(w: Work) {
  const hip=ring(0,-.035,.865,1.045,v=>[.176+.005*v,.117+.009*v]);
  shell(w,'hollow-fitted-pelvic-yoke',hip,40,7,.004); scales(w,'hip-scales',hip,30,7);
  band(w,'reinforced-waistband',hip,.86,.24); clasp(w,vec(0,1.025,.105),.024);
  for (const sign of [-1,1]) {
    const leg=ring(sign*.1143,-.036,.16,.919,v=>{
      const rx=.053+.043*v+.009*Math.sin(v*Math.PI); return [rx,rx*.92];
    });
    shell(w,'separate-hollow-fitted-leg',leg,28,16,.004); scales(w,'leg-small-overlapping-scales',leg,22,26);
    for (const u of [.11,.56]) trim(w,'stitched-leg-panel-seam',leg,t=>[u,t],.012,34);
    band(w,'ankle-leather-binding',leg,.02,.035);
    // The backing sits in front of the fine-scale trouser shell. Its pointed lower
    // outline and three independently domed plates remain visible at game distance.
    const knee: Surface = (u,v) => {
      const a=(u-.5)*2.08; const width=.026+.053*Math.sin(v*Math.PI*.53);
      return {p:vec(sign*.1143+width*Math.sin(a),.430+v*.195+.013*Math.sin(Math.PI*u)*v,-.009+.088*Math.cos(a)),n:vec(Math.sin(a),0,Math.cos(a))};
    };
    shell(w,'raised-pointed-knee-leather-backing',knee,16,9,.007,'leather');
    for(let tier=0;tier<3;tier++) {
      const cy=.594-tier*.046; const width=.060-tier*.007;
      const outline=[[-1,.031],[1,.031],[1.02,.005],[.74,-.024],[0,-.048],[-.74,-.024],[-1.02,.005]];
      const vertices=outline.map(([px,py])=>vec(sign*.1143+px!*width,cy+py!,.069+.016*(1-Math.abs(px!))+(2-tier)*.003));
      vertices.push(vec(sign*.1143,cy,.100+(2-tier)*.003));
      for(let i=0;i<7;i++) vertices.push(vertices[i]!.clone().add(vec(0,0,-.006)));
      const front:number[]=[];const sides:number[]=[];
      for(let i=0;i<7;i++){const j=(i+1)%7;front.push(7,j,i);sides.push(i,j,j+8,i,j+8,i+8);}
      for(let i=1;i<6;i++)sides.push(8,i+8,i+9);
      w.poly('three-raised-overlapping-knee-shields',vertices,front,'scale');
      w.poly('knee-shield-thick-dark-edges',vertices,sides,'scaleDark');
      w.pipe('knee-shield-raised-rim',vertices.slice(0,7),.0015,'scaleDark',true);
    }
    trim(w,'knee-side-binding-left',knee,t=>[0,t],.010,11); trim(w,'knee-side-binding-right',knee,t=>[1,t],.010,11);
    trim(w,'knee-top-chevron-binding',knee,t=>[t,1],.009,10);
    trim(w,'knee-pointed-bottom-binding',knee,t=>[t,0],.008,7);
    // Broad outer-thigh lames lie over a separate stitched leather side panel.
    const side: Surface=(u,v)=>{
      const theta=sign*(.56+u*.91);const y=.69+.248*v;const ry=(y-.16)/.759;
      const r=.053+.043*ry+.009*Math.sin(ry*Math.PI);
      return {p:vec(sign*.1143+(r+.014)*Math.sin(theta),y,-.036+(r*.92+.014)*Math.cos(theta)),n:vec(Math.sin(theta),0,Math.cos(theta))};
    };
    shell(w,'raised-outer-thigh-leather-panel',side,12,9,.005,'leather');
    // Separate non-staggered lames avoid the half-width offset of fine scale rows.
    for(let tier=0;tier<3;tier++){
      const cy=.20+tier*.28;
      const vertices=[offset(side,.05,cy+.16,.007),offset(side,.95,cy+.16,.007),offset(side,.97,cy-.01,.010),offset(side,.50,cy-.17,.014),offset(side,.03,cy-.01,.010),offset(side,.5,cy,.022)];
      for(let i=0;i<5;i++)vertices.push(vertices[i]!.clone().addScaledVector(side(.5,cy).n,-.005));
      const front:number[]=[];const edge:number[]=[];
      for(let i=0;i<5;i++){const j=(i+1)%5;front.push(5,j,i);edge.push(i,j,j+6,i,j+6,i+6);}
      edge.push(6,7,8,6,8,9,6,9,10);
      if(sign<0){for(let i=0;i<front.length;i+=3)[front[i+1],front[i+2]]=[front[i+2]!,front[i+1]!];for(let i=0;i<edge.length;i+=3)[edge[i+1],edge[i+2]]=[edge[i+2]!,edge[i+1]!];}
      w.poly('three-large-outer-thigh-lames',vertices,front,'scale');w.poly('outer-thigh-lame-thick-edges',vertices,edge,'scaleDark');
    }
    for(const u of [0,1])trim(w,'outer-thigh-panel-stitched-binding',side,t=>[u,t],.009,14);
  }
}
function boots(w: Work) {
  for (const sign of [-1,1]) {
    const x=sign*.1143;
    const shaft=ring(x,-.067,.072,.397,v=>[.059+.016*v,.072+.008*v]);
    shell(w,'open-lined-calf-boot-shaft',shaft,32,12,.005); scales(w,'boot-shaft-scales',shaft,21,14);
    band(w,'thick-stitched-boot-cuff',shaft,.96,.07);
    for (const u of [.17,.83]) trim(w,'curved-boot-panel-binding',shaft,t=>[u+.07*Math.sin(t*Math.PI),t],.012,24);
    const foot: Surface = (u,v) => { const a=u*TAU; const z=-.137+v*.337; const r=.063*(.72+.28*Math.sin(Math.PI*v)); const h=.036+.062*Math.sin(Math.PI*v); return {p:vec(x+r*Math.sin(a),.034+h*(.5+.5*Math.cos(a)),z),n:vec(Math.sin(a),Math.cos(a),0).normalize()}; };
    shell(w,'closed-toe-shaped-vamp',foot,28,16,.005); scales(w,'vamp-fine-scales',foot,20,12);
    // The small rounded endcaps close toe and heel independently of the open calf.
    for (const z of [-.137,.20]) {const g=new THREE.SphereGeometry(1,16,10);g.scale(.046,.019,.014);g.translate(x,.053,z);w.add('rounded-closed-boot-toe-and-heel',g,'scaleDark');}
    const sole=ring(x,.028,.013,.034,()=>[.068,.181]); shell(w,'layered-leather-sole',sole,48,2,.014,'leather');
    const soleFloor=new THREE.CylinderGeometry(1,1,.012,48);soleFloor.scale(.067,1,.18);soleFloor.translate(x,.017,.028);w.add('closed-leather-sole-bottom',soleFloor,'leather');
    trim(w,'stitched-sole-welt',sole,t=>[t,.72],.004,42);
    for (const y of [.15,.29]) {
      trim(w,'diagonal-boot-fastening-strap',shaft,t=>[t,.15+(y-.15)/.325+.18*Math.sin(t*TAU)],.018,28);
      clasp(w,vec(x+sign*.036,y,.006),.017);
    }
    trim(w,'toe-leather-binding',foot,t=>[t,.78],.011,22);
  }
}
function wraps(w: Work) {
  for (const sign of [-1,1]) {
    // Hand long axis is X; thumb points +Z in the native arm pose.
    const glove: Surface = (u,v) => { const a=u*TAU; const r=.037+.01*Math.sin(v*Math.PI); return {p:vec(sign*(.62+v*.17),1.455+r*.68*Math.sin(a),-.065+r*Math.cos(a)),n:vec(0,Math.sin(a),Math.cos(a))};};
    shell(w,'hollow-fingerless-wrap-body',glove,28,12,.0035); scales(w,'hand-and-wrist-scales',glove,18,9);
    trim(w,'open-wrist-stitched-binding',glove,t=>[t,0],.011,23);
    trim(w,'open-knuckle-stitched-binding',glove,t=>[t,1],.009,21);
    for (const phase of [.15,.54]) trim(w,'crossed-leather-hand-wrap',glove,t=>[t,phase+.24*Math.sin(t*TAU)],.018,25);
    clasp(w,vec(sign*.657,1.458,-.015),.017);
    // Four separate open finger collars beyond the palm, with actual wall thickness.
    for (let i=0;i<4;i++) {
      const z=-.096+i*.021;
      const f: Surface=(u,v)=>{const a=u*TAU;return {p:vec(sign*(.777+.026*v),1.455+.010*Math.sin(a),z+.010*Math.cos(a)),n:vec(0,Math.sin(a),Math.cos(a))};};
      shell(w,'individual-open-finger-collar',f,14,3,.0025,'leather');trim(w,'finger-opening-stitches',f,t=>[t,1],.0035,9);
    }
    const thumb: Surface=(u,v)=>{const a=u*TAU;return {p:vec(sign*(.73+.013*Math.cos(a)),1.445+.014*Math.sin(a),-.025+.034*v),n:vec(Math.cos(a)*sign,Math.sin(a),0)};};
    shell(w,'open-thumb-wrap',thumb,18,4,.003,'leather');trim(w,'thumb-opening-cross-stitches',thumb,t=>[t,1],.005,12);
  }
}
const ids = ['dragonhide_hood','dragonhide_robe','dragonhide_leggings','dragonhide_boots','dragonhide_wraps'] as const;
export const author: ItemModelAuthor = {
  ids,
  build(itemId: string): THREE.Group {
    if (!ids.includes(itemId as typeof ids[number])) throw new Error(`Unknown dragonhide item ${itemId}`);
    const w=new Work();
    const kind=itemId.slice('dragonhide_'.length);
    if(kind==='hood') hood(w); else if(kind==='robe') robe(w); else if(kind==='leggings') leggings(w); else if(kind==='boots') boots(w); else wraps(w);
    const root=w.finish(); root.name=itemId;
    root.userData.itemModel={itemId,author:'armor-dragonhide',reference:`art/item-icons/generated/${itemId}.png`,description:`Dragonhide ${kind} sewn with Grave Thread. Requires level 50 Magic. Burgundy overlapping dragon scales, cross-stitched leather bindings and silver fastenings.`,wearable:true};
    return root;
  },
};
