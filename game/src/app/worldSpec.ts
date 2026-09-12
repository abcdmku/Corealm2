import { CROWNWARD_RIVER_CHANNELS, CROWNWARD_RIVER_BRIDGES } from '../content/crownwardRiver.js';
/**
 * Derives the terrain spec from canonical content.
 *
 * Round 1 shipped two descriptions of where the regions are: the authored one in
 * `content/regions.ts` and a hand-written one in `render/scene.ts`. They disagreed, which would
 * have put every entity on the wrong terrain. `content/regions.ts` wins, because the route-flip
 * arithmetic that makes Agility matter is measured against those exact coordinates.
 *
 * So the terrain spec is *derived*, not authored twice. There is one source of truth for where the
 * world is, and the renderer consumes it.
 *
 * FROZEN. Only the root edits this file.
 */
import { isFairyRegion, type RegionId } from "../contracts.js";
import { FAIRY_REGIONS } from "../content/fairyRegions.js";
import { LANTERN_REST_FOUNDATIONS } from '../content/settlements/lanternRest.js';
import { PRISM_HOLLOW_FOUNDATIONS } from '../content/settlements/prismHollow.js';
import { castleGroundLayout } from '../render/compositions/crownwardCastles.js';
import {
  ESSENCE_ALTAR_COURT_BLEND,
  ESSENCE_ALTAR_COURT_RADIUS,
  REGIONS,
  type RegionDef,
  type SettlementDef,
} from "../content/regions.js";
import { resourceDef } from "../content/resources.js";
import { WORLD_SITES } from "../content/worldSites.js";
import type { FlatSpot, RegionTerrainSpec, WorldTerrainSpec, Rect } from "../render/scene.js";
import { seedFromText, type OrganicBiomeSpec } from "../world/organicFields.js";
import { WATER_BASIN_DEPTH, waterBasinForCluster } from "../world/waterBodies.js";
import { WILDERNESS_LAVA_CHANNELS } from "../content/wildernessLava.js";
import { WILDERNESS_RUINS, type WildernessRuinId } from "../render/compositions/wildernessRuins.js";
import { DEEP_WILDERNESS_STRUCTURES, type DeepWildernessStructureId } from '../render/compositions/deepWildernessStructures.js';

// Kept here as a re-export because boot and its existing callers already own this import path.
export { WATER_BASIN_DEPTH };

function rectOf(region: RegionDef): Rect {
  return {
    minX: region.bounds.min[0],
    maxX: region.bounds.max[0],
    minZ: region.bounds.min[1],
    maxZ: region.bounds.max[1],
  };
}

function characterOf(regionId: RegionId): RegionTerrainSpec["character"] {
  switch (regionId) {
    case "vellenwood": return "woodland";
    case "karrowmoor": return "highlands";
    // Ember foothills: rolling highland relief at a 34 m amplitude, without Karrowmoor's terraces.
    case "kilnhalt": return "highlands";
    case "gravelmaw": return "cavern";
    default: return "plains";
  }
}

/**
 * Metres of flat ground beyond the outermost thing a settlement places.
 *
 * Roofs overhang their footprint by up to 1.5 m in this kit, and the player has to be able to
 * stand at a door without the ground already sloping away, so this is deliberately generous. Cost
 * is a wider blend on the terrain, which is invisible; the alternative is a house with one corner
 * in the air, which is not.
 */
const SETTLEMENT_PAD_MARGIN = 8;

/**
 * Settlements, banks, and stations need buildable ground. Noise does not provide it, so every
 * settlement centre and every named location gets a flattened pad.
 *
 * Fishing clusters do not use this list. `buildWorldTerrainSpec` gives them dedicated basins after
 * it derives ordinary flats, because water needs both a depressed floor and a closed raised bank.
 * A flat pad can provide the floor but has no way to guarantee the bank.
 */
