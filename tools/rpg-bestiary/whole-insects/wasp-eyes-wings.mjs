import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { KHRMaterialsClearcoat, KHRMaterialsIridescence } from '@gltf-transform/extensions';

export function finishWasp(doc, wingTexture) {
  const mesh=doc.getRoot().listMeshes()[0], buffer=doc.getRoot().listBuffers()[0];
  let eyes=mesh.listPrimitives().find(p=>p.getMaterial().getName()==='wasp_dark_eyes');
  if(!eyes) {
    const eyeIndices=[];
    let template;
    for(const body of mesh.listPrimitives().filter(p=>/_(Yellow|Black)$/.test(p.getMaterial().getName()))) {
      const pos=body.getAttribute('POSITION'), remaining=[];
      for(const i of body.getIndices().getArray()) {
        const p=new Vector3().fromArray(pos.getArray(),i*3);
        // Original paired spherical eye shells, radius 0.228, centred on the head.
        const center=new Vector3(1.08771772,Math.sign(p.y)*0.39620486,2.91503070);
        const radius=p.distanceTo(center);
        if(radius>0.224 && radius<0.231) {
          p.sub(center).multiplyScalar(.42).add(center);
          pos.setElement(i,p.toArray()); eyeIndices.push(i); template=body;
        } else remaining.push(i);
      }
      body.setIndices(doc.createAccessor('body_without_eyes').setType('SCALAR').setArray(new Uint16Array(remaining)).setBuffer(buffer));
    }
    assert.equal(eyeIndices.length,2880,'Only the two source eye shells may resize');
    eyes=doc.createPrimitive();
    for(const semantic of template.listSemantics()) if(semantic!=='COLOR_0') eyes.setAttribute(semantic,template.getAttribute(semantic));
    eyes.setIndices(doc.createAccessor('paired_eyes').setType('SCALAR').setArray(new Uint16Array(eyeIndices)).setBuffer(buffer));
    const material=doc.createMaterial('wasp_dark_eyes').setBaseColorFactor([1,1,1,1]).setRoughnessFactor(.28).setMetallicFactor(.08);
    eyes.setMaterial(material);mesh.addPrimitive(eyes);
  }
  const eyeColors=new Float32Array(eyes.getAttribute('POSITION').getCount()*3).fill(1);
  for(const i of eyes.getIndices().getArray()) {
    const n=eyes.getAttribute('NORMAL').getElement(i,[]), facing=Math.abs(n[1]);
    const colour=facing>.93?[.006,.002,.012]:facing>.58?[.075,.012,.024]:[.025,.008,.05];
    eyeColors.set(colour,i*3);
  }
  eyes.setAttribute('COLOR_0',doc.createAccessor('dark_eye_surface').setType('VEC3').setArray(eyeColors).setBuffer(buffer));
  const wing=mesh.listPrimitives().find(p=>/_LightBlue$/.test(p.getMaterial().getName()));
  assert(wing,'Source membranes must exist');
  const pos=wing.getAttribute('POSITION'), skin=wing.getAttribute('JOINTS_0'), groups=new Map();
  for(const i of wing.getIndices().getArray()) {const bone=skin.getElement(i,[])[0],ids=groups.get(bone)??[];ids.push(i);groups.set(bone,ids);}
  // Veins were added as separate triangles bound exclusively to the wing joints.
  const wingBones=new Set(groups.keys());
  for(const trim of mesh.listPrimitives().filter(p=>/_Orange$/.test(p.getMaterial().getName()))) {
    const joints=trim.getAttribute('JOINTS_0'), kept=[];
    const indices=trim.getIndices().getArray();
    for(let t=0;t<indices.length;t+=3) {
      const tri=Array.from(indices.slice(t,t+3));
      if(!tri.every(i=>wingBones.has(joints.getElement(i,[])[0]))) kept.push(...tri);
    }
    trim.setIndices(doc.createAccessor('claws_without_wing_veins').setType('SCALAR').setArray(new Uint16Array(kept)).setBuffer(buffer));
  }
  const uv=new Float32Array(pos.getCount()*2);
  for(const ids of groups.values()) {
    const points=ids.map(i=>new Vector3().fromArray(pos.getArray(),i*3));
    const center=points.reduce((s,p)=>s.add(p),new Vector3()).multiplyScalar(1/points.length);
    const cov=Array.from({length:3},()=>[0,0,0]);
    for(const p of points){const q=p.clone().sub(center).toArray();for(let a=0;a<3;a++)for(let b=0;b<3;b++)cov[a][b]+=q[a]*q[b];}
    const mul=p=>new Vector3(...cov.map(r=>r[0]*p.x+r[1]*p.y+r[2]*p.z));
    let axis=new Vector3(1,.3,.2).normalize();for(let n=0;n<32;n++)axis=mul(axis).normalize();
    let side=new Vector3(.1,1,.3);side.addScaledVector(axis,-side.dot(axis)).normalize();
    for(let n=0;n<32;n++){side=mul(side);side.addScaledVector(axis,-side.dot(axis)).normalize();}
    const projected=points.map(p=>{const q=p.clone().sub(center);return [q.dot(axis),q.dot(side)];});
    const min=[0,1].map(a=>Math.min(...projected.map(p=>p[a]))),max=[0,1].map(a=>Math.max(...projected.map(p=>p[a])));
    ids.forEach((i,k)=>uv.set(projected[k].map((n,a)=>(n-min[a])/(max[a]-min[a])),i*2));
  }
  wing.setAttribute('TEXCOORD_0',doc.createAccessor('wing_planar_uvs').setType('VEC2').setArray(uv).setBuffer(buffer));
  wing.setAttribute('COLOR_0',null);
  const coat=doc.createExtension(KHRMaterialsClearcoat).createClearcoat().setClearcoatFactor(.7).setClearcoatRoughnessFactor(.18);
  const iridescence=doc.createExtension(KHRMaterialsIridescence).createIridescence().setIridescenceFactor(.85).setIridescenceIOR(1.3).setIridescenceThicknessMinimum(220).setIridescenceThicknessMaximum(420);
  wing.getMaterial().setBaseColorTexture(wingTexture).setBaseColorFactor([.8,.9,1,.48]).setAlphaMode('BLEND').setDoubleSided(true).setRoughnessFactor(.25).setMetallicFactor(.16)
    .setExtension('KHR_materials_clearcoat',coat).setExtension('KHR_materials_iridescence',iridescence);
  for(const p of mesh.listPrimitives()) if(p.getExtras().waspRearWings) {mesh.removePrimitive(p);p.dispose();}
  const sourceIds=Array.from(wing.getIndices().getArray()), rear=doc.createPrimitive().setMaterial(wing.getMaterial()).setExtras({waspRearWings:true});
  const roots=new Map();
  for(const [bone,ids] of groups) roots.set(bone,ids.map(i=>new Vector3().fromArray(pos.getArray(),i*3)).reduce((a,b)=>a.x>b.x?a:b));
  const rotationAxis=new Vector3(0,1,0),angle=-.55;
  for(const semantic of wing.listSemantics()) {
    const source=wing.getAttribute(semantic),size=source.getElementSize();
    const array=new (source.getArray().constructor)(sourceIds.length*size);
    sourceIds.forEach((id,k)=> {
      let value=source.getElement(id,[]);
      if(semantic==='POSITION') {
        const root=roots.get(skin.getElement(id,[])[0]);
        value=new Vector3(...value).sub(root).multiplyScalar(.78).applyAxisAngle(rotationAxis,angle).add(root).add(new Vector3(-.04,0,-.035)).toArray();
      } else if(semantic==='NORMAL') value=new Vector3(...value).applyAxisAngle(rotationAxis,angle).toArray();
      array.set(value,k*size);
    });
    rear.setAttribute(semantic,doc.createAccessor('rear_wing_'+semantic).setType(source.getType()).setArray(array).setBuffer(buffer));
  }
  rear.setIndices(doc.createAccessor('rear_wing_triangles').setType('SCALAR').setArray(Uint16Array.from(sourceIds,(_,i)=>i)).setBuffer(buffer));
  mesh.addPrimitive(rear);
  return {eyes:{scale:.42,colour:'dark purple with muted wine-red iris'},wings:{pairs:2,rearScale:.78,rearAngleRadians:angle,opacity:.48,iridescence:.85,texture:'wasp-wing-pearl.png'}};
}




