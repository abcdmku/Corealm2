# Complete Fox source evaluation

The complete Khronos Fox is worth a production-lab comparison before any conversion. Its official 130 by 130 pixel preview shows a coherent fox silhouette: narrow chest, tucked underside, tapered lower legs, small feet, pointed muzzle and a brush tail flowing from the pelvis. The white throat and tail tip, orange upper coat and dark stockings separate the major forms. It avoids the spherical shoulder joints and oversized toe balls visible in the rejected generated fox.

This is a deliberately angular style. The thumbnail suggests a narrow torso, tall ears and thin legs; front and rear widths, eye detail, foot geometry and motion quality cannot be judged from this single small image. Low triangle count alone is not a rejection. The next decision should compare this unchanged whole animal in the production renderer at both inspection and gameplay distances.

`preview.original.jpg` was inspected directly before any conversion. It is the unchanged official screenshot, not a local render. No GPU, browser, production export, shared file or manifest was used by this evaluation.

## Source integrity

- Official repository: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
- Pinned source commit: `81e8b567643b5166e6ff40024e4ff71ad4b18676`
- Original GLB SHA-256: `d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7`
- One complete skinned mesh, 576 triangles and 1,728 source vertices.
- Twenty-four joints include the head, neck, two spine joints, three tail joints and distinct fore/hind limb chains. No separate ear or jaw joints exist.
- CPU checks found zero nonfinite positions, invalid weights or out-of-range joint indices.
- Native bounds are 25.185 by 79.029 by 154.720 source units. These are node-transformed bind positions, not an animated extent or a chosen production scale. At an illustrative uniform scale of 0.01 they would span about 0.252 by 0.790 by 1.547 metres; scale has not been applied.
- One embedded PNG texture, one material, roughness 0.58 and metallic 0. The primitive omits normals. Preserve the angular style when the production loader computes them; do not silently smooth across its authored facets.

## Native motion and missing work

Survey lasts 3.417 seconds, Walk 0.708 seconds and Run 1.158 seconds. Each has 21 animation channels. All three translate the hip and return it to the initial translation at the loop boundary. This supports treating them as in-place cycles, but does not prove planted-foot travel speed or contact quality.

Survey still needs review as an idle behavior. Attack, Hit, HitLeft, HitRight and Death are absent and need genuinely authored clips on the native rig. They must not be aliases of the three existing cycles. A bite would require either whole-head attack animation or an explicitly reviewed jaw rig addition. Do not replace this coherent body with a head graft.

The next gate is unchanged-source hardware viewing and native clip sampling, followed by a scale/orientation decision. Production integration, new combat motion, all-vertex clip audits and natural lifecycle proof come afterwards. No visual or gameplay acceptance is claimed here.

## Attribution

The original model is by PixelMannen, 2014, CC0-1.0. Rigging and animation are by tomkranis, 2014, CC-BY-4.0. glTF conversion is by @AsoboStudio and @scurest, 2017, CC-BY-4.0. Preserve these credits with any derived asset and identify later modifications. The exact official license, README and metadata are stored unchanged beside the GLB. `provenance.json` records immutable download URLs, sizes and SHA-256 hashes for every staged source file.

The reusable CPU inspection command is `node tools/creature-expansion/mammals/source-fox.mjs`. Add `--download` only when intentionally fetching a fresh pinned source snapshot. The existing snapshot remains unmodified during ordinary inspection.

## Scale-only preview prepared after source review

`node tools/creature-expansion/mammals/source-fox.mjs --stage-catalogue` creates two request-interception catalogues. `raw-catalogue.json` serves the exact original GLB at its native size. `scaled-catalogue.json` serves `Fox.preview-scale001.glb`, which adds one common scene-root node with uniform scale 0.01. No rotation is applied. The original remains byte-identical.

This wrapper is necessary because the production asset loader loads the GLB scene unchanged, and creature placement applies content scale and tier scale rather than normalizing from manifest height. The scaled bounds are 0.252 by 0.790 by 1.547 metres before those normal gameplay multipliers. CPU re-reading of both GLBs confirmed identical accessor values, including mesh, skin and animation data. `scale-proof.json` records the hashes and loader references. The preview still contains exactly Survey, Walk and Run.

Both catalogues reuse `creature_redbrush_fox` solely for request interception and provide a complete `files` map and licensed pack entry. Neither is promoted. The current `review-catalogue.mjs` hardcodes another catalogue at its read and install call; its owner must add a catalogue path argument or environment variable before using these. Survey has no current idle resolver mapping, so initial still views should be labeled bind pose. Walk and Run can be selected through the existing gallery controls. Do not trigger missing combat/death behaviors during this source preview.
