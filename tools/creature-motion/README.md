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
- `self-intersection.mjs <glb> [<glb> ...] [--manifest] [--json out.json]` measures body parts
  passing through each other in every clip (15 fps plus the last frame, CPU skinning, tri-tri
  tests per bone part). Joint creases between nearby bones and contacts already present at bind or
  Idle's first frame don't count. It prints each model's worst frame (clip, time, phase, part
  pairs) ranked by the excess intersection-curve length as a percentage of the body diagonal;
  `--manifest` runs the whole creature set in about a minute on all cores. It measures curve
  length, not depth, so a folded wing lying flush or stacked wing blades score without showing.
  Render flagged frames with `contact-sheet.mjs --views audit` and look before calling it a fault.
- `measure.ts <glb>` reads gait speed (planted skinned vertices sliding back), ground height (Idle)
  and attack contact from the skinned mesh, for any rig.
- `promote.ts --catalog <json> --ids a,b [--apply]` is root-only. It copies reviewed candidates into
  `game/public/assets`, rewrites their manifest motion fields and the runtime tables in
  `game/src/content/creatureMotionTiming.ts` from `measure.ts`, and clears art verdicts recorded
  against the replaced bytes so the owner reviews the new motion in devdocs. A promoted model has a
  new hash, so its shipped thumbnails are stale: rerun `npx tsx tools/bake-art-thumbnails.ts` against
  the running devdocs, or every Art page renders those creatures in the author's browser.

- `joint-sanity.mjs [<glb> ...] [--ids a,b] [--json out.json]` checks limb joints across every clip
  (sampled at 30 fps) and in the bind pose. With no paths it runs every manifest creature (every GLB
  with a Death clip) across all cores in a few seconds. It reports:
  - hinges that bend back past straight (`hyperextension`), fold shut (`overfold`) or swing out of
    their plane (`outOfPlane`);
  - limb skin that wrings round the bone (`wrap`, the candy-wrapper);
  - biped knees and elbows, and bird heels, whose fold points the wrong way (`role`);
  - joints outside the mesh, off the limb's centre or away from its crease, and bones whose skin
    lies off their segment.
  Defaults are tuned so studio-native bodies stay quiet. Findings carry the clip, time and angle,
  and whether the clip is native. They point at frames to render; they do not accept or reject
  anything. Confirm each one on a contact sheet at that clip and time before acting.
  Quadruped roles are not judged, because rigs disagree on what their leg bones are.

`pose.ts` (sample and pose a glTF clip, copy tracks), `source-clips.ts` (read FBX takes) and
`validate-deformation.ts` (skinned bounds) are shared helpers for the importers.
