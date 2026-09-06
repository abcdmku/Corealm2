import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { readRawGlb } from '../repair-ground-creature-gaits.js';
import { authorRhinoAttack, auditRhinoAttack } from './rhino-attack.js';
import { generatorFileSha256 } from './generator-hash.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function appendRhinoAttack(source: Buffer, doc: Document, contactNormalized: number): Buffer {
  const raw = readRawGlb(source), json = structuredClone(raw.json), nodes = doc.getRoot().listNodes();
  if (nodes.length !== json.nodes.length || nodes.some((node, i) => node.getName() !== (json.nodes[i].name ?? '')
    || JSON.stringify(node.listChildren().map(child => nodes.indexOf(child))) !== JSON.stringify(json.nodes[i].children ?? []))) throw new Error('Rhino node index/hierarchy changed');
  const chunks = [raw.bin]; let length = raw.bin.length;
  const accessor = (values: ArrayLike<number>, type: string) => {
    const data = new Float32Array(Array.from(values));
    if (!data.every(Number.isFinite)) throw new Error('Nonfinite attack channel');
    const bytes = Buffer.from(data.buffer), width = type === 'SCALAR' ? 1 : type === 'VEC4' ? 4 : 3;
    const view = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); chunks.push(bytes); length += bytes.length;
    const index = json.accessors.length;
    json.accessors.push({ bufferView: view, componentType: 5126, count: data.length / width, type,
      ...(type === 'SCALAR' ? { min: [data[0]], max: [data[data.length - 1]] } : {}) });
    return index;
  };
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
  const samplers: any[] = [], channels: any[] = [];
  for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler()!, targetPath = channel.getTargetPath();
    const index = samplers.length;
    samplers.push({ input: accessor(sampler.getInput()!.getArray()!, 'SCALAR'), output: accessor(sampler.getOutput()!.getArray()!, targetPath === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
    channels.push({ sampler: index, target: { node: nodes.indexOf(channel.getTargetNode()!), path: targetPath } });
  }
  const index = json.animations.findIndex((clip: any) => clip.name === 'Attack');
  if (index < 0) throw new Error('Source Attack missing');
  json.animations[index] = { name: 'Attack', channels, samplers, extras: { ...clip.getExtras(), contactNormalized,
    contactMeasurement: 'First weighted head crossing of explicit plane 6cm beyond Idle; production target review required' } };
  const bin = Buffer.concat(chunks); json.buffers[0].byteLength = bin.length;
  const text = Buffer.from(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4;
  const output = Buffer.alloc(28 + jsonLength + bin.length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12); output.writeUInt32LE(0x4e4f534a, 16); output.fill(32, 20, 20 + jsonLength); text.copy(output, 20);
  output.writeUInt32LE(bin.length, 20 + jsonLength); output.writeUInt32LE(0x004e4942, 24 + jsonLength); bin.copy(output, 28 + jsonLength);
  return output;
}
async function main() {
  const out = resolve('art/rebuild/candidates/finish-motion/rhino-attack'); await mkdir(out, { recursive: true });
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS), rows = [];
  const generator = await Promise.all(['tools/creature-motion/rhino-attack.ts', 'tools/creature-motion/stage-rhino-attack.ts',
    'tools/creature-motion/pose.ts', 'tools/lib/ground-gait.ts', 'tools/repair-ground-creature-gaits.ts'].map(async file => ({ file, sha256: await generatorFileSha256(file) })));
  for (const variant of ['air', 'earth', 'water']) {
    const id = `boss_rhino_${variant}`, sourceFile = resolve(`art/rebuild/candidates/finish-motion/rhino-contact/${id}.glb`);
    const source = await readFile(sourceFile), doc = await io.readBinary(source);
    authorRhinoAttack(doc); const first = auditRhinoAttack(doc);
    if (!first.passed || first.contactNormalized === null) throw new Error(`${id} authored audit failed: ${JSON.stringify({ ...first, samples: undefined, physicalSoles: undefined })}`);
    const bytes = appendRhinoAttack(source, doc, first.contactNormalized), restored = await io.readBinary(bytes), audit = auditRhinoAttack(restored);
    if (!audit.passed) throw new Error(`${id} serialized audit failed`);
    const stagedFile = resolve(out, `${id}.glb`); await writeFile(stagedFile, bytes);
    const row = { id, sourceFile, stagedFile, sourceSha256: sha(source), sha256: sha(bytes), bytes: bytes.length, generator,
      offlinePassed: true, visualAccepted: false, promotable: false, setTiming: { seconds: audit.seconds, contactNormalized: audit.contactNormalized },
      preserved: { sourceBinPrefix: true, restGeometrySkinMaterialsHierarchy: true, allNonAttackClips: true, repairedRecoil: true }, audit };
    rows.push(row); await writeFile(resolve(out, `${id}.json`), JSON.stringify(row, null, 2));
    console.log(JSON.stringify({ id, contact: audit.contactNormalized, soleM: audit.maximumSoleDisplacementM, headDisplacementM: audit.maximumHeadDisplacementM, recoveryM: audit.recoveryErrorM }));
  }
  await writeFile(resolve(out, 'manifest-updates.json'), JSON.stringify(rows.map(({ audit, ...row }) => row), null, 2));
  const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
  const assets = rows.map(row => {
    const original = manifest.assets.find((entry: any) => entry.id === row.id);
    if (!original) throw new Error(`Public manifest lacks ${row.id}`);
    return { ...original, sha256: row.sha256, bytes: row.bytes, candidateFile: `${row.id}.glb` };
  });
  await writeFile(resolve(out, 'catalog.json'), JSON.stringify({ assets,
    files: Object.fromEntries(rows.map(row => [row.id, `${row.id}.glb`])),
    sourceHashes: Object.fromEntries(rows.map(row => [row.id, manifest.assets.find((entry: any) => entry.id === row.id).sha256.toLowerCase()])),
    timingUpdates: Object.fromEntries(rows.map(row => [row.id, row.setTiming])),
    offlinePassed: true, visualAccepted: false, promotable: false,
    notes: 'Attack replaces collapsed source motion, retaining staged repaired recoil. Marker is an offline target-plane crossing; real player contact remains unaccepted.' }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
