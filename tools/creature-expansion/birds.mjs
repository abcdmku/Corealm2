import * as THREE from 'three';
import { birdProfiles } from './birds/profiles.mjs';

export const SPECIES = ['blackwater_heron', 'scree_bustard', 'marchfield_turkey'];

const TAU = Math.PI * 2;
const v = (a) => new THREE.Vector3(...a);
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const color = (c) => new THREE.Color(c);

class Sculpture {
  constructor() { this.p = []; this.c = []; this.uv = []; this.i = []; this.w = []; this.faces = []; this.groups = []; this.normalOverrides=[]; }
  vertex(point, tint, weights, uv) {
    const n = this.p.length / 3;
    this.p.push(point.x, point.y, point.z);
    this.c.push(tint.r, tint.g, tint.b);
    this.uv.push(...uv);
    this.i.push(weights[0][0], weights[1]?.[0] ?? 0, 0, 0);
    this.w.push(weights[0][1], weights[1]?.[1] ?? 0, 0, 0);
    return n;
  }
  grid(rows, cols, position, tint, weights, flip = true) {
    const start = this.p.length / 3, faceStart=this.faces.length;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      const u = r / rows, a = c / cols;
      const uv = this.uvRegion === 'feather' ? [.04 + a * .70, .04 + u * .90] : [.81 + a * .18, .02 + u * .96];
      this.vertex(position(u, a), tint(u, a), weights(u, a), uv);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = start + r * (cols + 1) + c, b = a + cols + 1;
      const triangle=(i,j,k)=>{
        if(this.skipCollapsedCaps&&(r===0||r===rows-1)){
          const ax=this.p[j*3]-this.p[i*3],ay=this.p[j*3+1]-this.p[i*3+1],az=this.p[j*3+2]-this.p[i*3+2];
          const bx=this.p[k*3]-this.p[i*3],by=this.p[k*3+1]-this.p[i*3+1],bz=this.p[k*3+2]-this.p[i*3+2];
          const cx=ay*bz-az*by,cy=az*bx-ax*bz,cz=ax*by-ay*bx;
          if(cx*cx+cy*cy+cz*cz===0)return;
        }
        this.faces.push(i,j,k);
      };
      if (flip) {triangle(a,a+1,b);triangle(a+1,b+1,b);}
      else {triangle(a,b,a+1);triangle(a+1,b,b+1);}
    }
    this.groups.push({start:faceStart,count:this.faces.length-faceStart,material:this.materialIndex??0});
    if(this.preserveDenseFeatherNormals){
      // Reduced vanes retain the accepted eight-segment surface normals. Recomputing them
      // from a four-sided cross-section otherwise makes the very thin edges shade like ridges.
      const densePositions=[],denseIndices=[];
      for(let r=0;r<=rows;r++)for(let c=0;c<=8;c++)densePositions.push(...position(r/rows,c/8).toArray());
      for(let r=0;r<rows;r++)for(let c=0;c<8;c++){
        const a=r*9+c,b=a+9;
        if(flip)denseIndices.push(a,a+1,b,a+1,b+1,b);else denseIndices.push(a,b,a+1,a+1,b,b+1);
      }
      const denseGeometry=new THREE.BufferGeometry();denseGeometry.setAttribute('position',new THREE.Float32BufferAttribute(densePositions,3));denseGeometry.setIndex(denseIndices);denseGeometry.computeVertexNormals();
      const normals=denseGeometry.attributes.normal,leftLower=new Map();
      const sampledNormal=(r,a,b=a)=>new THREE.Vector3().fromBufferAttribute(normals,r*9+a).lerp(new THREE.Vector3().fromBufferAttribute(normals,r*9+b),.50).normalize();
      for(let r=0;r<=rows;r++){
        // The upper and lower vanes meet at a sharp paper-thin edge. Split the left edge's
        // shading seam, just as the existing UV seam already splits the right edge.
        const left=start+r*5+2,duplicate=this.p.length/3;leftLower.set(left,duplicate);
        this.p.push(...this.p.slice(left*3,left*3+3));this.c.push(...this.c.slice(left*3,left*3+3));this.uv.push(...this.uv.slice(left*2,left*2+2));this.i.push(...this.i.slice(left*4,left*4+4));this.w.push(...this.w.slice(left*4,left*4+4));
        const retained=[sampledNormal(r,0,1),sampledNormal(r,2),sampledNormal(r,4,3),sampledNormal(r,6),sampledNormal(r,8,7)];
        for(let c=0;c<5;c++)this.normalOverrides.push([start+r*5+c,...retained[c].toArray()]);
        this.normalOverrides.push([duplicate,...sampledNormal(r,4,5).toArray()]);
      }
      for(let face=faceStart;face<this.faces.length;face+=3){
        const triangle=this.faces.slice(face,face+3),lower=triangle.some(i=>(i-start)%5===3);
        if(lower)for(let corner=0;corner<3;corner++)if(leftLower.has(triangle[corner]))this.faces[face+corner]=leftLower.get(triangle[corner]);
      }
      denseGeometry.dispose();
    }
  }
  tube(points, radii, tint, weights, radial = 12, steps = 24) {
    const curve = new THREE.CatmullRomCurve3(points.map(v));
    const frames = curve.computeFrenetFrames(steps, false);
    this.grid(steps, radial, (u, a) => {
      const idx = u * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(idx));
      const rr = mix(radii[k], radii[k + 1], idx - k);
      const f = Math.round(u * steps), t = a * TAU;
      return curve.getPoint(u).addScaledVector(frames.normals[f], Math.cos(t) * rr).addScaledVector(frames.binormals[f], Math.sin(t) * rr);
    }, typeof tint === 'function' ? tint : () => color(tint), weights);
  }
  oval(center, radii, tint, weights, rows = 18, cols = 28, sculpt = null) {
    const cc = v(center);
    this.grid(rows, cols, (u, a) => {
      const ph = u * Math.PI, th = a * TAU;
      const p = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
      if (sculpt) sculpt(p, u, a);
      return p.multiply(v(radii)).add(cc);
    }, typeof tint === 'function' ? tint : () => color(tint), typeof weights === 'function' ? weights : () => weights);
  }
  feather(start, end, width, tint, weights, opts = {}) {
    const base = v(start), axis = v(end).sub(base), length = axis.length();
    const direction = axis.clone().normalize();
    let normal = v(opts.normal ?? [0, 1, 0]);
    if (Math.abs(normal.dot(direction)) > .92) normal = new THREE.Vector3(0, 0, 1);
    const cross = new THREE.Vector3().crossVectors(normal, direction).normalize();
    normal.crossVectors(direction, cross).normalize();
    const dark = color(opts.dark ?? tint).multiplyScalar(.63), baseColor = color(tint);
    const mapU = u => opts.roundTip ? 1 - Math.pow(1 - u, 1.7) : u;
    const previousRegion = this.uvRegion, previousMaterial=this.materialIndex,previousCaps=this.skipCollapsedCaps,previousNormals=this.preserveDenseFeatherNormals;
    this.uvRegion = 'feather';this.materialIndex=opts.material??0;this.skipCollapsedCaps=true;this.preserveDenseFeatherNormals=true;
    // Keep both vane edges and both keel extrema. The four removed cross-section samples
    // were interior to the thin vane; every longitudinal outline and rounded-tip sample remains.
    this.grid(opts.steps ?? 8, 4, (rawU, a) => {
      const u = mapU(rawU);
      const th = TAU * a;
      const shape = u===0||u===1 ? 0 : opts.roundTip
        ? (u < .15 ? Math.sin(u / .15 * Math.PI * .5) : u < .88 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((u - .88) / .12, 2))))
        : Math.pow(Math.sin(Math.PI * Math.pow(u, .80)), .63) * (.94 - .19 * u);
      const vane = Math.cos(th) * width * .5 * shape * (Math.cos(th) > 0 ? 1 : .66);
      const keel = Math.sin(th) * width * .012 * shape;
      return base.clone().addScaledVector(direction, length * u).addScaledVector(cross, vane)
        .addScaledVector(normal, keel + Math.sin(Math.PI * u) * length * (opts.arch ?? .012));
    }, (rawU, a) => {
      const u = mapU(rawU);
      const b = baseColor.clone();
      if (opts.bars) {
        const band = Math.sin(u * TAU * opts.bars + (opts.barPhase ?? 0) + .5 * Math.abs(Math.cos(a * TAU)));
        b.lerp(dark, smooth((band - .52) * 3) * (opts.barStrength??.63));
        if (u > .87) b.lerp(color(opts.tip ?? 0xc6ae84), smooth((u - .87) / .07));
      }
      const ridge = Math.pow(Math.abs(Math.sin(a * TAU)), 12);
      return b.multiplyScalar(.91 + .10 * ridge + .035 * Math.sin(u * 95 + Math.abs(Math.cos(a * TAU)) * 8));
    }, () => weights);
    this.uvRegion = previousRegion;this.materialIndex=previousMaterial;this.skipCollapsedCaps=previousCaps;this.preserveDenseFeatherNormals=previousNormals;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.i, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.w, 4));
    const ordered=[];
    for(const material of [...new Set(this.groups.map(group=>group.material))].sort()){
      const start=ordered.length;
      for(const group of this.groups)if(group.material===material)ordered.push(...this.faces.slice(group.start,group.start+group.count));
      g.addGroup(start,ordered.length-start,material);
    }
    g.setIndex(ordered); g.computeVertexNormals();
    for(const[index,x,y,z]of this.normalOverrides)g.attributes.normal.setXYZ(index,x,y,z);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

