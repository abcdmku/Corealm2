import * as T from 'three';
import type { ItemModelAuthor } from '../contracts.js';

type V = [number, number, number];
type Ring = [number, number, number, number?];
const ids = ['nightglass_helm','nightglass_plate','nightglass_greaves','nightglass_boots','nightglass_gauntlets'] as const;

function materials() {
  const size=256, color=new Uint8Array(size*size*4), rough=new Uint8Array(size*size*4);
  let seed=4217;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,n=random(),vein=Math.sin(x*.083+y*.047+Math.sin(y*.06)*3);
    const scratch=((x*13+y*7)%137===0 && n>.7)?12:0;
    color[i]=19+n*9+scratch;color[i+1]=25+n*11+scratch;color[i+2]=42+n*15+vein*3+scratch;color[i+3]=255;
    const r=115+n*26;rough[i]=r;rough[i+1]=r;rough[i+2]=r;rough[i+3]=255;
  }
  const tex=(data:Uint8Array,srgb=false)=>{const t=new T.DataTexture(data,size,size);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=srgb?T.SRGBColorSpace:T.NoColorSpace;t.needsUpdate=true;return t;};
  const glass=new T.MeshPhysicalMaterial({name:'Nightglass polished midnight blue black steel',color:0xffffff,map:tex(color,true),roughnessMap:tex(rough),metalness:.83,roughness:.57,clearcoat:.4,clearcoatRoughness:.23});
  const edge=new T.MeshStandardMaterial({name:'Cold blue silver honed bevels',color:0x7c97b3,metalness:.87,roughness:.34});
  const leather=new T.MeshStandardMaterial({name:'Charcoal grained leather lining',color:0x171516,roughness:.89});
  const seam=new T.MeshStandardMaterial({name:'Waxed dark grey stitching',color:0x53504d,roughness:.92});
  return {glass,edge,leather,seam};
}
type M=ReturnType<typeof materials>;
function mesh(g:T.Group,name:string,geo:T.BufferGeometry,mat:T.Material){const m=new T.Mesh(geo,mat);m.name=name;g.add(m);return m;}
function geometry(p:number[],ix:number[]){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(ix);const uv:number[]=[];for(let i=0;i<p.length;i+=3)uv.push(p[i]!*5,p[i+1]!*5+p[i+2]!*3);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;}
function line(g:T.Group,name:string,a:V,b:V,r:number,mat:T.Material){const d=new T.Vector3(...b).sub(new T.Vector3(...a));const m=mesh(g,name,new T.CylinderGeometry(r,r,d.length(),5),mat);m.position.copy(new T.Vector3(...a).add(new T.Vector3(...b)).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());}
// A closed thickness shell, open along the top and bottom, optionally open at the front.
function shell(g:T.Group,name:string,rings:Ring[],mat:T.Material,cx=0,cz=0,start=-Math.PI,end=Math.PI,thick=.005,n=20){
  rings=[...rings].sort((a,b)=>a[0]-b[0]);
  const p:number[]=[],ix:number[]=[];
  for(let inner=0;inner<2;inner++)for(const [y,rx,rz,shift=0] of rings)for(let j=0;j<=n;j++){const a=start+(end-start)*j/n;p.push(cx+Math.sin(a)*(rx-inner*thick),y,cz+shift+Math.cos(a)*(rz-inner*thick));}
  const stride=n+1,layer=rings.length*stride;
  for(let k=0;k<rings.length-1;k++)for(let j=0;j<n;j++){const a=k*stride+j,b=a+stride;ix.push(a,a+1,b,a+1,b+1,b);const c=a+layer,d=b+layer;ix.push(c,d,c+1,c+1,d,d+1);}
  for(const k of [0,rings.length-1])for(let j=0;j<n;j++){const a=k*stride+j,b=a+layer;ix.push(a,a+1,b,a+1,b+1,b);}
  for(const j of [0,n])for(let k=0;k<rings.length-1;k++){const a=k*stride+j,b=a+stride;ix.push(a,a+layer,b,b,a+layer,b+layer);}
  return mesh(g,name,geometry(p,ix),mat);
}
// An individually forged polygon with a raised faceted face, a narrow chamfer and solid rear.
function panel(g:T.Group,name:string,points:V[],m:M,bulge=.009){
  const normal=new T.Vector3();
  for(let i=0;i<points.length;i++){const a=points[i]!,b=points[(i+1)%points.length]!;normal.x+=(a[1]-b[1])*(a[2]+b[2]);normal.y+=(a[2]-b[2])*(a[0]+b[0]);normal.z+=(a[0]-b[0])*(a[1]+b[1]);}
  if(Math.abs(normal.y)>Math.abs(normal.z) ? normal.y<0 : normal.z*Math.sign(bulge)<0)points=[...points].reverse();
  const c=new T.Vector3();for(const v of points)c.add(new T.Vector3(...v));c.divideScalar(points.length);
  const p:number[]=[],ix:number[]=[],border:number[]=[],bi:number[]=[];const n=points.length;
  for(const v of points){const q=new T.Vector3(...v).lerp(c,.035);p.push(q.x,q.y,q.z);}
  p.push(c.x,c.y,c.z+bulge);
  for(let i=0;i<n;i++)ix.push(i,(i+1)%n,n);
  for(let i=0;i<n;i++){const v=points[i]!,q=new T.Vector3(...v).lerp(c,.035);border.push(...v,q.x,q.y,q.z,...[v[0],v[1],v[2]-.004]);}
  for(let i=0;i<n;i++){const j=(i+1)%n;bi.push(i*3,j*3,i*3+1,i*3+1,j*3,j*3+1,i*3,j*3+2,j*3,i*3,i*3+2,j*3+2);}
  const face=geometry(p,ix).toNonIndexed();face.computeVertexNormals();mesh(g,name+' forged facets',face,m.glass);mesh(g,name+' chamfer and thickness',geometry(border,bi),m.edge);
  const back=points.map(v=>[v[0],v[1],v[2]-.004] as V);const bp=back.flat();const bidx:number[]=[];for(let i=1;i<n-1;i++)bidx.push(0,i+1,i);mesh(g,name+' inner plate',geometry(bp,bidx),m.leather);
}
function rivet(g:T.Group,name:string,x:number,y:number,z:number,m:M){const b=mesh(g,name,new T.SphereGeometry(.006,8,6),m.edge);b.scale.z=.45;b.position.set(x,y,z);}
function strap(g:T.Group,name:string,a:V,b:V,m:M,width=.015){const d=new T.Vector3(...b).sub(new T.Vector3(...a));const v=mesh(g,name,new T.BoxGeometry(width,d.length(),.007),m.leather);v.position.copy(new T.Vector3(...a).add(new T.Vector3(...b)).multiplyScalar(.5));v.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());rivet(g,name+' upper stud',...a,m);rivet(g,name+' lower stud',...b,m);}
function chevron(g:T.Group,name:string,x:number,y:number,z:number,w:number,h:number,m:M){panel(g,name,[[x-w,y+h*.42,z-.025],[x,y+h*.2,z+.012],[x+w,y+h*.42,z-.025],[x+w*.82,y-h*.05,z-.015],[x,y-h*.58,z+.019],[x-w*.82,y-h*.05,z-.015]],m,.014);}

