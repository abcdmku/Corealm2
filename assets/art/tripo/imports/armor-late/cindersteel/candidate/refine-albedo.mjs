import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const scriptPath = fileURLToPath(import.meta.url);
const candidateDir = path.dirname(scriptPath);
const cataloguePath = path.join(candidateDir, 'catalogue.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const smoothstep = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

// This intentionally repeats the packed-map classifier so color and PBR share one mask.
function confidence(r, g, b) {
  const peak = Math.max(1, r, g, b);
  const light = (r + g + b) / 3;
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / peak;
  const redExcess = (r - g) / peak;
  return (1 - smoothstep(0.12, 0.23, chroma))
    * smoothstep(28, 50, light)
    * (1 - smoothstep(0.13, 0.26, redExcess));
}

function accessorHash(accessor) {
  const array = accessor?.getArray();
  if (!array) return null;
  return hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
}

function documentSignature(document) {
  const root = document.getRoot();
  const accessors = root.listAccessors().map(accessor => ({
    type: accessor.getType(), count: accessor.getCount(), normalized: accessor.getNormalized(), data: accessorHash(accessor),
  }));
  const nodes = root.listNodes().map(node => ({
    name: node.getName(), children: node.listChildren().map(child => child.getName()),
    mesh: node.getMesh()?.getName() ?? null, skin: node.getSkin()?.getName() ?? null,
    translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(), matrix: node.getMatrix(),
    extras: node.getExtras(),
  }));
  const meshes = root.listMeshes().map(mesh => ({
    name: mesh.getName(), primitives: mesh.listPrimitives().map(primitive => ({
      mode: primitive.getMode(), material: primitive.getMaterial()?.getName() ?? null,
      attributes: primitive.listSemantics().sort().map(semantic => [semantic, accessorHash(primitive.getAttribute(semantic))]),
      indices: accessorHash(primitive.getIndices()),
    })),
  }));
  const skins = root.listSkins().map(skin => ({
    name: skin.getName(), joints: skin.listJoints().map(joint => joint.getName()),
    skeleton: skin.getSkeleton()?.getName() ?? null, inverseBindMatrices: accessorHash(skin.getInverseBindMatrices()),
  }));
  const scenes = root.listScenes().map(scene => ({ name: scene.getName(), roots: scene.listChildren().map(node => node.getName()) }));
  const animations = root.listAnimations().map(animation => animation.getName());
  return JSON.stringify({ accessors, nodes, meshes, skins, scenes, animations });
}

async function rgb(image, label) {
  const decoded = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 3) throw new Error(`${label}: expected RGB pixels, found ${decoded.info.channels} channels`);
  return decoded;
}

function colorStats(rows) {
  if (!rows.length) return { count: 0 };
  const n = rows.length;
  const means = [0, 1, 2].map(channel => rows.reduce((sum, pixel) => sum + pixel[channel], 0) / n);
  const luma = rows.map(pixel => (pixel[0] + pixel[1] + pixel[2]) / 3).sort((a, b) => a - b);
  const at = fraction => luma[Math.round((n - 1) * fraction)];
  return {
    count: n,
    meanRgb: means.map(value => Number(value.toFixed(1))),
    meanLuma: Number((means.reduce((sum, value) => sum + value, 0) / 3).toFixed(1)),
    lumaP10P50P90: [at(0.1), at(0.5), at(0.9)].map(value => Number(value.toFixed(1))),
  };
}

