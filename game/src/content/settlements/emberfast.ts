/**
 * Emberfast — the tier 20 settlement, in Kilnhalt, centred on (0,330).
 *
 * Split out like the other three settlements; `regions.ts` imports the data straight into
 * `KILNHALT` and owns the types, validation and coordinate contract.
 *
 * WHAT THIS IS. A kiln camp at the middle of the ember foothills: a walled rectangle whose plan is
 * Highcairn's measured 44 x 28 m layout translated whole to (0,330) — every roof-clearance,
 * door-facing, gate-span and station-reach number in `settlements/highcairn.ts` was verified in
 * the browser, so Emberfast reuses that arithmetic instead of re-deriving it and only documents
 * what differs. Differences:
 *
 *  - No crane and no garden.
 *    (regions.ts), so the garden fence is gone; the crane's working half of the yard instead
 *    holds the WORKS ROW, a second arcade carrying the crafting table and fletching bench.
 *    Emberfast is the first settlement with the complete production set inside one wall: bank,
 *    general store, smith shop, furnace, anvil, range, crafting table and fletching bench.
 *  - Everything keeps the `stone` kit. The kiln camp builds in fired brick and dark stone;
 *    the region's own `ARCHITECTURE_PALETTES.kilnhalt` supplies the ember colour grade, which is
 *    how a fourth vernacular ships without a fourth building kit.
 *
 * The translation from Highcairn is exactly (dx, dz) = (-142, +391). Wall circuit x [-20,20]
 * z [317,343], both gate openings centred on z = 333, pad 44 x 28 m.
 */
import type { SettlementDef } from "../regions.js";

