import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';
import { applyClip, duration, restorePose, storedPose } from '../../../../../../tools/creature-motion/pose.js';

const base = 'assets/art/tripo/imports/creatures/audit-bighorn';
const sourcePath = 'game/public/assets/models/creature/creature_cairn_bighorn.glb';
const generatedPath = `${base}/bighorn-wool-imagegen.png`;
const runtimePath = `${base}/bighorn-wool-runtime.jpg`;
const candidatePath = `${base}/bighorn-candidate.glb`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(sourcePath);
const generated = await readFile(generatedPath);
if (sha(source) !== '7e4c24863118769f6ec335a4d5a4ec71a898df5fb318b4d4e1370395e50e365e') throw new Error('Bighorn source changed; review before rebuilding.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(source);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const coat = mesh?.listPrimitives().find(p => p.getMaterial()?.getName() === 'Sculpted_coat');
if (!coat || root.listSkins()[0]?.listJoints().length !== 26) throw new Error('Unexpected bighorn mesh or rig.');
const expectedClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];
if (expectedClips.some(name => !root.listAnimations().some(clip => clip.getName() === name))) throw new Error('Bighorn source animation changed.');

const coatIds = new Set(coat.getIndices().getArray());
const color = coat.getAttribute('COLOR_0');
const position = coat.getAttribute('POSITION');
const rgba = [], xyz = [];
for (const id of coatIds) {
  color.getElement(id, rgba);
  // Retain the sculpt's local color gradations while letting the layered map read at game distance.
  color.setElement(id, [Math.min(1, rgba[0] * 1.55), Math.min(1, rgba[1] * 1.55), Math.min(1, rgba[2] * 1.55), rgba[3]]);
  position.getElement(id, xyz);
  // Slightly broaden the fleece at the ribs and shoulders. Lower legs, head and horns stay anchored.
  const height = Math.max(0, Math.min(1, (xyz[1] - 0.55) / 0.35));
  const foreAft = Math.max(0, Math.min(1, (xyz[2] + 0.82) / 0.25, (0.95 - xyz[2]) / 0.25));
  const bulk = 1 + 0.07 * height * foreAft;
  position.setElement(id, [xyz[0] * bulk, xyz[1], xyz[2]]);
}
const runtime = await sharp(generated).resize(1024, 1024, { fit:'fill', kernel:'lanczos3' }).removeAlpha().jpeg({ quality:91, chromaSubsampling:'4:4:4' }).toBuffer();
await writeFile(runtimePath, runtime);
const wool = doc.createTexture('Image-generated layered bighorn wool').setImage(runtime).setMimeType('image/jpeg');
coat.getMaterial().setBaseColorTexture(wool);

const restBounds = deformedBounds(doc);
const rest = storedPose(doc);
const motion = {};
for (const clip of root.listAnimations()) {
  const seconds = duration(clip);
  const samples = [];
  for (const fraction of [0, .25, .5, .75, 1]) {
    restorePose(rest);
    applyClip(clip, seconds * fraction);
    const bounds = deformedBounds(doc);
    samples.push({ fraction, minY: bounds.min[1], maxY: bounds.max[1] });
  }
  motion[clip.getName()] = { seconds, samples };
}
restorePose(rest);
const candidate = await io.writeBinary(doc);
await writeFile(candidatePath, candidate);
const triangles = mesh.listPrimitives().reduce((n,p) => n + p.getIndices().getCount()/3, 0);
const size = {x:restBounds.max[0]-restBounds.min[0], y:restBounds.max[1]-restBounds.min[1], z:restBounds.max[2]-restBounds.min[2]};
const entry = {
  id:'creature_cairn_bighorn', file:'models/creature/creature_cairn_bighorn.glb',
  pack:'corealm-audit-bighorn', category:'character', is:'Cairn Bighorn',
  tags:['creature','bighorn','ram','quadruped','image-generated-texture','candidate'],
  bytes:candidate.length, sha256:sha(candidate), triangles, size,
  base:{x:restBounds.min[0],y:restBounds.min[1],z:restBounds.min[2]}, bounds:restBounds, groundY:restBounds.min[1],
  animations:root.listAnimations().map(clip => clip.getName()), materials:root.listMaterials().map(material => material.getName()),
  walkClipSeconds:motion.Walk.seconds, runClipSeconds:motion.Run.seconds, attackSeconds:motion.Attack.seconds,
  sourceProvenance:{sourceAssetId:'creature_cairn_bighorn',sourceFile:sourcePath,sourceSha256:sha(source),
    imagegenAtlas:generatedPath,imagegenSha256:sha(generated),runtimeAtlas:runtimePath,runtimeAtlasSha256:sha(runtime),
    preservedRigJointCount:26,preservedClips:true,geometryChange:'coat vertices broadened up to 7% laterally above lower legs; horn and other material geometry untouched',candidateStatus:'awaiting-root-lab-review'},
  acceptance:{sourceIdentityVerified:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}
};
await writeFile(`${base}/lab-catalog.json`, JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[entry],files:{creature_cairn_bighorn:'bighorn-candidate.glb'}},null,2));
await writeFile(`${base}/promotion.json`, JSON.stringify({schema:'corealm-asset-promotion/1',assetId:entry.id,
  candidateFile:candidatePath,candidateSha256:entry.sha256,productionFile:sourcePath,sourceSha256:sha(source),
  generatedAtlas:generatedPath,generatedAtlasSha256:sha(generated),runtimeAtlas:runtimePath,runtimeAtlasSha256:sha(runtime),
  cpuProof:{restBounds,motion,sourceClipsPreserved:true,skinJointCount:26,triangles},
  status:'staged-for-root-lab-review'},null,2));
console.log({candidate:candidatePath,sha256:entry.sha256,size,animationFloor:Object.fromEntries(Object.entries(motion).map(([name,data]) => [name,Math.min(...data.samples.map(s => s.minY))]))});
