import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

/**
 * Rename the Khronos Fox's native resting clip from `Survey` to `Idle`.
 *
 * The production renderer resolves an asset's own idle clip through OWN_CLIP_PATTERNS, whose idle
 * row is /^idle/i, /^flying/i and /_?closed$/i. `Survey` matches none of them and only plays because
 * the idle row falls through to "any remaining clip in manifest order" and Survey happens to be
 * first. Every other creature-expansion species ships a clip literally called `Idle`; matching that
 * convention removes the dependence on clip ordering without touching the shared renderer.
 *
 * This is a JSON-chunk-only patch. The BIN chunk is copied byte for byte, so every accessor,
 * vertex, weight and animation sampler is bit-identical and the paw audit result carries over.
 *
 * Usage: node rename-idle.mjs <input.glb> <output.glb>
 */
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: rename-idle.mjs <input.glb> <output.glb>');
const bytes = await readFile(input);
const hash = b => createHash('sha256').update(b).digest('hex');
if (bytes.readUInt32LE(0) !== 0x46546c67) throw Error('Not a GLB');

const jsonLength = bytes.readUInt32LE(12);
if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('First chunk is not JSON');
const jsonStart = 20, jsonEnd = jsonStart + jsonLength;
const bin = bytes.subarray(jsonEnd);
if (bin.readUInt32LE(4) !== 0x004e4942) throw Error('Second chunk is not BIN');

const gltf = JSON.parse(bytes.toString('utf8', jsonStart, jsonEnd));
const clip = gltf.animations?.find(a => a.name === 'Survey');
if (!clip) throw Error('No Survey animation to rename');
if (gltf.animations.some(a => a.name === 'Idle')) throw Error('An Idle animation already exists');
clip.name = 'Idle';

let json = Buffer.from(JSON.stringify(gltf), 'utf8');
if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const out = Buffer.concat([header, json, bin]);
await writeFile(output, out);
console.log(JSON.stringify({
  input, inputSha256: hash(bytes), inputBytes: bytes.length,
  output, outputSha256: hash(out), outputBytes: out.length,
  binChunkIdentical: hash(bin) === hash(bytes.subarray(jsonEnd)),
  clips: gltf.animations.map(a => a.name),
}, null, 1));
