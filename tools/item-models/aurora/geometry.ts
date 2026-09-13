import * as THREE from 'three';
import type { ArmorMaterials } from '../tier50-70/contracts.js';
import { buildHood } from '../tier50-70/hood.js';
import { buildRobe } from '../tier50-70/robe.js';
import { buildLeggings } from '../tier50-70/leggings.js';
import { buildBoots } from '../tier50-70/boots.js';
import { buildWraps } from '../tier50-70/wraps.js';
import { ornament } from '../tier50-70/hood-geometry.js';
import { normalAt } from '../tier50-70/robe-geometry.js';
import { addScaleField } from '../tier50-70/scale-field.js';

export type AuroraPiece = 'hood' | 'robe' | 'leggings' | 'boots' | 'wraps';
type UV = readonly [number, number];
type Sample = { point: THREE.Vector3; normal: THREE.Vector3 };
type Carrier = (u: number, v: number) => Sample;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const builders = { hood: buildHood, robe: buildRobe, leggings: buildLeggings, boots: buildBoots, wraps: buildWraps };

/** Sample the accepted, already width-corrected outer shell in root space. */
function carrier(mesh: THREE.Mesh, columns: number, rows: number, lift: number): Carrier {
  const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal');
  const count = (columns + 1) * (rows + 1);
  if (p.count !== count && p.count !== count * 2 && p.count !== count * 2 + 8 * (columns + rows)) throw new Error(`Aurora carrier grid changed: ${mesh.name}`);
  mesh.updateWorldMatrix(true, false);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return (u, v) => {
    const x = THREE.MathUtils.clamp(u, 0, 1) * columns, y = THREE.MathUtils.clamp(v, 0, 1) * rows;
    const i = Math.min(columns - 1, Math.floor(x)), j = Math.min(rows - 1, Math.floor(y));
    const fx = x - i, fy = y - j, stride = columns + 1;
    const point = V(0, 0, 0), normal = V(0, 0, 0);
    for (const [dx, dy, weight] of [[0, 0, (1-fx)*(1-fy)], [1, 0, fx*(1-fy)], [0, 1, (1-fx)*fy], [1, 1, fx*fy]]) {
      const k = (j + dy!) * stride + i + dx!;
      point.addScaledVector(V(p.getX(k), p.getY(k), p.getZ(k)), weight!);
      normal.addScaledVector(V(n.getX(k), n.getY(k), n.getZ(k)), weight!);
    }
    normal.applyMatrix3(normalMatrix).normalize();
    point.applyMatrix4(mesh.matrixWorld).addScaledVector(normal, lift);
    return { point, normal };
  };
}

function attach(g: THREE.Group, anchor: THREE.Object3D, mesh: THREE.Mesh, name: string): THREE.Mesh {
  mesh.name = `Aurora ${name}`;
  mesh.castShadow = mesh.receiveShadow = true;
  for (const key of ['itemModelBone', 'itemModelDeform', 'handSide']) {
    if (anchor.userData[key] !== undefined) mesh.userData[key] = anchor.userData[key];
  }
  mesh.userData.auroraOrnament = true;
  g.add(mesh);
  return mesh;
}

/** Closed four-sided wire, following the finished shell rather than a flat decal. */
function inlay(g: THREE.Group, anchor: THREE.Object3D, name: string, f: Carrier,
  path: readonly UV[], material: THREE.Material, width = .0018, steps = 28, relief = .0011, backDepth = .0005): void {
  const curve = new THREE.CatmullRomCurve3(path.map(([u, v]) => V(u, v, 0)), false, 'centripetal');
  const at = (t: number) => { const q = curve.getPoint(THREE.MathUtils.clamp(t, 0, 1)); return f(q.x, q.y); };
  const pos: number[] = [], uv: number[] = [], ix: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, { point, normal } = at(t);
    const tangent = at(t + .0001).point.sub(at(t - .0001).point).normalize();
    const across = tangent.cross(normal).normalize();
    const w = width * (.55 + .45 * Math.sin(Math.PI * t));
    for (const [cross, height] of [[-w / 2, 0], [0, relief], [w / 2, 0], [0, -backDepth]]) {
      const p = point.clone().addScaledVector(across, cross!).addScaledVector(normal, height!);
      pos.push(p.x, p.y, p.z); uv.push(t, cross! / width + .5);
    }
    if (k) for (let side = 0; side < 4; side++) {
      const a = (k - 1) * 4 + side, b = (k - 1) * 4 + (side + 1) % 4;
      ix.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  ix.push(0, 2, 1, 0, 3, 2);
  const end = steps * 4; ix.push(end, end + 1, end + 2, end, end + 2, end + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(ix); geometry.computeVertexNormals();
  attach(g, anchor, new THREE.Mesh(geometry, material), name);
}

function opal(g: THREE.Group, anchor: THREE.Object3D, name: string, f: Carrier,
  u: number, v: number, width: number, height: number, m: ArmorMaterials): void {
  const { point, normal } = f(u, v);
  const rotation = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal);
  const stone = new THREE.SphereGeometry(1, 10, 6);
  stone.scale(width * .77, height * .77, .0019);
  stone.applyQuaternion(rotation); stone.translate(point.x, point.y, point.z);
  attach(g, anchor, new THREE.Mesh(stone, m.gem), `${name} lenticular opal`);
  const rim = new THREE.TorusGeometry(1, .11, 4, 16);
  rim.scale(width, height, .010);
  rim.applyQuaternion(rotation); rim.translate(point.x, point.y, point.z);
  attach(g, anchor, new THREE.Mesh(rim, m.metal), `${name} fine gold bezel`);
}

/** A spaced aurora ribbon and north-star inlay with one small opal. */
function sigil(g: THREE.Group, anchor: THREE.Object3D, name: string, f: Carrier,
  u: number, v: number, du: number, dv: number, m: ArmorMaterials, jewelSize = .004): void {
  for (const side of [-1, 1]) {
    inlay(g, anchor, `${name} rising light arc ${side}`, f,
      [[u, v-dv], [u+side*du*.88, v-dv*.35], [u+side*du*.73, v+dv*.40], [u, v+dv]], m.metal, .0018, 24);
    inlay(g, anchor, `${name} split star ray ${side}`, f,
      [[u+side*du*.93, v], [u+side*du*.29, v+dv*.13], [u, v+dv*.66]], m.metal, .0015, 14);
  }
  opal(g, anchor, name, f, u, v, jewelSize, jewelSize * 1.65, m);
}

function find(g: THREE.Group, name: string): THREE.Mesh {
  const mesh = g.getObjectByName(name);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`Aurora missing fitted surface: ${name}`);
  return mesh;
}

