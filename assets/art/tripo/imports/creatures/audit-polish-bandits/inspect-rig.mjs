import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
for(const id of ['base_female','base_male','outfit_female_ranger','outfit_male_ranger','animation_library_1']){
 const file=`game/public/assets/models/${id.startsWith('base_')?'character':id.startsWith('outfit_')?'outfit':'animation'}/${id}.glb`;
 const d=await io.read(file),r=d.getRoot(),s=r.listSkins()[0];
 console.log(JSON.stringify({id,nodes:r.listNodes().filter(n=>n.getMesh()).map(n=>({name:n.getName(),mesh:n.getMesh().getName(),skin:n.getSkin()?.getName(),materials:n.getMesh().listPrimitives().map(p=>p.getMaterial()?.getName())})),rootNodes:r.listScenes().flatMap(s=>s.listChildren().map(n=>n.getName())),skin:s?{name:s.getName(),joints:s.listJoints().map(n=>n.getName()),ibm:s.getInverseBindMatrices()?.getCount()}:null,animations:r.listAnimations().map(a=>a.getName())},null,2));
}
