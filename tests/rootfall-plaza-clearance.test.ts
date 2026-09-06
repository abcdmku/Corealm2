import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {buildWorld} from '../game/src/world/regionBuilder.js';
import {Solids} from '../game/src/systems/solids.js';
import type {SolidVolume,Vec3} from '../game/src/contracts.js';
const manifest=JSON.parse(readFileSync('game/public/assets/manifest.json','utf8'));
const models=new Map<string,any>(manifest.assets.map((entry:any)=>[entry.id,entry]));
const world=buildWorld(1337,()=>0,{heightAt:()=>0,baseY:id=>models.get(id)?.base.y??0,assetSize:id=>models.get(id)?.size??null,
 assetCenterXZ:id=>{const a=models.get(id);return a?{x:a.base.x+a.size.x/2,z:a.base.z+a.size.z/2}:null;}});
const ids=['rootfall_prop_green_barrel','rootfall_prop_bench_1','rootfall_prop_bench_2'];
function corners(s:SolidVolume):number[][]{
 if(s.kind!=='box')throw new Error('Expected authored prop box');
 const c=Math.cos(s.rotationY),n=Math.sin(s.rotationY);
 return [-1,1].flatMap(x=>[-1,1].map(z=>[s.position[0]+x*s.size[0]/2*c+z*s.size[2]/2*n,s.position[2]-x*s.size[0]/2*n+z*s.size[2]/2*c]));
}
function separated(a:SolidVolume,b:SolidVolume):boolean{
 if(a.kind!=='box'||b.kind!=='box')throw new Error('Expected boxes');
 return [a.rotationY,b.rotationY].flatMap(y=>[[Math.cos(y),-Math.sin(y)],[Math.sin(y),Math.cos(y)]]).some(axis=>{
  const ap=corners(a).map(p=>p[0]!*axis[0]!+p[1]!*axis[1]!),bp=corners(b).map(p=>p[0]!*axis[0]!+p[1]!*axis[1]!);
  return Math.max(...ap)<Math.min(...bp)||Math.max(...bp)<Math.min(...ap);
 });
}
describe('Rootfall relocated plaza props',()=>{
 it('clears exact emitted house boxes and other moved props',()=>{
  for(const id of ids){
   const prop=world.solids.find(s=>s.id===id)!;expect(prop,id).toBeTruthy();
   for(const other of world.solids.filter(s=>s.kind==='box'&&s.id!==id&&(s.id.startsWith('rootfall_house_')||ids.includes(s.id))))expect(separated(prop,other),`${id} / ${other.id}`).toBe(true);
  }
 });
 it('leaves the stair centreline, bank approach and Mott clear of relocated solids',()=>{
  const solids=new Solids(world.solids.filter(s=>ids.includes(s.id)));
  const points:Vec3[]=[[69.2,0,118.6],[64,0,127]];
  for(let d=0;d<=12.3;d+=.15)points.push([60+d/Math.sqrt(2),0,120+d/Math.sqrt(2)]);
  for(let z=125.3;z<=127.3;z+=.1)points.push([60,0,z]);
  for(const point of points){const resolved=solids.resolve(point,point,.35);expect(Math.hypot(resolved[0]-point[0],resolved[2]-point[2]),`route ${point}`).toBeLessThan(.001);}
 });
 it('clears the native stump bounding footprint conservatively',()=>{
  const source=models.get('corealm_stump_oak'),stump:SolidVolume={id:'stump-bound',kind:'box',position:[60+(source.base.x+source.size.x/2)*4,0,120+(source.base.z+source.size.z/2)*4],size:[source.size.x*4,source.size.y*4,source.size.z*4],rotationY:0};
  for(const id of ids)expect(separated(world.solids.find(s=>s.id===id)!,stump),id).toBe(true);
 });
 it('clears all four real stair mesh bounds after their production transforms',()=>{
  const steps=world.entities.filter(entity=>entity.id.startsWith('rootfall_stump#step_'));
  expect(steps).toHaveLength(4);
  for(const step of steps){
   const view=step.view!,asset=models.get(view.assetId),scale=view.scale??1,yaw=view.rotationY??0;
   const axes=(view.scaleAxes??[1,1,1]).map(axis=>axis*scale),cx=(asset.base.x+asset.size.x/2)*axes[0]!,cz=(asset.base.z+asset.size.z/2)*axes[2]!;
   const bound:SolidVolume={kind:'box',id:step.id,position:[step.position[0]+cx*Math.cos(yaw)+cz*Math.sin(yaw),0,step.position[2]-cx*Math.sin(yaw)+cz*Math.cos(yaw)],size:[asset.size.x*axes[0]!,asset.size.y*axes[1]!,asset.size.z*axes[2]!],rotationY:yaw};
   for(const id of ids)expect(separated(world.solids.find(s=>s.id===id)!,bound),`${id} / ${step.id}`).toBe(true);
  }
 });
 it('has no static solid at the observed first-flight world navigation stall',()=>{
  const point:Vec3=[64.9,1.345,124.9],solids=new Solids(world.solids),resolved=solids.resolve(point,point,.35);
  expect(Math.hypot(resolved[0]-point[0],resolved[2]-point[2])).toBeLessThan(.001);
 });
});