function helm(g:T.Group,m:M){
  shell(g,'Open neck padded helmet liner',[[1.545,.094,.093],[1.65,.102,.103],[1.75,.096,.099],[1.81,.063,.066],[1.832,.007,.007]],m.leather,0,-.007, .85,Math.PI*2-.85);
  shell(g,'Angular skull and rear crown',[[1.701,.108,.112],[1.75,.108,.107],[1.805,.078,.077],[1.835,.022,.03],[1.842,.001,.001]],m.glass,0,-.005,-Math.PI,Math.PI,.005,16);
  // Eye slit is an actual gap between the brow and independently forged face visor.
  for(const s of [-1,1]){
    panel(g,'Swept brow '+s,[[0,1.833,.053],[s*.085,1.79,.059],[s*.112,1.696,.084],[0,1.673,.15]],m);
    panel(g,'Pointed cheek visor '+s,[[s*.107,1.676,.082],[s*.099,1.608,.105],[0,1.555,.148],[0,1.656,.156]],m);
    panel(g,'Cheek side articulation '+s,[[s*.112,1.696,.04],[s*.114,1.617,.035],[s*.088,1.572,.107],[s*.1,1.643,.1]],m,.004);
    strap(g,'Visor hinge leather '+s,[s*.103,1.703,.06],[s*.106,1.609,.068],m,.019);
  }
  panel(g,'Raised blade shaped crown ridge',[[0,1.861,-.025],[-.012,1.82,.075],[-.01,1.679,.153],[0,1.668,.16],[.01,1.679,.153],[.012,1.82,.075]],m);
  shell(g,'Flared articulated gorget',[[1.523,.115,.119],[1.55,.099,.104],[1.581,.093,.101]],m.glass,0,0,-Math.PI,Math.PI,.006,16);
  chevron(g,'Gorget front chevron',0,1.54,.122,.081,.048,m);
}

