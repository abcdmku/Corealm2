import * as THREE from 'three';
import {buildSpecies,SPECIES} from '../mammals.mjs';

for(const id of SPECIES){
  const {object,clips,meta}=await buildSpecies(id),bones={},meshes=[];
  object.traverse(o=>{if(o.isBone)bones[o.name]=o;if(o.isSkinnedMesh)meshes.push(o);});
  object.updateMatrixWorld(true);
  const rest=Object.fromEntries(Object.entries(bones).map(([k,b])=>[k,b.getWorldPosition(new THREE.Vector3())]));
  const mixer=new THREE.AnimationMixer(object),gaits={};
  for(const clipName of ['Walk','Run']){
    const clip=clips.find(x=>x.name===clipName),action=mixer.clipAction(clip);action.play();
    const running=clipName==='Run',duty=running?.44:.66,stride=(running?meta.impliedRunMps:meta.impliedWalkMps)*clip.duration*duty;
    let maxContactError=0,maxGroundError=0;
    for(let i=0;i<clip.tracks[0].times.length-1;i++){
      const time=clip.tracks[0].times[i],t=time/clip.duration;mixer.setTime(time);object.updateMatrixWorld(true);
      for(const name of ['FL','FR','HL','HR']){
        const front=name[0]==='F',left=name[1]==='L';let phase;
        if(running&&(id.includes('fox')||id.includes('lynx')))phase=front?(left?.05:.15):(left?.55:.65);
        else phase=front?(left?0:.5):(left?.5:0);
        if(!running)phase=front?(left?0:.5):(left?.75:.25);
        const u=(t+phase)%1;
        if(u>=duty)continue;
        const expected=rest[name+'_Paw'].clone();expected.z+=stride*(.5-u/duty);
        const actual=bones[name+'_Paw'].getWorldPosition(new THREE.Vector3());
        maxContactError=Math.max(maxContactError,actual.distanceTo(expected));maxGroundError=Math.max(maxGroundError,Math.abs(actual.y-expected.y));
      }
    }
    gaits[clipName]={maxContactError,maxGroundError};action.stop();mixer.setTime(0);
  }
  const count=meshes.reduce((s,m)=>s+m.geometry.index.count/3,0);
  let minNormal=Infinity,maxNormal=0,weightError=0;
  for(const mesh of meshes){const n=mesh.geometry.getAttribute('normal'),w=mesh.geometry.getAttribute('skinWeight');for(let i=0;i<n.count;i++){const len=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));minNormal=Math.min(minNormal,len);maxNormal=Math.max(maxNormal,len);weightError=Math.max(weightError,Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1));}}
  console.log(JSON.stringify({id,triangles:count,minNormal,maxNormal,weightError,gaits}));
}
