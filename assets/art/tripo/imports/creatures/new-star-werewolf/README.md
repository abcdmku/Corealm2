# Gloamfang Reaver candidate

This is an isolated candidate derived from the starred Tripo Werewolf Warrior model. It is suggested for Wilderness T50+ placement because its silhouette is a humanoid hunter. Root image review, normal-camera lab presentation, and placement remain pending.

Run `node assets/art/tripo/imports/creatures/new-star-werewolf/build-candidate.mjs` from the repository root to verify the source SHA-256 and reproduce the rigged GLB, catalogs, texture metrics, sampled deformation checks, and ground-contact report.

The source export's 62-joint names and parent hierarchy are retained. Tripo left all joints at identity transforms; 8,037 of 8,047 vertices were pinned to Hips and every vertex had only one influence. This builder reconstructs rest anchors, inverse binds and spatial skin weights while leaving positions, indices, normals and UVs byte-for-byte numerically unchanged. It retains the authored base-color, packed metallic-roughness and normal maps at 2K runtime resolution.

The unscaled mesh stands 0.9551 m, is grounded at y=0, and remains geometrically unchanged. A uniform 1.8847 armature-root scale raises its presentation height to 1.8 m while preserving the ground contact. The source bind pose has the arms extended. Idle, Walk, Run, Attack, Hit and Death pose both arms down and forward with bent elbows so the hunter reads in a compact predatory guard; the attack winds and rakes from that guard.

Clip contact now comes from serialized CPU skinning: Three's GLTFLoader and AnimationMixer drive the written rig, and precise skinned bounds are sampled at 120 Hz to bake translation on a parent above the skeleton. The final serialized clips are checked at 240 Hz for ground penetration and hovering. Contact clearance uses the full deformed mesh; the report also records the production terrain rig's sparse-vertex sampling measurement for comparison. This parent motion preserves the authored joint clips, source topology, UVs and 2K PBR maps. Animation quality, contact in the normal-camera lab and final material response still need root review.
