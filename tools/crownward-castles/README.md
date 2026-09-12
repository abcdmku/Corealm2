# Crownward premade castles

This staging tool fetches the accepted CreativeTrio Fortress and Castle from their pinned, public Poly Pizza GLB URLs. It verifies exact byte counts and SHA-256 hashes before writing anything. Exact source downloads remain under `test-results/crownward-castles/sources/`. Candidate GLBs add one scene-root translation to center X/Z and put the authored base at Y=0. Their mesh BIN chunks and embedded palette bytes remain unchanged. Both authored entrances already face +Z, so normalization applies no yaw.

Run `node tools/crownward-castles/build.mjs` to rebuild the ignored `test-results/crownward-castles/` staging area and refresh `catalog.json` and `provenance.json`. The catalog works with `installAssetCandidates(page, "tools/crownward-castles/catalog.json")`; its `files` map points at staged files while each asset's `file` field retains the production-relative route expected by the feature lab.

Run `node tools/crownward-castles/analyze-openings.mjs` after staging to emit low-height ray scans at `test-results/crownward-castles/opening-scans.json`. These scans help place simple collision walls around the authored gateways. They do not replace browser traversal proof. The root owns feature-lab composition, collision proxies, promotion, and final-world placement.

Source preview images are written to:

- `test-results/crownward-castles/source-previews/crownward_premade_fortress.jpg`
- `test-results/crownward-castles/source-previews/crownward_premade_castle.jpg`

The native models use a roughly two-unit footprint and a mesh-node scale of 100. Use the catalog's uniform scale and origin offsets rather than assuming one source unit is one world meter. For collision, leave the Fortress inner court and its positive-Z arch passage open. The Castle is a dense exterior landmark with a positive-Z pointed gate and should not be sold as a broad walkable courtyard.

Both assets use the same embedded `Diffuse_palette_2.jpg` swatch atlas. The untouched palette is copied into the source and normalized candidate GLBs. A later accepted material pass can remap only the grey stone swatches toward warm ivory, around `#d8cfbd` with `#eee9dd` highlights and `#aaa99f` shadow, while retaining the dark brown roof swatches. Multiplying the single material would tint the roof and stone together. Build extracts exact palette references beside the source screenshots as `*-palette.jpg`.

After the root accepts the real feature-lab gallery, run `node tools/crownward-castles/promote.mjs --evidence <passing-report.json>`. Promotion refuses missing or failing evidence, stale staged files, changed source downloads, altered BIN chunks, stale generator hashes, and incomplete CC0 pack metadata.
