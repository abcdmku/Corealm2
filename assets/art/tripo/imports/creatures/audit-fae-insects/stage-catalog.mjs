import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const generator = 'assets/art/tripo/imports/creatures/audit-fae-insects/audit-motion.mjs';
const pack = {
  id: 'corealm-tripo-audit-fae-insects',
  name: 'Corealm Tripo fairy insect corrections',
  author: 'Corealm / Tripo Studio',
  source: generator,
  license: 'LicenseRef-Corealm-Original',
  generatorSha256: sha(await readFile(path.join(repo, generator))),
};
const definitions = [
  {
    id: 'creature_lantern_sprite', name: 'Ambervein Leafwing as Lantern Sprite',
    existing: 'starred-leafwing/lab-catalog.json',
    original: 'assets/art/tripo/imports/creatures/starred-leafwing/ambervein-leafwing-native-rig.glb',
    staged: 'lantern-sprite-candidate.glb',
    nativeScale: .58, contactNormalized: .4,
    habitat: 'Gloamgarden', gait: 'airborne glide and dart; no terrestrial footfall',
  },
  {
    id: 'creature_orchid_reaper', name: 'Orchid Reaper',
    existing: 'starred-orchid-reaper/lab-catalog.json',
    original: 'assets/art/tripo/imports/creatures/starred-orchid-reaper/orchid-reaper-native-rig-candidate.glb',
    staged: 'orchid-reaper-candidate.glb',
    nativeScale: .85, contactNormalized: .5,
    habitat: 'Faeholme', gait: 'alternating biped walk and run; world speed uncalibrated',
  },
];

const assets = [];
const files = {};
for (const definition of definitions) {
  const prior = JSON.parse(await readFile(path.resolve(here, '..', definition.existing)));
  const old = prior.assets.find(item => item.id === definition.id);
  if (!old) throw new Error(`Missing prior ${definition.id}`);
  const original = await io.read(path.join(repo, definition.original));
  const stagedAbsolute = path.join(here, definition.staged);
  const corrected = await io.read(stagedAbsolute);
  const oldPrimitive = original.getRoot().listMeshes()[0].listPrimitives()[0];
  const newPrimitive = corrected.getRoot().listMeshes()[0].listPrimitives()[0];
  for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
    const a = oldPrimitive.getAttribute(semantic)?.getArray();
    const b = newPrimitive.getAttribute(semantic)?.getArray();
    if (!a || !b || a.length !== b.length || a.some((value, index) => value !== b[index])) {
      throw new Error(`${definition.id}: ${semantic} changed in floor correction`);
    }
  }
  const oldMaps = original.getRoot().listTextures().map(texture => sha(Buffer.from(texture.getImage()))).sort();
  const newMaps = corrected.getRoot().listTextures().map(texture => sha(Buffer.from(texture.getImage()))).sort();
  if (JSON.stringify(oldMaps) !== JSON.stringify(newMaps)) throw new Error(`${definition.id}: PBR maps changed`);
  const bytes = await readFile(stagedAbsolute);
  const clips = corrected.getRoot().listAnimations();
  const durations = Object.fromEntries(clips.map(clip => [clip.getName(), Math.max(...clip.listChannels().flatMap(channel => Array.from(channel.getSampler().getInput().getArray())))]));
  const stagedRelative = path.relative(repo, stagedAbsolute).replaceAll('\\', '/');
  const entry = {
    ...old,
    is: definition.name,
    pack: pack.id,
    tags: [...new Set(['creature', 'fairy', 'tripo', 'candidate', ...(definition.id === 'creature_lantern_sprite' ? ['flying', 'leaf-wing'] : ['botanical', 'orchid', 'scythe-arms'])])],
    bytes: bytes.length,
    sha256: sha(bytes),
    animations: clips.map(clip => clip.getName()),
    materials: corrected.getRoot().listMaterials().map(material => material.getName()),
    impliedWalkMps: null,
    impliedRunMps: null,
    measuredGait: null,
    locomotionPolicy: null,
    walkClipSeconds: durations.Walk,
    runClipSeconds: durations.Run,
    attackSeconds: durations.Attack,
    contactNormalized: definition.contactNormalized,
    sourceProvenance: {
      ...old.sourceProvenance,
      originalCandidateFile: definition.original,
      originalCandidateSha256: sha(await readFile(path.join(repo, definition.original))),
      candidateFile: stagedRelative,
      candidateSha256: sha(bytes),
      correction: 'Per-clip root translation sampled at 65 points to keep weighted geometry at least 6 mm above ground. Death adds a forward collapse; the small leafwing crumples as its wings fold. Original mesh, skin weights, UVs and 2K layered PBR maps unchanged.',
      correctionGenerator: generator,
      correctionGeneratorSha256: pack.generatorSha256,
    },
    metadata: {
      family: definition.id.replace('creature_', ''),
      rig: definition.id === 'creature_lantern_sprite' ? '33-joint fantasy insect with four articulated leaf wings and six legs' : '29-joint botanical biped with articulated orchid crown and scythe arms',
      source: 'Approved Tripo Studio image-generated detailed mesh and layered 2K PBR maps; Corealm native rig and motion; floor-clearance correction.',
      presentation: { rawAssetHeightMeters: old.size.y, existingSpeciesScale: definition.nativeScale, desiredInGameHeightMeters: old.size.y * definition.nativeScale, habitat: definition.habitat },
      attackContact: { seconds: durations.Attack * definition.contactNormalized, normalized: definition.contactNormalized },
      gaitMeasurement: { status: 'uncalibrated', description: definition.gait, impliedWalkMps: null, impliedRunMps: null },
      floorClearance: { minimumMeters: .006, sampleCountPerClip: 65 },
      deathPose: { finalHeightRatioMaximum: .6, posture: definition.id === 'creature_lantern_sprite' ? 'forward-fallen and crumpled wingfold' : 'forward-fallen botanical biped' },
    },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
  };
  assets.push(entry);
  files[definition.id] = stagedAbsolute;
}

const lab = { schema: 'corealm-lab-asset-candidates/1', pack, assets, files };
await writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify(lab, null, 2) + '\n');
const promotionDir = path.join(repo, 'test-results/creature-audit/promotions');
await mkdir(promotionDir, { recursive: true });
const promotion = { schema: 'corealm-creature-promotion/1', pack,
  assets: assets.map(asset => ({ ...asset, candidateFile: path.relative(repo, files[asset.id]).replaceAll('\\', '/') })) };
await writeFile(path.join(promotionDir, 'fae-insects.json'), JSON.stringify(promotion, null, 2) + '\n');
process.stdout.write(JSON.stringify(assets.map(asset => ({ id: asset.id, bytes: asset.bytes, sha256: asset.sha256,
  clips: asset.animations, material: asset.materials, walk: asset.walkClipSeconds, run: asset.runClipSeconds, attack: asset.attackSeconds })), null, 2) + '\n');