function flatSpotsFor(region: RegionDef): FlatSpot[] {
  const flats: FlatSpot[] = [];
  if (region.id === "crownward") for (const bridge of CROWNWARD_RIVER_BRIDGES) {
    flats.push({x:bridge.centre[0],z:bridge.centre[1],height:bridge.height,radius:18,halfExtents:[7,16],blend:12});
  }
  const castles = region.landmarks.filter(landmark => castleGroundLayout(landmark.composition));
  for (const castle of castles) {
    const [width, depth] = castleGroundLayout(castle.composition)!.pad;
    const halfExtents = [width / 2, depth / 2] as const;
    flats.push({x:castle.position[0],z:castle.position[1],radius:Math.hypot(...halfExtents),
      halfExtents,rotationY:castle.rotationY,blend:20});
  }
  for (const landmark of region.landmarks) {
    const ruin = WILDERNESS_RUINS[landmark.composition as WildernessRuinId]
      ?? DEEP_WILDERNESS_STRUCTURES[landmark.composition as DeepWildernessStructureId];
    if (!ruin) continue;
    const halfExtents = [ruin.footprint[0] / 2 + 2, ruin.footprint[1] / 2 + 2] as const;
    flats.push({x:landmark.position[0],z:landmark.position[1],radius:Math.hypot(...halfExtents),
      halfExtents,rotationY:landmark.rotationY,blend:12});
  }

  const settlement = region.settlement;
  if (settlement) {
    // The pad is sized from what actually stands on it, not from a round number.
    //
    // A fixed 34 m radius left the outer ring of Coldbrace and Highcairn straddling the blend:
    // every part of one building shares the origin's ground height (a building has to be level),
    // so a house whose far corner sat 40 cm up the falloff had that corner buried and the opposite
    // one hanging in the air. That is the "wall panels float at an angle, roof sections rest on
    // grass" finding — the assembly was right and the ground under it was not.
    // A rectangular pad when the settlement asks for one, a circle otherwise.
    //
    // A circle cannot hold a terrace. Highcairn is authored around an 18 m riser and its circular
    // pad erased the whole thing — measured, its north and south walls shared y = 26.810, so the
    // one piece of designed verticality in Karrowmoor became a disc of uniform grey. A rectangle
    // whose long axis runs ALONG the terrace flattens the building ground and leaves the riser
    // above and below it alone. `padShape` is authored per settlement; `settlementRadius` still
    // sizes the falloff sweep, because the falloff has to clear whatever the pad's corners reach.
    const padShape = settlement.padShape;
    flats.push(padShape
      ? {
          x: settlement.centre[0],
          z: settlement.centre[1],
          radius: Math.hypot(padShape.halfX, padShape.halfZ),
          blend: 26,
          halfExtents: [padShape.halfX, padShape.halfZ] as const,
          rotationY: padShape.rotationY,
        }
      : {
          x: settlement.centre[0],
          z: settlement.centre[1],
          radius: settlementRadius(settlement),
          blend: 26,
        });
  }

  // Altar Ruins Free spans just over 20 m across. Its elemental court gets one authored plane
  // beneath the complete ruin, the five-node Essence ring, and the player's approach. The wide
  // collar hands that plane back to the regional terrain without leaving an exposed cut edge.
  const essenceAltars = region.stations.filter((station) => station.kind === "essence_altar");
  for (const altar of essenceAltars) {
    flats.push({
      x: altar.position[0],
      z: altar.position[1],
      radius: ESSENCE_ALTAR_COURT_RADIUS,
      blend: ESSENCE_ALTAR_COURT_BLEND,
    });
  }

  // Named locations are where the player stands still: banks, seams, camps, gates. A 7 m pad keeps
  // an interaction from happening on a slope steep enough to look broken. Water owns a separate
  // basin applied after every ordinary pad, so a generic location pad must not pull its floor back
  // toward the dry terrain.
  for (const location of region.locations) {
    if (region.id === "crownward" && CROWNWARD_RIVER_BRIDGES.some(bridge => Math.hypot(location.position[0]-bridge.centre[0],location.position[1]-bridge.centre[1]) < 23)) continue;
    if (castles.some(castle => {
      const [width, depth] = castleGroundLayout(castle.composition)!.pad;
      const dx = location.position[0] - castle.position[0], dz = location.position[1] - castle.position[1];
      const yaw = castle.rotationY ?? 0, cos = Math.cos(yaw), sin = Math.sin(yaw);
      return Math.abs(dx * cos - dz * sin) <= width / 2 && Math.abs(dx * sin + dz * cos) <= depth / 2;
    })) continue;
    if (region.landmarks.some(landmark => {
      const structure = DEEP_WILDERNESS_STRUCTURES[landmark.composition as DeepWildernessStructureId];
      if (!structure) return false;
      if (location.id === `${landmark.id}_approach`) return true;
      const x = location.position[0] - landmark.position[0], z = location.position[1] - landmark.position[1];
      const yaw = landmark.rotationY ?? 0, cos = Math.cos(yaw), sin = Math.sin(yaw);
      return Math.abs(x * cos - z * sin) <= structure.footprint[0] / 2 + 2
        && Math.abs(x * sin + z * cos) <= structure.footprint[1] / 2 + 2;
    })) continue;
    if (location.kind === "water") continue;
    if (WORLD_SITES.some((site) => site.locationId === location.id)) continue;
    // The regional Essence Cache and its altar share a centre. Keep the purpose-built 12.5 m court
    // above instead of layering the generic seven-metre interaction pad over the same ground.
    if (essenceAltars.some((altar) => (
      altar.position[0] === location.position[0] && altar.position[1] === location.position[1]
    ))) continue;
    flats.push({ x: location.position[0], z: location.position[1], radius: 7, blend: 9 });
  }

  return flats;
}

