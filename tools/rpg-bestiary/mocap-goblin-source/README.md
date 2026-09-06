# Original mocap goblin candidate

Use `buildMocapGoblin(id)` from `goblin.mjs`. It returns `{object, clips, meta}` synchronously. This complete original source is an alternative to the current goblin. It is not registered or promoted.

The original mesh has 4,478 control vertices, 8,858 triangles, 25 bones and two materials. The knife is already part of the source. Body basecolor and tangent normal maps are 1024 px; the knife map is 2048 px. The body and knife use their respective original UV layers. Original packed PNG bytes are preserved. UV V is converted from Blender to glTF orientation, and texture bindings use `flipY: false`.

Original NLA timing is retained for Idle, Walk, Flee, Attack1, Attack2 and Die. Runtime clips are Idle, Walk, Run, Attack, AttackSecondary, Death, Hit, HitLeft and HitRight. Primary Attack uses native Attack2. The clipped native Attack1 remains as AttackSecondary with an explicit warning. Run uses Walk at 0.70 duration; native Flee stays in the original source data only due to confirmed knife/torso intersections. The three hit reactions are authored because the source has none. All four native influences are retained without truncation. Runtime changes are uniform height normalization to 1.35 m, in-place locomotion origin and whole-mesh floor correction.

## Evidence

- `audit.mjs` compares all exported vertices to native Blender evaluated poses at three phases of all six native strips. Maximum error is 0.00000223 source units. It also checks all runtime clips for floor penetration at 60 Hz.
- `inspect_clipping.py` found original knife/torso intersections in Flee at three of 25 samples and Attack1 at four of 25 samples. Attack2, Walk, Idle and Die had no knife/torso crossings in the same test. This narrow test does not rule out other self-intersections. The source author's clipping warning is confirmed.
- Reports are in `test-results/mocap-goblin-source/`. No GPU or production browser has been used. The candidate needs motion review before acceptance. AttackSecondary retains known source clipping and must not be enabled without repair.

## Reproduction and attribution

Run `extract_source.py` using the verified portable Blender 4.5.11 LTS with `--background --factory-startup --disable-autoexec`. The executable and verified archive checksum are documented in `../replacement-inventory/blender-runtime.json`. The script reads the extracted `Goblin.blend` under `test-results/fantasy-collection-source/goblin-animated-by-motion-capture/`.

Source: https://opengameart.org/content/goblin-animated-by-motion-capture

Original body by xGhostx7, CC0. Animation and derivative by Danimal, CC BY 3.0. Original knife by Wind astella, CC BY 3.0, verified on https://opengameart.org/content/wind-weapon-pack-1. Credit all three when distributing the derivative. License URLs are https://creativecommons.org/licenses/by/3.0/ and https://creativecommons.org/publicdomain/zero/1.0/. Exact contributor URLs and attribution are included in returned provenance.

Archive SHA-256: `9dd294e6a509ec9a4036d3694e73e13eeaaf80e800604e4e7e7957088d46cc3f`. The source `.blend` hash is included in returned provenance. Conversion changes preserve complete source geometry; no geometry grafts or replacement body parts were added.
