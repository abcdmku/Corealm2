import * as THREE from '/node_modules/three/build/three.module.js';
import { FBXLoader } from '/node_modules/three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';

const base = '/.asset-cache/fab-armor/lowpoly/';
const v = () => new THREE.Vector3();
async function mask(name) {
  const image = await new Promise((resolve,reject) => {const i = new Image(); i.onload=()=>resolve(i);i.onerror=reject;i.src=base+name;});
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const data=ctx.getImageData(0,0,image.width,image.height).data;
  return (u,w) => {const x=Math.max(0,Math.min(image.width-1,Math.floor(u*image.width))),y=Math.max(0,Math.min(image.height-1,Math.floor((1-w)*image.height)));return Array.from(data.slice((y*image.width+x)*4,(y*image.width+x)*4+3));};
}
export async function convert(gender,part) {
  const source = await new FBXLoader().loadAsync(base+`SK_${gender}_Armor_05_C_${part}.fbx`);
  const target=(await new GLTFLoader().loadAsync(`/game/public/assets/models/character/base_${gender.toLowerCase()}.glb`)).scene;
  source.updateMatrixWorld(true);target.updateMatrixWorld(true);
  const srcBones=new Map(),hostBones=new Map();
  source.traverse(o=>{if(o.isBone)srcBones.set(o.name,o);});
  target.traverse(o=>{if(o.isBone)hostBones.set(o.name,o);});
  const pos=(map,name)=>map.get(name).getWorldPosition(v());
  const sourcePos=name=>pos(srcBones,name).multiplyScalar(.01);
  const hostPos=name=>pos(hostBones,name);
  const mapName = name => {
    if(name==='head')return 'Head';
    if(name==='spine_04'||name==='spine_05')return 'spine_03';
    if(name==='neck_02')return 'neck_01';
    if(name.includes('_twist_'))return name.replace(/_twist_\d+_/,'_');
    if(name.includes('_metacarpal_'))return name.replace(/\w+_metacarpal_/,'hand_');
    if(name.startsWith('ik_'))return name.includes('foot')?'root':'root';
    return name;
  };
  const mappings=[];
  const transfer=name=>{
    const mapped=mapName(name);if(!hostBones.has(mapped))throw new Error(`Unmapped ${name}`);
    let anchor=name;
    if(name.includes('_twist_'))anchor=mapped;
    if(name.includes('_metacarpal_'))anchor=mapped;
    const sp=sourcePos(anchor), hp=hostPos(mapped);
    let rotation=new THREE.Quaternion(),scale=1;
    let end;
    if(anchor.startsWith('upperarm_'))end=anchor.replace('upperarm','lowerarm');
    if(anchor.startsWith('lowerarm_'))end=anchor.replace('lowerarm','hand');
    if(anchor.startsWith('thigh_'))end=anchor.replace('thigh','calf');
    if(anchor.startsWith('calf_'))end=anchor.replace('calf','foot');
    if(anchor.startsWith('foot_'))end=anchor.replace('foot','ball');
    if(anchor.startsWith('hand_'))end=anchor.replace('hand','middle_01');
    if(/^(index|middle|pinky|ring|thumb)_0[12]_/.test(anchor))end=anchor.replace(/_0([12])_/,(_,n)=>`_0${+n+1}_`);
    if(end && srcBones.has(end)&&hostBones.has(end)){
      const sa=sourcePos(end).sub(sp),ha=hostPos(end).sub(hp);
      scale=ha.length()/sa.length();rotation.setFromUnitVectors(sa.normalize(),ha.normalize());
    }else if(/^spine_|^neck_/.test(anchor)){
      const a=sourcePos('pelvis'),b=sourcePos('neck_01'),ta=hostPos('pelvis'),tb=hostPos('neck_01');
      const t=(sp.y-a.y)/(b.y-a.y);hp.copy(ta).lerp(tb,t);
    }
    mappings.push({source:name,host:mapped,sourceAnchor:anchor,scale});
    return {mapped,apply:p=>p.clone().sub(sp).multiplyScalar(scale).applyQuaternion(rotation).add(hp)};
  };
  const masks={cloth:await mask('PT_Armors_Cloth_Mask_01.png'),leather:await mask('PT_Armors_Leather_Mask_01.png'),trim:await mask('PT_Armors_Metal_Mask_01.png'),skin:await mask('PT_Armors_Skin_Eye_Hair_Mask_01.png')};
  const samples={},counts={cloth:0,leather:0,trim:0,skinRemoved:0,skin:0};
  const output=new THREE.Group();output.name=`fab_lowpoly_${gender.toLowerCase()}_${part}`;
  const hostRoot=hostBones.get('root');output.add(hostRoot);output.updateMatrixWorld(true);
  const bones=[...hostBones.values()],indices=new Map(bones.map((b,i)=>[b.name,i]));
  const skeleton=new THREE.Skeleton(bones,bones.map(b=>b.matrixWorld.clone().invert()));
  const meshes=[];source.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
  for(const mesh of meshes){
    const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    const transforms=mesh.skeleton.bones.map(b=>transfer(b.name));
    const positions=geo.attributes.position,weights=geo.attributes.skinWeight,joints=geo.attributes.skinIndex,uv=geo.attributes.uv;
    const buckets={cloth:[],leather:[],trim:[],skin:[]};
    for(let i=0;i<positions.count;i+=3){
      const u=(uv.getX(i)+uv.getX(i+1)+uv.getX(i+2))/3,w=(uv.getY(i)+uv.getY(i+1)+uv.getY(i+2))/3;
      const scores=Object.fromEntries(Object.entries(masks).map(([k,sample])=>[k,255-Math.min(...sample(u,w))]));
      const region=Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];
      const kind=region[1]>80?region[0]:'cloth';
      const key=`${u.toFixed(3)},${w.toFixed(3)}`;
      samples[key]??={uv:[u,w],scores,classification:kind,triangles:0};samples[key].triangles++;
      if(kind==='skin' && part==='helmet'){counts.skinRemoved++;continue;}
      counts[kind]++;buckets[kind].push(i,i+1,i+2);
    }
    const warped=[];
    for(let i=0;i<positions.count;i++){
      const p=v().fromBufferAttribute(positions,i).applyMatrix4(mesh.bindMatrix).multiplyScalar(.01),out=v();
      for(let k=0;k<4;k++){const weight=weights.array[i*4+k];if(weight>0)out.addScaledVector(transforms[joints.array[i*4+k]].apply(p),weight);}
      // The host female skull is broader across the crown than the source head.
      // Keep the neck seam fixed while giving the hood actual cloth clearance.
      if(gender==='Female' && part==='helmet'){
        const pivot=hostPos('Head');
        const fade=THREE.MathUtils.smoothstep(out.y,pivot.y-.035,pivot.y+.065);
        out.x=pivot.x+(out.x-pivot.x)*(1+.10*fade);
        out.z=pivot.z+(out.z-pivot.z)*(1+.10*fade);
        if(out.y>pivot.y)out.y=pivot.y+(out.y-pivot.y)*(1+.14*fade);
      }
      // The modular source trousers stop at the low waist. Imported torso hems
      // are shorter, so extend the existing upper cloth into their overlap zone.
      // Preserve the crotch and all lower-leg vertices and retain every face.
      if(part==='legs'){
        const waist=hostPos('pelvis').y;
        out.y+=.075*THREE.MathUtils.smoothstep(out.y,waist-.16,waist-.015);
      }
      warped.push(out);
    }
    for(const [kind,verts] of Object.entries(buckets)){
      if(!verts.length)continue;
      const p=[],si=[],sw=[],oldUV=[],newUV=[];
      for(let t=0;t<verts.length;t+=3){
        const a=warped[verts[t]],b=warped[verts[t+1]],c=warped[verts[t+2]];
        const normal=v().crossVectors(b.clone().sub(a),c.clone().sub(a));
        const axis=Math.abs(normal.z)>=Math.max(Math.abs(normal.x),Math.abs(normal.y))?'z':Math.abs(normal.x)>Math.abs(normal.y)?'x':'y';
        for(let k=0;k<3;k++){
          const i=verts[t+k],vertex=warped[i];p.push(...vertex.toArray());oldUV.push(uv.getX(i),uv.getY(i));
          newUV.push((axis==='x'?vertex.z:vertex.x)*3,(axis==='y'?vertex.z:vertex.y)*3);
          for(let j=0;j<4;j++){si.push(indices.get(transforms[joints.array[i*4+j]].mapped));sw.push(weights.array[i*4+j]);}
        }
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(newUV,2));geometry.setAttribute('uv1',new THREE.Float32BufferAttribute(oldUV,2));
      geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4));geometry.computeVertexNormals();
      const material=new THREE.MeshStandardMaterial({name:`fab_${kind}`,color:kind==='cloth'?0x42334e:kind==='leather'?0x563a27:kind==='skin'?0xb98566:0xad9561,roughness:kind==='trim'?.6:.92,metalness:kind==='trim'?.25:0,side:THREE.DoubleSide});
      const result=new THREE.SkinnedMesh(geometry,material);result.name=`${part}_${kind}`;output.add(result);result.bind(skeleton,new THREE.Matrix4());
    }
  }
  output.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(output);
  const report={gender,part,counts,fitAdjustment:gender==='Female'&&part==='helmet'?{pivot:'Head',radialScale:1.10,upperVerticalScale:1.14,necklineFadeMeters:[-.035,.065]}:part==='legs'?{pivot:'pelvis',upperWaistLiftMeters:.075,waistFadeMeters:[-.16,-.015]}:null,mappings:[...new Map(mappings.map(m=>[m.source,m])).values()],samples:Object.values(samples),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},method:'Per-weight rest-space point transfer with source centimeter conversion, bone-segment swing/scale, mapped host skeleton and inverses. Native packed RGB masks classify material and remove source skin. Source UV retained as TEXCOORD_1; per-face planar meter-space UV0 at 3 repeats/meter.'};
  const buffer=await new GLTFExporter().parseAsync(output,{binary:true,onlyVisible:true});
  return {report,bytes:Array.from(new Uint8Array(buffer))};
}

