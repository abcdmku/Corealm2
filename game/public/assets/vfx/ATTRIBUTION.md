# Spell VFX atlas — sources and licence

`spell-atlas.png` is a 4x4, 1024x1024 sprite sheet baked by `tools/build-vfx-atlas.ts`
from **Magic Effects FREE** by **Hovl Studio**, obtained from the Unity Asset Store.

Use of that pack is governed by the Unity Asset Store EULA, which grants the licensee the right to
use the assets in their own projects. The pack itself is NOT redistributed here — only this derived
atlas, and only the sixteen greyscale particle sprites listed below. No prefab, material, shader,
scene or mesh from the pack is used; Corealm draws the atlas through its own Three.js instanced
renderer in `game/src/render/spellVfx.ts`.

Every cell is normalised to Corealm's additive convention: RGB carries
`luminance * alpha` and alpha is pinned to 255, with a 3 px black guard band to stop mip
bleed between neighbours. Colour comes entirely from the per-instance tint at draw time, which is
how one sprite set serves wind, water, earth and fire.

sha256 (first 16): `0a22d7eb356b42d2`

`Mean` is the average intensity of the normalised cell; `render/spellVfx.ts` derives each
cell's `gain` from it, so that one sprite does not print four times the light of another at equal
size.

| Cell | Id | Source file | Source format | Mean | Used for |
| ---: | -- | ----------- | ------------- | ---: | -------- |
| 0 | `glow` | GlowFree1.png | 512x512, RGBA | 36.0 | soft radial core: charge-up, projectile heart, impact bloom |
| 1 | `flash` | FlashFree2.png | 512x512, RGBA | 53.2 | hard starburst, the frame a spell lands on |
| 2 | `spark` | Point1.png | 32x32, RGB | 74.8 | bright point mote for scatter and embers (the pack's own spark texture) |
| 3 | `smoke` | SmokeFree1.png | 512x512, RGBA | 91.4 | billow, for the settle after an impact |
| 4 | `streak` | ProjectileFree1.png | 512x256, RGBA | 36.0 | comet head with a tail: the bolt/burst projectile body |
| 5 | `trail` | Trail67.png | 256x64, RGBA | 19.0 | thin tapered ribbon dropped behind a projectile |
| 6 | `arc` | Electro.png | 254x254, RGBA | 15.6 | branching discharge — wind's signature cell |
| 7 | `flake` | Snowflake.png | 128x128, RGB | 44.2 | crystal facet — water's signature cell |
| 8 | `shard` | Stone.png | 254x254, RGBA | 142.8 | opaque chunk — earth's signature cell |
| 9 | `splat` | Splat.png | 254x254, RGB | 97.2 | wet spatter, water impacts |
| 10 | `scorch` | CraterFree1.png | 512x512, RGB | 7.9 | ground scorch decal under an impact |
| 11 | `crack` | Crack.png | 512x512, RGBA | 11.3 | ground fracture decal, earth impacts |
| 12 | `ring` | Circle2.png | 256x256, RGB | 58.9 | thin ring: the expanding shockwave |
| 13 | `rune` | MagicCircle.png | 1024x1024, RGB | 29.8 | cast circle drawn flat at the caster's feet |
| 14 | `glyph` | MagicCircle2.png | 1024x1024, RGBA | 12.6 | inner counter-rotating ring of the cast circle |
| 15 | `slash` | Slash.png | 254x254, RGBA | 33.7 | wide arc sweep, the surge rung's opening frame |

Regenerate with:

```bash
npx tsx tools/build-vfx-atlas.ts
npx tsx tools/build-vfx-atlas.ts --check   # fails if the committed PNG is stale
```


## Current spatial flame texture

`elemental-flame-flow-v1.png` is an original grayscale texture generated with the built-in image generation tool on 2026-09-09. It is sampled on curved 3D flame surfaces and inside volumetric fire. See `runs/elemental-spell-range/asset-provenance.md` for the exact prompt and source output. The older atlas described above is retained as a historical asset and is not used by the current elemental spell renderer.
