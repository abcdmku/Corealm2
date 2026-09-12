import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readdir,writeFile} from 'node:fs/promises';
const directory='.asset-cache/fab-armor/adapted-paragon',io=new NodeIO().registerExtensions(ALL_EXTENSIONS),reports=[];
for(const file of (await readdir(directory)).filter(f=>f.endsWith('.glb'))){const doc=await io.read(`${directory}/${file}`);let maxWeightError=0,vertices=0;for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){const pos=p.getAttribute('POSITION')!,weights=p.getAttribute('WEIGHTS_0')!;vertices+=pos.getCount();for(const x of pos.getArray()!)if(!Number.isFinite(x))throw new Error(file+' nonfinite position');for(let i=0;i<weights.getCount();i++){const values=weights.getElement(i,[]);maxWeightError=Math.max(maxWeightError,Math.abs(values.reduce((a,b)=>a+b,0)-1));}if(maxWeightError>1e-5)throw new Error(file+' invalid skin weights');}reports.push({file,vertices,maxWeightError,finite:true});}
await writeFile('test-results/fab-armor-paragon/numerical-validation.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
