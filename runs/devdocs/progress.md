# Dev docs migration progress

The user supplied and authorized the plan in PRD.md on 2026-09-13, continuing work from another
thread. The existing schema, metadata/format/parity helpers, balance document, generation revision
change, and generated-world manifest edit were already present at the start of this thread.

## Baseline

- Commit 455b553, with the in-progress foundation changes above.
- TypeScript passed.
- Full tests: 2,908 assertions, 2,898 passed, nine failed, one skipped.
- The nine failures were initially misidentified as gameplay assertions. M2 inspection of the full
  error paths showed they came from duplicate tests under `.baseline/tools/creature-motion`, which
  cannot load the absent `.baseline/game/public` GLBs. Vitest now excludes `.baseline/**`; the
  original production tests remain in the suite. The disposable initial report is
  test-results/devdocs-baseline.json.
- Real Chromium game smoke passed movement, banking, reset, renderer and error checks.
- Production combat lab passed all checks in 46.4 seconds, including equipment, bank transfer,
  melee damage and animation, spell particles/damage and animation. Root inspected its screenshot.

## Implemented

- M0 schema combinators, atomic JSON writer, SHA-256 revisions, cross-process metadata locks,
  formatter, explicit schema registry, identity and foreign-key validation, baseline/parity tools.
- Eleven balance snapshots with schemas and focused checks against current formulas.
- M1 JSON loaders for nine shops, 24 NPCs, nine quests, 103 dialogue nodes, 36 gameplay spells,
  six runes, 24 elemental spell presentation records, and audio. Worker baseline parity passed.
- Fairy NPC and dialogue aggregate views preserve shared object identity.
- Request CLI supports list/open/claim/reply and revision conflicts. It never closes or approves.
- Strict runtime item schema prepared for M2; all 399 current item rows pass.
- Devdocs server implemented against root-owned devdocs/shared/contracts.ts. A real Vite HTTP smoke
  listed 26 collections, read nine shops with a SHA-256 revision, and rejected an unsupported PUT.

## M0/M1 integration evidence

- TypeScript, content:check, and production build pass. Initial application JS is 0.743 MB gzip
  against its 1 MB budget.
- The first full suite also discovered duplicate tests inside the untracked .baseline snapshot.
  Its nine failures were missing snapshot assets, not production gameplay failures. Vitest now
  excludes .baseline. A stale-world assertion was resolved by the normal rebuild.
- World rebuild completed 336 tiles, 128.78 MB compressed. Generated navigation and revision
  outputs changed through the normal build tooling.
- All 339 baked world record descriptors and the tile list exactly match HEAD; only the manifest
  source revision changes. No terrain, spawn, or scatter record changed.
- Combat lab repeated successfully in 43.5 seconds, including semantic damage, animation and
  bank checks. Root inspected the normal-camera screenshot.
- Full-world Chromium smoke repeated successfully, including movement, bank transfers, reset,
  and no console, page or request errors.
- Fresh read-only review identified missing world/asset reference pools, an audio JSON override,
  and nested quest stage identity checks. These are fixed with regression coverage and the
  reviewer confirmed all three. The final world rebuild and artifact checks also pass.

No new gameplay or authored placement is introduced in this round. The migrated tables are
accepted through the production combat lab, then the full game smoke. The editor is a separate
local authoring application and its API tests use temporary content, not altered production saves.

## Remaining scope

- Fresh M2 review acceptance; M3 app shell, browsing and viewers;
M4 creatures/enemies; M5 write UI and review; M6 spawns and map; M7 approvals/promotion/import;
M8 legacy cleanup; M9 player build/CI replacement; M10 browser smoke and polish.

Fairy NPC stands remain authored TS until M6. Audio now reads Crownward music areas from JSON;
the migration test also checks that those areas still match the original castle geometry.

The user selected tasteskill v2. Found and read
`C:/Users/Borg/.agents/skills/design-taste-frontend/SKILL.md`; shell work uses its contextual guidance
with the PRD's editor requirements. Design dials: variance 3, motion 3, density 8. Dark olive and
warm neutrals, Geist, Radix controls, light theme and reduced motion. No pending skill question.

M0/M1 committed as b1d9995. Regional music browser checks also passed all seven cases.
M2 now has JSON items (399), recipes (236), resources (35), gathering tiers (4), campfire fuels (9),
sets (24), and crafting tiers (5), with baseline export parity and focused checks. Its formula
coverage is 285 item tags, 236 recipe tags, 24 set threshold tags and 9 campfire fuel rows: 554
locked records in total. The devdocs catalog exposes 26 collections.
The React/Vite editor boots at 127.0.0.1:4190 in Chromium and reads the collection API without errors.
The browsing shell and production-backed viewer now boot and pass the initial devdocs smoke.
The real browser searched399items with fewer than100mounted rows, opened the 256px icon master,
followed recipe connections, played a sword on hand_r, bound five female armor parts with no
missing bones, advanced a native creature clip, scrubbed a paused animation, navigated by keyboard,
switched themes, opened mobile balance navigation and wrote an isolated temporary request. Root
inspected item, sword, female set and creature screenshots. Mobile capture needs its page transition
to finish before a final readable screenshot. Tools/devdocs-smoke.ts is repeatable and uses a temp root.

