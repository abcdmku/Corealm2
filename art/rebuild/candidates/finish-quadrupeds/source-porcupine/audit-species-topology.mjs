import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Vector3} from 'three';
import {adaptSourcePoint} from './porcupine-surface.mjs';
const dir=new URL('./',import.meta.url),mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8')),doc=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(new URL('cdmir-rat-native.glb',dir).pathname.replace(/^\/(\w:)/,'$1'));
const meshes={};for(const node of doc.getRoot().listNodes())if(node.getMesh()){
 const name=node.getName(),stats={triangles:0,sourceDegenerate:0,adaptedDegenerate:0,normalReversal:0,reversals:[],minimumAreaRatio:Infinity};
 for(const p of node.getMesh().listPrimitives()){
 const source=p.getAttribute('POSITION'),points=[],adapted=[];for(let i=0;i<source.getCount();i++){
 const v=[];source.getElement(i,v);points.push(new Vector3(...v));const raw=mapping.objects[name].originalVertexWeights[p.getExtras().sourceVertexIndices[i]],sum=raw.reduce((s,[,w])=>s+w,0);adapted.push(new Vector3(...adaptSourcePoint(v,name,raw.map(([n,w])=>[n,w/sum]))));
 }
 const ids=p.getIndices().getArray();for(let i=0;i<ids.length;i+=3){const [a,b,c]=Array.from(ids.subarray(i,i+3)),n=points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a])),m=adapted[b].clone().sub(adapted[a]).cross(adapted[c].clone().sub(adapted[a]));stats.triangles++;if(n.lengthSq()<1e-18)stats.sourceDegenerate++;if(m.lengthSq()<1e-18)stats.adaptedDegenerate++;if(n.dot(m)<0){stats.normalReversal++;stats.reversals.push({triangle:i/3,centre:points[a].clone().add(points[b]).add(points[c]).divideScalar(3).toArray()});}if(n.lengthSq()>1e-18)stats.minimumAreaRatio=Math.min(stats.minimumAreaRatio,m.length()/n.length());}
 }meshes[name]=stats;
}
const report={scope:'Read-only original rest topology versus species rest warp, before quills. Normal reversal can indicate local folding; animated deformations require separate proof.',meshes};await writeFile(new URL('species-topology-audit.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

