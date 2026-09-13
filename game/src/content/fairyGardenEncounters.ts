import type { EnemyGroupDef, Spot } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { FAIRY_GARDEN_SPECIES } from './fairyGardenCreatures.js';

export const FAIRY_GARDEN_RESIDENT_COUNT = 7;
export const FAIRY_GARDEN_RING_RADIUS = 13.8;
export const FAIRY_GARDEN_ROAM_RADIUS = 1.5;

/** Seven original sockets retain their spacing and the empty central guardian socket. */
export const FAIRY_GARDEN_RESIDENT_OFFSETS: readonly Spot[] = [
  [13.8, 0], [8.60416, 10.78927], [-3.07079, 13.45401], [-12.43337, 5.98760],
  [-12.43337, -5.98760], [-3.07079, -13.45401], [8.60416, -10.78927],
];

export const FAIRY_GARDEN_PAIRINGS: Readonly<Record<string, readonly [string, string]>> = {
  moonpetal_table: ['spriggle', 'sporekin'], prism_table: ['spriggle', 'sporekin'],
  lantern_crown: ['drake', 'wardling'], starroot_crown: ['drake', 'wardling'],
  southern_bloom_table: ['hart', 'veilspirit'], orchid_crown: ['hart', 'veilspirit'],
  moonpath_hollow: ['frog', 'snail'], prism_hollow: ['frog', 'snail'],
  lantern_willow_hollow: ['sapling', 'petalguard'], twilight_hollow: ['sapling', 'petalguard'],
  bloomheart_hollow: ['reliquary', 'imp'], orchid_hollow: ['reliquary', 'imp'],
};

export interface FairyGardenSite {
  id: string;
  regionId: 'gloamgarden' | 'faeholme';
  centre: Spot;
  radius: number;
}

/** The same compact mixed habitat is assembled by the lab before final-world registration. */
export function createFairyGardenResidents(site: FairyGardenSite, forms = FAIRY_GARDEN_PAIRINGS[site.id]) {
  if (!forms || forms.length !== 2 || forms[0] === forms[1]) throw Error(`Missing distinct fairy residents for ${site.id}`);
  const tier = site.regionId === 'gloamgarden' ? 30 : 60;
  return forms.map((form, groupIndex) => {
    const speciesId = `garden_${form}_t${tier}`;
    const species = FAIRY_GARDEN_SPECIES.find(row => row.id === speciesId);
    if (!species) throw Error(`Missing fairy species ${speciesId}`);
    const offsets = FAIRY_GARDEN_RESIDENT_OFFSETS.filter((_, index) => index % 2 === groupIndex);
    const id = `fairy_${site.id}_${groupIndex === 0 ? 'residents' : 'companions'}`;
    const group: EnemyGroupDef = {
      id, family: species.stats.family, name: species.stats.name, tier,
      assetId: species.assetId, scale: species.scale, count: offsets.length, countPolicy: 'fixed',
      centre: site.centre, radius: site.radius,
    };
    const habitat: HabitatDef = {
      id: `${id}_habitat`, groupId: id, regionId: site.regionId, centre: site.centre, radius: site.radius,
      anchors: offsets.map(([x, z]): Spot => [site.centre[0] + x, site.centre[1] + z]),
      roamRadius: FAIRY_GARDEN_ROAM_RADIUS, activity: species.activity, dressing: [],
    };
    return { siteId: site.id, speciesId, group, habitat };
  });
}
