# Devdocs art review

September 27, 2026. The Art workspace replaces isolated asset development in the feature lab.
Reviewing a creature body, its variants, an outfit, a worn tier, or any state they play happens
in devdocs. The lab remains for game integration and for interactions between assets.

## Goals

1. Every creature body and every variant that wears it, on one screen, rendered as the game renders it:
   presentation asset, scale, tint and six motion states (idle, walk, run, attack, hit, death).
2. Every equipment set and every worn tier, on either body, in every player pose.
3. A verdict (approved, needs polish, replace) and a note on the whole record or any aspect of it,
   stored in dev metadata so a queue can list what still needs work.
4. No page scrolls. Focus pages fit one viewport: list, stage, strips, inspector.
5. Keyboard first: J/K or Alt+Up/Down walks records, 1 to 9 picks states, A/P/R sets a verdict.

## Layout

`ui/FocusLayout.tsx` is the only frame: a list rail (15rem), a header, the stage, a strip under the
stage (states, variants, tiers) and an inspector (20rem). The list and inspector scroll inside
themselves. Container queries drop the list below 72rem and stack the inspector below 52rem.
`StateStrip`, `VerdictBar`, `VerdictDot` and `StripRow` live beside it.

## Contracts (root-owned; workers stop and report if one is wrong)

- `viewer/types.ts`: `ViewerSource` mode `actor` (`{ creatureId }`), `CREATURE_STATES`,
  `ViewerStateInfo`, `ViewerAppearance`, snapshot `states`/`state`/`appearance`, and the optional
  `ViewerModel` hooks `states`, `initialState`, `setState`, `update`.
- `ViewerCore.setState(name)` and `AssetViewer`'s controlled `state` prop. Changing state never reloads.
- `model/creatureArt.ts`: `creatureLook`, `creatureLooks`, `creatureBodies`. A variant with no
  presentation wears its base's.
- `model/artReview.ts`: `useArtReview(collection, id)`, `useArtDigest(collection)`. Verdicts sit on
  `assets` (a body, by manifest id), `creatureDefinitions` (a variant), `equipmentSets` (an outfit)
  and `items` (one worn piece). Aspect keys are `<kind>:<name>`: `state:death`, `pose:mine`,
  `body:female`, `slot:head`, `tier:20`, `variant:<creatureId>`.
- Server: `tools/content/meta.ts` `art` block and `ART_VERDICTS`; the `art` patch operation and digest
  fields in `devdocs/server/handlers/meta.ts`.

## Ownership

| Owner | Files |
| --- | --- |
| Root | contracts above, `ui/FocusLayout.tsx`, `ui/workspaces.ts`, `workspaces/registry.ts`, `workspaces/art/index.tsx`, this doc |
| Actor stage | `devdocs/src/viewer/**` except `types.ts`; `tests/devdocs-viewer-*.test.ts` |
| Creatures view | `devdocs/src/workspaces/art/creatures/**` |
| Outfits view | `devdocs/src/workspaces/art/outfits/**` |
| Record pages + queue | `devdocs/src/workspaces/{creatures,items,assets}/**`, `devdocs/src/workspaces/art/queue/**`, `devdocs/src/ui/EntitySummary.tsx` |

## Verification

- `npx tsc --noEmit -p .` and `npx vitest run tests/devdocs-*.test.ts`.
- Screenshots with `tools/devdocs-shot.ts --base http://127.0.0.1:4195 --width 1440 --height 900`
  (and 2560x1440). Every focus page must report no x-overflow and must not scroll.
- `tools/devdocs-surface-audit.ts --base http://127.0.0.1:4195` before calling the round done.

## Built (September 27, 2026)

- **Art > Creatures** (`#/art/creatures[/<assetId|creatureId>]`): a contact sheet of every body (177), then a
  focus page per body: the actor stage, states 1–6 (idle, walk, run, attack, hit, death;
  synthesised ones marked `*`), a variant filmstrip (`[`/`]`) with tinted per-definition thumbnails, and
  verdicts on the body, each state and each variant.
- **Art > Outfits** (`#/art/outfits[/<setId>]`): the tier ladder (melee, magic, boss) with piece icons and
  verdict dots, then a focus page per set: all 17 poses (gathering poses hold their tool), male/female,
  per-piece show/hide, the neighbouring tiers, and verdicts on the set, each pose, body and piece.
- **Art > Queue** (`#/art/queue`): bodies, variants and sets by verdict and open checks, beside the
  September prose audit from `docs/creature-asset-audit.md`.
- The actor stage (`viewer/actor.ts`, `actorEntity.ts`) draws a definition through the game's
  `EntityViews` exactly as a placed creature: world rank, level, scale, tint and dye.
- Creature, item, set and model record pages keep their primary fields visible and put the rest behind
  one remembered tab bar (`[`/`]`), so the common record fits one 1440x900 screen. Each links to its art.

Known gaps: creatures with several loot rolls still scroll on the Loot tab; boss rank comes from world
placement, so lab-only boss rows render at enemy size; the camera fits the idle pose only.

## Round 2: variants, variation ranges and skins (September 27, 2026)

Two kinds of variant:

