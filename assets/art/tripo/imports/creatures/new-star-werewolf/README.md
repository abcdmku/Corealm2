# Gloamfang Reaver candidate

This is an isolated candidate derived from the starred Tripo Werewolf Warrior model. It is suggested for Wilderness T50+ placement because its silhouette is a humanoid hunter. Root image review, normal-camera lab presentation, and placement remain pending.

Run `node assets/art/tripo/imports/creatures/new-star-werewolf/build-candidate.mjs` from the repository root to verify the source SHA-256 and reproduce the rigged GLB, catalogs, texture metrics, and sampled deformation checks.

The source export's 62-joint names and parent hierarchy are retained. Tripo left all joints at identity transforms; 8,037 of 8,047 vertices were pinned to Hips and every vertex had only one influence. This builder reconstructs rest anchors, inverse binds and spatial skin weights while leaving positions, indices, normals and UVs byte-for-byte numerically unchanged. It retains the authored base-color, packed metallic-roughness and normal maps at 2K runtime resolution.

The candidate has Idle, Walk, Run, Attack, Hit and Death clips. Builder checks cover normalized distributed weights, geometry/UV preservation, 2K PBR roles, non-zero sampled motion, bind-pose grounding, and floor penetration at motion samples. Animation quality and final material response still need root review in the persistent normal-camera feature lab.
