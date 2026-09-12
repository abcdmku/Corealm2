import type { EnemyGroupDef, Spot } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { FAIRY_CREATURE_SPECIES } from './fairyCreatures.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS } from '../world/fairyLandforms.js';

export const FAIRY_TERRACE_RESIDENT_COUNT = 7;
export const FAIRY_TERRACE_RING_RADIUS = 13.8;
export const FAIRY_TERRACE_ROAM_RADIUS = 1.5;

/**
 * Fixed actor order around the unoccupied centre. Adjacent roots are 11.97 m apart.
 * The innermost idle root remains 12.3 m from a reserved central miniboss socket.
 * Explicit offsets keep these sockets independent of the world RNG and other populations.
 */
const RESIDENT_OFFSETS: readonly Spot[] = [
  [13.8, 0], [8.60416, 10.78927], [-3.07079, 13.45401], [-12.43337, 5.98760],
  [-12.43337, -5.98760], [-3.07079, -13.45401], [8.60416, -10.78927],
];

/** The six accepted ordinary bodies occur in each region, with dangerous adults farther out. */
const PLATEAU_SPECIES: Readonly<Record<string, string>> = {
  moonpetal_table: 'petal_pouncer_t30',
  lantern_crown: 'bramble_prowler_t30',
  southern_bloom_table: 'bloom_hopper_t30',
  prism_table: 'petal_pouncer_t60',
  starroot_crown: 'bramble_prowler_t60',
  orchid_crown: 'bloom_hopper_t60',
};
const HOLLOW_SPECIES: Readonly<Record<string, string>> = {
  moonpath_hollow: 'moss_nibbler_t30',
  // The elder's full root-space envelope plus idle motion needs more than a 17 m clearing.
  lantern_willow_hollow: 'elder_grovebeast_t30',
  bloomheart_hollow: 'thicket_spirit_t30',
  prism_hollow: 'moss_nibbler_t60',
  twilight_hollow: 'elder_grovebeast_t60',
  orchid_hollow: 'thicket_spirit_t60',
};

const placements = [
  ...FAIRY_COMBAT_PLATEAUS.map(plateau => ({ id: plateau.id, regionId: plateau.regionId,
    centre: plateau.centre, radius: plateau.clearingRadius, speciesId: PLATEAU_SPECIES[plateau.id] })),
  ...FAIRY_DEEP_PATH_CLEARINGS.map(hollow => ({ id: hollow.id, regionId: hollow.regionId,
    centre: hollow.position, radius: hollow.radius, speciesId: HOLLOW_SPECIES[hollow.id] })),
];

/** Root registers groups and habitats together only after the ordinary creature lab gate. */
export const FAIRY_TERRACE_ENCOUNTERS = placements.map(placement => {
  const species = FAIRY_CREATURE_SPECIES.find(entry => entry.id === placement.speciesId);
  if (!species || species.regionId !== placement.regionId) {
    throw new Error(`Fairy clearing ${placement.id} has no accepted regional species`);
  }
  const groupId = `fairy_${placement.id}_residents`;
  const group: EnemyGroupDef = {
    id: groupId, family: species.stats.family, name: species.stats.name, tier: species.stats.tier,
    assetId: species.assetId, scale: species.scale, count: FAIRY_TERRACE_RESIDENT_COUNT,
    centre: placement.centre, radius: placement.radius,
  };
  const habitat: HabitatDef = {
    id: `${groupId}_habitat`, groupId, regionId: placement.regionId,
    centre: placement.centre, radius: placement.radius,
    anchors: RESIDENT_OFFSETS.map(([x, z]): Spot => [placement.centre[0] + x, placement.centre[1] + z]),
    roamRadius: FAIRY_TERRACE_ROAM_RADIUS, activity: species.activity, dressing: [],
  };
  return { siteId: placement.id, speciesId: species.id, group, habitat };
});

export const FAIRY_TERRACE_GROUPS: readonly EnemyGroupDef[] = FAIRY_TERRACE_ENCOUNTERS.map(entry => entry.group);
export const FAIRY_TERRACE_HABITATS: readonly HabitatDef[] = FAIRY_TERRACE_ENCOUNTERS.map(entry => entry.habitat);
