import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS), manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
for(const id of ['mossback_sentinel','webweaver_spider','marsh_wasp','beetle_golem','goblin_scout']){
 const entry=manifest.assets.find(a=>a.id===`creature_${id}`),doc=await io.read(`game/public/assets/${entry.file}`),root=doc.getRoot();
 const report={id,entry,nodes:root.listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale(),world:n.getWorldMatrix().slice(12,15),skin:n.getSkin()?.getName(),mesh:n.getMesh()?.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),count:p.getAttribute('POSITION').getCount(),min:p.getAttribute('POSITION').getMin([]),max:p.getAttribute('POSITION').getMax([]),attributes:p.listSemantics()}))})),animations:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().map(c=>({node:c.getTargetNode()?.getName(),path:c.getTargetPath()}))}))};
 await writeFile(`test-results/biome-creatures/forest/${id}-source.json`,JSON.stringify(report,null,2));
 console.log(id,JSON.stringify(report.nodes.filter(n=>n.mesh)),JSON.stringify(root.listSkins().map(s=>s.listJoints().map(j=>({name:j.getName(),world:j.getWorldMatrix().slice(12,15)})))));
}
