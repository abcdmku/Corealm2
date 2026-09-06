import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Box3} from 'three';
const dir=new URL('./',import.meta.url),file=process.argv[2]||'cdmir-porcupine-contact-toe.glb',target=process.argv[3]||'porcupine-contact-catalogue.json',bytes=await readFile(new URL(file,dir)),doc=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes),root=doc.getRoot(),box=new Box3();
for(const node of root.listNodes())if(node.getMesh()){
 const skin=node.getSkin(),matrices=skin?.listJoints().map((n,i)=>{const b=[];skin.getInverseBindMatrices().getElement(i,b);return new Matrix4().fromArray(n.getWorldMatrix()).multiply(new Matrix4().fromArray(b));});
 for(const p of node.getMesh().listPrimitives()){const positions=p.getAttribute('POSITION'),joints=p.getAttribute('JOINTS_0'),weights=p.getAttribute('WEIGHTS_0');for(let i=0;i<positions.getCount();i++){const a=[],j=[],w=[];positions.getElement(i,a);let v=new Vector3();if(skin){joints.getElement(i,j);weights.getElement(i,w);for(let k=0;k<4;k++)if(w[k])v.addScaledVector(new Vector3(...a).applyMatrix4(matrices[j[k]]),w[k]);}else v.fromArray(a).applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));box.expandByPoint(v);}}
}
const cat=JSON.parse(await readFile(new URL('porcupine-candidate-catalogue.json',dir),'utf8')),asset=cat.assets[0],size=box.getSize(new Vector3());
asset.bytes=bytes.length;asset.sha256=createHash('sha256').update(bytes).digest('hex');asset.bounds={min:box.min.toArray(),max:box.max.toArray()};asset.size={x:size.x,y:size.y,z:size.z};asset.base={x:box.min.x,y:box.min.y,z:box.min.z};asset.groundY=box.min.y;asset.animations=root.listAnimations().map(a=>a.getName());asset.is='Separate per-limb contact repair candidate of the complete-source Porcupine adaptation';asset.tags.push('contact-repair-candidate');asset.sourceProvenance.contactRepairReport='contact-toe-report.json';cat.files[asset.id]=file;cat.limits.push('Separate contact repair candidate. Compare against frozen anatomy candidate; no hardware acceptance implied.');await writeFile(new URL(target,dir),JSON.stringify(cat,null,2)+'\n');console.log(JSON.stringify({catalogue:target,file,sha256:asset.sha256,bytes:asset.bytes,bounds:asset.bounds}));