function pearl(g: THREE.Group, anchor: THREE.Object3D, name: string, f: Carrier, u: number, v: number, m: ArmorMaterials): void {
  const { point, normal } = f(u, v);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal);
  for (const [part, material, radius, depth] of [['gold cup', m.metal, .0046, .0012], ['pearl', m.gem, .0034, .0031]] as const) {
    const geo = new THREE.SphereGeometry(1, 8, 5);
    geo.scale(radius, radius, depth); geo.applyQuaternion(q);
    const p = point.clone().addScaledVector(normal, part === 'pearl' ? .0019 : 0);
    geo.translate(p.x, p.y, p.z);
    attach(g, anchor, new THREE.Mesh(geo, material), `${name} ${part}`);
  }
}

/** Separate the two hip leaves above the unchanged long scale gores. */
function layerHipTassets(g: THREE.Group): void {
  const assemblies: Record<string, number> = {};
  for (const node of g.children) {
    if (!(node instanceof THREE.Mesh)) continue;
    const scaled = /^(Upper|Lower) curved overlapping scale tasset (-?1)\b/.exec(node.name);
    const edged = /^(?:Curved tasset|Tasset) (-?1) ([01])\b/.exec(node.name);
    if (!scaled && !edged) continue;
    const upper = scaled ? scaled[1] === 'Upper' : edged![2] === '1';
    const side = scaled ? scaled[2]! : edged![1]!;
    const top = upper ? 1.083 : .929, oldTip = upper ? .735 : .500;
    const newTip = upper ? .845 : .610, height = top-oldTip;
    const compression = (newTip-oldTip)/height, extraDepth = upper ? .012 : .008;
    const p = node.geometry.getAttribute('position'), n = node.geometry.getAttribute('normal');
    for (let i=0;i<p.count;i++) {
      const x=p.getX(i), y=p.getY(i), z=p.getZ(i), fall=Math.max(0,top-y), progress=fall/height;
      // Leave the sewn join in place and ease into the shorter hanging leaf.
      const a=THREE.MathUtils.clamp(progress/.25,0,1), ease=a*a*(3-2*a);
      const easeY=a>0&&a<1 ? -6*a*(1-a)/(height*.25) : 0;
      const newY=y+fall*compression*ease;
      const verticalScale=1-compression*ease+fall*compression*easeY;
      const t=THREE.MathUtils.clamp((progress-.08)/.60,0,1), depth=extraDepth*t*t*(3-2*t);
      const depthY=t>0&&t<1 ? -extraDepth*6*t*(1-t)/(height*.60) : 0;
      const radius=Math.hypot(x,z+.035), rx=x/radius, rz=(z+.035)/radius;
      const nx=n.getX(i), ny=n.getY(i), nz=n.getZ(i), radial=nx*rx+nz*rz, around=1+depth/radius;
      const normal=V(radial*rx+(nx-radial*rx)/around,(ny-depthY*radial)/verticalScale,radial*rz+(nz-radial*rz)/around).normalize();
      p.setXYZ(i,x+rx*depth,newY,z+rz*depth);
      n.setXYZ(i,normal.x,normal.y,normal.z);
    }
    node.geometry.computeBoundingBox();node.geometry.computeBoundingSphere();
    node.userData.auroraTassetLayering={layer:upper?'upper':'middle',oldTipY:oldTip,tipY:newTip,freeEndOffsetMeters:extraDepth,sewnRootPreserved:true};
    const key=`${side} ${upper?'upper':'middle'}`;assemblies[key]=(assemblies[key]??0)+1;
  }
  g.userData.auroraTassetLayers={assemblies,upperTipY:.845,middleTipY:.610,longGoresUnchanged:true,continuousUnderclothUnchanged:true};
}

