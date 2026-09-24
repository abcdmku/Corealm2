import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as T from 'three';
const file='assets/art/tripo/imports/creatures/audit-user-road-bandit/creature_road_bandit.glb';
const root=(await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file)).getRoot();
const skin=root.listSkins()[0],joints=skin.listJoints(),p=root.listMeshes()[0].listPrimitives()[0],positions=p.getAttribute('POSITION').getArray(),ids=p.getAttribute('JOINTS_0').getArray(),weights=p.getAttribute('WEIGHTS_0').getArray(),ibm=skin.getInverseBindMatrices().getArray();
const out={};
for(const clip of root.listAnimations()){
 const override=new Map();for(const ch of clip.listChannels()){const s=ch.getSampler(),arr=s.getOutput().getArray(),size=ch.getTargetPath()==='rotation'?4:3;const value=[...arr.slice(arr.length-size)];const o=override.get(ch.getTargetNode())??{};o[ch.getTargetPath()]=value;override.set(ch.getTargetNode(),o);}
 const matrices=new Map();function world(n){if(matrices.has(n))return matrices.get(n);const parent=n.getParentNode(),po=parent&&parent.getName()!=='RoadBandit_Presentation'?world(parent):new T.Matrix4();const o=override.get(n)??{};const local=new T.Matrix4().compose(new T.Vector3(...(o.translation??n.getTranslation())),new T.Quaternion(...(o.rotation??n.getRotation())),new T.Vector3(...n.getScale()));const m=po.clone().multiply(local);matrices.set(n,m);return m;}
 const skinM=joints.map((j,i)=>world(j).clone().multiply(new T.Matrix4().fromArray(ibm,i*16)));
 const bounds=new T.Box3();const v=new T.Vector3(),sum=new T.Vector3(),part=new T.Vector3();
 for(let i=0;i<positions.length/3;i++){v.set(positions[i*3],positions[i*3+1],positions[i*3+2]);sum.set(0,0,0);for(let k=0;k<4;k++){const w=weights[i*4+k];if(w<1e-7)continue;part.copy(v).applyMatrix4(skinM[ids[i*4+k]]).multiplyScalar(w);sum.add(part);}bounds.expandByPoint(sum);}
 out[clip.getName()]={min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new T.Vector3()).toArray(),floorPenetrationMeters:Math.max(0,-bounds.min.y*1.76)};
}
console.log(JSON.stringify(out,null,2));
