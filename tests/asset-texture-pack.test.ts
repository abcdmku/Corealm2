import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, it } from 'vitest';
import { packAssetTextures, type PackedImage } from '../tools/lib/asset-texture-pack.js';

function canonical(glb: Buffer, file: string, images: PackedImage[]) {
  const length = glb.readUInt32LE(12), json = JSON.parse(glb.toString('utf8', 20, 20 + length));
  const binary = glb.subarray(28 + length), views = json.bufferViews;
  const viewData = (index: number) => {
    const view = views[index], { buffer: _buffer, byteOffset: _offset, ...properties } = view;
    return { ...properties, hash: createHash('sha256').update(binary.subarray(view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength)).digest('hex') };
  };
  for (const image of json.images ?? []) {
    if (image.bufferView !== undefined) { image.contentHash = viewData(image.bufferView).hash; delete image.bufferView; }
    else if (image.uri && !image.uri.startsWith('data:')) {
      const external = images.find(row => row.file === path.posix.normalize(path.posix.join(path.posix.dirname(file), image.uri)));
      if (external) { image.contentHash = createHash('sha256').update(external.bytes).digest('hex'); delete image.uri; }
    }
  }
  delete json.buffers; delete json.bufferViews;
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (Number.isInteger(value.bufferView)) value.bufferView = viewData(value.bufferView);
    for (const child of Object.values(value)) walk(child);
  };
  walk(json); return json;
}

it('preserves every referenced geometry, animation, skin, material and texture byte when repacking production assets', () => {
  for (const file of ['assets/models/corealm/nature/corealm_oak_1.glb',
    'assets/models/corealm/nature/corealm_oak_2.glb', 'assets/models/creature/creature_cairn_treader.glb']) {
    const input = readFileSync(path.join('game/public', file)), packed = packAssetTextures(input, file);
    expect(packed.images.length).toBeGreaterThan(0);
    expect(packed.glb.readUInt32LE(8)).toBe(packed.glb.length);
    expect(canonical(packed.glb, file, packed.images)).toEqual(canonical(input, file, []));
    const again = packAssetTextures(packed.glb, file);
    expect(again.glb).toEqual(packed.glb); expect(again.images).toEqual([]);
  }
});

it('uses the same image URLs for duplicate textures in different models and keeps deployment paths relative', () => {
  const pack = (name: string) => packAssetTextures(readFileSync(`game/public/assets/models/corealm/nature/${name}.glb`),
    `assets/models/corealm/nature/${name}.glb`);
  const a = pack('corealm_oak_1'), b = pack('corealm_oak_2');
  expect(a.images.map(image => image.file)).toEqual(b.images.map(image => image.file));
  expect(a.images.map(image => image.bytes)).toEqual(b.images.map(image => image.bytes));
  expect(a.glb.toString('utf8').includes('../../../shared-textures/')).toBe(true);
});
