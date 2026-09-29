# Creature motion

The repo does not generate animation. Every shipped creature clip is a studio take: native, or
retargeted from a studio donor (trimmed, mirrored or cross-faded back to Idle at most). A state with
no take is omitted: Run falls back to Walk and Hit to the runtime flinch; Attack stays empty.

Where clips come from:

- Studio bodies, through their native importers, which stage candidates under
  `test-results/creature-motion/<family>/` with a `catalog.json`:
  - `tools/animals/splice-native.ts` (with `convert.js`): Animal pack deluxe, donor strikes via
    `retarget-native.ts`.
  - `tools/fairy-terraces/monsters-build.ts`: PixeliusVita monsters.
  - `tools/wilderness-dragons/` (`build.mjs`, `dragon-boar.mjs`): Dungeon Mason dragons.
  - `tools/bosses/native-rhino.mjs`: the rhino bosses.
  - `tools/rpg-bestiary/native-export.ts`: RPG bestiary, Quaternius and OpenGameArt bodies.
  - `tools/creature-bodies/`: ghoul, furnace grazer and spriggle bodies; `unity-anim.mjs` converts
    Unity `.anim` takes.
- Tripo bodies, through `tools/creature-rig/`: rigged in Blender and retargeted rest-relative from
  studio donors. Only the listed no-donor exceptions are hand-keyed there, marked `authored`.

Root tools in this folder:

- `contact-sheet.mjs <glb> [<glb> ...]` renders every clip at fixed phases from one framing with the
  floor drawn, so a candidate can be judged against the file it replaces. Look at it; numbers are not
  acceptance.
- `measure.ts <glb>` reads gait speed (planted skinned vertices sliding back), ground height (Idle)
  and attack contact from the skinned mesh, for any rig.
- `promote.ts --catalog <json> --ids a,b [--apply]` is root-only. It copies reviewed candidates into
  `game/public/assets`, rewrites their manifest motion fields and the runtime tables in
  `game/src/content/creatureMotionTiming.ts` from `measure.ts`, and clears art verdicts recorded
  against the replaced bytes so the owner reviews the new motion in devdocs.

`pose.ts` (sample and pose a glTF clip, copy tracks), `source-clips.ts` (read FBX takes) and
`validate-deformation.ts` (skinned bounds) are shared helpers for the importers.
