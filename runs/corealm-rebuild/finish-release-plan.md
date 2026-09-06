# Release preparation, September 5, 2026

This is package 14 preparation during active parallel editing. Content and layout are not frozen. No assets were promoted, no generated production outputs were regenerated, and no release acceptance is claimed.

The read-only helper `npx tsx tools/finish-release-audit.ts` writes `test-results/finish-release-audit.json`. It hashes every file in the served asset directory, reconciles manifest file sizes, parses GLB material and animation names, checks external resource references, and records source/license metadata and generator entrypoint hashes. Every manifest model has an explicit `unreviewed` disposition and empty visual/behavior evidence. Historical retain/repair labels are not reused as approval. License fields are inventory data, not entitlement verification.

## Initial snapshot

The first run took 2.1 seconds. Counts can change as owners finish work.

| Measure | Result |
| --- | ---: |
| Manifest models | 360 |
| Source packs | 28 |
| Served asset files | 661 |
| Served asset bytes | 284,111,856 |
| Manifest-referenced `models/review/` entries | 14 |
| Unreferenced served GLBs | 0 |
| Missing file, external resource, byte, clip or material-name defects | 0 |
| Current visual dispositions | 360 unreviewed |

Three generator hashes differ from current sources: `corealm-original-nature`, `corealm-original-geology`, and `corealm-original-minerals`. These can reflect active source edits; copying the new hash into the manifest without generating and accepting the corresponding output would falsely reconcile provenance.

Seven source packs have neither an archive nor generator hash: `blink-free-rpg-weapons`, `dexsoft-rocks-free`, `underhill-altar-ruins-free`, `fantasy-rhino`, `pixelius-fantasy-monster-02`, `blink-free-low-poly-swords`, and `blink-free-stylized-weapons`. Identify the exact entitled archives and record their hashes through the integration owner. Search URLs on several entries also need exact product provenance. Matching an entrypoint hash does not pin its imported generators, textures, or source dependencies.

Follow-up source inspection narrows this finding. `tools/bosses/README.md`, `tools/minibosses/catalog.mjs` and `tools/gen-docs.ts` explicitly support per-file SHA-256 provenance for Unity imports without archive pins. The seven rows are provenance improvement items, not seven established documentation build failures. The three original-generator mismatches are actual documentation validation failures. The inventory helper's stricter missing-pin diagnostic does not override that distinction.

The seven named archives exist in the local Unity cache. `Get-FileHash -Algorithm SHA256 -LiteralPath <archive>` measured these exact archive bytes on September 5. Archive filenames alone do not prove that current served outputs were built from these versions; compare extractor/import audit provenance before root adds a pin. No manifest was edited.

| Pack ID | Local archive SHA-256 |
| --- | --- |
| `blink-free-rpg-weapons` | `22810f24f1d72ccbd3d1a091352e0e904a9a8a811235cf61a584750b83666717` |
| `dexsoft-rocks-free` | `a81e0968a134f1720b028a534634377784a84f72294a95590b8361a8d176f5d2` |
| `underhill-altar-ruins-free` | `ffff7748cd1643d9a4f901e592836c7e09bacf3db51b8c9bb7f704cf87d018d9` |
| `fantasy-rhino` | `c3fca8ff44e3102c0bb880e6db70ee1cdc5850b1cd4a6465c5d761f8276f10e8` |
| `pixelius-fantasy-monster-02` | `6f94f3d37fc05aab31df03bc8bdb9f89ec138974b99146fd42ac5cc09e1c9d95` |
| `blink-free-low-poly-swords` | `a0f5483b685ef97927f8e7925c5ca9eae8c23fcd8602d5e61f618269be101fe9` |
| `blink-free-stylized-weapons` | `89b83b98f6a09959b9e8c12bf608037ea70e86137c14f83eae70efb94c03e596` |

## Explicit promotion helper

`tools/promote-finish-assets.ts` defaults to a read-only dry run and requires an explicit comma-separated ID list. It validates selected candidate SHA-256, bytes, material/animation names and existing external texture identity before writing. Existing manifest fields survive unless the candidate supplies a replacement. Pack author, source and license must be explicit; informal license prose is never converted automatically. `--pack-metadata` accepts an authoritative pack object or array, including the actual generation hash, when the staged catalogue lacks that information. Existing packs retain their declared license/source unless the root supplies this override.