function makeRig(p) {
  const object = new THREE.Group(); object.name = p.name;
  const bones = [], named = {}, rest = {};
  function bone(name, point, parent = null) {
    const b = new THREE.Bone(); b.name = name;
    const wp = v(point); b.position.copy(wp);
    if (parent) b.position.sub(rest[parent.name].world);
    (parent ?? object).add(b); bones.push(b); named[name] = b;
    rest[name] = { world: wp, position: b.position.clone(), quaternion: b.quaternion.clone() };
    return b;
  }
  const root = bone('Root', [0, 0, 0]);
  const body = bone('Body', [0, p.hipY, p.hipZ], root);
  const neck = p.neck.map((r, i) => bone(`Neck${i + 1}`, r.center, i ? named[`Neck${i}`] : body));
  bone('Head', p.head.center, neck.at(-1));
  const head = named.Head;
  bone('Jaw', [0, p.head.center[1] - p.head.radii[1] * .35, p.head.center[2] + p.head.radii[2] * .45], head);
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    bone(`Wing${s}`, [side * p.body.radii[0] * .68, p.body.center[1] + .045, p.body.center[2] + p.body.radii[2] * .34], body);
    bone(`WingTip${s}`, [side * p.body.radii[0] * .88, p.body.center[1] - .015, p.body.center[2] - p.body.radii[2] * .25], named[`Wing${s}`]);
    bone(`Thigh${s}`, [side * p.legX, p.hipY, p.hipZ], body);
    bone(`Shin${s}`, [side * p.legX, p.knee[0], p.knee[1]], named[`Thigh${s}`]);
    bone(`Foot${s}`, [side * p.legX, p.ankle[0], p.ankle[1]], named[`Shin${s}`]);
    bone(`Toe${s}`, [side * p.legX, .025, p.ankle[1] + p.footLength * .50], named[`Foot${s}`]);
  }
  bone('Tail', p.tail.center, body);
  bone('TailTip', [0, p.tail.center[1] + p.tail.height * .35, p.tail.center[2] - p.tail.length * .4], named.Tail);
  object.updateMatrixWorld(true);
  return { object, bones, named, rest, index: (name) => bones.indexOf(named[name]) };
}

