# Slice 09 — Cave appearance

Worktree `Corealm2-wt/09-cave`, branch `finish/slice-09-cave`, rebased onto main at `e08d627`
(tree/foliage rebuild, biome skies, coastal terrain, depth-query silhouette occlusion, dynamic roof
cutaway and fixed follow camera). Dev/acceptance port 4184.

Outcome: **cave source V7 accepted and promoted.** One separate, non-cave defect is held: on current
main the production follow camera no longer avoids geometry, so a cave interior is unreadable in
ordinary play. That is reproduced with and without the scanned facing and is not a cave-art defect.

## What was accepted

`cave_rock_face_01` — the V7 continuous front-envelope derived from Poly Haven "Rock Face 01"
(Dario Barresi, CC0-1.0). The staged GLB carries only the periodic envelope geometry; the accepted
appearance also depends on two runtime pieces kept in this branch:

- `game/src/render/caveSourceDomain.ts` — three-wave global sampling-coordinate warp. The two-wave
  V7 coefficients left about one adjacent tile pair in ten a near copy (correlation above 0.6)
  wherever the 20–32 m waves were flat; the third, shorter wave in each axis breaks those plateaus
  and the sampling Jacobian determinant stays above 0.2 across the authored Gravelmaw extents.
- `game/src/render/dungeon.ts` — roof relief budget is now the source's own depth (`size.z * scale`,
  0.584 m) instead of a fixed 0.88 m. The old budget stretched roof relief nearly twofold, which is
  what turned narrow scan fissures into hard-edged black slots and made the rim motifs large enough
  to read as repeats. That was the V6 rejection.

## Evidence

All browser evidence is hardware Chromium, `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 …, D3D11)`,
1440x900, captured after the rebase (the source SHA pins in each report match the working tree).
No console errors, page errors or failed requests in any run.

### Views inspected (`runs/corealm-rebuild/checks/finish-cave-form.ts --version 7`, port 4184)

Eleven detached inspection views, all read directly: `chambers`, `wall`, `floor`, `ceiling`,
`wide-upper`, `wide-upper-reverse`, `upper-roof-wide`, `lower-up`, `lower-across`,
`join-from-lower`, `player-standing`. Native-resolution crops were cut from `wide-upper`,
`wide-upper-reverse`, `upper-roof-wide`, `ceiling` and `join-from-lower` to look for joins at the
3.9 m panel pitch.

What is actually in the images:

- No seams. No vertical normal-discontinuity strips anywhere — the V4 rejection is gone. At native
  resolution the panel pitch is not locatable on wall or roof.
- No repetition. Fissure networks differ tile to tile; no motif recurs at the 3.9 m x 3.38 m spacing.
  The V6 rejection is gone.
- No texture phase change. Colour and grain run continuously across panels (world-projected stone
  owns the colour; the shader contains no source-atlas sample).
- The roof is not flat: `ceiling`, `upper-roof-wide` and `lower-up` all show relief with fissures
  and shallow cavities, at the same physical amplitude as the walls.
- Lighting is not flat banding: a warm pool around the player over the floor, cooler ambient rock
  away from it, no terracing.
- Player and equipment are legible in `chambers`, `player-standing` and `join-from-lower`; walls are
  opaque in every view.

Held, not blocking: the surface reads slightly soft — mud-crack fissures rather than hard fractured
strata — and the lower chamber (`lower-across`) is nearly black because it is deliberately unlit.
Both are appearance judgements a later art pass can revisit; neither is a seam, repeat or hole.

### Closure

- `runs/corealm-rebuild/checks/finish-cave-holes.ts --version 7`: the opaque shell behind the facing
  is painted emissive magenta and every cave view is counted. **0 magenta pixels in all 8 views**
  (`chambers`, `wall`, `floor`, `ceiling`, `wide-upper`, `wide-upper-reverse`, `lower-up`,
  `lower-across`). Nothing sees through the visible rock.
- `tools/cave-source/diagnose-roof-pixels.ts`: 15 screen points x 9 samples on each of `ceiling`,
  `upper-roof-wide`, `lower-up`, `wide-upper` and `wide-upper-reverse` — **675 rays, every one hits
  `dungeon-rock-facing` first, zero back-facing samples**, maximum depth span across a sample
  cluster 0.453 m.
