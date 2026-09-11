# Ash and northern creature candidates

These five bodies are staged through the production asset loader. They are not promoted by the generator.

Run `node tools/biome-creatures/ash/build.mjs` to write the hash-checked candidate catalogue and GLBs under `test-results/biome-creatures/ash/`. Run `npx tsx tools/biome-creatures/ash/lab-test.ts` only during the assigned GPU slot. The browser driver uses the real combat yard, its actual creature materials, live native rigs and normal combat action. The root must inspect its pictures before promotion.

| Creature | Source body and rig | Authored anatomy | Authored motion |
| --- | --- | --- | --- |
| Kiln Marrow | Lava Golem, native 71-joint rig | Chest surface cut away around a recessed furnace organ, stone ribs, hunched crater collar, reshaped torso and fused crushing forearm | Longer brace before the native two-arm smash, later contact, spine compression on recovery |
| Slag Crawler | Webweaver Spider, native 39-joint rig | Original abdomen and eye material removed, broad segmented slag carapace, shovel jaw and folding mandibles, reshaped lower body | Heavy eight-leg gait, abdomen rock, jaw closure during the bite |
| Cinder Penitent | Revenant, native 65-joint rig | Hood, belt ornaments and pauldrons removed, split asymmetric robe, new sealed elongated iron face and burnt cloth collar | Bowed head and suspended forearms, true hover locomotion derived from its idle bone channels |
| Grave Lantern | Grave Ghoul, native 65-joint rig | Human face removed, hollow ribbed skull around a recessed light organ, shoulder hump, enlarged forearms and exposed arched ribs | Searching head pendulum, hunched stalk and head recoil during its asymmetric claw attack |
| Veil Reaper | Banshee, native 65-joint rig | Swept-back elongated cowl, trailing split shroud, hooked digits, torn arm membranes weighted across four native joints | Suspended locomotion, forearm opening and head drift, an inward pulling attack |

The original licensing records remain embedded in each derivative. New anatomical geometry uses a dedicated imagegen atlas for bone, layered slag, hammered iron and funerary linen. Slag legs and the Penitent shroud use the same atlas through their existing UV unwraps. Every material selects one inset cell, so unrelated materials cannot bleed across UV islands. Other source texture and normal-map bindings are preserved. The PNG and exact built-in prompt are saved beside this file. The source asset hash, generator hash, vertex deformation count, removed topology, added surfaces and motion changes are recorded in each catalogue entry.

The generator samples every indexed vertex using native joint matrices and inverse bind matrices. Grounded locomotion only receives enough correction to lift penetration, preserving the native run's aerial phases. The two apparitions hold a small animated clearance. Death poses settle on the ground. This is CPU evidence; readable silhouettes, convincing motion and material response still require the lab screenshots.

The focused CPU test regenerates the five candidates and checks unique hashes, native rig completeness, finite bounds, floor clearance, moving horizontal radius below 3.5 metres at species scale, normalized membrane weights and declared attack contact timing. It does not claim visual acceptance.