function anatomy(p, r) {
  const g = new Sculpture(), C = p.palette;
  const single = (name) => [[r.index(name), 1]];
  const blend = (a, b, t) => [[r.index(a), 1 - t], [r.index(b), t]];
  const body = p.body, isHeron = p.kind === 'heron', isTurkey = p.kind === 'turkey';
  const center = body.center, rad = body.radii;
  const bodySculpt = pt => {
    const chest = Math.max(0, pt.z), rump = Math.max(0, -pt.z);
    pt.x *= 1 - .16 * rump + .07 * chest;
    if (pt.y < 0) { pt.y *= 1 + .12 * chest; pt.z += .10 * (-pt.y); }
    if (pt.y > 0) pt.y *= 1 - .08 * Math.pow(pt.z + .3, 2);
    return pt;
  };
  const bodySurface = (phi, theta, offset = .003) => {
    const n = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
    const pt = bodySculpt(n.clone()).multiply(v(rad)).add(v(center));
    const normal = new THREE.Vector3(n.x / rad[0], n.y / rad[1], n.z / rad[2]).normalize();
    return { point: pt.addScaledVector(normal, offset), normal };
  };
  g.oval(center, rad, (u, a) => {
    const front = Math.sin(a * TAU), bottom = -Math.cos(u * Math.PI);
    if(isTurkey)return color(0x65523a).lerp(color(0x443b2b),clamp(bottom)*.42);
    return color(C.body).lerp(color(C.belly), clamp(bottom * .6 + front * .24)).multiplyScalar(.93 + .06 * Math.sin(u * 27 + a * 45));
  }, single('Body'), 18, 28, bodySculpt);
  // Continuous curved neck skin with paired weights at every ring.
  const neckCurve = new THREE.CatmullRomCurve3(p.neck.map(n => v(n.center)));
  const neckSurface = (u, a, offset = 0) => {
    const f = u * (p.neck.length - 1), k = Math.min(p.neck.length - 2, Math.floor(f)), t = f - k;
    const rx = mix(p.neck[k].radiusX, p.neck[k + 1].radiusX, t);
    const rz = mix(p.neck[k].radiusZ, p.neck[k + 1].radiusZ, t);
    const tangent = neckCurve.getTangent(u).normalize();
    const right = new THREE.Vector3(1, 0, 0), outward = new THREE.Vector3().crossVectors(right, tangent).normalize();
    const normal = right.clone().multiplyScalar(Math.cos(a * TAU)).addScaledVector(outward, Math.sin(a * TAU)).normalize();
    const wrinkle = isTurkey ? .0014 * Math.sin(u * 95 + a * 35) * Math.sin(a * 61 - u * 25) : 0;
    return { point: neckCurve.getPoint(u).addScaledVector(right, Math.cos(a * TAU) * rx).addScaledVector(outward, Math.sin(a * TAU) * rz).addScaledVector(normal, offset + wrinkle), normal };
  };
  const neckWeights = u => {
    const f = u * (p.neck.length - 1), k = Math.min(p.neck.length - 2, Math.floor(f));
    return blend(`Neck${k + 1}`, `Neck${k + 2}`, f - k);
  };
  g.grid(44, 24, (u, a) => neckSurface(u, a).point, (u, a) => {
    const c = color(C.neck);
    if (p.kind === 'bustard') c.lerp(color(C.featherDark), Math.pow(Math.max(0, Math.sin(a * TAU * 11 + u * 15)), 12) * .24);
    if (p.kind === 'bustard') c.lerp(color(C.head), smooth((u-.79)/.21)*.72);
    if (isHeron) c.lerp(color(C.belly), clamp(Math.sin(a * TAU)) * .9);
    if (isTurkey) c.lerp(color(C.head), smooth((u - .48) * 1.7) * .53).multiplyScalar(.82 + .16 * Math.sin(u * 81 + a * 19) * Math.sin(a * 57 - u * 9));
    return c;
  }, neckWeights, false);
  g.oval(p.head.center, p.head.radii, (u,a)=> {
    const tint = color(C.head);
    if(isTurkey) tint.lerp(color(0xa66760),clamp((u-.45)*1.1)).multiplyScalar(.90+.07*Math.sin(a*33+u*70)*Math.sin(u*39-a*17));
    else if(!isHeron) tint.lerp(color(C.neck),smooth((u-.5)*2)*.73);
    return tint;
  }, single('Head'), 20, 28, (pt,u,a) => {
    const front=Math.max(0,pt.z);
    pt.x *= 1 - (isHeron?.20:.32) * front;
    pt.y -= (isHeron?.15:.25) * front;
    pt.y *= .91+.09*Math.max(0,-pt.z);
    if(isTurkey){const wrinkle=.012*Math.sin(u*53+a*61)*Math.sin(a*29-u*32);pt.multiplyScalar(1+wrinkle);pt.x*=.94+.06*Math.max(0,pt.z);}
  });
  const hc = p.head.center, hr = p.head.radii;
  // Two sculpted bill lobes preserve a visible mouth seam.
  const beakStart = [0, hc[1] - hr[1] * .16, hc[2] + hr[2] * .68];
  const billWidth = hr[0] * (isHeron ? .68 : .56), billHeight = hr[1] * (isHeron ? .29 : .31);
  for (let lower = 0; lower < 2; lower++) {
    g.grid(12, 12, (u, a) => {
      const th = a * TAU, taper = Math.pow(1 - u, .92);
      const y = beakStart[1] + (lower ? -.0018 : .0018) + Math.sin(th) * billHeight * taper * (lower ? .35 : .78) - (lower ? billHeight * .15 : 0);
      return new THREE.Vector3(Math.cos(th) * billWidth * taper, y - (isHeron ? 0 : .009*u*u), beakStart[2] + p.beakLength * u);
    }, (u, a) => color(C.beak).multiplyScalar(lower ? .69 : (.88 + .12 * Math.sin(a * TAU))), () => single(lower ? 'Jaw' : 'Head'));
  }
  if(!isHeron){
    // The facial sheath emerges within the forehead and narrows into the dorsal bill.
    // Its upper contour removes the abrupt sphere-to-cone step at the beak root.
    g.grid(16,14,(u,a)=>{
      const th=a*TAU,rx=hr[0]*mix(.74,.22,u),rz=mix(hc[2]+hr[2]*.22,beakStart[2]+p.beakLength*.38,u);
      const y=hc[1]+hr[1]*mix(.025,-.12,u),ry=hr[1]*mix(.58,.15,u);
      return new THREE.Vector3(Math.cos(th)*rx,y+Math.sin(th)*ry,rz);
    },u=>color(C.head).lerp(color(C.beak),smooth((u-.37)/.63)),()=>single('Head'));
  }
  for (const side of [-1, 1]) {
    const eye = [side * hr[0] * .826, hc[1] + hr[1] * .14, hc[2] + hr[2] * .36];
    g.oval(eye, [hr[0] * .045, hr[1] * .135, hr[1] * .125], color(C.head).multiplyScalar(.56), single('Head'), 8, 14);
    g.oval([eye[0] + side * hr[0] * .017, eye[1], eye[2]], [hr[0] * .035, hr[1] * .097, hr[1] * .092], isHeron?C.iris:0x40352a, single('Head'), 8, 14);
    g.oval([eye[0] + side * hr[0] * .037, eye[1], eye[2] + hr[1] * .012], [hr[0] * .018, hr[1] * .070, hr[1] * .065], C.eye, single('Head'), 8, 12);
    g.oval([eye[0] + side * hr[0] * .049, eye[1] + hr[1] * .025, eye[2] + hr[1] * .025], [hr[0] * .009, hr[1] * .016, hr[1] * .014], 0xd6d9c7, single('Head'), 6, 8);
    // A skin-colored upper eyelid follows the eyeball instead of drawing a separate eyebrow.
    const lid=[];for(let j=0;j<=7;j++){const a=mix(.08,Math.PI-.08,j/7);lid.push([eye[0]+side*hr[0]*.018,eye[1]+Math.sin(a)*hr[1]*.135,eye[2]+Math.cos(a)*hr[1]*.13]);}
    g.tube(lid,[hr[1]*.026,hr[1]*.027,hr[1]*.019],color(C.head).multiplyScalar(.79),()=>single('Head'),6,8);
    // Nostrils are set into the bill.
    g.oval([side * billWidth * .83, beakStart[1] + billHeight * .16, beakStart[2] + p.beakLength * .19], [billWidth * .10, billHeight * .14, p.beakLength * .036], 0x222622, single('Head'), 6, 10);
  }
  // Small coverts wrap the actual wing surface, including the shoulder and leading edge.
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const wc = [side * rad[0] * .78, center[1] + .021, center[2] - rad[2] * .10], wr = [rad[0] * .29, rad[1] * .68, rad[2] * .88];
    const wingSculpt = pt => { pt.y += .10 * pt.z; pt.x *= .87 + .13 * pt.z; };
    g.oval(wc, wr, color(C.wing).multiplyScalar(.86), single(`Wing${s}`), 12, 18, wingSculpt);
    const wingSurface = (phi, theta, offset) => {
      const n = new THREE.Vector3(side * Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
      const point = n.clone(); wingSculpt(point); point.multiply(v(wr)).add(v(wc));
      const normal = new THREE.Vector3(n.x / wr[0], n.y / wr[1], n.z / wr[2]).normalize();
      return { point: point.addScaledVector(normal, offset), normal };
    };
    for (let row = 0; row < 6; row++) {
      const count = 11;
      for (let j = 0; j < count; j++) {
        const t = j / (count - 1), theta = mix(-1.03, 1.25, row / 5), phi = .24 + t * 2.25 + (row % 2) * .085;
        const start = wingSurface(phi, theta, .0025), end = wingSurface(Math.min(3.12, phi + .43), theta - .035, .006);
        const tint = color(C.wing).lerp(color(C.featherLight), isHeron ? .10 + (j % 3) * .045 : .22 + (j % 4) * .045);
        g.feather(start.point.toArray(), end.point.toArray(), rad[1] * .32, tint, blend(`Wing${s}`, `WingTip${s}`, clamp((t - .45) * 1.35)), { normal: start.normal.toArray(), bars: isHeron ? 0 : 2, barPhase: row * .28 + j * .15, dark: C.featherDark, tip: color(C.featherLight).lerp(color(C.wing), .35), arch: .035, steps: 7 });
      }
    }
    // Long separate primaries make the folded wing edge serrated.
    for (let j = 0; j < 7; j++) {
      const t = j / 6;
      g.feather([side * rad[0] * (1 + .10 * t), center[1] - rad[1] * (.22 + .15 * t), center[2] - rad[2] * (.04 + .18 * t)],
        [side * rad[0] * (.69 + .18 * t), center[1] - rad[1] * (.24 + .23 * t), center[2] - rad[2] * (1.03 + .18 * t)],
        rad[1] * .23, j % 2 ? C.wing : C.featherDark, single(`WingTip${s}`), { normal: [side, .15, 0], bars: isTurkey ? 4 : 0, dark: C.featherDark, tip: C.featherLight });
    }
  }
  // Contour plumage follows the same shaped torso as the skin, so its roots never disappear
  // inside a nominal sphere. The staggered vanes flow from breast and shoulders to the rump.
  if(!isTurkey){
    const pointFromDirection=(direction,offset)=>{
      const pt=bodySculpt(direction.clone()).multiply(v(rad)).add(v(center));
      const normal=new THREE.Vector3(direction.x/rad[0],direction.y/rad[1],direction.z/rad[2]).normalize();
      return {point:pt.addScaledVector(normal,offset),normal};
    };
    for(let row=0;row<16;row++){
      const lat=.13+row*.187,upper=clamp((1.45-lat)/1.18),count=Math.max(6,Math.round((32+upper*8)*Math.sin(lat)));
      for(let j=0;j<count;j++){
        const az=(j+(row%2)*.5)/count*TAU;
        const n=new THREE.Vector3(Math.sin(lat)*Math.sin(az),Math.cos(lat),Math.sin(lat)*Math.cos(az));
        const start=pointFromDirection(n,.0025),desired=new THREE.Vector3(0,-1,-(.35+upper*.62));
        const tangent=desired.addScaledVector(start.normal,-desired.dot(start.normal)).normalize();
        const length=isHeron?mix(.076,.056,upper):mix(.091,.070,upper);
        const endDirection=n.clone().add(new THREE.Vector3(tangent.x/rad[0],tangent.y/rad[1],tangent.z/rad[2]).multiplyScalar(length)).normalize();
        const end=pointFromDirection(endDirection,.0048);
        const breast=clamp(n.z)* (isHeron?.67:.50),belly=clamp(-n.y)*.28;
        const tint=color(C.body).lerp(color(C.belly),clamp(breast+belly)).lerp(color(C.featherLight),isHeron?.04:.10).multiplyScalar(.985+.025*Math.sin(j*2.1+row*.63));
        const width=(isHeron?mix(.075,.062,upper):mix(.094,.075,upper))*(.78+.22*Math.sin(lat));
        g.feather(start.point.toArray(),end.point.toArray(),width,tint,single('Body'),{normal:start.normal.toArray(),bars:isHeron?0:1,barStrength:.25,barPhase:j*.23+row*.4,dark:C.featherDark,tip:tint.clone().multiplyScalar(1.07),arch:.022,steps:5});
      }
    }
  }
  if(isTurkey){
    const pointFromDirection=(direction,offset)=>{
      const pt=bodySculpt(direction.clone()).multiply(v(rad)).add(v(center));
      const normal=new THREE.Vector3(direction.x/rad[0],direction.y/rad[1],direction.z/rad[2]).normalize();
      return {point:pt.addScaledVector(normal,offset),normal};
    };
    // Latitude rows put their convergence beneath the neck and belly. On the visible chest,
    // the feather field travels down from the throat, then sweeps toward the rear along the flanks.
    const latitudes=[.13,.28,.43,.58,.73,.88,1.03,1.18,1.33,1.51,1.69,1.87,2.05,2.23,2.41,2.59,2.77,2.95];
    for(let row=0;row<latitudes.length;row++){
      const lat=latitudes[row],upper=clamp((1.48-lat)/1.2),count=Math.max(6,Math.round((32+upper*20)*Math.sin(lat)));
      for(let j=0;j<count;j++){
        const az=(j+(row%2)*.5)/count*TAU;
        const n=new THREE.Vector3(Math.sin(lat)*Math.sin(az),Math.cos(lat),Math.sin(lat)*Math.cos(az));
        const start=pointFromDirection(n,.0025);
        const desired=new THREE.Vector3(0,-1,-(.37+upper*.65));
        const tangent=desired.addScaledVector(start.normal,-desired.dot(start.normal)).normalize();
        const length=mix(.096,.066,upper);
        const endDirection=n.clone().add(new THREE.Vector3(tangent.x/rad[0],tangent.y/rad[1],tangent.z/rad[2]).multiplyScalar(length)).normalize();
        const end=pointFromDirection(endDirection,.0045);
        const front=clamp(n.z),belly=clamp(-n.y),bronze=color(0x69543a),breast=color(0x554631);
        const tint=bronze.lerp(breast,front*.65).lerp(color(C.belly),belly*.36).multiplyScalar(.98+.035*Math.sin(j*2.13+row*.61));
        const width=mix(.094,.074,upper)*(.78+.22*Math.sin(lat));
        const material=front>.12||n.y<.1?1:0;
        g.feather(start.point.toArray(),end.point.toArray(),width,tint,single('Body'),{normal:start.normal.toArray(),bars:lat>1.43?1:0,barStrength:.16,barPhase:j*.19+row*.3,dark:0x332f27,tip:tint.clone().multiplyScalar(1.045),arch:.018,steps:5,material});
      }
    }
  }
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R', hip = r.rest[`Thigh${s}`].world.toArray(), knee = r.rest[`Shin${s}`].world.toArray(), ankle = r.rest[`Foot${s}`].world.toArray();
    const legR = isHeron ? .017 : isTurkey ? .027 : .028;
    g.tube([hip, [mix(hip[0], knee[0], .5), mix(hip[1], knee[1], .5), mix(hip[2], knee[2], .5)], knee], [legR * (isHeron ? 1.9 : 2.7), legR * 1.2, legR * 1.09], C.legs, u => blend(`Thigh${s}`, `Shin${s}`, smooth((u - .78) / .22)), 12, 12);
    g.tube([knee, [knee[0], mix(knee[1], ankle[1], .45), mix(knee[2], ankle[2], .45)], ankle], [legR * 1.2, legR * .72, legR * .91], (u) => color(C.legs).multiplyScalar(.82 + .16 * Math.sin(u * TAU * 15)), u => blend(`Shin${s}`, `Foot${s}`, smooth((u - .88) / .12)), 12, 18);
    g.oval(knee, [legR * 1.30, legR * 1.48, legR * 1.22], C.legs, blend(`Thigh${s}`, `Shin${s}`, .50), 8, 12);
    // Layered shin scutes are modeled relief, visible in grazing light.
    for (let k = 1; k <= 11; k++) {
      const u = k / 13, yy = mix(knee[1], ankle[1], u), zz = mix(knee[2], ankle[2], u);
      g.oval([hip[0], yy, zz + legR * .68], [legR * .67, legR * .25, legR * .30], k % 2 ? C.legs : color(C.legs).multiplyScalar(1.12), single(`Shin${s}`), 4, 8);
    }
    g.oval([hip[0], .037, ankle[2] + .012], [legR * 1.35, .030, legR * 1.7], C.legs, single(`Foot${s}`), 8, 12);
    const toes = [ [-.55, .76], [0, 1], [.55, .82], [-.17, -.49] ];
    for (let t = 0; t < toes.length; t++) {
      const [spread, reach] = toes[t];
      const tip = [hip[0] + spread * p.footLength, .019, ankle[2] + reach * p.footLength];
      const mid = [mix(hip[0], tip[0], .55), .026, mix(ankle[2], tip[2], .55)];
      g.tube([[hip[0], .040, ankle[2]], mid, tip], [legR * .65, legR * .45, legR * .23], C.legs, () => single(t === 1 ? `Toe${s}` : `Foot${s}`), 8, 8);
      const sign = Math.sign(reach), clawEnd = [tip[0] + spread * .015, .003, tip[2] + sign * legR * 1.55];
      g.tube([tip, [tip[0], .025, mix(tip[2], clawEnd[2], .6)], clawEnd], [legR * .30, legR * .22, .0007], C.featherDark, () => single(t === 1 ? `Toe${s}` : `Foot${s}`), 7, 6);
      for (let k = 1; k <= 4; k++) {
        const u = k / 5;
        g.oval([mix(hip[0], tip[0], u), .032, mix(ankle[2], tip[2], u)], [legR * .47, legR * .16, legR * .20], color(C.legs).multiplyScalar(1.15), single(t === 1 ? `Toe${s}` : `Foot${s}`), 4, 6);
      }
    }
  }
  if (isTurkey) {
    // Broad fan: separate cupped rectrices, brown bars and pale terminal bands.
    for (let j = 0; j < 19; j++) {
      const angle = mix(-1.19, 1.19, j / 18), tc = p.tail.center;
      const len = p.tail.height * (1 - .065 * Math.abs(angle) + .009 * Math.sin(j * 4.13));
      g.feather([Math.sin(angle) * .025, tc[1], tc[2]], [Math.sin(angle) * p.tail.width * .53, tc[1] + Math.cos(angle) * len, tc[2] - p.tail.length * (.74 + .17 * Math.cos(angle))], p.tail.width * .103, C.wing, blend('Tail', 'TailTip', .52), { normal: [0, 0, 1], bars: 5, barPhase: Math.sin(j * 1.3) * .15, dark: C.featherDark, tip: C.featherLight, arch: .016, steps: 28, roundTip: true });
    }
    for (let j = 0; j < 13; j++) {
      const a = mix(-1.25, 1.25, j / 12), tc = p.tail.center;
      g.feather([Math.sin(a) * .018, tc[1] - .055, tc[2] + .048], [Math.sin(a) * p.tail.width * .24, tc[1] + Math.cos(a) * p.tail.height * .39, tc[2] - .055], p.tail.width * .10, j % 2 ? C.body : C.wing, single('Tail'), { normal: [0, 0, 1], bars: 2, dark: C.featherDark, tip: C.featherLight, steps: 16, roundTip:true });
    }
    // Bare red wattle with separate lobes and the drooping snood above the bill.
    const throat = p.neck.at(-2).center;
    g.tube([[0, hc[1] - hr[1] * .42, hc[2] + hr[2] * .40], [0, mix(hc[1], throat[1], .65), throat[2] + .040], [0, throat[1] - .073, throat[2] + .030]], [.014, .022, .004], u=>color(0x9f3331).multiplyScalar(.85 + .11*Math.sin(u*100)), u => blend('Head', `Neck${p.neck.length - 1}`, u * .6), 14, 18);
    for (let j = 0; j < 11; j++) {
      const u=j/11,s=.65+.30*Math.sin(j*4.3);
      g.oval([Math.sin(j*2.4)*.015,mix(hc[1]-.037,throat[1]-.015,u),mix(hc[2],throat[2],u)+.034],[.004*s,.0065*s,.004*s],j%2?0xa95b52:0x99443c,blend('Head',`Neck${p.neck.length-1}`,j/16),5,8);
    }
    const snoodPath=[],snoodRadii=[];
    for(let j=0;j<12;j++){
      const u=j/11;
      snoodPath.push([.012*u+.0014*Math.sin(u*45),hc[1]+hr[1]*(.55-.80*u)+.012*Math.sin(Math.PI*u),hc[2]+hr[2]*(.30+.72*u)+p.beakLength*.29*u]);
      snoodRadii.push((.0105-.007*u)*(1+.09*Math.sin(u*60)));
    }
    g.tube(snoodPath,snoodRadii,u=>color(0xa34e44).multiplyScalar(.85+.08*Math.sin(u*90)),()=>single('Head'),10,28);
    // Small caruncles follow the cheek and occiput. They break the bare skin's smooth outline.
    for(const side of[-1,1])for(let j=0;j<20;j++){
      const ph=.8+(j%5)*.30+.11*Math.sin(j*7.31),a=(side<0?Math.PI:0)+.12*(Math.floor(j/5)-1.5)+.073*Math.sin(j*2.13);
      const raw=new THREE.Vector3(Math.sin(ph)*Math.cos(a),Math.cos(ph),Math.sin(ph)*Math.sin(a));
      const point=raw.clone();point.x*=1-.32*Math.max(0,point.z);point.y-=.25*Math.max(0,point.z);point.y*=.91+.09*Math.max(0,-point.z);point.multiply(v(hr)).add(v(hc));
      const scale=.8+.3*Math.sin(j*4.17);
      g.oval(point.toArray(),[.0018*scale,.0023*scale,.0017*scale],color(C.head).lerp(color(0xb36c62),.28+(j%3)*.07),single('Head'),4,6);
    }
  } else {
    for (let j = 0; j < 11; j++) {
      const t = j / 10, tc = p.tail.center;
      g.feather([mix(-.045, .045, t), tc[1], tc[2]], [mix(-p.tail.width * .5, p.tail.width * .5, t), tc[1] + p.tail.height * (.5 - Math.abs(t - .5)), tc[2] - p.tail.length * (.75 + .25 * Math.sin(t * Math.PI))], p.tail.width * .21, j % 3 ? C.wing : C.featherLight, blend('Tail', 'TailTip', .65), { normal: [0, 1, 0], bars: isHeron ? 0 : 3, dark: C.featherDark, tip: C.featherLight });
    }
  }
  if (isHeron) {
    for (let j = 0; j < 5; j++) g.feather([mix(-.028, .028, j / 4), hc[1] + hr[1] * .75, hc[2] - hr[2] * .25], [mix(-.035, .035, j / 4), hc[1] + .023, hc[2] - hr[2] - .19 + Math.abs(j - 2) * .017], .024, C.featherDark, single('Head'), { normal: [0, 1, 0], arch: .07, steps: 9 });
    for (let j = 0; j < 13; j++) {
      const a = mix(-1.0, 1.0, j / 12), root = p.neck[0].center;
      g.feather([Math.sin(a) * .075, root[1] + .04, root[2] + Math.cos(a) * .08], [Math.sin(a) * .10, root[1] - .24 - .025 * Math.cos(j * 2), root[2] + .13], .035, j % 3 ? C.belly : C.featherDark, single('Neck1'), { normal: [Math.sin(a), 0, Math.cos(a)], steps: 9 });
    }
  }
  if (p.kind === 'bustard') {
    for (let row = 0; row < 9; row++) for (let j = 0; j < 15; j++) {
      const u = .18 + row * .10, a = (j + (row % 2) * .5) / 15;
      const start = neckSurface(u, a, .0025), end = neckSurface(Math.max(0, u - .17), a + .012 * Math.sin(j), .005);
      const tint = color(C.neck).lerp(color(C.featherLight), .15 + (j % 3) * .035).lerp(color(C.head),smooth((u-.62)/.38)*.86);
      const width=(.038+(1-u)*.014)*(1-.44*smooth((u-.65)/.35));
      g.feather(start.point.toArray(), end.point.toArray(), width, tint, neckWeights(Math.max(0,u-.06)), { normal: start.normal.toArray(), bars: 0, dark: C.featherDark, tip: C.featherLight, steps: 6 });
    }
    for (const side of [-1, 1]) for (let j = 0; j < 5; j++) g.feather([side * hr[0] * .71, hc[1] - hr[1] * .20, hc[2] - hr[2] * .14], [side * hr[0] * (1.2 + j * .06), hc[1] - hr[1] * (.70 + j * .05), hc[2] - hr[2] * (.65 + j * .08)], .019, C.featherLight, single('Head'), { normal: [side, 0, 0], steps: 6 });
  }
  return g.geometry();
}

