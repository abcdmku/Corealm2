# T90 Aurora armor

Aurora is the five-piece T90 Frostweave set: hood, robe, leggings, wraps and boots. Pearl ivory cloth carries sparse gold celestial embroidery. Overlapping opal scales change tint with the light. The robe has three swept shoulder plates per side, an open collar, and shorter overlapping hip plates above its long panels. The scale and fabric tips sweep outward, with most of the extra curve near each point.

The shoulder plates curve over the native shoulder crown and continue toward its front and rear. Each has a finished underside, gold framing and inset scales. Pointed ivory layers overlap below them beside the upper arm. These shapes, the scale edges, gold settings and ornaments are mesh geometry, shaped from [the supplied Aurora reference](references/aurora-approved.png). Fabric depth comes from aligned color, normal and roughness maps. The cloth stays rough and nonmetallic between the embroidered gold threads.

Open [the interactive viewer](http://127.0.0.1:4186/?set=frostweave) while the local server is running. Rotate, zoom, choose individual pieces, or compare the earlier tiers. To restart it, run `art/tier50-70/Open armor viewer.cmd` from the project. Select **T90 Aurora**.

- [Editable Blender assembly](aurora-set.blend), with packed textures and one native 65-bone skeleton.
- [Full set preview](aurora-studio.png).
- [Individual GLBs](../item-models/candidates/armor-frostweave-aurora/models/items/).
- [Delivery archive](t90-aurora-armor.zip).
- [Acceptance record](../../runs/aurora/acceptance.json), including the exact asset hashes and browser evidence.

The authored fit uses the native male skeleton. Other body types retain the fitted fallback. The new Frostweave hood completes the set; its bonuses use the existing five-piece thresholds at two, four and five pieces. This work does not add a new loot source or crafting recipe.

## Texture source

The built-in ImageGen tool generated [this ivory embroidery source](textures/imagegen-r1/aurora-embroidered-source.png) using [this exact prompt](textures/imagegen-r1/aurora-embroidered-prompt.txt). The source is 1254 pixels square. The bake creates seamless 2048-pixel color, normal and roughness/metallic maps, recorded in [texture provenance](textures/provenance.json). The height and material masks are artistic estimates derived from the generated image, not a measured fabric scan.

The approved T70 garment pattern supplies the underlying fit. Aurora has its own author, materials and geometry additions. T50 blue/silver and T70 red/gold production assets remain unchanged, checked against [the starting hashes](baseline.json).

## Rebuild and review

From the repository root:

```powershell
node --import tsx tools/item-models/aurora/build.ts
node --import tsx art/aurora/verify_assets.mjs aurora-r16
node --import tsx tools/item-models/aurora/build.ts --verify
```

Rebuilding creates staged candidates. It does not promote them into the game. The production lab must pass for those exact GLBs, followed by root visual acceptance and a final-world check after promotion. Review scripts and reports are included in the archive.

`package_blender.py` imports the frozen candidates and preserves geometry, UVs, weights and texture pixels. `render_delivery.py` makes the studio, piece and inventory renders. `build_icons.mjs` derives inventory icons from those actual 3D renders.

The game uses glTF physical iridescence. Blender's EEVEE preview uses an editable thin-film approximation, so the two renderers do not produce identical highlights. The saved Blender rig stays in its imported rest pose. Studio poses, lighting and cameras are temporary.

Acceptance requires front, side and rear worn views, nine walking samples and casts from three camera bearings with real target damage. Six exported-geometry probes check coverage above the native shoulder crown. Reference comparison checks the swept points, visible gold framing and layered profile separately from those fit checks. The robe is skinned cloth rather than a cloth simulation, so the captured checks do not guarantee every possible animation pose. The acceptance record states whether the current revision has passed.

The `.blend` assembly and ZIP are generated local delivery files and are excluded from Git. The versioned GLBs, textures, authoring scripts, current renders and final evidence are sufficient to rebuild them. Earlier preview assemblies and disposable test rounds were removed during integration cleanup.
