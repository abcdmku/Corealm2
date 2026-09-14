# Simplification decisions

## World

The final world uses authored encounter compositions, creature placements, resource placements and region geometry. The migration captured the existing 239 surface and dungeon groups, their accepted anchors and dressing, and 50 resource placements. Stable placement IDs and the first actor's saved ID convention remain explicit inputs. Creature appearance and scale remain the accepted appearance through canonical creature presentation and placement scale adjustments.

The extra Fallowmarch population assembled from activated regional packs at boot is retired. It was a second ownership path with separate rank, assignment and acceptance records. Starter and regional variant groups already present in the main world remain among the 239 placements. This intentionally reduces redundant final-world population. Lab pack fixtures can continue to exercise production actors, but do not author world population.

Region geometry, including terrain, roads, settlements, landmarks and dungeon chambers, moved into worldRegions.json. Encounters and placements no longer reconstruct source catalogs, legacy placement overrides or regional pack plans. Generated geometry carries a source revision through the compiled catalog. Only the shared compiler reads authored inputs; the player reads the last valid compiled catalog.

The one-time source export and schema conversion scripts ran from runs/devdocs/world-migration as disposable migration inputs. They are not production compilation steps. Those scripts and the source snapshot are not durable acceptance evidence.

The authored full-world exception applies to the migrated layout. No art changed in this work. Reusable formations and local interactions still require the normal feature lab acceptance at the final testing stage. Per the user's instruction, no builds, tests or browser checks ran during implementation.

The Crownward red dragon roost moved 10 metres west, from [705,400] to [695,400]. Its inherited centre exceeded Crownward's eastern x=700 boundary. The corrected authored centre keeps the full 3.53 metre body reservation inside that region; the validator retains its existing boundary rule.


## Progression and identity

Nine numeric tiers now share material assignments, equipment families and production templates. Repeated equipment uses the shared linear curves; recipe experience follows `5 + 10 * tier`. These are intentional balance changes, so old exact-stat and fixed-time-to-kill assertions were removed. Explicit authored adjustments remain available for exceptions.

Generated IDs remain stable under display-name changes. Creature variants reference a base directly, with no alias registry or inheritance chains. Saved Vellenwood hunt contracts receive one bounded load-time ID migration from `beetle_golem_t10` to `bramble_hogs`, preserving progress and reward state.

Shared loot consolidation retains keeper-specific rune/component rewards as explicit inline drops. Four staged lab creatures have unresolved presentation assets and remain warnings in the editor; they are not accepted world placements. New creature variants need explicit presentation when their combat-only base has none.

## Testing and packaging

The final check phase retired historical parity, order, count, source reconstruction and fixed balance assertions. It retains behavioral tests and adds only focused compiler, source-watcher and asset lifecycle checks. No broad suite rerun followed the initial full run.

The game imports the accepted catalog. Its Vite packaging drops duplicate top-level authored geometry already present in the resolved world table and editor source maps; the compiler and editor retain the full catalog. Final compressed application JavaScript is 0.978 MB against the 1.000 MB budget; critical JavaScript plus WASM is 1.443 MB against 1.500 MB.