function plate(g:T.Group,m:M){
  shell(g,'Waist leather foundation',[[1.005,.158,.106],[1.11,.143,.111],[1.26,.182,.139],[1.36,.191,.127]],m.leather,0,-.011);
  shell(g,'Back and flanks cuirass',[[1.04,.157,.113],[1.15,.153,.124],[1.3,.197,.142],[1.395,.188,.125]],m.glass,0,-.014,.93,Math.PI*2-.93);
  for(const s of [-1,1]){
    panel(g,'Sculpted breast half '+s,[[0,1.386,.152],[s*.157,1.426,.093],[s*.192,1.325,.13],[s*.136,1.2,.117],[0,1.125,.166]],m,.029);
    strap(g,'Shoulder suspension '+s,[s*.143,1.466,.045],[s*.177,1.346,.131],m,.025);
    for(let i=0;i<3;i++){
      const x=s*(.23+i*.039),y=1.48-i*.034;
      panel(g,'Pointed overlapping shoulder '+s+' '+i,[[x-s*.056,y+.034,-.087],[x+s*.045,y+.012,-.098],[x+s*.071,y-.049,-.032],[x+s*.059,y-.057,.076],[x-s*.042,y+.008,.086]],m,.02);
      // The rear shoulder repeats the pointed forge geometry instead of ending in a flat cap.
      panel(g,'Rear shoulder leaf '+s+' '+i,[[x-s*.045,y+.012,-.079],[x+s*.057,y-.045,-.095],[x+s*.05,y-.055,-.137],[x-s*.04,y-.012,-.141]],m,-.008);
    }
    for(let i=0;i<3;i++)strap(g,'Flank buckle '+s+i,[s*.152,1.095+i*.07,.098],[s*.177,1.12+i*.07,.081],m,.013);
    for(let i=0;i<2;i++)panel(g,'Flared hip tasset '+s+i,[[s*.121,1.051-i*.066,.108],[s*.175,1.063-i*.058,.063],[s*.208, .942-i*.061,.066],[s*.139,.97-i*.068,.134]],m);
    panel(g,'Rear scapula '+s,[[s*.019,1.419,-.118],[s*.166,1.417,-.096],[s*.17,1.251,-.137],[s*.035,1.22,-.16]],m,-.012);
  }
  for(let i=0;i<4;i++)chevron(g,'Overlapping abdominal lame '+i,0,1.19-i*.065,.142,.132-i*.006,.09,m);
  shell(g,'Split high standing collar',[[1.419,.085,.078],[1.492,.075,.077]],m.glass,0,-.014,.18,Math.PI*2-.18,.006,18);
  chevron(g,'Gorget pointed breast junction',0,1.412,.133,.086,.065,m);
  for(let i=0;i<4;i++)chevron(g,'Rear lower articulated spine '+i,0,1.19-i*.06,-.14,.122,.074,m);
}

