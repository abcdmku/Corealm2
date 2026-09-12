import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const scriptPath = fileURLToPath(import.meta.url);
const catalogDirectory = dirname(scriptPath);
const repositoryRoot = resolve(catalogDirectory, '../..');
const assetDirectory = resolve(repositoryRoot, 'game/public/assets');
const reportDirectory = resolve(repositoryRoot, 'test-results/fairy-crown-creatures');
const expectedVariants = 12;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const arrayBytes = (array) => array
  ? Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  : Buffer.alloc(0);

function equal(errors, label, actual, expected) {
  if (!isDeepStrictEqual(actual, expected)) errors.push(label);
}

function textureBindings(value, path = '', result = {}) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (/Texture$/.test(key)) result[nextPath] = child;
    else textureBindings(child, nextPath, result);
  }
  return result;
}

function materialAppearance(material) {
  const { name, extras, ...appearance } = material;
  return appearance;
}

/** Compare decoded assets; resource URIs may change when textures are embedded. */
export async function compareDocuments(source, target) {
  // GLB serialization groups accessors by buffer usage. Normalize that ordering
  // before comparing indexed bytes, including sources with several buffers.
  source = await io.readJSON(await io.writeJSON(source));
  target = await io.readJSON(await io.writeJSON(target));
  const errors = [];
  const sourceRoot = source.getRoot();
  const targetRoot = target.getRoot();
  const sourceAccessors = sourceRoot.listAccessors();
  const targetAccessors = targetRoot.listAccessors();
  equal(errors, 'accessor count changed', targetAccessors.length, sourceAccessors.length);

  const accessorHashes = [];
  let accessorBytes = 0;
  for (let index = 0; index < sourceAccessors.length; index++) {
    const before = sourceAccessors[index];
    const after = targetAccessors[index];
    if (!after) continue;
    const beforeBytes = arrayBytes(before.getArray());
    const afterBytes = arrayBytes(after.getArray());
    accessorBytes += beforeBytes.length;
    accessorHashes.push(sha256(beforeBytes));
    if (!beforeBytes.equals(afterBytes)) errors.push(`accessor ${index} bytes changed`);
    for (const method of ['getName', 'getType', 'getComponentType', 'getNormalized', 'getCount', 'getSparse']) {
      equal(errors, `accessor ${index} ${method} changed`, after[method](), before[method]());
    }
    equal(errors, `accessor ${index} minimum bounds changed`, after.getMin([]), before.getMin([]));
    equal(errors, `accessor ${index} maximum bounds changed`, after.getMax([]), before.getMax([]));
  }

  // Both documents pass through the same writer so property references become
  // comparable indices even when the original GLB packed its buffers differently.
  const beforeJson = (await io.writeJSON(source)).json;
  const afterJson = (await io.writeJSON(target)).json;
  for (const key of ['nodes', 'meshes', 'skins', 'animations', 'scenes', 'scene', 'cameras']) {
    equal(errors, `${key} changed`, afterJson[key], beforeJson[key]);
  }
  // Mesh JSON includes primitive mode, indices, attributes, morph targets and
  // material assignments. Skin JSON includes joints, skeleton and bind matrices.
  // Animation JSON includes clip names, sampler interpolation and channel targets.
  for (const key of ['samplers', 'textures']) {
    equal(errors, `${key} changed`, afterJson[key], beforeJson[key]);
  }

  const sourceTextures = sourceRoot.listTextures();
  const targetTextures = targetRoot.listTextures();
  equal(errors, 'texture count changed', targetTextures.length, sourceTextures.length);
  const textureHashes = [];
  for (let index = 0; index < sourceTextures.length; index++) {
    const before = sourceTextures[index];
    const after = targetTextures[index];
    if (!after) continue;
    const beforeBytes = arrayBytes(before.getImage());
    const afterBytes = arrayBytes(after.getImage());
    textureHashes.push(sha256(beforeBytes));
    if (!beforeBytes.equals(afterBytes)) errors.push(`texture ${index} image bytes changed`);
    equal(errors, `texture ${index} MIME type changed`, after.getMimeType(), before.getMimeType());
    equal(errors, `texture ${index} dimensions changed`, after.getSize(), before.getSize());
  }

  const sourceMaterials = beforeJson.materials ?? [];
  const targetMaterials = afterJson.materials ?? [];
  equal(errors, 'material count changed', targetMaterials.length, sourceMaterials.length);
  equal(errors, 'material texture bindings changed', textureBindings(targetMaterials), textureBindings(sourceMaterials));
  const changedMaterials = sourceMaterials.flatMap((material, index) => {
    const targetMaterial = targetMaterials[index];
    return targetMaterial && !isDeepStrictEqual(materialAppearance(material), materialAppearance(targetMaterial))
      ? [material.name || `material ${index}`]
      : [];
  });
  if (!changedMaterials.length) errors.push('no material appearance changed');

  return {
    errors,
    accessors: sourceAccessors.length,
    accessorBytes,
    accessorSha256: sha256(Buffer.from(accessorHashes.join('\n'))),
    nodes: sourceRoot.listNodes().length,
    meshes: sourceRoot.listMeshes().length,
    skins: sourceRoot.listSkins().length,
    animations: sourceRoot.listAnimations().map((animation) => animation.getName()),
    textures: sourceTextures.length,
    textureSha256: textureHashes,
    changedMaterials,
  };
}

