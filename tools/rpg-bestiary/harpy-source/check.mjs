import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {buildHarpy} from './harpy.mjs';
const id=process.argv[2]||'harpy';
const {object,clips}=buildHarpy(id),mixer=new T.AnimationMixer(object),results=[];
for(const clip of clips){const action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();let minY=Infinity,maxY=-Infinity;for(let frame=0;frame<=120;frame++){mixer.setTime(clip.duration*frame/120);object.updateMatrixWorld(true);object.traverse(n=>{if(!n.isMesh)return;const ids=Array.from({length:n.geometry.attributes.position.count},(_,i)=>i);for(const i of ids){const v=n.isSkinnedMesh?n.getVertexPosition(i,new T.Vector3()):new T.Vector3().fromBufferAttribute(n.geometry.attributes.position,i);v.applyMatrix4(n.matrixWorld);if(!v.toArray().every(Number.isFinite))throw Error(`${clip.name} nonfinite vertex`);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);}});}results.push({clip:clip.name,duration:clip.duration,minY,maxY});action.stop();}
const manifest=JSON.parse(fs.readFileSync('game/public/assets/manifest.json'));
const ids=['base_female','outfit_female_ranger_chest','animation_library_1','hair_long'];
const assets=manifest.assets.filter(a=>ids.includes(a.id));
let triangles=0;object.traverse(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;});
const records={triangles,status:'Unapproved first harpy candidate; browser proof required',sources:assets.map(a=>({...a,sha256:crypto.createHash('sha256').update(fs.readFileSync('game/public/assets/'+a.file)).digest('hex')})),packs:manifest.packs.filter(p=>assets.some(a=>a.pack===p.id)),additions:JSON.parse(fs.readFileSync('tools/rpg-bestiary/harpy-source/provenance.json')).modifications,checks:results};
fs.writeFileSync(`tools/rpg-bestiary/harpy-source/${id==='harpy'?'source-record':id+'-check'}.json`,JSON.stringify(records,null,2)+'\n');console.log(JSON.stringify({id,triangles,results}));