// Radial plate leaves follow the limb profile. Each leaf has its own solid bevel,
// raised keel and an angled lower edge; the leather liner remains continuous.
function wrappedLeaves(g:T.Group,name:string,x:number,z:number,rings:Ring[],m:M,start=.65,end=Math.PI*2-.65,count=7){
  for(let j=0;j<count;j++){
    const a=start+(end-start)*j/count,b=start+(end-start)*(j+1)/count,mid=(a+b)/2;
    const leaf=new T.Group();leaf.name=name+' leaf '+j;leaf.position.set(x,0,z);leaf.rotation.y=mid;g.add(leaf);
    const at=(r:Ring,t:number,dy=0):V=>[Math.sin(t-mid)*r[1],r[0]+dy,Math.cos(t-mid)*r[2]+.002];
    for(let k=0;k<rings.length-1;k++){
      const lo=rings[k]!,hi=rings[k+1]!;
      panel(leaf,name+' sculpted facet '+j+' '+k,[at(hi,a),at(hi,mid,.005),at(hi,b),at(lo,b),at(lo,mid,-.009),at(lo,a)],m,.004);
    }
  }
}
function seatedClosure(g:T.Group,name:string,x:number,z:number,y:number,rx:number,rz:number,side:number,m:M){
  const local=new T.Group();local.name=name;local.position.set(x,y,z);local.rotation.y=side*1.2;g.add(local);
  // Rotation gives the studs their actual outward-facing surface normal.
  const depth=Math.sqrt((Math.sin(1.2)*rx)**2+(Math.cos(1.2)*rz)**2);
  const band=mesh(local,name+' fitted leather tab',new T.BoxGeometry(.031,.021,.005),m.leather);band.position.z=depth+.001;
  rivet(local,name+' seated rivet',0,0,depth+.005,m);
  for(const u of [-.011,.011])line(local,name+' stitch '+u,[u,-.007,depth+.004],[u,.007,depth+.004],.0008,m.seam);
}
function greaves(g:T.Group,m:M){
  for(const s of [-1,1]){const x=s*.1143;
    shell(g,'Thigh leather sleeve '+s,[[.59,.069,.073],[.72,.086,.082],[.94,.096,.09]],m.leather,x,-.036);
    shell(g,'Calf padded sleeve '+s,[[.19,.049,.06],[.35,.064,.079],[.49,.062,.066]],m.leather,x,-.036);
    wrappedLeaves(g,'Tapered rear thigh cuisse '+s,x,-.036,[[.611,.074,.079],[.75,.087,.087],[.94,.098,.095]],m);
    panel(g,'Long pointed thigh plate '+s,[[x-.079,.938,.027],[x,.904,.069],[x+.079,.938,.027],[x+.067,.66,.033],[x,.598,.057],[x-.067,.66,.033]],m,.023);
    chevron(g,'Thigh raised branching bevel '+s,x,.863,.06,.07,.12,m);
    chevron(g,'Floating diamond knee '+s,x,.55,.052,.07,.119,m);
    for(let i=0;i<2;i++)chevron(g,'Knee sliding lame '+s+i,x,.492-i*.03,.046,.063,.052,m);
    wrappedLeaves(g,'Anatomical rear calf splints '+s,x,-.036,[[.19,.051,.064],[.285,.06,.08],[.36,.07,.087],[.458,.065,.075]],m);
    panel(g,'Tapered keeled shin '+s,[[x-.061,.452,.035],[x,.427,.071],[x+.061,.452,.035],[x+.041,.218,.029],[x,.185,.045],[x-.041,.218,.029]],m,.019);
    chevron(g,'Shin branching raised brow '+s,x,.409,.071,.052,.083,m);
    for(const [y,rx,rz] of [[.245,.058,.075],[.43,.068,.079],[.63,.077,.084],[.87,.097,.095]] as const){shell(g,'Fitted rear fastening strap '+s+y,[[y-.008,rx,rz],[y+.008,rx,rz]],m.leather,x,-.036,.95,Math.PI*2-.95,.003,16);seatedClosure(g,'Side leather hinge '+s+y,x,-.036,y,rx,rz,s,m);}
  }
}

