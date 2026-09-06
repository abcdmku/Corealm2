import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {buildComposition} from '../game/src/render/buildings.js';
import {assembleFeatureLabStructure} from '../game/src/featureLab/structures.js';
import {buildRootfallNavigationSources} from '../game/src/render/rootfallNavigation.js';
import {ROOTFALL_STUMP} from '../game/src/world/rootfallStump.js';

describe('Rootfall native stump route',()=>{
 it('fits consecutive tread flights to the actual cut-face height without a clipped hero',()=>{
  const steps=buildComposition('rootfall_stump',1,'timber').filter(p=>p.tag.startsWith('step_'));
  expect(steps).toHaveLength(4);
  expect(steps.every(step=>step.scaleAxes?.[0]===1.6&&step.scaleAxes[1]===1&&step.scaleAxes[2]===1)).toBe(true);
  expect(steps[0]!.dy+.003*steps[0]!.scale).toBeCloseTo(0,2);
  for(let i=1;i<steps.length;i++){
   const seamRise=steps[i]!.dy+.003*steps[i]!.scale-(steps[i-1]!.dy+.818*steps[i-1]!.scale);
   expect(seamRise).toBeLessThan(.25);
   expect(seamRise).toBeGreaterThan(0);
   expect(Math.hypot(steps[i]!.dx-steps[i-1]!.dx,steps[i]!.dz-steps[i-1]!.dz)).toBeCloseTo(2*steps[i]!.scale,2);
  }
  expect(steps[3]!.dy+.818*steps[3]!.scale).toBeCloseTo(ROOTFALL_STUMP.topY,2);
 });
 it('uses native hero and all four real stair meshes for navigation but omits side growth',async()=>{
  const fixture=assembleFeatureLabStructure({kind:'composition',id:'rootfall_stump',kit:'timber',width:6,depth:6,seed:1},[10,2,20]);
  const hero=fixture.entities.find(e=>e.meta?.compositionHero)!;
  expect(hero.view?.assetId).toBe('corealm_stump_oak');
  expect(hero.view?.clipFraction).toBeUndefined();
  const template=new THREE.Group();template.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1)));
  const nav=await buildRootfallNavigationSources({load:async()=>template,instance:()=>template.clone(true)},fixture.entities);
  expect(nav.roots).toHaveLength(5);expect(nav.meshes).toHaveLength(5);
  expect(nav.roots[0]!.position.toArray()).toEqual([10,2,20]);
  expect(nav.meshes.map(m=>m.userData['structureNavigation']).filter(id=>id.includes('#step_'))).toHaveLength(4);
 });
});