/** A late accelerating bend makes free points finish outside each panel body. */
function sweepRobeTips(g: THREE.Group): void {
  const changed: Record<string,{meshes:number;maxDisplacement:number;maxProgress:number;minVerticalScale:number;minFinalY:number}> = {};
  const centers=[0,.89,1.68,2.49,Math.PI,Math.PI*2-2.49,Math.PI*2-1.68,Math.PI*2-.89];
  const hems=[.440,.285,.355,.339,.315,.339,.355,.285];
  for (const node of g.children) {
    if (!(node instanceof THREE.Mesh)) continue;
    let key='',tip=0,span=0,dx=0,dy=0,dz=0;
    const layer=node.userData.auroraTassetLayering;
    if (layer) {
      const side=/tasset (-?1)\b/i.exec(node.name)?.[1] ?? /Tasset (-?1)\b/.exec(node.name)?.[1];
      if (!side) throw new Error(`Aurora tasset sweep lacks side: ${node.name}`);
      const upper=layer.layer==='upper';key=`${side} ${upper?'upper':'middle'} tasset`;
      tip=upper?.845:.610;span=upper?.130:.160;
      dx=Number(side)*(upper?.102:.110);dy=upper?.009:.012;dz=upper?.016:.020;
    } else {
      let k: number | undefined;
      const tail=/(?:long folded cloth tail |^Cloth tail |^Tail |^Long pointed side scale gore |^Long side scale gore |^Long pointed rear scale panel )(\d)\b/.exec(node.name);
      if (tail) k=Number(tail[1]);
      else if (/^Dragonhide single central pointed cloth tabard$|^Aurora front tabard /.test(node.name)) k=0;
      else if (/^Aurora rear tabard /.test(node.name)) k=4;
      if (k===undefined) continue;
      key=`tail ${k}`;tip=hems[k]!;span=.160;
      dx=.055*Math.sin(centers[k]!);dz=(k===0||k===4?.030:.024)*Math.cos(centers[k]!);dy=.004;
    }
    const p=node.geometry.getAttribute('position'),n=node.geometry.getAttribute('normal');
    const denominator=Math.exp(4)-5;
    let maximum=0,maxProgress=0,minVerticalScale=1,minFinalY=Infinity;
    for(let i=0;i<p.count;i++) {
      const y=p.getY(i),t=Math.max(0,(tip+span-y)/span);
      if(t>1.15)throw new Error(`Aurora tip sweep exceeds its measured terminal region: ${node.name}`);
      if (!t) continue;
      const exponential=Math.exp(4*t),bend=(exponential-1-4*t)/denominator;
      const derivative=-4*(exponential-1)/(denominator*span),vertical=1+dy*derivative;
      if (vertical<.15) throw new Error(`Aurora tip bend folds its surface: ${node.name}`);
      const nx=n.getX(i),nz=n.getZ(i),normal=V(nx,(n.getY(i)-derivative*(dx*nx+dz*nz))/vertical,nz).normalize();
      p.setXYZ(i,p.getX(i)+dx*bend,y+dy*bend,p.getZ(i)+dz*bend);n.setXYZ(i,normal.x,normal.y,normal.z);
      maximum=Math.max(maximum,Math.hypot(dx,dy,dz)*bend);
      maxProgress=Math.max(maxProgress,t);minVerticalScale=Math.min(minVerticalScale,vertical);minFinalY=Math.min(minFinalY,y+dy*bend);
    }
    node.geometry.computeBoundingBox();node.geometry.computeBoundingSphere();
    node.userData.auroraTipSweep={assembly:key,startY:tip+span,tipY:tip,displacementAtTip:[dx,dy,dz],exponentialPower:4};
    changed[key]??={meshes:0,maxDisplacement:0,maxProgress:0,minVerticalScale:1,minFinalY:Infinity};
    const record=changed[key]!;record.meshes++;record.maxDisplacement=Math.max(record.maxDisplacement,maximum);
    record.maxProgress=Math.max(record.maxProgress,maxProgress);record.minVerticalScale=Math.min(record.minVerticalScale,minVerticalScale);record.minFinalY=Math.min(record.minFinalY,minFinalY);
  }
  g.userData.auroraTipSweeps=changed;
}

type ShoulderSurface = (u: number, v: number) => THREE.Vector3;

/** A formed plate has one crowned outer loft, a parallel finished underside,
 * closed returns and a single sharp tip. U runs around the shoulder, not in XY. */
