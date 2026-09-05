# Corealm presentation overhaul

## Authority and scope

This run implements the owner's September 4, 2026 direction to refine the existing game. Its visual scope follows the approved `runs/corealm/PRD.md` requirement for coherent stylized low-poly art, restrained material response and clear silhouettes. The existing specification remains authoritative for progression, content, saves and gameplay. No new genre, photorealistic art direction or expansion is assumed.

The approval basis is the existing approved PRD plus the current explicit implementation request. This document makes that presentation work reviewable; it does not claim approval for a larger redesign or certify a AAA release.

## Problems established by the audit

- Decorative foliage, gatherable trees and grass use separate colour and surface treatments. The spawn view visibly contains bright, comb-shaped grass cards beside much darker broad plants.
- Photographic animals bypass the material treatment applied to other stylized actors. Preserve their identifying markings while bringing their surface response into the same game.
- Inventory icons use separate material and illumination decisions from equipped objects.
- The dock mixes Unicode glyphs, hides labels and uses 8px key hints. Common panels prioritize density over readability.
- The existing feature lab lacks a convenient side-by-side foliage and resource fixture.

## Art and interaction direction

Keep clean fantasy silhouettes, worn natural surfaces, subdued vegetation and warm brass UI accents. Ground detail should support actors and routes. Organic surfaces remain matte; metal may carry a restrained highlight. Species markings, tier colours, ore veins and elemental effects must remain readable. Roots and trunks stay fixed while leaves move gently.

Use one cached material treatment for related imported surfaces, retaining source textures, alpha cutouts, shader hooks and emissive details. Use the production renderer and asset paths in the lab. Do not add expensive whole-screen effects as a substitute for coherent assets.

Replace ambiguous dock symbols with one authored icon family. Show readable labels and keyboard hints, strengthen focus and active states, and refine shared panel typography and spacing without blocking the world or breaking panel shortcuts.

## Implementation rounds

1. Establish reproducible baseline captures and boot both the game and lab in Chromium. Keep contracts frozen except for root-owned additive presentation-fixture controls.
2. Add a deterministic foliage/resource comparison fixture in the production lab. Refine the grass silhouette, common organic material response and UI. Workers own distinct files.
3. Root accepts the changes from browser input, before/after semantic state and inspected screenshots. Integrate accepted treatment into decorative scatter, resource and creature paths. Check item identity against equipment before changing icon assets.
4. Check the authored world and run a fresh read-only critique. Fix observed regressions before handoff.

## Acceptance

- Typecheck, appropriate focused tests, production build and root-owned feature-lab gates pass.
- Real Chromium input proves movement, bank transfer, equipment selection, melee and spell effects through semantic state changes.
- Lab foliage/resources use production paths and publish enough state to identify fixtures, assets and depletion.
- Compare near and gameplay-distance foliage and creature captures. Confirm readable species markings, resource states, rooted wind and coherent colour.
- Inspect UI at 1280 by 720 and a larger desktop viewport, including pack, equipment, bank and lab controls. No clipped labels, hidden actions or broken focus.
- Inspect representative final-world views after lab acceptance. Report runtime errors, failed assets and performance honestly. Software-rendered FPS is not a hardware performance certification.
- Preserve current semantic regions, authored placements, saves and progression. Any actual world-authoring exception must be recorded separately and follow `docs/world-authoring.md`.

## Release status

This is an implementation and acceptance scope for the presentation overhaul. Shipping approval still needs a defined hardware/browser support matrix, measured GPU performance, complete content playthroughs and resolved asset provenance. Do not describe an unverified pass as a fully production-ready AAA game.

Routine captures and reports remain under ignored `test-results/`. Keep only the brief, specification and final findings as durable run records.
