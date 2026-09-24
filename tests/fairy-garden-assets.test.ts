import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NodeIO, type Accessor, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, expect, test } from 'vitest';
import manifest from '../game/public/assets/manifest.json';
import { FAIRY_GARDEN_VARIANTS } from '../game/src/content/fairyGardenCreatures.js';
import { FAIRY_MINIBOSS_FORMS } from '../game/src/content/fairyMinibossForms.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function accessor(a: Accessor | null) {
  const array = a?.getArray();
  return a && array ? { type: a.getType(), normalized: a.getNormalized(), componentType: a.getComponentType(),
    count: a.getCount(), data: digest(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) } : null;
}
/** Paint is intentionally excluded; geometry, rig and animation must survive the regional bake. */
function structure(doc: Document) {
  const root = doc.getRoot(), nodes = root.listNodes(), meshes = root.listMeshes();
  return {
    materialResponse: root.listMaterials().map(m => ({ alphaMode: m.getAlphaMode(), alphaCutoff: m.getAlphaCutoff(),
      doubleSided: m.getDoubleSided(), roughness: m.getRoughnessFactor(), metallic: m.getMetallicFactor(),
      normalScale: m.getNormalScale(), normal: m.getNormalTexture()?.getImage() ? digest(m.getNormalTexture()!.getImage()!) : null,
      metalRough: m.getMetallicRoughnessTexture()?.getImage() ? digest(m.getMetallicRoughnessTexture()!.getImage()!) : null })),
    meshes: meshes.map(mesh => mesh.listPrimitives().map(p => ({ mode: p.getMode(), indices: accessor(p.getIndices()),
      attributes: Object.fromEntries(p.listSemantics().filter(s => !s.startsWith('COLOR_')).sort().map(s => [s, accessor(p.getAttribute(s))])),
      targets: p.listTargets().map(t => Object.fromEntries(t.listSemantics().sort().map(s => [s, accessor(t.getAttribute(s))]))),
    }))),
    nodes: nodes.map(n => ({ name: n.getName(), translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale(),
      mesh: meshes.indexOf(n.getMesh()!), children: n.listChildren().map(c => nodes.indexOf(c)) })),
    skins: root.listSkins().map(s => ({ joints: s.listJoints().map(n => nodes.indexOf(n)), matrices: accessor(s.getInverseBindMatrices()) })),
    animations: root.listAnimations().map(a => ({ name: a.getName(), channels: a.listChannels().map(c => ({
      node: nodes.indexOf(c.getTargetNode()!), path: c.getTargetPath(), interpolation: c.getSampler()!.getInterpolation(),
      input: accessor(c.getSampler()!.getInput()), output: accessor(c.getSampler()!.getOutput()),
    })) })),
  };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sources = new Map<string, ReturnType<typeof structure>>();
const variants = [...FAIRY_GARDEN_VARIANTS, ...FAIRY_MINIBOSS_FORMS];
const assets = manifest.assets as any[];
const entryOf = (id: string) => assets.find(a => a.id === id);
// Replaced bodies ship without a source claim, and polished assets (polishSourceFile) add
// meshes and retime clips on top of the repaint. Every remaining asset that claims to be a
// regional repaint of its form's source must keep that source's geometry, rig, UVs and animation.
const repaints = variants.filter(form => {
  const provenance = entryOf(form.assetId)?.sourceProvenance;
  return provenance?.sourceAssetId && !provenance.polishSourceFile;
});
beforeAll(async () => {
  await MeshoptDecoder.ready;
  io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  expect(variants).toHaveLength(30);
  expect(new Set(variants.map(f => f.assetId)).size).toBe(30);
  for (const form of variants) expect(entryOf(form.assetId), form.assetId).toBeDefined();
  expect(repaints.length).toBeGreaterThan(0);
});

test.each(repaints)('$assetId preserves source geometry, rig, UVs and generated artwork provenance', async (form) => {
    const entry = entryOf(form.assetId);
    const source = entryOf(form.source);
    expect(source, form.source).toBeDefined();
    const bytes = await readFile(`game/public/assets/${entry.file}`);
    const sourceBytes = await readFile(`game/public/assets/${source.file}`);
    expect(digest(bytes)).toBe(entry.sha256);
    expect(digest(sourceBytes)).toBe(source.sha256);
    expect(entry.sourceProvenance.sourceAssetId).toBe(source.id);
    expect(entry.sourceProvenance.sourceSha256).toBe(source.sha256);
    const artwork = entry.sourceProvenance.generatedTexture;
    expect(artwork, `${form.assetId}: authored UV artwork provenance`).toBeDefined();
    expect(digest(await readFile(artwork.file))).toBe(artwork.sha256);
    const painted = await io.readBinary(bytes);
    const textureHashes = painted.getRoot().listTextures().filter(t => t.getImage()).map(t => digest(t.getImage()!));
    expect(artwork.bindings.length).toBeGreaterThan(0);
    for (const binding of artwork.bindings) expect(textureHashes).toContain(binding.embeddedTextureSha256);
    if (!sources.has(source.id)) sources.set(source.id, structure(await io.read(`game/public/assets/${source.file}`)));
    expect(structure(painted), form.assetId).toEqual(sources.get(source.id));
});