```powershell
npx tsx tools/promote-finish-assets.ts --catalog art/rebuild/candidates/finish-foliage/catalog.json --ids corealm_oak_1 --pack-metadata test-results/accepted-foliage-pack.json
```

Add `--apply` only after root acceptance of those exact candidate bytes. The helper saves previous manifest and model files under `test-results/promotion-backups`, checks for manifest/destination changes during preflight, and restores old bytes if a write throws. Keep exclusive ownership during application. Backups also permit recovery after an interrupted process. No asset has been promoted by this package.

Current foliage and mineral catalogues lack a generator SHA, and the new bestiary pack lacks author/source and a supported exact license declaration. Their owners must supply accurate generation provenance before promotion. The quadruped diagnostic `catalogue.json` is not a manifest-shaped promotion catalogue and lacks file-byte/hash fields. Supply a normalized catalogue with measured bounds and runtime clip/motion fields. The helper refuses to guess them. Partial pack promotion records the pack entrypoint; it does not certify that every retained model in that pack was regenerated.

Do not delete the review directory. Its 14 files remain manifest-referenced. Removing any alias needs a binding and fixture search followed by a browser check of affected consumers.

## Budgets to preserve

| Output | Current bytes | Existing ceiling |
| --- | ---: | ---: |
| Minimap | 118,314 | 150,000 |
| 4800 detail map | 1,271,882 | 1,275,000 |
| 2400 detail map | 356,134 | 1,275,000 |
| 1200 detail map | 142,724 | 1,275,000 |
| Initial application JavaScript, gzip | Not measured in this audit | 1,000,000 |
| Critical initial JavaScript plus WASM, gzip | Not measured in this audit | 1,500,000 |

The largest detail map has only 3,118 bytes of headroom. Current ceilings are defined in `tools/generate-world-map.ts` and `game/vite.config.ts`. The map generator records prior reviewed ceiling changes; this round must not increase them to hide new regressions. Disk inventory bytes do not measure network boot payload or active GPU residency.

## Source and output dependencies

Entitled Unity archives are local dependencies under `C:/Users/Borg/AppData/Roaming/Unity/Asset Store-5.x`. Monster extraction tools and animal staging tools read those archives or extracted source directories. `test-results/creature-expansion/sources/monsters/` is disposable and does not travel with Git. The candidate archive under `art/rebuild/candidates/2026-09-05` preserves selected outputs, including rejected work, and does not replace sources or review.

The root freezes accepted bindings, model bytes and dimensions, material dependencies, equipment/hunt content, authored regions and collision before regeneration. Navigation depends on terrain, roads, water, solids, dungeon geometry, seeds and navigation settings. `tools/build-navmesh.ts` writes `game/public/generated/corealm-navmesh.bin`, its JSON metadata and `game/src/generated/navmeshFingerprint.ts` together. The map generator writes images, `world-map.json`, and `worldMapFingerprint.ts` together. Never update fingerprint source manually.

Icons depend on accepted item appearances and equipment geometry. `npm run icons` creates masters and gameplay renditions; verification checks outputs but does not accept their visual readability. Documentation depends on current content and captures. `docs:build` itself regenerates content through `gen-docs` and prepares the docs site, so it is a generated-output operation.

## Commands after root freeze

Run sequentially from the repo root on Node 24. Only the root starts GPU/browser acceptance. No concurrent heavyweight browser sessions.

```powershell
node --version
npx tsx tools/finish-release-audit.ts --out test-results/finish-release-before.json
npm run typecheck
npx tsx tools/validate-game-content.ts
npx tsx tools/finish-release-audit.ts --out test-results/finish-release-frozen-inputs.json --strict
npx tsx tools/build-navmesh.ts
npm run icons -- --all
npm run world-map
npm run capture-docs
npm test
npm run build
npm run docs:build
npx tsx tools/finish-release-audit.ts --out test-results/finish-release-after.json --strict
npm run icons:verify
npm run lab:test
npm run lab:forest
npm run lab:fishing
npm run lab:creatures
npm run smoke -- --run runs/corealm-rebuild
npm run perf -- --run runs/corealm-rebuild
git diff --check
```

