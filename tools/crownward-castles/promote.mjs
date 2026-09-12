/** Promote only after the root supplies a passing browser acceptance report. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '../..');
const stagedRoot = path.join(repositoryRoot, 'test-results/crownward-castles');
const productionRoot = path.join(repositoryRoot, 'game/public/assets');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function argument(name) {
  const exact = process.argv.indexOf(name);
  if (exact >= 0) return process.argv[exact + 1];
  return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function glbTail(bytes, label) {
  assert(bytes.length >= 28 && bytes.toString('ascii', 0, 4) === 'glTF', `${label}: expected GLB`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label}: expected GLB 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label}: incomplete GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const tailOffset = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${label}: expected JSON-first GLB`);
  assert.equal(bytes.readUInt32LE(tailOffset + 4), 0x004e4942, `${label}: expected embedded BIN`);
  return bytes.subarray(tailOffset);
}

const evidenceArgument = argument('--evidence');
assert(evidenceArgument, 'Usage: node tools/crownward-castles/promote.mjs --evidence <passing-report.json>');
const evidencePath = path.resolve(repositoryRoot, evidenceArgument);
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
assert.equal(evidence.passed, true, `${evidenceArgument}: acceptance report did not pass`);

const [catalogBytes, provenanceBytes, manifestBytes] = await Promise.all([
  readFile(path.join(directory, 'catalog.json')),
  readFile(path.join(directory, 'provenance.json')),
  readFile(path.join(productionRoot, 'manifest.json')),
]);
const catalog = JSON.parse(catalogBytes);
const provenance = JSON.parse(provenanceBytes);
const manifest = JSON.parse(manifestBytes);
const ids = new Set(['crownward_premade_fortress', 'crownward_premade_castle']);
assert.deepEqual(new Set(catalog.assets.map(asset => asset.id)), ids, 'catalog candidate IDs changed');
assert.deepEqual(new Set(catalog.packs.map(pack => pack.id)), new Set([
  'creative-trio-fortress-source-glb',
  'creative-trio-castle-source-glb',
]), 'catalog source-pack IDs changed');
assert.deepEqual(provenance.packs, catalog.packs, 'catalog and provenance pack metadata differ');
for (const pack of catalog.packs) {
  const asset = catalog.assets.find(entry => entry.pack === pack.id);
  const source = provenance.assets.find(entry => entry.id === asset?.id);
  assert(asset && source, `${pack.id}: no matching source asset`);
  assert.equal(pack.author, 'CreativeTrio');
  assert.equal(pack.license, 'CC0-1.0');
  assert.equal(pack.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(pack.source, source.sourcePage, `${pack.id}: source page differs from asset provenance`);
  assert.equal(pack.directDownload, source.directDownload, `${pack.id}: direct URL differs from asset provenance`);
  assert.equal(pack.sourcePath, source.sourceFile, `${pack.id}: source path differs from asset provenance`);
  assert.equal(pack.archiveSha256, source.sourceSha256, `${pack.id}: archive SHA differs from downloaded GLB`);
  assert(/^[a-f0-9]{64}$/.test(pack.archiveSha256), `${pack.id}: invalid archive SHA-256`);
}
assert.equal(provenance.sourceGlbsPreservedByteForByte, true);
assert.equal(provenance.candidateGeometryAndPalettePreserved, true);
assert.equal(catalog.generator.generatorSha256, sha256(await readFile(path.join(directory, 'build.mjs'))), 'stale build generator hash');

const acceptedIds = evidence.acceptedCandidateIds ?? evidence.candidateIds ?? evidence.catalogIds;
assert(Array.isArray(acceptedIds), `${evidenceArgument}: candidate IDs are required`);
for (const id of ids) assert(acceptedIds.includes(id), `${evidenceArgument}: ${id} was not accepted`);

const checked = [];
for (const asset of catalog.assets) {
  assert(/^models\/crownward-castles\/crownward_premade_(fortress|castle)\.glb$/.test(asset.file), `${asset.id}: unexpected production target`);
  const provenanceEntry = provenance.assets.find(entry => entry.id === asset.id);
  assert(provenanceEntry, `${asset.id}: missing provenance`);
  const sourcePath = path.join(repositoryRoot, provenanceEntry.sourceFile);
  const stagedPath = path.resolve(directory, catalog.files[asset.id]);
  const [source, staged] = await Promise.all([readFile(sourcePath), readFile(stagedPath)]);
  assert.equal(source.length, provenanceEntry.sourceBytes, `${asset.id}: source bytes changed`);
  assert.equal(sha256(source), provenanceEntry.sourceSha256, `${asset.id}: source SHA changed`);
  assert.equal(staged.length, asset.bytes, `${asset.id}: candidate bytes changed`);
  assert.equal(sha256(staged), asset.sha256, `${asset.id}: candidate SHA changed`);
  assert.equal(sha256(glbTail(source, `${asset.id} source`)), provenanceEntry.sourceBinChunkSha256, `${asset.id}: source BIN changed`);
  assert.equal(sha256(glbTail(staged, `${asset.id} candidate`)), provenanceEntry.stagedBinChunkSha256, `${asset.id}: candidate BIN changed`);
  assert.equal(provenanceEntry.sourceBinChunkSha256, provenanceEntry.stagedBinChunkSha256, `${asset.id}: normalization changed mesh or palette bytes`);
  checked.push({ asset, staged });
}

await mkdir(path.join(productionRoot, 'models/crownward-castles'), { recursive: true });
for (const { asset, staged } of checked) {
  asset.acceptance = { ...asset.acceptance, labAccepted: true,
    worldIntegrated: process.argv.includes('--integrated'),
    evidence: path.relative(repositoryRoot, evidencePath).replaceAll('\\', '/') };
  await writeFile(path.join(productionRoot, asset.file), staged);
  const index = manifest.assets.findIndex(entry => entry.id === asset.id);
  if (index < 0) manifest.assets.push(asset);
  else manifest.assets[index] = asset;
}
for (const pack of catalog.packs) {
  const packIndex = manifest.packs.findIndex(entry => entry.id === pack.id);
  if (packIndex < 0) manifest.packs.push(pack);
  else manifest.packs[packIndex] = pack;
}
const obsoletePackIds = new Set(['creative-trio-architecture-pack-001']);
manifest.packs = manifest.packs.filter(pack => !obsoletePackIds.has(pack.id)
  || manifest.assets.some(asset => asset.pack === pack.id));
await writeFile(path.join(productionRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  promoted: checked.map(row => row.asset.id),
  packs: catalog.packs.map(pack => pack.id),
  evidence: path.relative(repositoryRoot, evidencePath).replaceAll('\\', '/'),
  target: 'game/public/assets/models/crownward-castles',
}, null, 2));