/**
 * How far the flat ground has to reach: the furthest corner of anything the settlement places,
 * plus a margin for the eaves and the doorstep.
 *
 * A building's footprint is its wall grid; the roof overhangs it and the player has to be able to
 * stand at the door, so the margin is generous rather than tight. Walls and gatehouses count too —
 * a wall segment leaning out of a hillside reads exactly as broken as a house does.
 */
function settlementRadius(settlement: SettlementDef): number {
  let furthest = 0;
  const reach = (x: number, z: number): void => {
    furthest = Math.max(furthest, Math.hypot(x - settlement.centre[0], z - settlement.centre[1]));
  };

  for (const building of settlement.buildings) {
    // The footprint is authored in the building's own frame, so its half-diagonal covers any yaw.
    const half = Math.hypot(building.footprint[0], building.footprint[1]) / 2;
    reach(building.position[0] + half, building.position[1] + half);
    reach(building.position[0] - half, building.position[1] - half);
    reach(building.position[0] + half, building.position[1] - half);
    reach(building.position[0] - half, building.position[1] + half);
  }
  for (const station of settlement.stations) reach(station.position[0], station.position[1]);
  for (const shop of settlement.shops) reach(shop.position[0], shop.position[1]);
  for (const npc of settlement.npcs) reach(npc.position[0], npc.position[1]);
  reach(settlement.bank.position[0], settlement.bank.position[1]);

  // SETTLEMENT_PAD_MARGIN covers the roof overhang and a walkable step off the doorstep; the floor
  // keeps a small settlement from getting a pad tighter than its own square.
  return Math.max(24, Math.ceil(furthest + SETTLEMENT_PAD_MARGIN));
}

/**
 * Visual biomes follow climate and authored places, never the semantic region rectangles. Round
 * intents protect important hubs. Corridors loosely connect related places. The two broad climate
 * channels decide the unclaimed land, so borders can fork, double back, and reach the coast.
 */