The audit's strict switch fails on technical inventory defects. Even a clean strict run leaves visual dispositions unreviewed and cannot grant release approval. Save console output and inspect newly generated screenshots. Do not invoke `audit-model-library.ts` merely to mark the catalogue done; its historical family assessments require fresh review and it overwrites durable audit records.

`npm run icons` alone reuses valid existing masters, so it will not reliably refresh changed item art. Use `--all` for the final catalogue, or `--all --only <exact changed IDs>` for a deliberately scoped earlier pass. Masters are `art/item-icons/256/*.png`, gameplay files are `game/public/assets/icons/items/48/*.png`, and the contact sheet is `art/item-icons/contact-sheet-48.png`. `icons:verify` starts Chromium; it belongs to the root's serialized browser queue.

## Follow-up snapshot during integration

The updated bestiary source-round4 catalogue passes a five-model dry run with one selected model per source pack. The selection is `creature_goblin_scout,creature_goblin_shaman,creature_skeleton_soldier,creature_gargoyle,creature_minotaur`. It references 16 unique shared PNGs totaling 15,879,915 bytes, all absent from the public directory at the time of the check. The five proposed source-pack records also pass the docs provenance validator without generating documentation. This validates import preparation, not art acceptance. The report is `test-results/promotion-bestiary-five-dryrun.json`.

The user subsequently rejected the source7 hybrid/demonic direction, and root canceled that catalogue's promotion. Historical source4/source7 dry runs remain tooling checks only. Do not treat their passing provenance or runtime-field checks as release readiness. The active screening selection is retained fifteen families plus complete-source Spider and Wasp; no candidate gained approval from the dry runs.

The subsequent served inventory contains 360 models, 29 packs and 332,008,469 total asset bytes. Manifest/model consistency remains clean. Original geology and inventory mineral generator hashes still differ from source; the nature hash now matches. Seven legacy Unity packs still use their existing per-file provenance policy. Map sizes and all existing ceilings remain unchanged.

A read-only call to `fingerprintNavmeshSources()` compared every authored input group with `corealm-navmesh.json`. All seven differ: terrain geometry, roads, water, solid carves, dungeon geometry, seed-dependent inputs and navigation settings. This directly establishes that the shipped navigation artifact needs regeneration after freeze. Its binary, metadata and `navmeshFingerprint.ts` must move together.

## Promotion reconciliation after seven mineral selections

The next snapshot contains 365 models, 30 packs and 333,098,194 served asset bytes. All 121 manifest rows with explicit model SHA-256 match the served files. Source hashes match nature, creature expansion, farm, minerals and equipment. Existing geology and newly promoted ground-ore source hashes differ. Ground ore declares `c524e6d1a5783092af4ce4b94f778b0ba66e4707791954312d33597c19b168ff`; current source hashes to `bc2bdb5fad56a2eeab4a15b7398689d77fd9d4236d7c015280fda79ab5c4b448`, including after canonical LF normalization. This is not a CRLF-only mismatch.

The seven accepted mineral GLBs match both v7 and v8 candidate hashes exactly. Iron, copper, silver and quartz also match the original HEAD bytes; accepted amber, garnet and emberite changed. The mineral generator and manifest pack both hash to `64ce0dc2ad4a6757131519e77f4dcb46ec7dd1b96e03f1bb6b5570a8022305db`. The current source therefore preserves the seven accepted models. Public opal remains its HEAD hash `60b9703665027a38c584fdfffdd45eb56699acf206c0b71c82b8e3fcc05ade25`, matching neither v7 nor v8. The pack generator pin does not mean this retained opal was generated or accepted in v8.

Calling the docs pack validator without writing docs finds three failures at this snapshot: geology source hash, ground-ore source hash, and newly promoted equipment's generator missing from `ORIGINAL_GENERATORS` in `tools/gen-docs.ts`. Equipment's actual generator hash already matches its manifest pin. Add its reviewed generator to the recognized set through the integration owner, and reconcile the other generators against accepted outputs before the final docs build.

Root subsequently authorized the exact equipment allowlist addition. Its pack now passes the read-only docs validator. The mining owner is regenerating the twelve ground ores to disposable staging to compare exact bytes against accepted outputs; this does not yet reconcile the ground-ore generator pin.

