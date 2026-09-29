# PixeliusVita native motion

`monsters-build.ts` puts the studio's own takes back into every production body built from the PixeliusVita
packs: `fantasy_monster_01`–`09` (not 03), the retextured `fairy_guardian_02/07/08/09` copies, the Monster04
creatures `creature_cinder_ravager` and `creature_basalt_maw`, and the Monster09 `creature_gorge_mantis`.
The miniboss Monster02 bodies come from `tools/build-minibosses.ts` and are not touched here.

1. Run `extract_sources.py` if `.asset-cache/fairy-terraces/unity/sources.json` is absent.
2. Run `python tools/fairy-terraces/monsters-stage.py` to extract the Monster 07–09 Unity `.anim` files.
3. Run `npx tsx tools/fairy-terraces/monsters-build.ts [--cache=<dir>] [--out=<dir>] [--only=id,id]`.
   `--cache` defaults to `.asset-cache/fairy-terraces/unity`; output defaults to
   `test-results/creature-motion/pixelius` (`models/<production path>` plus `catalog.json` for
   `tools/promote-finish-assets.ts`).

What the build does, per target:

- Reads the production GLB (its hash must match the manifest) and keeps its mesh, skin, materials and
  textures. The skin must equal the source skin (inverse bind matrix per joint name); joints are stored at the
  source rest pose.
- Replaces every clip with the native take: Monster01–06 FBX AnimStacks (`_InPlace` preferred), Monster07–09
  `.anim` curves sampled at 60 Hz by `convertUnityAnimation` (`tools/creature-bodies/unity-anim.mjs`) (checked against the Monster01 FBX takes,
  which the studio ships in both forms). Idle, Walk, Run, Attack01 (mantis: Attack02), GetHit and Die become
  Idle, Walk, Run, Attack, Hit and Death.
- Removes horizontal `root`/`rootx` travel. Nothing else: no floor sealing, loop-end edits, retiming or IK.
- Sets `groundY` to the Unity root origin, the source floor. Monsters 07–09 hover above it and land on it
  when they die.
- A target may `keep` a production clip when its native take does not work in game; the catalog lists it.
  `fantasy_monster_07` and its guardian keep their old Death because `Monster07_Die` ends with the legs
  about 0.7 m below the source floor.

The FreeTrial bodies (`fairy_monster_10`–`34`, wardlings, spriggles) ship only Idle and Walk in the source
pack. Their committed GLBs are the first imports the owner accepted and are not rebuilt by any tool.
