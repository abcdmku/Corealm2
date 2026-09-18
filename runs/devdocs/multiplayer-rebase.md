# Multiplayer rebase

Rebased the 28 editor/content commits onto local main at `7693c64`. The original tip,
`fd7dfa5`, remains at `backup/review-pasted-text-before-multiplayer-rebase-20260917`.

The authority now registers the same resolved content tables as browser boot. Authored
server construction no longer appends the legacy regional packs: the compiled world
already owns those entities and habitats. Both multiplayer and editor dependencies and
commands remain available.

Carried main's five deep-Wilderness placement corrections into the JSON source and
recompiled the catalog. Release navigation and world records are rebuilt from the combined
sources. This uses the authored-world exception because these records describe island-wide
placement and navigation; multiplayer interactions were accepted in the production lab first.

The combat gate now expects the multiplayer message log's explicit count of one for a
single deduplicated route-failure notice. It still checks the displayed text and rejects
multiple lines or an incremented count.

Browser evidence remains disposable under `test-results/`. No protocol changes or remote
push are part of this reconciliation.

The game bundle omits unused creature definitions/profiles and equipment family/recipe
source templates. Resolved gameplay tables remain intact, with a regression test comparing
every retained table. Initial application JavaScript is 0.977 MB gzip against the unchanged
1.000 MB budget; critical JavaScript plus WASM is 1.464 MB against 1.500 MB.

Validation completed:

- TypeScript, all 28 source collections, editor build, player-guide build, and game build.
- Initial full suite: 429 passing files; the four failures were catalog parity during
  reconciliation, the migrated Wilderness coordinates, and the two stale artifact checks.
  After repairs and regeneration, all 23 affected test files passed, 189 tests. The bundle
  pruning regression also passed.
- Multiplayer production lab: 28 checks, including combat, gathering, reconnect, persistence,
  world isolation, and private loot; no runtime errors.
- Authored multiplayer: two clients, replicated movement, offline save isolation and restoration,
  and reload; 94.8 seconds, no runtime errors.
- Combat lab shard: bank transfer, equipment, target selection, melee and spells; 48.6 seconds.
- Editor browser smoke: writes, conflicts, authoring transactions, and last-valid compilation.

Normal-camera game/lab screenshots and editor screenshots were inspected.

The built production game also passed all 21 scene-transition checks in 11.1 seconds,
including failed authentication, join, reconnect, landmark retention, and offline restoration.
