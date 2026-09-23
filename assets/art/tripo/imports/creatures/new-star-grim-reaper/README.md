# Redwake Harvester candidate

This package prepares the newly starred Grim Reaper as a high-tier floating Wilderness enemy. Its current candidate display name is **Redwake Harvester** and suggested placement is the T60+ Dark Night Castle approach.

The source export is `assets/art/tripo/exports/68f8ab54-c998-4eb3-b0ed-1f9853f9f6ae.glb`, SHA-256 `b66926a4ba2c2a9bb45d1c9af1d0558e4ed8676fe4d575ac5f291888c11ba248`. The source has 4,595 triangles and three 2K maps: layered base color, packed roughness/metalness, and normal. It also has 59 source joints, but every vertex is weighted entirely to Hips and it contains no clips.

The builder retains source positions, normals, topology, indices, UVs, material factors, and embedded maps byte-for-byte. It replaces the broken skin weights with 32 Mixamo-named Unity Humanoid/cloak joints and authors Idle, Walk, Run, Attack, Hit, and Death clips. Walk and Run animate as hovering glides with cloak and waist-chain movement rather than footfall cycles. Automated CPU skinning samples show at least 0.15 m of clearance in the locomotion clips after presentation scaling.

Run `node assets/art/tripo/imports/creatures/new-star-grim-reaper/build-candidate.mjs` to rebuild the GLB and refresh its provenance, validation, and lab-catalog files. The candidate remains pending root's normal-camera feature-lab review; it is not wired into the game world.
