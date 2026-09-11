# Wilderness ruins

Four reusable compositions add settlements and infrastructure that have fallen apart. They use the shipped stone and prop models through `PartPlacement`, production materials, instancing and collision. The recipes add no custom scene meshes or asset copies.

| Composition | Footprint | Surviving structure | Ground route |
| --- | --- | --- | --- |
| `wilderness_broken_watchtower` | 22 x 20 m | A tall surviving western corner with a real slit, torn timber lookout floor on a beam and post, short eastern stubs, a stair remnant and fallen masonry outside the shell | 3.2 m central lane through both breaches |
| `wilderness_roofless_abbey` | 28 x 34 m | A tall broken apse with a slit, one standing nave arch, unequal column stumps, collapsed cloister walls and three side crypts | Open nave through the missing front and rear portals |
| `wilderness_ruined_smithy` | 30 x 22 m | Two roofless homes across a lane, a six-metre chimney above an open hearth, anvil, quenching pot, workbench, incomplete brick floor and fallen roof timbers | Six-metre lane between the buildings |
| `wilderness_shattered_aqueduct` | 42 x 16 m | Two standing corbelled arches and a dry water trough, followed by a missing span, isolated pier and fallen masonry | Four-metre central arch opening, plus the western arch |

The stone course is 0.46 m tall. Its source, `kerb_straight`, measures 2 x 0.134 x 0.7 m and has depth entirely on the positive local Z side. The placement helper centres that measured solid before applying yaw. Surviving wall height interpolates between authored points at each individual half-brick, with a deterministic loss of upper courses. The upper two courses use fractured `rubble_brick` stone meshes sized to their measured width, height and depth. These replace masonry at the broken edge, rather than perching rocks on a complete square wall. Seams alternate within each 1.8 m module, and every surviving course rests on stone below it. Fallen material uses all four `rubble_brick` meshes with their measured negative base offsets corrected.

The aqueduct uses solid corbelled masonry. Each successive course moves its inside edge 0.32 m inward while retaining the outer wall face. A cap closes the opening at 5.52 m. The dry trough starts at the resulting 5.98 m head. The kit's `wall_arch` has a wooden material and only 0.064 m depth, so it is unsuitable for this stone structure.

Every torch has a wall behind its mounting plate. `WILDERNESS_RUINS` exports the precise local mount positions and yaw for the production fire renderer. The abbey and watchtower have three torches each; the smithy and aqueduct have two. The tower's upper torch lights its surviving platform and slit at ordinary night exposure. The smithy anvil is on its original log base; its chimney sits on the stone hearth. Nothing relies on a nearby world object for support.

`buildWildernessRuinCollisionParts` uses the same recipe dimensions to merge each vertical masonry column into one solid. It preserves full surviving wall height, and leaves overhead arch courses, stairs and loose rubble out of the walking collision. The root integration must allow structural kerb assets for these composition IDs because ordinary kerbs are nonblocking road dressing. The render list remains separate from these merged collision parts.

The root's initial world candidates are the Broken Watch at [-250, 520], an abbey at [-130, 610], the smithy at [130, 565], and the aqueduct at [-205, 665]. Additional candidate clearings are [-310, 575], [-55, 675], [305, 670] and [230, 555]. These are proposals, and still need the root's population, road, slope and northern lava exclusion checks. All instances need a flat foundation matching the exported footprint, with a feathered vegetation exclusion outside it. An authored rotation transforms both the composition and its torch positions.

Focused validation is `npx vitest run tests/wilderness-ruins.test.ts --maxWorkers=1`. Its 12 checks cover measured support, joints, missing assets, duplication, torch mounting, every rendered footprint, the central player lane and merged production collision at three rotations. `npx tsx tools/wilderness-ruins-lab-test.ts` captures the actual production lab under Wilderness night, checks navigation through each ruin and walks the player through with keyboard input. It also checks flame particles and each mounted warm light, and captures closer tower-platform and smithy-hearth views under the same normal night exposure. Images and reports remain disposable under `test-results/wilderness-ruins-lab`. World placement follows root acceptance of this lab proof.

The September 10 production lab run passed for all four revised compositions, with no browser, console or game errors. Keyboard input moved the player 16.14 to 16.66 m through each open passage. Every torch emitted flame particles and had an active warm light. The final normal-night interior captures show the tower slit, beam, post and torn platform, and the forge hearth, anvil and work floor. The full scene images also cover both sides of every ruin.

| Composition | Rendered parts | Merged solids | Lit torches |
| --- | ---: | ---: | ---: |
| Broken watchtower | 397 | 20 | 3 |
| Roofless abbey | 411 | 44 | 3 |
| Ruined smithy | 238 | 36 | 2 |
| Shattered aqueduct | 171 | 9 | 2 |
