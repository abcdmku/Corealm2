# Source minotaur candidate

`minotaur.mjs` exports synchronous `buildMinotaur('minotaur')` returning `{object, clips, meta}`. Module initialization extracts existing source textures into `derived/`; it does not download assets or use a browser.

The candidate retains Quaternius base male anatomy and 65-joint animation, peasant waist cloth and the source axe. The head and hooves are cropped from the existing `animal_aurochs` authored mesh with its original UVs and atlas. They attach to the animated head and foot bones. Human face geometry is reshaped into a sealed neck connector inside the bull head; toes are removed and compacted. There are no primitive head, horn or hand replacements.

Eight clips are Idle, Walk, Run, Attack, Hit, HitLeft, HitRight and Death. CPU floor sampling includes every visible mesh, including the head and held weapon. Corrections lift the root only when a rendered part crosses the ground, retaining airborne run phases. The metadata contains before/after measurements, source asset records, exact manifest pack licensing, texture bindings and attack contact timing.

Revision 2 repairs the production screenshot failures. The old horizontal head crop also cut shoulder peaks; these are preserved and the original cranial topology now closes the neck interior. The bull head rear crop is capped. Continuous thigh geometry fills the shorts seam. Hooves are aligned to the exact source ankle bind centers, fixing the prior 15.6 cm forward offset. The axe now uses a lower haft grip and exposes the broad blade face, matching the orc repair.

CPU construction and finite bounds passed. Bind-pose height is approximately 2.61 m. All 33 verification points per clip remain above ground after correction. Exact results are in `repair-checks.json`. This is a candidate, with no visual approval. Parent must review production front, side and gameplay-distance views, source head/body colour continuity, graft seams, hoof gait and held axe contact before accepting or requesting variants.

Ownership is restricted to this directory. No shared builder, production catalog or manifest was modified.
