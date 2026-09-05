import * as THREE from 'three';
import assert from 'node:assert/strict';
import { SPECIES, buildSpecies } from '../hoofed.mjs';
const selected=process.argv.slice(2);
for(const id of SPECIES.filter(id=>!selected.length||selected.includes(id))){
 const {object,clips,meta}=await buildSpecies(id);const base={};
 const soles={};let skin;
 assert.deepEqual(clips.map(c=>c.name),['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death']);
 object.traverse(o=>{
  if(!o.isSkinnedMesh)return;
  skin=o;
  assert.equal(o.geometry.attributes.uv.count,o.geometry.attributes.position.count,`${id}: UV count`);
  for(const [name,attribute]of Object.entries(o.geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value),`${id}: nonfinite ${name}`);
  const weights=o.geometry.attributes.skinWeight;
  for(let i=0;i<weights.count;i++)assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-5,`${id}: skin normalization`);
  if(id==='bracken_tapir')for(let i=0;i<weights.count;i++){
   const point=new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,i);
   if(point.y>.012||weights.getX(i)<.9999)continue;
   const bone=o.skeleton.bones[o.geometry.attributes.skinIndex.getX(i)].name;
   if(!bone.endsWith('Foot'))continue;
   const tag=bone.slice(id.length+1,-4);(soles[tag]??=[]).push({index:i,point});
  }
 });
 for(const clip of clips)for(const track of clip.tracks){assert.ok(object.getObjectByName(track.name.split('.')[0]),`${id}: unresolved ${track.name}`);if(track.name.endsWith('_Root.position'))for(let i=0;i<track.values.length;i+=3)assert.ok(Math.abs(track.values[i])+Math.abs(track.values[i+2])<1e-8,`${id}: root horizontal travel`);}
 for(const tag of ['ForeL','ForeR','HindL','HindR'])base[tag]=object.getObjectByName(`${id}_${tag}Ankle`).getWorldPosition(new THREE.Vector3());
 const results=[];
 for(const name of ['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight']){
  const clip=clips.find(c=>c.name===name),mixer=new THREE.AnimationMixer(object);mixer.clipAction(clip).play();let maxContactError=0,minGround=10,maxSoleContactError=0;
  for(let frame=0;frame<320;frame++){
   const t=frame/320;mixer.setTime(t*clip.duration);object.updateMatrixWorld(true);
   ['ForeL','ForeR','HindL','HindR'].forEach((tag,i)=>{
    const ankle=object.getObjectByName(`${id}_${tag}Ankle`).getWorldPosition(new THREE.Vector3()),target=base[tag].clone();let stance=true;
    if(name==='Walk'||name==='Run'){
     const run=name==='Run',offset=run?(id==='marchwild_horse'?[0,.13,.56,.66]:[0,.5,.5,0])[i]:[0,.5,.75,.25][i],phase=(t+offset)%1,duty=run?.47:.64;
     stance=phase<duty;target.z+=(run?meta.impliedRunMps:meta.impliedWalkMps)*clip.duration*duty*(.5-phase/duty);
    }
    if(name==='Attack'&&id==='marchwild_horse'&&tag==='ForeL')stance=false;
    if(stance){
     maxContactError=Math.max(maxContactError,ankle.distanceTo(target));
     for(const sole of soles[tag]??[]){
      const expected=sole.point.clone().add(target).sub(base[tag]),actual=skin.getVertexPosition(sole.index,new THREE.Vector3()).applyMatrix4(skin.matrixWorld);
      maxSoleContactError=Math.max(maxSoleContactError,actual.distanceTo(expected));
      assert.ok(actual.y>-.001,`${id} ${name}: sole below ground`);
     }
    }
    minGround=Math.min(minGround,ankle.y-base[tag].y);
   });
  }
  let loopError=0;for(const track of clip.tracks){const size=track.getValueSize();for(let i=0;i<size;i++)loopError=Math.max(loopError,Math.abs(track.values[i]-track.values[track.values.length-size+i]));}
  results.push({clip:name,maxContactError:Number(maxContactError.toFixed(6)),minGround:Number(minGround.toFixed(6)),loopError:Number(loopError.toFixed(6)),...(id==='bracken_tapir'?{maxSoleContactError:Number(maxSoleContactError.toFixed(6))}:{})});
  assert.ok(maxContactError<.002,`${id} ${name}: contact ${maxContactError}`);assert.ok(minGround>-.002,`${id} ${name}: below ground ${minGround}`);assert.ok(loopError<1e-6,`${id} ${name}: loop seam ${loopError}`);
  assert.ok(maxSoleContactError<.002,`${id} ${name}: drawn sole contact ${maxSoleContactError}`);
  mixer.stopAllAction();object.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.pose();});
 }
 const death=clips.find(c=>c.name==='Death');for(const track of death.tracks){const width=track.getValueSize(),last=track.values.length-width;for(let key=0;key<track.times.length;key++)if(track.times[key]>=death.duration*.9)for(let component=0;component<width;component++)assert.ok(Math.abs(track.values[key*width+component]-track.values[last+component])<1e-6,`${id}: Death does not settle`);}
 if(id==='bracken_tapir')for(const tag of ['ForeL','ForeR','HindL','HindR'])assert.ok((soles[tag]?.length??0)>3,`${id}: missing sole samples ${tag}`);
 console.log(JSON.stringify({id,triangles:meta.triangles,...(id==='bracken_tapir'?{soleVertices:Object.fromEntries(Object.entries(soles).map(([tag,points])=>[tag,points.length]))}:{}),results}));
}
