# Paragon adaptation

Run `npx tsx tools/fab-armor/convert-paragon.ts melee-t50` after the corresponding Unreal GLB export exists. Other keys are melee-t70, melee-t90, mage-t50, mage-t70, and mage-t90. Default source mapping is Novaborn for T50 melee, Tough for T70 melee, WhiteTiger for T90 melee, and Rosewood for T50 mage. The original export filenames predate visual matching, so `melee-t50.glb` is Tough and `melee-t70.glb` is the unselected base skin. A third command argument overrides the source and writes into a separate diagnostic subfolder. Outputs remain private staging candidates until the root accepts their production feature-lab state and screenshots.

The converter welds coincident source positions only to identify connected components. Every component is retained intact in one equipment slot or removed whole. It does not cut triangles at arbitrary body heights. Bone influence identifies weapon components even when their material is shared with the loincloth. Source face, eye, and mouth materials are removed. Kwang T50/T70 headgear is a band with knot rings, so its compact native crown/bun hair components must remain to fill the crown and connect the rings. Whole hair components below the source Head origin are excluded. Other source hair is removed.

Each vertex transfers through its weighted source bone segment anchors to the host rest pose. Limb direction determines the rotation independently of bone axis conventions. Unsupported cloth and accessory joints collapse to the nearest supported ancestor. The output owns a full host skeleton; it can bind through the existing equipment path. Native UV0, base color, PBR maps, and smooth normals are retained. Maps are embedded WebP at quality 85 and limited to 1024 pixels.

All Kwang materials split by the original metalness sampled across each connected component. Former metal pieces get the leather role, other nonskin pieces get cloth. UV1 carries meter-space detail coordinates at three repeats per meter; UV0 stays native. If a source map uses UV1, its coordinates and texture channel move together to UV2 before UV1 is assigned to generated detail. Higher-tier material colors and metallic properties stay native. The runtime owns the generated detail textures and coloration.

The static TigerHelm uses the exact demo-map actor transform from attachment-inspection.json. It was a separate static actor, not socket-attached. UE relative location in centimeters is (0, -1.365936, 185.326797), with scale (1.060008, 1.139937, 1.100383). The installed Unreal exporter source establishes X,Z,Y coordinate conversion. Numeric finite-position and normalized-weight checks cannot establish attachment or animation quality.

Inspect sources with `paragon-inspect.ts` and `paragon-components.ts`. Run `paragon-validate.ts` for candidate finite-position and skin-weight checks. These checks do not replace root-owned browser gameplay proof.



