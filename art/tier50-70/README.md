# T50 Dragonhide and T70 Starhide, R15

Two editable five-piece armor sets: hood, sleeveless robe, leggings, full-finger wraps, and boots. **R15 is verified and promoted to the normal game.** [acceptance.json](../../runs/tier50-70/acceptance.json) records the exact delivered assets and evidence.

R15 preserves the complete design swap introduced in R13, with equipment IDs and progression unchanged:

| Equipment tier and IDs | Complete design | Legacy texture/source name |
| --- | --- | --- |
| T50 Dragonhide, `dragonhide_*` | Midnight navy cloth, blue-violet scales, silver borders; the former Starhide hood, shoulders and split-front robe | `starhide` |
| T70 Starhide, `starhide_*` | Wine-maroon cloth, smoky blue-violet scales, antique-gold borders; the former Dragonhide hood, shoulders and central tabard | `dragonhide` |

Export names identify the equipment IDs: `dragonhide-set.blend` is now the blue/silver T50 set, and `starhide-set.blend` is now the red/gold T70 set. Baked maps retain their legacy design directories, so `textures/starhide/` supplies T50 and `textures/dragonhide/` supplies T70. Imagegen filenames follow those same legacy design names. Both cloth variants use subdued warm-gold celestial stitches; T50's silver refers to its metal borders.

R15 removes T50's two redundant crossed inner chest strips and their small silver edging. They exposed dark lining and intersected above the fitted navy underlay. The original long silver lapels remain. Closer sampling lets the inner silver V follow the curved yoke without cutting through it. T70's two rear panels beside the central maroon tail now use dark, raised iridescent scales, with the same gold perimeter and pointed flare. The new scale panels have local clearance over the concealed center-panel border, and their lining sits beneath the scale faces around the curved tips.

The previous correction for the player's chest remains in both robes. A fitted fabric underlay sits behind the decorative V, and body coverage includes the covered pectorals influenced by the clavicle bones. The neck and upper arms remain visible. Regression checks use the actual native male mesh and verify restoration when armor is removed.

The latest supplied references are the [T50 chest overlap](references/t50-chest-overlap-r15.png) and [T70 circled rear panels](references/t70-rear-scale-request-r15.png). Inspect the corrected [T50 chest](../../runs/tier50-70/evidence/r15-t50-chest-close.png) and [T70 rear scales](../../runs/tier50-70/evidence/r15-t70-rear-scales.png). [details-r15.json](../../runs/tier50-70/evidence/details-r15.json) records their camera states and source hashes.

The R14 knee, hip and binding corrections remain. Front robe panels follow their own thigh during knee lift, hidden hip scutes have been removed beneath cloth overlays, and scale fields leave room beside metal bindings. Free tasset tips and their ornaments retain their overlap clearance. R15 compares against the delivered R14 assets. All eight non-robe pieces, all materials and all texture inputs remain exact. Verified robe widths, including borders, remain about 0.719 m for blue T50 and 0.801 m for red T70, with a fitted cloth waist near 0.317 m. Open faces, front-panel drape and the short outward tip curves are retained.

The retained R13 cloth has dark, calmer fabric with reduced crushed-velvet mottling and noisy nap, and modest celestial stitches over mostly open fabric. The editable built-in imagegen inputs are the [blue T50 source](textures/imagegen-r13/starhide-embroidered-source.png) and [full prompt](textures/imagegen-r13/starhide-embroidered-prompt.txt), and the [red T70 source](textures/imagegen-r13/dragonhide-embroidered-source.png) and [full prompt](textures/imagegen-r13/dragonhide-embroidered-prompt.txt). The supplied [fabric reference](references/embroidered-fabric-r12.png) and preserved R12 edit inputs remain in the delivery through the source dependencies.

[materials-imagegen.ts](../../tools/item-models/tier50-70/materials-imagegen.ts) bakes aligned cloth color, tangent normals and packed roughness/metallic maps from those RGB sources. The cloth stays rough and nonmetallic, with metallic response confined to the embroidery. Inferred textile relief is an artistic approximation and does not displace geometry. Upright metric UVs keep the pattern aligned across the fitted cloth and hanging panels. Each legacy texture directory's `provenance.json` records the source, prompt, edit-target and baked-map hashes.

