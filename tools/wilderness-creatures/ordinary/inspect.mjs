import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as T from 'three';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
for(const id of ['slag_crawler','cairn_treader','flint_mandible','vault_custodian','veil_reaper']){
 const doc=await io.read(`game/public/assets/models/creature/creature_${id}.glb`),r=doc.getRoot();
 console.log(JSON.stringify({id,meshes:r.listNodes().filter(n=>n.getMesh()).map(n=>({name:n.getName(),skin:!!n.getSkin(),size:n.getMesh().listPrimitives().map(p=>p.getAttribute('POSITION').getCount())})),joints:r.listSkins()[0].listJoints().map(n=>({name:n.getName(),at:new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(n.getWorldMatrix())).toArray().map(v=>Math.round(v*1000)/1000)})),clips:r.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length}))}));
}