function boots(g:T.Group,m:M){for(const s of [-1,1]){const x=s*.1143;
  shell(g,'Hollow shaped leather boot shaft '+s,[[.06,.059,.069],[.135,.054,.065],[.20,.058,.067],[.305,.067,.071]],m.leather,x,-.058);
  wrappedLeaves(g,'Faceted fitted heel counter '+s,x,-.058,[[.05,.063,.078],[.11,.065,.078],[.174,.057,.07]],m,.82,Math.PI*2-.82,7);
  wrappedLeaves(g,'Tapered shaft side and rear plates '+s,x,-.058,[[.157,.057,.069],[.224,.063,.073],[.298,.069,.076]],m,.65,Math.PI*2-.65,7);
  const footRings:Ring[]=[[.018,.065,.145,.027],[.04,.067,.151,.027],[.07,.063,.142,.022],[.102,.053,.098,-.007],[.13,.049,.071,-.037]];
  shell(g,'Shaped leather vamp '+s,footRings,m.leather,x,-.02);
  shell(g,'Layered welt sole '+s,[[.009,.067,.153,.008],[.027,.069,.154,.008]],m.leather,x);
  const sole:number[]=[x,.009,.008],soleIndices:number[]=[];
  for(let k=0;k<=24;k++){const a=k/24*Math.PI*2;sole.push(x+Math.sin(a)*.067,.009,.008+Math.cos(a)*.153);if(k<24)soleIndices.push(0,k+2,k+1);}
  mesh(g,'Closed leather outsole '+s,geometry(sole,soleIndices),m.leather);
  const heel=mesh(g,'Stacked leather heel '+s,new T.BoxGeometry(.105,.025,.09),m.leather);heel.position.set(x,.014,-.096);
  panel(g,'Shin cuff pointed plate '+s,[[x-.057,.295,-.023],[x,.288,.023],[x+.057,.295,-.023],[x+.054,.239,-.02],[x,.219,.021],[x-.054,.239,-.02]],m,.008);
  panel(g,'Fitted ankle diagonal plate '+s,[[x-.052,.231,-.02],[x,.211,.021],[x+.052,.231,-.02],[x+.048,.121,-.015],[x,.11,.032],[x-.048,.121,-.015]],m,.008);
  for(let i=0;i<3;i++){const z=.031+i*.037,y=.113-i*.017;
    panel(g,'Articulated instep band '+s+i,[[x-.059,y-.02,z-.014],[x-.043,y+.001,z-.023],[x,y+.012,z-.019],[x+.043,y+.001,z-.023],[x+.059,y-.02,z-.014],[x+.057,y-.03,z+.024],[x,y-.011,z+.032],[x-.057,y-.03,z+.024]],m,.004);
  }
  panel(g,'Pointed faceted toe cap '+s,[[x-.057,.05,.1],[x,.065,.102],[x+.057,.05,.1],[x+.046,.027,.16],[x,.024,.178],[x-.046,.027,.16]],m,.012);
  for(const [y,rx,rz] of [[.085,.064,.078],[.19,.061,.073],[.278,.068,.076]] as const)seatedClosure(g,'Boot integrated side closure '+s+y,x,-.058,y,rx,rz,s,m);
  for(let k=0;k<30;k++){const a=k/30*Math.PI*2;line(g,'Welt stitch '+s+k,[x+Math.sin(a)*.066,.03,.008+Math.cos(a)*.149],[x+Math.sin(a+.035)*.066,.03,.008+Math.cos(a+.035)*.149],.0009,m.seam);}
}}