function animation(p, r) {
  const clips = [];
  const reset = () => { for (const b of r.bones) { b.position.copy(r.rest[b.name].position); b.quaternion.identity(); } };
  const rotate = (name, x = 0, y = 0, z = 0) => r.named[name].quaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  const footY = p.ankle[0];
  function ik(side, target, toePitch = 0) {
    const s = side < 0 ? 'L' : 'R', up = r.named[`Thigh${s}`], shin = r.named[`Shin${s}`], foot = r.named[`Foot${s}`];
    r.object.updateMatrixWorld(true);
    const hip = up.getWorldPosition(new THREE.Vector3()), goal = v(target);
    const upperRest = r.rest[`Shin${s}`].position, lowerRest = r.rest[`Foot${s}`].position;
    const l1 = upperRest.length(), l2 = lowerRest.length();
    const delta = goal.clone().sub(hip), dist = clamp(delta.length(), Math.abs(l1 - l2) + .002, (l1 + l2) * .997), dir = delta.normalize();
    const pole = new THREE.Vector3(0, 0, -1).addScaledVector(dir, dir.z).normalize();
    const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const knee = hip.clone().addScaledVector(dir, along).addScaledVector(pole, height);
    const parentQ = up.parent.getWorldQuaternion(new THREE.Quaternion());
    const qUp = new THREE.Quaternion().setFromUnitVectors(upperRest.clone().normalize(), knee.clone().sub(hip).normalize());
    up.quaternion.copy(parentQ.clone().invert().multiply(qUp));
    const qLow = new THREE.Quaternion().setFromUnitVectors(lowerRest.clone().normalize(), goal.clone().sub(knee).normalize());
    shin.quaternion.copy(qUp.clone().invert().multiply(qLow));
    const qFoot = new THREE.Quaternion().setFromEuler(new THREE.Euler(toePitch, 0, 0));
    foot.quaternion.copy(qLow.clone().invert().multiply(qFoot));
    rotate(`Toe${s}`, toePitch > 0 ? -toePitch * .3 : 0);
  }
  const durations = { Idle: 3.2, Walk: p.walkSeconds, Run: p.runSeconds, Attack: p.attackSeconds, Hit: .76, HitLeft: .78, HitRight: .78, Death: 1.65 };
  for (const [name, duration] of Object.entries(durations)) {
    const n = name === 'Idle' ? 64 : name === 'Death' ? 66 : 60, times = [], rotations = new Map(r.bones.map(b => [b.name, []])), positions = [];
    for (let frame = 0; frame <= n; frame++) {
      const u = frame / n, phase = u * TAU;
      reset();
      let bob = 0, pitch = 0, roll = 0, headPitch = 0, neckBend = 0, wing = 0, tail = 0;
      if (name === 'Idle') {
        bob = Math.sin(phase) * .004; neckBend = Math.sin(phase) * .008;
        rotate('Head', .009 * Math.sin(phase), .055 * Math.sin(phase), 0);
        tail = Math.sin(phase) * .013;
      } else if (name === 'Walk' || name === 'Run') {
        const run = name === 'Run'; bob = (1 - Math.cos(phase * 2)) * (run ? .013 : .006) - (run ? .030 : .018);
        pitch = (run ? -.075 : -.012) + Math.sin(phase * 2) * .025;
        roll = Math.sin(phase) * (run ? .035 : .017); neckBend = -pitch / Math.max(2, p.neck.length);
        headPitch = -.045 * Math.sin(phase * 2); wing = run ? .09 + .025 * Math.sin(phase * 2) : .012;
        tail = Math.sin(phase) * (run ? .08 : .028);
      } else if (name === 'Attack') {
        const anticipation = Math.sin(Math.PI * clamp(u / .32)) * (u < .32 ? 1 : 0);
        const strike = Math.sin(Math.PI * clamp((u - .26) / .39)) * (u > .26 && u < .65 ? 1 : 0);
        const recover = Math.sin(Math.PI * clamp((u - .58) / .42)) * (u > .58 ? 1 : 0);
        bob = -.022 * anticipation - .034 * strike; pitch = -.14 * anticipation + .24 * strike;
        neckBend = -.13 * anticipation + (p.kind === 'heron' ? .18 : .27) * strike;
        headPitch = -.12 * anticipation + .29 * strike; wing = .17 * anticipation + .34 * strike + .055 * recover;
        tail = -.17 * anticipation + .13 * strike;
        rotate('Jaw', .15 * strike, 0, 0);
      } else if (name.startsWith('Hit')) {
        const envelope = Math.sin(Math.PI * Math.pow(u, .58)) * (1 - u), side = name === 'HitLeft' ? 1 : name === 'HitRight' ? -1 : .25;
        bob = -.034 * envelope; pitch = -.26 * envelope; roll = side * .23 * envelope;
        neckBend = -.15 * envelope; headPitch = -.26 * envelope; wing = .45 * envelope; tail = -.14 * envelope;
      } else if (name === 'Death') {
        const fold = smooth((u - .10) / .55), fall = smooth((u - .25) / .65);
        bob = -p.hipY * .68 * fall; pitch = .31 * fall; roll = -1.30 * fall;
        neckBend = .19 * fold; headPitch = .38 * fold; wing = .58 * Math.sin(Math.PI * fold) + .10 * fall; tail = -.19 * fall;
      }
      r.named.Body.position.y += bob;
      rotate('Body', pitch, 0, roll);
      for (let j = 0; j < p.neck.length; j++) rotate(`Neck${j + 1}`, neckBend * (j % 2 ? .78 : 1), name === 'Idle' ? .008 * Math.sin(phase + j * .3) : 0, name.startsWith('Hit') ? -roll * .28 : 0);
      if (name !== 'Idle') rotate('Head', headPitch, 0, -roll * .22);
      rotate('Tail', tail, name === 'Idle' ? Math.sin(phase) * .008 : roll * .16, -roll * .10);
      rotate('TailTip', tail * .36, 0, 0);
      for (const side of [-1, 1]) {
        const s = side < 0 ? 'L' : 'R';
        rotate(`Wing${s}`, wing * .10, side * wing * .48, -side * wing);
        rotate(`WingTip${s}`, -wing * .20, side * wing * .42, -side * wing * .28);
        if (name === 'Death') {
          const f = smooth((u - .16) / .65);
          rotate(`Thigh${s}`, -.68 * f, side * .09 * f, side * .12 * f);
          rotate(`Shin${s}`, 1.06 * f, 0, 0);
          r.object.updateMatrixWorld(true);
          // Splayed toes settle flat beside the folded legs rather than propping up the corpse.
          const parentRotation = r.named[`Shin${s}`].getWorldQuaternion(new THREE.Quaternion());
          const restingFoot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * .35 * f, 0));
          r.named[`Foot${s}`].quaternion.copy(parentRotation.invert().multiply(restingFoot));
          rotate(`Toe${s}`, 0);
        } else {
          let z = p.ankle[1], y = footY, toe = 0;
          if (name === 'Walk' || name === 'Run') {
            const run = name === 'Run', cycle = (u + (side > 0 ? .5 : 0)) % 1, stance = run ? .51 : .64;
            const speed = run ? p.runMps : p.walkMps, stride = speed * duration * stance;
            if (cycle < stance) z += stride * (.5 - cycle / stance);
            else {
              const swing = (cycle - stance) / (1 - stance), t = smooth(swing);
              z += stride * (-.5 + t); y += (run ? .13 : .075) * Math.sin(Math.PI * swing);
              toe = Math.sin(Math.PI * swing) * .20;
            }
          }
          ik(side, [side * p.legX, y, z], toe);
        }
      }
      r.object.updateMatrixWorld(true);
      if (name === 'Death') {
        const mesh = r.object.children.find(o => o.isSkinnedMesh), point = new THREE.Vector3();
        mesh.skeleton.update();
        let lowest = Infinity;
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          point.fromBufferAttribute(mesh.geometry.attributes.position, i); mesh.applyBoneTransform(i, point);
          lowest = Math.min(lowest, point.y);
        }
        // Bake the collapse against the actual drawn sculpture, including fan and beak.
        // The vertical body correction is part of the clip and leaves horizontal root travel zero.
        r.named.Body.position.y += Math.max(0, .003 - lowest);
        r.object.updateMatrixWorld(true);
      }
      times.push(u * duration); positions.push(...r.named.Body.position.toArray());
      for (const b of r.bones) rotations.get(b.name).push(...b.quaternion.toArray());
    }
    // Seal cycles exactly. Terminal reactions return to the authored bind pose.
    if (name !== 'Death') {
      for (const values of rotations.values()) for (let k = 0; k < 4; k++) values[values.length - 4 + k] = values[k];
      for (let k = 0; k < 3; k++) positions[positions.length - 3 + k] = positions[k];
    }
    const tracks = [new THREE.VectorKeyframeTrack('Body.position', times, positions)];
    for (const b of r.bones) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rotations.get(b.name)));
    const clip = new THREE.AnimationClip(name, duration, tracks);
    clip.userData = { inPlace: true, gait: name === 'Walk' ? { stance: .64, speed: p.walkMps } : name === 'Run' ? { stance: .51, speed: p.runMps } : undefined };
    clips.push(clip);
  }
  reset(); r.object.updateMatrixWorld(true); return clips;
}

