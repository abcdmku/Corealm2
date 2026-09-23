# Storm Scarab staged candidate

This isolated package targets the production asset ID `creature_boss_tempest_roc`, which the game displays as **Storm Scarab**. Regenerate it from the repository root with:

```powershell
node assets/art/tripo/imports/creatures/audit-storm-scarab/build-candidate.mjs
```

The builder pins the original Flint Mandible Tripo GLB and reference image by SHA-256. Its 8-joint source skin has virtually all weight on bone 0 and no animation. The staged candidate keeps the original 2,649 vertices, 4,178 triangles, positions, normals, UVs, indices, and richly layered stone base color. It builds a 30-joint six-leg rig with normalized four-influence weights, 2K base color, normal and ORM maps, and Idle, Walk, Run, Attack, Hit and Death clips. `catalog.json` records the source and structural checks; `lab-catalog.json` maps the GLB to the production ID.

The boss candidate gives its Attack a carapace roll with a counter-moving abdomen. Its gait and death poses were adjusted for floor contact. The full mesh and rig are uniformly scaled 2x inside the GLB to a 1.413 m shell height, with ground still at zero. The builder verifies serialized skin joint order and samples the actual weighted mesh in all six clips at eight times per clip. Walk and Run move hundreds of vertices on every leg; per-leg mean vertex excursion is 9.5–12.2 cm in Walk and 16.1–19.9 cm in Run. No sampled clip crosses more than 4 cm below the floor. The results are in `catalog.json`.

This is a technical candidate, pending the root's lab and screenshot review. The same source is already staged for Flint Mandible, so using both as separate species risks obvious duplication. The ivory and dark flint texture has no storm-specific feature. The current production boss is about 2.28 m tall with HitLeft and HitRight clips; this candidate is 1.413 m tall with the six required clips. Root integration must resolve clip expectations before any manifest swap. No production files were changed here.

The staged metadata carries Walk 1.12 s, Run 0.72 s, and Attack 0.86 s. Contact is authored at Attack's central mandible strike (normalized 0.5). Implied walk and run ground speeds have not been calibrated against world movement; old production speed values must not be inherited.
