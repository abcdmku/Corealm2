# Monster source imports

The browser entrypoint is `../monsters.mjs`. `SPECIES` lists the four IDs and `buildSpecies(id)` returns `{ object, clips, meta }` for the shared compiler. These tools stage and import licensed existing library assets. They do not register game content or edit the live asset manifest.

All four outputs have Idle, Walk, Run, Attack, Hit, HitLeft, HitRight and Death. Native geometry, skin weights, UVs and authored texture atlases remain. Dragon Boar and Nightmare also retain tangent normal maps and source metallic, smoothness and occlusion data packed for glTF. Monster04 and Monster09 have no true normal texture in their packages.

| Species | Source | Ground motion treatment |
| --- | --- | --- |
| `cinder_ravager` | PixeliusVita Monster04 | Named embedded FBX takes, horizontal root travel removed, measured upward root corrections for source floor penetration. |
| `basalt_drake` | Dungeon Mason DragonBoar | Six single-motion FBXs with their complete Unity frame windows, source PBR response, measured upward root corrections. |
| `gorge_mantis` | PixeliusVita Monster09 | Original Unity transform curves converted with cubic tangents. Source upper-body motion retained, hovering legs replaced with grounded two-bone IK and folded wings. |
| `quarry_nightmare` | Dungeon Mason DragonTheNightmare | Single-motion source FBXs, duplicate forelimb names resolved by source identity, PBR response, world-axis directional recoil with limb compensation and root grounding. |

All provenance records carry the Standard Unity Asset Store EULA through the aggregate entrypoint. Source extraction stays under the disposable `test-results/creature-expansion/sources/monsters/` tree. Source archives stay in the local licensed Unity Asset Store cache.

To stage Monster04 and Dragon Boar:

```powershell
python tools/creature-expansion/monsters/extract.py
node tools/creature-expansion/monsters/stage-basalt-textures.mjs
```

The Mantis and Nightmare subfolders contain their extraction and audit helpers. For a compiler-only visual probe, start the parent compiler server on port 59099 and run:

```powershell
node tools/creature-expansion/monsters/preview.mjs cinder_ravager
```

The probe writes five screenshots and a `built-probe.json` with clip durations, stance metadata, sampled skinned bounds and attack joint positions. This source preview is separate from the production feature lab. Root owns GLB export, the combined lab gate, gameplay state proof and final acceptance.

The stance metadata uses actual backward foot velocity during ground contact. It is not the whole forward-and-back range divided by clip duration. Explicit `gaitFootBones` identify the source contact joints, and Monster04/Dragon Boar include per-foot measurements because the source feet do not have perfectly identical velocities.
