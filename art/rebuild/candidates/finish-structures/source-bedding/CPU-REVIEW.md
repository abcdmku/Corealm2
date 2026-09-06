# Original panel assembly CPU review

The rejected radial-resampling prototype is preserved in v1 with its generator, tests, catalogue, GLBs and previews. Current assets use unchanged Rock Face 01 scan meshes under affine node transforms. They retain the source's indexed fracture geometry, normals, UVs and original embedded material maps. Quiet DEXSOFT rocks provide interior support. This is mixed-license material, not a CC0-only package.

Sunder contains five scan instances and one support rock, totalling 102,430 triangles. Scree contains seven scan instances and three support rocks, totalling 145,898 triangles. Mesh data is shared among instances. Both whole assemblies fit the legacy bounds and pivots. Scree has a measured 2.158 m rear-to-front quarter height difference.

I inspected the six current CPU clay previews. The source fracture planes are preserved, and the rejected ring/disc geometry is gone. However, some original panel rims remain exposed. Sunder's side view has a strong cleft between the upper panels; Scree retains a visible side-support outline. Small parts of the quieter support geometry are visible behind openings. This does not meet a complete freestanding outcrop acceptance bar yet. The main source face now provides a concrete preserved-geometry reference for further arrangement or authored trim work.

The assembly intentionally makes no manifold or watertight claim. AABB overlap and a filled interior do not prove every panel edge is concealed. The CPU renderer uses triangle depth sorting and geometry-only shading; browser material and occlusion review remain unperformed.

Two focused tests pass. They read the exported GLBs and verify source/generator/support hashes, unchanged original scan vertex channels and indices, original map hashes, exact transformed legacy bounds and the descending Scree profile. No browser was started; no public asset or world placement changed.
