# Crownward shoreline and fishing

The user requested a sealed water edge, T60 salmon along Pearlwater, and T30 trout plus
T40 tuna in Crownmere. Fifteen schools use the existing water: three trout, three tuna
and three groups of three salmon. Fishing requirements match those tiers. Raw, cooked
and burnt items and range/campfire recipes are registered. Existing fish models and
procedural inventory icons supply their presentation.

Water now intersects the rendered terrain rather than ending at an analytic outline.
The interior is opaque; a narrow edge fade remains at terrain contact. The bank carve
forms a short dry crest where the surrounding meadow is low.

The reusable fishing fixture was accepted in Chromium at
`?mode=combat&fishing=crownward` before world registration. Real canvas clicks caught
all three fish, increased inventory quantities and depleted their schools. The player
remained on dry ground. Captures use a player-follow camera with normal 11 m zoom.
The final-world positions use the authored-world exception because the lake, river
and their terrain intersections cannot be reproduced by an isolated asset scene.

Validation commands:

- `npx tsx tools/crownward-fishing-test.ts`
- `npx tsx tools/crownward-fishing-test.ts --world`
- `npm run typecheck`
- `npx vitest run tests/crownward-fishing.test.ts tests/river-channels.test.ts tests/gathering-integrity.test.ts tests/production-integrity.test.ts`
- `npm run build`

Disposable browser reports and captures are in `test-results/crownward-fishing/`.
The world report includes all 15 bank/depth probes, three real catches, and a low-angle
shoreline capture. Focused tests cover the requested levels, item/recipe outputs,
school placement and clipping water to rendered ground.

Final outcome: lab and world browser gates passed; inspected the three world catches
and low shoreline view. All 15 world depth/dry-bank probes passed with no browser
errors. Typecheck and 55 focused tests across eight files passed. The final production
build passed, including refreshed navigation and 336 release-world tiles.

The broader fishing-access suite retains an unrelated Cairn Tarn fixture failure:
it expects exactly one water body from a local world build, which now also registers
the Crownward river masks. Pond-only cases explicitly exclude fisheries that reference
existing channels; those have separate channel and browser coverage above.
