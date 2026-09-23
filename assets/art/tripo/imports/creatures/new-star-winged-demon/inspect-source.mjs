import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const sourcePath='assets/art/tripo/exports/c6dd592c-41cc-469a-b889-a3b8182909d4.glb';
const outputDir='assets/art/tripo/imports/creatures/new-star-winged-demon';
await mkdir(outputDir,{recursive:true});
const bytes=await readFile(sourcePath);
const root=(await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes)).getRoot();
const mesh=root.listMeshes()[0], primitive=mesh?.listPrimitives()[0], skin=root.listSkins()[0];
if(!mesh||!primitive||!skin)throw new Error('Source must have one mesh primitive and a skin.');
const pos=primitive.getAttribute('POSITION').getArray(), normal=primitive.getAttribute('NORMAL').getArray(), uv=primitive.getAttribute('TEXCOORD_0').getArray(), idx=primitive.getIndices().getArray();
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
for(let i=0;i<pos.length;i+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],pos[i+a]);max[a]=Math.max(max[a],pos[i+a]);}
const joints=primitive.getAttribute('JOINTS_0')?.getArray(),weights=primitive.getAttribute('WEIGHTS_0')?.getArray();
const perJoint=skin.listJoints().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName()??null,vertices:0,totalWeight:0}));
if(joints&&weights)for(let v=0;v<weights.length/4;v++)for(let k=0;k<4;k++){const w=weights[v*4+k];if(w>1e-6){const j=joints[v*4+k];perJoint[j].vertices++;perJoint[j].totalWeight+=w;}}
const textureRows=[];
for(const t of root.listTextures()){
 const image=t.getImage(),m=await sharp(image).metadata();
 textureRows.push({name:t.getName(),mime:t.getMimeType(),width:m.width,height:m.height,bytes:image.length,sha256:createHash('sha256').update(image).digest('hex')});
}
const bindArray=skin.getInverseBindMatrices()?.getArray()??[];
const maxAbsInverseBind=bindArray.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
const report={source:{file:sourcePath,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length},scene:root.listScenes()[0]?.getName(),meshCount:root.listMeshes().length,primitiveCount:mesh.listPrimitives().length,meshNode:root.listNodes().find(n=>n.getMesh()===mesh)?.getName(),vertices:pos.length/3,triangles:idx.length/3,bounds:{min,max,size:max.map((v,i)=>v-min[i])},normals:normalsLength(normal),uvPairs:uv.length/2,skin:{name:skin.getName(),joints:perJoint.length,weightedVertices:weights?weights.length/4:0,perJoint,maxAbsInverseBind,maxAbsInverseBindFinite:Number.isFinite(maxAbsInverseBind)},animations:root.listAnimations().map(a=>a.getName()),materials:root.listMaterials().map(m=>({name:m.getName(),baseColor:m.getBaseColorFactor(),metalness:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),baseTexture:m.getBaseColorTexture()?.getName(),mrTexture:m.getMetallicRoughnessTexture()?.getName(),normalTexture:m.getNormalTexture()?.getName(),emissive:m.getEmissiveFactor(),emissiveTexture:m.getEmissiveTexture()?.getName()})),textures:textureRows};
function normalsLength(arr){let min=Infinity,max=0,avg=0;for(let i=0;i<arr.length;i+=3){const l=Math.hypot(arr[i],arr[i+1],arr[i+2]);min=Math.min(min,l);max=Math.max(max,l);avg+=l;}return {min,max,mean:avg/(arr.length/3)};}
await writeFile(`${outputDir}/source-inspection.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({source:report.source,vertices:report.vertices,triangles:report.triangles,bounds:report.bounds,skin:{joints:report.skin.joints,maxAbsInverseBind:report.skin.maxAbsInverseBind,perJoint:report.skin.perJoint.filter(j=>j.vertices)},materials:report.materials,textures:report.textures},null,2));
