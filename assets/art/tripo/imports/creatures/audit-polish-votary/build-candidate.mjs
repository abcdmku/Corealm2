import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const out = 'assets/art/tripo/imports/creatures/audit-polish-votary';
const sourceFile = `${out}/sources/creature_cinder_penitent.glb`;
const sourceCatalogFile = `${out}/source-catalog.json`;
const productionFile = `${out}/sources/production_creature_cinder_penitent.glb`;
const candidateId = 'creature_ashbound_votary_elite';
const candidateRelativeFile = `models/${candidateId}.glb`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceCatalog = JSON.parse(await readFile(sourceCatalogFile, 'utf8'));
const sourceEntry = sourceCatalog.assets.find(asset => asset.id === 'creature_cinder_penitent');
if (!sourceEntry) throw new Error('Missing staged Cinder Penitent entry');
const sourceBytes = await readFile(sourceFile);
if (sourceBytes.length !== sourceEntry.bytes || sha(sourceBytes) !== sourceEntry.sha256) {
  throw new Error('Staged source hash does not match its catalog');
}
const productionBytes = await readFile(productionFile);
const manifest = JSON.parse(await readFile(`${out}/source-manifest.json`, 'utf8'));
const productionEntry = manifest.assets.find(asset => asset.id === 'creature_cinder_penitent');
if (!productionEntry || sha(productionBytes) !== productionEntry.sha256) {
  throw new Error('Accepted low-tier source hash changed');
}
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
for (const material of root.listMaterials()) {
  const name = material.getName();
  if (name === 'cinder_penitent_woven_shroud' || name === 'cinder_penitent_ash_hands') {
    material.setName(`animal_rpg_${name}`);
  }
}
const clips = root.listAnimations().map(clip => ({
  name: clip.getName(),
  seconds: Math.max(...clip.listSamplers().flatMap(sampler => [...sampler.getInput().getArray()])),
}));
const required = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];
if (required.some(name => !clips.some(clip => clip.name === name))) throw new Error('Incomplete source clips');
const jointCount = Math.max(...root.listSkins().map(skin => skin.listJoints().length));
if (jointCount !== 65) throw new Error(`Expected 65 native joints; got ${jointCount}`);
const materials = root.listMaterials().map(material => material.getName());
const triangles = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((part, primitive) => {
  return part + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3;
}, 0), 0);
const detailedTextures = root.listTextures().filter(texture => texture.getImage()?.length > 0).map(texture => ({
  name: texture.getName(), sha256: sha(texture.getImage()), bytes: texture.getImage().length,
}));
if (detailedTextures.length === 0) throw new Error('Source lost its detailed texture maps');
await mkdir(`${out}/models`, { recursive: true });
const candidateBytes = Buffer.from(await io.writeBinary(doc));
await writeFile(`${out}/${candidateRelativeFile}`, candidateBytes);
const builderFile = `${out}/build-candidate.mjs`;
const builderSha256 = sha(await readFile(builderFile));
const sourceSha256 = sha(sourceBytes);
const candidateSha256 = sha(candidateBytes);
const candidate = {
  id: candidateId,
  file: `models/creature/${candidateId}.glb`,
  pack: 'corealm-audit-polish-votary',
  category: 'character',
  is: 'Ashbound Votary elite candidate',
  tags: ['creature', 'ashlands', 'votary', 'elite', 'candidate'],
  bytes: candidateBytes.length,
  sha256: candidateSha256,
  triangles,
  size: sourceEntry.size,
  base: sourceEntry.base,
  groundY: sourceEntry.groundY,
  bounds: sourceEntry.metadata.redesign.measurements.idleBounds,
  animations: clips.map(clip => clip.name),
  materials,
  attackSeconds: clips.find(clip => clip.name === 'Attack').seconds,
  contactNormalized: sourceEntry.contactNormalized,
  strideCalibration: null,
  sourceProvenance: {
    stagedFile: sourceFile,
    stagedSha256: sourceSha256,
    originalSourceAssetId: 'creature_revenant',
    originalSourceSha256: sourceEntry.metadata.redesign.sourceSha256,
    originalBuilder: sourceEntry.metadata.redesign.generator,
    originalBuilderSha256: sourceEntry.metadata.redesign.generatorSha256,
    author: 'Quaternius', license: 'CC0-1.0',
    imagegenAtlas: sourceEntry.metadata.redesign.anatomyAtlas,
    embeddedTextures: detailedTextures,
    productionLowTierFile: productionFile,
    productionLowTierSha256: productionEntry.sha256,
    builderFile, builderSha256,
  },
  metadata: {
    shapeTreatment: 'Sealed elongated iron face, high burnt collar and split asymmetric hovering shroud; visibly distinct from the accepted cloth-and-ember human votary.',
    retainedSourceRig: `${jointCount} joints`,
    retainedSourceClips: clips,
    sampledSourceMotion: sourceEntry.metadata.redesign.measurements.clips.map(({ clip, duration, bounds }) => ({ clip, duration, bounds })),
    visualReference: ['test-results/biome-creatures/ash/cinder_penitent-front.png', 'test-results/biome-creatures/ash/cinder_penitent-side.png'],
  },
  acceptance: { exported: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
const pack = { id: candidate.pack, name: 'Ashbound Votary high-tier candidate', author: 'Corealm', source: builderFile, license: 'CC0-1.0; generated raster anatomy atlas', generatorSha256: builderSha256 };
await writeFile(`${out}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', pack, assets: [candidate], files: { [candidateId]: candidateRelativeFile } }, null, 2) + '\n');
await writeFile(`${out}/promotion.json`, JSON.stringify({
  schema: 'corealm-creature-polish-promotion/1', status: 'awaiting-root-lab-review', accepted: false,
  pack: candidate.pack, builderFile, builderSha256,
  assets: [{ id: candidateId, candidateFile: `${out}/${candidateRelativeFile}`, sha256: candidateSha256, bytes: candidateBytes.length,
    bounds: candidate.bounds, size: candidate.size, triangles, materials, animations: candidate.animations,
    attack: { seconds: candidate.attackSeconds, contactNormalized: candidate.contactNormalized, contactSeconds: candidate.attackSeconds * candidate.contactNormalized },
    sourceProvenance: candidate.sourceProvenance, strideCalibration: null,
    tierRecommendation: { preserveLowTierAssetId: 'creature_cinder_penitent',
      useEliteAssetId: candidateId,
      eliteDefinitionIds: ['cinder_penitent_t50', 'cinder_penitent_t70', 'population_last_light_west_penitents', 'population_black_keep_north_penitents'],
      keepLowTierDefinitionIds: ['cinder_penitent_t1', 'cinder_penitent_t5', 'cinder_penitent_t10', 'cinder_penitent_t20'],
      note: 'Root decides final preset split after side-by-side lab review; keep loot and combat parameters unchanged.' },
    status: 'awaiting-root-lab-review', accepted: false }],
}, null, 2) + '\n');
console.log(JSON.stringify({ id: candidateId, file: `${out}/${candidateRelativeFile}`, sha256: candidateSha256, bytes: candidateBytes.length,
  size: candidate.size, bounds: candidate.bounds, triangles, joints: jointCount, attackSeconds: candidate.attackSeconds,
  contactNormalized: candidate.contactNormalized, textures: detailedTextures.length }, null, 2));