function shoulderShell(g: THREE.Group, anchor: THREE.Object3D, name: string,
  f: ShoulderSurface, m: ArmorMaterials, nu: number, nv: number, thickness: number): void {
  const stride=nu+1,tip=stride*nv,count=tip+1;
  const pos:number[]=[],norm:number[]=[],uv:number[]=[],ix:number[]=[];
  const points:THREE.Vector3[]=[],normals:THREE.Vector3[]=[];
  for(let j=0;j<nv;j++)for(let i=0;i<=nu;i++){
    points.push(f(i/nu,j/nv));normals.push(normalAt(f,i/nu,j/nv));
  }
  points.push(f(.5,1));normals.push(normalAt(f,.5,.999));
  for(const underside of [false,true])for(let k=0;k<count;k++){
    const v=k===tip?1:Math.floor(k/stride)/nv;
    const edgeThickness=thickness*(.15+.85*Math.min(1,(1-v)/.18));
    const p=points[k]!.clone().addScaledVector(normals[k]!,underside?-edgeThickness:0);
    const n=normals[k]!.clone().multiplyScalar(underside?-1:1);
    pos.push(p.x,p.y,p.z);norm.push(n.x,n.y,n.z);uv.push(p.x*4,p.y*4);
  }
  for(const underside of [false,true]){
    const start=Number(underside)*count;
    const tri=(a:number,b:number,c:number)=>underside?ix.push(start+a,start+c,start+b):ix.push(start+a,start+b,start+c);
    if(underside){
      // Keep the full sewn root and perimeter. Two hidden spans close each
      // convex cross-section beneath the unchanged outer plate and gold rims.
      const half=nu/2;
      for(const begin of [0,half]){
        const end=begin+half,far=stride+end;
        for(let i=begin;i<end;i++)tri(i,i+1,far);
        tri(begin,far,stride+begin);
      }
      for(let j=1;j<nv-1;j++)for(const i of [0,half]){
        const a=j*stride+i,b=a+half,c=a+stride,d=c+half;tri(a,b,c);tri(b,d,c);
      }
      for(const i of [0,half])tri((nv-1)*stride+i,(nv-1)*stride+i+half,tip);
    }else{
      for(let j=0;j<nv-1;j++)for(let i=0;i<nu;i++){
        const a=j*stride+i,b=a+1,c=a+stride,d=c+1;tri(a,b,c);tri(b,d,c);
      }
      for(let i=0;i<nu;i++)tri((nv-1)*stride+i,(nv-1)*stride+i+1,tip);
    }
  }
  const wall=(a:number,b:number)=>ix.push(a,a+count,b,b,a+count,b+count);
  for(let i=0;i<nu;i++)wall(i+1,i);
  for(let j=0;j<nv-1;j++){
    wall(j*stride,(j+1)*stride);wall((j+1)*stride+nu,j*stride+nu);
  }
  wall((nv-1)*stride,tip);wall(tip,(nv-1)*stride+nu);
  const geometry=new THREE.BufferGeometry();geometry.setIndex(ix);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  const mesh=attach(g,anchor,new THREE.Mesh(geometry,m.cloth),name);
  mesh.userData.auroraShoulderVolume={closed:true,construction:'front-to-back crowned loft with sealed underside and returns',thicknessMeters:thickness,singlePointTip:true,buriedRoot:true};
}

/** Broad gold face, bevel and a returned lower edge remain visible in profile. */
function shoulderBinding(g: THREE.Group, anchor: THREE.Object3D, name: string,
  f: ShoulderSurface, u: number, width: number, m: ArmorMaterials, steps=20): void {
  const profile=[[-.5,.0034],[-.43,.0058],[.43,.0058],[.5,.0034],[0,-.0042]] as const;
  const pos:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let j=0;j<=steps;j++){
    const v=j/steps,p=f(u,v),n=normalAt(f,u,Math.min(.999,v));
    const tangent=f(u,Math.min(1,v+.0001)).sub(f(u,Math.max(0,v-.0001))).normalize();
    const across=tangent.cross(n).normalize();
    const taper=Math.min(1,(1-v)/.12),crown=f(.5,v);
    const room=.9*Math.min(crown.distanceTo(f(0,v)),crown.distanceTo(f(1,v)))+.00012;
    const w=Math.min(width*(.015+.985*taper),room),relief=Math.min(1,w/width);
    for(const [a,h] of profile){
      const q=p.clone().addScaledVector(across,a*w).addScaledVector(n,h*(.04+.96*relief));
      pos.push(q.x,q.y,q.z);uv.push(v,a+.5);
    }
    if(j)for(let k=0;k<5;k++){
      const a=(j-1)*5+k,b=(j-1)*5+(k+1)%5;ix.push(a,b,a+5,b,b+5,a+5);
    }
  }
  for(let k=1;k<4;k++){ix.push(0,k+1,k);const t=steps*5;ix.push(t,t+k,t+k+1);}
  const geometry=new THREE.BufferGeometry();geometry.setIndex(ix);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();
  const mesh=attach(g,anchor,new THREE.Mesh(geometry,m.metal),name);
  mesh.userData.auroraShoulderBinding={widthMeters:width,flatFaceWidthMeters:width*.86,returnDepthMeters:.0042,closed:true,taperedPoint:true};
}

/** Small closed hexagonal scutes use local course width and arc-length spacing.
 * Narrowing a blade removes columns instead of stretching a single large plate. */
