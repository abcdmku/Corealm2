import { NodeIO } from '@gltf-transform/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = 'art/rebuild/candidates/finish-cave-source', sourceRoot = `${root}/v6`, outputRoot = `${root}/v7`;
const io = new NodeIO(), document = await io.read(`${sourceRoot}/models/cave/rock-face-01.glb`);
document.getRoot().listScenes()[0]!.setExtras({ caveContinuousEnvelope: true, caveDomainWarp: { columns: 64, rows: 56 } });
const bytes = await io.writeBinary(document), previous = JSON.parse(await readFile(`${sourceRoot}/catalog.json`, 'utf8'));
const asset = { ...previous.assets[0], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
await mkdir(`${outputRoot}/models/cave`, { recursive: true });
await writeFile(`${outputRoot}/${asset.file}`, bytes);
await writeFile(`${outputRoot}/catalog.json`, JSON.stringify({ ...previous, assets: [asset] }, null, 2));
await writeFile(`${outputRoot}/provenance.json`, JSON.stringify({ source: '../v6/provenance.json', sourceSha256: previous.assets[0].sha256,
  method: 'V6 source-derived periodic relief geometry unchanged. Scene metadata selects continuous global sampling-coordinate warp at runtime. No independent panel offsets or added geometric noise. Amplitude remains inside original source bounds.', derived: asset }, null, 2));
console.log(JSON.stringify(asset));
