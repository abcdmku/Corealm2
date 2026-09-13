# Fairy creature textures

The fairy roster uses twelve ordinary bodies in Gloamgarden and Faeholme. The frog, snail and hart are the user's permitted animal bases. Spriggles, sporekin, imps, reliquaries, veilspirits, saplings, drakes, wardlings and petalguards supply the other forms. The six guardian skins retain their standard miniboss models.

Every regional skin has its own image-generated albedo map under `textures/generated/`. Its adjacent JSON records the exact prompt, source references and built-in imagegen output. Maps use layered colors, markings and material detail. Flat monochromatic recolors are not accepted.

`textures/source/index.json` identifies the original albedo images and UV guides. Most models use one atlas. Sporekin uses a three-column, two-row atlas ordered staff, hair, eyes, skin, chest and scarf. Its source eye material is preserved.

`npx tsx tools/fairy-population-assets.ts` embeds these images in staged GLBs under `test-results/fairy-population/assets/`. It retains source geometry, UVs, skinning, clips, normal maps, roughness and alpha. The staged catalogue records both generated PNG and embedded texture hashes. No color wash is applied over the artwork.

Use the production lab before promotion:

```powershell
npx tsx tools/fairy-population-lab-test.ts --region gloamgarden --forms all --generated --out-name generated-roster
npx tsx tools/fairy-population-lab-test.ts --region faeholme --forms all --generated --out-name generated-roster
npx tsx tools/fairy-population-lab-test.ts --region gloamgarden --bosses --generated --out-name generated-bosses
npx tsx tools/fairy-population-lab-test.ts --region faeholme --bosses --generated --out-name generated-bosses
npx tsx tools/fairy-population-spacing-test.ts
```

The lab tests record source hashes, animated state, attached gameplay camera poses, real movement and browser errors. Root inspects the screenshots before accepting the assets. Generated screenshots and reports remain disposable under `test-results/fairy-population/`.
