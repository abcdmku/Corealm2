# RPG bestiary native motion

Production studio bodies (Dungeon Skeletons, Danimal roach and mocap goblin, gavlig lava golems, Earth Elemental, Beetle Golem, Universal Base Characters and the Quaternius bandits) take their motion from `native-export.ts`. It keeps the current production body (mesh, skin, textures, props, elite variants) and replaces its clips with the studio's own takes, renamed to runtime states. The only other changes are one uniform scale on translation deltas (UBC hip height over the UAL mannequin), deltas applied from the body's bind pose where binds were reshaped, and holding horizontal root drift in locomotion loops. There are no floor-lift tracks, retimes, sine overlays or synthesized states. Missing Run and Hit are omitted for the runtime fallbacks; a missing native Death keeps the current production Death, reported as "needs death".

```powershell
npx tsx tools/rpg-bestiary/native-export.ts [ids...] [--out test-results/creature-motion/rpg]
```

The script writes `models/<production path>.glb` and a `catalog.json` for `tools/creature-motion/promote.ts`. Set `COREALM_MAIN` when the git-ignored `derived/` sources live in another checkout.

The body factory that used to build these creatures (`build.mjs`, `export-expansion.mjs` and the `*-source/*.mjs` adapters) was removed on 2026-09-29: it forced six states by synthesizing Run, Hit and role attacks and wrapped every clip in a floor lift. Only the source extractors below remain. Each reads an owned or freely licensed archive and writes a git-ignored `derived/` record of the native takes.

| Source | Credit and licence | Extractor | Output |
| --- | --- | --- | --- |
| Dungeon Skeletons Demo | Polygon Blacksmith, Standard Unity Asset Store EULA | `python skeleton-source/extract.py` | `test-results/rpg-bestiary-skeleton/` |
| [Roach](https://opengameart.org/content/roach-game-ready-and-animated) | Atmostatic (model), Danimal (rig, animation, retexture), CC BY-SA 3.0 | `roach-source/extract_source.py` in background Blender 4.5 | `roach-source/derived/source.json` |
| [Mocap goblin](https://opengameart.org/content/goblin-animated-by-motion-capture) | xGhostx7 (body, CC0), Danimal (animation, CC BY 3.0), Wind astella (knife, CC BY 3.0) | `mocap-goblin-source/extract_source.py` in background Blender | `mocap-goblin-source/derived/source.json` |
| [Beetle Golem Animated](https://opengameart.org/content/beetle-golem-animated) | killyoverdrive (model, rig), Dm3d (animation), CC BY-SA 3.0 | `beetle-golem-source/extract_source.py` in background Blender | `beetle-golem-source/derived/source.json` |
| [Earth Elemental](https://opengameart.org/content/earth-elemental-golem) | piacenti, CC BY 3.0 | `python earth-elemental-source/extract_source.py` with the ufbx wheel in `runtime.json` | `earth-elemental-source/derived/source.json` |
| [Lava Golem](https://opengameart.org/content/lava-golem) | gavlig, CC0 (`provenance.json`) | `lava-golem-source/export_blend.py` in background Blender | `lava-golem-source/derived/{idle,walk,smash}.glb` |
| Quaternius Universal Animation Library | Quaternius, CC0 | `python humanoid-source/prepare-source.py --cache <quaternius archives>` | `humanoid-source/derived/UAL*_Standard.glb` |

Run Blender extractors with `--background --factory-startup --disable-autoexec`. `lifecycle-proof.ts`, `lifecycle-metrics.ts` and `summarize-lifecycles.mjs` measure lab lifecycle traces and do not touch assets.
