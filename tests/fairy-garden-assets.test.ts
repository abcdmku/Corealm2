import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NodeIO, type Accessor, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { beforeAll, expect, test } from 'vitest';
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

let manifest: any;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sources = new Map<string, ReturnType<typeof structure>>();
const variants = [...FAIRY_GARDEN_VARIANTS, ...FAIRY_MINIBOSS_FORMS];
beforeAll(async () => {
  manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
  expect(variants).toHaveLength(30);
  expect(new Set(variants.map(f => f.assetId)).size).toBe(30);
});

test.each(variants)('$assetId preserves source geometry, rig, UVs and generated artwork provenance', async (form) => {
    const entry = manifest.assets.find((a: any) => a.id === form.assetId);
    const source = manifest.assets.find((a: any) => a.id === form.source);
    expect(entry, form.assetId).toBeDefined();
    expect(source, form.source).toBeDefined();
    const bytes = await readFile(`game/public/assets/${entry.file}`);
    const sourceBytes = await readFile(`game/public/assets/${source.file}`);
    expect(digest(bytes)).toBe(entry.sha256);
    expect(digest(sourceBytes)).toBe(source.sha256);
    expect(entry.sourceProvenance.sourceAssetId).toBe(source.id);
    expect(entry.sourceProvenance.sourceSha256).toBe(source.sha256);
    expect(entry.sourceProvenance.modifications).toContain('vertex-color');
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
