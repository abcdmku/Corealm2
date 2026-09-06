# Earth Elemental source adapter

`earth.mjs` exports synchronous `buildEarthElemental(id = 'stone_golem')`, returning `{object, clips, meta}`. It builds one original body only. It does not edit the shared catalog or wire production assets.

Source: [Earth Elemental / Golem](https://opengameart.org/content/earth-elemental-golem), piacenti, CC BY 3.0. The supplied archive contains two FBX 6.1 ASCII bodies, texture maps and Unity animation metadata. This adapter uses the first body unchanged. Its actual topology has 3,892 triangles, 1,948 source control vertices and 63 native skin clusters. The author page describes approximately 3,872–3,882 triangles; the local file count is authoritative here.

The existing Three FBX loader rejects ASCII versions below 7.0. Extraction therefore uses isolated ufbx 0.0.5, recorded in `runtime.json`. No Blender or GPU is needed. The Python wrapper has an object-lifetime issue when temporary node wrappers are released; `extract_source.py` retains all native references throughout extraction.

Original source UVs, geometry, normals and joint transforms are retained. Base-color and normal image rows are flipped once for glTF's texture-row convention. Material defaults convert the legacy source to a rough, nonmetallic rock surface; the source did not provide a PBR roughness map. Native diffuse and normal image detail stays at 4096 square. These maps make the candidate large; reducing resolution should be a separate reviewed choice.

All ten authored source clip ranges are retained in `derived/source.json`. The standard eight are Idle, Walk, Run, Attack, Hit, HitLeft, HitRight and Death. Run derives from walking at faster timing. Directional hits alias the native take-hit clip because the source has no directional hit takes. The other clips retain native timing. Exact Unity frame ranges and take names are recorded in returned metadata.

The renderer supports four skin influences. The source has up to eight, affecting 413 control vertices. A naive top-four truncation caused 4.47 mm RMS / 55.6 mm maximum position error. `optimize_weights.py` selects four native influences and fits nonnegative weights over 85 poses. The final independent 33-point-per-clip check measures 0.94 mm RMS / 22.35 mm maximum error across 3,082,464 vertex samples at 2.55 m creature height. This is an approximation and remains a motion-review limitation. No new bones or geometry were introduced.

Floor correction samples whole deformed geometry at 60 Hz and each clip key, preserving source aerial motion while preventing penetration. The independent check found all eight clips above the floor, with a minimum clearance of 2.46 mm. The source death retains an aerial collapse phase. Attack contact is provisional and needs browser review.

Rebuild order from repo root:

1. Restore the recorded ufbx wheel under `test-results/earth-elemental-source/python-runtime` if the disposable runtime was cleared.
2. `python tools/rpg-bestiary/earth-elemental-source/extract_source.py`
3. `node tools/rpg-bestiary/earth-elemental-source/sample_skin.mjs`
4. `python tools/rpg-bestiary/earth-elemental-source/optimize_weights.py`
5. `node tools/rpg-bestiary/earth-elemental-source/check.mjs`

The extractor also uses NumPy/SciPy for weight fitting. These were already installed. CPU front and side previews are under `test-results/earth-elemental-source/`; they use triangle shading and sampled source color only. They confirm coherent anatomy, not browser PBR appearance. No GPU acceptance is claimed. The root must inspect textured source appearance, native motion, attack contact and texture orientation in the production lab before promotion.

Required attribution is included in `meta.provenance.attribution`, together with exact SHA-256 digests of the original FBX, Unity metadata and both source maps.
