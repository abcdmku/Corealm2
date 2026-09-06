import * as THREE from 'three';

/** Decorate only the complete Quaternius Wasp. Caller retains its original animation library. */
export function applyFantasyWasp(source) {
  const mesh = source.getObjectByName('Wasp');
  if (!mesh?.isSkinnedMesh || !Array.isArray(mesh.material)) throw new Error('Expected complete skinned Quaternius Wasp');
  if (mesh.userData.fantasyWasp) throw new Error('Fantasy Wasp already applied');
  const geometry = mesh.geometry.clone(), materials = mesh.material.map(m => m.clone());
  const wingMaterial = materials.findIndex(m => m.name === 'LightBlue');
  const bronzeMaterial = materials.findIndex(m => m.name === 'Orange');
  if (wingMaterial < 0 || bronzeMaterial < 0) throw new Error('Original Wasp material identity mismatch');
  const originalCount = geometry.attributes.position.count, originalTriangles = (geometry.index?.count ?? originalCount) / 3;
  const materialByVertex = new Int16Array(originalCount).fill(-1), originalIndices = geometry.index ? Array.from(geometry.index.array) : Array.from({length: originalCount}, (_, i) => i);
  const trianglesByMaterial = materials.map(() => []);
  for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i++) {
    const vertex = originalIndices[i];
    if (materialByVertex[vertex] !== -1 && materialByVertex[vertex] !== group.materialIndex) throw new Error('Shared source vertex spans incompatible materials');
    materialByVertex[vertex] = group.materialIndex;
    trianglesByMaterial[group.materialIndex].push(vertex);
  }
  const positions = Array.from(geometry.attributes.position.array), normals = Array.from(geometry.attributes.normal.array);
  const joints = Array.from(geometry.attributes.skinIndex.array), weights = Array.from(geometry.attributes.skinWeight.array), colors = [];
  const sourceUvs = geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : null;
  const v = (i) => new THREE.Vector3().fromArray(positions, i * 3);
  const wings = new Map();
  for (let i = 0; i < originalCount; i++) if (materialByVertex[i] === wingMaterial) {
    const boneIndex = joints[i * 4], boneName = mesh.skeleton.bones[boneIndex].name;
    if (!/^Wing[LR]$/.test(boneName) || weights[i * 4] !== 1) throw new Error('Source wing must retain its original rigid wing joint');
    if (!wings.has(boneIndex)) wings.set(boneIndex, []);
    wings.get(boneIndex).push(i);
  }
  const frames = new Map(); let changedWingVertices = 0, surfaceProjectionMisses = 0;
  for (const [boneIndex, vertices] of wings) {
    const unique = [...new Map(vertices.map(i => [v(i).toArray().map(n => n.toFixed(6)).join(','), v(i)])).values()];
    const center = unique.reduce((a,p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / unique.length);
    const root = unique.reduce((a,p) => p.x > a.x ? p : a).clone();
    // PCA supplies a stable membrane plane in the source mesh's bind coordinates.
    const covariance = Array.from({length:3}, () => [0,0,0]);
    for (const p of unique) {const d = p.clone().sub(center).toArray(); for(let a=0;a<3;a++)for(let b=0;b<3;b++)covariance[a][b]+=d[a]*d[b];}
    const multiply = a => new THREE.Vector3(...covariance.map(row => row[0]*a.x+row[1]*a.y+row[2]*a.z));
    let axis = center.clone().sub(root).normalize();for(let i=0;i<30;i++)axis=multiply(axis).normalize();if(axis.dot(center.clone().sub(root))<0)axis.negate();
    let lateral = new THREE.Vector3(0,0,1).addScaledVector(axis,-axis.z).normalize();for(let i=0;i<30;i++){lateral=multiply(lateral);lateral.addScaledVector(axis,-lateral.dot(axis)).normalize();}
    const normal = new THREE.Vector3().crossVectors(axis,lateral).normalize();if(normal.z<0){normal.negate();lateral.negate();}
    const length = Math.max(...unique.map(p=>p.clone().sub(root).dot(axis)));
    const width = Math.max(...unique.map(p=>Math.abs(p.clone().sub(root).dot(lateral))));
    const project = p => {const d=p.clone().sub(root);return {s:d.dot(axis)/length,t:d.dot(lateral),h:d.dot(normal)};};
    // Only distal membrane contour changes; roots and all non-wing source geometry stay exact.
    for(const i of vertices){const p=v(i),q=project(p),distal=THREE.MathUtils.smoothstep(q.s,.48,.95),tip=THREE.MathUtils.smoothstep(q.s,.83,1);
      const scallop=1-.055*distal*(.5+.5*Math.cos(q.s*Math.PI*8));
      p.addScaledVector(lateral,q.t*(scallop-1)-q.t*.055*tip).addScaledVector(axis,length*.025*tip);
      const old=v(i);if(old.distanceToSquared(p)>1e-16)changedWingVertices++;p.toArray(positions,i*3);
    }
    const triangles=[];const ids=trianglesByMaterial[wingMaterial];for(let k=0;k<ids.length;k+=3)if(joints[ids[k]*4]===boneIndex)triangles.push(ids.slice(k,k+3).map(i=>project(v(i))));
    function section(s){const ts=[];for(const tri of triangles)for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3];if((s-a.s)*(s-b.s)<=0&&Math.abs(a.s-b.s)>1e-9)ts.push(a.t+(b.t-a.t)*(s-a.s)/(b.s-a.s));}return ts.length?[Math.min(...ts),Math.max(...ts)]:[0,0];}
    function surface(s,t,side){let height=side>0?-Infinity:Infinity;for(const tri of triangles){const [a,b,c]=tri,den=(b.t-c.t)*(a.s-c.s)+(c.s-b.s)*(a.t-c.t);if(Math.abs(den)<1e-10)continue;const u=((b.t-c.t)*(s-c.s)+(c.s-b.s)*(t-c.t))/den,w=((c.t-a.t)*(s-c.s)+(a.s-c.s)*(t-c.t))/den,z=1-u-w;if(Math.min(u,w,z)<-.0001)continue;const h=u*a.h+w*b.h+z*c.h;height=side>0?Math.max(height,h):Math.min(height,h);}if(!Number.isFinite(height))surfaceProjectionMisses++;return Number.isFinite(height)?height:0;}
    frames.set(boneIndex,{root,axis,lateral,normal,length,width,project,section,surface});
  }
  const palettes={Yellow:[0x28584d,0x85ad7b],Black:[0x111f25,0x35504d],Orange:[0x795129,0xcfa05e]};
  for(let i=0;i<originalCount;i++){
    const name=materials[materialByVertex[i]].name,p=v(i);let color;
    if(materialByVertex[i]===wingMaterial){const f=frames.get(joints[i*4]),q=f.project(p),bounds=f.section(q.s),lateral=(q.t-bounds[0])/Math.max(.001,bounds[1]-bounds[0]);
      color=new THREE.Color(0x547e79).lerp(new THREE.Color(0xb8c5a1),.28+.52*Math.sin(Math.min(1,q.s)*Math.PI));
      const edge=THREE.MathUtils.smoothstep(Math.abs(lateral-.5),.30,.50);color.lerp(new THREE.Color(0xbd9454),edge*.63);
      const eye=Math.sqrt(((q.s-.76)/.15)**2+((lateral-.64)/.28)**2);if(eye<1.2)color.lerp(new THREE.Color(eye<.55?0x365c62:0xbfa768),.54*(1-THREE.MathUtils.smoothstep(eye,1,1.2)));
    }else{const palette=palettes[name];if(!palette)throw new Error('Unexpected source material '+name);const dorsal=THREE.MathUtils.clamp(.34+.40*(p.z/3.6)+.23*(1-Math.abs(p.y)/.67),0,1);color=new THREE.Color(palette[0]).lerp(new THREE.Color(palette[1]),dorsal);}
    colors.push(color.r,color.g,color.b);
  }
  let veinTriangles=0,veinStrands=0;
  function addVein(frame,boneIndex,side,s0,s1,startFraction,endFraction){
    const points=[];for(let i=0;i<=8;i++){const t=i/8,s=THREE.MathUtils.lerp(s0,s1,t),edges=frame.section(s),fraction=THREE.MathUtils.lerp(startFraction,endFraction,t*t*(3-2*t)),lateral=THREE.MathUtils.lerp(edges[0],edges[1],fraction),h=frame.surface(s,lateral,side);points.push(frame.root.clone().addScaledVector(frame.axis,s*frame.length).addScaledVector(frame.lateral,lateral).addScaledVector(frame.normal,h+side*.003));}
    const tube=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),8,.0055,4,false).toNonIndexed(),offset=positions.length/3;
    for(let i=0;i<tube.attributes.position.count;i++){const p=new THREE.Vector3().fromBufferAttribute(tube.attributes.position,i),n=new THREE.Vector3().fromBufferAttribute(tube.attributes.normal,i);positions.push(...p.toArray());normals.push(...n.toArray());joints.push(boneIndex,0,0,0);weights.push(1,0,0,0);const c=new THREE.Color(0x997c42);colors.push(c.r,c.g,c.b);if(sourceUvs)sourceUvs.push(0,0);trianglesByMaterial[bronzeMaterial].push(offset+i);}
    veinTriangles+=tube.attributes.position.count/3;veinStrands++;
  }
  for(const [boneIndex,frame]of frames)for(const side of [-1,1]){
    addVein(frame,boneIndex,side,.08,.97,.5,.5);
    for(let branch=0;branch<3;branch++)for(const edge of [.07,.93])addVein(frame,boneIndex,side,.22+branch*.17,.50+branch*.19,.5,edge);
  }
  let changedOriginalTriangles=0;for(let i=0;i<originalIndices.length;i+=3)if(originalIndices.slice(i,i+3).some(vertex=>positions[vertex*3]!==geometry.attributes.position.array[vertex*3]||positions[vertex*3+1]!==geometry.attributes.position.array[vertex*3+1]||positions[vertex*3+2]!==geometry.attributes.position.array[vertex*3+2]))changedOriginalTriangles++;
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));if(sourceUvs)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(sourceUvs,2));
  // Grouping by existing material keeps this decoration at four material submissions.
  geometry.clearGroups();let start=0;const indices=[];for(let i=0;i<trianglesByMaterial.length;i++){const list=trianglesByMaterial[i];indices.push(...list);geometry.addGroup(start,list.length,i);start+=list.length;}geometry.setIndex(indices);
  // Recompute only moved wing normals. Preserve all authored body normals exactly.
  const previousNormals=geometry.attributes.normal.array.slice();geometry.computeVertexNormals();for(let i=0;i<originalCount;i++)if(materialByVertex[i]!==wingMaterial)for(let k=0;k<3;k++)geometry.attributes.normal.array[i*3+k]=previousNormals[i*3+k];geometry.computeBoundingBox();geometry.computeBoundingSphere();
  for(const material of materials){material.color.set(0xffffff);material.vertexColors=true;material.userData.fantasyPbr=material.name==='LightBlue'?{roughness:.48,metalness:.08}:material.name==='Orange'?{roughness:.43,metalness:.32}:{roughness:.51,metalness:.19};}
  mesh.geometry=geometry;mesh.material=materials;
  const report={design:'Jade and bronze marsh wasp with amber-edged, lightly scalloped pointed membranes and paired branching wing veins',sourceBodyPreserved:true,sourceRigPreserved:true,sourceAnimationPreserved:true,sourceUvState:sourceUvs?'Original UVs retained':'Source has no UV attribute; vertex colors used',originalVertices:originalCount,originalTriangles,changedOriginalVertices:changedWingVertices,changedOriginalTriangles,vertexColorVertices:positions.length/3,changedOriginalRegion:'Wing membrane positions and wing normals only; body positions/normals and all original skin influences unchanged',addedVertices:positions.length/3-originalCount,addedTriangles:veinTriangles,veinStrands,surfaceProjectionMisses,finalVertices:positions.length/3,finalTriangles:indices.length/3,materialGroups:geometry.groups.length,materialPbr:materials.map(m=>({name:m.name,...m.userData.fantasyPbr})),transmission:false,addedTextures:0};
  mesh.userData.fantasyWasp=report;return report;
}
