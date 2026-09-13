# Item icon audit, September 12, 2026

Reviewer: GPT-5.6 Luna, maximum reasoning, read-only review requested by the owner. The review combined catalogue and provenance inspection, exact-file duplicate checks, and representative 256px/48px image inspection. It does not claim individual visual acceptance of all 481 items.

## Jewelry findings

Across the full catalogue, 327 of 481 items have registry-backed image-generation provenance and 154 do not. In addition to the 144 miniboss jewelry items, the missing records cover nine Crownward fish states, the raw, cooked, and burnt versions of crown_trout, crown_tuna, and pearlwater_salmon, plus frostweave_hood. Missing provenance is established for those ten non-jewelry items; this review does not classify all ten as visually defective. All 481 master images exist. Five additional public 48px aurora_frostweave armor files are URL-mapped assets rather than additional catalogue items, so do not delete them as duplicate items.

The current catalogue has 481 items, including 176 jewelry/accessory items. Of those accessories, 32 crafted or wilderness pieces have accepted built-in image-generation registry entries with prompts. The other 144 are miniboss jewelry with no prompt registry provenance and procedural rendering paths.

The miniboss family contains 18 items per tier at T1, T5, T10, T20, T30, T40, T50, and T60: 80 rings and 64 pendants in total. The requested T70 pair does not exist in this family.

Standard Warden artwork is duplicated exactly within each tier. The rings numbered 01, 03, 05, 07, and 09 share one image; the pendants numbered 02, 04, 06, and 08 share another. Those 72 item rows therefore use only 16 distinct images across their within-tier groups. Shared artwork alone is not proof that named boss rewards should lose their identity; consolidate generic item definitions while preserving intentional unique rewards.

Representative miniboss images visibly use smooth torus rings, flat polygon gems, and color-only variants. The reviewed crafted image-generation samples have stronger material detail. The miniboss family needs replacement artwork after the canonical jewelry catalogue is settled.

Existing crafted jewelry also violates the requested single-stat rule. Examples include grithe_pendant with Accuracy and Magic Armour, cinder_charm with Magic Accuracy, Magic Power, Magic Armour, and Vitality, and nightglass_pendant with Accuracy, Magic Accuracy, and Magic Armour.

## Cause and repair

game/src/render/itemIconAppearances.ts supplies primitive jewelry mappings and generic ring/pendant fallbacks. tools/generate-item-icons.ts uses the model screenshot renderer when no generated master exists. It also requires an item appearance mapping even for registered generated artwork.

docs/item-icons.md and AGENTS.md now prohibit this authoring path. The gameplay PRD requires the generator to reject missing prompt-backed artwork before writing outputs and to remove the model-mapping requirement for icon-only items. Those code changes and replacement images are still pending; this audit is not a claim that the assets have been repaired.

The September 10–11 claims about all 300 items having generated icons describe the catalogue at that time. They do not cover the current 481-item catalogue.

## Completed replacement ? September 12

The 176 retired jewelry rows and their old icon derivatives are removed. Fourteen single-stat craftable pieces and 126 boss pieces now use 32 prompted original designs. Each boss motif is shared intentionally across its seven stat tiers. All 140 entries have accepted registry provenance, source hashes, 256px masters, and 48px gameplay derivatives. Luna-max passed the original and derivative visual review; root inspected production lab and final-world inventory/equipment screenshots.

The generator now rejects missing prompted artwork before writing outputs and contains no browser-rendering fallback. The remaining non-jewelry provenance gaps from the audit are nine Crownward fish states and the legacy frostweave hood entry (the runtime uses its Aurora icon).
