import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { readRawGlb } from '../repair-ground-creature-gaits.js';
import { authorRhinoHit, auditRhinoRecoil, measureRhinoAttackContact } from './rhino-contact.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const out = resolve('art/rebuild/candidates/finish-motion/rhino-contact');

/** Append samplers while retaining original buffers and exact node indices.
 * Rhino has duplicate bone names, so name-only remapping is forbidden. */
export function appendRhinoContact(source: Buffer, doc: Document, contactNormalized: number): Buffer {
  const raw = readRawGlb(source), json = structuredClone(raw.json), nodes = doc.getRoot().listNodes();
  if (nodes.length !== json.nodes.length || nodes.some((node, index) => node.getName() !== (json.nodes[index].name ?? '') || JSON.stringify(node.listChildren().map(child => nodes.indexOf(child))) !== JSON.stringify(json.nodes[index].children ?? []))) throw new Error('Rhino imported node index/hierarchy changed');
  const chunks = [raw.bin]; let length = raw.bin.length;
  const accessor = (values: ArrayLike<number>, type: string) => {
    const data = new Float32Array(Array.from(values));
    if (!data.every(Number.isFinite)) throw new Error('Nonfinite rhino sampler');
    const bytes = Buffer.from(data.buffer), width = type === 'SCALAR' ? 1 : type === 'VEC4' ? 4 : 3;
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); chunks.push(bytes); length += bytes.length;
    const index = json.accessors.length;
    json.accessors.push({ bufferView: viewIndex, componentType: 5126, count: data.length / width, type, ...(type === 'SCALAR' ? { min: [data[0]], max: [data[data.length - 1]] } : {}) });
    return index;
  };
  for (const name of ['Hit', 'HitLeft', 'HitRight']) {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!;
    const samplers: any[] = [], channels: any[] = [];
    for (const channel of clip.listChannels()) {
      const sampler = channel.getSampler()!, path = channel.getTargetPath();
      const index = samplers.length;
      samplers.push({ input: accessor(sampler.getInput()!.getArray()!, 'SCALAR'), output: accessor(sampler.getOutput()!.getArray()!, path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: index, target: { node: nodes.indexOf(channel.getTargetNode()!), path } });
    }
    const index = json.animations.findIndex((clip: any) => clip.name === name);
    if (index < 0) throw new Error(`Missing source ${name}`);
    json.animations[index] = { name, channels, samplers, extras: clip.getExtras() };
  }
  const attack = json.animations.find((clip: any) => clip.name === 'Attack');
  attack.extras = { ...attack.extras, contactNormalized, contactMeasurement: 'Forward physical head envelope, first strike peak following anticipation' };
  const bin = Buffer.concat(chunks); json.buffers[0].byteLength = bin.length;
  const text = Buffer.from(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4;
  const output = Buffer.alloc(28 + jsonLength + bin.length);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12); output.writeUInt32LE(0x4e4f534a, 16); output.fill(32, 20, 20 + jsonLength); text.copy(output, 20);
  output.writeUInt32LE(bin.length, 20 + jsonLength); output.writeUInt32LE(0x004e4942, 24 + jsonLength); bin.copy(output, 28 + jsonLength);
  return output;
}

async function main() {
  await mkdir(out, { recursive: true });
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS), manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
  const generator = await Promise.all(['tools/creature-motion/stage-rhino-contact.ts', 'tools/creature-motion/rhino-contact.ts', 'tools/creature-motion/profiles.ts', 'tools/creature-motion/pose.ts', 'tools/lib/ground-gait.ts'].map(async file => ({ file, sha256: sha(await readFile(file)) })));
  const rows = [];
  for (const id of ['boss_rhino_air', 'boss_rhino_earth', 'boss_rhino_water']) {
    const asset = manifest.assets.find((asset: any) => asset.id === id), sourceFile = resolve('game/public/assets', asset.file);
    const source = await readFile(sourceFile), doc = await io.readBinary(source), contact = measureRhinoAttackContact(doc);
    if (sha(source) !== asset.sha256.toLowerCase()) throw new Error(`${id} source differs from its manifest`);
    for (const side of [-1, 0, 1] as const) authorRhinoHit(doc, side);
    const bytes = appendRhinoContact(source, doc, contact.contactNormalized), restored = await io.readBinary(bytes);
    const audit = auditRhinoRecoil(restored), stagedFile = resolve(out, `${id}.glb`);
    if (!audit.passed) throw new Error(`${id} recoil contact audit failed: ${JSON.stringify(audit.clips)}`);
    await writeFile(stagedFile, bytes);
    const row = { id, sourceFile, stagedFile, sourceSha256: sha(source), sha256: sha(bytes), bytes: bytes.length, generator, offlinePassed: true, visualAccepted: false, promotable: false,
      setTiming: { seconds: contact.seconds, contactNormalized: contact.contactNormalized }, contact, audit,
      preserved: { originalBinPrefix: true, geometrySkinMaterialsHierarchy: true, idleWalkRunDeathClipJSONAndSamplers: true, attackSamplers: true } };
    await writeFile(resolve(out, `${id}.json`), JSON.stringify(row, null, 2)); rows.push(row);
    console.log(JSON.stringify({ id, contactNormalized: contact.contactNormalized, contactSeconds: contact.contactSeconds, recoil: audit.clips }));
  }
  await writeFile(resolve(out, 'manifest-updates.json'), JSON.stringify(rows.map(({ contact, audit, ...row }) => row), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