The game build passed and production combat lab passed in 42.461 seconds with semantic state and
screenshots. No original bear/hoof assertion failures remain after excluding duplicate baseline tests.
The full regression suite passes 3,109 tests with one skip; final source parity and browser evidence
are recorded below.

Fresh M2 review found duplicate gameplay fields in TREE_SPECIES/CROWNWARD_FISH, dead jewelry
recipe parameters and an ineffective umbrella export dry run. Those fixes are complete. Campfire
fuel constants now live in data, and gear, charged-weapon, regional/Wilderness, boss, material,
food and campfire formulas have explicit parameter tables. Per-module CLI baseline parity has
passed repeatedly. Root compared 71 original public exports across 16 migrated modules against
the original source snapshot, with zero differences. Permanent derivation tests independently
check the stored formula outputs.

## Current integration round

The campfire catalog has nine rows, shared by gathering tiers through campfireFuelId.
Gear progression now locks 88 regional and Wilderness rows in addition to base gear and jewelry.
All 102 base recipes also check their W-table duration, preserving the original craft-role mapping.
The remaining item formulas now use explicit parameter tables. A fresh review found and verified
the fix for missing absence checks on formula-owned optional fields. Twenty focused tests pass,
including a preview/apply regression that removes an unexpected tool bonus without losing
authored fields. The final build and editor smoke are being refreshed after that checker change.

The editor has schema forms, formula field locks, notes and a requests list. Real browser smoke
passed an item description save into temporary JSON, a concurrent-save conflict that preserved
the draft and newer disk contents, explicit reset, and a request created from the Notes tab.
The same smoke passes the production viewers, themes, keyboard navigation and mobile layout.
Root inspected edit-conflict, notes-request and readable mobile screenshots.

The recompute API previews server-derived patches with a complete collection revision snapshot.
Apply revalidates under shared locks and restores captured bytes after a failed write. Its focused
tests cover cross-collection updates, stale inputs, references and injected write failure.
The devdocs build and a fresh-cache browser smoke now pass. Typecheck, content checks and the full
regression suite pass 3,109 tests with one skip. The final-world browser smoke and combat lab also
pass; source parity is clean. Fresh source review has accepted the absence-check fix.

## Accepted M2 and app foundation

The final suite passes 3,115 tests with one skip, including four optional M4 baseline inventory
tests. Production and devdocs builds, typecheck, content validation, the refreshed editor smoke,
combat lab and final-world smoke pass. Root accepted fresh read-only source review after fixing
optional-field absence locks. The two new absence regressions pass through the checker and
server preview/apply path. M2 and the M3 shell/viewers/Kits are accepted; the editing and
recompute groundwork is included, while the remaining M4-M10 requirements continue.

## M4 JSON integration slice

Added strict normalized stores for 338 canonical enemies, 145 aliases, 246 species and 362
owner-specific loot tables. Runtime arrays and callable helpers retain original names, values,
order and optional fields. Source views reuse cached objects, including Fire/Lava provenance.
The root normalized lab registration to the same 11 lab-only blocks after initial combat-lab
acceptance. Central reference validation operates on raw proposed collections, including owner
links, contiguous order and stage compatibility. Four pre-existing staged-only model references
remain explicit warnings; registered missing assets still block.

The app now joins species combat names without adding fields to source JSON, links combat and
loot records, and supports an actual enemy health edit in the isolated browser fixture. Review
shows git diffs and validation results. Browser smoke passed these paths with no console, page
or request errors; root inspected desktop/mobile Review captures and increased diff text size.
A fresh read-only M4 source critic found no blocker in the JSON slice. The first full suite found
one Fire/Lava nested reference regression; its fix passes 16 targeted tests. Final production and
editor builds, typecheck, 3,152 tests with one skip, editor browser smoke, combat lab and world
smoke pass. Root inspected the updated Review layouts at desktop and 390 px widths. Per-record
formula preview/apply and keeping saved values both pass against temporary JSON. Enemy and loot
formula extraction remains the next M4 slice, not completed. Stage 1 contracts are now frozen.

## M4 legacy formula stage

The JSON slice is committed as 97d4270. Its final read-only critic identified a canonical
file-order gap; loader and snapshot validation now reject that reorder, with a passing direct
regression. Stage 1 extracts the 28 original marks arguments and seven pre-tuning boss seeds,
adds 35 verified tags, and moves combat-level, tuning and Ordrun phase arithmetic into pure
parameterized functions. Stored runtime enemies remain unchanged until explicit recompute.

Strict inputs reject unknown keys, bad graph targets, fractional final bonus minima and
coordinated changes to original saved boss identities. Preview responses expose source input
IDs. Root accepted fresh reviews after fixing the minimum-bonus domain. The accepted suite
passes 3,267 tests with one skip. Typecheck, production and editor builds, content validation,
combat lab (35.7 seconds), and final-world smoke pass. Editor smoke proves per-record marks
apply, remaining ordinary-record recompute, and local tier/multiplier examples with no writes.

The next source stage has independently reviewed pure functions, strict schemas and original
input extractors for 24 expansion, seven starter and 25 RPG sources. Their 56 outputs match
the baseline; JSON integration and source derivation tags are still pending. Other enemy
generator families and loot formula extraction remain unfinished M4 work. M5-M10 continue.
