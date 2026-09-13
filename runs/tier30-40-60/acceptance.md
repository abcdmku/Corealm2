# T30, T40, and T60 content acceptance

Final scope follows the user's reskin instruction: existing craftable armor, weapon, shield, and gathering-tool meshes receive image-generated material detail. Fishing rods reuse the existing procedural rod construction. No new equipment GLBs or model-manifest entries are delivered. Unused geometry candidates were discarded during the requested cleanup.

## Delivered

- 66 registered items: 17 equipment/tools and five production materials per tier; 60 recipes and six armor sets with level requirements and bonuses.
- T30 Dewglass, Willow, and Mistweave; T40 Crownsilver, Maple, and Crownhide; T60 Star Amethyst, Yew, and Faesilk.
- Ore, wood, and fabric acquisition connects to the existing regional mines, groves, and creatures.
- 75 reviewed image-generated icons: 66 new items and nine raw/cooked/burnt Crownward fish icons. Published inventory icons and generated item-guide pages are updated.
- Fifteen generated material crops preserve mineral, wood, fabric, and lining detail on existing equipment. Source prompts and hashes live in `art/equipment-retexture/regional/`; `tools/build-regional-equipment-textures.ts` reproduces the crops. Icon provenance remains in `art/item-icons/generated/`.

## Validation

- Final TypeScript check and production build passed, including refreshed generated world data.
- Eight focused Vitest files passed: 85 tests covering regional content, sets, rods, metal materials, icon coverage, dragons, and regional populations.
- Chromium production feature-lab checks passed for all three tiers: recipe level rejection, material consumption, XP, equip requirements, set bonuses, cooking outcomes, healing, mining, woodcutting, and fishing receipts.
- All six armor sets and nine held weapon/shield configurations passed browser attachment checks and fresh visual review. Root separately inspected gathering-tool screenshots, including the final T60 mineral hatchet head. Views use normal gameplay camera controls.
- All 75 icons passed inventory lab checks. Representative full-world icons, hover behavior, and movement passed.
- Documentation build passed; all 399 item pages and their icons passed desktop/mobile acceptance.

Disposable browser reports and screenshots were written under `test-results/`. The requested cleanup recycled those captures, diagnostics, baseline copies, abandoned model candidates and one-time staging scripts. The source artwork, provenance, production files, reusable generation tools and acceptance tests remain. The commands below recreate their disposable evidence.

The follow-up failure repair is complete: `npm test` passes all 373 files, with 2,852 tests passed and one existing skip, in 116.34 seconds. Typecheck, the refreshed production build, the documentation build and all links pass. The combined browser lab gate passed in 54.5 seconds; real-world Cairn fishing and Far Lake/White Castle approach navigation passed with reviewed screenshots. See [failure repairs](./failure-repairs.md) for changes and coverage. Armor browser review used the male rig; existing female mesh mappings remain supported but were not separately screenshot-reviewed.

## Repeatable browser checks

Run a local Vite game, then use each tier (30, 40, 60):

```powershell
npx tsx tools/regional-tier-content-test.ts --tier 30 --url http://127.0.0.1:4316
npx tsx tools/regional-fish-food-test.ts --tier 30 --url http://127.0.0.1:4316
npx tsx tools/regional-reskin-acceptance.ts --tier 30 --set metal --url http://127.0.0.1:4316
npx tsx tools/regional-tool-model-test.ts --tier 30 --kind all --url http://127.0.0.1:4316
```

Repeat the reskin command with `--set cloth` and `--set held`. Run tool kinds separately for unobstructed dry-ground screenshots when the combined fishing fixture covers the gathering scene with water.
