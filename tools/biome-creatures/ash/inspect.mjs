import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
for (const id of ['lava_golem','webweaver_spider','grave_ghoul','revenant','banshee']) {
 const entry=manifest.assets.find(x=>x.id===`creature_${id}`),doc=await io.read(`game/public/assets/${entry.file}`),r=doc.getRoot();
 const result={id,entry,nodes:r.listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName(),t:n.getTranslation(),s:n.getScale(),w:n.getWorldMatrix().slice(12,15),mesh:n.getMesh()?.listPrimitives().map(p=>({mat:p.getMaterial()?.getName(),count:p.getAttribute('POSITION').getCount(),min:p.getAttribute('POSITION').getMin([]),max:p.getAttribute('POSITION').getMax([])})),skin:n.getSkin()?.listJoints().length})),clips:r.listAnimations().map(a=>({name:a.getName(),duration:Math.max(...a.listSamplers().flatMap(s=>[...s.getInput().getArray()])),channels:a.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath()])}))};
 await writeFile(`test-results/biome-creatures/ash/${id}-source.json`,JSON.stringify(result,null,2));
 console.log(id,JSON.stringify(result.nodes.filter(n=>n.mesh||['pelvis','spine_01','spine_02','spine_03','Head','head','head1','spine1','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','hand_l','hand_r'].includes(n.name))));
}


