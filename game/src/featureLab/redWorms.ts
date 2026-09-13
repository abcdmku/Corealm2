import { RED_WORM_HABITAT } from '../content/redWormHabitat.js';
import { createFeatureLabEntity, FEATURE_LAB_CATALOG } from './catalog.js';

export function createRedWormFixture(ports: {
  heightAt(x:number,z:number):number;
  baseY(assetId:string):number;
  assetSize(assetId:string):{x:number;y:number;z:number}|null;
}) {
  const centre=[0,7] as const;
  const habitat={...RED_WORM_HABITAT,centre,
    anchors:RED_WORM_HABITAT.anchors.map(([x,z])=>[x-RED_WORM_HABITAT.centre[0],z-RED_WORM_HABITAT.centre[1]+7] as const)};
  const preset=FEATURE_LAB_CATALOG.targets.creature.find(p=>p.id==='species:red_worm')!;
  const actors=habitat.anchors.map(([x,z],index)=>{
    const entity=createFeatureLabEntity(preset,{entityId:`coldbrace_red_worms_${index+1}`,
      groundPosition:[x,ports.heightAt(x,z),z],baseY:ports.baseY,assetSize:ports.assetSize});
    entity.meta={...entity.meta,groupId:habitat.groupId,habitatId:habitat.id};
    return entity;
  });
  return {habitat,actors};
}
