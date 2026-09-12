# User supplied medieval bridge

The user supplied `medieval_bridge.zip`. No license document was included; this is not a CC0 asset claim. `source-members.json` records every original ZIP member by index, byte count and SHA-256. Duplicate cobblestone filenames are intentionally preserved separately in ignored staging. Their contents are different: member 2 is albedo, 6 is normal, 10 is interpreted roughness, and 13 is interpreted ambient occlusion from direct image inspection.

To rebuild from the original archive, run `python tools/medieval-bridge/extract.py "C:\path\to\medieval_bridge.zip"`, then `node tools/medieval-bridge/build.mjs`. Extraction verifies the pinned archive SHA-256 and names each output `<member-index>-<basename>`, so identically named ZIP members remain distinct. It regenerates the same `source-members.json` records consumed by the builder. The archive path argument is optional on the original workstation, where the script defaults to the supplied attachment path.

`node tools/medieval-bridge/build.mjs` converts the original complete FBX with the installed Three FBXLoader, without requiring a browser or Blender. All 13,244 triangles and all five material groups are retained. Authored transforms are baked into geometry, then a single uniform scale and translation fit the existing bridge composition. No parts are removed. Source textures are embedded as PBR albedo, normal, roughness, metalness and AO. Smoothness maps are inverted to roughness. FBX Phong diffuse factors are preserved. Original UV coordinates are retained. Embedded image rows are vertically flipped and normal green channels inverted according to the installed Three GLTFExporter conventions; the resolved FBX texture transforms were identity.

The candidate overrides asset ID `crownward_timber_bridge` through `catalog.json`; it does not modify production. Existing world scale 3.459170759 and Y offset -0.65 yield a 24m overall span, 6.210m overall width, nearly 24m paved crossing and approximately 1.911m crown rise. The underside extends about 2.375m below bank level. The candidate's local bounds and sampled paving surface profile are in `inspection.json`. Crossing is local X; normalized overall bounds are approximately X±3.46904 and Z±0.89768. Deck approach top is local Y0.187906; crown top Y0.740378.

After real production-lab acceptance, root can run:

`node tools/medieval-bridge/promote.mjs --evidence <report.json>`

The report must pass and contain the asset ID in `acceptedCandidateIds`, plus `acceptedCandidateHashes.crownward_timber_bridge` matching the current catalog SHA. Promotion checks every immutable source member and final GLB hash, then replaces only this asset record and adds its truthful user-supplied pack record. Add `--integrated` only when final-world placement is accepted.

Source parsing and image inspection are complete; browser gameplay and final-world visual acceptance belong to root.
