# Complete rat source and porcupine adaptation

The licensed original is **Evil Giant Rat**, by CDmir and TinyWorlds:
https://opengameart.org/content/evil-giant-rat

License: CC0 1.0. `CC0-1.0.txt` preserves the legal text.
Original `cdmir-rat-original.blend` SHA-256:
`52530520c71787da6c9ced7130cca02ddaf2b0af567bc38221b746d2297b5be2`.
The original remains unchanged.

## Independent original conversion

`cdmir-rat-native.glb` is the separate rat conversion before species changes.
`native-export-report.json` must have `releaseReady: true` and match the GLB hash.
`native-export-readback-audit.json` measures final-byte skeletal interpolation
against Blender-evaluated native motion. Do not treat an intermediate file as
released merely because it exists.

The import API is `tools/creature-expansion/mammals/source-porcupine.mjs`:
`await loadNativeRatSource()` returns the document, bytes, hash, report and
provenance. The API rejects an unreleased or mismatched conversion.

Positions remain in original Blender world units beneath a root rotation:
rendered glTF has Y up and the nose faces +Z. No unit scale was supplied by the
original author. The optional scale 0.240830591906 reproduces the earlier rat
preview's 0.34 m height; it is an authored display scale, not a measured size.

Native actions keep their original names and timings. Stand is a static pose;
The optional 64.708-second Idle.000 is omitted from the released conversion:
six discontinuities inside the original Blender B-bones cause 33.4–51.35 mm
vertex jumps at preview scale. The original blend preserves all 14 actions;
the conversion uses 13 real clips, including Idle.001 and Idle.002. See
weight-audit-tail-discontinuity.json. Semantic game action mapping belongs to the
integration owner. No duplicate aliases were manufactured.

Hair was intentionally hidden in the original collection and is omitted.
Its initially suspicious bounds were an unevaluated hidden dependency-graph
matrix, not evidence of corrupt geometry. See `native-motion-inspection.json`.

## Separate species adaptation

`porcupine-surface.mjs` reshapes the complete original body, head, ears, jaw,
limbs and tail. It uses original vertex groups for jaw and tail identification.
Tail compression is monotonic. The adapter retains body topology and maps
short-tail pivots and corrective translations to the new rest proportions.
Added quill roots copy a source vertex's intact four-weight solution.

After the original export passes:

```
node art/rebuild/candidates/finish-quadrupeds/source-porcupine/adapt-rat-porcupine.mjs
node art/rebuild/candidates/finish-quadrupeds/source-porcupine/inspect-exported-motion.mjs
node art/rebuild/candidates/finish-quadrupeds/source-porcupine/prepare-porcupine-catalogue.mjs
```

The new candidate catalogue is `porcupine-candidate-catalogue.json`.
The old `candidate-catalogue.json` and static previews are frozen source-review
evidence and are not overwritten by the adaptation pipeline.

CPU finite-position and source-deformation checks do not establish visual or
foot-contact acceptance. Root owns hardware feature-lab inspection, real game
animation mapping, gameplay checks and integration. All candidates remain
unaccepted until those checks pass.