function shoulderTipScutes(g:THREE.Group,anchor:THREE.Object3D,name:string,f:ShoulderSurface,m:ArmorMaterials,seed:number,rootColumns:number):void {
  const palette=m.scutes.length?m.scutes:[m.scales];
  const batches=Array.from({length:palette.length+1},()=>({pos:[] as number[],uv:[] as number[],ix:[] as number[],plates:0}));
  const distances=[0];let previous=f(.5,0);
  for(let i=1;i<=80;i++){const p=f(.5,i/80);distances.push(distances[i-1]!+p.distanceTo(previous));previous=p;}
  const length=distances[80]!;
  let rootWidth=0,rootPoint=f(.075,0);
  for(let i=1;i<=12;i++){const p=f(.075+.85*i/12,0);rootWidth+=p.distanceTo(rootPoint);rootPoint=p;}
  const rootCell=Math.max(.0075,rootWidth/rootColumns),transitionLength=Math.max(.020,rootCell*2);
  const atDistance=(d:number)=>{
    d=THREE.MathUtils.clamp(d,0,length);let i=1;while(i<80&&distances[i]!<d)i++;
    return (i-1+(d-distances[i-1]!)/Math.max(.000001,distances[i]!-distances[i-1]!))/80;
  };
  const clip=(polygon:[number,number][],axis:0|1,limit:number,above:boolean)=>{
    const result:[number,number][]=[];let p=polygon[polygon.length-1]!;
    for(const q of polygon){const a=above?p[axis]>=limit:p[axis]<=limit,b=above?q[axis]>=limit:q[axis]<=limit;
      if(a!==b){const t=(limit-p[axis])/(q[axis]-p[axis]);const r:[number,number]=[THREE.MathUtils.lerp(p[0],q[0],t),THREE.MathUtils.lerp(p[1],q[1],t)];r[axis]=limit;result.push(r);}
      if(b)result.push(q);p=q;
    }return result;
  };
  const outline=[[-.5,-.33],[0,-.48],[.5,-.33],[.5,.20],[0,.59],[-.5,.20]] as const;
  let distance=.0015,row=0,maximumColumns=0,maxAspect=0,minWidth=Infinity,maxWidth=0;
  while(distance<length-.0008&&row<64){
    const v=atDistance(distance);let width=0,p=f(.075,v);
    for(let i=1;i<=12;i++){const q=f(.075+.85*i/12,v);width+=q.distanceTo(p);p=q;}
    const bodyCell=THREE.MathUtils.lerp(rootCell,.0105,THREE.MathUtils.smoothstep(distance,0,transitionLength));
    const targetCell=THREE.MathUtils.lerp(bodyCell,.0075,THREE.MathUtils.smoothstep(v,.45,.75));
    const columns=Math.max(1,Math.min(8,Math.round(width/targetCell))),cell=width/columns;
    const pitch=Math.min(targetCell,cell*.82),height=pitch*1.29,du=.85/columns*.98;
    const low=atDistance(distance-height*.5),high=atDistance(distance+height*.5),dv=high-low;
    const stagger=0;
    maximumColumns=Math.max(maximumColumns,columns);
    for(let column=0;column<columns;column++){
      const centerU=.075+(column+.5+stagger)*.85/columns;
      let polygon:[number,number][]=outline.map(([x,y])=>[centerU+x*du,v+y*dv]);
      polygon=clip(clip(clip(clip(polygon,0,.075,true),0,.925,false),1,.018,true),1,.982,false);
      if(polygon.length<3)continue;
      let area=0;for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!;area+=a[0]*b[1]-a[1]*b[0];}
      if(area<du*dv*.03)continue;
      const n=polygon.length,center:[number,number]=[polygon.reduce((s,p)=>s+p[0],0)/n,polygon.reduce((s,p)=>s+p[1],0)/n];
      const tipLift=Math.min(.00135,cell*.16),thickness=Math.min(.00055,cell*.07);
      const mapped=(q:readonly[number,number],bottom=false,crown=false)=>{
        const normal=normalAt(f,q[0],q[1]),tip=THREE.MathUtils.clamp((q[1]-(v-dv*.5))/Math.max(.00001,dv),0,1);
        return f(q[0],q[1]).addScaledVector(normal,.00085+tip*tipLift+(crown?Math.min(.0005,cell*.065):0)-(bottom?thickness:0));
      };
      const top=polygon.map(q=>mapped(q)),bottom=polygon.map(q=>mapped(q,true)),centerPoint=mapped(center,false,true);
      const batch=batches[Math.abs(Math.imul(seed+row*37,column+19))%palette.length]!,edge=batches[palette.length]!;
      const vertex=(b:typeof batch,p:THREE.Vector3,q:readonly[number,number])=>{const k=b.pos.length/3;b.pos.push(p.x,p.y,p.z);b.uv.push(q[0]*width*4,q[1]*length*4);return k;};
      const base=vertex(batch,centerPoint,center);for(let i=0;i<n;i++)vertex(batch,top[i]!,polygon[i]!);
      for(let i=0;i<n;i++)batch.ix.push(base,base+1+i,base+1+(i+1)%n);
      const underside=edge.pos.length/3;for(let i=0;i<n;i++)vertex(edge,bottom[i]!,polygon[i]!);
      for(let i=1;i<n-1;i++)edge.ix.push(underside,underside+i+1,underside+i);
      for(let i=0;i<n;i++){const next=(i+1)%n,a=vertex(edge,top[i]!,polygon[i]!),b=vertex(edge,bottom[i]!,polygon[i]!),c=vertex(edge,top[next]!,polygon[next]!),d=vertex(edge,bottom[next]!,polygon[next]!);edge.ix.push(a,b,c,c,b,d);}
      batch.plates++;
      const full=polygon.length===6&&polygon.every(p=>p[0]>.07501&&p[0]<.92499&&p[1]>.01801&&p[1]<.98199);
      if(full){const w=top[0]!.distanceTo(top[2]!),h=top[1]!.distanceTo(top[4]!);maxAspect=Math.max(maxAspect,Math.max(w,h)/Math.max(.000001,Math.min(w,h)));minWidth=Math.min(minWidth,w);maxWidth=Math.max(maxWidth,w);}
    }
    distance+=Math.max(.0015,pitch);row++;
  }
  for(const [index,batch]of batches.entries()){
    if(!batch.ix.length)continue;const geometry=new THREE.BufferGeometry();geometry.setIndex(batch.ix);
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(batch.pos,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uv,2));geometry.computeVertexNormals();
    const mesh=attach(g,anchor,new THREE.Mesh(geometry,index===palette.length?m.scales:palette[index]!),`${name} ${index===palette.length?'closed cut edges':`small scutes ${index+1}`}`);
    mesh.userData.scaleField={plates:batch.plates,rows:row,columns:maximumColumns,adaptiveCourses:true,closedSidesAndUndersides:true,maxFullPlateAspect:maxAspect,fullPlateWidthRange:[minWidth,maxWidth],triangles:batch.ix.length/3};
  }
}

