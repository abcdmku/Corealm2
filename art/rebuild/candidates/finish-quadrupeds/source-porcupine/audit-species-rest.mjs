import {readFile,writeFile} from 'node:fs/promises';
import {Box3,Vector3} from 'three';
import {adaptSourcePoint,canonical} from './porcupine-surface.mjs';
const dir=new URL('./',import.meta.url),mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8'));
const objects={};
for(const [name,data] of Object.entries(mapping.objects)){
 const original=new Box3(),adapted=new Box3();let maxDisplacement=0,tailVertices=0;
 data.sourceWorldPositions.forEach((p,i)=>{
 const raw=data.originalVertexWeights[i],sum=raw.reduce((n,[,w])=>n+w,0),weights=raw.map(([n,w])=>[n,w/sum]),a=adaptSourcePoint(p,name,weights);
 if(!a.every(Number.isFinite))throw Error('Nonfinite adaptation '+name+':'+i);
 original.expandByPoint(canonical(p));adapted.expandByPoint(canonical(a));maxDisplacement=Math.max(maxDisplacement,new Vector3(...p).distanceTo(new Vector3(...a)));
 if(weights.some(([n,w])=>n.startsWith('Tail')&&w>.1))tailVertices++;
 });
 objects[name]={sourceVertices:data.sourceWorldPositions.length,original:{min:original.min.toArray(),max:original.max.toArray()},adapted:{min:adapted.min.toArray(),max:adapted.max.toArray()},maxDisplacement,tailVertices};
}
const report={sourceSha256:mapping.sourceSha256,units:'Unnormalized source units, reported Y up and +Z nose',objects,originalTopologyPreserved:true,scope:'Finite rest-surface transformation check. Native action, materials, anatomy and foot contact need separate validation.'};await writeFile(new URL('species-rest-audit.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
