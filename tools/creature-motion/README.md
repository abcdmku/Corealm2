# Creature asset repair

`npx tsx tools/rebuild-creature-motion.ts` writes reviewed candidates beneath
`runs/local-creature-rebuild/models/`. It never writes production models or the manifest.
`--only=animal_bear,boss_rhino_air` limits the rebuild and merges those assets into the existing
complete report. The report and promotion metadata are written to
`tools/data/creature-motion-rebuild.json`.

`npx tsx tools/rebuild-creature-motion.ts --only=animal_bear --hit-only` stages the bear's
revised Hit/HitLeft/HitRight without resampling its approved attacks or gaits. Their channel
samples are hashed before editing and after serialization. The bear reaction has a 0.78 s
timeline, a neck impulse at 0.06–0.11 s, delayed shoulder compression through 0.22–0.34 s,
and planted recovery. Four two-bone leg solves hold the complete paws at their Idle stance;
60 Hz keys keep contact within 2 mm between keys. The navigation root does not move.
Run `npx vitest run tools/creature-motion/bear-hit.test.ts` for the focused contact and
recovery checks. These measurements still require normal-speed feature-lab motion review.

`--only=animal_cattle,animal_aurochs,animal_boar --hit-only` rebuilds the hooved animals'
reactions with the same protection for all other clips. Cattle recoil over 0.84 s and boars
over 0.70 s. Their legs have three segments: Hip, Knee1, Knee2 and Ankle. The solver guides
each short distal segment relative to its original stance, then solves the two upper
segments with that leg's original bend direction. Ankle position and rotation hold the
complete hoof at ground contact. `npx vitest run tools/creature-motion/hooved-hit.test.ts`
checks contacts between keys, all segment lengths, knee bend direction and complete recovery.
Review cattle in the production lab before promoting the aurochs variant or boar candidate.

The source FBXs are licensed project inputs. In this workspace, animal sources are under
`~/.t3/tmp/animalpack/extracted/Assets/Animal pack deluxe/`. The Rhino Unity package is under
the owner's Unity Asset Store cache, and its extracted animation directory is staged beneath
`runs/local-creature-rebuild/source-clips/private-source/`.

`source-clips.ts` exports source animations without loading the game:

```sh
npx tsx tools/creature-motion/source-clips.ts requests.json runs/local-creature-rebuild/source-clips
```

Each request is `{ "id": "wolf_attack", "file": "absolute/path/Wolf_Attack.fbx", "name": "Attack" }`.
The rebuild consumes `wolf_attack`, `crab_idle_pose`, and `rhino_idle`, `rhino_walk`, `rhino_run`,
`rhino_attack`, `rhino_hit`, `rhino_death`. Source records include the file hash, take, bone identity,
hierarchy and any frame range. The source extraction report records the Crab idle range mismatch.

## Repairs

- Correct upside-down imported albedo and emissive atlases. Existing JPEGs keep JPEG encoding
  with measured mean channel error below 1.5/255; PNG alpha remains lossless. Geometry UVs do not
  change. Future FBX imports keep the source orientation and carry a marker to prevent double flips.
- Preserve the animal pack's authored attacks. Wolf uses its original jaw/neck take again.
- Author separate anticipation, contact, recovery and supporting-limb poses for chicken, rabbit,
  deer, frog, hog, rat and crab. Variants use the same anatomy. No authored attack translates the root.
- Supply frontal and directional hit reactions. Rhino's frontal Hit is its source `Get_Hit` take.
- Restore Rhino's actual Walk and preserve Run separately. All six imported Rhino motions resolve
  duplicate spine names by FBX node identity and hierarchy; matching on a name alone is incorrect.
- Replace Crab's walking Idle with its held source pose and a restrained claw cycle.
- Restore Frog's vertical source hop while holding horizontal root position fixed. Its source
  endpoint needs a short recovery to close the repeating gait without a joint snap.

## Acceptance

The offline gate checks unchanged geometry, UVs, skin joints, inverse binds and bind transforms;
unique channel targets; keyframe ordering; normalized quaternions; and serialization round trips.
It samples CPU-skinned geometry at nine points per locomotion/attack/hit clip to catch broken
bindings and horizontal root travel. These checks do not establish motion quality.

The root agent must inspect these candidates through the production feature lab before promotion,
including side-view attack contact, hit recovery, gait transitions and the corrected bear atlas.
Source-attack contact times are measured strike-joint reach estimates and require timeline review.
After acceptance, update manifest hashes, bytes, animations and Rhino gait metadata together.
Hog and rat still have no source Run clip; their genuine Walk is retained.

`npx tsx tools/calibrate-creature-grounding.ts` records sole contact across 48 phases of Idle,
Walk and Run. It writes `groundY` separately from bind bounds. Fish retain their authored water
depth. Corrections below 2 mm retain the existing base; transient toe downstrokes are reported
rather than compensated by an offset that would make the animal float while idle.
