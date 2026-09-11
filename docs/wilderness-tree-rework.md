# Wilderness tree rework

September 10, 2026.

The Wilderness T50 resource is Veinwood and T70 is Magic Tree. Existing resource, item, cluster and asset IDs remain stable, including the existing teak and magic timber receipts. Normal-region Teak is unchanged.

The four deadwood models now use parent-following collars, subordinate branches and staggered growth. The broad crown has six unequal scaffold limbs instead of nine repeated rising arcs. The hollow bole continues into its main stem. Ground roots vary their reach and branch into smaller roots. The fallen bole carries six uneven structural roots with attached secondary torn roots, distributed in depth as well as height. Dead roots and their descendants retain their root classification.

Both Veinwood variants retain more intact leaf sprays and less whole-tree bending. The two Magic variants retain the accepted native hierarchy with restrained deformation instead of a large height-based spiral. Their bark, leaf cutouts and magic material response remain in production. Matching stumps were rebuilt from the living lower boles.

The Wilderness scatter recipe uses the accepted hollow and claw models in the two slots previously occupied by the older generic snags. Weights, seeds, layer IDs and candidate placement settings are unchanged. The world-authoring exception applies only to checking this final scatter substitution and authored grove placement. Every changed reusable model passed through staged production-lab rendering first.

## Verification

- Production build and TypeScript checks passed.
- The five focused tree/resource/progression suites passed 42 tests. The added fallen-root topology regression also passed, bringing those suites to 43 tests.
- Staged geometry validation passed for finite normals, nondegenerate faces, exact living/stump root contact agreement and embedded bark textures.
- Deadwood lab passed near, far, return, night and mixed-grove checks. Living-tree labs passed both tiers with canopy, wood-only, root detail and night captures. Root inspected representative images for every variant.
- Real canvas gathering depleted both tiers, yielded six T50 logs and five T70 logs, and preserved the original tree positions and textured stumps.
- Evidence is disposable under `test-results/wilderness-trees/` and `test-results/wilderness-resources/`. The updated deadwood acceptance script uses grounded player-follow views within interactive pitch and zoom limits.

The broader authored-world resource gate failed on the existing missing station for `smelt_cindersteel_bar`. It also recorded elemental-effect shader errors involving `MATTER_KIND` and `instanceColor`, outside the tree changes. These failures are not waived. The focused world check passed its tree assertions for all four nine-tree groves, including resource names and real aisle movement, but failed the final console-error check on the elemental shaders. The shallow grove screenshots do not yet provide clear visual acceptance of every living tree. The focused tree world report is `test-results/wilderness-trees/world/report.json`; inspect its separate tree assertions and overall error status before accepting the world gate. Manifest world acceptance remains false pending a clean world check.

## Solitary timber placement

The follow-up adds individual harvestable trees throughout the Wilderness field. `wandering_timber` uses the existing unclustered Poisson sampler at 52 m candidate spacing, with a 180 base instance budget before the island budget multiplier and terrain rejection. The cap is not an asserted final count. It has no cluster or road-accent generator. Existing authored groves stay unchanged.

Candidate density follows the shared Wilderness biome field. Each accepted position favours the local tier with 4:1 species weights: mostly Veinwood south of the progression divide and mostly Magic north of it, with occasional trees of the other tier in both bands. Choosing a species does not change the density at the divide. Normal tree exclusions, water clearance, a 0.45 maximum slope, stable forest IDs, trunk collision, gathering and saved depletion all use the existing production paths.

This is a world-scale placement change using previously lab-accepted models, so it uses the documented world-authoring exception. No new asset, material or interaction implementation is introduced. `tests/wilderness-timber-scatter.test.ts` checks production generation across both bands, both variants, road exclusion and repeatable saved identities. `tools/wilderness-trees/scatter-world-test.ts` checks streamed trees and movement in the authored world and retains runtime errors as failures.

The solitary-placement build, typecheck and focused generation/forest tests passed. The hardware browser run timed out waiting for nearby world scatter to finish streaming, before recording a placement sample. Its final stats had no missing assets but had not yet populated Wilderness tiles. This is incomplete visual proof, not an accepted empty Wilderness. Software-mode results are recorded separately and cannot substitute for production-quality screenshots.

The reduced-graphics fallback also timed out during world readiness. Neither browser run is marked passed; final-world visual and interaction acceptance remain outstanding.

The density correction increased individual candidate spacing from 42 to 52 m and reduced the base cap from 280 to 180. The deterministic production-sampler fixture dropped from 176 to 131 trees, about 26% fewer. Both bands retain both tiers with a local majority. These are fixture counts, not an island census. Authored groves remain unchanged.