function plumageNormalMap() {
  // One original atlas: directional feather barbs and a separate fine bare-skin grain strip.
  // UVs stay local to the modeled surfaces and export with the GLB.
  const size=512, bytes=new Uint8Array(size*size*4);
  const height=(x,y)=>{
    if(x>=.035&&x<=.745&&y>=.035&&y<=.945){
      const u=(x-.04)/.70,t=(y-.04)/.90;
      const d=Math.min(Math.abs(u-.25),Math.abs(u-.75));
      return .0028*Math.exp(-d*d*11000)+.00038*Math.sin(t*TAU*78+Math.abs(Math.cos(u*TAU))*38);
    }
    if(x>.80){const u=(x-.81)/.18,t=(y-.02)/.96;return .00008*Math.sin(u*37+t*99)*Math.sin(t*137-u*51);}
    return 0;
  };
  const eps=1/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,t=y/size;
    const dx=(height(u+eps,t)-height(u-eps,t))/(2*eps),dy=(height(u,t+eps)-height(u,t-eps))/(2*eps);
    const n=new THREE.Vector3(-dx,-dy,1).normalize(),i=(y*size+x)*4;
    bytes[i]=Math.round((n.x*.5+.5)*255);bytes[i+1]=Math.round((n.y*.5+.5)*255);bytes[i+2]=Math.round((n.z*.5+.5)*255);bytes[i+3]=255;
  }
  const texture=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat);texture.name='Original_feather_barbs_and_skin_grain';texture.needsUpdate=true;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;
  return texture;
}