async function checkAsset(asset, catalog, manifest) {
  const errors = [];
  const metadata = asset.metadata?.fairyCrownVariant;
  if (!metadata) throw new Error('missing metadata.fairyCrownVariant');
  const sourceAsset = manifest.assets.find((candidate) => candidate.id === metadata.sourceAssetId);
  if (!sourceAsset) throw new Error(`source asset ${metadata.sourceAssetId} is absent from manifest`);
  const targetRelativePath = catalog.files?.[asset.id];
  if (typeof targetRelativePath !== 'string') throw new Error('catalog.files is missing the asset path');
  const sourcePath = resolve(assetDirectory, sourceAsset.file);
  const targetPath = resolve(catalogDirectory, targetRelativePath);
  equal(errors, 'target path differs from asset file', targetPath, resolve(assetDirectory, asset.file));
  equal(errors, 'variant preservation declaration missing', metadata.geometrySkinMotionUnchanged, true);
  equal(errors, 'unexpected generator', metadata.generator, 'tools/fairy-crown-creatures/build.mjs');
  const [sourceBytes, targetBytes] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
  const sourceHash = sha256(sourceBytes);
  const targetHash = sha256(targetBytes);
  equal(errors, 'source manifest SHA does not match file', sourceAsset.sha256, sourceHash);
  equal(errors, 'variant source SHA does not match file', metadata.sourceSha256, sourceHash);
  equal(errors, 'variant SHA does not match file', asset.sha256, targetHash);
  equal(errors, 'variant byte count does not match file', asset.bytes, targetBytes.length);
  if (targetHash === sourceHash) errors.push('derived GLB is byte-identical to source');
  for (const key of ['size', 'base', 'groundY', 'triangles', 'animations', 'materials', 'walkClipSeconds', 'runClipSeconds', 'attackSeconds', 'contactNormalized']) {
    equal(errors, `catalog ${key} changed`, asset[key], sourceAsset[key]);
  }
  const [sourceDocument, targetDocument] = await Promise.all([io.read(sourcePath), io.read(targetPath)]);
  const comparison = await compareDocuments(sourceDocument, targetDocument);
  return {
    id: asset.id,
    sourceAssetId: sourceAsset.id,
    sourceSha256: sourceHash,
    targetSha256: targetHash,
    targetBytes: targetBytes.length,
    ...comparison,
    errors: [...errors, ...comparison.errors],
  };
}

async function main() {
  const catalog = JSON.parse(await readFile(resolve(catalogDirectory, 'catalog.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(assetDirectory, 'manifest.json'), 'utf8'));
  const errors = [];
  const assets = catalog.assets;
  if (!Array.isArray(assets)) throw new Error('catalog.assets must be an array');
  equal(errors, 'unexpected variant count', assets.length, expectedVariants);
  equal(errors, 'duplicate asset IDs', new Set(assets.map((asset) => asset.id)).size, assets.length);
  const results = [];
  // Keep large source documents bounded to one pair at a time.
  for (const asset of assets) {
    try {
      const result = await checkAsset(asset, catalog, manifest);
      results.push(result);
      console.log(`${result.errors.length ? 'FAIL' : 'PASS'} ${asset.id}: ${result.accessors} accessors, ${result.animations.length} clips, ${result.changedMaterials.length} material changes`);
      for (const error of result.errors.slice(0, 12)) console.error(`  ${error}`);
      if (result.errors.length > 12) console.error(`  ${result.errors.length - 12} more errors in the report`);
    } catch (error) {
      results.push({ id: asset.id, errors: [error.message] });
      console.error(`FAIL ${asset.id}: ${error.message}`);
    }
  }
  const failedAssets = results.filter((result) => result.errors.length).length;
  const report = {
    generatedAt: new Date().toISOString(),
    passed: errors.length === 0 && failedAssets === 0,
    expectedVariants,
    checkedVariants: results.length,
    failedAssets,
    errors,
    assets: results,
  };
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(resolve(reportDirectory, 'reskin-integrity.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const error of errors) console.error(`FAIL ${error}`);
  console.log(`${report.passed ? 'PASS' : 'FAIL'} fairy/crown material-only integrity: ${results.length - failedAssets}/${results.length} assets. Report: test-results/fairy-crown-creatures/reskin-integrity.json`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`FAIL fairy/crown material-only integrity: ${error.message}`);
    process.exitCode = 1;
  });
}
