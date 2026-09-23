# Crownward Oathkeeper candidate

This folder holds an isolated candidate for the approved `crown-knight` source. The source image and intact-face audits apply to the approved image; the rebuilt rig, six clips, runtime maps, and candidate appearance still await root feature-lab review. Every candidate acceptance flag is false, and the candidate is not wired into production.

## Build

From the repository root, run:

```powershell
npx tsx assets/art/tripo/imports/creatures/nine-pack-two/crownward-oathkeeper/build-candidate.ts
```

The build reads the exact source GLB and approved image by repository path, verifies their pinned SHA-256 hashes, then uses `tools/tripo-creatures/retarget.ts` with the checked-in `animation_library_1.glb`. It writes the candidate GLB and refreshes `catalog.json` and `lab-catalog.json` in this folder. It does not write to the game manifest or production asset tree.

## Candidate evidence

- Source model `f3b036f0-e5a0-423e-bbce-4cd37cfbd51a`, approved image `59ac6fb8-1bc6-4263-81a4-d21a548dc31a`, batch key `crown-knight`.
- Source image and intact-face reviews are recorded as approved in `catalog.json`. Runtime face and whole-creature appearance remain unreviewed.
- Source geometry is 3,774 vertices and 5,427 triangles. The build verifies exact positions, normals, UVs, and triangle indices after serialization; it performs no retopology.
- The original 54-joint skin has no clips, identity joint transforms, Hips-dominant weights, and inverse-bind values up to `1.8378e37`. Those inverse binds cannot recover a stable anatomical rig, so the builder replaces the broken skin with a 52-joint model-space Mixamo humanoid rig: 22 torso/limb joints and 30 finger joints. Four-influence weights are fitted to the preserved mesh with bone-segment distance fields and body-region gates; the builder verifies serialized per-joint influence coverage and that the bind pose preserves the source geometry bounds.
- The existing humanoid animation library supplies `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Punch_Jab`, `Hit_Chest`, and `Death01`, retargeted to `Idle`, `Walk`, `Run`, `Attack`, `Hit`, and `Death` through `tools/tripo-creatures/retarget.ts`.
- The approved layered base-color atlas, normal map, and packed metallic-roughness map remain the source material. The build downsamples each to 2K, preserves the packed roughness and metallic channels, and renormalizes the resized tangent normals.

See `catalog.json` for source and candidate hashes, texture evidence, rig and motion details, build command, and pending acceptance fields. `lab-catalog.json` is a root-review handoff only; root integration and production asset contracts remain pending.
