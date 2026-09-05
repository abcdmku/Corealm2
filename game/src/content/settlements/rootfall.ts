/**
 * Rootfall — the tier 5 settlement, in Vellenwood, centred on (60,120).
 *
 * Split out of `content/regions.ts` so the three settlements can be authored independently; the
 * file's only export is the data, and `regions.ts` imports it straight back into `VELLENWOOD`.
 * The types, the validation and the coordinate contract all still live in `regions.ts`.
 *
 * Three coordinates here are load-bearing and are measured, not chosen. The bank chest at (60,128)
 * is 38.0 m from the Hollowcut Seam, which is the tier-5 half of the route-optimisation flip in
 * the DISTANCE LEDGER at the top of `regions.ts`. The Root Tunnel entrance at (86,138) and the
 * Canopy Walk entrance at (40,138) are Agility obstacles authored in `regions.ts`; a building
 * footprint or a palisade module that swallows either one deletes a shortcut.
 *
 * WHAT THIS LAYOUT REPLACES, and why every number moved.
 *
 * Measured on the previous layout (runs/corealm/diagnosis/settlement-layout-coldbrace-rootfall-hig
 * .md, plan view 2): 0 m of wall on a 140 m perimeter, 0 gatehouses, a 23 x 27 m (621 m2) empty
 * green with a chest, an anvil and a cooking pot standing loose on grass in it, five of nine
 * buildings presenting a blank rear wall to that green, one shop, two stations, and no light
 * source at all in a region whose `fogStart` is 55 m. That is the player's "a bunch of random
 * assets thrown on a board", verbatim, and it is what the `walls` / `paving` / `props` /
 * `attachedTo` / `padShape` vocabulary was added to fix.
 *
 * THE PLAN. A logging town inside a timber palisade on a 156 m circuit, x [44,80] z [102,144],
 * with four gatehouses standing IN the openings rather than beside them. 1 char = 2 m:
 *
 *   144 |##################gggg####    <- north wall, Log Gate at x 74
 *   142 |#  SSS                   #
 *   140 |#  SSS  aaa    HHH   fff #       S drying shed   a sawpit arcade
 *   138 |#  SSS  ,,,    HHH   fff #       H north house   f forge (mouth south)
 *   136 |#  ,,,  ,,,    HHH   fff #
 *   134 |#  111  ,,,              #       1 Stumpside House   r Root Tunnel is east of the postern
 *   132 |#  111  ,,,  ppp     777 #       p bank + trade counter under a porch
 *   130 |#  111  ,,,,,,,,,,   777 #       7 Warden's House
 *   128 |g  ,,,,,,,,,,,,,,,   777 #       , plank decking (green / yards / roads)
 *   126 |g  ,,,,,,,,,,,,,,,       #
 *   124 |g  ,,,,,,,,,,,,,,,       #     <- West Gate at z 124
 *   122 |g  ,,,,,,,,,,,,,,,   666 #       6 Seamer's House
 *   120 |#  222  ,,,,@@,,,,   666 #       @ the Duskoak stump
 *   118 |#  222  ,,,,@@,,,,   666 #
 *   116 |#  222  ,w,,,,,,,,       #       w wellhead
 *   114 |#       ,,,,,,,,,,       #
 *   112 |#    fff  ccc  ,,,,,,,,,,g     <- Cart Gate at z 110
 *   110 |#  333 fff 444 ,,,,,,,,,,g       3 Trapper's House   4 Cook House   c cook shelter
 *   108 |#  333 fff 444    555    #       5 Root House        f fenced yard
 *   106 |#  333     444    555    #
 *   104 |#  fffffff               #
 *   102 |##########################
 *
 * Every doored building's door now faces the green or the street it stands on: houses 3, 4 and 5
 * were rotationY 0 (blank rear wall to the green) and are PI; house 8 was PI and is 0; the shed
 * was PI and is 0. Measured with the diagnosis's own metric — dot(door facing, direction to the
 * centre) — all nine are now positive, worst 0.71, where four of nine used to be negative.
 * `runs/corealm/audit/rf-check.ts` re-derives every number in this comment.
 *
 * ROOF CLEARANCE, and why the forge is 6x4. `ROOF_EAVE_METRES` is 1.73, which is the worst case in
 * the whole game and not the number to space by; `roofOverhang(prefab, footprint, kit)` gives the
 * real per-axis figure. For the timber kit that is 0.786 x 0.757 m on a 6x4 cottage and
 * 1.029 x 0.205 m on the 4x4 shed. A 6x5 forge is the trap: `roofFit` scales uniformly off the
 * tighter of the two ratios, so a 6x5 plan on the 4x6 roof asset fits at 1.25 and draws a 9.47 m
 * roof — an eave of 1.733 m that previously clipped the old, inside-wall Root Tunnel placement.
 * At 6x4 the forge takes the cottage's own fit and leaves a readable lane to the postern. Measured
 * across all 17 buildings, worst roof-to-roof interpenetration is
 * now zero; the Canopy Walk platform at (40,138) clears the west palisade by 2.80 m.
 *
 * Gate openings are authored at the gatehouse footprint's own width, 8 m, so `wallRunModules` cuts
 * exactly four 2 m modules and the two piers of the [8,4] gatehouse fill the outer two slots. Its
 * 4 m depth also keeps the return walls and decks on native 2 m modules. That leaves the full
 * `GATE_GAP_METRES` 4 m clear span the navmesh needs. 124 m of the 156 m circuit
 * is built wall, all four corners are shared by two runs, and every opening carries either a
 * gatehouse or the postern the bank road leaves by. It was 0 m of wall on 140 m before.
 *
 * Gate positions are on the roads that actually leave, not on the compass. Vellenwood's roads run
 * Rootfall -> Marchgate and -> Mire Skirt (both due west), -> Blackwater Pools (crosses x = 80 at
 * z = 110.5), -> Gorge Head (crosses z = 144 at x = 74.7) and bank -> Hollowcut Seam (crosses
 * x = 80 at z = 138.0). Hence gates at (44,124), (80,110) and (74,144) plus an 8 m Hollowcut
 * postern at z = 138 on the east wall. `curveRoadPolyline` sways a road by up to length * 0.09, so those
 * crossings are approximate to a few metres, which is why the openings are 8 m rather than 4.
 *
 * The south wall carries no gate on purpose: nothing in Vellenwood lies south of Rootfall, and a
 * gate onto nothing is the defect this pass exists to remove.
 */
