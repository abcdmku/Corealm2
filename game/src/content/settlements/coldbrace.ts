/**
 * Coldbrace - the tier 1 settlement, in Fallowmarch, centred on (-160,-80).
 *
 * Split out of `content/regions.ts` so the three settlements can be authored independently; the
 * file's only export is the data, and `regions.ts` imports it straight back into `FALLOWMARCH`.
 * The types, the validation and the coordinate contract all still live in `regions.ts` - this file
 * is data and the reasons behind it, nothing else.
 *
 * The route nodes this settlement is measured against (`town_center` at the square, `bank_interior`,
 * `town_entrance`, `coldbrace_east_gate`) are authored in `regions.ts` and are not repeated here.
 * Moving anything in this file that a route node names moves a number in the DISTANCE LEDGER at
 * the top of `regions.ts`, so check that ledger before moving the bank.
 *
 * ---------------------------------------------------------------------------------------------
 * PLAN (1 char = 2 m, EAST right, NORTH up - z grows north, so z = -108 is the south wall)
 * ---------------------------------------------------------------------------------------------
 *      x -186                     -160                    -134
 *  -56 +=======================================================+  north wall, NO opening: the
 *      |                                                       |  `wall_vault` Agility obstacle
 *  -62 |      ...fenced garden.......                          |  at (-160,-56) vaults THIS run.
 *  -66 |   H5           [===== HALL =====]           H8        |
 *  -72 |####west street####[  SQUARE   well  ]####east street###|
 *  -80 ^gateW      [arcade][   town_center   ]     [forge]     ^gateE
 *  -86 |   H6   H7         [   vault yard    ]   [smith cart]  |
 *  -92 |         [workshed][VAULT][porch+bank]        H3       |
 *  -98 |                   ...gate street...                   |
 * -104 |   H2       H1     [wagon]           H4                |
 * -108 +=========================^gate^========================+
 *
 * WHAT CHANGED AND WHY. Every number below is from
 * runs/corealm/diagnosis/settlement-layout-coldbrace-rootfall-hig.md:
 *
 *  - The wall was four free-standing 8 m `wall_segment` buildings: 44 m of a 212 m circuit, 79%
 *    open, largest single gap 46 m, all four corners missing. It is four `WallRunDef`s now, closing
 *    a 208 m rectangle with a shared corner post at each corner and exactly three 8 m openings, one
 *    per gatehouse. The player's complaint was, verbatim, "a random gate without a wall".
 *  - 11 of 11 doored buildings presented a blank rear wall to their own square (measured dot of
 *    door facing against the direction to the centre: -0.61 to -1.00). Every door in this file
 *    opens onto the square, a paved street, or a lane. A prefab puts its door on side index 2
 *    (local -Z), so world door facing is `rotationY + PI` and the leaf lands at
 *    `position + rot(0.55, -(depth / 2 + 0.02))`.
 *  - The middle of the town was a 25.0 x 23.0 m rectangle (575 m2) holding a 1.28 m bank chest, a
 *    1.08 m anvil and a cooking pot and nothing else. It is five rects of stamped cobble plus 40
 *    kerb pieces, carrying a kerbed square, a well, three benches, a market arcade, a bank counter
 *    and a forge yard.
 *  - Every station stood loose on grass, and the Forge Shed's only door faced away from the anvil
 *    and furnace it served. The anvil and furnace are inside an open-fronted `forge` whose mouth is
 *    the square's east kerb; the crafting and fletching benches are under an `arcade` on the vault
 *    yard; the range is under a cookhouse lean-to. Each names its structure in `attachedTo`, which
 *    `validateRegions` asserts within `ATTACHMENT_MARGIN_METRES`.
 *  - The bank chest stood 5.0 m from the nearest building on open grass with no collider. It is
 *    behind a counter under a `porch` on the vault tower's east face, looking down the bank court
 *    that `bank_interior` (-160,-88) stands in.
 *  - Houses 5 and 6 interpenetrated over 1.57 x 1.51 m of roof tile. No two roofs in this file
 *    touch. Spacing was checked with `roofOverhang(prefab, footprint, kit)` rather than the flat
 *    `ROOF_EAVE_METRES`, because the flat number is the worst case across the game and the real
 *    one varies by prefab: a 6 x 4 plaster cottage is 0.78 / 0.76 m, the 12 x 6 hall 0.83 / 1.13,
 *    the 6 x 4 forge 0.79 / 0.76,
 *    and a porch or arcade nothing at all. Landmark parts are emitted at their authored scales,
 *    so this layout is spaced against those measured bounds. The tightest pair is the
 *    cookhouse and house_8 at 0.57 m of clear air.
 *  - The cooking range interpenetrated the vault-door torch by 0.22 x 0.59 m and its banner by
 *    0.42 m. It is 22 m from that composition now.
 *  - Nothing in a settlement except the buildings had a collider. Everything solid here was checked
 *    against everything else solid here, box against rotated box: 61 colliders, 0 cross-structure
 *    clashes. The three that turned up on the way - the bank chest inside its own porch wall, the
 *    smith's cart inside a barrel, the wagon inside a crate - are the reason the check exists.
 *
 * There is one pair whose plans overlap on purpose: the vault tower's spire reaches 0.33 m over the
 * bank porch. The spire sits at y >= 6.25 m and the porch canopy tops out at 3.36 m, so it is a
 * tower with eaves over its own counter. `runs/corealm/audit/w2-coldbrace.ts` exempts exactly that
 * pair and fails on every other overlap.
 *
 * WHAT THE NAVMESH COST. The mesh erodes 0.45 m per side at the 0.45 m large-world cell, so every
 * solid prop denies 0.9 m more floor than it looks like it should. The first pass of this layout
 * put the whetstone and the smith's cart in front of the forge and the two of them sealed the
 * mouth: `getNavPath` to the furnace returned null and to the anvil stopped 3.17 m short. Both
 * moved, both stations went to the back wall, and the whole approach band z [-86.6,-84.1] is kept
 * clear of anything solid. Verified live, not assumed - see
 * runs/corealm/scenarios/SETC-coldbrace.json.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE DELIBERATE DEVIATION FROM THE DIAGNOSIS, with the measurement behind it
 * ---------------------------------------------------------------------------------------------
 * Recommendation 4 moves `coldbrace_vault` to (-160,-94) so the gate street forks around it. It is
 * NOT moved, because the `march_vault_tower` landmark is authored in `regions.ts` at (-168,-93.3)
 * with the `vault_door` composition, and that composition is glued to this tower: the tower at
 * (-168,-90) rotY 0 puts its door leaf at (-167.45,-93.02), and the landmark's `door_frame_round`
 * stands 0.28 m in front of it with braziers at z = -93.7 and a kerbed approach at z = -95.2.
 * Moving the tower 8.0 m east would leave a 2.1 x 3.8 m ceremonial door frame, two torches, two
 * banners and two kerbs standing on open ground - and a landmark's hero mesh is solid
 * (`regionBuilder` calls `pushAssetSolid` on any landmark without a `clipFraction`), so it would
 * also drop a 2.1 x 0.8 m collider into whatever street ran past it. `regions.ts` belongs to
 * someone else this wave, so the town is planned around the tower where it stands: the vault is the
 * square's south-west anchor, its ceremonial door faces the paved vault yard, and the bank counter
 * is a porch on its east face looking down the court at `bank_interior`.
 */
