# Staged six-leg weaver family

This is a review package for three currently rejected production IDs. The source is the approved Tripo Vaultweaver, a six-legged armored arthropod with two short front palps. It is **not a spider**. The root must rename the species and update descriptions if any candidate is accepted. The source reference also has a face-like mouth, which needs direct lab screenshot review.

| Production asset ID | Proposed display identity | Texture | Suggested height |
| --- | --- | --- | --- |
| `creature_hollowroot_spider` | Rootweaver | Imagegen edited layered bark, lichen, and worn chitin | 0.90 m |
| `creature_webweaver_spider` | Briar Weaver | Imagegen edited amber bands, ivory chevrons, fine hairs | 0.43 m |
| `creature_blind_cave_weaver` | Blind Cave Weaver | Original layered Tripo ivory mineral atlas | 0.70 m |

Regenerate from the repository root with `node assets/art/tripo/imports/creatures/audit-spider-family/build-family.mjs`. The script pins the previously staged 29-joint Vaultweaver candidate SHA, preserves its source mesh, six articulated leg paths, original normal and roughness maps, and six animation clips. The two new generated atlases were edited from the source UV atlas and saved here. Their generated 1254-pixel images are resized to 2048-pixel runtime maps. Root must inspect their seams and mapped appearance on the actual model; image generation cannot guarantee exact UV island alignment. No flat tint is used.

The builder samples the weighted mesh at 17 points per clip and corrects the BodyCore height so sampled feet stay about 2 mm above the floor. The largest correction is 4.96 cm for Walk and 8.60 cm for Run. Each per-ID catalog records floor measurements, art provenance and scale; `lab-catalog.json` combines the three review entries. All acceptance fields remain false. The present production assets have HitLeft and HitRight; these candidates have the six core clips, so root integration must check the runtime fallback or add aliases. No production files were edited.

The staged metadata records actual Walk 1.08 s, Run 0.72 s, and Attack 0.88 s clips. The attack's authored forward strike reaches contact at 0.42 s, normalized 0.4773. Implied walk and run ground speeds remain uncalibrated; old production speed values must not be inherited.
