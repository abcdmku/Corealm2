# Regional skies and creature variants

The later [Wilderness and creature direction](./wilderness.md) replaces remote animal occupants
from this pass with complete fantasy bodies. This document records the earlier sky, map and
variant work; its roster is no longer the final-world roster.

September 2026 refinement adds 19 residents: two creatures in each of eight surface pockets and three Amethyst Spiders in Gravelmaw's Lit Gallery. Eleven are fantasy forms and eight are ordinary wildlife.

The new forms are Gloam Fox, Moonweave Spider, Rimeback Tortoise, Cindercrest Salamander, and Amethyst Spider. Each retains its complete source skeleton and clips, with a separate material variant, scale, health, magic defense, and an occasional regional essence drop. Glow is a material effect; these forms do not gain elemental spells or damage over time. Their source families are silent, and the variants remain silent.

The production sky uses distinct regional palettes, two cloud scales, shaded cloud banks, and a restrained sun halo. Fog still ends at exactly the horizon color and transitions follow the existing organic biome weights. Gravelmaw keeps its roofed cave rendering and mineral atmosphere.

The map header can center any surface region or the Stone Cavern entrance. Its controls wrap into a separate row on narrow screens, with the close button beside the title. This changes map navigation, not the terrain or the baked basemap.

## Placement and acceptance

Sky, map controls, and all five forms were exercised in the production combat lab before final acceptance. Real button attacks reduced target health. Screenshots were inspected for each region. The source asset test compares complete animation samples and joint names against the parent GLBs, and the gait gate checks the copied pursuit ceilings.

World placement uses the world-authoring exception because terrain, cave floors, and navigation cannot be proved by the compact yard. Every surface pair stands on dry playable terrain and has a path that reaches the other resident. The cave check enters through the real portal, verifies underground state, checks spider routes, and captures the Lit Gallery. Six existing, unactivated pack reservations now hold undressed creatures under those reservation IDs. They are excluded from future regional-pack activation to prevent overlapping populations; the disabled dressed packs remain gated.

Reproduce the checks:

- `npx tsx tools/regional-refinement-test.ts`
- `npx tsx tools/regional-refinement-world-test.ts`
- `npx vitest run tests/regional-variants.test.ts tests/creature-gait.test.ts tests/world-habitats.test.ts tests/biome-sky.test.ts`
- `npm run typecheck` and `npm run build`

The navigation artifact was regenerated. Screenshots and detailed before/after records remain disposable under `test-results/regional-refinement/`.

The three inherited test failures were repaired on September 10. The mine check now measures the player approach and footprint rather than the embedded ore bank; the Upper Seam haul ramp starts beyond the mining stance. The understory fixture supplies semantic region ownership. Shared starter-wasp occupants are checked inside their parent reservation, including body and idle-target clearance, rather than counted as independent overlapping packs.

`node tools/build-regional-variants.mjs` regenerates the material variants from the shipped source GLBs and updates their manifest entries. Rerun lab and source-preservation checks after regeneration.

The mine follow-up uses the world-authoring exception for the final terrain and haul approach. No reusable asset changed. Its browser evidence is in `test-results/test-fixes/upper-seam/`; terrain-dependent navigation and map artifacts are regenerated after the edit.

Validation: all 269 test files passed (2,049 tests, one existing skip), typecheck and production build passed, and the Upper Seam browser gate passed with zero failures or browser errors. The regenerated map passed its five payload checks and was visually inspected.
