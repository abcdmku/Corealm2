/**
 * Highcairn — the tier 10 settlement, in Karrowmoor, centred on (142,-61).
 *
 * Split out of `content/regions.ts` so the three settlements can be authored independently; the
 * file's only export is the data, and `regions.ts` imports it straight back into `KARROWMOOR`.
 * The types, the validation and the coordinate contract all still live in `regions.ts`.
 *
 * WHAT THIS IS. A quarry outpost on the second Karrowmoor terrace: a walled rectangle 40 x 26 m
 * whose south wall stands on the terrace lip, a brick-paved yard, a forge, a covered market row,
 * a bank counter under a porch, six crew huts with their doors on the yard, and the crane the crew
 * stopped using six months ago standing in the middle of it. Everything is built out of the
 * `stone` kit, which is the quarry's own product: brick and cut stone to the eaves, brick corner
 * piers, and the shallower six-wide roof that reads as a lower, heavier building at the distance
 * the whole terrace is seen from.
 *
 * WHAT IT WAS, measured, and why every number below moved:
 *  - 30 m of wall on a 139 m circuit (21%), in two free-standing stubs in open moor with all four
 *    corners missing, and `getNavPath(144,-40 -> 144,-90)` detouring to x = 149.5 to walk around
 *    them. There is now a closed 132 m circuit of `WallRunDef`s, 116 m of it built, with the two
 *    8 m gaps cut exactly where the two gatehouses stand.
 *  - 3 of 6 huts presented a blank rear wall to their own centre; hut_3's door opened onto the
 *    north wall 2 m away and hut_5's onto the south wall. Every door now faces the yard: the
 *    prefab door leaf sits on LOCAL -Z, so a building's door bearing is `rotationY + PI`, which is
 *    the opposite of the `forge`/`arcade` open face on LOCAL +Z. (The comment on `forge()` in
 *    render/buildings.ts says an author "points it at the square with the same rotationY they
 *    would use to point a cottage door at it"; that is wrong by PI, and the layout below is
 *    authored against the geometry, not against that sentence.)
 *  - The bank chest stood on bare slate 4 m from the nearest hut and the furnace and anvil stood
 *    loose 4 m apart with no structure at all. The chest is now under a `porch` at its unchanged
 *    coordinate and both smithing stations are inside a `forge`, and each one names what it is
 *    part of through `attachedTo`, which `validateRegions` asserts to within 3 m.
 *  - A 315 m2 void in the middle with nothing in it. There are now 388 m2 of stamped brick, 59
 *    props and 116 m of wall in it.
 *
 * THE BANK STAYS AT (150,-70). It is one end of both legs of the route-optimisation flip (187.9 m
 * by road against 45.9 m over Sunder Ledge). See the DISTANCE LEDGER at the top of `regions.ts`
 * before moving it. Every other entity id in this file is also unchanged — ids are what gate-check,
 * the quests, the dialogue trees and the route graph address, so things moved and nothing was
 * renamed.
 *
 * THE TERRACE. `KARROWMOOR.terraces` puts the terrace 2 / terrace 3 boundary at z = -76 with an
 * 18 m riser, and the old circular pad spanned it: `getDrawnBounds` measured `highcairn_wall_n#w0`
 * and `highcairn_wall_s#w0` both based at y = 26.810 while standing 30 m apart in z, i.e. the pad
 * had erased the one piece of designed verticality in the region. Everything now sits in
 * z in [-75,-47] and `padShape` makes the pad a 44 x 28 m rectangle wholly inside terrace two, so
 * the south wall stands ON the lip and the drop behind it is the town's rampart. `padShape` is
 * centred on `centre`, which is why `centre` moved from (144,-66) to (142,-61): it is the centroid
 * of the walled rectangle, not of the old scatter of huts. `centre` is read in exactly two places,
 * `app/worldSpec.ts` (the pad) and `app/boot.ts` (the scatter exclusion circle); the
 * `highcairn_outpost` route node is a separate location and still sits at (144,-66), inside the
 * yard and 2.5 m north of the forge mouth.
 *
 * WHAT IS AUTHORED AROUND RATHER THAN FIXED. The `highcairn_crane` landmark belongs to
 * `content/regions.ts` and is fixed at (156,-64) with rotationY 0.3. Measured part
 *    positions: jib (156.89,-61.13), drum (158.11,-61.93), rope (157.21,-58.72), crate
 *    (154.12,-61.95), barrel (158.62,-63.97) — so it occupies x [153.6,159.1] z [-64.4,-58.4].
 *    The diagnosis wanted it moved to (140,-60); instead the east half of the yard is left to it
 *    and dressed as its working area, and hut_4 (which its jib was 2 m off) moved to the north row.
 *
 * ROOF CLEARANCE. `ROOF_EAVE_METRES` in render/buildings.ts is 0.79, but that is measured off
 * `roof_tiles_4x6`. This kit roofs with `roof_tiles_6x8` (8.250 x 9.683 for a nominal 6 x 8 cover)
 * and `roofFit` scales it to `max(short/6, long/8)`. A [6,4] quarry_hut draws 7.12 x 6.07 of roof
 * after its deliberate 0.98 tightening, while the [6,4] forge draws 7.26 x 6.19. Every gap below
 * is checked against those ROOF rectangles rather than the footprints. The Tool Hut and forge
 * retain about 0.61 m between their roof edges.
 */
