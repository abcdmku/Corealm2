# Deep Wilderness world gate

The root runs this gate after accepting the production creature, structure, lava, resource and loot labs, integrating their modules into ordinary world boot, and baking the final navigation mesh. The driver does not activate candidate content. A missing pack, resource, recipe or composition fails the normal world boot check.

Run each command as a separate job. Only the root owns the browser and GPU schedule. Do not run these beside another browser acceptance loop.

```powershell
npx tsx tools/deep-wilderness-world-test.ts --band shallow
npx tsx tools/deep-wilderness-world-test.ts --band deep
npx tsx tools/deep-wilderness-world-test.ts --band structures
npx tsx tools/deep-wilderness-world-test.ts --band resources
npx tsx tools/deep-wilderness-world-test.ts --band mobile
npx tsx tools/deep-wilderness-world-test.ts --band coast
npx tsx tools/deep-wilderness-world-test.ts --band regions
```

Each invocation owns one Vite server with HMR disabled, one production Chromium session and a hard 120-second deadline installed before server startup. Browser operations stop at 112 seconds to reserve time for reporting and cleanup. There is no combined all-bands invocation and no deadline override. Add `--headed` for diagnosis. If a band exceeds its budget, reduce its representative coverage or split the job. Do not increase the deadline or substitute reduced graphics for visual evidence.

Every band first reads the initial semantic actor population. It requires all authored surface and cave groups, all activated regional packs and a coastal population. Ordinary groups must have 7–15 simultaneous living residents; bosses remain singletons. It requires the old 33 Wilderness packs, the 24 new packs with 225 residents, the z460..940 semantic extent, T50/T70 new-pack placement and keeper combat levels 150, 200, 210, 280 and 350. Live `meta.enemyDefId` and maximum health must resolve to the canonical definitions. Keeper levels are checked directly on live entities.

| Band | Bounded evidence |
| --- | --- |
| `shallow` | A Cinderback pack and Ashseal Warden, real backward movement, the authored lava flow, a dry-bank walk and a blocked attempt to enter molten ground. |
| `deep` | The continuous purple atmosphere at z650, 690, 700, 710, 750 and 810; a Colossus pack and Hollow Star; a deep lava pool, dry-bank movement and blocked entry. |
| `structures` | All three authored structure positions, complete entrance-to-exit paths, complete routes to every court, production composition parts, real entrance walking and a wall collision probe derived from each production collision recipe. |
| `resources` | All six authored resource clusters, every Wilderness item and recipe in the running public documentation index, every recipe offered by a production station, real pointer mining at both ore tiers, and normal movement through one grove at each tier. |
| `mobile` | A 390×844 world view, real movement at Nightforge, the real inventory keybinding and a visible panel that fits within the viewport. |
| `coast` | A generated coastal pack selected from actual semantic metadata, native family stat IDs and bodies, a complete dry walking path, real WASD and changing patrol positions. Real aggro and a pointer attack leave changed health before seed resets. Two new seeds and a replay check regeneration and removal of stale combat state. |
| `regions` | All seven original-region boss singletons, their native replacement bodies, canonical health and levels at 3–5 times regional tier from tier 5 up, with the two tier-1 bosses at 11 and 13, real grounded movement and one normal-camera capture per boss. Ordrun uses the existing production cave loader and its observed navigation floor. |

Each band grants Melee and Magic 99, equips normal Nightglass defensive gear through the production equipment path, and fills the player's derived health once before visiting dangerous ground. This is recorded setup for spatial checks. The driver never sets enemy health through debug setup or grants loot from a tested kill.

The `coast` band calls the existing `__gameDebug.reset({seed, keepSave: false})`, which invokes the production world reset. Starting with the current seed A, it visits A, resets to A+1, visits that regenerated coast, resets to A+2 and visits again, then resets to A+1 for deterministic replay. Arithmetic wraps as an unsigned 32-bit seed. The first visit provokes real aggro and uses a canvas attack to wound or kill one actor. No enemy health is written through debug setup.

