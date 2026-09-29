# Tripo creature imports

These folders hold Tripo source exports, generated texture atlases, ledgers and the retired repo rigs.
The per-asset scripts that rigged, keyed, repaired or floor-corrected creature motion here were
removed on 2026-09-29: the repo no longer generates animation. Folder READMEs that still name a
`build-candidate`, `build-rig`, `audit-motion` or `correct-*` script describe that history only.

- Tripo bodies are re-rigged and retargeted from studio donors in Blender by `tools/creature-rig/`.
- Studio bodies ship their native takes through the importers listed in `tools/creature-motion/README.md`.

The remaining scripts only extract sheets, inspect sources or build texture and geometry skins on
the shipped bodies. The one exception, `audit-polish-bandits/build-candidates.mjs`, binds native
Quaternius UAL takes to the UAL-named bandit rigs by bone name; it keys nothing.
