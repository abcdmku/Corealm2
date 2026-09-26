import type { SemanticEntity, TownTeleportId, TownTeleportPad } from '../contracts.js';
import { REGIONS } from './regions.js';

export const TOWN_TELEPORT_REQUIREMENTS: Readonly<Record<TownTeleportId, {name: string; reqLevel: number; cost: number}>> = {
  millfield: {name: 'Millfield', reqLevel: 5, cost: 1},
  oakwood: {name: 'Oakwood', reqLevel: 10, cost: 1},
  hillcrest: {name: 'Hillcrest', reqLevel: 15, cost: 1},
  ashford: {name: 'Ashford', reqLevel: 20, cost: 2},
  lantern_rest: {name: 'Lantern Rest', reqLevel: 30, cost: 2},
  crownward: {name: 'Crownward', reqLevel: 40, cost: 3},
  lastlight: {name: 'Lastlight', reqLevel: 50, cost: 3},
  prism_hollow: {name: 'Prism Hollow', reqLevel: 60, cost: 4},
  starhaven: {name: 'Starhaven', reqLevel: 70, cost: 4},
};

/** Authored landmarks own coordinates; lab entities override them in compact scenes. */
export function townTeleportPads(entities: readonly SemanticEntity[] = []): TownTeleportPad[] {
  const pads = new Map<TownTeleportId, TownTeleportPad>();
  for (const region of REGIONS) for (const landmark of region.landmarks) {
    if (!landmark.id.startsWith('town_teleport_')) continue;
    const id = landmark.id.slice('town_teleport_'.length) as TownTeleportId;
    const requirement = TOWN_TELEPORT_REQUIREMENTS[id];
    if (!requirement) continue;
    pads.set(id, {id, ...requirement, entityId: landmark.id, regionId: region.id,
      position: [landmark.position[0], 0, landmark.position[1]]});
  }
  for (const entity of entities) {
    const id = entity.meta?.townTeleportId as TownTeleportId | undefined;
    if (!id || !TOWN_TELEPORT_REQUIREMENTS[id]) continue;
    pads.set(id, {id, ...TOWN_TELEPORT_REQUIREMENTS[id], entityId: entity.id,
      regionId: entity.regionId, position: entity.position});
  }
  return [...pads.values()].sort((a, b) => a.reqLevel - b.reqLevel);
}
