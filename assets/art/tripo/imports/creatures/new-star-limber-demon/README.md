# Gloamreach Harrower candidate

This is an isolated candidate from the user-starred Tripo P1 export in `assets/art/tripo/exports/acc8f6a7-0d0d-4ae6-8f27-f4e86fb28734.glb`.

Run `node assets/art/tripo/imports/creatures/new-star-limber-demon/build-candidate.mjs` to reproduce the rig, clips, candidate GLB, and lab catalog. The builder verifies the source SHA-256 before processing. It preserves all 7,543 source vertices, normals, UVs, 4,912 triangles, material factors, and three 2048×2048 PBR maps byte-for-byte. No retopology or recoloring is applied.

The export contains a flattened 56-joint skin, but 7,459 vertices bind fully to `Hips`. The builder reconstructs the anatomical landmarks from the source inverse-bind matrices and creates a 22-joint Mixamo-named Unity Humanoid hierarchy with four normalized spatially distributed weights per vertex. The source faces local +X; a presentation yaw turns it to Unity's +Z-forward convention and maps left/right onto the corresponding Unity sides.

The rig has Idle, Walk, Run, Attack, Hit, and Death clips. The build samples each clip in Three.js and adds root-height correction keys to keep the deformed mesh above the floor. Death requires the largest sampled lift, 0.34 m; review its final pose and fall in the production-backed lab before acceptance.

`catalog.json` and `lab-catalog.json` record provenance and the unaccepted review state. This candidate is not yet approved for game content or world placement.