function gloves(g:T.Group,m:M){for(const s of [-1,1]){
  // Local +Y runs from the fingers toward the forearm; rotate to native T-pose.
  const h=new T.Group();h.name='Articulated nightglass gauntlet '+s;g.add(h);h.position.set(s*.7065,1.4555,-.0654);h.rotation.z=s*Math.PI/2;
  shell(h,'Open flared leather cuff',[[.012,.035,.036],[.084,.046,.049],[.159,.064,.054]],m.leather);
  shell(h,'Rear wrist shell',[[.012,.038,.039],[.08,.049,.052],[.155,.066,.057]],m.glass,0,0,.8,Math.PI*2-.8);
  chevron(h,'Pointed cuff upper lame',0,.125,.055,.058,.061,m);chevron(h,'Pointed cuff lower lame',0,.09,.053,.051,.047,m);
  strap(h,'Diagonal wrist buckle',[-.035,.059,.04],[.037,.036,.041],m,.012);
  shell(h,'Leather palm hollow',[[.023,.034,.027],[-.035,.046,.027],[-.086,.044,.026]],m.leather);
  panel(h,'Faceted metacarpal plate',[[-.033,.017,.031],[.034,.017,.031],[.046,-.049,.031],[.033,-.077,.034],[0,-.087,.043],[-.044,-.064,.032]],m,.013);
  for(let f=0;f<4;f++){
    const x=(f-1.5)*.023,len=[.063,.083,.09,.073][f]!;
    for(let k=0;k<3;k++){const y=-.071-k*len/3,r=.0105-k*.001;
      const joint=mesh(h,'Finger '+f+' leather joint '+k,new T.CapsuleGeometry(r,len/3*.62,3,7),m.leather);joint.position.set(x,y-len/6,-.001);
      panel(h,'Finger '+f+' articulated knuckle '+k,[[x-r,y,.018],[x+r,y,.018],[x+r*.87,y-len/3+.003,.02],[x,y-len/3-.003,.024],[x-r*.87,y-len/3+.003,.02]],m,.004);
    }
  }
  const thumb=new T.Group();thumb.name='Opposing jointed thumb';h.add(thumb);thumb.position.set(.042,-.017,0);thumb.rotation.z=.55;
  for(let k=0;k<2;k++){const y=-k*.026;const b=mesh(thumb,'Thumb leather joint '+k,new T.CapsuleGeometry(.013,.02,3,8),m.leather);b.position.y=y-.013;panel(thumb,'Thumb plate '+k,[[-.014,y,.016],[.014,y,.016],[.012,y-.029,.019],[0,y-.035,.022],[-.012,y-.029,.019]],m,.003);}
  for(let i=0;i<20;i++){const a=i/20*Math.PI*2;line(h,'Cuff rim stitch '+i,[Math.sin(a)*.061,.155,Math.cos(a)*.053],[Math.sin(a+.07)*.061,.155,Math.cos(a+.07)*.053],.0009,m.seam);}
}}

export const author:ItemModelAuthor={ids,build(itemId){
  if(!ids.includes(itemId as typeof ids[number]))throw new Error('Unknown nightglass armor '+itemId);
  const g=new T.Group();g.name=itemId;const m=materials();
  if(itemId==='nightglass_helm')helm(g,m);else if(itemId==='nightglass_plate')plate(g,m);else if(itemId==='nightglass_greaves')greaves(g,m);else if(itemId==='nightglass_boots')boots(g,m);else gloves(g,m);
  g.userData.itemModel={itemId,author:'armor-nightglass',reference:`art/item-icons/generated/${itemId}.png`,description:`Nightglass ${itemId.slice(11)} forged for level 70 melee combat. Angular midnight steel armor with cold bevels, articulated plates and riveted leather lining.`,wearable:true};return g;
}};

