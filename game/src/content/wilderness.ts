import { REGIONS } from './regions.js';
import { WORLD_CONTENT } from './worldData.js';
/** Wilderness placements use the same authored encounter model as every region. */
export const WILDERNESS = REGIONS.find(region => region.id === 'wilderness')!;
export const WILDERNESS_GROUPS = WILDERNESS.enemyGroups;
export const WILDERNESS_HABITATS = WORLD_CONTENT.habitats.filter(habitat => habitat.regionId === 'wilderness');