The normal game selects the ten approved current GLBs for the native `base_male` body and preserves their authored materials. Both sets passed fresh lab and ordinary-game checks after the chest correction. Female and unsupported bodies retain their fitted legacy appearances. The selection rule is in [characterRig.ts](../../game/src/render/characterRig.ts), with production and fallback checks in [starhide-appearance.test.ts](../../tests/starhide-appearance.test.ts). The inventory aliases in [itemIcons.ts](../../game/src/ui/itemIcons.ts) keep the ten item icons aligned with blue T50 and red T70. Runtime reports and screenshots are retained under [runs/tier50-70](../../runs/tier50-70/).

The actual exported candidates pass the [contact audit](../../runs/tier50-70/evidence/contacts-r15.json): across 20 production jog phases, summed knee/front-cloth crossing triangle pairs fell from the R13 baseline's 600 to 0 for blue T50 and 255 to 0 for red T70. [verify_contacts_r14.ts](verify_contacts_r14.ts) compares knee-scute and outer front-cloth triangles, with a separate projected-clearance diagnostic. Fresh visual review accepted the sampled chest, hip and knee corrections. Validation includes 93 focused tests across five files, typecheck, production build, 30 individual-piece views, 18 walking-phase views, two casting fixtures and both sets in the normal game. Gameplay screenshots use normal player camera controls.

The cloth uses authored skeletal weights, with no cloth simulation. These sampled jog contacts do not cover every pose, boot contact, or armor/player intersection. Female fallback remains necessary because these authored garments use the native male rig.

Open `dragonhide-set.blend` or `starhide-set.blend` to edit meshes, UVs, weights, material nodes and decoded packed textures. Each scene has one shared native male 65-bone skeleton and requires no external textures. The ten standalone GLBs are in `../item-models/candidates/armor-dragonhide-reference/models/items/` and `../item-models/candidates/armor-starhide-reference/models/items/`. They use meters, Y-up and +Z forward; animation clips remain in the game's library.

The GLBs use `KHR_materials_iridescence`. The Blender 4.5.11 LTS scenes retain an editable EEVEE approximation and the source film parameters; the shading is not identical to glTF. The two `*-studio.png` images and eleven previews in `renders/` show the delivered meshes, including a [rear view of T70's new scale panels](renders/starhide_robe-back.png). Presentation lighting and arm posing are temporary.

For the interactive viewer, double-click `Open armor viewer.cmd` or open `http://127.0.0.1:4186/` while its server is running. The set selector follows equipment IDs and the tier mapping above. Drag to rotate, scroll to zoom, and right-drag to pan. Reload after regenerating assets. The viewer requires this repository's Node.js and Three.js installation.

To regenerate inside this repository:

```powershell
node --import tsx tools/item-models/tier50-70/materials-generate.ts
npx tsx tools/item-models/tier50-70/build.ts
npx tsx tools/item-models/tier50-70/build.ts --verify
node art/tier50-70/verify_revision_r15.mjs
node --import tsx art/tier50-70/verify_contacts_r14.ts
```

`node art/tier50-70/finalize_revision_r15.mjs` verifies the matching contact, browser, ordinary-game, Blender and render evidence and records R15 acceptance. `art/tier50-70/package_delivery.ps1 -Round r15` creates the ZIP; R15 is the packaging default. The Blender helper scripts accept `--help` after Blender's `--` separator.

The ZIP retains repository-relative paths for the GLBs, editable scenes, renders, references, PBR maps, imagegen sources and full prompts, authoring dependencies, production selection source and tests, asset manifest, and all evidence collected under `runs/tier50-70`. Source regeneration requires the repository and its dependencies. The Blender scenes and standalone GLBs are self-contained assets.

The current `.blend` assemblies and ZIP remain local generated deliveries and are excluded from Git. Versioned source files, GLBs, textures, current renders and final evidence remain in the repository. Superseded R1–R3 previews and temporary test rounds have been removed.
