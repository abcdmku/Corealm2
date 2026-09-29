# Creature motion

Studio bodies ship their studio's own rig and takes; nothing here authors or repairs motion.
Each studio family has a native importer (`tools/animals/splice-native.ts`,
`tools/fairy-terraces/monsters-build.ts`, `tools/wilderness-dragons/build.mjs`,
`tools/bosses/native-rhino.mjs`, `tools/rpg-bestiary/native-export.ts`) that stages candidates under
`test-results/creature-motion/<family>/` with a `catalog.json`.

- `contact-sheet.mjs <glb> [<glb> ...]` renders every clip at fixed phases from one framing with the
  floor drawn, so a candidate can be judged against the file it replaces. Look at it; numbers are not
  acceptance.
- `measure.ts <glb>` reads gait speed (planted skinned vertices sliding back), ground height (Idle)
  and attack contact from the skinned mesh, for any rig.
- `promote.ts --catalog <json> --ids a,b [--apply]` is root-only. It copies reviewed candidates into
  `game/public/assets`, rewrites their manifest motion fields and the runtime tables in
  `game/src/content/creatureMotionTiming.ts` from `measure.ts`, and clears art verdicts recorded
  against the replaced bytes so the owner reviews the new motion in devdocs.

`pose.ts`, `source-clips.ts` and `validate-deformation.ts` are shared helpers for the importers.
