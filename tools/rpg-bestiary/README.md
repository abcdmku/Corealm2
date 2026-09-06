# RPG bestiary candidates

`game/src/content/rpgBestiary.ts` currently exposes 17 named creatures across seven families: the retained goblin, skeleton, zombie, wraith and golem families, plus the user-approved whole-source spider and fantasy bee. Historical rejected rows remain filtered out. The active rows carry region, habitat, stats, existing elemental drops, marks, respawn, attack intent, provenance and measured neutral bounds. `rpgBestiaryLevel(id)` delegates to the game's stat-derived level formula.

The user's rejection of animal-head humanoids and horned/demonic designs overrides historical source7 reviews. Those assets are withdrawn. Current work adapts complete freely licensed or entitled source bodies and rigs. The exact spider and repaired fantasy bee passed production lifecycle checks and were promoted by root; retained15 still require current gallery and family lifecycle acceptance. `STATUS.md` records the current evidence. `export-expansion.mjs` stages complete forest and earth sources separately without adding them to active content or the public manifest.

```powershell
python tools/rpg-bestiary/source-inventory.py
python tools/rpg-bestiary/humanoid-source/prepare-source.py --cache ../Corealm/.asset-cache
python tools/rpg-bestiary/wraith-source/prepare.py
node tools/rpg-bestiary/build.mjs
node tools/rpg-bestiary/audit.mjs
npx vitest run tests/rpg-bestiary.test.ts
```

Build outputs stay in `art/rebuild/candidates/finish-bestiary`. The exporter writes a `catalog.json` compatible with `installAssetCandidates()`, including byte counts, hashes and a map from production URLs to candidate files. A positional list of IDs builds a subset and replaces the catalogue with that subset. Run without IDs to restore the complete catalogue.

The inventory records local entitlement hashes and source asset paths. Replacements use Quaternius CC0 characters, outfits and animations; Polygon Blacksmith's entitled skeleton; PixeliusVita's entitled Monster04 body for the horned demon and gargoyle; and the entitled aurochs head and hooves for the minotaur. Each catalogue row records its exact source provenance. Original archives remain untouched.

Versioned source catalogues use shared external PNG textures at a maximum dimension of 2048. The existing shared-texture helper preserves exact encoded image hashes, and production `AssetTextureCache` shares matching external images and GPU texture storage. `sharedTextures` records file, encoded byte count, SHA256 and media type. Candidate and production relative paths match. The review hook verifies both models and images before serving them. Each revision includes its own payload and compatibility reports; successful source/skin/GLTFLoader checks do not establish art acceptance.

## Root integration

1. Append `RPG_BESTIARY` to the production species registry for lab registration. Keep final-world packs staged until visual acceptance.
2. Register each `row.stats` through the existing species enemy path in `enemies.ts`. Existing family IDs are stable `row.id`, enemy IDs are `<id>_t<tier>`.
3. Install the exact versioned candidate catalogue into the review browser context before boot. Every manifest ID is `creature_<id>` and every gallery/combat preset is `species:<id>`.
4. Use the existing production creature gallery and ordinary combat spawn fixture. Inspect idle, moving, turning, attack, hit and death. Normal input must prove kills, elemental loot, currency and respawn. Gallery playback alone does not prove these behaviors.
5. Promote accepted files and manifest rows through the root-owned manifest, then integrate accepted regional packs in a later round.

Ranged roles use the shared `EnemyDef.attackStyle` and `attackRangeM` additions. Goblin and Skeleton Archers use ranged attacks at 10 m. Goblin Shaman, Skeleton Mage, Banshee and Lizardman Shaman use magic at 8 m. Other rows use melee at 1.8 m. Clip contact phases reside in the asset catalogue and come from the actual authored clip metadata.

The compatibility audit checks source articulation, converted skins and GLTFLoader output through matching animation samples. It also checks finite attributes, weighted geometry and a 1 cm floor penetration limit. These checks do not establish natural gait, visual art quality, final-world placement, performance or release readiness. Every catalogue row remains `labAccepted: false` and `worldIntegrated: false` until root acceptance.

The optional third argument `{ append: true }` to `exportBestiary(ids, directory, options)` replaces only selected IDs in an existing catalogue. This supports bounded revisions without rebuilding unchanged bodies. Source extraction and preview binaries under `tools/rpg-bestiary` are ignored; retain original archives in the local caches documented by each source helper. The skeleton source extractor checks its archive hash automatically when the model factory first needs it.

Source6 is the immutable complete hardware gallery revision. Source7 contains narrow fixes found by that gallery and the fresh root critic, plus approved measured locomotion metadata. See `STATUS.md` for unresolved acceptance work. `payload-summary.json` records revision-specific storage and texture estimates.

`finalize-review.mjs <candidate-directory> <immutable-baseline-directory>` verifies all GLB hashes against fresh or exact baseline audits, applies approved gait metadata, and synchronizes measured content bounds. Its `revision.json` records changed binary hashes. The production `speed-matched` locomotion policy chooses a measured Walk/Run stride at the real movement speed; `gait-contact-review.md` documents the zombie Run rejection and its explicit Walk alias. No helper sets visual acceptance.
