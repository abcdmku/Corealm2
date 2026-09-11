import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const report={};
for(const id of ['shale_elemental','beetle_golem','iron_golem','webweaver_spider','stone_golem']){
 const asset=manifest.assets.find(a=>a.id===`creature_${id}`),doc=await io.read(`game/public/assets/${asset.file}`),root=doc.getRoot();
 report[id]={asset,nodes:root.listNodes().map(n=>({name:n.getName(),t:n.getTranslation(),s:n.getScale(),world:n.getWorldMatrix().slice(12,15),mesh:n.getMesh()?.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),vertices:p.getAttribute('POSITION').getCount(),min:p.getAttribute('POSITION').getMin([]),max:p.getAttribute('POSITION').getMax([])})),joints:n.getSkin()?.listJoints().map(n=>n.getName())})),materials:root.listMaterials().map(m=>({name:m.getName(),color:m.getBaseColorFactor(),texture:!!m.getBaseColorTexture()})),animations:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length}))};
}
await mkdir('test-results/biome-creatures/stone',{recursive:true});
await writeFile('test-results/biome-creatures/stone/source-inspection.json',JSON.stringify(report,null,2));
for(const[id,r]of Object.entries(report)){console.log(id,r.asset.size,r.asset.base);console.log(r.nodes.filter(n=>n.mesh));console.log(r.materials);console.log(r.nodes.filter(n=>!n.mesh).map(n=>`${n.name}: ${n.world.map(v=>v.toFixed(3))}`).join('\n'));}