import type { SettlementDef } from "../regions.js";

export const COLDBRACE: SettlementDef = {
  id: "coldbrace",
  name: "Millfield",
  // Lime-washed plaster, fired pantiles, and a steep pitch on the river plain.
  kit: "plaster",
  centre: [-160, -80],
  respawnPointId: "coldbrace",

  buildings: [
    // ---------------------------------------------------------------- gates
    // [8,4] gives `gateGeometry(8)` two 2 m piers and a 4 m clear arch. Its two-module depth keeps
    // the wall returns and upper decks from overlapping halfway through a module. At the [6,3]
    // these used to be authored at there is only room for one
    // 2 m pier a side, so the arch was 2 m; the navmesh erodes 0.45 m per side at the 0.45 m
    // large-world cell, and measured paths detoured 4-5 m around every gate in the game. Each
    // gatehouse stands in the matching 8 m opening in its wall run.
    { id: "coldbrace_gate_south", name: "South Gatehouse", prefab: "gatehouse", position: [-160, -108], rotationY: 0, footprint: [8, 4] },
    { id: "coldbrace_gate_east", name: "East Gatehouse", prefab: "gatehouse", position: [-134, -80], rotationY: Math.PI / 2, footprint: [8, 4] },
    // The `town_center` -> `west_track` road crosses the west wall at (-186,-72.6). The gate used
    // to be centred at z = -74, which left that crossing only 0.15 m inside the passage after the
    // navmesh's 0.45 m erosion. At z = -72 the 4 m clear arch spans z -74..-70 and the road keeps
    // 0.95 m of usable clearance. There is no `coldbrace_west_gate` route node because
    // `content/regions.ts` is not this file's to edit; the authored road is the alignment contract.
    { id: "coldbrace_gate_west", name: "West Gatehouse", prefab: "gatehouse", position: [-186, -72], rotationY: -Math.PI / 2, footprint: [8, 4] },

    // ------------------------------------------------------------ civic core
    // Unmoved. The `march_vault_tower` landmark stands 0.28 m off this tower's south door and
    // cannot follow it; see the file header.
    { id: "coldbrace_vault", name: "The Vault Tower", prefab: "tower", position: [-168, -90], rotationY: 0, footprint: [6, 6] },
    // The bank counter: a walk-under roof on the vault tower's east face, looking down the bank
    // court. `porch` collides as its back wall plus two 0.4 m posts, so there is no doorway to
    // pinch the navmesh shut. Three bays, because two put the chest and the counter on top of each
    // other. The back panel draws at x -164.72..-164.28 and the tower's own east panel draws out to
    // x = -164.898 at authored scale, so they clear by 0.18 m. The tower's spire, 7.34 m across at
    // y >= 6.25 m, overhangs this canopy's 3.36 m by
    // 0.39 m, which is a tower with eaves over its own counter, not an interpenetration.
    { id: "coldbrace_bank_porch", name: "Vault Counter", prefab: "porch", position: [-163, -89], rotationY: Math.PI / 2, footprint: [6, 3] },
    // Moved 8 m south and turned about. Its door was at (-159.55,-57.0) facing NORTH out of the
    // town, which is the "continuous window band and NO door" in SET-town_center.png. It stands on
    // the square's north kerb now with its door at (-159.45,-70.02), looking straight down the
    // square at the south gate.
    { id: "coldbrace_hall", name: "Trade Company Hall", prefab: "hall", position: [-160, -68], rotationY: 0, footprint: [12, 6] },

    // ---------------------------------------------------------- work buildings
    // Was `shed` at (-152,-98) rotY 0: its one door faced south at (-152.45,-100.02) while the
    // furnace and anvil it serves stood 6 m away on the far side of it, on grass. `forge` is walled
    // on three sides with the whole fourth face open, so the mouth opens toward the square's east
    // kerb and the player walks in to the anvil instead of reaching through a wall.
    { id: "coldbrace_forge_shed", name: "The Forge", prefab: "forge", position: [-145.5, -86], rotationY: -Math.PI / 2, footprint: [6, 4] },
    // The crafting table and fletching bench occupy separate bays under an open `arcade` on the
    // vault yard's west side. Its aisle stays walkable without repeating the bank and cookhouse
    // lean-tos.
    { id: "coldbrace_workshed", name: "Work Shed", prefab: "arcade", position: [-174, -92], rotationY: Math.PI / 2, footprint: [6, 3] },
    // The town cookhouse: a lean-to on the square's north-east corner.
    { id: "coldbrace_cookhouse", name: "Cookhouse", prefab: "porch", position: [-149, -72.5], rotationY: Math.PI, footprint: [4, 3] },
    // The covered market row on the square's west side. Its colonnade lands on x = -170.0, the
    // square's own west kerb line, so both pitches stand under a roof on the pavement instead of
    // 8.6 m out on open grass.
    { id: "coldbrace_market", name: "Market Row", prefab: "arcade", position: [-170.5, -80], rotationY: Math.PI / 2, footprint: [8, 3] },
    // The wellhead. 5.0 m from the `town_center` route node, so its 1.6 x 1.6 m curb never contests
    // the spot `moveTo({ locationId: "town_center" })` resolves to.
    { id: "coldbrace_well", name: "Millfield Well", prefab: "well", position: [-164, -77], rotationY: 0, footprint: [2, 2] },

    // --------------------------------------------------------------- houses
    // Every door below opens onto a paved street, the square, or a lane between two houses.
    // South quarter, two facing pairs on the gate street:
    { id: "coldbrace_house_1", name: "Carter's House", prefab: "townhouse", position: [-170, -102], rotationY: -Math.PI / 2, footprint: [6, 4] },
    { id: "coldbrace_house_2", name: "Pitmaster's House", prefab: "cottage", position: [-180, -102], rotationY: -Math.PI / 2, footprint: [6, 4] },
    { id: "coldbrace_house_3", name: "Weaver's House", prefab: "cottage", position: [-150, -102], rotationY: Math.PI / 2, footprint: [6, 4] },
    { id: "coldbrace_house_4", name: "Drover's House", prefab: "cottage", position: [-140, -102], rotationY: Math.PI / 2, footprint: [6, 4] },
    // The west street, facing each other across it. These two used to be corner to corner with
    // gapX = gapZ = 0.00 and 1.57 x 1.51 m of interpenetrating roof; they are 8 m apart now.
    { id: "coldbrace_house_5", name: "Warden's House", prefab: "townhouse", position: [-178, -70], rotationY: 0, footprint: [6, 4] },
    { id: "coldbrace_house_6", name: "Rope House", prefab: "cottage", position: [-178, -78], rotationY: Math.PI, footprint: [6, 4] },
    // The back lane behind the market row.
    { id: "coldbrace_house_7", name: "Old Surveyor's House", prefab: "cottage", position: [-180, -85], rotationY: Math.PI, footprint: [6, 4] },
    // On the east street, opposite the forge.
    { id: "coldbrace_house_8", name: "Empty House", prefab: "townhouse", position: [-142, -74], rotationY: 0, footprint: [6, 4] },
  ],

  // A closed 208 m circuit with a shared corner post at each of the four corners. `at` is metres
  // from `from` at the CENTRE of the gap, and every opening is 8 m, which is the width of the
  // gatehouse standing in it, so the arch and the hole in the wall are the same hole.
  //
  // The north run has NO opening on purpose: the `wall_vault` Agility obstacle in regions.ts is at
  // (-160,-56), on this run, and its whole job is to vault a wall. A gate there would make the
  // shortcut vault thin air.
  walls: [
    { id: "coldbrace_wall_s", name: "South Wall", from: [-186, -108], to: [-134, -108], openings: [{ at: 26, width: 8 }] },
    { id: "coldbrace_wall_e", name: "East Wall", from: [-134, -108], to: [-134, -56], openings: [{ at: 28, width: 8 }] },
    { id: "coldbrace_wall_n", name: "North Wall", from: [-134, -56], to: [-186, -56] },
    { id: "coldbrace_wall_w", name: "West Wall", from: [-186, -56], to: [-186, -108], openings: [{ at: 16, width: 8 }] },
  ],

  // Cobble because Coldbrace is the oldest and plainest of the three and lays what the river plain
  // gives it; the quarry town pays for dressed block and the logging town decks in plank. The
  // surface is stamped into the ground rather than laid on it, so two rects that share an edge are
  // one continuous pavement and no bound has to land on any particular metre. Only the square is
  // kerbed: kerbs ring the OUTSIDE of a rect, so kerbing both halves of a continuous pavement would
  // lay a kerb down the middle of it.
  paving: [
    // The square, 22 x 14 around `town_center` (-160,-80). 77 tiles.
    { id: "coldbrace_pave_square", rect: { minX: -170, minZ: -86, maxX: -148, maxZ: -72 }, assetId: "floor_cobble", kerb: true },
    // The vault yard: the working half of the centre, from the work shed's canopy at x = -174 to
    // the forge mouth at x = -148. 65 tiles.
    { id: "coldbrace_pave_yard", rect: { minX: -174, minZ: -96, maxX: -148, maxZ: -86 }, assetId: "floor_cobble" },
    // The gate street, from under the south arch to the yard. This is the first pavement a new
    // player ever walks on. Four metres continue outside the wall as a proper threshold. 48 tiles.
    { id: "coldbrace_pave_gate_street", rect: { minX: -166, minZ: -112, maxX: -154, maxZ: -96 }, assetId: "floor_cobble" },
    // The pit road out of the east gate, including its four-metre outer apron. 18 tiles.
    { id: "coldbrace_pave_east_street", rect: { minX: -148, minZ: -82, maxX: -130, maxZ: -78 }, assetId: "floor_cobble" },
    // The copse track out of the west gate, between houses 5 and 6. Its north row follows the
    // recentered passage while its south rows retain both houses' doorstep approach. 30 tiles.
    { id: "coldbrace_pave_west_street", rect: { minX: -190, minZ: -76, maxX: -170, maxZ: -70 }, assetId: "floor_cobble" },
  ],

  stations: [
    // Both smithing stations stand along the forge's back wall, and the front half of the
    // interior is kept clear, because the navmesh erodes 0.45 m per side and a 0.5 m object
    // therefore blocks 1.4 m of floor. The first arrangement of this forge put the anvil mid-floor
    // and `getNavPath` to the furnace came back NULL and to the anvil stopped 3.17 m short - the
    // two stations plus the whetstone had sealed their own doorway. Measured now: the forge's
    // three collision boxes leave both stations against the back wall, with the front half clear
    // after erosion and connected to the yard through the open mouth. A player at (-146.4,-85.6)
    // is 1.89 m from the anvil and 2.28 m from the furnace, both inside `INTERACT_RANGE` 2.4 m.
    // gate-check's smithing line and Cold Iron stages 2 and 3 walk `moveTo({ entityId })` to these
    // two ids, so this is load-bearing and is verified by
    // runs/corealm/scenarios/SETC-coldbrace.json, not assumed.
    { id: "coldbrace_furnace", name: "Millfield Furnace", kind: "furnace", skill: "smithing", position: [-144.6, -87], rotationY: -Math.PI / 2, assetId: "cauldron", scale: 1.6, recipeIds: [], attachedTo: "coldbrace_forge_shed" },
    { id: "coldbrace_anvil", name: "Millfield Anvil", kind: "anvil", skill: "smithing", position: [-144.8, -84.6], rotationY: -Math.PI / 2, assetId: "anvil", scale: 1.4, recipeIds: [], attachedTo: "coldbrace_forge_shed" },
    // Under the cookhouse lean-to. `cooking_pot` is a 0.54 x 0.49 m object; at 2.2 it draws
    // 1.19 x 1.07, which is a cauldron on a hearth rather than a saucepan on a lawn.
    { id: "coldbrace_range", name: "Millfield Cooking Range", kind: "range", skill: "cooking", position: [-149, -72.3], rotationY: Math.PI, assetId: "cooking_pot", scale: 2.2, recipeIds: [], attachedTo: "coldbrace_cookhouse" },
    { id: "coldbrace_crafting", name: "Millfield Crafting Table", kind: "crafting_table", skill: "crafting", position: [-174.4, -93.4], rotationY: Math.PI / 2, assetId: "workbench", recipeIds: [], attachedTo: "coldbrace_workshed" },
    // Was `workbench_drawers` at 1.6 - a 0.42 x 0.30 m drawer unit alone on grass 6 m from
    // anything. Scaling it up does not fix it: that asset's bbox is offset +0.516 m in x and
    // -0.346 m in z from its own pivot, and `regionBuilder.placeOnGround` corrects Y only, so at
    // the 3.5 the diagnosis suggested the mesh would draw 1.86 m from the entity the player is
    // told to click. `weapon_rack` is centred on its pivot to 0.000 m, draws 1.39 x 0.98 at scale
    // 1, and a rack of shafts and staves is what a fletching bench looks like from 6 m away.
    { id: "coldbrace_fletching", name: "Millfield Fletching Bench", kind: "fletching_bench", skill: "fletching", position: [-174.4, -90.6], rotationY: Math.PI / 2, assetId: "weapon_rack", scale: 1.3, recipeIds: [], attachedTo: "coldbrace_workshed" },
  ],

  // In the porch's south bay, against the back wall, with the vault tower behind it and the
  // counter in the next bay north. Measured: the chest collides x -164.13..-163.37 and the porch's
  // own back box ends at x = -164.19, so they clear by 0.06 m; the counter's collider ends at
  // z = -89.22 and the chest's starts at z = -89.76, so they clear by 0.54 m; and a stand at
  // (-162.0,-90.4), clear of the counter and of both porch posts, is 1.75 m from the chest, inside
  // `INTERACT_RANGE` 2.4 m. gate-check banks with `moveTo({ entityId })` on this id.
  bank: { id: "coldbrace_bank", name: "Millfield Bank", position: [-163.75, -90.4], rotationY: Math.PI / 2, assetId: "chest_wood", attachedTo: "coldbrace_bank_porch" },

  shops: [
    // Under the market row's canopy, 0.22 m off its back wall.
    // market_stall's counter opens along local -Z, opposite the arcade prefab's +Z mouth. This
    // quarter turn presents the counter and goods east toward the square instead of its rear roof.
    { id: "coldbrace_general", name: "Millfield General Supplies", shopKind: "general", position: [-171, -81], rotationY: -Math.PI / 2, assetId: "market_stall", attachedTo: "coldbrace_market" },
    // Clear of the forge's south-west corner. `market_stall_cart` is 3.02 x 1.06 m and grows to
    // 3.92 x 1.96 m once the navmesh erodes around it, so parked square in the mouth it walls the
    // forge off; parked here it leaves a wide eroded corridor into the opening while remaining
    // within the forge's attachment margin.
    { id: "coldbrace_smith", name: "Harrow's Metal", shopKind: "smith", position: [-150.4, -89.2], rotationY: -Math.PI / 2, assetId: "market_stall_cart", attachedTo: "coldbrace_forge_shed" },
  ],

  // Every one of these stands on a doorstep, at a counter or at a work face now, looking at
  // something. They were spread across 575 m2 of empty grass facing nothing. Measured nearest
  // collider for each: Ilse 1.00 m off the hall's front wall on the square's north kerb, Dorn
  // 0.85 m in front of the bank counter, Harrow 1.81 m from the furnace inside the forge mouth,
  // Syb 1.80 m off the Rope House, Bel 2.57 m from the crates by the wagon.
  npcs: [
    { id: "npc_warden_ilse", name: "Warden Ilse", position: [-159.4, -72], facingRad: Math.PI, assetId: "base_female", dialogueRootId: "ilse_root", questIds: [] },
    { id: "npc_pitmaster_dorn", name: "Pitmaster Dorn", position: [-162.2, -88.5], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "dorn_root", questIds: [] },
    { id: "npc_smith_harrow", name: "Harrow the Smith", position: [-147.4, -87.4], facingRad: -Math.PI / 2, assetId: "base_male", dialogueRootId: "harrow_root", questIds: [] },
    { id: "npc_ranger_syb", name: "Ranger Syb", position: [-177, -74.2], facingRad: Math.PI / 2, assetId: "base_female", dialogueRootId: "syb_root", questIds: [] },
    { id: "npc_carter_bel", name: "Carter Bel", position: [-158.5, -101.5], facingRad: Math.PI, assetId: "base_male", dialogueRootId: "bel_root", questIds: [] },
  ],

  // Set dressing. Every group below has a reason and the reason is in its comment; nothing here is
  // scattered. `solid` is set only where walking through the thing would read as a bug - a barrel,
  // a crate, a wagon - and left off fences, lamps and ground dressing, because snagging on a 12 cm
  // fence rail is worse than clipping it. `dy` is measured from the asset's own bbox floor
  // (`regionBuilder.emitProp` calls `placeOnGround` first), which is why the woodpile logs are at
  // dy 0 and not the -1.00 the diagnosis asked for: that number predates `base.y` and would now
  // bury them a metre deep.
  props: [
    // ---- Inside the south gate: the carters' yard, the first thing a new player ever sees.
    { id: "coldbrace_prop_wagon", assetId: "wagon", position: [-163, -101.5], rotationY: 0.25, solid: true },
    { id: "coldbrace_prop_gate_crate_1", assetId: "crate_village", position: [-165.4, -98.2], rotationY: 0.6, solid: true },
    { id: "coldbrace_prop_gate_barrel", assetId: "barrel", position: [-163.6, -97.6], rotationY: 0, solid: true },
    { id: "coldbrace_prop_gate_sack_1", assetId: "sack", position: [-155.6, -103.2], rotationY: 1.1 },
    { id: "coldbrace_prop_gate_sack_2", assetId: "sack", position: [-155.2, -102.3], rotationY: 2.3 },
    { id: "coldbrace_prop_gate_crate_2", assetId: "crate_wood", position: [-155.4, -100.8], rotationY: 0.4, solid: true },

    // ---- The square. Benches on three sides of the well and one bed of flowers, because 575 m2 of
    // empty paving is the same complaint as 575 m2 of empty grass.
    { id: "coldbrace_prop_bench_n", assetId: "bench", position: [-156, -74.5], rotationY: 0 },
    { id: "coldbrace_prop_bench_s", assetId: "bench", position: [-156, -84.5], rotationY: Math.PI },
    { id: "coldbrace_prop_bench_w", assetId: "bench", position: [-166, -74.5], rotationY: 0 },
    { id: "coldbrace_prop_flowers", assetId: "flower_a_group", position: [-165, -83], rotationY: 0.4, scale: 0.35 },

    // ---- Under the market row: produce and general-store stock.
    { id: "coldbrace_prop_market_apples", assetId: "barrel_apples", position: [-170.6, -78.4], rotationY: 0.3, solid: true },
    { id: "coldbrace_prop_market_crate", assetId: "crate_village", position: [-170.4, -83], rotationY: 1.2, solid: true },
    { id: "coldbrace_prop_market_sack", assetId: "sack", position: [-169.6, -77.2], rotationY: 0.8 },
    { id: "coldbrace_prop_market_carrots", assetId: "farm_crate_carrot", position: [-169.7, -82], rotationY: 0.2 },
    { id: "coldbrace_prop_market_fruit", assetId: "farm_crate_apple", position: [-169.6, -79.4], rotationY: 1.5 },

    // ---- The forge yard, on the pavement outside the forge mouth. Everything solid here is kept
    // out of the band z [-86.6,-84.1] straight out from the opening, because that band is the only
    // way into the forge and each of these props eats 0.9 m of navmesh on every side. The rack
    // hangs on the forge's north wall with 0.21 m of clearance and is not solid.
    { id: "coldbrace_prop_whetstone", assetId: "whetstone", position: [-150.6, -91.6], rotationY: 0.5, solid: true },
    { id: "coldbrace_prop_forge_rack", assetId: "weapon_rack", position: [-146, -82.3], rotationY: Math.PI },
    { id: "coldbrace_prop_forge_barrel_n", assetId: "barrel", position: [-149.2, -82.6], rotationY: 0, solid: true },
    { id: "coldbrace_prop_forge_barrel_s", assetId: "barrel", position: [-149.4, -90.2], rotationY: 0, solid: true },
    { id: "coldbrace_prop_forge_crate", assetId: "crate_metal", position: [-152.4, -83.4], rotationY: 0.9, solid: true },
    { id: "coldbrace_prop_dummy", assetId: "training_dummy", position: [-152.4, -90.4], rotationY: 0.4, solid: true },

    // ---- The bank counter, in the porch's middle bay with the chest in the south bay beside it.
    // `table_large` is 2.85 x 1.10 and solid: the player deals over it, and the 0.54 m between its
    // south end and the chest is what stops either of them boxing the other in.
    { id: "coldbrace_prop_bank_counter", assetId: "table_large", position: [-163.6, -87.8], rotationY: Math.PI / 2, solid: true },
    { id: "coldbrace_prop_bank_lamp", assetId: "lamp_wall", position: [-164.2, -89], rotationY: Math.PI / 2, dy: 1.4 },
    // ---- The vault forecourt, clear of the landmark's kerbed approach at z = -95.2.
    { id: "coldbrace_prop_vault_bench", assetId: "bench", position: [-172, -92], rotationY: Math.PI / 2 },
    { id: "coldbrace_prop_vault_crate", assetId: "crate_village", position: [-164.8, -95.6], rotationY: 0.7, solid: true },
    { id: "coldbrace_prop_vault_barrel", assetId: "barrel", position: [-165.2, -94.2], rotationY: 0, solid: true },

    // ---- The woodpile against the Carter's House west gable. `roof_log` at 0.26 is a
    // 0.30 x 0.36 x 2.78 m log; three of them, two down and one on top, under the 0.79 m eave.
    { id: "coldbrace_prop_log_1", assetId: "roof_log", position: [-172.55, -102.4], rotationY: 0, scale: 0.26 },
    { id: "coldbrace_prop_log_2", assetId: "roof_log", position: [-172.9, -102.4], rotationY: 0, scale: 0.26 },
    { id: "coldbrace_prop_log_3", assetId: "roof_log", position: [-172.72, -102.4], rotationY: 0, scale: 0.26, dy: 0.36 },

    // ---- The town garden, behind the hall. `fence_wood_single` is 2.064 m long on its own x axis,
    // so a run is one piece per 2 m module and a return is the same piece at a quarter turn.
    { id: "coldbrace_prop_fence_n1", assetId: "fence_wood_single", position: [-165, -62], rotationY: 0 },
    { id: "coldbrace_prop_fence_n2", assetId: "fence_wood_single", position: [-163, -62], rotationY: 0 },
    { id: "coldbrace_prop_fence_n3", assetId: "fence_wood_single", position: [-161, -62], rotationY: 0 },
    { id: "coldbrace_prop_fence_n4", assetId: "fence_wood_single", position: [-159, -62], rotationY: 0 },
    { id: "coldbrace_prop_fence_n5", assetId: "fence_wood_single", position: [-157, -62], rotationY: 0 },
    { id: "coldbrace_prop_fence_nw1", assetId: "fence_wood_single", position: [-166, -63], rotationY: Math.PI / 2 },
    { id: "coldbrace_prop_fence_nw2", assetId: "fence_wood_single", position: [-166, -65], rotationY: Math.PI / 2 },
    { id: "coldbrace_prop_fence_ne1", assetId: "fence_wood_single", position: [-156, -63], rotationY: Math.PI / 2 },
    { id: "coldbrace_prop_fence_ne2", assetId: "fence_wood_single", position: [-156, -65], rotationY: Math.PI / 2 },
    { id: "coldbrace_prop_garden_carrots", assetId: "farm_crate_carrot", position: [-163, -64], rotationY: 0.3 },
    { id: "coldbrace_prop_garden_apples", assetId: "farm_crate_apple", position: [-159.5, -64.5], rotationY: 1.1 },
    // The drovers' lane between houses 3 and 4. Houses 2, 4 and 7 open onto lanes rather than
    // pavement - measured doorstep to nearest paving 5.8 / 7.7 / 5.0 m - which is what a back lane
    // in a village is, so the lanes get dressed rather than paved.
    { id: "coldbrace_prop_lane_crate", assetId: "crate_wood", position: [-145.6, -101], rotationY: 0.7, solid: true },
    { id: "coldbrace_prop_lane_barrel", assetId: "barrel", position: [-145.4, -102.6], rotationY: 0, solid: true },
    { id: "coldbrace_prop_lane_fence_1", assetId: "fence_wood_single", position: [-145, -99.5], rotationY: 0 },
    { id: "coldbrace_prop_lane_fence_2", assetId: "fence_wood_single", position: [-143, -99.5], rotationY: 0 },
    { id: "coldbrace_prop_lane_sack", assetId: "sack", position: [-177.4, -81.6], rotationY: 0.5 },
    // The back-lane fence between the Rope House and the Old Surveyor's House.
    { id: "coldbrace_prop_fence_w1", assetId: "fence_wood_single", position: [-176, -81], rotationY: Math.PI / 2 },
    { id: "coldbrace_prop_fence_w2", assetId: "fence_wood_single", position: [-176, -83], rotationY: Math.PI / 2 },

    // ---- Street lighting. `lamp_wall`'s bracket runs out along its own +Z, so each of these is
    // rotated to point away from the wall it hangs on and into the street it lights.
    { id: "coldbrace_prop_lamp_vault", assetId: "lamp_wall", position: [-164.85, -91.6], rotationY: Math.PI / 2, dy: 1.5 },
    { id: "coldbrace_prop_lamp_house_1", assetId: "lamp_wall", position: [-167.94, -100.2], rotationY: Math.PI / 2, dy: 1.5 },
    { id: "coldbrace_prop_lamp_house_3", assetId: "lamp_wall", position: [-152.06, -100.2], rotationY: -Math.PI / 2, dy: 1.5 },
    { id: "coldbrace_prop_lamp_house_5", assetId: "lamp_wall", position: [-179.5, -72.06], rotationY: Math.PI, dy: 1.5 },
    { id: "coldbrace_prop_lamp_house_8", assetId: "lamp_wall", position: [-141.5, -76.06], rotationY: Math.PI, dy: 1.5 },
  ],
};
