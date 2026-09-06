# Iron material-only repair

Run `node tools/rpg-bestiary/iron-material-source/rewrite.mjs` from the repository root. It reads the fixed retained-unhorned15 iron baseline and writes a one-creature candidate to `art/rebuild/candidates/finish-bestiary/iron-material-round1`.

The script asserts the expected source GLB SHA-256 before writing anything. It remaps the existing authored mineral-grain texture to low-contrast cool steel, with restrained brown oxide confined to darker source marks. A new packed PBR map uses G for roughness and B for metalness. Clean metal is 0.97 metallic with roughness around 0.43; oxidation increases roughness and lowers metalness. The existing normal PNG is copied byte-for-byte and applied at material strength 0.22. The inner-body material reads as darker metal and the recessed eye material remains dark. There is no emissive decoration.

This is a project-authored material interpretation, not a claimed original Quaternius steel texture. Original Quaternius body, armor, skin and animation provenance stays in the candidate catalogue, with an appended material revision record. No new geometry, human skin, horns, body parts, rig edits, animation edits or gait changes are introduced.

The GLB JSON chunk is rewritten while the entire source BIN chunk is copied unchanged. Only the top-level materials, images and textures arrays differ. Accessors, buffer views, buffers, meshes, nodes, skins, scenes and animations are asserted identical, individually hashed and recorded in `material-regression.json`. The source baseline is checked again after writing to verify it was not modified.

Candidate SHA-256: `e853b524b0175ac78675fd7d6b1123fa183390c3914705a117bb218538204910`.

Baseline SHA-256: `f84d7e0a237d1b4b78891f1b1802004b4acc67d64a93fce1b53d477acdf8ee2a`.

Preserved BIN SHA-256: `342d85a2d456c2bc00e4efec167f373f201e25c84ece1980c5fad61533f5c17a`.

The derived albedo was inspected directly. No GPU or browser was used. Production material appearance still needs the root's screenshot review; this candidate is not marked accepted.
