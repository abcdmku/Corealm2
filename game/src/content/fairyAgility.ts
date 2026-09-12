import type { LocationDef, ObstacleDef, RoadDef } from './regions.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_LANDFORM_PROBES, type FairyLandformRegion } from '../world/fairyLandforms.js';

export interface FairyAgilityLink {
  readonly landformId: string;
  readonly regionId: FairyLandformRegion;
  readonly tier: 30 | 60;
  readonly locations: readonly LocationDef[];
  readonly obstacle: ObstacleDef;
  readonly approachRoad: RoadDef;
}

const DEFINITIONS = [
  ['moonpetal_table', 'Moonpetal Ledge', 'dewsong_copse'],
  ['southern_bloom_table', 'Southern Bloom Ledge', 'moonpetal_grove'],
  ['prism_table', 'Prism Ledge', 'faeholme_prism_cross'],
  ['starroot_crown', 'Starroot Ledge', 'starroot_garden'],
  ['orchid_crown', 'Orchid Ledge', 'orchid_yew_grove'],
] as const;

/**
 * Second access to five existing shelves. Lantern Crown already has two walking ramps.
 * The quarter-turn flank probes follow the authored rim as its shape changes. The world
 * builder resolves both endpoint heights from the finished terrain. Every shelf retains
 * its walking ramp for players below the requirement and for an ordinary return journey.
 * These long crossings use the existing covered Agility traversal presentation.
 */
export const FAIRY_AGILITY_LINKS: readonly FairyAgilityLink[] = DEFINITIONS.map(([landformId, name, approach]) => {
  const landform = FAIRY_COMBAT_PLATEAUS.find(candidate => candidate.id === landformId);
  const probe = FAIRY_LANDFORM_PROBES.find(candidate => candidate.id === landformId);
  if (!landform || !probe || !landform.ramps.length) throw Error(`Missing fairy ledge or return ramp: ${landformId}`);
  const tier = landform.regionId === 'gloamgarden' ? 30 : 60;
  const id = `${landformId}_climb`, footId = `${id}_foot`, topId = `${id}_top`;
  return {
    landformId, regionId: landform.regionId, tier,
    locations: [
      { id: footId, name: `${name} Foot`, position: probe.flankFoot, kind: 'junction', routeNode: true,
        blurb: `A marked climb to the shelf above. Requires Agility ${tier}; the walking ramp remains open.` },
      { id: topId, name: `${name} Top`, position: probe.flankTop, kind: 'landmark', routeNode: true,
        blurb: 'The ledge landing opens onto the shelf. Return by its walking ramp or a planned climb route.' },
    ],
    obstacle: {
      id, name, reqLevel: tier, position: probe.flankFoot, exitPosition: probe.flankTop,
      durationMs: 4000,
      // Do not promise a distance saving before the finished world's nav paths are measured.
      savesMeters: 0,
      assetId: 'corealm_traversal_climb', scale: 1,
      rotationY: Math.atan2(probe.flankTop[0] - probe.flankFoot[0], probe.flankTop[1] - probe.flankFoot[1]),
      fromLocationId: footId, toLocationId: topId, interaction: 'climb',
    },
    // A road directly between these nodes would grade a walkable cut through the cliff.
    approachRoad: { from: approach, to: footId },
  };
});

export function fairyAgilityLocations(regionId: FairyLandformRegion): LocationDef[] {
  return FAIRY_AGILITY_LINKS.filter(link => link.regionId === regionId).flatMap(link => link.locations);
}

export function fairyAgilityObstacles(regionId: FairyLandformRegion): ObstacleDef[] {
  return FAIRY_AGILITY_LINKS.filter(link => link.regionId === regionId).map(link => link.obstacle);
}

export function fairyAgilityApproachRoads(regionId: FairyLandformRegion): RoadDef[] {
  return FAIRY_AGILITY_LINKS.filter(link => link.regionId === regionId).map(link => link.approachRoad);
}