const COREALM_BIOMES: OrganicBiomeSpec<RegionId> = {
  warp: {
    seed: seedFromText("corealm:biome-warp"),
    scale: 180,
    strength: 52,
  },
  climate: {
    seed: seedFromText("corealm:biome-climate"),
    scales: [310, 112],
    strength: 0.72,
  },
  edgeScale: 76,
  edgeStrength: 0.5,
  temperature: 0.5,
  fields: [
    {
      id: 'crownward', seed: seedFromText('corealm:biome:crownward'),
      climateTarget: [-.35, -.6], climateTolerance: [.52, .55], bias: 1,
      // Crownward is a continuous coastal region. Warped geographical gradients carry its
      // parkland beyond the landmarks and to the shore, then yield to the northern wastes.
      eastwardClimate: { startX: 180, endX: 500, strength: 6 },
      northwardClimate: { startZ: 100, endZ: 900, strength: -3 },
      anchors: [
        {id:'white-castle',centre:[550,-60],radius:110,holdRadius:48,strength:3},
        {id:'royal-borough',centre:[490,-42],radius:80,holdRadius:42,strength:2.2},
        {id:'royal-maples',centre:[445,-115],radius:82,holdRadius:35,strength:2},
        {id:'crown-quarry',centre:[625,-135],radius:86,holdRadius:32,strength:2},
        {id:'fairy-garden',centre:[470,100],radius:105,holdRadius:42,strength:2.4},
        {id:'silverthorn-park',centre:[630,105],radius:115,holdRadius:44,strength:2.4},
        {id:'argent-cut',centre:[640,220],radius:90,holdRadius:34,strength:2},
        {id:'whitebough-copse',centre:[445,310],radius:90,holdRadius:38,strength:2},
        {id:'ivory-citadel',centre:[560,320],radius:110,holdRadius:48,strength:2.5},
        {id:'northern-royal-road',centre:[550,418],radius:70,holdRadius:22,strength:1.6},
      ],
      corridors: [{from:[490,-42],to:[470,100],halfWidth:32,strength:.7},
        {from:[470,100],to:[560,320],halfWidth:35,strength:.7}],
    },
    {
      id:'wilderness',seed:seedFromText('corealm:biome:wilderness'),
      climateTarget:[-.25,.1],climateTolerance:[.85,.85],
      // A long, low-gradient climate trend leaves room for dusk and mixed vegetation.
      // The old 11-point logit crossed almost the entire day/night range in twenty metres.
      northwardClimate:{startZ:280,endZ:740,strength:4.5},bias:1.25,
      eastwardClimate:{startX:260,endX:460,strength:2},
      anchors:[
        {id:'black-knight-castle',centre:[40,600],radius:46,holdRadius:34,strength:1.8},
        {id:'unnamed-graves',centre:[-205,585],radius:36,holdRadius:16,strength:1.4},
        {id:'dead-boughs',centre:[-286,638],radius:38,holdRadius:24,strength:1.2},
        {id:'silent-stones',centre:[-80,680],radius:36,holdRadius:18,strength:1.3},
        {id:'petrified-grove',centre:[255,640],radius:43,holdRadius:26,strength:1.5},
      ],
      corridors:[{from:[-220,568],to:[-205,585],halfWidth:20,strength:.35},
        {from:[40,600],to:[55,657],halfWidth:26,strength:.5}],
    },
    {
      id: "fallowmarch",
      seed: seedFromText("corealm:biome:fallowmarch"),
      climateTarget: [-0.12, -0.4],
      climateTolerance: [0.68, 0.62],
      bias: 0.07,
      anchors: [
        { id: "coldbrace", centre: [-160, -80], radius: 48, strength: 1.65 },
        { id: "bracken-pit", centre: [-160, 80], radius: 38, strength: 1.25 },
        { id: "palewood-copse", centre: [-334, -64], radius: 34, strength: 1.4 },
        { id: "marchfield", centre: [-96, -22], radius: 36, strength: 1.3 },
        { id: "redsill-shallows", centre: [-40, -60], radius: 34, strength: 1.15 },
        { id: "open-march", centre: [-250, 30], radius: 44, strength: 1.1 },
        { id: "corven-ford", centre: [-72, -146], radius: 32, strength: 1.05 },
        { id: "south-march", centre: [-250, -150], radius: 40, strength: 1.0 },
        { id: "west-bluff", centre: [-395, -20], radius: 26, strength: 1.0 },
        { id: "west-headland", centre: [-430, 35], radius: 26, strength: 1.0 },
        { id: "western-rise", centre: [-345, 45], radius: 34, strength: 1.0 },
        { id: "corven-lowland", centre: [-130, -165], radius: 34, strength: 1.0 },
      ],
      corridors: [
        { from: [-160, -80], to: [-250, 30], halfWidth: 30, strength: 0.64 },
        { from: [-250, 30], to: [-160, 80], halfWidth: 28, strength: 0.58 },
        { from: [-160, -80], to: [-96, -22], halfWidth: 24, strength: 0.56 },
        { from: [-395, -20], to: [-430, 35], halfWidth: 16, strength: 0.5 },
        { from: [-250, -150], to: [-330, -230], halfWidth: 20, strength: 0.55 },
      ],
    },
    {
      id: "vellenwood",
      seed: seedFromText("corealm:biome:vellenwood"),
      climateTarget: [0.36, -0.2],
      climateTolerance: [0.64, 0.64],
      bias: 0.03,
      anchors: [
        { id: "marchgate-fold", centre: [-26, 118], radius: 30, strength: 1.45 },
        { id: "rootfall", centre: [60, 120], radius: 46, strength: 1.6 },
        { id: "duskoak-stand", centre: [14, 166], radius: 36, strength: 1.4 },
        { id: "blackwater-pools", centre: [128, 84], radius: 40, strength: 1.45 },
        { id: "gorge-ford", centre: [230, 44], radius: 34, strength: 1.35 },
        { id: "thornline", centre: [196, 152], radius: 40, strength: 1.3 },
        { id: "earth-essence-cache", centre: [262, 176], radius: 34, strength: 1.2 },
        { id: "cairn-gate", centre: [250, 24], radius: 28, holdRadius: 5, strength: 1.45 },
        { id: "gorge-head", centre: [104, 192], radius: 32, strength: 1.2 },
        // These two claimed the old render collar past z = 200. Now that band is playable
        // Kilnhalt, they shrink to a feathered overreach just across the seam, so the woodland
        // hands off to ember footland smoothly rather than at a straight z = 200 line.
        { id: "rainfold", centre: [-45, 218], radius: 20, strength: 0.9 },
        { id: "north-hollow", centre: [20, 224], radius: 18, strength: 0.85 },
      ],
      corridors: [
        { from: [-26, 118], to: [60, 120], halfWidth: 25, strength: 0.68 },
        { from: [60, 120], to: [128, 84], halfWidth: 28, strength: 0.64 },
        { from: [128, 84], to: [230, 44], halfWidth: 25, strength: 0.56 },
        { from: [230, 44], to: [196, 152], halfWidth: 24, strength: 0.52 },
        { from: [196, 152], to: [262, 176], halfWidth: 20, strength: 0.5 },
        { from: [-45, 245], to: [20, 270], halfWidth: 16, strength: 0.5 },
      ],
    },
    {
      id: "karrowmoor",
      seed: seedFromText("corealm:biome:karrowmoor"),
      climateTarget: [-0.5, 0.08],
      climateTolerance: [0.58, 0.7],
      bias: 0.1,
      anchors: [
        { id: "moorgate", centre: [256, 4], radius: 28, holdRadius: 5, strength: 1.55 },
        { id: "lower-quarry", centre: [140, -16], radius: 40, strength: 1.4 },
        { id: "highcairn", centre: [144, -66], radius: 46, strength: 1.65 },
        { id: "upper-seam", centre: [194, -132], radius: 40, strength: 1.35 },
        { id: "great-cairn", centre: [140, -176], radius: 32, strength: 1.2 },
        { id: "cairn-tarns", centre: [206, -88], radius: 34, strength: 1.25 },
        { id: "ridge-pines", centre: [250, -96], radius: 36, strength: 1.25 },
        { id: "far-tarn", centre: [284, -110], radius: 34, strength: 1.2 },
        { id: "south-ridge", centre: [170, -214], radius: 38, strength: 1.0 },
        { id: "far-uplift", centre: [310, -180], radius: 40, strength: 1.0 },
      ],
      corridors: [
        { from: [140, -16], to: [144, -66], halfWidth: 28, strength: 0.64 },
        { from: [144, -66], to: [194, -132], halfWidth: 30, strength: 0.66 },
        { from: [194, -132], to: [140, -176], halfWidth: 24, strength: 0.52 },
        { from: [206, -88], to: [284, -110], halfWidth: 26, strength: 0.58 },
        { from: [0, -245], to: [45, -290], halfWidth: 16, strength: 0.5 },
      ],
    },
    {
      // Ember footland: warm and dry against every southern neighbour, so the unclaimed land
      // north of the seam falls to it naturally and the border with the woodland forks rather
      // than tracking z = 200.
      id: "kilnhalt",
      seed: seedFromText("corealm:biome:kilnhalt"),
      climateTarget: [0.08, 0.52],
      climateTolerance: [0.66, 0.6],
      bias: 0.08,
      anchors: [
        { id: "emberfast", centre: [0, 330], radius: 50, strength: 1.65 },
        { id: "kilnroad-fork", centre: [0, 254], radius: 34, strength: 1.2 },
        { id: "clinker-quarry", centre: [-250, 330], radius: 42, strength: 1.35 },
        { id: "cinderpine-stand", centre: [240, 340], radius: 38, strength: 1.35 },
        { id: "ashfin-springs", centre: [210, 250], radius: 34, strength: 1.3 },
        { id: "fire-cache", centre: [290, 400], radius: 36, strength: 1.25 },
        { id: "cinderwake-arena", centre: [286, 420], radius: 26, strength: 1.2 },
        { id: "west-burn", centre: [-200, 410], radius: 42, strength: 1.05 },
        { id: "northwest-rise", centre: [-320, 430], radius: 32, strength: 1.0 },
        { id: "seam-west", centre: [-160, 232], radius: 30, strength: 1.1 },
        { id: "seam-mid", centre: [60, 228], radius: 28, strength: 1.0 },
        { id: "north-shoulder", centre: [80, 440], radius: 36, strength: 1.0 },
      ],
      corridors: [
        { from: [0, 254], to: [0, 330], halfWidth: 26, strength: 0.64 },
        { from: [0, 330], to: [-250, 330], halfWidth: 28, strength: 0.58 },
        { from: [0, 330], to: [240, 340], halfWidth: 26, strength: 0.58 },
        { from: [210, 250], to: [240, 340], halfWidth: 22, strength: 0.52 },
        { from: [240, 340], to: [290, 400], halfWidth: 20, strength: 0.52 },
        { from: [-160, 232], to: [-250, 330], halfWidth: 22, strength: 0.5 },
      ],
    },
  ],
};

