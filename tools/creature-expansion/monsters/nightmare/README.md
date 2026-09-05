# Nightmare import

`../nightmare.mjs` exports `buildNightmare()` for the root creature compiler. It returns the Three object, eight clips, and source and movement metadata. The browser needs `three` and `three/addons/` import-map entries and repository-root file serving.

Stage the licensed local source and pack its Unity smoothness channel for glTF:

```powershell
python tools/creature-expansion/monsters/nightmare/stage.py
node tools/creature-expansion/monsters/nightmare/stage-textures.mjs
node tools/creature-expansion/monsters/nightmare/audit.mjs
```

Staged files and the source audit remain under `test-results/creature-expansion/sources/monsters/nightmare/`. The audit replaces texture loads with empty Three textures so it can inspect animation binding in Node. It does not verify rendered materials or gameplay. The root compiler and production lab own GLB and browser acceptance.

The source package is Dungeon Mason's `Dragon for Boss Monster PBR.unitypackage`, whose asset folder is `FourEvilDragonsPBR`. The mesh is `DragonTheNightmareMesh.fbx`, with the authored Albino PBR material. Albedo and normal maps remain at their native 2048 px size. The packed texture uses source AO in red, one minus Unity smoothness alpha in green, and metallic red in blue.

The parsed rig is already in metres and faces +Z. A 0.45 outer scale produces rest bounds of approximately 3.058 × 1.973 × 4.941 m. No source joint scale is replaced. The root X/Z position is held at its rest value. Source vertical motion receives an upward correction only where the actual posed mesh would penetrate the ground. Source rotation and relative articulation remain.

All source takes are `Take 001`, sampled at 30 fps. Cropping includes both endpoints.

| Clip | Source FBX | Frames | Seconds |
| --- | --- | --- | --- |
| Idle | idle01 | 0–40 | 1.3333 |
| Walk | walk | 0–40 | 1.3333 |
| Run | run | 0–30 | 1 |
| Attack | Basic Attack | 0–36 | 1.2 |
| Hit | getHit | 0–42 | 1.4 |
| Death | die | 0–57 | 1.9 |

`HitLeft` and `HitRight` add signed chest and neck recoil to `getHit`. Each source-frame sample compensates the upper-arm transforms to keep both forelimbs on their authored world paths. World up is transformed into each current local pose before applying the quaternion overlay. A fixed local Y axis would tilt the tongue downward when the source body rolls onto its side. The 60 Hz Node comparison measured less than 0.94 mm of hand or foot deviation and about 0.227–0.230 m of head displacement relative to Hit.

The source repeats thirteen forelimb names on both sides. The helper instruments the installed FBXLoader to carry FBX Model IDs on tracks, matches source models by full ancestry, and uniquely renames colliding destination nodes. The loader hook fails explicitly if the installed implementation changes.

The source has up to about 17 cm of mesh penetration in its strongest hit recoil. The helper samples actual skinned minima at 120 Hz and bakes upward-only root Y corrections with 2 mm clearance. The audit samples the resulting AnimationMixer poses at 240 Hz, including times between baked keys. All eight clips stay above ground; the smallest measured clearance is 0.406 mm in Attack. Corrected clip speeds are 0.7413 m/s for Walk and 2.5441 m/s for Run.

Initial attack contact is phase 0.72, within the source strike window 0.66–0.82. Motion, material response and contact timing still require root lab acceptance.
