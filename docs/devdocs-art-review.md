# Devdocs art review

September 27, 2026. The Art workspace replaces isolated asset development in the feature lab.
Reviewing a creature body, its variants, an outfit, a worn tier, or any state they play happens
in devdocs. The lab remains for game integration and for interactions between assets.

## Goals

1. Every creature body and every variant that wears it, on one screen, rendered as the game renders it:
   presentation asset, scale, tint and motion states (idle, walk, run, attack, hit left/right, death).
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