export function buildWorldTerrainSpec(): WorldTerrainSpec {
  const surfaceRegions = REGIONS.filter(region => !isFairyRegion(region.id));
  const regions: RegionTerrainSpec[] = surfaceRegions.map((region) => {
    const spec: RegionTerrainSpec = {
      regionId: region.id,
      rect: rectOf(region),
      seed: region.terrainSeed,
      character: characterOf(region.id),
      baseHeight: region.baseHeight,
      amplitude: region.terrainAmplitude,
    };
    // Karrowmoor's terraces are authored as z-bands climbing toward -z.
    if (region.terraces && region.terraces.length > 0) {
      spec.terraceAxis = "-z";
      spec.terraceSteps = region.terraces.length;
    }
    return spec;
  });

  const flats = surfaceRegions.flatMap((region) => flatSpotsFor(region));
  const basins = surfaceRegions.flatMap((region) => region.clusters
    .filter((cluster) => !cluster.waterBodyId && resourceDef(cluster.resourceId).archetype === "fishing_spot")
    .map(waterBasinForCluster));

  const minX = Math.min(...regions.map((region) => region.rect.minX));
  const maxX = Math.max(...regions.map((region) => region.rect.maxX));
  const minZ = Math.min(...regions.map((region) => region.rect.minZ));
  const maxZ = Math.max(...regions.map((region) => region.rect.maxZ));

  return {
    bounds: { minX, maxX, minZ, maxZ },
    chunkSize: 100,
    metresPerQuad: 2,
    // Narrower than the renderer's 45 m default: the regions meet at a T-junction here, and a wide
    // band would smear Karrowmoor's terrace risers into Vellenwood's mounds at the corner.
    blendMetres: 28,
    regions,
    flats,
    basins,
    lavaChannels: WILDERNESS_LAVA_CHANNELS,
    waterChannels: CROWNWARD_RIVER_CHANNELS,
    worldSites: WORLD_SITES.filter(site => !isFairyRegion(site.regionId)),
    portalLandforms: REGIONS.flatMap((region) => region.dungeon
      ? [{ centre: region.dungeon.entrance, rotationY: region.dungeon.entranceRotationY ?? 0 }]
      : []),
    biomes: COREALM_BIOMES,
    // The bounds above describe semantic regions. Dry coastal land is also playable.
    coast: {
      seed: seedFromText("corealm:coast"),
      collar: 210,
      shoreline: [18, 190] as const,
      seaLevel: -5.25,
      floorDepth: 3,
      // Match the terrain lattice so coastal navigation and physics share a continuous seam.
      gridStep: 2,
      oceanSize: 2400,
    },
  };
}

