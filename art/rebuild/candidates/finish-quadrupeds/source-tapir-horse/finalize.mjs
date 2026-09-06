import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const d=read('candidate.json'),m=read('region-measurements.json');
const lo=d.adaptedBoundsGltf.min,hi=d.adaptedBoundsGltf.max;
const a={id:'creature_bracken_tapir',file:'models/creature/creature_bracken_tapir.glb',pack:'lyndon-source-tapir-adaptation',category:'character',is:'tapir source adaptation',tags:['tapir','complete-source','static','cc0'],bytes:d.bytes,sha256:d.sha256,size:{x:hi[0]-lo[0],y:hi[1]-lo[1],z:hi[2]-lo[2]},base:{x:lo[0],y:lo[1],z:lo[2]},bounds:d.adaptedBoundsGltf,groundY:lo[1],triangles:d.triangles,animations:[],reviewOnly:true,skinned:false,sourceProvenance:{author:d.sourceAuthor,rigAuthor:d.rigAuthor,source:d.source,nativeRigSource:d.nativeRigSource,license:d.license,sourceSha256:d.sourceSha256}};
const c={schema:1,scope:'Static source review only. CPU review is not acceptance. Head/body proportions remain a concern.',assets:[a],files:{creature_bracken_tapir:d.file},pack:{id:a.pack,name:'CC0 horse body adapted to tapir',author:d.sourceAuthor,source:d.source,license:d.license}};
fs.writeFileSync(path.join(root,'review-catalogue.json'),JSON.stringify(c,null,2)+'\n');
const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'review-catalogue.json'))).digest('hex');
fs.writeFileSync(path.join(root,'README.md'),`# Complete CC0 source horse adapted to tapir

Frozen static revision for root review. CPU inspection found improved rounded ears, seated small eyes, a shorter broader nasal bridge and flattened nail fronts. The side view still has an oversized rear barrel and a small head on a protruding narrow neck. CPU review is not acceptance; no production, motion or gameplay claim is made.

Lyndon Daniels authored the complete CC0 horse body and textures; ChadM authored the native rig derivative. See SOURCE-LICENSE.md and the preserved source-hoofed creator pages. The original riggedHorse.blend remains unchanged: SHA-256 ${d.sourceSha256}.

Current GLB: ${d.file}, ${d.bytes} bytes, ${d.triangles} triangles, three meshes, zero skins/actions, embedded normal texture. SHA-256 ${d.sha256}. Review catalogue SHA-256 ${hash}. CPU reimport found finite vertices, no external textures, and zero boundary edges, nonmanifold edges or zero-area faces after positional welding at 1e-6 m.

The complete connected source body was spatially adapted across torso, legs, neck, skull, muzzle and short tail. Separate horse mane/tail hair was removed. Original ear roots connect to newly authored cupped rounded crowns; source pastern boundaries connect to new contiguous feet with three primary lobes, physical clefts, flat nail fronts and a smaller fourth outer forefoot projection. These are local source-region replacements, not immutable original topology. No capsule torso or separate head graft was added.

vertex-source-map.json preserves all 3,697 original body vertices, faces, groups, bones and corresponding positions before later neck edits, subdivision and ear/foot retopology. New regional topology has no original vertex index. The retained 19-bone rig is primary-warp authoring data only: it has not been fitted to final local edits. Native Bone.005 weights reference an absent bone; eyes are unbound and new regional vertices need weights. No action aliases were invented.

Measured original body width/length/height at 2.4 m normalization: ${d.proportionMeasurements.sourceBodyDimensionsMeters.map(n=>n.toFixed(6)).join(' / ')} m. Current width/length/height: ${d.proportionMeasurements.adaptedDimensionsMeters.map(n=>n.toFixed(6)).join(' / ')} m. Defined head region width/length/height: ${m.head.dimensions.map(n=>n.toFixed(6)).join(' / ')} m; torso region: ${m.torso.dimensions.map(n=>n.toFixed(6)).join(' / ')} m. Head/torso length ratio ${m.headLengthToTorsoLength.toFixed(6)}, width ratio ${m.headWidthToTorsoWidth.toFixed(6)}. region-measurements.json states exact geometric masks; these are edit measurements, not zoological landmarks. candidate.json records primary-warp bone lengths separately from final mesh dimensions.

Previous pre-nasal/nail revision is preserved in revision-before-nasal-nails. Final nasal edits compress reach beyond 0.94 m by 38%, broaden bridge by up to 42%, compress its depth by 47%, and shape an upper nasal overhang from the original muzzle. Eye radius is 34% of the first warped source eye radius.

The San Diego Zoo tapir reference (https://animals.sandiegozoo.org/animals/tapir) informed small eyes and ears, short prehensile nose, rear-heavy body, bristly coat and four fore/three hind digits. Numerical shapes are authored, not photo measurements. No reference image or texture was copied.

Build with node tools/creature-expansion/hoofed/source-tapir-horse.mjs. build.py uses background CPU Blender; validate.py checks reimported GLB; measure.py records region dimensions; finalize.mjs writes this report and isolated review catalogue. Six CPU stills cover front, side, rear, three-quarter, head and forefoot. Parent owns production lab and acceptance. No GPU/browser/public asset/shared generator was used.
`);
console.log(JSON.stringify({glbSha256:d.sha256,catalogueSha256:hash,dimensions:d.proportionMeasurements.adaptedDimensionsMeters,headToTorsoLength:m.headLengthToTorsoLength}));
