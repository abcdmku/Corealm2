import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';
import { duration } from '../../../../../../tools/creature-motion/pose.js';

const base = 'assets/art/tripo/imports/creatures/audit-heath-jack';
const sourcePath = 'game/public/assets/models/animal/animal_rabbit.glb';
const generatedAtlasPath = `${base}/heath-hare-imagegen-atlas.png`;
const candidatePath = `${base}/heath-hare-candidate.glb`;
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const original = manifest.assets.find((asset: { id: string }) => asset.id === 'animal_rabbit');
const target = manifest.assets.find((asset: { id: string }) => asset.id === 'creature_heath_jack');
if (!original || !target) throw new Error('Missing current rabbit or Heath Jack asset contract.');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourcePath);
if (sha(sourceBytes) !== original.sha256) throw new Error('Rabbit source changed.');
const generatedBytes = await readFile(generatedAtlasPath);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const texture = root.listMaterials()[0]?.getBaseColorTexture();
const triangleCount = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((part, primitive) => part + (primitive.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const sourceAtlas = texture?.getImage();
if (!texture || !sourceAtlas || root.listSkins()[0]?.listJoints().length !== 45) throw new Error('Unexpected rabbit mesh, map or skin.');
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];
if (requiredClips.some(name => !root.listAnimations().some(clip => clip.getName() === name))) throw new Error('Rabbit source has missing motion.');
const dimension = 1024;
const sourcePixels = await sharp(sourceAtlas).resize(dimension, dimension, { kernel: 'nearest' }).removeAlpha().raw().toBuffer();
const generatedPixels = await sharp(generatedBytes).resize(dimension, dimension, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
const colors = Buffer.from(generatedPixels);
for (let i = 0; i < colors.length; i += 3) {
  // Preserve the source atlas gutters exactly; only painted UV islands change.
  if (sourcePixels[i] > 242 && sourcePixels[i + 1] > 242 && sourcePixels[i + 2] > 242) colors.fill(255, i, i + 3);
}
const runtimeAtlas = await sharp(colors, { raw: { width: dimension, height: dimension, channels: 3 } }).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
await writeFile(`${base}/heath-hare-runtime-atlas.jpg`, runtimeAtlas);
texture.setImage(runtimeAtlas).setMimeType('image/jpeg').setName('Heath hare layered russet fur atlas');
const sceneRoot = root.listScenes()[0]?.listChildren()[0];
if (!sceneRoot || Math.abs(sceneRoot.getScale()[0] - .01) > 1e-8) throw new Error('Unexpected rabbit scene root scale.');
const scaleFactor = .75 / original.size.y;
sceneRoot.setScale([.01 * scaleFactor, .01 * scaleFactor, .01 * scaleFactor]);
const bounds = deformedBounds(doc);
const output = await io.writeBinary(doc);
await writeFile(candidatePath, output);
const clipSeconds = Object.fromEntries(root.listAnimations().map(clip => [clip.getName(), duration(clip)]));
const entry = {
  id: 'creature_heath_jack', file: target.file, pack: 'corealm-heath-hare-candidate', category: 'character', is: 'Heath Jack',
  tags: ['creature', 'heath', 'hare', 'quadruped', 'image-generated-texture', 'candidate'],
  bytes: output.length, sha256: sha(output), triangles: triangleCount,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: bounds.min[1],
  animations: root.listAnimations().map(clip => clip.getName()), materials: root.listMaterials().map(material => material.getName()),
  walkClipSeconds: clipSeconds.Walk, runClipSeconds: clipSeconds.Run, attackSeconds: clipSeconds.Attack,
  sourceProvenance: { sourceAssetId: 'animal_rabbit', sourceFile: sourcePath, sourceSha256: sha(sourceBytes),
    imagegenAtlas: generatedAtlasPath, imagegenSha256: sha(generatedBytes), runtimeAtlas: `${base}/heath-hare-runtime-atlas.jpg`, runtimeAtlasSha256: sha(runtimeAtlas),
    originalGeometryRigAndClipsPreserved: true, uniformScaleFactor: scaleFactor, candidateStatus: 'awaiting-root-lab-review' },
  acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${base}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [entry], files: { creature_heath_jack: 'heath-hare-candidate.glb' } }, null, 2));
console.log({ file: candidatePath, bytes: output.length, height: entry.size.y, clips: clipSeconds });
