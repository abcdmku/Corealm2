# Kiln Marrow studio source

`lava-golem.mjs` exports synchronous `buildLavaGolem(id = 'kiln_marrow')`, returning `{object, clips, meta}`. The archive family remains `lava_golem`; the emitted studio body is `creature_kiln_marrow`. The retired `lava_golem` selector is rejected because that active asset now uses a separate Tripo body.

Stage the complete candidate with `node tools/rpg-bestiary/export-expansion.mjs kiln_marrow --out test-results/creature-audit/studio-animals/source-integration`. This leaves the production manifest unchanged.

The complete authored body has 5,502 triangles and a 71-bone rig. No anatomy, horns, grafts or added body parts were introduced. Uniform scale 1.5 gives about 2.8 meters of height. The original source has three native actions at 60 fps: `idle` frames 0–300, `walk` frames 0–100 and `smash` frames 0–120.

The source factory returns only native Idle, Walk and Attack, with a required motion repair marker. The exporter consumes that marker through `tools/tripo-creatures/profiles/studio-animals.ts`, adapting `fantasy_monster_02` Run and Hit to the retained rig. Death uses the grounded `animation_library_1/Death01` take calibrated against the native standing pose. Only intervals where support changes too quickly are slowed, and the settled corpse is held. Detached ankle controls follow their corresponding shin endpoints. The resulting candidate has six states: Idle, Walk, Run, Attack, Hit and Death. Attack contact phase 0.52 remains provisional until production review.

## Source and materials

The [official Lava Golem page](https://opengameart.org/content/lava-golem) credits gavlig and labels the clean download CC0. Archive `golem_clean.blend.zip` has SHA256 `602e37e8baccc55b6d9778ee2844b27278f8818ddab2fbbaa0b14b0c43a17c81`.

The author removed diffuse, normal and specular images derived from cgtextures from that official archive. The old Dropbox bundle was not used. The author preview therefore shows surface textures that are not included in the approved download.

This conversion uses new project-original basalt color and micro-normal atlases produced by `bake-rock.mjs`. They sample deterministic three-dimensional noise through the authored UVs. They use no third-party images or restricted source textures.

The author's glow PNG is extracted directly from its original packed bytes. `textureBindings.emissivePath` points to that unmodified map. Direct SDNA inspection of the Blender 2.64 material found active UV coordinates, identity texture transforms and emission factor `0.9434782266616821` in slot 3. These are explicit in the metadata. The glow remains an emissive color map; no missing specular or roughness texture is inferred. The original legacy slot also contributed diffuse color. The current replacement rock plus emissive shading is a documented material adaptation, not a claim of reproducing the excluded photographic material.

## Validation

Blender runs in background mode with automatic source scripts disabled. It bakes evaluated constraints and retains four normalized influences where the source has more. The studio repair preserves mesh data, inverse binds and native Idle, Walk and Attack samples. Contact speeds are measured from the repaired rig through the canonical contact sampler. CPU validation checks finite transforms, deformation, contact and held terminal poses; these checks do not establish visual acceptance.

Review every resulting state and body in the devdocs Art workspace through production rendering, then record the screenshot verdict before promotion. Current disposable evidence lives under `test-results/creature-audit/`.
