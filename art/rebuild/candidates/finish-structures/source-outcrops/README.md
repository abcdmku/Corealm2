# Source rock shortcut candidates

These are staged derivatives of the project's existing DEXSOFT Rocks FREE pack mesh. Geometry and material maps remain under that source's Standard Unity Asset Store EULA. The pack metadata records DEXSOFT and Corealm's arrangement work separately. These are not original-only geometry.

`tools/build-shortcut-outcrops.ts` verifies the source GLB SHA-256 before building. It places two differently rotated boulders for Sunder and three descending boulders for Scree, then fits the full arrangement to the existing shortcut bounds and pivot. It preserves source vertex channels, UVs, indices and embedded material maps. The source test checks those bytes and actual transformed bounds.

The CPU clay studies in `test-results/outcrop-source-review` show the arrangement only. They do not accept material appearance, grounding, entrance clearance or gameplay.

Run the six-view production gallery during a scheduled exclusive hardware slot:

```powershell
npx tsx runs/corealm-rebuild/checks/finish-geology-gallery.ts --catalog art/rebuild/candidates/finish-structures/source-outcrops/shortcut-outcrops.json
```

Inspect the full backs, side shoulders, joins and ground contacts. Only after lab acceptance should root run exact candidate world placement, interaction and landing proof, then promote these bytes with their derivative pack metadata. No public files or region entries have been changed by this generator.

The earlier custom geology slabs and their failed gallery/world evidence remain in the parent directory. They are a separate rejected approach.