Each reset snapshot is captured synchronously before the next AI tick. The player must return to fresh health with no target, pursuers, route or activity. Coastal entities must be alive at their new spawn positions with full native health. A saved runtime may be absent immediately after reset because the next AI scan creates it; any existing row must already match the new spawn and health. After each new-seed visit, the driver requires real patrol movement, correct idle runtime rows and no coastal health or pursuit artifacts. Errors are read before reset so clearing the game's error buffer cannot hide a failed visit.

Observed coastal cell IDs, the production RNG and current terrain probes determine the expected source family, native stat ID, body, tier and count for each generated group. Replaying A+1 compares the complete resident descriptor list, including spawn coordinates and species, against its first generation. This checks the exposed result of regeneration. Private habitat and AI maps, static-solid reservations and the full hidden tree corridor map are not exposed by the current debug API and are not claimed as inspected. The root's focused CPU checks cover those private contracts. No extra hook is added.

The `regions` band covers Galeskin and Tempest Roc in the Plains, Mossbound and Rootheart in the Woodlands, Tideworn in the Highlands, Cinderwake in Ember, and Ordrun in the cave. Their expected levels are 11, 13, 15, 25, 40, 80 and 50 respectively. Galeskin and Tempest Roc sit above 5× their tier because Fallowmarch's ordinary residents already reach level 6. Surface visits use ordinary grounded follow poses. For Ordrun, `__renderDistanceLab.loadCave()` prepares the existing deferred cave; the player then teleports to a complete path on its observed nav floor while retaining the normal follow camera. Cave ground contact is checked against that navigation floor because the surface `groundHeight` probe is not the cave floor. Cave visibility and all seven boss views still need screenshot inspection.

The resource band also grants Mining 99 and one Nightglass Pickaxe. It clears the carried inventory first; worn armour remains equipped. The two ore receipts must come from canvas clicks verified by the production hover picker, followed by normal navigation and gathering. Each receipt must reduce a node's remaining yield and increase its ore inventory stack. Gathering uses natural time and has a nine-second receipt deadline. This representative integration check does not repeat the lab's full depletion, persistence or crafting matrix.

Drop equality checks run against the Node canonical `ENEMIES` definitions and connect those definitions to live actor IDs and health. The existing browser API does not expose its registered enemy drop tables. These checks do not claim to inspect that table or prove a final-world keeper kill. The accepted loot lab owns actual death, pickup and rune spending; the root's registry checks cover browser registration. No new debug hook is required by this driver.

Every capture uses a grounded player, ordinary follow focus, pitch within `CAMERA.minPitch..maxPitch`, and requested and effective distance within 6–11 metres. The focus height must remain the normal 1.1 metres above the player. Setup may relocate the player through `inspectPose` with `detached: false`; successful input is measured separately before and after real WASD or pointer actions. A blocked view fails instead of raising the target, detaching focus or enlarging zoom. Inspect a failed screenshot and choose another ordinary standing position if terrain or a wall obstructs the camera.

Reports and PNGs overwrite `test-results/deep-wilderness-world/<band>/`. They are disposable and should remain ignored. `passed: true` means the band's semantic checks passed. `visualReview` deliberately remains `pending root inspection`; inspect the images before acceptance. Check creature silhouette and grounding, shallow versus violet atmosphere, readable lava banks, reachable gate openings, court paths, supported masonry, ore contact, grove aisles, coastal resident placement, all seven regional boss bodies and mobile controls. Review the report's console, page, request and game error arrays too. The driver captures `failure.png` when possible and writes the failed stage without treating it as acceptance evidence.

The recorded lab-first exception is final authored spatial integration: world extent, biome transition, lava placement, terrain contact, world population placement and final navigation. Their reusable assets, effects and local interactions still require prior lab acceptance under [feature-lab.md](./feature-lab.md). Placement and terrain follow [world-authoring.md](./world-authoring.md). Source checks and this document alone are not browser proof.
