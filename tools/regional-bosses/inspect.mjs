import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),m=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')),out={};
for(const id of ['flint_mandible','briar_harrow','thorn_maw','vault_custodian','kiln_marrow']){
 const a=m.assets.find(a=>a.id==='creature_'+id),r=(await io.read('game/public/assets/'+a.file)).getRoot();out[id]={asset:a,joints:r.listSkins()[0].listJoints().map(n=>({name:n.getName(),p:n.getWorldMatrix().slice(12,15)})),meshes:r.listNodes().filter(n=>n.getMesh()).map(n=>({name:n.getName(),skin:!!n.getSkin(),parent:n.getParentNode()?.getName(),triangles:n.getMesh().listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0)}))};
 console.log(id,JSON.stringify(out[id].joints),JSON.stringify(out[id].meshes));
}
await writeFile('test-results/regional-bosses/sources.json',JSON.stringify(out,null,2));
