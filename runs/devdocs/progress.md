# Dev docs migration progress

The user supplied and authorized the plan in PRD.md on 2026-09-13, continuing work from another
thread. The existing schema, metadata/format/parity helpers, balance document, generation revision
change, and generated-world manifest edit were already present at the start of this thread.

## Baseline

- Commit 455b553, with the in-progress foundation changes above.
- TypeScript passed.
- Full tests: 2,908 assertions, 2,898 passed, nine failed, one skipped.
- Existing failures: bear-hit.test.ts, three planted-paw assertions; hooved-hit.test.ts, six
  cattle/boar contact assertions. The disposable report is test-results/devdocs-baseline.json.
- Real Chromium game smoke passed movement, banking, reset, renderer and error checks.
- Production combat lab passed all checks in 46.4 seconds, including equipment, bank transfer,
  melee damage and animation, spell particles/damage and animation. Root inspected its screenshot.

## Implemented

- M0 schema combinators, atomic JSON writer, SHA-256 revisions, cross-process metadata locks,
  formatter, explicit schema registry, identity and foreign-key validation, baseline/parity tools.
- Seven balance snapshots with schemas and focused checks against current formulas.
- M1 JSON loaders for nine shops, 24 NPCs, nine quests, 103 dialogue nodes, 36 gameplay spells,
  six runes, 24 elemental spell presentation records, and audio. Worker baseline parity passed.
- Fairy NPC and dialogue aggregate views preserve shared object identity.
- Request CLI supports list/open/claim/reply and revision conflicts. It never closes or approves.
- Strict runtime item schema prepared for M2; all 399 current item rows pass.
- GET-only devdocs server implemented against root-owned devdocs/shared/contracts.ts. A real Vite
  HTTP smoke listed 15 collections, read nine shops with a SHA-256 revision, and rejected PUT.

## M0/M1 integration evidence

- TypeScript, content:check, and production build pass. Initial application JS is 0.743 MB gzip
  against its 1 MB budget.
- Full suite after migration retained the nine baseline animation failures. A stale-world assertion
  also failed while the rebuild was running; after the rebuild all world-release, shipped-world,
  and shipped-navigation checks passed, along with focused request and reference checks.
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

M2 item/set/recipe/resource loaders and pure balance functions; M3 app shell, browsing and viewers;
M4 creatures/enemies; M5 write UI and review; M6 spawns and map; M7 approvals/promotion/import;
M8 legacy cleanup; M9 player build/CI replacement; M10 browser smoke and polish.

Fairy NPC stands remain authored TS until M6. Audio now reads Crownward music areas from JSON;
the migration test also checks that those areas still match the original castle geometry.

The handoff requires a frontend-design skill before the shell. It was not in the available skills
or local skill folders. A question is pending about using the PRD design requirements instead.
This does not block the data and tooling work.
