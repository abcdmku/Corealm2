# Quiet source-rock material candidate

This is a material comparison against `../source-outcrops`. Geometry, placement matrices and original source vertex channels are identical. Source attribution and the existing DEXSOFT license remain in the catalogue.

The reviewed source albedo paints pale rims around every UV island and dense high-contrast mottling. The original material also uses normal scale 1, metallic factor 0.08 and roughness 0.76. The game does not substitute Corealm stone maps for its material name. Those source properties explain the visible bright rims; the copied geometry and texture bytes were verified unchanged.

This candidate reuses the accepted ground-ore muted albedo and its quiet sampling rectangle. Original TEXCOORD_0 and TEXCOORD_1 remain intact. TEXCOORD_2 supplies albedo coordinates; source normal and detail maps retain their original coordinates. Normal scale is 0.16, metallic factor 0 and roughness 0.92. The source test verifies unchanged geometry and original channels, exact normal-map bytes, and the new albedo hash.

Generate with `npx tsx tools/build-shortcut-outcrops.ts --quiet`. During a scheduled hardware slot, run:

```powershell
npx tsx runs/corealm-rebuild/checks/finish-geology-gallery.ts --catalog art/rebuild/candidates/finish-structures/source-outcrops-quiet/shortcut-outcrops.json
```

Visual review and world contact/traversal proof remain pending. No public assets have been promoted.