export async function buildSpecies(id) {
  const p = birdProfiles[id];
  if (!p) throw new Error(`Unknown original ground bird: ${id}`);
  const rig = makeRig(p), geometry = anatomy(p, rig);
  const normalMap=plumageNormalMap();
  const material = new THREE.MeshStandardMaterial({ name: `${id}_sculpted_plumage`, vertexColors: true, roughness: .86, metalness: .035, normalMap, normalScale:new THREE.Vector2(.45,.45) });
  const breastMaterial = new THREE.MeshStandardMaterial({name:`${id}_soft_breast_contour_plumage`,vertexColors:true,roughness:.96,metalness:.018,normalMap,normalScale:new THREE.Vector2(.20,.20)});
  const mesh = new THREE.SkinnedMesh(geometry, p.kind==='turkey'?[material,breastMaterial]:material); mesh.name = `${id}_Sculpture`; mesh.castShadow = true; mesh.receiveShadow = true;
  rig.object.add(mesh); rig.object.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(rig.bones)); mesh.normalizeSkinWeights(); mesh.frustumCulled = false;
  const clips = animation(p, rig);
  rig.object.userData = { species: id, originalGeometry: true, forward: '+Z', ground: 'toes y=0', rig: 'articulated_ground_bird', triangles: geometry.index.count / 3 };
  return { object: rig.object, clips, meta: {
    is: p.name, tags: ['creature', 'animal', 'bird', 'ground', p.kind, 'original', 'skinned', 'articulated', 'modeled-feathers'],
    provenance: { author: 'Corealm', source: 'Original procedural sculpture authored for Corealm', license: 'Project-owned original geometry and animation' },
    attackSeconds: p.attackSeconds, contactNormalized: p.contact,
    impliedWalkMps: p.walkMps, impliedRunMps: p.runMps, walkClipSeconds: p.walkSeconds, runClipSeconds: p.runSeconds,
    notes: `Original ${p.kind} anatomy with volumetric overlapping feathers, sculpted bill, eyes, scale relief and four clawed toes per foot. Continuous weighted neck; independently skinned wings, tips, tail, thighs, shins, feet and toes. Two-bone IK gives linear backward stance travel at metadata speed, 64% walk and 51% run stance; foot rotation counteracts the limb chain. Eight original skeletal clips; cycles sealed and reactions recover. Ground bird only.`,
  } };
}
