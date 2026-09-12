# Crownward and fairy creature variants

The twelve forms in `game/src/content/fairyCrownCreatures.ts` use existing complete creature bodies. The generator changes material factors only. It preserves source geometry, normals, UVs, texture pixels, skin weights, skeletons, animation channels and native dimensions. Runtime species scale sets the drawn size.

Run `node tools/fairy-crown-creatures/build.mjs` to rebuild the GLBs in `game/public/assets/models/fairy-crown/` and the adjacent `catalog.json`. The generator leaves the shared manifest unchanged. The root may run `node tools/fairy-crown-creatures/promote.mjs` to register only these twelve entries.

Run `node tools/fairy-crown-creatures/check.mjs` to compare every derivative with its shipped source. The report goes to ignored `test-results/fairy-crown-creatures/reskin-integrity.json`. Run `npx tsx tools/fairy-crown-creatures/check-catalog.ts` to check canonical combat stats, valid loot, source timing and footprint aliases, both lab preset routes, boss ranks and exact native sizing.

The production lab exposes every form as `species:<id>` and `candidate:<id>`. Ivory Castellan, Bloomheart Matriarch and Amethyst Sovereign use the full boss rank. Their group scale divides species scale by 1.6, cancelling the ordinary boss enlargement so the authored native size matches the final-world group. These commands do not prove gameplay or visual acceptance; the root owns real Chromium fights and normal-camera screenshot review before world placement.

| Region | Forms | Source bodies |
| --- | --- | --- |
| Crownward T40 | Pearl Knight, Ivory Castellan, Crown Hart, Silverthorn Harrow | Nightforge Marshal, deer, Briar Harrow |
| Gloamgarden T30 | Lantern Sprite, Moonpetal Stalker, Dewglass Weaver, Bloomheart Matriarch | Marsh Wasp, Heath Jack, Fen Crawler, Rootheart |
| Faeholme T60 | Prismatic Sprite, Orchid Reaper, Starroot Guardian, Amethyst Sovereign | Marsh Wasp, Veil Reaper, Briar Harrow, Hollow Star |