The later incremental audit after Rootfall integration contains 367 models and 31 packs, totaling 341,777,633 served bytes. Current docs pack validation and the strict disk inventory report one remaining provenance failure, the intentionally unpromoted geology generator. Ground-ore, equipment and mineral provenance now pass. Cave/outcrop visual acceptance and exact served reproduction remain prerequisites; the source hash guard is retained.

The audit now follows the repository's documented Unity per-file provenance policy. Seven legacy packs receive notices only after every member's declared SHA-256 matches its served file; missing or mismatched member hashes still fail. This fixes the audit's previous false archive-pin blockers without relaxing either actual hash checks or the separate requirement for art acceptance. The helper also now checks every declared model SHA against served bytes directly.

Rootfall and relocated props invalidate final navigation/captures. The navigation source groups include `worldSites.ts`, `regionBuilder.ts` and `worldSiteDressing.ts`, but do not directly hash `render/buildings.ts` or `assets/manifest.json`. The final bake uses the actual resulting world, so freeze those inputs too; do not assume a later model or building-only change will necessarily invalidate the source-group hash automatically. No source-group contract or generated output was changed in this audit.

The worktree has no staged files and no changed tracked docs captures, item icons, navigation artifacts, map artifacts or generated TypeScript fingerprints. Git's nonignored untracked file list contains no `.unitypackage`, `.fbx`, `.tga`, `.blend`, `.psd`, `.exr`, `.zip` or `.7z` source files. The bestiary ignore rules cover source extraction, derived textures and raw formats. This is a filename/path audit, not a legal entitlement review.

Untracked bestiary candidate directories total 477,168,195 bytes across initial models, review2, source rounds 3–6 and harpy-repair4. These are multiple working revisions, not a request to commit every snapshot. Eighteen JSON files under `tools/rpg-bestiary` include provenance records and disposable CPU/gait checks; owners should distinguish required source metadata from generated diagnostics when staging. No candidate or report was deleted. Retain only deliberately chosen durable acceptance evidence.

The map fingerprint proves its captured pixels/renditions match each other, but does not hash current world source files. Current model, world and placement changes therefore require a fresh full `npm run world-map` capture. Re-encoding the existing PNG cannot prove the changed world is represented. Documentation captures under `docs/game/assets/captures` and their generated content also need refresh; avoid `--skip-existing` for final capture acceptance.

Run artifact-sensitive whole-suite tests after navigation and map regeneration. A stale-artifact failure before regeneration is useful diagnosis, but not an acceptance result for the frozen world. The performance tool keeps its current 400-draw-call limit and 180 sample-second cap; its default 32 named views at five seconds already use 160 sample-seconds before startup. Keep performance captures separate from the two-minute smoke budget and preserve exact cameras between comparisons.

Use the preserved scripts in `checks/README.md` for focused mine, settlement, portal and shop/respawn proof against the root's stable server. Root must add actual final-world entry/routed transition, realm combat, randomized hunts, equipment sets, save/reload and full player journey checks supplied by the owners. The existing portal fixture scripts prove only the fixture. An initial pack boot proves neither natural combat nor respawn.

After regenerating navigation or the map, inspect diffs and run relevant navigation/map contracts again. If content changes afterward, invalidate the dependent generated outputs and repeat only the affected generation and acceptance.

## Evidence still required

The final catalogue needs model-specific keep/rebuild/replace/rejected decisions tied to served SHA-256 and actual screenshots, plus motion/interaction evidence where applicable. User rejection of quadrupeds, ore art and tree branches remains authoritative until fresh review accepts replacements. Include every creature silhouette, equipment family, foliage family and reusable structure, then representative final-world regions, towns, mines, dungeons, water and dense encounters. A contact sheet count is not a disposition.

The testing budgets remain those in `docs/feature-lab.md`: focused tests under 10 seconds, each combined lab invocation at most 60 seconds, forest/fishing under 60 seconds each, creature lifecycle at most 120 seconds, full-world smoke at most two minutes, and CI at most five minutes. Compare performance using the same cameras and resident population before and after integration. Record exact failures and unreviewed items instead of replacing the WIP record with a broad completion claim.
