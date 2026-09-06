# Structure review status

This file records the current review boundary. Older candidate directories and failed screenshots are retained as history, not approval.

## Rootfall

Root accepted the native `corealm_stump_oak` at scale 4 and four diagonal native stair flights. Stair width uses `scaleAxes: [1.6, 1, 1]`; Y and Z retain the measured native treads. Actual GLB navigation passed 15 world raster-phase cases and focused regressions. The lab proof is `test-results/finish-rootfall-stump/2026-09-05T20-56-44-029Z`.

The world proof in `test-results/finish-rootfall-world/2026-09-05T20-58-23-070Z` passed actual keyboard ascent and descent, normal bank approach, interaction and bank UI state. Its descent and bank camera views clip nearby geometry. The camera owner is correcting production camera behavior. Root accepted traversal and instructed that the shallow native bark overlap at the crest remain unchanged; it does not prevent the measured crossing.

The later `2026-09-05T21-21-16-235Z` descent view cleared the camera but exposed a low townhouse lantern intersecting the avatar's head. The townhouse lamp now keeps the whole native assembly above 2.10 m and below its balcony. Focused clearance tests pass; fresh visual acceptance is still required.

## Catalogue

`catalogue-plan.json` inventories 905 finite cases and queues 224 representatives covering all 108 named variants, all 59 authored buildings, 91 distinct composition geometries and nine compact wall witnesses. Every representative now has a supported fixture. The vault includes its real Coldbrace tower host; authored fractional porch dimensions survive fixture selection. The planner fingerprints `buildFeatureLabStructureParts`, including the host.

Browser captures and root visual decisions remain required. The planner and focused tests supply no visual acceptance. Run scheduled shards with `npx tsx runs/corealm-rebuild/checks/finish-structure-catalogue.ts --from 0 --limit 8`, incrementing `--from` by eight. Each shard has a 60-second deadline, live hardware assertion, before/after source and GLB hashes, two views per case and timestamped evidence. Stop on a concrete defect and fix the owning source before continuing that family.

`npx tsx tools/structure-review-status.ts` reconciles timestamped reports against current source and asset hashes. A passing capture remains pending until an adjacent `review.json` names `reviewedBy: "root"`, its exact `reportSha256`, and per-case `decisions` with `key`, `decision` and `reason`. Changed inputs or missing PNGs prevent acceptance from carrying forward.

Shard 0 in `test-results/finish-structure-catalogue/0/2026-09-05T21-25-46-934Z` captured eight cases and sixteen views. Root accepted six static views and rejected the porch's open wall/canopy join and the hall's banner/eave intersections. These sources have since changed. Covered bays now use consistent separate native walls, footing and slabs; the window variants preserve the common roof and trim. Native triangle raycasts verify seams and attachment clearance. The shard needs a new capture. Its report and root review remain immutable.

Schema version 2 fingerprints each used manifest entry and GLB independently. Actual GLB material names select external bark, stone or leaf maps and the corresponding metadata profile. Whole manifest and texture-context hashes remain supplemental. An unrelated asset promotion does not invalidate a structure capture, but changing a used asset, profile, map or relevant renderer/builder does.

The unused `bridge_small`, `bridge_modular_end` and `bridge_modular_center` assets have no production references in `game/src`. Root approved retirement from active review. Public files and build-catalogue entries stay in place during active integration. Active authored crossings remain covered by traversal fixtures and world placement proof.

## Shortcut geology

No replacement Sunder or Scree asset is approved for promotion.

- `reviewed-e8200209`: custom source, rejected exposed rectangular backs and unsupported world lip.
- Root candidate custom revision: tapered bodies, rejected artificial form.
- `source-outcrops`: DEXSOFT geometry with original maps, rejected bright painted rims and lobed form.
- `source-outcrops-quiet`: preserved DEXSOFT geometry with the accepted muted ore albedo treatment, rejected soft lobed form despite improved material response.
- `source-bedding`: both Poly Haven Rock Face 01 attempts were rejected in CPU review. Radial resampling produced concentric rounded forms; unchanged source-panel assembly retained torn perimeter edges and visible joins despite buried support bodies. These one-sided scans did not produce coherent exposed shortcuts.
- `closed-rock09`: a single complete Poly Haven Rock 09 body per shortcut, with original geometry and maps preserved. Its tilted legacy fit fails actual terrain support: Sunder's centre lies outside its contact hull and approximately 2.12 m above terrain; Scree has no contact within 5 cm tolerance. Measurements and section plots are in `test-results/rock09-world-grounding`. This candidate is not approved for browser or world acceptance.

The root owns public asset promotion, manifest provenance and final world placement. Staged candidates must pass the production lab before either world check or promotion.
