import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeIO, type Accessor, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, expect, test } from 'vitest';
import manifest from '../game/public/assets/manifest.json';
import { FAIRY_GARDEN_VARIANTS } from '../game/src/content/fairyGardenCreatures.js';
import { FAIRY_MINIBOSS_FORMS } from '../game/src/content/fairyMinibossForms.js';
import { fairyArtwork, stageFairyPopulationAssets, verifyFairyArtworkBindings } from '../tools/fairy-population-assets.js';

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
// Replaced and polished bodies have independent geometry. Motion repairs carry separate
// source pins and validation; they no longer claim identical clips to the historical form.
// Untouched regional repaints still retain the complete original source structure.
const repaints = variants.filter(form => {
  const entry = entryOf(form.assetId), provenance = entry?.sourceProvenance;
  return provenance?.sourceAssetId && !provenance.polishSourceFile && !entry.motionRepair;
});

test('rejects retired fairy atlases even when historical source bodies remain available', async () => {
  for (const id of ['fairy_garden_imp_gloamgarden', 'fairy_garden_reliquary_faeholme', 'fairy_garden_petalguard_gloamgarden']) {
    const form = variants.find(variant => variant.assetId === id)!;
    expect(entryOf(form.source), 'the retired source still exists, so a fallback would silently restore it').toBeDefined();
    expect(() => fairyArtwork(entryOf(id))).toThrow('the current body does not own');
    await expect(stageFairyPopulationAssets({ only: [id] })).rejects.toThrow('historical form source and atlas are retired');
  }
});

test('requires the claimed artwork to be bound to a current base-color material', async () => {
  const entry = entryOf('fairy_guardian_02_gloamgarden');
  const doc = await io.read(`game/public/assets/${entry.file}`);
  expect(() => verifyFairyArtworkBindings(entry, doc)).not.toThrow();
  const wrongBinding = structuredClone(entry);
  wrongBinding.sourceProvenance.generatedTexture.bindings[0].embeddedTextureSha256 = '0'.repeat(64);
  expect(() => verifyFairyArtworkBindings(wrongBinding, doc)).toThrow('no longer matches the current material');
  const wrongAtlas = structuredClone(entry);
  wrongAtlas.sourceProvenance.generatedTexture.file = 'art/fairy-population/textures/generated/fairy_garden_imp_faeholme.png';
  expect(() => fairyArtwork(wrongAtlas)).toThrow('the current body does not own');
});

test('stages the current variant bytes, including later polish, without retired lab aliases', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'corealm-fairy-artwork-'));
  try {
    const id = 'fairy_garden_frog_faeholme', entry = entryOf(id);
    expect(entry.sourceProvenance.polishSourceFile).toBeDefined();
    const result = await stageFairyPopulationAssets({ only: [id], output });
    expect(result.staged).toEqual([id]);
    const catalog = JSON.parse(await readFile(result.catalogFile, 'utf8'));
    expect(catalog.assets).toHaveLength(1);
    expect(catalog.visualAccepted).toBe(false);
    expect(catalog.promotable).toBe(false);
    expect(await readFile(path.join(output, catalog.files[id]))).toEqual(await readFile(`game/public/assets/${entry.file}`));
    expect(catalog.assets[0].sha256).toBe(entry.sha256);
    expect(await readdir(output)).toEqual(['candidates.json', 'models']);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
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