async function liftSteel(baseImage) {
  const base = await rgb(baseImage, 'base-color atlas');
  assert.deepEqual([base.info.width, base.info.height], [1024, 1024], 'the source atlas must remain 1K');
  const beforeSteel = [], afterSteel = [], beforeWarm = [], afterWarm = [];
  const data = base.data;
  let coverage80 = 0, confidenceTotal = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mask = confidence(r, g, b);
    const light = (r + g + b) / 3;
    const peak = Math.max(1, r, g, b);
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / peak;
    const redExcess = (r - g) / peak;
    const blueMinusRed = (b - r) / peak;
    const targetLight = Math.max(92, Math.min(158, light + 42));
    const sourceChroma = [r - light, g - light, b - light];
    const target = [targetLight - 10, targetLight - 2, targetLight + 12];
    const updated = target.map((value, channel) => Math.round(Math.max(0, Math.min(255,
      data[i + channel] + (value + sourceChroma[channel] * 0.35 - data[i + channel]) * mask))));
    const before = [r, g, b];
    for (let channel = 0; channel < 3; channel++) data[i + channel] = updated[channel];
    const peakAfter = Math.max(1, ...updated);
    const lightAfter = (updated[0] + updated[1] + updated[2]) / 3;
    const chromaAfter = (Math.max(...updated) - Math.min(...updated)) / peakAfter;
    const blueMinusRedAfter = (updated[2] - updated[0]) / peakAfter;
    if (mask >= 0.8) coverage80++;
    confidenceTotal += mask;
    if (chroma < 0.2 && light >= 30 && blueMinusRed > -0.15) { beforeSteel.push(before); afterSteel.push(updated); }
    if (redExcess > 0.2 && light >= 20) { beforeWarm.push(before); afterWarm.push(updated); }
  }
  const png = await sharp(data, { raw: { width: base.info.width, height: base.info.height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const pixelCount = data.length / 3;
  return {
    png,
    stats: {
      size: [base.info.width, base.info.height],
      maskConfidenceMean: Number((confidenceTotal / pixelCount).toFixed(3)),
      maskCoverageAtLeast80: Number((coverage80 / pixelCount).toFixed(3)),
      steelBefore: colorStats(beforeSteel), steelAfter: colorStats(afterSteel),
      warmBefore: colorStats(beforeWarm), warmAfter: colorStats(afterWarm),
    },
  };
}

const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'));
assert.equal(catalogue.status, 'pending', 'only pending candidates may be refined');
assert.equal(catalogue.pbrRetune?.profile, 'masked-charcoal-iron-v1', 'the accepted steel PBR pass is required');
assert.equal(catalogue.albedoRefinement, undefined, 'this candidate has already received its single albedo refinement');
assert.equal(catalogue.assets.length, 5, 'expected all five fitted armor pieces');

const prepared = [];
let sourceMaps;
let stats;
for (const entry of catalogue.assets) {
  const file = path.resolve(candidateDir, entry.file);
  assert(file.startsWith(candidateDir + path.sep), `candidate path escaped its directory: ${entry.file}`);
  const originalBytes = await readFile(file);
  assert.equal(originalBytes.length, entry.bytes, `${entry.itemId}: stale candidate byte count`);
  assert.equal(hash(originalBytes), entry.sha256, `${entry.itemId}: stale candidate hash`);
  const document = await io.readBinary(originalBytes);
  const before = documentSignature(document);
  const baseTextures = new Set();
  let candidateBaseHash;
  let candidatePackedHash;
  let candidateNormalHash;
  for (const material of document.getRoot().listMaterials()) {
    const baseTexture = material.getBaseColorTexture();
    const packedTexture = material.getMetallicRoughnessTexture();
    const normalTexture = material.getNormalTexture();
    assert(baseTexture?.getImage() && packedTexture?.getImage() && normalTexture?.getImage(), `${entry.itemId}/${material.getName()}: PBR maps are missing`);
    candidateBaseHash = hash(baseTexture.getImage());
    candidatePackedHash = hash(packedTexture.getImage());
    candidateNormalHash = hash(normalTexture.getImage());
    if (!sourceMaps) sourceMaps = { candidateBase: candidateBaseHash, packed: candidatePackedHash, normal: candidateNormalHash };
    else assert.deepEqual({ candidateBase: candidateBaseHash, packed: candidatePackedHash, normal: candidateNormalHash }, sourceMaps, `${entry.itemId}: candidate atlases differ`);
    if (!baseTextures.has(baseTexture)) {
      const lifted = await liftSteel(baseTexture.getImage());
      baseTexture.setImage(lifted.png).setMimeType('image/png');
      baseTextures.add(baseTexture);
      stats ??= lifted.stats;
    }
  }
  const output = await io.writeBinary(document);
  const reopened = await io.readBinary(output);
  assert.equal(documentSignature(reopened), before, `${entry.itemId}: albedo edit changed geometry, UVs, or rig`);
  const postMaps = reopened.getRoot().listMaterials().map(material => ({
    base: hash(material.getBaseColorTexture()?.getImage()),
    packed: hash(material.getMetallicRoughnessTexture()?.getImage()),
    normal: hash(material.getNormalTexture()?.getImage()),
  }));
  assert(postMaps.every(map => map.packed === candidatePackedHash && map.normal === candidateNormalHash), `${entry.itemId}: PBR or normal image changed`);
  assert(postMaps.every(map => map.base === postMaps[0].base), `${entry.itemId}: inconsistent refined base-color maps`);
  prepared.push({ file, output, entry, baseColorSha256: postMaps[0].base, metallicRoughnessSha256: candidatePackedHash, normalSha256: candidateNormalHash, joints: reopened.getRoot().listSkins().map(skin => skin.listJoints().length) });
}
assert(sourceMaps && stats, 'no material atlases were processed');
assert.equal(sourceMaps.candidateBase, catalogue.pbrRetune.sourceMaps.baseColorSha256, 'base-color source must match the original atlas used by the steel mask');

for (const row of prepared) {
  await writeFile(row.file, row.output);
  row.entry.bytes = row.output.byteLength;
  row.entry.sha256 = hash(row.output);
}
const repoRoot = path.resolve(candidateDir, '../../../../../../..');
catalogue.albedoRefinement = {
  profile: 'cool-neutral-blackened-steel-lift-v1',
  generator: {
    file: path.relative(repoRoot, scriptPath).replaceAll('\\', '/'),
    sha256: hash(await readFile(scriptPath)),
  },
  sourceBaseColorSha256: sourceMaps.candidateBase,
  candidateBaseColorSha256: prepared[0].baseColorSha256,
  unchangedMetallicRoughnessSha256: sourceMaps.packed,
  unchangedNormalSha256: sourceMaps.normal,
  dimensions: stats.size,
  mask: {
    rule: catalogue.pbrRetune.mask.rule,
    method: 'lift mask-selected pixels toward a cool neutral slate target; preserve per-pixel light variation and 35% of the original chroma residual',
  },
  tone: { meanLift: 42, targetChannelBias: [-10, -2, 12], minimumMean: 92, maximumMean: 158, retainedChromaResidual: 0.35 },
  stats,
  geometryUvAndRigPreserved: prepared.every(row => row.joints.length === 1 && row.joints[0] === 65),
  rigJointCounts: Object.fromEntries(prepared.map(row => [row.entry.itemId, row.joints])),
};
await writeFile(cataloguePath, JSON.stringify(catalogue, null, 2) + '\n');
console.log(JSON.stringify({ profile: catalogue.albedoRefinement.profile, sourceBaseColorSha256: sourceMaps.candidateBase, candidateBaseColorSha256: prepared[0].baseColorSha256, unchangedMetallicRoughnessSha256: sourceMaps.packed, unchangedNormalSha256: sourceMaps.normal, stats, candidates: prepared.map(({ entry, joints }) => ({ itemId: entry.itemId, bytes: entry.bytes, sha256: entry.sha256, joints })) }, null, 2));
