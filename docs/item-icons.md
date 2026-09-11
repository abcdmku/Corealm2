# Item icons

The item gallery at `/game/items/` shows every entry in `ALL_ITEMS`. Hovering or focusing a tile uses the same item facts and tooltip stylesheet as the game. Clicking it opens that item's page. The guide shows requirements without assuming a player's level or equipped gear.

The game loads `game/public/assets/icons/items/48/<id>.png`. The docs use the 256px masters in `art/item-icons/256/`. Inventory slots use the raster for every item, including runes, and never substitute the old generic shapes.

## Sources and regeneration

Use a suitable real model when one exists. `game/src/render/itemIconAppearances.ts` maps those items to their assets and material treatment. Check the rendered result at inventory size before accepting a source; a valid GLB path says nothing about its framing or readability.

Items without a suitable model use the original generated PNG under `art/item-icons/generated/`. Its registry records the item ID, original source, SHA-256, exact prompt, model-source search, and review status. Keep the original transparency. The generator trims and scales it to a 256px master, then derives the outlined 48px inventory image.

Pending artwork can only be rendered with `--out`. It cannot replace published icons until its registry status is accepted. `--all` rebuilds approved artwork from its recorded source and does not overwrite it with procedural geometry.

```sh
npm run icons -- --only grithe_ring --out test-results/icon-review
npm run icons -- --only grithe_ring
npm run docs:refresh
```

The first command stages a review candidate. The second publishes an accepted source. The last copies the current masters into the generated guide and refreshes its item data. Run `npm run docs:build` to build the website too.

## Review

The September 10, 2026 audit covered all 300 current items. GPT-5.6 Luna at maximum reasoning reviewed the catalog and replacement artwork. GPT-6 Astra at medium reasoning produced 162 approved replacements; 138 existing icons passed review. The available fish and log models were also rendered and reviewed, but their inventory images lacked enough detail, so those items use generated artwork.

The production inventory check covered all 299 inventory items, with a separate pass for the final nine fish replacements. Marks use the wallet and were checked through the gallery. The gallery covers all 300 items, including their individual pages, images, mouse hover, and keyboard focus.

Inspect every icon at 48px and 256px. Reject blank images, clipped silhouettes, generic substitutes, confusing materials, and images that do not match the item's description. Confirm that a cooked or burnt item is distinguishable from its raw form.

Use `tools/item-icon-docs-acceptance.ts` to check the production inventory and hover card in the feature lab. `--stage <directory>` serves staged 48px candidates through the real inventory image path. `--icons all` checks inventory items in batches of 24; `--icons <id,id>` selects a smaller review. Marks go straight to the wallet, so their artwork is checked in the gallery. Review the screenshots as well as the semantic report. After lab acceptance and publication, repeat a representative check with `--world` and verify the docs gallery's hover and item links in Chromium.

Contact sheets, browser screenshots, and detailed audit output belong in ignored `test-results/` directories. Original artwork and its source records are durable inputs.