/** The spawn point, taken from the starting region's authored value. */
export function buildFairyTerrainSpec(): WorldTerrainSpec {
  const regions: RegionTerrainSpec[] = FAIRY_REGIONS.map(region => ({
    regionId: region.id, rect: rectOf(region), seed: region.terrainSeed,
    character: "woodland", baseHeight: region.baseHeight, amplitude: 1.5,
  }));
  return {
    bounds: { minX: 2000, maxX: 2600, minZ: -200, maxZ: 460 },
    chunkSize: 100, metresPerQuad: 1, blendMetres: 35, regions, fairyLandforms: true,
    flats: [...[...LANTERN_REST_FOUNDATIONS, ...PRISM_HOLLOW_FOUNDATIONS].map(footing => ({ ...footing, landformFooting: true })),
      ...FAIRY_REGIONS.flatMap(region => flatSpotsFor({ ...region, settlement: undefined,
        locations: region.locations.filter(location => !location.id.startsWith('lantern_rest_')
          && !location.id.startsWith('prism_hollow_') && !location.id.includes('_ascent_')) }))],
    worldSites: WORLD_SITES.filter(site => isFairyRegion(site.regionId)),
    biomes: {
      warp: { seed: seedFromText('corealm:fairy-warp'), scale: 180, strength: 32 },
      climate: { seed: seedFromText('corealm:fairy-climate'), scales: [210, 75], strength: 1 },
      edgeScale: 65, edgeStrength: .2, temperature: .7,
      fields: FAIRY_REGIONS.map((region, index) => ({
        id: region.id, seed: region.terrainSeed, climateTarget: [index ? .4 : -.3, index ? .3 : -.3],
        climateTolerance: [.7, .7], bias: 0,
        anchors: region.locations.filter(location => location.kind !== 'junction').map(location => ({
          id: location.id, centre: location.position, radius: 58, holdRadius: 24, strength: 1.7,
        })),
      })),
    },
  };
}

export function startingSpawn(): { regionId: RegionId; x: number; z: number } {
  const region = REGIONS.find((candidate) => candidate.id === "fallowmarch") ?? REGIONS[0]!;
  return { regionId: region.id, x: region.spawnPoint[0], z: region.spawnPoint[1] };
}