import type { SettlementDef } from "../regions.js";

export const ROOTFALL: SettlementDef = {
  id: "rootfall",
  name: "Oakwood",
  // Exposed frame, a felled log along every ridge, dormers in the roof. A logging town.
  kit: "timber",
  centre: [60, 120],
  respawnPointId: "rootfall",

  /**
   * A rectangle, not a disc, because `settlementRadius()` measures only buildings, stations,
   * shops, NPCs and the bank — it does not see `walls`, so a palisade authored out at x = 42 and
   * x = 80 would stand on ground the pad never levelled and a wall run, which takes its whole
   * height from the ground at `from`, would bury one end and float the other.
   *
   * The core covers x [38,82] z [94,146], which contains every wall corner (x 44/80, z 102/144)
   * and all four gatehouse footprints (the Log Gate reaches z 146, the Cart Gate x 82). The
   * rectangle is symmetric about the settlement centre while the circuit is not, so it levels
   * about 8 m of ground south of the south wall and 6 m west of the west wall that nothing stands
   * on; that is the price of one rectangle rather than two.
   */
  padShape: { halfX: 22, halfZ: 26, rotationY: 0 },

  buildings: [
    // ---- the ring, all doors facing in ------------------------------------------------------
    // Door world positions are the prefab's side-2 face: local -Z, so world facing is
    // rotationY + PI and the door lands 0.55 m off the footprint's centre line.
    // One metre of breathing room keeps both eaves clear of the west gate crown and return wall.
    { id: "rootfall_house_1", name: "Stumpside House", prefab: "cottage", position: [50, 131], rotationY: -Math.PI / 2, footprint: [6, 4] },
    { id: "rootfall_house_2", name: "Woodward's House", prefab: "cottage", position: [50, 117], rotationY: -Math.PI / 2, footprint: [6, 4] },
    // Houses 3, 4 and 5 were rotationY 0 and showed the green a blank gable end. PI turns the door
    // north onto it.
    { id: "rootfall_house_3", name: "Trapper's House", prefab: "cottage", position: [52, 108], rotationY: Math.PI, footprint: [6, 4] },
    { id: "rootfall_house_4", name: "Cook House", prefab: "cottage", position: [62, 108], rotationY: Math.PI, footprint: [6, 4] },
    // 2 m further south than its neighbours so it is beside the Cart Gate's 4 m passage
    // (z 108..112) rather than 3 m in front of it.
    { id: "rootfall_house_5", name: "Root House", prefab: "cottage", position: [72, 106], rotationY: Math.PI, footprint: [6, 4] },
    { id: "rootfall_house_6", name: "Seamer's House", prefab: "cottage", position: [72, 118], rotationY: Math.PI / 2, footprint: [6, 4] },
    // Its roof stops at z 131.79 and x 74.76, clear of both the forge and postern approach.
    { id: "rootfall_house_7", name: "Warden's House", prefab: "townhouse", position: [72, 128], rotationY: Math.PI / 2, footprint: [6, 4] },
    { id: "rootfall_house_8", name: "North House", prefab: "cottage", position: [61, 138], rotationY: 0, footprint: [6, 4] },
    // The widened fitted roof stays 0.35 m inside the west palisade at this authored position.
    { id: "rootfall_shed", name: "Drying Shed", prefab: "shed", position: [48, 140], rotationY: 0, footprint: [4, 4] },

    // ---- the open structures ----------------------------------------------------------------
    // These are the answer to "a random bank chest and anvil just tossed in the middle of town".
    // None of them has a doorway, so none of them pinches shut under the navmesh's 0.45 m cell:
    // the player walks in and stands at the thing.
    //
    // The forge's open face is LOCAL +Z, so PI points the mouth south at the yard. Its collision
    // is three 0.6 m boxes (back z 138.4..139.0, sides x 67.5..68.1 and 72.9..73.5), leaving a
    // 4.8 x 3.4 m interior open along z = 135.
    //
    // 6x4, not the diagnosis's 6x5. `roofFit` scales uniformly off the tighter of the two ratios,
    // so a 6x5 plan on a 4x6 roof asset fits at 1.25 and draws a 9.47 m roof: an eave of 1.733 m
    // into the postern lane. At 6x4 the roof is the cottage's own fit and the eave is 0.786 m.
    { id: "rootfall_forge", name: "Oakwood Forge", prefab: "forge", position: [70.5, 137], rotationY: Math.PI, footprint: [6, 4] },
    // Three covered bays over one back wall: the sawpit's work row. Back wall at z 138.5, canopy
    // out to z 136.5, and the only solid is the wall behind the benches.
    { id: "rootfall_sawpit", name: "The Sawpit", prefab: "arcade", position: [54, 137], rotationY: Math.PI, footprint: [6, 3] },
    // The bank counter. The chest cannot move — (60,128) is the 38.0 m Hollowcut number — so the
    // roof comes to the chest. `porch` projects CANOPY_DEPTH_METRES 2 from its back edge, hence a
    // 2.2 m depth: back wall at z 129.7, posts at z 127.82, chest at z 128 under the canopy.
    { id: "rootfall_counter", name: "Stump Counter", prefab: "porch", position: [60, 128.6], rotationY: Math.PI, footprint: [6, 2.2] },
    // The cook shelter, on the green's south kerb between houses 3 and 4. Back wall z 111.4,
    // canopy to z 113.4, so the range stands under a roof 0.6 m off the green's edge.
    { id: "rootfall_cookhouse", name: "Cook Shelter", prefab: "porch", position: [57, 112.5], rotationY: 0, footprint: [4, 2.2] },
    // NO WELLHEAD. The `well` prefab was authored here and then measured out: it is composed of
    // roof_wood_plank, bucket_wood and chain_coil, none of which Vellenwood draws anywhere else, so
    // one 1.6 m object cost three instanced groups. Measured at the `hollowcut_seam` pose, which
    // looks straight down the town's own axis, this settlement's dressing costs 65 of a 400 draw
    // call budget; three of those for a wellhead nobody uses is the wrong trade, and the green
    // already has the stump, the counter, the cook shelter and two benches on it.

    // ---- the gates, standing in the wall openings --------------------------------------------
    // [8,4] keeps the two 2 m piers and 4 m clear span that `GATE_GAP_METRES` is sized for. The
    // 4 m depth also seats the return walls and decks on whole 2 m modules. Authored at 6 m wide,
    // the span collapses to 2 m, which is what made all three of the old arches impassable.
    { id: "rootfall_gate_west", name: "West Gate", prefab: "gatehouse", position: [44, 124], rotationY: -Math.PI / 2, footprint: [8, 4] },
    { id: "rootfall_gate_east", name: "Cart Gate", prefab: "gatehouse", position: [80, 110], rotationY: Math.PI / 2, footprint: [8, 4] },
    // Two metres west leaves a 0.70 m roof seam between this crown and the east-wall postern.
    { id: "rootfall_gate_north", name: "Log Gate", prefab: "gatehouse", position: [72, 144], rotationY: 0, footprint: [8, 4] },
    // The bank -> Hollowcut road already crossed the east wall here, but the old 6 m opening was
    // only a raw gap between two jambs. This full gatehouse retains a 4 m clear passage, and the
    // Root Tunnel now begins four metres beyond its east edge instead of occupying the inner lane.
    { id: "rootfall_postern", name: "Forest Quarry Postern", prefab: "gatehouse", position: [80, 138], rotationY: Math.PI / 2, footprint: [8, 4] },
  ],

  /**
   * A closed circuit. Runs share their end coordinates so the corner posts `buildWallRun` places
   * at both ends of every built span land on top of each other instead of leaving the open corners
   * the previous wall stubs had at all four corners of all three settlements.
   *
   * `at` is metres along the run from `from`; each opening is authored at its gatehouse's position
   * projected onto the run.
   */
  walls: [
    { id: "rootfall_wall_west", name: "West Palisade", from: [44, 102], to: [44, 144], openings: [{ at: 22, width: 8 }] },
    { id: "rootfall_wall_north", name: "North Palisade", from: [44, 144], to: [80, 144], openings: [{ at: 28, width: 8 }] },
    {
      id: "rootfall_wall_east", name: "East Palisade", from: [80, 144], to: [80, 102],
      // z 138 is the Hollowcut Postern and z 110 is the Cart Gate. Both use the gatehouse's full
      // 8 m footprint, leaving the same 4 m clear passage after their two masonry piers.
      openings: [{ at: 6, width: 8 }, { at: 34, width: 8 }],
    },
    // Solid. Nothing in Vellenwood is south of Rootfall.
    { id: "rootfall_wall_south", name: "South Palisade", from: [80, 102], to: [44, 102] },
  ],

  /**
   * Plank decking, because this is a town that mills timber and has no stone. `floor_wood` tells
   * the ground stamp to run 2.4 m sawmill lengths across the six rects below, staggered at random
   * the way a sawyer lays them. Every gate path continues four metres outside the palisade.
   *
   * The green is the only rect with a kerb: a kerb along a working cart road is a thing to trip
   * over, and it would read as a pavement in a place that has none.
   */
  paving: [
    { id: "rootfall_paving_green", rect: { minX: 52, minZ: 114, maxX: 68, maxZ: 128 }, assetId: "floor_wood", kerb: true },
    // Green -> Cart Gate. Meets the green along its whole z = 114 edge, and its last tile row lies
    // under the gate arch.
    { id: "rootfall_paving_cart_road", rect: { minX: 60, minZ: 110, maxX: 84, maxZ: 114 }, assetId: "floor_wood" },
    // West Gate -> green. Threads between house_2 (z <= 120) and house_1 (z >= 128).
    { id: "rootfall_paving_log_road", rect: { minX: 40, minZ: 122, maxX: 52, maxZ: 126 }, assetId: "floor_wood" },
    // The sawpit's working yard, north off the green: timber comes in here and goes under the
    // arcade's canopy, whose front edge is at z 136.5.
    { id: "rootfall_paving_sawpit_yard", rect: { minX: 52, minZ: 128, maxX: 58, maxZ: 138 }, assetId: "floor_wood" },
    // Two compact trailheads make the less-used wall openings read as deliberate entrances while
    // leaving the centre of each four-metre gate corridor free of kerbs and props.
    { id: "rootfall_paving_north_gate", rect: { minX: 70, minZ: 138, maxX: 74, maxZ: 148 }, assetId: "floor_wood" },
    { id: "rootfall_paving_postern", rect: { minX: 76, minZ: 136, maxX: 84, maxZ: 140 }, assetId: "floor_wood" },
  ],

  stations: [
    // Under the cook shelter's canopy (z 111.4..113.4), 0.16 m off its back wall. cooking_pot
    // draws 0.539 x 0.486 at scale 1, so 1.6 was a 0.86 m pot alone on grass; 2.2 is 1.19 m under
    // a roof.
    {
      id: "rootfall_range", name: "Oakwood Cooking Range", kind: "range", skill: "cooking",
      position: [57, 112.4], rotationY: 0, assetId: "cooking_pot", scale: 2.2, recipeIds: [],
      attachedTo: "rootfall_cookhouse",
    },
    // Inside the forge, 2.0 m back from the mouth. The player walks in.
    {
      id: "rootfall_anvil", name: "Oakwood Anvil", kind: "anvil", skill: "smithing",
      position: [70.5, 137.2], rotationY: Math.PI, assetId: "anvil", scale: 1.4, recipeIds: [],
      attachedTo: "rootfall_forge",
    },
    // New. Rootfall had two stations against Coldbrace's five and no bench of any kind, so its
    // crafter had nowhere to work. Both of these stand under the sawpit's canopy.
    {
      id: "rootfall_crafting", name: "Oakwood Crafting Table", kind: "crafting_table", skill: "crafting",
      position: [52.6, 137.4], rotationY: Math.PI, assetId: "workbench", recipeIds: [],
      attachedTo: "rootfall_sawpit",
    },
    // workbench_drawers draws 0.423 x 0.299 at scale 1 — a 42 cm drawer unit. 3.5 makes it a
    // 1.48 m bench, which is what Coldbrace's 1.6 should have been.
    {
      id: "rootfall_fletching", name: "Oakwood Fletching Bench", kind: "fletching_bench", skill: "fletching",
      position: [55.4, 137.4], rotationY: Math.PI, assetId: "workbench_drawers", scale: 3.5, recipeIds: [],
      attachedTo: "rootfall_sawpit",
    },
  ],

  // (60,128) is fixed: 38.0 m from the Hollowcut Seam, the tier-5 half of the route-optimisation
  // flip. What changed is that it now stands under the Stump Counter's canopy with a counter and a
  // banker beside it instead of on 10 m of open grass.
  bank: {
    id: "rootfall_bank_chest", name: "Oakwood Bank Chest", position: [60, 128], rotationY: Math.PI,
    assetId: "chest_wood", attachedTo: "rootfall_counter",
  },

  shops: [
    // Under the same porch as the chest, in its east bay. market_stall is 2.627 m tall and the
    // canopy soffits at 2.68, so it fits under the roof rather than beside it.
    {
      id: "rootfall_general", name: "Oakwood Trade Post", shopKind: "general",
      // The stall opens along local -Z; yaw zero faces its counter south toward the green.
      position: [62, 128.8], rotationY: 0, assetId: "market_stall",
      attachedTo: "rootfall_counter",
    },
  ],

  // Three people, unchanged ids, standing somewhere with a reason: Ansel on the green by the
  // stump he keeps, Juno behind her own counter, Mott on his doorstep. A fourth NPC and a smith's
  // shop are both wanted here and are blocked: an NpcStandDef needs a matching row in
  // content/npcs.ts (systems/dialogue.ts resolves the tree through `dialogueRootFor`) and a
  // ShopDef needs a matching row in content/shops.ts, and neither file is owned by this one.
  npcs: [
    { id: "npc_woodward_ansel", name: "Woodward Ansel", position: [57.4, 122.8], facingRad: 2.39, assetId: "base_male", dialogueRootId: "ansel_root", questIds: [] },
    { id: "npc_seamer_juno", name: "Seamer Juno", position: [58.4, 129.2], facingRad: Math.PI, assetId: "base_female", dialogueRootId: "juno_root", questIds: [] },
    { id: "npc_trapper_mott", name: "Trapper Mott", position: [69.2, 118.6], facingRad: -1.42, assetId: "base_male", dialogueRootId: "mott_root", questIds: [] },
  ],

  /**
   * Set dressing, grouped by the reason each group exists. Nothing here is scattered: every prop
   * belongs to a yard, a counter, a wagon or a wall.
   *
   * `dy` is metres above BASE-ALIGNED ground (`regionBuilder.emitProp`), so dy 0 puts an asset's
   * own bbox floor on the ground whatever its pivot does, and the wall lamps are authored at the
   * height they hang at. `solid` is on for anything the player should not walk through and off for
   * everything at ankle height, because a snag is worse than a clipped sack.
   *
   * Solids are deliberately kept OUT of three corridors that a gate-check line has to walk:
   * the forge mouth (x 69..72.4), the Cart Gate passage (z 110..112.4) and the green's north
   * approach to the chest (x 59..61).
   *
   * Every asset here is chosen with the draw-call budget in mind: a group is keyed on (assetId,
   * tier), so a prop the settlement uses ONCE still costs a whole instanced group, and Vellenwood
   * is the region the `hollowcut_seam` pose looks across. `crate_village` is preferred over
   * `crate_wood` because the `shed` prefab already emits one and the group therefore already
   * exists; `rope_coil` is free for the same reason (the Blackwater fishing spots draw it);
   * `support_beam`, `lamp_wall` and `roof_log` all come with the forge, arcade, porch and the
   * timber kit's ridge. Measured at the three Vellenwood poses, old layout -> this one:
   * rootfall 341 -> 324 draw calls, vellenwood_canopy 207 -> 240, hollowcut_seam 303 -> 353, all
   * inside the 400 budget. The `well` prefab and a `weapon_rack` were authored, measured at 20
   * draw calls at the `rootfall` pose for one wellhead and one rack, and cut.
   */
  props: [
    // ---- forge yard --------------------------------------------------------------------------
    { id: "rootfall_prop_whetstone", assetId: "whetstone", position: [67.6, 133.2], rotationY: 0.5, solid: true },
    { id: "rootfall_prop_forge_barrel_1", assetId: "barrel", position: [68.6, 132.2], rotationY: 0.3, solid: true },
    // Under the forge's east eave (roof to x 74.29) and clear of the postern approach.
    { id: "rootfall_prop_forge_barrel_2", assetId: "barrel", position: [74.0, 136.2], rotationY: 1.1, solid: true },
    { id: "rootfall_prop_forge_crate", assetId: "crate_village", position: [73.0, 132.6], rotationY: 0.8, solid: true },
    { id: "rootfall_prop_forge_sack", assetId: "sack", position: [68.2, 131.6], rotationY: 2.1 },

    // ---- sawpit ------------------------------------------------------------------------------
    // support_beam is a beam with a knee brace and a stub foot; two of them at 0.8 read as the
    // trestles a pit saw is worked over.
    { id: "rootfall_prop_trestle_1", assetId: "support_beam", position: [51.6, 134.6], rotationY: 0, scale: 0.8 },
    { id: "rootfall_prop_trestle_2", assetId: "support_beam", position: [56.4, 134.6], rotationY: 0, scale: 0.8 },
    // roof_log is a 10.7 m timber; at 0.28 it is a 3.0 m sawn log. Two on the deck and one across
    // them, which is what a stack looks like and what the kit's ridge log is cut from.
    { id: "rootfall_prop_log_1", assetId: "roof_log", position: [50.8, 132.2], rotationY: 0, scale: 0.28, solid: true },
    { id: "rootfall_prop_log_2", assetId: "roof_log", position: [51.2, 132.2], rotationY: 0, scale: 0.28, solid: true },
    { id: "rootfall_prop_log_3", assetId: "roof_log", position: [51.0, 132.2], rotationY: 0, scale: 0.28, dy: 0.36 },
    { id: "rootfall_prop_saw_crate", assetId: "crate_village", position: [56.4, 137.6], rotationY: 0.4, solid: true },
    { id: "rootfall_prop_saw_sack", assetId: "sack", position: [51.6, 137.4], rotationY: 1.7 },
    { id: "rootfall_prop_saw_rope", assetId: "rope_coil", position: [55.8, 135.2], rotationY: 0.6 },

    // ---- the counter -------------------------------------------------------------------------
    // table_large runs north-south in the porch's west bay, leaving 0.61 m between it and the
    // chest and the whole middle bay open so the chest stays inside INTERACT_RANGE from the green.
    { id: "rootfall_prop_counter_table", assetId: "table_large", position: [58.2, 127.9], rotationY: Math.PI / 2, solid: true },
    // Rootfall had no light source at all. These two stand on the porch posts.
    { id: "rootfall_prop_counter_torch_l", assetId: "torch", position: [57.2, 127.8], rotationY: 0, dy: 1.9 },
    { id: "rootfall_prop_counter_torch_r", assetId: "torch", position: [62.8, 127.8], rotationY: 0, dy: 1.9 },
    { id: "rootfall_prop_counter_rope", assetId: "rope_coil", position: [61.6, 127.8], rotationY: 0.9 },

    // ---- the green ---------------------------------------------------------------------------
    { id: "rootfall_prop_bench_1", assetId: "bench", position: [57.0, 118.0], rotationY: 0.35, solid: true },
    { id: "rootfall_prop_bench_2", assetId: "bench", position: [63.4, 122.4], rotationY: -0.35, solid: true },
    { id: "rootfall_prop_green_barrel", assetId: "barrel", position: [65.8, 126.4], rotationY: 0.4, solid: true },
    { id: "rootfall_prop_green_crate", assetId: "crate_village", position: [54.8, 126.6], rotationY: 1.3, solid: true },

    // ---- the cook shelter --------------------------------------------------------------------
    { id: "rootfall_prop_cauldron", assetId: "cauldron", position: [58.4, 112.4], rotationY: 0, solid: true },
    { id: "rootfall_prop_cook_sack", assetId: "sack", position: [55.6, 112.6], rotationY: 0.4 },

    // ---- the cart road -----------------------------------------------------------------------
    // Parked along the road's north edge rather than across it: the wagon's drawn AABB is
    // 4.02 x 1.95 and laid across the 4 m road it would have left 0.9 m either side, which is
    // exactly the navmesh's erosion width. Here it leaves 2.4 m of clear passage.
    { id: "rootfall_prop_wagon", assetId: "wagon", position: [69, 113.4], rotationY: Math.PI / 2, solid: true },
    { id: "rootfall_prop_cart_crate", assetId: "crate_village", position: [75.6, 113.2], rotationY: 0.7, solid: true },
    { id: "rootfall_prop_cart_barrel", assetId: "barrel", position: [76.8, 113.4], rotationY: 0.2, solid: true },
    { id: "rootfall_prop_cart_sack", assetId: "sack", position: [74.6, 112.9], rotationY: 1.9 },

    // ---- fenced yards ------------------------------------------------------------------------
    // fence_wood_single is 2.064 m long, so a run is authored on 2 m centres and the panels lap.
    // The south-west yard is closed on three sides by the fence and on the fourth by house_3.
    { id: "rootfall_fence_sw_n1", assetId: "fence_wood_single", position: [46, 112], rotationY: 0 },
    { id: "rootfall_fence_sw_n2", assetId: "fence_wood_single", position: [48, 112], rotationY: 0 },
    { id: "rootfall_fence_sw_w1", assetId: "fence_wood_single", position: [45, 106], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_sw_w2", assetId: "fence_wood_single", position: [45, 108], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_sw_w3", assetId: "fence_wood_single", position: [45, 110], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_sw_s1", assetId: "fence_wood_single", position: [46, 104], rotationY: 0 },
    { id: "rootfall_fence_sw_s2", assetId: "fence_wood_single", position: [48, 104], rotationY: 0 },
    { id: "rootfall_prop_yard_crate", assetId: "crate_village", position: [46.4, 108.6], rotationY: 0.9, solid: true },
    { id: "rootfall_prop_yard_sack", assetId: "sack", position: [47.4, 106.4], rotationY: 2.2 },
    // The east strip, behind houses 6 and 7 and inside the east wall.
    { id: "rootfall_fence_e1", assetId: "fence_wood_single", position: [76, 115], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_e2", assetId: "fence_wood_single", position: [76, 117], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_e3", assetId: "fence_wood_single", position: [76, 119], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_e4", assetId: "fence_wood_single", position: [76, 121], rotationY: Math.PI / 2 },
    { id: "rootfall_fence_e5", assetId: "fence_wood_single", position: [75, 114], rotationY: 0 },
    { id: "rootfall_fence_e6", assetId: "fence_wood_single", position: [75, 123], rotationY: 0 },

    // ---- wall lamps --------------------------------------------------------------------------
    // Vellenwood's fogStart is 55 m and Rootfall had nothing lit in it. lamp_wall mounts on a wall
    // whose outward normal is local -Z and throws its body toward +Z, so rotationY names the
    // direction the lamp faces. dy 1.8 puts its top at 3.14 m, just under the 3.123 m wall head.
    { id: "rootfall_lamp_h1", assetId: "lamp_wall", position: [51.25, 131], rotationY: Math.PI / 2, dy: 1.8 },
    { id: "rootfall_lamp_h2", assetId: "lamp_wall", position: [51.25, 117], rotationY: Math.PI / 2, dy: 1.8 },
    { id: "rootfall_lamp_h6", assetId: "lamp_wall", position: [69.75, 118], rotationY: -Math.PI / 2, dy: 1.8 },
    { id: "rootfall_lamp_h7", assetId: "lamp_wall", position: [69.75, 128], rotationY: -Math.PI / 2, dy: 1.8 },
    { id: "rootfall_lamp_h4", assetId: "lamp_wall", position: [62, 110.25], rotationY: 0, dy: 1.8 },
    { id: "rootfall_lamp_h8", assetId: "lamp_wall", position: [61, 135.75], rotationY: Math.PI, dy: 1.8 },
  ],
};
