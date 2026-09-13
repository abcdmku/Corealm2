import type { EnemyGroupDef } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS } from '../world/fairyLandforms.js';
import { createFairyGardenResidents } from './fairyGardenEncounters.js';

export {
  FAIRY_GARDEN_RESIDENT_COUNT as FAIRY_TERRACE_RESIDENT_COUNT,
  FAIRY_GARDEN_RING_RADIUS as FAIRY_TERRACE_RING_RADIUS,
  FAIRY_GARDEN_ROAM_RADIUS as FAIRY_TERRACE_ROAM_RADIUS,
} from './fairyGardenEncounters.js';

/** Lab-accepted mixed residents occupy the existing authored fairy clearings. */
export const FAIRY_TERRACE_ENCOUNTERS = [
  ...FAIRY_COMBAT_PLATEAUS.flatMap(site => createFairyGardenResidents({
    id: site.id, regionId: site.regionId, centre: site.centre, radius: site.clearingRadius,
  })),
  ...FAIRY_DEEP_PATH_CLEARINGS.flatMap(site => createFairyGardenResidents({
    id: site.id, regionId: site.regionId, centre: site.position, radius: site.radius,
  })),
];

export const FAIRY_TERRACE_GROUPS: readonly EnemyGroupDef[] = FAIRY_TERRACE_ENCOUNTERS.map(({ group }) => group);
export const FAIRY_TERRACE_HABITATS: readonly HabitatDef[] = FAIRY_TERRACE_ENCOUNTERS.map(({ habitat }) => habitat);
