# R15 review status

**R15 is verified and promoted to the normal game.** It cleans up T50's crossed chest panels and replaces T70's two rear flanking cloth panels with matching raised scales. R13's design swap and materials and R14's body-coverage and knee-clearance fixes remain. [acceptance.json](acceptance.json) records the exact delivered assets and current evidence.

| Equipment IDs | Retained R13 appearance | Verified robe width |
| --- | --- | --- |
| T50 `dragonhide_*` | Former R12 Starhide: navy cloth, blue-violet scales, silver borders, split-front robe | About 0.719 m |
| T70 `starhide_*` | Former R12 Dragonhide: maroon cloth, smoky blue-violet scales, antique-gold borders, central tabard | About 0.801 m |

The swap covers all five pieces of each design. Item IDs, tiers and progression stay unchanged. Export and candidate paths follow equipment IDs; baked texture directories and imagegen filenames retain legacy design names. Thus `textures/starhide/` and `imagegen-r13/starhide-*` supply blue T50, while `textures/dragonhide/` and `imagegen-r13/dragonhide-*` supply red T70.

R15 compares against the delivered R14 baseline at `test-results/tier50-70/r14-final-baseline`. T50 loses two redundant crossed inner cloth strips and their tiny silver edging. Those strips exposed dark lining and intersected over the existing navy underlay. The underlay and original long silver lapels remain exact. T70's rear panels 3 and 5 now have individual overlapping scutes using the existing six dark iridescent scale materials. The panels retain their authored loft, pointed tips and gold frames, with a small interior clearance over the central panel's hidden border.

The earlier chest coverage, front-panel leg-follow weights, hip-scale trimming and tasset clearances remain. All eight non-robe pieces preserve exact geometry. All ten assets preserve their materials, image bytes, rigs and coverage metadata. T50 removes the redundant chest geometry and resamples the inner silver neckline rim to follow the curved yoke. Its cloth and long lapels retain their original shape. T70 changes are confined to the two rear scale panels, including a broader clearance transition and recessed lining near the curved tips. Whole-robe bounds match R14 exactly. The fitted cloth waist stays near 0.317 m; the table gives the full-hem widths including borders.

Built-in imagegen supplied the retained R13 [blue T50 cloth source](../../art/tier50-70/textures/imagegen-r13/starhide-embroidered-source.png) and [prompt](../../art/tier50-70/textures/imagegen-r13/starhide-embroidered-prompt.txt), and [red T70 cloth source](../../art/tier50-70/textures/imagegen-r13/dragonhide-embroidered-source.png) and [prompt](../../art/tier50-70/textures/imagegen-r13/dragonhide-embroidered-prompt.txt). The cloth remains dark and calm, with reduced crushed-velvet noise and modest celestial embroidery. Both variants retain subdued warm-gold stitches. The supplied fabric reference and R12 edit targets remain as source dependencies.

The baker produces aligned albedo, tangent normals and packed roughness/metallic maps. Base cloth is rough and nonmetallic; embroidery carries the metallic response. Texture relief is inferred from the generated source and does not displace the mesh. Provenance records source, full prompt, edit-target and map hashes. Scale finish, raised lips and iridescence follow the inherited design.

The [contact audit of the actual delivered candidates](evidence/contacts-r15.json) samples 20 phases of the production baked jog. Summed knee/front-cloth crossing triangle pairs dropped from the R13 baseline's 600 to 0 for blue T50 and 255 to 0 for red T70. [verify_contacts_r14.ts](../../art/tier50-70/verify_contacts_r14.ts) audits actual knee-scute/outer-front-cloth triangle intersections and records projected clearance separately. Its hashes match the final robe and leggings exports.

Completed acceptance covers:

- Bounded R14-baseline comparisons, unchanged robe bounds, current source hashes, exact retained materials and image bytes, and preserved cloth provenance through `verify_revision_r15.mjs`.
- Actual R15 knee/front-cloth contact checks and fresh read-only visual review of T50's chest layering and T70's rear scale panels, including their borders.
- 93 focused tests across five files, successful typecheck and production build.
- Production feature-lab checks: 30 individual-piece views, 18 walking-phase views and two casting fixtures, with semantic state and screenshots from ordinary camera controls.
- Normal-game selection and movement with both sets, loading all ten current R15 crafted assets on `base_male`. Production and fallback tests preserve female and unsupported-body appearances.
- Two reopened Blender scenes, thirteen current renders including the new T70 rear panels, and matching export, viewer and runtime hashes. `finalize_revision_r15.mjs` records this evidence; `art/tier50-70/package_delivery.ps1 -Round r15` packages it.

[characterRig.ts](../../game/src/render/characterRig.ts) owns approved native-male selection. [starhide-appearance.test.ts](../../tests/starhide-appearance.test.ts) covers all ten IDs, approval guards, ordinary-game behavior and body fallback. The inventory aliases in [itemIcons.ts](../../game/src/ui/itemIcons.ts) map those ten IDs to icons with the swapped palettes. The package includes the selection and icon source, their tests, `equipmentVisuals.ts`, body-coverage source and tests, the asset manifest, and all reports and screenshots collected under this run directory. A staged candidate view alone does not prove ordinary-game selection.

The contact proof is limited to knee armor against outer front cloth in the sampled jog phases. It does not cover every pose, boot contact, or armor/player intersection. The cloth uses authored skeletal weights, with no cloth simulation. The authored sets fit the native male skeleton; female characters retain legacy fitted assets. Rear construction and fine textile detail remain interpretations of the artwork. Blender's editable EEVEE film approximation retains the glTF parameters but does not reproduce its shading exactly.
