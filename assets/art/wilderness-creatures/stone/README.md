# Accepted stone-family rebuilds

Run from the repository root:

```text
node tools/wilderness-creatures/families/stone.mjs --native-grazer
node tools/wilderness-creatures/families/stone.mjs --native-maw
node tools/wilderness-creatures/families/stone.mjs --native-colossus
node tools/wilderness-creatures/families/stone.mjs --native-kiln
```

These flags automatically apply the accepted material revisions. The former explicit `--warm-hide`, `--readable-stone` and `--cool-ash` switches remain harmless but are unnecessary. Outputs are isolated native catalogs under `test-results/wilderness-creatures/families/stone/`; none of these commands promotes assets.

Grazer uses the native Dungeon Mason DragonBoar with the warm albedo edit. Maw uses the native PixeliusVita Monster04. Colossus uses the retained Quaternius humanoid and weighted knight armour with separate material factors. Kiln uses the complete gavlig Lava Golem with cooled ash albedo and fine ember maps, without the rejected collar/rib grafts. Native source licensing and hashes are retained in each candidate catalog.

No-argument invocation refuses to build. The historical `--legacy-rejected` branch is archival and produces rejected constructed bodies; it must not be promoted. Early mineral atlases and earlier Kiln atlas versions in this directory document rejected iterations. The accepted Kiln maps are `kiln-cooled-albedo-v2.png` and `kiln-cooled-emission-v2.png`.
