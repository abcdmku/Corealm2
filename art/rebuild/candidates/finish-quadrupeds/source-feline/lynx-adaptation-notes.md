# Whole-source Lynx adaptation helper

`lynx_adaptation.py` is an import-only Blender helper. It does not load files, export, render or change production assets. The caller supplies an isolated historical JonasDichelle Cat import and its armature. Keep the source FBX and frozen neutral GLB unchanged. Preserve the CC-BY-3.0 credits recorded in `HISTORICAL-RIG.md` in any derivative.

I inspected the front, side, rear and gameplay views in `test-results/quadruped-free-source-comparison/`. The connected chest, belly, thighs and tapered forelegs provide a better starting body than the generated candidate. The long upright tail and narrow toes are the strongest domestic-cat cues. This helper keeps the complete head and body. It adds no replacement head or disconnected cheek pieces.

## Coordinate and landmark checks

The historical Cat object and armature have equal world matrices. Their local coordinates are X lateral, negative Y forward and Z up. Do not use the imported scene world axes. The source mesh has 22,650 vertices and 22,648 polygons. The floor is approximately local Z -2.88009.

Measured rest landmarks from `historical-rig-audit.json`:

| Landmark | Source armature-local coordinates |
| --- | --- |
| Head base | 0, -3.11680, 3.35229 |
| Tail base | 0, 2.77468, 2.44203 |
| Tail final bone tip | 0, 4.14948, 6.20763 |
| Right/left pinna base | ±0.60455, -3.49267, 3.67045 |
| Front paw bone endpoint | ±0.59209, -1.92063, -2.73196 |
| Hind paw bone endpoint | ±0.70729, 2.66466, -2.60334 |

The helper reads these bone landmarks from the actual armature. Their values are listed here to expose its coordinate assumptions.

## Changes and integration

Import the module, then call `result = adapt_cat(body, armature)`. The default is a static mesh review candidate. It maps the existing tail centerline into a gently descending 1.35-source-unit stub, about 13.5 cm at the earlier 0.1 preview scale. It preserves radial girth, original vertex count, polygons, UVs and the original closed tail tip. No cut or new cap is introduced. Source tail-weight sums blend the root into the rump.

Paws broaden by up to 23 percent across their existing connected surfaces, with up to 10 percent length expansion. Sole heights and limb bone pivots stay unchanged. The connected cheeks widen modestly within a local smooth field. Existing pinnae become smaller, with a narrow upper contour and dark terminal band intended to read as restrained tufts. There is no separate fur-card geometry. Hindquarter lift is deliberately zero because the approved views do not justify changing the native leg chain yet.

The helper replaces the Cat body's assigned material with rough nonmetal grey/buff vertex colour, broken darker dapples, pale underside and black tail tip. Fine colour variation approximates coat variation, not geometric fur. Hardware visual review must judge whether this is enough at the production camera. It does not alter the separate source eye meshes. Their socket position is preserved because the cheek field stays outside the eye centers, but attachment still needs visual checking.

`result['warp'](points, result['tail_weights'])` applies the identical map to an array of original-order armature-local points. Use `result['warp'].point(point, tail_weight)` for an individual point. The parent can warp full evaluated animation targets before fitting. This spatial map is not pose-equivariant. A swinging tail may leave the rest-space field, so those targets require deformation and continuity checks. A posed centerline map or newly authored short-tail motion may be needed.

The helper can move tail and ear rest bones only when both `adapt_rest_rig=True` and `native_motion_rebake_authorized=True` are supplied. This is an explicit promise that the caller will rebake or refit motion. Original native animation matrices do not remain correct after these edits. Limb and core body rest bones are untouched. Corrective skin bones added by the parent need separate rebaking, since the helper cannot infer their fitted semantics. Shape-key coordinates receive the same map, but their accuracy also needs a fresh audit.

## CPU check and limits

Blender 4.5.11 imported the unchanged historical FBX and ran the default helper in an unsaved factory scene. It completed with 22,650 vertices and 22,648 polygons. It touched 4,819 vertices with tail influence above 0.03. Maximum displacement was 4.31851 source units, dominated by tail shortening. Adapted mesh bounds were X -1.42448 to 1.42448, Y -4.87337 to 4.31509, Z -2.88009 to 4.62104. The source floor was preserved. No topology was added or removed.

This check proves callable import and finite resulting bounds. It does not prove skinning accuracy, absence of self-intersections, contact behavior or visual acceptance. No GPU or export was used. The parent must integrate after weight fitting and accept only after native/action audits and hardware front, side, rear, gameplay and moving views.

A second CPU check confirmed that the batch API matches the mesh mutation exactly after conversion through `armature.matrix_world.inverted() @ body.matrix_world`. All coordinates were finite. The 45,296 evaluated loop triangles had no zero-area triangles; minimum triangle area was 0.00000118835 source units squared. Always perform that coordinate conversion, even when printed object matrices appear equal. A first comparison that omitted it failed and was corrected rather than relaxing its tolerance.
