import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mooseAntlers } from './organic-appendages.mjs';

export const SOURCE='art/rebuild/candidates/finish-quadrupeds/source-hoofed/horse-source-static.glb';
export const OUTPUT='art/rebuild/candidates/finish-quadrupeds/source-moose-horse/revision3';
const clamp=THREE.MathUtils.clamp,lerp=THREE.MathUtils.lerp;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const bell=(v,c,r)=>Math.exp(-(((v-c)/r)**2));
const curve=(rows,v)=>{let i=0;while(i<rows.length-2&&v>rows[i+1][0])i++;const a=rows[i],b=rows[i+1];return lerp(a[1],b[1],clamp((v-a[0])/(b[0]-a[0]),0,1));};
export const ANATOMY={
  source:'Complete Lyndon Daniels CC0 horse body; coherent positional deformation, source body retained; distal hoof surfaces clipped and replaced, UVs interpolated at boundary',
  heightMap:[[0,.002],[.15,.17],[.60,.78],[1.05,1.35],[1.40,1.68],[1.75,1.93],[2.10,2.13],[2.40,2.38]],
  skullDepthMap:[[.85,.83],[1.10,.96],[1.35,1.09],[1.55,1.32],[1.72,1.57],[1.82,1.68]],
  shoulderHump:{centerZ:.34,widthZ:.46,addedHeight:.20},
  bodyWidthScale:.80,foreFootSource:[.32828,.18130],hindFootSource:[.23651,-.84351],
  targetForeFoot:[.29,.52],targetHindFoot:[.26,-.67],
  antlerSpanTarget:1.735,neckBellLength:.41,
};
// Maps every original body vertex, including skull and all four legs. No head
// substitution, body primitive or topology graft is used by this transform.
export function moosePoint(point){
 const [x,y,z]=point,ax=Math.abs(x),sign=x<0?-1:1;
 let yy=curve(ANATOMY.heightMap,y),zz=z*.86+.16,xx=x*.80;
 const lower=(1-smooth(1.00,1.50,y))*smooth(.08,.18,ax),fore=smooth(-.32,.02,z);
 const sourceCenter=lerp(.23651,.32828,fore),targetCenter=lerp(.26,.29,fore);
 xx=lerp(xx,sign*targetCenter+(x-sign*sourceCenter)*.68,lower);
 zz+=lower*lerp(-.105,.205,fore);
 yy+=.20*bell(z,.34,.46)*smooth(1.55,2.06,y)*(1-smooth(.75,1.10,z));
 yy-=.055*bell(z,-1.03,.40)*smooth(1.40,2.02,y);
 const head=smooth(.84,1.20,z)*smooth(1.28,1.68,y);
 const hy=2.075+(y-2.034)*.64;
 yy=lerp(yy,hy,head);zz=lerp(zz,curve(ANATOMY.skullDepthMap,z),head);
 const muzzle=smooth(1.57,1.78,z)*(1-smooth(1.90,2.05,y));
 xx=lerp(xx,x*(.95+1.20*muzzle),head);yy-=.075*muzzle;yy+=.15*muzzle*smooth(1.56,1.73,y);zz+=.055*muzzle*smooth(1.59,1.72,y);
 // Fan the existing ears outward and backward instead of adding new pinnae.
 const ear=smooth(2.205,2.385,y)*smooth(1.15,1.43,z)*smooth(.055,.10,ax);
 xx=lerp(xx,sign*.12,ear);yy=lerp(yy,2.22,ear);zz=lerp(zz,1.18,ear);
 // Contract the pastern into compact hoof coronets; replace only distal surface.
 if(y<.40){const influence=1-smooth(.16,.40,y),footZ=lerp(-.6704,.5209,fore);xx=lerp(xx,sign*targetCenter+(xx-sign*targetCenter)*.65,influence);zz=lerp(zz,footZ+(zz-footZ)*.53,influence);}
 return [xx,yy,zz];
}
function tailPoint([x,y,z]){return [x*.24,1.865+(y-1.84337)*.085,-1.11+(z+1.33156)*.14];}
function manePoint([x,y,z]){return [x*.39,2.18+(y-2.1)*.27,.49+(z-.70)*.40];}
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function build(){
 await mkdir(OUTPUT,{recursive:true});const raw=await readFile(SOURCE);
 if(hash(raw)!=='cdf4f716f7bd1a980814c53ed9fa81d28e016e2e316ed3f319982d7e3cbce782')throw Error('Frozen source horse changed');
 const io=new NodeIO(),doc=await io.read(SOURCE),root=doc.getRoot(),buffer=root.listBuffers()[0],changes=[];
 const originalBounds=new THREE.Box3(),adaptedBounds=new THREE.Box3(),hoofBoundaries=[],finishEvidence={};
 for(const node of root.listNodes()){
  if(!node.getMesh())continue;const world=new THREE.Matrix4().fromArray(node.getWorldMatrix()),name=node.getName();
  for(const prim of node.getMesh().listPrimitives()){
   let pos=prim.getAttribute('POSITION'),original=[],next=[];
   for(let i=0;i<pos.getCount();i++){const p=new THREE.Vector3(...pos.getElement(i,[])).applyMatrix4(world).toArray();const q=name.includes('BezierCurve.005')?tailPoint(p):name==='BezierCurve_Mesh'?manePoint(p):moosePoint(p);if(name.startsWith('Sphere')){const c=moosePoint([name==='Sphere'?.10936:-.10898,2.0347,1.54194]);for(let a=0;a<3;a++)q[a]=c[a]+(q[a]-c[a])*.60;q[0]+=(c[0]<0?-1:1)*.055;}original.push(p);next.push(...q);originalBounds.expandByPoint(new THREE.Vector3(...p));adaptedBounds.expandByPoint(new THREE.Vector3(...q));}
   if(name==='Plane'){const colors=original.flatMap(([x,y,z])=>{const dark=.30+.70*(1-smooth(.70,1.35,y)),blaze=(1-smooth(.035,.12,Math.abs(x)))*smooth(1.15,1.50,z)*smooth(1.62,1.92,y),shade=dark*(1-.84*blaze);return [shade,shade,shade];});prim.setAttribute('COLOR_0',doc.createAccessor().setType('VEC3').setArray(new Float32Array(colors)).setBuffer(buffer));}
   if(name==='Plane'){
    const adj=original.map(()=>new Set()),indices=prim.getIndices().getArray(),groups=new Map();original.forEach((p,i)=>{const key=p.map(v=>v.toFixed(6)).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);});
    for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3];adj[a].add(b);adj[b].add(a);}
    for(const group of groups.values()){const all=new Set(group.flatMap(i=>[...adj[i]]));for(const i of group)adj[i]=all;}
    for(let iteration=0;iteration<5;iteration++){const before=next.slice();for(let i=0;i<original.length;i++){const[x,y,z]=original[i],influence=.48*Math.exp(-(((Math.abs(x)-.13)/.105)**2+((y-2.035)/.11)**2+((z-1.54)/.17)**2));if(influence<.005||!adj[i].size)continue;for(let j=0;j<3;j++){let sum=0;for(const n of adj[i])sum+=before[n*3+j];next[i*3+j]=lerp(before[i*3+j],sum/adj[i].size,influence);}}}
   }
   pos.setArray(new Float32Array(next));
   if(name==='Plane'){
    const attrs=prim.listSemantics().filter(k=>!['NORMAL','TANGENT'].includes(k)),out=Object.fromEntries(attrs.map(k=>[k,[]])),mapped=[],oldIndices=Array.from(prim.getIndices().getArray()),newIndices=[];
    const vertex=i=>({v:Object.fromEntries(attrs.map(k=>[k,prim.getAttribute(k).getElement(i,[])])),weights:{[i]:1}});
    const mix=(a,b,t)=>({v:Object.fromEntries(attrs.map(k=>[k,a.v[k].map((v,j)=>lerp(v,b.v[k][j],t))])),weights:Object.fromEntries([...new Set([...Object.keys(a.weights),...Object.keys(b.weights)])].map(k=>[k,(a.weights[k]??0)*(1-t)+(b.weights[k]??0)*t]))});
    for(let i=0;i<oldIndices.length;i+=3){const input=oldIndices.slice(i,i+3).map(vertex),poly=[];for(let j=0;j<3;j++){const a=input[j],b=input[(j+1)%3],ay=a.v.POSITION[1],by=b.v.POSITION[1];if(ay>=.125)poly.push(a);if((ay>=.125)!==(by>=.125))poly.push(mix(a,b,(.125-ay)/(by-ay)));}for(let j=1;j<poly.length-1;j++)for(const v of [poly[0],poly[j],poly[j+1]]){newIndices.push(mapped.length);mapped.push(v.weights);for(const k of attrs)out[k].push(...v.v[k]);}}
    // Fit only the clipped coronet boundary to a compatible ellipse. Above
    // 0.25 m the original whole-body deformation is unchanged.
    for(let i=0;i<out.POSITION.length;i+=3){const x=out.POSITION[i],y=out.POSITION[i+1],z=out.POSITION[i+2];if(y>.25)continue;const cx=(x<0?-1:1)*(z>0?.29:.26),cz=z>0?.5209:-.6704,a=Math.atan2((z-cz)/.078,(x-cx)/.060),t=1-smooth(.125,.25,y);out.POSITION[i]=lerp(x,cx+.060*Math.cos(a),t);out.POSITION[i+2]=lerp(z,cz+.078*Math.sin(a),t);}
    const seen=new Set();for(let i=0;i<out.POSITION.length;i+=3)if(Math.abs(out.POSITION[i+1]-.125)<1e-7){const p=out.POSITION.slice(i,i+3),key=p.map(v=>v.toFixed(7)).join(',');if(!seen.has(key)){seen.add(key);hoofBoundaries.push(p);}}
    for(const k of attrs)prim.setAttribute(k,doc.createAccessor().setType(prim.getAttribute(k).getType()).setArray(new Float32Array(out[k])).setBuffer(buffer));
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(newIndices)).setBuffer(buffer));pos=prim.getAttribute('POSITION');next.splice(0,next.length,...out.POSITION);
    prim.setExtras({sourceFaceCoordinates:mapped.map(weights=>{const p=[0,0,0];for(const[k,w]of Object.entries(weights))for(let j=0;j<3;j++)p[j]+=original[+k][j]*w;return p;})});
    await writeFile(OUTPUT+'/body-source-vertex-map.json',JSON.stringify({meaning:'Each retained or clipped body vertex maps to original frozen GLB vertex indices with interpolation weights. Original native Bone.005 remains unresolved; no skin.',sourceVertexCount:original.length,vertices:mapped}));
   }
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(next,3));const indices=prim.getIndices()?.getArray();if(indices)geo.setIndex(Array.from(indices));geo.computeVertexNormals();prim.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(geo.getAttribute('normal').array).setBuffer(buffer));prim.setAttribute('TANGENT',null);
   changes.push({node:name,vertices:pos.getCount(),indexCount:indices?.length??null,topologyPreserved:name!=='Plane',uvPreserved:name!=='Plane',uvInterpolated:name==='Plane',deformation:name.includes('BezierCurve.005')?'shortened original tail':name==='BezierCurve_Mesh'?'compressed original mane into shoulder scruff':'whole-body anatomical transform'});
  }
  node.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
 }
 for(const mat of root.listMaterials()){if(mat.getName().includes('Eye'))mat.setBaseColorTexture(null).setBaseColorFactor([.006,.004,.003,1]).setRoughnessFactor(.34);else mat.setBaseColorFactor([.32,.28,.23,1]).setRoughnessFactor(.94);}
 const faceMat=doc.createMaterial('Moose_source_face_without_horse_markings').setRoughnessFactor(.93).setBaseColorFactor([1,1,1,1]);
 const bodyMesh=root.listNodes().find(n=>n.getName()==='Plane').getMesh(),bp=bodyMesh.listPrimitives()[0],coords=bp.getExtras().sourceFaceCoordinates,keep=[],face=[];
 for(let i=0,ix=bp.getIndices().getArray();i<ix.length;i+=3){const tri=Array.from(ix.slice(i,i+3)),c=[0,0,0];for(const n of tri)for(let j=0;j<3;j++)c[j]+=coords[n][j]/3;(c[2]>1.18&&c[1]>1.40?face:keep).push(...tri);}
 const faceColors=coords.flatMap(([x,y,z])=>{const variation=1+.06*Math.sin(x*81+y*49+z*61),nose=smooth(1.50,1.76,z),shade=variation*(1+.15*nose);return [.046*shade,.032*shade,.023*shade];});
 const fp=doc.createPrimitive().setMaterial(faceMat);for(const key of bp.listSemantics())fp.setAttribute(key,bp.getAttribute(key));fp.setAttribute('COLOR_0',doc.createAccessor().setType('VEC3').setArray(new Float32Array(faceColors)).setBuffer(buffer));fp.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(face)).setBuffer(buffer));bp.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(buffer));bp.setExtras({});bodyMesh.addPrimitive(fp);finishEvidence.faceTriangles=face.length/3;finishEvidence.faceTreatment='Original source face triangles and UVs retained; local material omits diffuse and normal horse markings; source images unchanged; embedded eye meshes retained.';
 const hornMat=doc.createMaterial('Corealm_moose_palm_keratin').setRoughnessFactor(.85).setBaseColorFactor([1,1,1,1]);
 const skinMat=doc.createMaterial('Corealm_moose_bell_skin').setRoughnessFactor(.95).setBaseColorFactor([.11,.075,.048,1]);
 const append=(name,positions,indices,colors,material)=>{
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions.flat(),3));geo.setIndex(indices);geo.computeVertexNormals();const prim=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions.flat())).setBuffer(buffer)).setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(geo.getAttribute('normal').array).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer)).setMaterial(material);
  if(colors)prim.setAttribute('COLOR_0',doc.createAccessor().setType('VEC3').setArray(new Float32Array(colors.flat())).setBuffer(buffer));
  root.listScenes()[0].addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));for(const p of positions)adaptedBounds.expandByPoint(new THREE.Vector3(...p));
 };
 const hoofMat=doc.createMaterial('Moose_compact_cloven_keratin').setRoughnessFactor(.82).setBaseColorFactor([.055,.043,.032,1]);
 for(const [leg,cx,cz] of [['fore_left',.29,.5209],['fore_right',-.29,.5209],['hind_left',.26,-.6704],['hind_right',-.26,-.6704]]){
  const outer=hoofBoundaries.filter(p=>Math.abs(p[0]-cx)<.12&&Math.abs(p[2]-cz)<.15).sort((a,b)=>Math.atan2(a[2]-cz,a[0]-cx)-Math.atan2(b[2]-cz,b[0]-cx)),holes=[];
  if(outer.length<8)throw Error('Insufficient source hoof boundary '+leg);
  for(const side of [-1,1]){
   const p=[],ix=[],n=16;for(const [y,rx,rz,off,shift]of [[.002,.03003,.07735,.039,.014],[.025,.033,.085,.039,.010],[.100,.03003,.07735,.039,0],[.125,.019,.043,.025,0]])for(let k=0;k<n;k++){const a=k/n*Math.PI*2;p.push([cx+side*off+Math.cos(a)*rx,y,cz+shift+Math.sin(a)*rz]);}
   for(let r=0;r<3;r++)for(let k=0;k<n;k++){const a=r*n+k,b=r*n+(k+1)%n;ix.push(a,a+n,b,b,a+n,b+n);}for(let k=1;k<n-1;k++)ix.push(0,k,k+1);
   holes.push(p.slice(3*n));append('Moose_hoof_'+leg+'_'+side,p,ix,null,hoofMat);
  }
  const contour=outer.map(p=>new THREE.Vector2(p[0],p[2])),hole2d=holes.map(h=>h.map(p=>new THREE.Vector2(p[0],p[2]))),tris=THREE.ShapeUtils.triangulateShape(contour,hole2d),positions=[...outer,...holes.flat()],ix=tris.flatMap(t=>[t[0],t[2],t[1]]);
  append('Moose_stitched_coronet_'+leg,positions,ix,null,hoofMat);
  finishEvidence[leg]={sourceBoundaryVertices:outer.length,shellBoundaryVertices:holes.map(h=>h.length),collarTriangles:tris.length,method:'Triangulated actual clipped source boundary with two shell-top holes; exact coincident boundary coordinates, no overlapping top caps.'};
 }
 const earMat=doc.createMaterial('Moose_broad_furry_pinna').setRoughnessFactor(.98).setBaseColorFactor([1,1,1,1]);
 for(const sign of [-1,1]){const p=[],ix=[],colors=[],rings=12,sides=12;for(let j=0;j<=rings;j++){const t=j/rings,w=.092*Math.pow(Math.sin(Math.PI*t),.72)+.004;for(let k=0;k<sides;k++){const a=k/sides*Math.PI*2;p.push([sign*(.13+.32*t),2.20+.10*t+Math.cos(a)*w,1.10-.13*t+Math.sin(a)*(.002+.019*Math.sin(Math.PI*t))]);const inner=Math.max(0,Math.sin(a))*Math.sin(Math.PI*t),fur=1+.08*Math.sin(j*13+k*17);colors.push([(.095+.045*inner)*fur,(.07+.029*inner)*fur,(.048+.017*inner)*fur]);}}for(let j=0;j<rings;j++)for(let k=0;k<sides;k++){const a=j*sides+k,b=j*sides+(k+1)%sides;ix.push(a,b,a+sides,b,b+sides,a+sides);}for(let k=1;k<sides-1;k++)ix.push(0,k+1,k,rings*sides,rings*sides+k,rings*sides+k+1);append('Moose_broad_ear_'+sign,p,ix,colors,earMat);}
 let antlerSide=0;mooseAntlers({add:(points,indices,_bone,color)=>{const transformed=points.map(([x,y,z])=>[x*.72,y+.02,z-.04]);append('Moose_antler_'+antlerSide++,transformed,indices,points.map((p,i)=>color(p,i).toArray()),hornMat);}},{});
 // A compact closed bell hangs from the transformed source throat. This is a
 // local appendage, not a substitute neck or head surface.
 const rows=[[1.95,1.02,.025,.035],[1.87,1.05,.042,.042],[1.78,1.08,.047,.044],[1.69,1.10,.040,.038],[1.61,1.11,.029,.030],[1.555,1.10,.015,.020],[1.54,1.093,.003,.006]],points=[],indices=[],sides=20;
 for(const [y,z,rx,rz]of rows)for(let k=0;k<sides;k++){const a=k/sides*Math.PI*2;points.push([Math.cos(a)*rx,y,z+Math.sin(a)*rz]);}
 for(let j=0;j<rows.length-1;j++)for(let k=0;k<sides;k++){const a=j*sides+k,b=j*sides+(k+1)%sides;indices.push(a,b,a+sides,b,b+sides,a+sides);}
 for(let k=1;k<sides-1;k++)indices.push(0,k+1,k,(rows.length-1)*sides,(rows.length-1)*sides+k,(rows.length-1)*sides+k+1);
 append('Moose_throat_bell',points,indices,null,skinMat);
 adaptedBounds.makeEmpty();for(const n of root.listNodes())for(const p of n.getMesh()?.listPrimitives()??[]){const a=p.getAttribute('POSITION');for(let i=0;i<a.getCount();i++)adaptedBounds.expandByPoint(new THREE.Vector3(...a.getElement(i,[])));}
 await writeFile(OUTPUT+'/finish-evidence.json',JSON.stringify(finishEvidence,null,2));
 const file=OUTPUT+'/moose-from-horse-static.glb';await io.write(file,doc);const out=await readFile(file);
 const measure=(p)=>({original:p,adapted:moosePoint(p)}),landmarks={foreHoofMedial:measure([.32828,0,.18130]),hindHoofMedial:measure([.23651,0,-.84351]),pelvisTop:measure([0,2.07,-.93]),shoulderTop:measure([0,2.09,.34]),eye:{original:[.10936,2.0347,1.54194],adapted:moosePoint([.10936,2.0347,1.54194]).map((v,i)=>i===0?v+.055:v)},belly:measure([0,1.0,-.2]),nose:measure([0,1.57,1.80]),earTip:measure([.16,2.40,1.56])};
 const report={source:{file:SOURCE,sha256:hash(raw),author:'Lyndon Daniels',license:'CC0-1.0',url:'https://opengameart.org/content/realtime-ranchers-3d-model-pack'},candidate:{file,sha256:hash(out),bytes:out.length,skins:root.listSkins().length,animations:root.listAnimations().length},anatomy:ANATOMY,originalBounds:{min:originalBounds.min.toArray(),max:originalBounds.max.toArray()},adaptedBounds:{min:adaptedBounds.min.toArray(),max:adaptedBounds.max.toArray()},landmarks,ratios:{shoulderToPelvisHeight:landmarks.shoulderTop.adapted[1]/landmarks.pelvisTop.adapted[1],sourceShoulderToPelvisHeight:2.09/2.07,bellyClearanceToShoulder:landmarks.belly.adapted[1]/landmarks.shoulderTop.adapted[1],sourceBellyClearanceToShoulder:1/2.09},meshes:changes,addedAppendages:['two Corealm palmate antlers','Corealm compact throat bell','eight stitched hoof shells and four triangulated source-boundary coronets','two capped broad pinnae with inner-ear color variation'],limitations:['Static candidate, no skin or actions. Original native rig has 19 bones and no actions; absent Bone.005 group must be repaired before any rig reuse.','Source body triangles below y .125 m clipped; remaining body UVs retained/interpolated. Eight local open-top hoof shells join actual body boundary loops through triangulated coronets. Exact source-vertex interpolation map retained.','Body horse texture retained; source face triangles use texture-free material and local eye fold relaxation. Embedded original eyes remain.','No production browser or GPU acceptance performed.','Ratios are authored coordinates informed by NPS photographs, not measured zoological measurements.']};
 await writeFile(OUTPUT+'/adaptation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));return report;
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/source-moose-horse.mjs'))await build();