export const EMBERFAST: SettlementDef = {
  id: "emberfast",
  name: "Ashford",
  kit: "stone",
  centre: [0, 330],
  respawnPointId: "emberfast",

  padShape: { halfX: 22, halfZ: 14, rotationY: 0 },

  walls: [
    {
      // The south rampart faces the long open approach from the old border, and is the lit edge:
      // the first thing a player walking up from Vellenwood or Fallowmarch sees of the town.
      id: "emberfast_wall_s", name: "South Rampart",
      from: [-20, 317], to: [20, 317],
    },
    {
      id: "emberfast_wall_e", name: "East Wall",
      from: [20, 317], to: [20, 343],
      openings: [{ at: 16, width: 8 }],
    },
    { id: "emberfast_wall_n", name: "North Wall", from: [20, 343], to: [-20, 343] },
    {
      id: "emberfast_wall_w", name: "West Wall",
      from: [-20, 343], to: [-20, 317],
      openings: [{ at: 10, width: 8 }],
    },
  ],

  buildings: [
    // NORTH ROW, doors south onto the yard (prefab door leaf on LOCAL -Z).
    { id: "emberfast_hut_1", name: "Kiln Crew Hut", prefab: "quarry_hut", position: [-5, 339], rotationY: 0, footprint: [6, 4] },
    { id: "emberfast_hut_3", name: "Store Hut", prefab: "shed", position: [4, 339], rotationY: 0, footprint: [4, 4] },
    { id: "emberfast_hut_4", name: "Watch Hut", prefab: "tower", position: [13, 339], rotationY: 0, footprint: [4, 4] },

    // SOUTH ROW, doors north across the yard.
    { id: "emberfast_hut_6", name: "Long Hut", prefab: "quarry_hut", position: [-16, 320.5], rotationY: Math.PI, footprint: [6, 4] },
    { id: "emberfast_hut_5", name: "Tool Hut", prefab: "quarry_hut", position: [-5.8, 320.5], rotationY: Math.PI, footprint: [6, 4] },
    {
      // Mouth north at the yard; the furnace and anvil live inside, exactly as at Highcairn.
      id: "emberfast_forge", name: "Kiln Forge", prefab: "forge",
      position: [2, 321], rotationY: 0, footprint: [6, 4],
    },
    {
      id: "emberfast_bank_porch", name: "Bank Counter", prefab: "porch",
      position: [8.8, 321.4], rotationY: 0, footprint: [4, 3],
    },
    { id: "emberfast_hut_2", name: "Firemaster's Hut", prefab: "cottage", position: [15, 320.5], rotationY: Math.PI, footprint: [6, 4] },

    {
      // The covered market row, open face north: store pitch and cook fire.
      id: "emberfast_market", name: "Ember Row", prefab: "arcade",
      position: [-5.4, 327.6], rotationY: 0, footprint: [6, 3],
    },
    {
      // THE WORKS ROW — where Highcairn parks its crane tackle. Open face north like the market
      // row; holds the crafting table and fletching bench, so every production verb in the region
      // is under a roof inside the wall.
      id: "emberfast_works", name: "Kiln Works", prefab: "arcade",
      position: [12, 327.6], rotationY: 0, footprint: [6, 3],
    },

    // GATEHOUSES in their wall openings, [8,4] for the full 4 m clear span.
    { id: "emberfast_gate", name: "Ashford Gate", prefab: "gatehouse", position: [20, 333], rotationY: Math.PI / 2, footprint: [8, 4] },
    { id: "emberfast_postern", name: "Quarry Postern", prefab: "gatehouse", position: [-20, 333], rotationY: -Math.PI / 2, footprint: [8, 4] },
  ],

  paving: [
    { id: "emberfast_yard", rect: { minX: -8, minZ: 321, maxX: 14, maxZ: 337 }, assetId: "floor_brick" },
    { id: "emberfast_gate_road", rect: { minX: 14, minZ: 331, maxX: 24, maxZ: 335 }, assetId: "floor_brick" },
    { id: "emberfast_postern_apron", rect: { minX: -20, minZ: 331, maxX: -14, maxZ: 333 }, assetId: "floor_brick" },
    { id: "emberfast_postern_outer_apron", rect: { minX: -24, minZ: 331, maxX: -20, maxZ: 335 }, assetId: "floor_brick" },
  ],

  stations: [
    {
      id: "emberfast_furnace", name: "Ashford Furnace", kind: "furnace", skill: "smithing",
      position: [0.7, 320.4], rotationY: 0, assetId: "cauldron", scale: 2, recipeIds: [],
      attachedTo: "emberfast_forge",
    },
    {
      id: "emberfast_anvil", name: "Ashford Anvil", kind: "anvil", skill: "smithing",
      position: [3, 321.8], rotationY: 0, assetId: "anvil", scale: 1.4, recipeIds: [],
      attachedTo: "emberfast_forge",
    },
    {
      id: "emberfast_range", name: "Ashford Cooking Range", kind: "range", skill: "cooking",
      position: [-3.8, 327.2], rotationY: 0, assetId: "cooking_pot", scale: 2.2, recipeIds: [],
      attachedTo: "emberfast_market",
    },
    {
      // Under the works row's west bay. Same asset choices as Coldbrace's proven pair.
      id: "emberfast_crafting", name: "Ashford Crafting Table", kind: "crafting_table", skill: "crafting",
      position: [10.6, 327.2], rotationY: 0, assetId: "workbench", recipeIds: [],
      attachedTo: "emberfast_works",
    },
    {
      id: "emberfast_fletching", name: "Ashford Fletching Bench", kind: "fletching_bench", skill: "fletching",
      position: [13.4, 327.2], rotationY: 0, assetId: "weapon_rack", scale: 1.3, recipeIds: [],
      attachedTo: "emberfast_works",
    },
  ],

  bank: {
    id: "emberfast_bank_counter", name: "Ashford Bank",
    position: [8, 321], rotationY: 0, assetId: "chest_wood",
    attachedTo: "emberfast_bank_porch",
  },

  shops: [
    {
      id: "emberfast_general", name: "Ashford Provisioners", shopKind: "general",
      position: [-6.1, 327.1], rotationY: Math.PI, assetId: "market_stall",
      attachedTo: "emberfast_market",
    },
    {
      id: "emberfast_smith", name: "Kiln Row Smith", shopKind: "smith",
      position: [6, 325.4], rotationY: 0, assetId: "market_stall_cart",
      attachedTo: "emberfast_forge",
    },
  ],

  // The Phase 2 amendment ships settlement services without a quest chain, so Emberfast opens
  // with counters rather than conversations. NPC stands arrive with Kilnhalt's quest wave.
  npcs: [],

  props: [
    // --- The gate sconces, on the piers' inner faces.
    { id: "emberfast_gate_torch_n", assetId: "torch", position: [18.4, 334.7], rotationY: -Math.PI / 2, scale: 2.2, dy: 1.8 },
    { id: "emberfast_gate_torch_s", assetId: "torch", position: [18.4, 331.3], rotationY: -Math.PI / 2, scale: 2.2, dy: 1.8 },

    // --- The south rampart, lit on its inner face like Highcairn's.
    { id: "emberfast_rampart_torch_1", assetId: "torch", position: [-14, 317.2], rotationY: 0, scale: 2.6, dy: 2 },
    { id: "emberfast_rampart_torch_2", assetId: "torch", position: [-4, 317.2], rotationY: 0, scale: 2.6, dy: 2 },
    { id: "emberfast_rampart_torch_3", assetId: "torch", position: [7, 317.2], rotationY: 0, scale: 2.6, dy: 2 },
    { id: "emberfast_rampart_torch_4", assetId: "torch", position: [16, 317.2], rotationY: 0, scale: 2.6, dy: 2 },

    // --- Wall lanterns on the yard-facing hut faces; dy 0.9 clears the stone-kit eave.
    { id: "emberfast_lamp_hut1", assetId: "lamp_wall", position: [-3.4, 336.95], rotationY: Math.PI, scale: 1.15, dy: 0.9 },
    { id: "emberfast_lamp_hut3", assetId: "lamp_wall", position: [5.6, 336.95], rotationY: Math.PI, scale: 1.15, dy: 0.9 },
    { id: "emberfast_lamp_hut4", assetId: "lamp_wall", position: [14.6, 336.95], rotationY: Math.PI, scale: 1.15, dy: 0.9 },
    { id: "emberfast_lamp_hut2", assetId: "lamp_wall", position: [16.6, 322.55], rotationY: 0, scale: 1.15, dy: 0.9 },
    { id: "emberfast_lamp_hut6", assetId: "lamp_wall", position: [-14.4, 322.55], rotationY: 0, scale: 1.15, dy: 0.9 },

    // --- Slag heaps where Highcairn keeps its spoil: the kiln's own waste, west of the yard.
    { id: "emberfast_slag_1", assetId: "rock_medium_1", position: [-11, 323.4], rotationY: 0.6, scale: 0.9, solid: true },
    { id: "emberfast_slag_2", assetId: "rock_medium_3", position: [-10.9, 320.4], rotationY: 2.2, scale: 0.55, solid: true },

    // --- The ore cart along the north edge of the yard, the one solid prop on the desire lines.
    { id: "emberfast_wagon", assetId: "wagon", position: [8, 334.5], rotationY: 1.5, solid: true },

    // --- Inside the forge and in its yard.
    { id: "emberfast_forge_whetstone", assetId: "whetstone", position: [0.2, 322.6], rotationY: 0 },
    { id: "emberfast_forge_rack", assetId: "weapon_rack", position: [3.6, 319.7], rotationY: 0 },
    { id: "emberfast_forge_barrel", assetId: "barrel", position: [5.6, 322.4], rotationY: 0 },
    { id: "emberfast_forge_sack", assetId: "sack", position: [-1.8, 322.4], rotationY: 1.1 },
    { id: "emberfast_forge_crate", assetId: "crate_wood", position: [-1.3, 325.4], rotationY: 0.6 },

    // --- Under and in front of Ember Row.
    { id: "emberfast_row_barrel", assetId: "barrel", position: [-2.6, 329], rotationY: 0 },
    { id: "emberfast_row_sack", assetId: "sack", position: [-7.9, 328.7], rotationY: 0.4 },
    { id: "emberfast_row_table", assetId: "table_large", position: [-5.6, 329.6], rotationY: 0, scale: 0.9 },

    // --- The works row's bench dressing.
    { id: "emberfast_works_crate", assetId: "crate_wood", position: [9.6, 329.4], rotationY: 0.9 },

    // --- The bank counter under the porch.
    { id: "emberfast_bank_table", assetId: "table_large", position: [8.6, 322.4], rotationY: 0, scale: 0.85 },
    { id: "emberfast_bank_torch_l", assetId: "torch", position: [7.6, 321.5], rotationY: 0, scale: 2.2, dy: 1.55 },
    { id: "emberfast_bank_torch_r", assetId: "torch", position: [10, 321.5], rotationY: 0, scale: 2.2, dy: 1.55 },
    { id: "emberfast_bank_bench", assetId: "bench", position: [9, 324], rotationY: 0 },
    { id: "emberfast_bank_sack", assetId: "sack", position: [10.3, 320.7], rotationY: 0.7 },

    // --- The woodpile in the west alley, cinderpine billets for the kiln.
    { id: "emberfast_woodpile_1", assetId: "roof_log", position: [-19.25, 319.4], rotationY: 0, scale: 0.26 },
    { id: "emberfast_woodpile_2", assetId: "roof_log", position: [-18.9, 319.4], rotationY: 0, scale: 0.26 },
    { id: "emberfast_woodpile_3", assetId: "roof_log", position: [-19.075, 319.4], rotationY: 0, scale: 0.26, dy: 0.31 },

    // --- Slabs down the service alley behind the north row.
    { id: "emberfast_path_1", assetId: "path_rock_square_wide", position: [-0.5, 341.7], rotationY: 0 },
    { id: "emberfast_path_2", assetId: "path_rock_square_wide", position: [8.5, 341.7], rotationY: 0 },
    { id: "emberfast_path_3", assetId: "path_rock_square_wide", position: [17.5, 341.7], rotationY: 0 },

    // --- Doorstep dressing.
    { id: "emberfast_hut1_barrel", assetId: "barrel", position: [-1.8, 336.2], rotationY: 0 },
    { id: "emberfast_hut3_bench", assetId: "bench", position: [2.6, 335], rotationY: 0 },
    { id: "emberfast_hut4_rack", assetId: "weapon_rack", position: [17.2, 336.4], rotationY: -Math.PI / 2 },
    { id: "emberfast_hut2_crate", assetId: "crate_wood", position: [18.4, 322.6], rotationY: 0.4 },
    { id: "emberfast_hut6_sack", assetId: "sack", position: [-12.8, 320.8], rotationY: 1.4 },
  ],
};
