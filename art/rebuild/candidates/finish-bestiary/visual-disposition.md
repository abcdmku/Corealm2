# First production visual review

2026-09-05. The root assigned one hardware GPU slot. `tools/rpg-bestiary/review.ts --batch 0` captured 36 images in the production creature gallery, three views of one representative from each of twelve families. The selected UI preset and loaded asset ID matched for every model. The browser closed after that batch. Semantic readiness passed; art did not.

All twelve base families are rejected for production in this revision. The front views show enough problems to reject the shared construction before spending more GPU time on variants.

| Family | Observed problem |
| --- | --- |
| Goblin | Toy proportions, large brows, smiling tube lips, cone limbs and garment slabs. |
| Orc | Block torso, tiny hands, disconnected shoulder shapes and oversized facial features. |
| Skeleton | Flat mask skull, ruler-straight long bones and uniformly spaced ribs. |
| Zombie | Polygon mask face and rigid sheet clothing over the same primitive biped. |
| Wraith | Angular cutout hood and hanging flat ribbons rather than draped fabric. |
| Golem | Floating block head, generic cone limbs and decorative luminous chest strips. |
| Harpy | Paper feathers, straight wings and generic thin biped anatomy. |
| Gargoyle | Toy face, broad block torso and flat wing membranes. |
| Gnoll | Looks like the goblin with a bear muzzle; lacks hyena anatomy and coat. |
| Lizardman | Same humanoid face with stacked belly disks; weak reptile anatomy. |
| Minotaur | Generic torso and cone legs under a simplistic bull mask. |
| Demon | Flat chest, stick limbs, angular toy head and disconnected cuff hands. |

The review also found that bare material names triggered the renderer's existing 45% tier dye. The exporter now applies the documented `animal_` prefix so authored creature colors survive. This fix does not make the geometry acceptable.

Next review is limited to a rebuilt Goblin Scout, an entitled-source Skeleton Soldier, and a rebuilt Gargoyle. Remaining rows stay candidates. No public promotion, final-world placement, natural combat acceptance or visual approval follows from the count, clip audit or successful gallery boot.

Disposable screenshots and report are under `test-results/bestiary-gallery-0`. Their exact filenames are `<id>-front.png`, `<id>-side.png` and `<id>-rear-play.png`. This document records the rejection, not a substitute for the images.