- The predecessor's pre-rebase `roof-pixel-audit-lower-up.json` reported 315 rays hitting nothing.
  That was a stale pose, not a hole: the captured `lower-up` view then used pitch +1.05, which puts
  the eye above the target and aims the rays at the floor, and the floor is walkable rather than a
  blocker. On the current poses `lower-up` is fully closed.
- Measured headroom at the three probes: 7.65 m (upper), 7.92 m (join), 7.83 m (lower), against the
  7 m requirement, and the sampled grounding height agrees with the rendered floor to within 14 mm.
- The walkable floor is byte-identical to the no-source build (`dungeon-source-facing.test.ts`
  compares the full position array), so collision and grounding are unchanged.
- The dungeon mouth recess still ends in front of the rock inside the first chamber:
  `tests/dungeon-portal-fit.test.ts` now runs the authored Gravelmaw chamber a second time with the
  scanned V7 facing loaded, and asserts the first blocker behind the recess is `dungeon-rock-facing`
  at a distance greater than the recess depth, plus roof cover above the rear.

### Ordinary-play camera (new check)

`runs/corealm-rebuild/checks/finish-cave-play-camera.ts` keeps the production follow camera,
teleports the player into the upper chamber, the join and the lower chamber, and orbits with real
right-drag input at each. Twelve screenshots per run.

Result: **the chamber is unreadable in ordinary play.** The camera stays at its full 11 m seat
outside the rock, reports `occluded: false`, and the player appears only as the 0.24-opacity
depth-query silhouette against a full-screen slab of exterior rock.

Cause, and why it is not a cave defect:

- `game/src/app/boot.ts:293` sets `camera.fixedFollow = true` (main, `7f28d11`). In
  `game/src/render/camera.ts` that makes `fixedPose` true, which skips `resolveFollowOcclusion` and
  the final `clearance()` correction entirely. The camera never pulls in for anything.
- The replacement affordance is `RoofVisibility`, and it only claims meshes whose asset id matches
  `roof_tiles_ | roof_wood_ | roof_tower | roof_dormer | floor_ | overhang_brick` on a landmark
  entity with a building id. The cave shell matches none of them: the check records
  `hiddenBuildingIds: []` and `cutHeights: {}` in all twelve shots.
- Reproduced with `--plain`, which builds the same authored cave with no scanned facing at all:
  identical camera distance, identical silhouette, identical unreadable frame. Evidence in
  `test-results/finish-cave-play-camera-plain/`.

This needs a decision from the camera/integration owner, not from cave art. Two shapes that fit the
existing code: exempt underground/dungeon focus from `fixedFollow` so the camera pulls inside the
shell, or teach `RoofVisibility` to cut the cave roof. If the cutaway route is taken, note that the
scanned facing merges wall and roof panels into one mesh — hiding the mesh would hide the walls too.
The split already exists as `geometry.userData.wallVertexCount` (the hole check uses it to make two
material groups), so a roof-only submesh is cheap to produce.

## Promotion receipt

```
npx tsx tools/promote-finish-assets.ts \
  --catalog art/rebuild/candidates/finish-cave-source/v7/catalog.json \
  --ids cave_rock_face_01 \
  --pack-metadata art/rebuild/candidates/finish-cave-source/v7/pack-metadata.json --apply
```

- catalogue sha256 `48512c8a809217645445ab5f83047cd652a0d3a8c5d509b19c542b4ccfae1895`
- manifest before `cdd9928c8f10010884849901f5a69add8689ee060e4d25d41b0bea6ee07ed6d7`
- asset `cave_rock_face_01` → `game/public/assets/models/cave/rock-face-01.glb`, 2 734 132 bytes,
  sha256 `2dae909dde94c9df91d3b28b9c1e82268af2d73dc9615734173b1ad281d27557`, previously absent
  (`oldSha256: null`), 7 168 triangles, material `Poly Haven Rock Face 01 front-envelope`
- pack `polyhaven-rock-face-01`, Rock Face 01, Dario Barresi / Poly Haven,
  https://polyhaven.com/a/rock_face_01, CC0-1.0, archive pin
  `873eac0319333e92bc96ddeedf8ebf69dc3c68ff1dfe32d8c14ddc165cdb20ac` — the upstream
  `rock_face_01.bin` glTF geometry buffer, which matches its staged copy byte for byte. There is no
  single upstream zip for this asset; the buffer is the pinned artefact the geometry derives from.
