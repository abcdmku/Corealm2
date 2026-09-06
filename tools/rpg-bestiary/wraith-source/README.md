# Wraith source candidate

`buildWraith(id)` in `wraith.mjs` returns `{object, clips, meta}` synchronously after module import for `wraith`, `banshee` and `revenant`. Nothing is promoted.

The candidates use the original Quaternius Wizard body and arms from Modular Character Outfits Fantasy Source, the existing Ranger hood, the existing Universal Base male rig, and original animation library clips. The face and body mesh are hidden except for the hands. The first production screenshot rejected the divided trouser silhouette. Revision 2 removes trousers and extends the continuous original tunic into a flared, ragged robe. Its lower surface follows pelvis/spine weights to prevent splitting with leg movement. No generated ribbon body or replacement humanoid anatomy is used.

Hands use desaturated pale source textures. Cloth keeps the original UVs and normal maps, with desaturated basecolor. Banshee has a longer bell robe and a narrow extended hood with rear veil; its attack uses `Spell_Simple_Shoot`. Revenant adds source knight pauldrons and uses the melee attack. Each has a hollow hood. These revisions still need production screenshots and motion review.

`prepare.py` extracts the local entitled Source archive from the sibling Corealm asset cache. It preserves original glTF and binary files, wraps geometry in GLB, and leaves referenced textures unchanged. The source archive license and SHA-256 are recorded in the returned metadata. The glTF UVs, source normal textures and weighted 65-joint rig are preserved. Exporters must bind `meta.textureBindings` by material name and honor `flipY: false`.

Revision 2 has 12,574 triangles for wraith and banshee; revenant has 15,550. All have eight clips. The hands come from Wizard Arms, avoiding duplicate underlying skin. Whole-mesh floor correction samples every source key and a 60 Hz grid. The creatures float; this is not foot-contact proof. Production browser appearance, blend behavior and combat acceptance belong to the parent review round.