1. **Look variants** are creature definitions with a `baseId`: a different level, region, scale or
   look (`presentation.skinId`). They are separate encounters and separate records.
2. **Individual variation** is a range on one definition (`presentation.variation`): size, hue,
   saturation and brightness spreads and a weighted pool of skins. Every individual rolls once from
   its entity id with `game/src/content/creatureVariation.ts` `rollCreatureLook`. The world layer
   writes the roll into `entity.view` (`scale`, `skinId`, `colour`) and the renderer draws it.
   Devdocs previews a crowd with the same function.

A **skin** (`creatureSkins` collection, `game/content/data/creatureSkins.json`) is a set of albedo
maps for one model, keyed by material name, stored under `game/public/assets/skins/`. Kinds:
`imagegen` (image-generated texture maps: the finished-reskin standard), `recolor` (a hue,
saturation and value shift of another map that keeps its detail; fine for variation pools),
`source` (alternative maps from the model's pack).

In the browser: recolor bakes a map in a canvas and saves it; "Generate" sends the current maps and
a prompt to the devdocs server, which runs the image model (Codex CLI `codex exec -i <ref>` by
default, `DEVDOCS_IMAGEGEN_COMMAND` to override) as a background job and saves the result as an
`imagegen` skin for review.

### Contracts (root-owned)

- Game: `schema/creatureSkins.ts`, `SpeciesFields.skinId` / `variation` (`schema/creatures.ts`),
  ref kind `creatureSkin`, `content/creatureVariation.ts`, `contracts.ts` `view.skinId` / `view.colour`.
- Devdocs: `viewer/types.ts` `ActorDraft` (`draft` on the actor source), `viewer/albedo.ts`
  `albedoMaps`, `shared/skinContracts.ts` (skins and imagegen routes).

### Ownership

| Owner | Files |
| --- | --- |
| Root | the contracts above, this doc |
| Game runtime | world-layer creature entity construction, `game/src/render/entityViews.ts`, new `game/src/render/creatureSkins.ts`, related `tests/` |
| Actor stage | `devdocs/src/viewer/**` except `types.ts` |
| Skins server | `devdocs/server/handlers/skins.ts`, `devdocs/server/handlers/imagegen.ts`, `devdocs/server/plugin.ts`, `tests/devdocs-skins-*.test.ts` |
| Creatures view | `devdocs/src/workspaces/art/creatures/**` |

### Built (September 27, 2026)

- Body focus page inspector: Review / Variant / Variation / Skins. "+ Add variant" creates a
  definition with `baseId` (level, region, availability, scale, look); the Variant panel edits it
  through the record draft. Variation edits size/hue/saturation/brightness ranges and a weighted
  skin pool; the stage's Crowd (3/6/12) and Reroll preview the herd from unsaved values.
- Skins: tiles with verdicts (`creatureSkins` meta), Wear / + Pool, in-canvas Recolor (with an
  optional "near hue" mask, recorded in `recolor.near`), and Generate: a background job per material
  (`codex exec` at medium reasoning effort; `DEVDOCS_IMAGEGEN_EFFORT` overrides), Retry reuses
  painted maps, jobs survive Vite config restarts. Scratch lives in `art/skins/jobs/` (ignored).
- After any save the editor adopts the recompiled catalog (`GET /__devdocs/catalog`,
  `model/liveCatalog.ts`), so the stage draws a new variant or skin without a reload.
- Game: `regionBuilder` and lab fixtures roll each individual; `WorldCreature` carries `skinId` and
  `variation`, so a look edit respawns the group; the renderer swaps albedo per (material, skin) and
  shifts colour per instance/object without per-individual pipelines. `creatureSkins` publishes on
  restart: a skin is files too, which must reach the asset host and the page's build.

Proven end to end on the stag: a real generated skin (167 s, UV layout intact), a level-22 variant
wearing it, and a crowd of six rolled from a range.

### Round 3: skin files and hand uploads (September 27, 2026)

Any skin tile, including the model's own maps, opens its raw maps in a drawer: path, pixel size,
file size, hash, provenance, Fit/100%/200% zoom, compare with the model map, a UV layout overlay
(`viewer/albedo.ts` `uvLayout`) and downloads of the map and the UV layout. "Upload skin" takes a
PNG, JPEG or WebP per material (warns on a size mismatch, fills empty materials from the model's
map) and saves an `upload` skin; "Replace this map…" saves one material into an existing skin with
`merge`, and a generated or recolored skin records it in `uploaded`. Wear applies to the definition
selected in the Variants strip, base or variant.

### Thumbnails (September 28, 2026)

Thumbnails of the base game's creatures, and of the body models they wear, ship with the build in
`game/public/assets/thumbnails/` (`index.json` lists the keys), baked by
`npx tsx tools/bake-art-thumbnails.ts --base <repo devdocs>`.
The editor uses a shipped thumbnail first, then its cache (the checkout's, or a live server's file
store), and renders only what neither has: a look a server changed. Re-run the bake after creature
looks change so the base game's tiles stay free to show. Renders take turns on one stage and wait for
idle time, and each frame is drawn to a render target and read back asynchronously: reading a WebGPU
canvas waits for the GPU to drain, which froze the tab while a page of tiles rendered.
