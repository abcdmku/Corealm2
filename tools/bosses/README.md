# Elemental boss asset pipeline

Turns the **Fantasy Rhino** Unity package into the three orb bosses Corealm ships.

This is `tools/animals/` with a different source pack. Read that README first — the conversion, the
clip-naming contract, the root-motion trap and the tier-tint exemption are all the same, and none
of it is repeated here. What follows is only what differs.

## One rig, three elements

`tempest_roc` (air), `rootheart` (earth) and `ordrun` (water) each guard one element's Orb, and each
is drawn from the same rhinoceros rig recoloured onto its element. That is a deliberate reading rule
rather than a shortcut: the player learns one silhouette and then knows, on sight and at any
distance, that the thing in front of them is a boss and which Orb it is holding.

The tier silhouette does the rest. `world/regionBuilder.ts` draws a boss at 1.6x its authored scale
and then applies the tier factor, so the same 2.63 m rig ships at 3.79 m in Fallowmarch, 4.53 m in
Vellenwood and 4.85 m in the Gravelmaw. Bigger region, bigger boss, no second model.

## Licence

Not CC0. Fantasy Rhino is a paid Unity Asset Store product by *Maksim Bugrimov*, used under the
Standard Unity Asset Store EULA, and `tools/bosses/catalog.mjs` records that in the manifest rather
than claiming a licence it does not have. The same redistribution consideration that applies to the
animal pack applies here and is spelled out in `tools/animals/README.md`.

The pack's manifest entry carries no `archiveSha256`, matching the other imported Unity packs: there
is no redistributable archive of ours to hash. Each asset row carries its own `sha256` instead, and
`tools/build-assets.ts: preservedManifestRows` re-checks every one of them against the file on disk
before a legacy rebuild is allowed to keep the row.

**The product URL in `catalog.mjs` is a store search, not the permanent package id.** It resolves to
the product and is a real HTTPS source, but it should be pinned properly once the purchasing account
can be checked.

## Prepare the source

```
%APPDATA%\Unity\Asset Store-5.x\Maksim Bugrimov\3D ModelsCharactersCreatures\Fantasy Rhino.unitypackage
```

A `.unitypackage` is a gzipped tar of GUID directories, each holding `asset`, `asset.meta` and
`pathname`. Reconstruct the real tree by writing each `<guid>/asset` to the path named in
`<guid>/pathname`, rooted at `.asset-cache/boss-pack/raw/`. Then stage the textures:

```bash
python tools/bosses/stage-textures.py
```

Unlike the animal pack this needs no clip-range extraction: every motion is its own FBX holding one
take, so the take is the clip.

## The recolour

`stage-textures.py` rotates the albedo and the emissive map onto each element's hue, keeping value
and structure. Read the module docstring for why it hue-rotates rather than tints, and why air is
graded lighter and water darker when their hues are only 0.03 apart.

The emissive map is the whole trick. The pack ships a rhinoceros already plated with authored
glowing seams, which is why this model was worth importing at all: recolouring those seams is a
texture pass, whereas authoring a glow onto a plain animal would have been a shader.

## Build

The shipped rhinos come from `node tools/bosses/native-rhino.mjs`. It stages the six native takes
(Idle, Walk, Run, Attack=`Rhino@Attack`, Hit=`Rhino@Get_Hit`, Death=`Rhino@Dead`) from the `92da7c6`
identity-bound import with each element's current textures, under
`test-results/creature-motion/dragons/`. `build-bosses.ts` binds tracks by name through
`tools/animals/convert.js`, which misbinds the CAT rig's repeated spine names; do not ship its clips.

```bash
npx tsx tools/build-bosses.ts                        # all three, updates manifest.json
npx tsx tools/build-bosses.ts --only boss_rhino_earth
npx tsx tools/build-bosses.ts --keep-raw
```

## Check the result

```bash
POSE_DIR=boss POSE_OUT=runs/corealm/bosses/poses \
  npx tsx tools/animals/pose-shots.mjs boss_rhino_air boss_rhino_earth boss_rhino_water
npm run lab:creatures      # spawns all three in the real game and reads their stat blocks back
```

`npm run lab:creatures` is the one that matters, per AGENTS.md rule 7. It boots the production
combat lab, spawns each boss through the ordinary entity path — which throws if the rig is missing
from the manifest or failed to build — and reports the archetype, health, computed level and drawn
footprint it came back with.

## Traps this pipeline hit

**Emissive intensity does not survive as a material property.** glTF clamps `emissiveFactor` to
[0,1], so a three.js `emissiveIntensity` above 1 has nowhere to go. It rides out as
`KHR_materials_emissive_strength`, which three's own GLTFLoader reads back — confirmed on the built
file rather than assumed, because the failure mode is a boss that silently loses its glow.

**The source is ten times the size the converter expects.** The animal pack's plain centimetres-to-
metres left this rig at 26.33 m long. `RHINO_EXTRA_SCALE` in `catalog.mjs` corrects it to 2.63 m,
which sits correctly beside `animal_bear` at 2.46 m and `animal_aurochs` at 2.53 m.

**The tier tint had to learn a second prefix.** `render/entityViews.ts` exempted `animal_*`
materials from the 45% pull toward the tier metal swatch; boss materials need the same exemption for
a stronger reason, since a blue-black pull under a green emissive reads as a rendering fault rather
than as a creature. The regex there is now `/^(animal|boss)_/i` and it is a contract with the two
builders that name those materials.
