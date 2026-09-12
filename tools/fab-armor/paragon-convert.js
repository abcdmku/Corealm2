import * as THREE from '/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
const v=()=>new THREE.Vector3();
export async function inspect(name){
 const source=(await new GLTFLoader().loadAsync(`/.asset-cache/fab-armor/paragon/${name}.glb`)).scene;source.updateMatrixWorld(true);
 const report=[];source.traverse(mesh=>{if(!mesh.isMesh)return;const g=mesh.geometry,p=g.attributes.position,idx=g.index?.array??Array.from({length:p.count},(_,i)=>i),parent=Array.from({length:p.count},(_,i)=>i),pos=new Map();const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};const join=(a,b)=>{parent[find(a)]=find(b);};for(let i=0;i<p.count;i++){const k=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',');if(pos.has(k))join(i,pos.get(k));else pos.set(k,i);}for(let i=0;i<idx.length;i+=3){join(idx[i],idx[i+1]);join(idx[i],idx[i+2]);}const comp=new Map();for(let i=0;i<idx.length;i+=3){const key=find(idx[i]);if(!comp.has(key))comp.set(key,{triangles:[],box:new THREE.Box3(),bones:{}});const c=comp.get(key);c.triangles.push(i);for(let j=0;j<3;j++){const vi=idx[i+j];c.box.expandByPoint(v().fromBufferAttribute(p,vi).applyMatrix4(mesh.matrixWorld));if(mesh.isSkinnedMesh)for(let k=0;k<4;k++){const w=g.attributes.skinWeight.getComponent(vi,k),bn=mesh.skeleton.bones[g.attributes.skinIndex.getComponent(vi,k)].name;c.bones[bn]=(c.bones[bn]??0)+w;}}}report.push({mesh:mesh.name,materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m.name),triangles:idx.length/3,components:[...comp.values()].map(c=>({triangles:c.triangles.length,min:c.box.min.toArray(),max:c.box.max.toArray(),bones:Object.entries(c.bones).sort((a,b)=>b[1]-a[1]).slice(0,8)})).sort((a,b)=>b.triangles-a.triangles)});});return report;
}
const component = (a,i,k)=>a.getComponent(i,k);
function chunks(mesh){
 const g=mesh.geometry,p=g.attributes.position,idx=g.index?.array??Array.from({length:p.count},(_,i)=>i),parent=Array.from({length:p.count},(_,i)=>i),seen=new Map();
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},join=(a,b)=>{parent[find(a)]=find(b);};
 for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*1e5)).join(',');if(seen.has(key))join(i,seen.get(key));else seen.set(key,i);}
 for(let i=0;i<idx.length;i+=3){join(idx[i],idx[i+1]);join(idx[i],idx[i+2]);}
 const groups=new Map();for(let i=0;i<idx.length;i++){const key=find(idx[i]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(idx[i]);}return [...groups.values()];
}
export async function convert(name,gender,sourceName=name){
 const source=(await new GLTFLoader().loadAsync(`/.asset-cache/fab-armor/paragon/${sourceName}.glb`)).scene,target=(await new GLTFLoader().loadAsync(`/game/public/assets/models/character/base_${gender}.glb`)).scene;source.updateMatrixWorld(true);target.updateMatrixWorld(true);
 const src=new Map(),host=new Map();source.traverse(o=>{if(o.isBone)src.set(o.name,o);});target.traverse(o=>{if(o.isBone)host.set(o.name,o);});
 const position=(m,n)=>m.get(n).getWorldPosition(v());
 const direct=n=>n==='head'?'Head':n.replace(/_twist_\d+_/,'_');
 const mapping=b=>{let a=b;while(a?.isBone){const mapped=direct(a.name);if(host.has(mapped)){const anchor=src.get(mapped)??a;return {mapped,anchor};}a=a.parent;}throw new Error('Unmapped bone '+b.name);};
 const maps=new Map(),details=[];
 for(const b of src.values()){
 const {mapped,anchor}=mapping(b),sp=position(src,anchor.name),hp=position(host,mapped);let end;const an=anchor.name;
 for(const [a,c] of [['upperarm','lowerarm'],['lowerarm','hand'],['thigh','calf'],['calf','foot'],['foot','ball'],['hand','middle_01']])if(an.startsWith(a+'_'))end=an.replace(a,c);
 if(/^(index|middle|pinky|ring|thumb)_0[12]_/.test(an))end=an.replace(/_0([12])_/,(_,n)=>`_0${+n+1}_`);
 let scale=1,q=new THREE.Quaternion();if(end&&src.has(end)&&host.has(end)){const a=position(src,end).sub(sp),c=position(host,end).sub(hp);scale=c.length()/a.length();q.setFromUnitVectors(a.normalize(),c.normalize());}
 else if(/^(pelvis|spine_|neck_|head)/.test(an)){scale=position(host,'neck_01').sub(position(host,'pelvis')).length()/position(src,'neck_01').sub(position(src,'pelvis')).length();}
 maps.set(b.name,{mapped,rotation:q,apply:p=>p.clone().sub(sp).multiplyScalar(scale).applyQuaternion(q).add(hp)});details.push({source:b.name,target:mapped,anchor:anchor.name,scale});}
  const metalSamplers=new Map();
 function metalValue(material,uv){if(!material.metalnessMap)return material.metalness;let sample=metalSamplers.get(material);if(!sample){const image=material.metalnessMap.image,canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);sample={data:ctx.getImageData(0,0,image.width,image.height).data,width:image.width,height:image.height};metalSamplers.set(material,sample);}const texture=material.metalnessMap;texture.updateMatrix();const point=texture.transformUv(uv.clone());const x=Math.max(0,Math.min(sample.width-1,Math.floor(point.x*sample.width))),y=Math.max(0,Math.min(sample.height-1,Math.floor(point.y*sample.height)));return sample.data[(y*sample.width+x)*4+2]/255*material.metalness;}
 const bins={head:[],body:[],legs:[],hands:[],feet:[]},report={name,sourceName,gender,components:[],mapping:details,removed:[]};
 const meshes=[];source.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
 for(const mesh of meshes){const material=mesh.material,mat=material.name;
 const crownHair=(name==='mage-t50'||name==='mage-t70')&&/kwang.*hair/i.test(mat);
 if(!crownHair&&/head_skin|flesh_head|head_flesh|kwang.*head|hair|eyelash|eye|tear|mouth/i.test(mat)){report.removed.push({material:mat,reason:'source face or hair'});continue;}
 const g=mesh.geometry,p=g.attributes.position,w=g.attributes.skinWeight,j=g.attributes.skinIndex;
 for(const verts of chunks(mesh)){
 if(crownHair){let low=Infinity;for(const i of verts)low=Math.min(low,p.getY(i));if(low<position(src,'head').y){report.removed.push({material:mat,triangles:verts.length/3,reason:'long hair below headgear crown'});continue;}}
 const scores={};for(const i of verts)for(let k=0;k<4;k++){const weight=component(w,i,k),bn=mesh.skeleton.bones[component(j,i,k)].name;scores[bn]=(scores[bn]??0)+weight;}
 const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]),dominant=ranked[0][0];
 if(/sword|shield|weapon/i.test(dominant)){report.removed.push({material:mat,triangles:verts.length/3,reason:'weapon component',dominant});continue;}
 let slot=crownHair||/head|helmet/i.test(dominant)?'head':/lowerarm|hand|index|middle|ring|pinky|thumb/i.test(dominant)?'hands':/calf|foot|ball/i.test(dominant)?'feet':/thigh|pelvis|hip_|butt_|loin_|tassel|tail_flap/i.test(dominant)?'legs':'body';
  if(name==='mage-t90'&&slot==='head'){report.removed.push({material:mat,triangles:verts.length/3,reason:'back hair tie on bareheaded source',dominant});continue;}
 if(slot==='feet'&&ranked.some(([bn,weight])=>/^thigh/.test(bn)&&weight>ranked[0][1]*.2))slot='legs';
 let role=null;if(name.startsWith('mage-')&&!/skin|flesh|face|fur|hair|_Hands_/i.test(mat)){let value=0;for(const i of verts)value+=metalValue(material,new THREE.Vector2(g.attributes.uv.getX(i),g.attributes.uv.getY(i)));role=/silk/i.test(mat)?'cloth':name==='mage-t50'?'leather':value/verts.length>.3?'leather':'cloth';}
 report.components.push({material:mat,slot,dominant,triangles:verts.length/3,role});bins[slot].push({mesh,verts,role});
 }}
  if(name==='melee-t90'){
 const helm=(await new GLTFLoader().loadAsync('/.asset-cache/fab-armor/paragon/melee-t90-helmet.glb')).scene;helm.updateMatrixWorld(true);helm.traverse(m=>{if(!m.isMesh)return;const geo=m.geometry.clone(),count=geo.attributes.position.count,si=new Uint16Array(count*4),sw=new Float32Array(count*4);for(let i=0;i<count;i++)sw[i*4]=1;geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));const synthetic=new THREE.SkinnedMesh(geo,m.material);synthetic.skeleton={bones:[src.get('head')]};synthetic.matrixWorld.copy(m.matrixWorld);synthetic.matrixWorld.premultiply(new THREE.Matrix4().makeScale(1.060008,1.100383,1.139937));synthetic.matrixWorld.premultiply(new THREE.Matrix4().makeTranslation(0,1.85326797,-.01365936));bins.head.push({mesh:synthetic,verts:Array.from(geo.index?.array??Array.from({length:count},(_,i)=>i))});report.components.push({material:m.material.name,slot:'head',dominant:'head',triangles:(geo.index?.count??count)/3,placement:'Exact demo actor transform: UE relative cm (0,-1.365936,185.326797), scale (1.060008,1.139937,1.100383); exporter ConvertVector swaps Y/Z. Head rig transfer follows authored placement.'});});
 }
 const output={};for(const [slot,pieces] of Object.entries(bins)){if(!pieces.length)continue;
 const hostScene=(await new GLTFLoader().loadAsync(`/game/public/assets/models/character/base_${gender}.glb`)).scene;hostScene.updateMatrixWorld(true);const hb=[];hostScene.traverse(o=>{if(o.isBone)hb.push(o);});const ix=new Map(hb.map((b,i)=>[b.name,i]));const group=new THREE.Group(),rootBone=hb.find(b=>b.name==='root');group.add(rootBone);group.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(hb,hb.map(b=>b.matrixWorld.clone().invert()));
 const materialBins=new Map();for(const part of pieces){const key=part.mesh.uuid+part.role;if(!materialBins.has(key))materialBins.set(key,{mesh:part.mesh,role:part.role,verts:[]});materialBins.get(key).verts.push(...part.verts);}
 for(const {mesh,verts,role} of materialBins.values()){const g=mesh.geometry,pa=[],si=[],sw=[],uv=[],uvDetail=[],uvSource1=[],normals=[];
 for(const i of verts){const point=v().fromBufferAttribute(g.attributes.position,i).applyMatrix4(mesh.matrixWorld),out=v(),normal=v(),sourceNormal=v().fromBufferAttribute(g.attributes.normal,i).transformDirection(mesh.matrixWorld);let total=0;for(let k=0;k<4;k++)total+=component(g.attributes.skinWeight,i,k);for(let k=0;k<4;k++){const weight=component(g.attributes.skinWeight,i,k)/total,bone=mesh.skeleton.bones[component(g.attributes.skinIndex,i,k)],m=maps.get(bone.name);if(weight){out.addScaledVector(m.apply(point),weight);normal.addScaledVector(sourceNormal.clone().applyQuaternion(m.rotation),weight);}si.push(ix.get(m.mapped));sw.push(weight);}if(name==='mage-t90'&&/LowerClothes/.test(mesh.material.name)){
  // Source hanging cloth uses pelvis weights. Torso scaling overextended its
  // hem below the host feet; fit its vertical drop against leg height instead.
  const sourceHip=position(src,'pelvis'),hostHip=position(host,'pelvis');
  out.y=hostHip.y+(point.y-sourceHip.y)*(hostHip.y/sourceHip.y);
  const rear=1-THREE.MathUtils.smoothstep(point.z,-.19,-.07);
  const lower=1-THREE.MathUtils.smoothstep(out.y,.20,.85);
  const follow=rear*lower*.85;
  if(follow>0){
    const side=point.x>=0?'l':'r',combined=new Map(),start=sw.length-4;
    for(let k=0;k<4;k++)combined.set(si[start+k],(combined.get(si[start+k])??0)+sw[start+k]*(1-follow));
    for(const [bone,fraction] of [['thigh_'+side,.35],['calf_'+side,.65]]){const index=ix.get(bone);combined.set(index,(combined.get(index)??0)+follow*fraction);}
    const weights=[...combined].filter(([,weight])=>weight>0).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=weights.reduce((n,[,weight])=>n+weight,0);
    for(let k=0;k<4;k++){si[start+k]=weights[k]?.[0]??0;sw[start+k]=(weights[k]?.[1]??0)/sum;}
    out.z-=rear*lower*.055;
  }
  report.clothFit={material:mesh.material.name,vertical:'host pelvis-to-ground ratio',rearClearanceMeters:.055,maxLegFollow:.85,thighFraction:.35,calfFraction:.65};
}
if(slot==='head'&&name==='melee-t90'){
  // The native closed crown is lower than the host skull after rig transfer,
  // especially on the female base. Expand only its upper dome, not its jaw.
  const pivot=position(host,'Head'),fade=THREE.MathUtils.smoothstep(out.y,pivot.y+.04,pivot.y+.14);
  const vertical=gender==='female'?.18:.12,radial=gender==='female'?.10:.06;
  out.x=pivot.x+(out.x-pivot.x)*(1+radial*fade);
  out.z=pivot.z+(out.z-pivot.z)*(1+radial*fade);
  out.y=pivot.y+(out.y-pivot.y)*(1+vertical*fade);
  report.helmetFit={upperVerticalScale:1+vertical,upperRadialScale:1+radial,fadeAboveHeadMeters:[.04,.14],sourceTransformPreservedAsBaseline:true};
}
if(slot==='head'&&name.startsWith('mage-')){const pivot=position(host,'Head');out.x=pivot.x+(out.x-pivot.x)*1.08;out.z=pivot.z+(out.z-pivot.z)*1.08;out.y=pivot.y+(out.y-pivot.y)*1.07+.01;}
 if(g.attributes.uv1)uvSource1.push(g.attributes.uv1.getX(i),g.attributes.uv1.getY(i));pa.push(...out.toArray());normals.push(...normal.normalize().toArray());uvDetail.push((Math.abs(normal.x)>Math.abs(normal.z)?out.z:out.x)*3,out.y*3);uv.push(g.attributes.uv.getX(i),g.attributes.uv.getY(i));}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pa,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));if(uvSource1.length)geo.setAttribute('uv1',new THREE.Float32BufferAttribute(uvSource1,2));const material=mesh.material.clone();if(name.startsWith('mage-')&&role){if(uvSource1.length){geo.setAttribute('uv2',new THREE.Float32BufferAttribute(uvSource1,2));for(const [key,val] of Object.entries(material))if(val?.isTexture&&val.channel===1){material[key]=val.clone();material[key].channel=2;}}geo.setAttribute('uv1',new THREE.Float32BufferAttribute(uvDetail,2));material.name+='__fab_'+role;material.userData.fabRole=role;if(name==='mage-t50'){material.metalness=0;material.roughness=.9;material.metalnessMap=null;}}const result=new THREE.SkinnedMesh(geo,material);result.name=slot+'_'+mesh.material.name;group.add(result);result.bind(skeleton,new THREE.Matrix4());}
 group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(group),bytes=await new GLTFExporter().parseAsync(group,{binary:true,maxTextureSize:1024});output[slot]={bytes:await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob([bytes]));}),bounds:{min:box.min.toArray(),max:box.max.toArray()}};
 }
 report.missingSlots=Object.keys(bins).filter(k=>!bins[k].length);return {output,report};
}



