import type { SettlementDef } from "../regions.js";

export const HIGHCAIRN: SettlementDef = {
  id: "highcairn",
  name: "Hillcrest",
  // Brick and cut stone to the eaves, brick piers, gable ends closed in stone, and the shallower
  // six-wide roof. A town built out of the quarry it works.
  kit: "stone",
  // The centroid of the walled rectangle x [122,162] z [-74,-48]. See the header: this drives the
  // flat pad and the scatter exclusion, not any route node.
  centre: [142, -61],
  respawnPointId: "highcairn",

  // A 44 x 28 m rectangle, x [120,164] z [-75,-47]. Terrace two runs z [-76,-40], so the pad's
  // south edge stops 1 m short of the riser instead of a 35 m disc reaching 26 m past it. The
  // gatehouses are the outermost things on it: the east one reaches x = 164, the postern x = 120.
  padShape: { halfX: 22, halfZ: 14, rotationY: 0 },

  // A closed circuit, 132 m, of which 116 m is built wall (88%) and the two 8 m gaps are the two
  // gatehouses. `buildWallRun` puts a `corner_brick` jamb at both ends of every run, so the four
  // runs share a post at each corner rather than leaving the hole all four corners had before.
  walls: [
    {
      // The rampart. Terrace three starts at z = -76, so this run stands on the lip with an 18 m
      // drop immediately behind it, and it is the one side of the town with no way through.
      id: "highcairn_wall_s", name: "South Rampart",
      from: [122, -74], to: [162, -74],
    },
    {
      // The quarry road side. The opening is 16 m along a 26 m run, i.e. centred on z = -58, which
      // is where `highcairn_gate` stands.
      id: "highcairn_wall_e", name: "East Wall",
      from: [162, -74], to: [162, -48],
      openings: [{ at: 16, width: 8 }],
    },
    { id: "highcairn_wall_n", name: "North Wall", from: [162, -48], to: [122, -48] },
    {
      // 10 m along a run that starts at z = -48, so again z = -58, under `highcairn_postern`.
      id: "highcairn_wall_w", name: "West Wall",
      from: [122, -48], to: [122, -74],
      openings: [{ at: 10, width: 8 }],
    },
  ],

  buildings: [
    // NORTH ROW. rotationY 0 keeps all three entrances on local -Z, facing south onto the yard.
    // The quarry hut, compact shed, and tower roofs clear one another at their 9 m spacing.
    { id: "highcairn_hut_1", name: "Crew Hut", prefab: "quarry_hut", position: [137, -52], rotationY: 0, footprint: [6, 4] },
    { id: "highcairn_hut_3", name: "Store Hut", prefab: "shed", position: [146, -52], rotationY: 0, footprint: [4, 4] },
    // Moved off the crane, whose jib reaches (156.89,-61.13) and whose barrel part lands at
    // (158.62,-63.97) — the hut used to stand at (156,-68), 2 m from it.
    { id: "highcairn_hut_4", name: "Watch Hut", prefab: "tower", position: [155, -52], rotationY: 0, footprint: [4, 4] },

    // SOUTH ROW. rotationY PI turns each closed-building entrance north across the yard. The two
    // quarry roofs reach z = -73.53 and the cottage reaches z = -73.60 against a wall at -73.75.
    { id: "highcairn_hut_6", name: "Long Hut", prefab: "quarry_hut", position: [126, -70.5], rotationY: Math.PI, footprint: [6, 4] },
    { id: "highcairn_hut_5", name: "Tool Hut", prefab: "quarry_hut", position: [136.2, -70.5], rotationY: Math.PI, footprint: [6, 4] },
    {
      // The forge's open face is LOCAL +Z, so rotationY 0 points the mouth NORTH at the yard. The
      // mouth is `width - 1.2` = 4.8 m of clear opening at z = -68.0, which is 3.9 m after the
      // navmesh erodes 0.45 m a side — the anvil is genuinely walked up to, not reached through a
      // wall from 8 m away.
      id: "highcairn_forge", name: "Camp Forge", prefab: "forge",
      position: [144, -70], rotationY: 0, footprint: [6, 4],
    },
    {
      // Two bays of canopy on two posts over the bank chest, which stays at (150,-70). The porch
      // canopy always projects 2.0 m from the back wall, so at depth 3 it covers z [-71.1,-69.1]
      // and the chest sits in the middle of it with 0.9 m of counter space in front.
      id: "highcairn_bank_porch", name: "Bank Counter", prefab: "porch",
      position: [150.8, -69.6], rotationY: 0, footprint: [4, 3],
    },
    { id: "highcairn_hut_2", name: "Foreman's Hut", prefab: "cottage", position: [157, -70.5], rotationY: Math.PI, footprint: [6, 4] },

    {
      // Three bays of covered row standing IN the yard rather than against a wall, which is what
      // splits a 22 x 16 m paved rectangle into a square and a service lane instead of a parade
      // ground. Open face north (LOCAL +Z at rotationY 0). Holds the store pitch and the camp cook
      // fire, with the goods along its front edge.
      //
      // z = -63.4, not the -65.5 it was first authored at: its back wall then stood 1.5 m in front
      // of the Tool Hut's door, which is the same "opens onto a wall panel 2 m away" defect this
      // whole pass exists to remove. At -63.4 the Tool Hut's door has 3.6 m of clear yard.
      id: "highcairn_market", name: "Camp Row", prefab: "arcade",
      position: [136.6, -63.4], rotationY: 0, footprint: [6, 3],
    },

    // GATEHOUSES, both moved into their wall run's opening. [8,4] reaches the full
    // GATE_GAP_METRES = 4 clear span and gives the returns two native 2 m depth modules. At the
    // old [6,3] there was only room for one 2 m pier a side and a 2 m gap, of which 0.20 m survived
    // navmesh erosion.
    { id: "highcairn_gate", name: "Hillcrest Gate", prefab: "gatehouse", position: [162, -58], rotationY: Math.PI / 2, footprint: [8, 4] },
    { id: "highcairn_postern", name: "Quarry Postern", prefab: "gatehouse", position: [122, -58], rotationY: -Math.PI / 2, footprint: [8, 4] },
  ],

  // floor_brick, because the quarry town paves in its own stone: the ground stamp reads this as a
  // dressed block course, laid to a line, against Coldbrace's gathered river cobble.
  // No `kerb`: `emitPaving` rings the entire rect, and every edge of this yard is either a hut
  // doorstep at z = -54.02, the forge mouth at z = -68.0, or a gate road. A 13 cm lip across any of
  // those is a snag and reads as a mistake, so the yard's edge is drawn by what stands on it.
  paving: [
    { id: "highcairn_yard", rect: { minX: 134, minZ: -70, maxX: 156, maxZ: -54 }, assetId: "floor_brick" },
    { id: "highcairn_gate_road", rect: { minX: 156, minZ: -60, maxX: 166, maxZ: -56 }, assetId: "floor_brick" },
    // Three inner tiles only. Anything farther east would be laid on top of the farm plot beds,
    // which are themselves floor_brick at the same height: plot 1 is at (129.76,-57.82) with a
    // 2 m rail ring. A separate four-tile apron continues west outside the wall.
    { id: "highcairn_postern_apron", rect: { minX: 122, minZ: -60, maxX: 128, maxZ: -58 }, assetId: "floor_brick" },
    { id: "highcairn_postern_outer_apron", rect: { minX: 118, minZ: -60, maxX: 122, maxZ: -56 }, assetId: "floor_brick" },
  ],

  stations: [
    {
      // Inside the forge, against the west wall. cauldron at 2.0 draws 1.98 x 1.89, and the forge's
      // interior after its three 0.6 m collision walls is x [141.6,146.4] z [-71.4,-68.0].
      id: "highcairn_furnace", name: "Hillcrest Furnace", kind: "furnace", skill: "smithing",
      position: [142.7, -70.6], rotationY: 0, assetId: "cauldron", scale: 2, recipeIds: [],
      attachedTo: "highcairn_forge",
    },
    {
      // In the mouth, 1.2 m inside the open face, so the player walks in and stands at it. anvil at
      // 1.4 draws 1.52 x 0.56 and clears the furnace by 0.55 m.
      id: "highcairn_anvil", name: "Hillcrest Anvil", kind: "anvil", skill: "smithing",
      position: [145, -69.2], rotationY: 0, assetId: "anvil", scale: 1.4, recipeIds: [],
      attachedTo: "highcairn_forge",
    },
    {
      // The camp cook fire, under the east bay of the covered row. Scale 2.2 rather than the old
      // 1.6: `cooking_pot` is a 0.539 x 0.486 mesh, so 1.6 drew a 0.86 m pot standing alone on
      // slate at (148,-76) — 8 m outside the town and over the terrace lip.
      id: "highcairn_range", name: "Hillcrest Cooking Range", kind: "range", skill: "cooking",
      position: [138.2, -63.8], rotationY: 0, assetId: "cooking_pot", scale: 2.2, recipeIds: [],
      attachedTo: "highcairn_market",
    },
  ],

  // rotationY 0 turns the chest to face the yard. It was PI, which pointed the lid at whatever was
  // behind it; there is now a porch back wall 0.9 m behind it, so PI would face the wall.
  bank: {
    id: "highcairn_bank_counter", name: "Hillcrest Bank",
    position: [150, -70], rotationY: 0, assetId: "chest_wood",
    attachedTo: "highcairn_bank_porch",
  },

  shops: [
    {
      // Under the west bay of the covered row, facing the yard.
      id: "highcairn_general", name: "Hillcrest Camp Store", shopKind: "general",
      // The stall's local -Z counter faces north into the yard at this half turn.
      position: [135.9, -63.9], rotationY: Math.PI, assetId: "market_stall",
      attachedTo: "highcairn_market",
    },
    {
      // In front of the forge, north of the roof line: the forge roof reaches z = -66.90 and the
      // cart is 2.63 m tall, so it has to clear the eave rather than sit under it.
      id: "highcairn_smith", name: "Quarry Smith", shopKind: "smith",
      position: [148, -65.6], rotationY: 0, assetId: "market_stall_cart",
      attachedTo: "highcairn_forge",
    },
  ],

  // `facingRad` is the same yaw convention as `rotationY`: 0 looks down +Z, PI/2 down +X. Each of
  // these is `atan2(dx, dz)` toward the thing the NPC is actually attending to, so nobody stands
  // with their back to their own counter.
  npcs: [
    // Under the porch on the chest's west side, looking across the counter while leaving the
    // customer approach and the projecting post-mounted banner clear.
    { id: "npc_foreman_arden", name: "Foreman Arden", position: [148.7, -70.3], facingRad: 0.92, assetId: "base_male", dialogueRootId: "arden_root", questIds: [] },
    // Inside the forge, on the anvil's east side, looking at it.
    { id: "npc_quarrier_vess", name: "Quarrier Vess", position: [145.8, -68.4], facingRad: -2.36, assetId: "base_female", dialogueRootId: "vess_root", questIds: [] },
    // At the garden gate in the fence line, looking west over the four plots.
    { id: "npc_cairnkeeper_ode", name: "Cairnkeeper Ode", position: [134.6, -60.5], facingRad: -Math.PI / 2, assetId: "base_female", dialogueRootId: "ode_root", questIds: [] },
    // On the Watch Hut's doorstep, looking at the gate at (162,-58).
    { id: "npc_watcher_hale", name: "Watcher Hale", position: [155.5, -55.4], facingRad: 1.95, assetId: "base_male", dialogueRootId: "hale_root", questIds: [] },
  ],

  /*
   * Set dressing. Every entry is here for a reason a player can read at a glance: a lit gate, a lit
   * rampart, a forge with tools in it, a market row with goods on it, a bank with a counter and a
   * bench, a fenced garden, a woodpile down the side alley, a spoil heap and a wagon in the crane's
   * working half of the yard.
   *
   * `solid` is set only on the three things big enough that walking through them would read as a
   * bug — the wagon and the two spoil rocks. Everything else is dressing the player walks over or
   * past, which keeps 56 new colliders out of the navmesh and off the paths gate-check depends on.
   *
   * The asset vocabulary is deliberately narrow. Six of the 19 asset ids used here — rock_medium_1,
   * rock_medium_3, barrel, rope_coil, roof_log, fence_wood_single — are already drawn at this tier
   * by the clusters, the crane composition and the plot beds, and floor_brick paving is free for
   * the same reason, so the dressing costs 13 new instanced groups rather than 19.
   */
  props: [
    // --- The gate. Two sconces on the piers' inner faces only. The gatehouse owns its exterior
    // projecting standards, so duplicating banners inside the passage would clutter the opening.
    // The piers stand at z = -55 and z = -61 with the 4 m passage between them.
    { id: "highcairn_gate_torch_n", assetId: "torch", position: [160.4, -56.3], rotationY: -Math.PI / 2, scale: 2.2, dy: 1.8 },
    { id: "highcairn_gate_torch_s", assetId: "torch", position: [160.4, -59.7], rotationY: -Math.PI / 2, scale: 2.2, dy: 1.8 },

    // --- The rampart. Four sconces on the south wall's INNER face (z = -73.8), bracket pointing
    // north into the town: `torch`'s mesh runs from its pivot to +z 0.388, so rotationY 0 is the
    // one that puts the flame off the wall rather than through it. This is the wall with an 18 m
    // drop behind it and it is the only lit edge of the town.
    { id: "highcairn_rampart_torch_1", assetId: "torch", position: [128, -73.8], rotationY: 0, scale: 2.6, dy: 2 },
    { id: "highcairn_rampart_torch_2", assetId: "torch", position: [138, -73.8], rotationY: 0, scale: 2.6, dy: 2 },
    { id: "highcairn_rampart_torch_3", assetId: "torch", position: [149, -73.8], rotationY: 0, scale: 2.6, dy: 2 },
    { id: "highcairn_rampart_torch_4", assetId: "torch", position: [158, -73.8], rotationY: 0, scale: 2.6, dy: 2 },

    // --- Wall lanterns on the five hut faces that look at the yard. The forge, the row and the
    // bank porch light themselves (all three prefabs emit their own lamp_wall) and each gatehouse
    // emits two more on its outward face.
    //
    // dy 0.9, not the 2.15 the covered prefabs use, because these hang under an eave and those do
    // not: `roof_tiles_6x8` at the quarry hut's 0.654 fit reaches down to y = 2.612, which is
    // 0.51 m BELOW the 3.123 m wall head and 0.67 m out from the wall face, and `lamp_wall` at
    // 1.15 draws 1.54 m from its mount. 0.9 puts the lantern head at 2.58 m, 0.03 m under the
    // eave; 2.15 drove it straight through the tiles on all six huts, measured as a
    // 0.41 x 0.35 x 1.02 m overlap each.
    //
    // The Tool Hut gets none: its yard face stands 1.5 m off the Camp Row's back wall, so the
    // row's own two lamps light that corner and a 1.25 m bracket there reached into the row.
    { id: "highcairn_lamp_hut1", assetId: "lamp_wall", position: [138.6, -54.05], rotationY: Math.PI, scale: 1.15, dy: 0.9 },
    { id: "highcairn_lamp_hut3", assetId: "lamp_wall", position: [147.6, -54.05], rotationY: Math.PI, scale: 1.15, dy: 0.9 },
    { id: "highcairn_lamp_hut4", assetId: "lamp_wall", position: [156.6, -54.05], rotationY: Math.PI, scale: 1.15, dy: 0.9 },
    { id: "highcairn_lamp_hut2", assetId: "lamp_wall", position: [158.6, -68.45], rotationY: 0, scale: 1.15, dy: 0.9 },
    { id: "highcairn_lamp_hut6", assetId: "lamp_wall", position: [127.6, -68.45], rotationY: 0, scale: 1.15, dy: 0.9 },

    // --- The spoil. Two heaped rocks on the unpaved slate west of the yard, between the Long Hut
    // and the Tool Hut. Both reuse cluster assets, so they cost no new group.
    { id: "highcairn_spoil_1", assetId: "rock_medium_1", position: [131, -67.6], rotationY: 0.6, scale: 0.9, solid: true },
    { id: "highcairn_spoil_2", assetId: "rock_medium_3", position: [131.1, -70.6], rotationY: 2.2, scale: 0.55, solid: true },

    // --- The crane's working half of the yard. The wagon is parked along the north edge rather
    // than under the jib on purpose: the gate -> bank and gate -> forge desire lines both run
    // through z [-70,-58] and it is the one solid prop big enough to divert them.
    { id: "highcairn_wagon", assetId: "wagon", position: [150, -56.5], rotationY: 1.5, solid: true },
    { id: "highcairn_crate_1", assetId: "crate_wood", position: [152.6, -63.4], rotationY: 0.5 },
    { id: "highcairn_crate_2", assetId: "crate_wood", position: [153.4, -64.6], rotationY: 2 },
    { id: "highcairn_sack_1", assetId: "sack", position: [152, -65.2], rotationY: 0.9 },
    { id: "highcairn_rope", assetId: "rope_coil", position: [154.4, -66.4], rotationY: 1.2, scale: 1.4 },

    // --- Inside the forge and in its yard.
    { id: "highcairn_forge_whetstone", assetId: "whetstone", position: [142.2, -68.4], rotationY: 0 },
    { id: "highcairn_forge_rack", assetId: "weapon_rack", position: [145.6, -71.3], rotationY: 0 },
    { id: "highcairn_forge_barrel", assetId: "barrel", position: [147.6, -68.6], rotationY: 0 },
    { id: "highcairn_forge_sack", assetId: "sack", position: [140.2, -68.6], rotationY: 1.1 },
    { id: "highcairn_forge_crate", assetId: "crate_wood", position: [140.7, -65.6], rotationY: 0.6 },

    // --- Under and in front of the Camp Row: store pitch, cook pot, goods, serving table.
    // Goods stand at the row's front edge rather than under it. The arcade hangs its own two
    // lamp_wall at x 134.6 and 138.6 on the back wall and puts a corner_brick post at every bay
    // joint, so the three bays leave 0.79 m of clear back wall between the store pitch and the
    // range and nothing else fits under the canopy.
    { id: "highcairn_row_barrel", assetId: "barrel", position: [139.4, -62], rotationY: 0 },
    { id: "highcairn_row_sack", assetId: "sack", position: [134.1, -62.3], rotationY: 0.4 },
    { id: "highcairn_row_table", assetId: "table_large", position: [136.4, -61.4], rotationY: 0, scale: 0.9 },

    // --- The bank counter under the porch: a table across the mouth, a sconce on each post, a
    // bench for the queue.
    { id: "highcairn_bank_table", assetId: "table_large", position: [150.6, -68.6], rotationY: 0, scale: 0.85 },
    { id: "highcairn_bank_torch_l", assetId: "torch", position: [149.6, -69.5], rotationY: 0, scale: 2.2, dy: 1.55 },
    { id: "highcairn_bank_torch_r", assetId: "torch", position: [152, -69.5], rotationY: 0, scale: 2.2, dy: 1.55 },
    { id: "highcairn_bank_bench", assetId: "bench", position: [151, -67], rotationY: 0 },
    { id: "highcairn_bank_sack", assetId: "sack", position: [152.3, -70.3], rotationY: 0.7 },

    // --- The woodpile, in the 1.25 m alley between the Long Hut's west gable and the west wall.
    // `roof_log` at 0.26 draws 0.30 x 2.78, and `emitProp` puts an asset's bbox floor on the
    // ground, so `dy` here is a real stack height rather than a pivot correction.
    { id: "highcairn_woodpile_1", assetId: "roof_log", position: [122.75, -71.6], rotationY: 0, scale: 0.26 },
    { id: "highcairn_woodpile_2", assetId: "roof_log", position: [123.1, -71.6], rotationY: 0, scale: 0.26 },
    { id: "highcairn_woodpile_3", assetId: "roof_log", position: [122.925, -71.6], rotationY: 0, scale: 0.26, dy: 0.31 },

    // --- Slabs down the service alley behind the north row, in the three gaps between the huts'
    // roof rectangles, so the strip between the huts and the north wall is not bare slate.
    { id: "highcairn_path_1", assetId: "path_rock_square_wide", position: [141.5, -49.3], rotationY: 0 },
    { id: "highcairn_path_2", assetId: "path_rock_square_wide", position: [150.5, -49.3], rotationY: 0 },
    { id: "highcairn_path_3", assetId: "path_rock_square_wide", position: [159.5, -49.3], rotationY: 0 },

    // --- Doorstep dressing, so each hut reads as lived in from the yard.
    { id: "highcairn_hut1_barrel", assetId: "barrel", position: [140.2, -54.8], rotationY: 0 },
    { id: "highcairn_hut3_bench", assetId: "bench", position: [144.6, -56], rotationY: 0 },
    { id: "highcairn_hut4_rack", assetId: "weapon_rack", position: [159.2, -54.6], rotationY: -Math.PI / 2 },
    { id: "highcairn_hut2_crate", assetId: "crate_wood", position: [160.4, -68.4], rotationY: 0.4 },
    { id: "highcairn_hut6_sack", assetId: "sack", position: [129.2, -70.2], rotationY: 1.4 },
  ],
};
