import { NodeIO } from '@gltf-transform/core';
import { mkdir, writeFile } from 'node:fs/promises';
const input=process.argv[2];
if(!input)throw new Error('Pass source GLB path');
const doc=await new NodeIO().read(input),root=doc.getRoot();
const report={file:input,materials:root.listMaterials().map(m=>({name:m.getName(),color:m.getBaseColorFactor(),metal:m.getMetallicFactor(),rough:m.getRoughnessFactor(),texture:m.getBaseColorTexture()?.getName()})),nodes:root.listNodes().filter(n=>n.getMesh()).map(n=>({name:n.getName(),skin:n.getSkin()?.listJoints().map(j=>({name:j.getName(),position:j.getWorldTranslation()})),primitives:n.getMesh()!.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),attributes:p.listSemantics(),vertices:p.getAttribute('POSITION')?.getCount(),triangles:(p.getIndices()?.getCount()??p.getAttribute('POSITION')?.getCount()??0)/3}))}))};
await mkdir('test-results/fab-armor-paragon',{recursive:true});await writeFile('test-results/fab-armor-paragon/inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