/** The lower edge curls into the chest; the broad back continues over the native
 * deltoid. Both contours meet at one swept outer point, without an aft cut end. */
function shoulderLoft(side:number,front:THREE.CatmullRomCurve3,rear:THREE.CatmullRomCurve3,
  crown:number,outward=0,bladeWidth=0,depthLimit?:(x:number)=>number):ShoulderSurface {
  const shoulderDepth=Math.abs(front.getPoint(.45).z-rear.getPoint(.45).z)*(1-.45*THREE.MathUtils.smoothstep(.45,.40,.85));
  const depthStops=[[.45,shoulderDepth],[.65,.040],[.80,.015],[.92,.005],[1,0]] as const;
  const raw:ShoulderSurface=(u,v)=>{
    if(v===1)return front.getPoint(1);
    const fore=front.getPoint(v),aft=rear.getPoint(v),p=fore.clone().lerp(aft,u);
    // The contour curves already converge to a point. Reduce their outer
    // depth without multiplying it by another zero-ended taper. The vertical
    // blade face retains its own width until the short terminal point.
    const arch=Math.sin(Math.PI*u),along=Math.sin(Math.PI*v)**.68;
    let height=crown*(.18*(1-v)**3+along);
    if(bladeWidth){
      let depth=1-.45*THREE.MathUtils.smoothstep(v,.40,.85);
      if(v>.45){
        const k=depthStops.findIndex((stop,index)=>index>0&&v<=stop[0]);
        const [a,spanA]=depthStops[k-1]!,[b,spanB]=depthStops[k]!;
        const span=THREE.MathUtils.lerp(spanA,spanB,THREE.MathUtils.smoothstep(v,a,b));
        depth=Math.min(depth,span/Math.max(.000001,Math.abs(fore.z-aft.z)));
      }
      if(depthLimit)depth=Math.min(depth,depthLimit(Math.abs((fore.x+aft.x)*.5))/Math.max(.000001,Math.abs(fore.z-aft.z)));
      const centerZ=(fore.z+aft.z)*.5;
      p.z=centerZ+(p.z-centerZ)*depth;
      const faceWidth=bladeWidth*(1-.28*THREE.MathUtils.smoothstep(v,.65,.86))*Math.min(1,(1-v)/.14);
      height=THREE.MathUtils.lerp(height,faceWidth,THREE.MathUtils.smoothstep(v,.42,.66));
    }
    p.y+=height*arch;
    p.x+=side*outward*arch*along;
    return p;
  };
  return side>0?(u,v)=>raw(1-u,v):raw;
}

/** Three separate sabre-shaped plates wrap over the shoulder. Raised gold
 * crests divide each crowned shell into front and rear framed scale insets. */
