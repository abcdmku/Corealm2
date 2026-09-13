# Item icons

The item gallery at `/game/items/` shows every entry in `ALL_ITEMS`. Hovering or focusing a tile uses the same item facts and tooltip stylesheet as the game. Clicking it opens that item's page. The guide shows requirements without assuming a player's level or equipped gear.

The game loads `game/public/assets/icons/items/48/<id>.png`. The docs use the 256px masters in `art/item-icons/256/`. Inventory slots use the raster for every item, including runes, and never substitute the old generic shapes.

## Sources and regeneration

September 12, 2026 requirement: every new or replacement item icon starts with prompted image generation. Do not build basic procedural item geometry, render a fake 3D item, or screenshot a model to create an inventory icon. Missing generated artwork is an unfinished asset, never permission to use that fallback. This rule supersedes older procedural icon instructions in run PRDs and tools.

First consolidate the item catalogue so retired duplicates do not receive new artwork. Generate the icon from the surviving item's name, materials, tier, shape, and purpose. Record its exact prompt and original source, then review the 256px master and 48px inventory derivative. Only accepted artwork may be published.

Create a 3D asset from the accepted icon reference only when gameplay needs a visible held, worn, placed, or world object. Rings, earrings, and other minor jewelry need inventory artwork, not dedicated 3D assets. An item must not require a model mapping merely to publish its generated icon. Model inspection screenshots remain valid for reviewing actual gameplay assets; they are not icon sources.

Item artwork follows the item's name, description, material, and purpose. The September 11, 2026 art direction explicitly allows new designs independent of existing 3D models; future models can follow the approved artwork. `game/src/render/itemIconAppearances.ts` retains the older model mappings for rendering tools.

Generated artwork uses the original PNG under `art/item-icons/generated/`. Its registry records the item ID, original source, SHA-256, exact prompt, source selection or art direction, and review status. Keep the original transparency. The generator trims and scales it to a 256px master, then derives the outlined 48px inventory image.

Pending artwork can only be rendered with `--out`. It cannot replace published icons until its registry status is accepted. `--all` rebuilds approved artwork from its recorded source and does not overwrite it with procedural geometry.

```sh
npm run icons -- --only grithe_ring --out test-results/icon-review
npm run icons -- --only grithe_ring
npm run docs:refresh
```

The first command stages a review candidate. The second publishes an accepted source. The last copies the current masters into the generated guide and refreshes its item data. Run `npm run docs:build` to build the website too.

## Review

The [September 12 jewelry audit](../runs/jewelry-stats/icon-audit.md) found 481 current items, including 144 newer miniboss jewelry items without prompt-backed provenance. The 300-item acceptance history below applies to the earlier catalogue only. That jewelry has now been replaced: 176 retired item rows were consolidated into 140 items using 32 accepted prompted designs. That intermediate catalog had 445 items; the September 13 consolidation below supersedes it.

The September 10, 2026 audit covered all 300 current items. GPT-5.6 Luna at maximum reasoning reviewed the catalog and replacement artwork. GPT-6 Astra at medium reasoning produced 162 approved replacements; 138 existing icons passed review. The available fish and log models were also rendered and reviewed, but their inventory images lacked enough detail, so those items use generated artwork.

On September 11, the remaining 138 icons were replaced at the user's request. Astra medium workers used built-in image generation, and five fresh Luna max reviewers accepted every replacement at 256px and 48px. All 300 current items now have generated originals and recorded prompts. The first 162 originals and their published images were preserved unchanged.

The production inventory check covered all 299 inventory items, with a separate pass for the final nine fish replacements. Marks use the wallet and were checked through the gallery. The gallery covers all 300 items, including their individual pages, images, mouse hover, and keyboard focus.

The second round checked all 137 replacement items that occupy inventory slots through the production lab, including image loading and matching hover cards. Marks was reviewed separately as currency.

Inspect every icon at 48px and 256px. Reject blank images, clipped silhouettes, generic substitutes, confusing materials, and images that do not match the item's description. Confirm that a cooked or burnt item is distinguishable from its raw form.

Use `tools/item-icon-docs-acceptance.ts` to check the production inventory and hover card in the feature lab. `--stage <directory>` serves staged 48px candidates through the real inventory image path. `--icons all` checks inventory items in batches of 24; `--icons <id,id>` selects a smaller review. Marks go straight to the wallet, so their artwork is checked in the gallery. Review the screenshots as well as the semantic report. After lab acceptance and publication, repeat a representative check with `--world` and verify the docs gallery's hover and item links in Chromium.

Use `--out <directory>` on the inventory acceptance tool to keep each review's screenshots and reports together. Contact sheets, browser screenshots, and detailed audit output belong in ignored `test-results/` directories. Original artwork and its source records are durable inputs.

September 13 refinement: craftable rings use plain bands and one modest gemstone. Shared rare tier rings retain ornate silhouettes and larger settings. Each tier has only one rare ring and earring, shared by every miniboss of that tier. The final catalog has 333 items, including 28 jewelry pieces backed by 28 prompted sources.
