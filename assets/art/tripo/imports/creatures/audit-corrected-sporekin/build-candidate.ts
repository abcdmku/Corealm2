import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { retargetHumanoid } from '../../../../../../tools/tripo-creatures/retarget.js';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const libraryPath = 'game/public/assets/models/animation/animation_library_1.glb';
const library = await io.readBinary(await readFile(libraryPath));
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const specs = [
  { dir: 'audit-corrected-sporekin', id: 'fairy_garden_sporekin_faeholme', name: 'Duskcap Sporekin', projectId: '7b895b19-d80b-4680-96b7-3f4cf63fa8a9', expectedTriangles: 4438, expectedVertices: 2858, normalizationScale: 2.5 },
  { dir: 'audit-corrected-sapling', id: 'fairy_garden_sapling_gloamgarden', name: 'Briar Sapling', projectId: 'd1c16cfc-3f64-4e48-8205-9b53502184f8', expectedTriangles: 5350, expectedVertices: 3555, normalizationScale: 2.5 },
];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const spec of specs) {
  const base = `assets/art/tripo/imports/creatures/${spec.dir}`;
  const sourcePath = `${base}/source-preview.glb`;
  const sourceBytes = await readFile(sourcePath);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  for (const extension of root.listExtensionsUsed()) if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  const primitive = root.listMeshes()[0]?.listPrimitives()[0];
  if (!primitive || primitive.getIndices()?.getCount() !== spec.expectedTriangles * 3 || primitive.getAttribute('POSITION')?.getCount() !== spec.expectedVertices) throw new Error(`Unexpected source mesh for ${spec.name}`);
  if (root.listAnimations().length || root.listSkins()[0]?.listJoints().length !== 65) throw new Error(`Unexpected source skeleton for ${spec.name}`);
  const retarget = retargetHumanoid(doc, library);
  const sceneRoot = root.listScenes()[0]?.listChildren()[0];
  if (sceneRoot?.getName() !== 'corealm_motion_ground' || sceneRoot.getScale().some(value => value !== 1)) throw new Error(`Unexpected scene root for ${spec.name}: ${sceneRoot?.getName()} ${sceneRoot?.getScale()}`);
  sceneRoot.setScale([spec.normalizationScale, spec.normalizationScale, spec.normalizationScale]);
  const bounds = deformedBounds(doc);
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const metadata = await sharp(image).metadata();
    if (Math.max(metadata.width ?? 0, metadata.height ?? 0) <= 2048) continue;
    const resized = sharp(image).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
    const jpeg = texture.getMimeType() === 'image/jpeg';
    texture.setImage(await (jpeg ? resized.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }) : resized.png()).toBuffer()).setMimeType(jpeg ? 'image/jpeg' : 'image/png');
  }
  const candidateBytes = await io.writeBinary(doc);
  const file = `${base}/${spec.dir}-animated-candidate.glb`;
  await writeFile(file, candidateBytes);
  const record = {
    schema: 'corealm-creature-candidate/1', id: spec.id, name: spec.name, status: 'awaiting-root-lab-review', accepted: false,
    source: { projectId: spec.projectId, preview: sourcePath, sha256: sha(sourceBytes), triangles: spec.expectedTriangles, vertices: spec.expectedVertices, joints: 65, maps: ['baseColor 8192', 'normal 4096', 'metallicRoughness 4096'] },
    candidate: { file, sha256: sha(candidateBytes), bytes: candidateBytes.length, clips: root.listAnimations().map(clip => clip.getName()), normalizationScale: spec.normalizationScale, bounds },
    retarget: { library: libraryPath, librarySha256: sha(await readFile(libraryPath)), result: retarget },
    acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
  await writeFile(`${base}/candidate.json`, JSON.stringify(record, null, 2));
  const existing = manifest.assets.find((asset: { id: string }) => asset.id === spec.id);
  if (!existing) throw new Error(`Missing existing asset ${spec.id}`);
  const timing = Object.fromEntries(retarget.clips.map(clip => [clip.name, clip.seconds]));
  const entry = {
    id: spec.id, file: existing.file, pack: 'corealm-tripo-audit-corrected', category: 'character', is: spec.name,
    tags: [...new Set([...(existing.tags ?? []), 'candidate'])], bytes: candidateBytes.length,
    sha256: sha(candidateBytes), triangles: spec.expectedTriangles,
    size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: bounds.min[1],
    animations: root.listAnimations().map(clip => clip.getName()),
    walkClipSeconds: timing.Walk, runClipSeconds: timing.Run, attackSeconds: timing.Attack,
    contactNormalized: 0.26,
    materials: root.listMaterials().map(material => material.getName()),
    sourceProvenance: { projectId: spec.projectId, sourceFile: sourcePath, sourceSha256: sha(sourceBytes), candidateFile: file, candidateSha256: sha(candidateBytes), candidateStatus: 'awaiting-root-lab-review' },
    metadata: {
      source: { projectId: spec.projectId, file: sourcePath, sha256: sha(sourceBytes), vertices: spec.expectedVertices, triangles: spec.expectedTriangles,
        rigJoints: 65, originalClips: 0, originalTextures: { baseColor: [8192, 8192], normal: [4096, 4096], metallicRoughness: [4096, 4096] } },
      candidate: { file, sha256: sha(candidateBytes), uniformSceneRootScale: spec.normalizationScale, sceneRoot: 'corealm_motion_ground',
        rig: 'Retained weighted 65-joint Tripo Mixamo skin; inverse-bind rest pose restored',
        motionSource: libraryPath, motionSourceSha256: sha(await readFile(libraryPath)),
        clips: retarget.clips, runtimeTextureMaximumDimension: 2048,
        contact: { normalized: 0.26, seconds: timing.Attack * 0.26, method: 'Measured peak forward reach of right hand relative to hips across 201 Attack samples; timing proxy pending gameplay review' } },
    },
    acceptance: record.acceptance,
  };
  await writeFile(`${base}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [entry], files: { [spec.id]: `${spec.dir}-animated-candidate.glb` } }, null, 2));
  console.log(spec.name, record.candidate.bytes, record.candidate.clips.join(','), JSON.stringify(bounds));
}
