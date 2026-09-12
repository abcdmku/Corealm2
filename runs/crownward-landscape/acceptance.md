# Crownward landscape and freshwater

Scope requested on 2026-09-12: calm the glitching water, make the lake and outlet natural, and
make all of Crownward less plain.

The freshwater animation now uses the environment's absolute clock. It previously accumulated
absolute time every frame, accelerating throughout a session. World-space normal sampling removes
the centreline-coordinate collapse at the lake ends. Lower normal strength and slower drift give
the lake small ripples and the river a gentle current.

Crownmere now uses the shared organic outline sampler, with coves and headlands. The terrain,
clipped water, navigation contour and shoreline vegetation consume that same shape. Its broad
bank transition varies along the shore. Pearlwater has softer banks and additional lower bends;
its bridge crossing coordinates and inlet elevation remain fixed.

Crownward's relief has broader warped folds and a larger height range. The existing flat-pad and
road grading passes still follow the natural field. Woodland forms larger, denser copses separated
by clearings. Bracken density increases, and the published lake contour enables willows and reeds.
These are existing production assets, with no replacement foliage models or material system.

The world-authoring exception covers authored lake shape, river course, regional relief and
world-scale scatter placement, because their relationship to the region is the behavior under test.
The reusable water renderer and organic lake support were first checked in the production river lab.

## Evidence

- `npx tsx tools/river-water-test.ts`: Chromium lab passed; inspected ripple sequences and organic shoreline.
- `npx tsx tools/river-water-test.ts --world`: Chromium passed across the lake, outlet, river bank,
  southern meadows, royal woodland and northern ridges. Each view waits for nearby scatter tiles,
  uses player-follow camera with normal 11 m zoom, and records real keyboard movement before/after.
- The loaded Crownward census included 852 woodland trees, 12 shore willows and 142 shore plants,
  with no missing scatter assets. Those are resident-region totals, not per-frame draw counts.
- Typecheck passed. River, water navigation, bridge, Crownward biome and terrain contact tests passed,
  27 tests in five files. The river tests cover absolute-clock idempotence, broad bank grading,
  concave shore agreement and continuous visible coverage through the outlet.
- World field preview passed with the authored Crownward intent centres retaining full ownership.
- `npx tsx tools/river-water-test.ts --world --routes`: both bridge crossings and both castle
  approaches passed complete navigation paths and real keyboard traversal. Inspected their captures.
- `npm run build` passed, including regenerated navigation, 336 release-world tiles and texture packing.

Disposable captures and complete reports are under `test-results/river-water/`.
The broader Cairn Tarn landform tests have two failures outside this Crownward change: maximum
bank raise and fishing depth. The older bridge browser script's default expects a 4 m deck crown,
while the current assembled bridge reports 2.225 m; the focused landscape route check tests actual
end-to-end movement instead of that legacy height assumption.
