import { describe, expect, it } from 'vitest';
import { WILDERNESS } from '../game/src/content/wilderness.js';
import { WORLD_HABITATS } from '../game/src/content/worldHabitats.js';
import { WILDERNESS_EAST_LAVA_CHANNELS } from '../game/src/content/wildernessEastRelief.js';
import { lavaSections } from '../game/src/content/wildernessLava.js';
import { rockMassDistance, rockMassHeight } from '../game/src/world/lavaLandforms.js';

type Point = readonly [number, number];
const segmentDistance = (x:number,z:number,a:Point,b:Point):number => {
  const dx=b[0]-a[0], dz=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);
};
const locations = new Map(WILDERNESS.locations.map(location => [location.id,location.position]));
const habitats = WORLD_HABITATS.filter(habitat => habitat.regionId === 'wilderness');
function occupiedClearance(x:number,z:number):number {
  return Math.min(
    ...WILDERNESS.roads.map(road => segmentDistance(x,z,locations.get(road.from)!,locations.get(road.to)!)-8),
    ...habitats.map(habitat => Math.hypot(x-habitat.centre[0],z-habitat.centre[1])-habitat.radius-6),
    ...WILDERNESS.landmarks.map(landmark => Math.hypot(x-landmark.position[0],z-landmark.position[1])-35),
    ...WILDERNESS.clusters.map(cluster => Math.hypot(x-cluster.centre[0],z-cluster.centre[1])-cluster.radius-14),
  );
}

describe('eastern Wilderness volcanic relief', () => {
  it('keeps complete lava banks outside existing routes, inhabitants and authored sites', () => {
    for (const channel of WILDERNESS_EAST_LAVA_CHANNELS) {
      for (const section of lavaSections(channel,.55)) {
        expect(occupiedClearance(section.x,section.z)-section.halfWidth-channel.bankWidth,
          `${channel.id} at ${section.x},${section.z}`).toBeGreaterThan(8);
      }
    }
  });

  it('keeps raised terrain aprons clear while producing substantial volcanic hills', () => {
    for (const channel of WILDERNESS_EAST_LAVA_CHANNELS) {
      for (const mass of channel.rockMasses ?? []) {
        const xs=mass.polygon.map(point=>point[0]), zs=mass.polygon.map(point=>point[1]);
        let peak=9;
        for(let x=Math.min(...xs)-8;x<=Math.max(...xs)+8;x+=2) {
          for(let z=Math.min(...zs)-8;z<=Math.max(...zs)+8;z+=2) {
            if(rockMassDistance(mass,x,z)>8) continue;
            expect(occupiedClearance(x,z),`${mass.id} at ${x},${z}`).toBeGreaterThan(5);
            peak=Math.max(peak,rockMassHeight(9,x,z,mass));
          }
        }
        expect(peak-9,`${mass.id} hill relief`).toBeGreaterThan(8);
      }
    }
  });
});
