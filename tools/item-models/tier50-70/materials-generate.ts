import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createGrainMaps, type GrainKind } from './materials-textures.js';
import { imagegenCloth } from './materials-imagegen.js';

/** Rebuild with node --import tsx tools/item-models/tier50-70/materials-generate.ts.
 * The neutral albedo maps are tinted by materials.ts so scutes share their grain.
 */
const kinds: GrainKind[] = ['cloth', 'hide', 'metal', 'lining', 'sole'];
for (const theme of ['dragonhide', 'starhide'] as const) {
  const generatedCloth = await imagegenCloth(theme);
  const output = path.join('art/tier50-70/textures', theme);
  await mkdir(output, { recursive: true });
  const records = [];
  for (const kind of kinds) {
    const maps = kind === 'cloth' ? generatedCloth.maps : createGrainMaps(kind);
    for (const [suffix, texture] of [['color', maps.map], ['normal', maps.normalMap], ['roughness', maps.roughnessMap]] as const) {
      const file = `${kind}-${suffix}.png`;
      const png = await sharp(Buffer.from(texture.image.data as Uint8Array), {
        raw: { width: texture.image.width, height: texture.image.height, channels: 4 },
      }).png({ compressionLevel: 9 }).toBuffer();
      await writeFile(path.join(output, file), png);
      records.push({ file, width: texture.image.width, height: texture.image.height, sha256: createHash('sha256').update(png).digest('hex') });
    }
  }
  await writeFile(path.join(output, 'provenance.json'), `${JSON.stringify({
    generator: 'tools/item-models/tier50-70/materials-generate.ts',
    proceduralSource: 'tools/item-models/tier50-70/materials-textures.ts',
    pigmentSource: 'tools/item-models/tier50-70/materials.ts',
    reference: `art/item-icons/generated/${theme}_{robe,boots,hood}.png`,
    authorship: 'Cloth uses built-in imagegen embroidered textiles based on the user fabric reference. Other surfaces use original deterministic procedural grain. No item icon pixels are copied.',
    clothSource: generatedCloth.provenance,
    mapping: 'One UV unit is approximately 25 cm. Cloth uses imagegen dyed-yarn RGB albedo with a white material factor; other surfaces use neutral sRGB albedo multiplied by material pigment. Normals and roughness use linear byte values.',
    grain: 'Imagegen soft cloth nap and sparse celestial stitch normals, with metallic response confined to embroidery. Procedural hide pebbles and chased metal elsewhere. No emission.',
    files: records,
  }, null, 2)}\n`, 'utf8');
  console.log(`${theme}: ${records.length} reproducible PBR maps, imagegen cloth 2048px`);
}
