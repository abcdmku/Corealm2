import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../../../../test-results/creature-expansion/sources/monsters/nightmare/', import.meta.url));
const textures = path.join(source, 'raw/Assets/FourEvilDragonsPBR/Texture/DragonNightmare/Albino');
const output = path.join(source, 'textures');
await mkdir(output, { recursive: true });
const ao = await sharp(path.join(textures, 'AO.png')).raw().toBuffer({ resolveWithObject: true });
const metal = await sharp(path.join(textures, 'Metallic.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (ao.info.width !== metal.info.width || ao.info.height !== metal.info.height) throw new Error('Nightmare texture sizes differ');
const packed = Buffer.alloc(ao.info.width * ao.info.height * 3);
for (let pixel = 0; pixel < packed.length / 3; pixel++) {
  packed[pixel * 3] = ao.data[pixel * ao.info.channels];
  packed[pixel * 3 + 1] = 255 - metal.data[pixel * 4 + 3];
  packed[pixel * 3 + 2] = metal.data[pixel * 4];
}
await sharp(packed, { raw: { width: ao.info.width, height: ao.info.height, channels: 3 } })
  .png().toFile(path.join(output, 'Albino_ORM.png'));
console.log(JSON.stringify({ file: path.join(output, 'Albino_ORM.png'), width: ao.info.width, height: ao.info.height,
  channels: 'R = source AO; G = 1 - source metallic alpha smoothness; B = source metallic red' }));