function layeredShoulders(g: THREE.Group, m: ArmorMaterials): string[] {
  const removed:string[]=[];
  for(const node of [...g.children])if(/^(Broad single-wing curved shoulder saddle|Shoulder |Front curved shoulder overlap|Rear curved shoulder overlap)/.test(node.name)){
    removed.push(node.name);g.remove(node);
  }
  const anchor=new THREE.Object3D();anchor.userData.itemModelBone='spine_03';
  for(const side of [-1,1]) {
    const curve=(points:readonly (readonly [number,number,number])[])=>new THREE.CatmullRomCurve3(points.map(([x,y,z])=>V(side*x,y,z)),false,'centripetal');
    const tips=[[.357,1.604,-.028],[.395,1.544,-.020],[.380,1.492,-.011]] as const;
    const fronts=[
      [[.139,1.418,.061],[.187,1.490,.060],[.273,1.511,.051]],
      [[.154,1.404,.072],[.204,1.467,.078],[.307,1.483,.057]],
      [[.167,1.394,.075],[.220,1.437,.090],[.310,1.443,.068]],
    ] as const;
    const rears=[
      [[.125,1.451,-.137],[.188,1.494,-.174],[.277,1.512,-.147]],
      [[.137,1.438,-.147],[.206,1.472,-.184],[.309,1.487,-.150]],
      [[.149,1.425,-.148],[.222,1.443,-.193],[.310,1.448,-.157]],
    ] as const;
    const upperFront=curve([...fronts[0],tips[0]]),upperRear=curve([...rears[0],tips[0]]);
    const commonDepth=[.45,.65,.80].map(v=>{
      const front=upperFront.getPoint(v),rear=upperRear.getPoint(v);
      return [Math.abs((front.x+rear.x)*.5),v===.45?Math.abs(front.z-rear.z)*(1-.45*THREE.MathUtils.smoothstep(v,.40,.85)):v===.65?.040:.015] as const;
    });
    // All tiers become narrow at the same shoulder X. Their differing curve
    // lengths must not leave a lower scale panel in front of an upper frame.
    const depthLimit=(x:number)=>{
      if(x<=commonDepth[0]![0])return Infinity;
      const k=commonDepth.findIndex((stop,index)=>index>0&&x<=stop[0]);
      if(k<0)return .015;
      const [a,spanA]=commonDepth[k-1]!,[b,spanB]=commonDepth[k]!;
      return THREE.MathUtils.lerp(spanA,spanB,THREE.MathUtils.smoothstep(x,a,b));
    };
    for(const tier of [0,1,2]) {
      const f=shoulderLoft(side,curve([...fronts[tier]!,tips[tier]!]),curve([...rears[tier]!,tips[tier]!]),[.055,.048,.040][tier]!,tier*.004,[.042,.037,.032][tier]!,tier?depthLimit:undefined);
      const name=`closed swept shoulder pauldron ${side} ${tier}`;
      shoulderShell(g,anchor,name,f,m,8,18,.0045);
      for(const u of [0,.5,1])shoulderBinding(g,anchor,`${name} gold bound ${u===.5?'crown':'return'} ${u}`,f,u,u===.5?.013:.015,m,u===.5?30:u===(side>0?0:1)?15:20);
      for(const rear of [false,true]){
        const lowHalf=rear?side>0:side<0;
        for(const terminal of [false,true]){
          // Reserve the gold's physical half-width plus clearance for the
          // curved scute lips. Adaptive courses begin where the shell narrows,
          // replacing the body rows before they could stretch into pale ribs.
          const start=terminal?.450:.130,end=terminal?.925:.475;
          const field:ShoulderSurface=(u,v)=>{
            const sv=THREE.MathUtils.lerp(start,end,v),a=lowHalf?0:.5,b=lowHalf?.5:1;
            const span=f(a,sv).distanceTo(f(b,sv)),c=f(.5,sv);
            const room=.9*Math.min(c.distanceTo(f(0,sv)),c.distanceTo(f(1,sv)))+.00012;
            const edge=(w:number)=>Math.min(.20,(Math.min(w,room)*.5+.0015)/Math.max(span,.0001)*.5);
            const insetA=edge(lowHalf?.015:.013),insetB=edge(lowHalf?.013:.015);
            const su=THREE.MathUtils.lerp(a+insetA,b-insetB,u);
            return f(su,sv).addScaledVector(normalAt(f,su,sv),.0006);
          };
          const first=g.children.length;
          const fieldName=`${name} ${rear?'rear':'front'} recessed opal inset ${terminal?'outer course':'body'}`,seed=1431+tier*83+side+Number(rear)*31+Number(terminal)*131;
          if(terminal)shoulderTipScutes(g,anchor,fieldName,field,m,seed,rear?3:4);
          else addScaleField(g,fieldName,field,{...m,lining:m.scales},
            {columns:rear?3:4,rows:rear?3:5,reverse:true,bone:'spine_03',lift:.00025,seed});
          for(const child of g.children.slice(first))child.userData.auroraOrnament=true;
        }
      }
    }
    for(const tier of [0,1]) {
      const tip=([.306,1.338,-.025] as const).map((v,k)=>v+(k===0?-.002:k===1?-.062:-.006)*tier) as [number,number,number];
      const front=curve([[.179+tier*.006,1.445-tier*.018,.064],[.232+tier*.004,1.411-tier*.038,.017],[.280,1.367-tier*.056,-.006],tip]);
      const rear=curve([[.166+tier*.012,1.457-tier*.018,-.151],[.231+tier*.005,1.423-tier*.038,-.093],[.279,1.374-tier*.056,-.061],tip]);
      const f=shoulderLoft(side,front,rear,.004,.026);
      const name=`closed ivory shoulder overlap ${side} ${tier}`;
      shoulderShell(g,anchor,name,f,m,6,18,.0035);
      for(const u of [0,.5,1])shoulderBinding(g,anchor,`${name} angular gold contour ${u}`,f,u,u===.5?.005:.007,m,u===(side>0?0:1)?16:18);
    }
  }
  g.userData.auroraShoulderDesign={construction:'three long gold-bound crescent loft shells arched front-to-back over the native shoulder, with recessed opal insets and two descending ivory overlaps',nativeShoulderCrownY:1.537,frontToBackCoverage:true,upperTipY:1.604,middleTipX:.395,lowerTipX:.380,rootsBuriedInYoke:true,finishedUndersides:true,noFrontalFeatherFan:true};
  return removed;
}

function refineRobe(g: THREE.Group, m: ArmorMaterials): string[] {
  const removed: string[] = [];
  for (const node of [...g.children]) {
    if (/^Shoulder chased metal foliage |^Tail (0|4) sculpted hem ornament |^Chest gold (acanthus stem|broad leaf|upper leaf) /.test(node.name)) {
      removed.push(node.name); g.remove(node);
    }
  }
  // The larger tiered scale pads replace the small shoulder wire sigils.
  // The torso and lower-body scale fields keep their accepted backing topology.
  const collar = find(g, 'Sculpted standing split collar with turned lining');
  const collarSurface = carrier(collar, 48, 12, .010);
  for (const u of [.067, .933]) {
    opal(g, collar, `collar light pin ${u}`, collarSurface, u, .64, .0037, .009, m);
  }
  for (const rear of [false, true]) {
    const mesh = find(g, rear ? 'Overlapping side and back long folded cloth tail 4' : 'Dragonhide single central pointed cloth tabard');
    const f = carrier(mesh, 18, 30, .0032);
    sigil(g, mesh, `${rear ? 'rear' : 'front'} tabard aurora seal`, f, .5, .24, .25, .15, m, .0045);
    for (const side of [-1, 1]) inlay(g, mesh, `${rear ? 'rear' : 'front'} tabard falling aurora ${side}`, f,
      [[.5+side*.075,.42],[.5+side*.15,.54],[.5+side*.10,.68],[.5+side*.14,.83]], m.metal, .0013, 40);
  }
  removed.push(...layeredShoulders(g,m));
  layerHipTassets(g);
  sweepRobeTips(g);
  return removed;
}

