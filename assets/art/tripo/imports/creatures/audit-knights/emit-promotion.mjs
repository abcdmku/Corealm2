import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = 'assets/art/tripo/imports/creatures/audit-knights';
const out = 'test-results/creature-audit/promotions/knights.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const configs = [
  {
    folder: 'pearl', id: 'creature_pearl_knight', packId: 'corealm-tripo-audit-pearl-knight',
    packName: 'Corealm Tripo Pearl Knight', generator: `${base}/correct-death-floor.mjs`,
  },
  {
    folder: 'revenant', id: 'creature_revenant', packId: 'corealm-tripo-audit-waygrave-revenant',
    packName: 'Corealm Tripo Waygrave Revenant', generator: `${base}/correct-death-floor.mjs`,
  },
];
const packs = [], assets = [];
for (const config of configs) {
  const lab = JSON.parse(await readFile(`${base}/${config.folder}/lab-catalog.json`, 'utf8')).assets[0];
  const current = manifest.assets.find((asset) => asset.id === config.id);
  if (!current || !lab || lab.id !== config.id) throw new Error(`Missing ${config.id}`);
  const candidateFile = lab.candidateFile ?? lab.sourceProvenance.candidateFile;
  const bytes = await readFile(candidateFile);
  if (bytes.length !== lab.bytes || sha(bytes) !== lab.sha256) throw new Error(`${config.id} changed since staged catalogue`);
  const pack = {
    id: config.packId, name: config.packName, author: 'Corealm / Tripo Studio',
    source: config.generator, license: 'LicenseRef-Corealm-Original',
    generatorSha256: sha(await readFile(config.generator)),
  };
  packs.push(pack);
  const provenance = { ...lab.sourceProvenance, productionBeforeSha256: current.sha256 };
  if (config.folder === 'pearl') {
    const rigGeneratorFile = `${base}/pearl/build-candidate.mjs`;
    provenance.rigGeneratorFile = rigGeneratorFile;
    provenance.rigGeneratorSha256 = sha(await readFile(rigGeneratorFile));
  }
  if (config.folder === 'revenant') {
    const rigGeneratorFile = 'assets/art/tripo/imports/creatures/starred-revenant/build-candidate.mjs';
    const deathPoseFile = `${base}/revenant/pose-death.mjs`;
    provenance.rigGeneratorFile = rigGeneratorFile;
    provenance.rigGeneratorSha256 = sha(await readFile(rigGeneratorFile));
    provenance.deathPoseFile = deathPoseFile;
    provenance.deathPoseSha256 = sha(await readFile(deathPoseFile));
    provenance.eliteVariant = 'Pending: level-81 Revenant needs a stronger distinct undead visual variant.';
  }
  assets.push({
    ...lab,
    file: current.file,
    candidateFile,
    pack: pack.id,
    tags: lab.tags.filter((tag) => tag !== 'candidate'),
    impliedWalkMps: null,
    impliedRunMps: null,
    locomotionPolicy: null,
    sourceProvenance: provenance,
    metadata: {
      ...lab.metadata,
      ...(config.folder === 'revenant' ? { eliteVariantStatus: 'pending; current candidate repairs normal waygrave revenant only' } : {}),
    },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
  });
}
await writeFile(out, JSON.stringify({ schema: 'corealm-creature-promotion/1', packs, assets }, null, 2) + '\n');
console.log(JSON.stringify({ out, assets: assets.map((asset) => ({ id: asset.id, file: asset.file, sha256: asset.sha256, bytes: asset.bytes, pack: asset.pack })) }, null, 2));
