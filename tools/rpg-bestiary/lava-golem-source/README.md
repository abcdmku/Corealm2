# Lava Golem source candidate

`lava-golem.mjs` exports synchronous `buildLavaGolem(id = 'lava_golem')`, returning `{object, clips, meta}`.

The complete authored body has 5,502 triangles and a 71-bone rig. No anatomy, horns, grafts or added body parts were introduced. Uniform scale 1.5 gives about 2.8 meters of height. The original source has three native actions at 60 fps: `idle` frames 0–300, `walk` frames 0–100 and `smash` frames 0–120.

Eight output clips include those native Idle, Walk and Attack takes. Run is a 1.45-times Walk derivative. Hit, HitLeft and HitRight use the native idle pose with authored spine recoil. Death is an explicitly authored forward collapse with a spine curl. The source contains no native run, hit or death animations. Attack contact phase 0.52 remains provisional until production review.

## Source and materials

The [official Lava Golem page](https://opengameart.org/content/lava-golem) credits gavlig and labels the clean download CC0. Archive `golem_clean.blend.zip` has SHA256 `602e37e8baccc55b6d9778ee2844b27278f8818ddab2fbbaa0b14b0c43a17c81`.

The author removed diffuse, normal and specular images derived from cgtextures from that official archive. The old Dropbox bundle was not used. The author preview therefore shows surface textures that are not included in the approved download.

This conversion uses new project-original basalt color and micro-normal atlases produced by `bake-rock.mjs`. They sample deterministic three-dimensional noise through the authored UVs. They use no third-party images or restricted source textures.

The author's glow PNG is extracted directly from its original packed bytes. `textureBindings.emissivePath` points to that unmodified map. Direct SDNA inspection of the Blender 2.64 material found active UV coordinates, identity texture transforms and emission factor `0.9434782266616821` in slot 3. These are explicit in the metadata. The glow remains an emissive color map; no missing specular or roughness texture is inferred. The original legacy slot also contributed diffuse color. The current replacement rock plus emissive shading is a documented material adaptation, not a claim of reproducing the excluded photographic material.

## Validation

Blender runs in background mode with automatic source scripts disabled. It bakes evaluated constraints and retains four normalized influences where the source has more. CPU validation samples all eight final clips at 49 points each and includes the whole mesh. The lowest floor is above 0.00267 meters; the authored death reduces height from 2.82 to 1.28 meters. Reports are under `test-results/lava-golem-source/`.

Official static preview inspection found a hunched rock biped with an integrated blunt face, slab shoulders, stone hands/feet and glowing fissures. No horned, demonic or animal-head motif was present. No production 3D browser or GPU was used. Material appearance, gait, attack contact and authored death still require parent browser acceptance.