function refineHood(g: THREE.Group, m: ArmorMaterials): string[] {
  const removed: string[] = [];
  // The fitted crown already closes the back. The inherited extra drape is
  // a capped cone rooted inside that crown and appears through the open face.
  // Aurora keeps its continuous sewn cowl without this redundant inner cone.
  for (const node of [...g.children]) if (/^dragonhide (tall branching gold brow crest|violet crest jewel|crest central carved ridge|closed soft falling rear drape|enclosed rear root seam|enclosed rear sewn tip|back point center seam)/.test(node.name)) {
    removed.push(node.name); g.remove(node);
  }
  // The entire coronet is above the brow arch. Its short petals do not enter
  // the face opening, and its top is lower than the old spear crest.
  const crown = ornament(g, 'Aurora open three-petal coronet', V(0, 1.811, .095), V(0, .22, 1),
    [[-.057,-.016],[-.035,-.004],[-.040,.019],[-.019,.011],[-.011,.028],[0,.053],[.011,.028],[.019,.011],[.040,.019],[.035,-.004],[.057,-.016],[.021,-.012],[0,-.018],[-.021,-.012]],
    [[[-.027,-.005],[-.027,.006],[-.014,.002]],[[.027,-.005],[.014,.002],[.027,.006]],[[0,-.005],[-.006,.019],[0,.032],[.006,.019]]], m, .0016);
  crown.userData.auroraOrnament = true;
  const planar: Carrier = (u, v) => ({ point: V((u-.5)*.12, 1.814+(v-.5)*.07, .099), normal: V(0,.22,1).normalize() });
  opal(g, crown, 'coronet central dawnstone', planar, .5, .57, .0055, .013, m);
  for (const u of [.19, .81]) opal(g, crown, `coronet satellite ${u}`, planar, u, .37, .0032, .005, m);
  const hood = find(g, 'dragonhide fitted sewn crown and continuous side cowl');
  const hoodSurface = carrier(hood,64,52,.0012);
  for (const side of [0,1]) {
    const x = (u: number) => side ? 1-u : u;
    for (const line of [0,1]) inlay(g, hood, `swept side coronet rib ${side} ${line}`, hoodSurface,
      [[x(.070+line*.040),.51],[x(.115+line*.045),.65],[x(.17+line*.05),.76],[x(.24+line*.055),.84]], m.metal, .0032-line*.0005, 32, .0017);
    pearl(g, hood, `temple coronet pearl ${side}`, hoodSurface, x(.100), .61, m);
  }
  return removed;
}

function refineAccessories(g: THREE.Group, part: AuroraPiece, m: ArmorMaterials): void {
  const anchors: THREE.Mesh[] = [];
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    if (part === 'leggings' && /Long narrow pointed front cloth drape$/.test(node.name)) anchors.push(node);
    if (part === 'boots' && /Angular upper calf scale chevron backing$/.test(node.name)) anchors.push(node);
    if (part === 'wraps' && /pointed leather wrist scroll$/.test(node.name)) anchors.push(node);
  });
  for (const [index, mesh] of anchors.entries()) {
    if (part === 'leggings') sigil(g, mesh, `hip drape star ${index}`, carrier(mesh, 14, 18, .003), .5, .27, .26, .15, m, .003);
    if (part === 'boots') {
      const f = carrier(mesh, 20, 25, .009);
      for (const u of [.24, .76]) opal(g, mesh, `calf satellite ${index} ${u}`, f, u, .69, .0028, .0056, m);
      for (const side of [-1,1]) inlay(g, mesh, `calf crown gold arc ${index} ${side}`, f,
        [[.5+side*.29,.49],[.5+side*.31,.71],[.5+side*.20,.85],[.5,.92]], m.metal,.0027,24,.0016);
    }
    if (part === 'wraps') {
      const f = carrier(mesh,36,10,.003);
      sigil(g, mesh, `wrist dawn seal ${index}`, f, .5, .52, .26, .32, m, .0028);
      for (const side of [-1,1]) inlay(g, mesh, `wrist raised gold feather ${index} ${side}`, f,
        [[.5+side*.38,.12],[.5+side*.40,.38],[.5+side*.34,.67],[.5+side*.18,.88]], m.metal,.0026,24,.0016);
    }
  }
}

/** T90 ornament is additive over the corrected T70 fit, using new materials. */
export function buildAuroraPiece(part: AuroraPiece, m: ArmorMaterials): THREE.Group {
  const g = builders[part]('dragonhide', m);
  g.updateMatrixWorld(true);
  const removed = part === 'robe' ? refineRobe(g, m) : part === 'hood' ? refineHood(g, m) : [];
  if (part !== 'robe' && part !== 'hood') refineAccessories(g, part, m);
  g.name = `aurora_${part}`;
  g.traverse(node => {
    node.name = node.name.replace(/dragonhide/gi, 'Aurora').replace(/\bDragon\b/g, 'Aurora');
  });
  g.userData.auroraDesign = {
    baseDesign: 'accepted red T70 dragonhide author silhouette',
    preservedFit: true, faceOpening: 'open',
    ornament: 'three-tier cupped scale shoulders, staggered raised hip leaves, inset pearls, open dawn coronet, celestial tabard filigree',
    supersededOrnaments: removed,
  };
  let triangles = 0;
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    triangles += Array.isArray(node.material)
      ? node.geometry.groups.reduce((sum: number, group: {count: number}) => sum + group.count, 0) / 3
      : (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
  });
  if (triangles > 150000) throw new Error(`Aurora ${part} exceeds 150000 triangles: ${triangles}`);
  return g;
}