- no shared textures (the GLB embeds its own image buffer views)
- backup written under `test-results/promotion-backups/1788673212609`
- verified after promotion: `finish-cave-play-camera.ts --served` loads the asset from
  `/assets/models/cave/rock-face-01.glb` with no candidate install and produces the identical facing
  (7 168 source triangles, 606 095 rendered, `domainWarp: true`), no console or request errors.

Provenance nit fixed while checking the pins: the staged `source/rock_face_01.gltf` is the upstream
document re-serialised with two-space indentation, so it does not hash to the recorded download.
`provenance.json` now records `stagedSha256`/`stagedBytes` and says so. The geometry buffer and all
three textures are byte-identical to their pinned upstream files.

## Deletions

Superseded candidates removed after promotion:

- `art/rebuild/candidates/finish-cave-source/v2/` (straight texture joins, oversized repeated faces)
- `art/rebuild/candidates/finish-cave-source/v3/` (same rejection after the UV atlas fix)
- `art/rebuild/candidates/finish-cave-source/v5/` (clipped-collar repair; superseded by the
  continuous envelope)
- `art/rebuild/candidates/finish-cave-source/v6/` (large repeated relief)

Kept: `v7/`, `source/`, `models/` (the full staged scan), `provenance.json`, `catalog.json` and the
`tools/cave-source/` generators.

Two obsolete diagnostics that only ever targeted deleted candidates were removed with them:
`tools/cave-source/audit-uv.ts` (v2/v3 atlas comparison) and `tools/cave-source/diagnose-joins.ts`
(v5 collar joins).

Two tests that read the deleted directories were repointed rather than dropped:

- `tests/dungeon-continuous-envelope.test.ts` now runs V7 only and reads the V6 derivation metrics
  from `v7/provenance.json → derivedFrom`, into which the V6 provenance was folded (method, band
  errors, curvature, interpolation errors and the V6 GLB SHA are all preserved).
- `tests/dungeon-source-facing.test.ts` now runs against V7. Its V5-only assertions (5 210
  triangles, clipped-collar winding, `roofMatchedBorderSamples`, the source-atlas blend weight) are
  gone; the version-independent shell obligations are kept — footprint clearance, full horizontal
  ray coverage at four heights in every chamber, 4 m clearance under a lowered roof, the
  `dungeon-source-ceiling` solids, and floor equality with the no-source build.

## Tests run

- `npx tsc --noEmit` — clean, before and after promotion.
- 11 focused cave/dungeon files, 91 tests: `cave-source-domain`, `dungeon-continuous-envelope`,
  `dungeon-form`, `dungeon-materials`, `dungeon-mouth`, `dungeon-portal-fit`, `dungeon-shell`,
  `dungeon-source-facing`, `dungeon-doors`, `dungeon-gate`, `dungeon-placement`.
- After promotion: `cc-asset-license`, `asset-registry-factory`, `asset-registry-streaming`,
  `miniboss-assets` (34 tests) and the two repointed files.
- No release gate was run.

## Limits and remaining work

- **World entry is not wired.** `game/src/app/boot.ts:674` still loads the scanned facing only under
  `?caveSource=1` in the feature-lab profile. The asset is now served and the manifest carries it,
  but the authored Gravelmaw dungeon in the real world does not use it until root removes that gate.
  `boot.ts` is not editable in this slice. Everything else the world needs is already in place: the
  builder path is the production `buildDungeon`, `dungeon.blockers` are already registered with
  `cameraQueries`, `dungeonSolids` emits the source ceilings, and the walkable floor is unchanged.
- The ordinary-play camera defect above blocks a playable cave regardless of the asset.
- No performance claim is made. For the record only, the profile of one captured frame shows the
  facing as a single 606 095-triangle draw in colour and again in shadow.
- No Codex call was needed: the mesh and material work was already staged, and inspection found no
  geometry or texture defect to author.
- Screenshots under `test-results/` are not committed. Regenerate with, on port 4184:
  `PORT=4184 npx tsx runs/corealm-rebuild/checks/finish-cave-form.ts --version 7`,
  `… finish-cave-holes.ts --version 7`, `… finish-cave-play-camera.ts [--plain|--served]`.
