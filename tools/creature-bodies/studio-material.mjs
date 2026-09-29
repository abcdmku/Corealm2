/**
 * A glTF metallic-roughness material from a studio's own Unity texture set. Texture-only: the maps
 * are resized and repacked, never repainted.
 *
 * Unity Standard stores smoothness in the alpha of the metallic (or specular) map; glTF wants
 * roughness in G and metalness in B of one map, so they are packed with the AO in R (ORM). Unity
 * normal maps are OpenGL tangent space like glTF. FBX UVs address the image bottom-up, so every
 * image is flipped vertically to match the UVs the GLTFExporter writes.
 */
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {mkdirSync, existsSync} from 'node:fs';
import path from 'node:path';

const CACHE = 'test-results/creature-bodies/cache';

/** sharp cannot read TGA; convert once through Pillow into a PNG cache. */
function readable(file) {
  if (!/\.tga$/i.test(file)) return file;
  mkdirSync(CACHE, {recursive: true});
  const out = path.join(CACHE, `${path.basename(path.dirname(file))}_${path.basename(file, path.extname(file))}.png`);
  if (!existsSync(out)) execFileSync('py', ['-3', '-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2])', file, out]);
  return out;
}

const image = (file, size) => sharp(readable(file)).flip().resize(size, size, {fit: 'fill'});

async function channel(file, index, size) {
  const {data, info} = await image(file, size).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const out = Buffer.alloc(size * size);
  for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels + index];
  return out;
}

/**
 * @param doc gltf-transform Document
 * @param {object} set
 *   name, albedo, normal, normalScale?, occlusion?, emission?, emissiveFactor?,
 *   smoothness?: {file, channel (0-3), scale?}  (Unity _MetallicGlossMap / _SpecGlossMap alpha)
 *   metallic?: {file, channel}                  (omit for specular-workflow sets: dielectric)
 *   roughness? constant when no smoothness map; albedoSize (2048), mapSize (1024)
 */
export async function studioMaterial(doc, set) {
  const albedoSize = set.albedoSize ?? 2048, mapSize = set.mapSize ?? 1024;
  const texture = (name, bytes, mime) => doc.createTexture(`${set.name}_${name}`).setImage(new Uint8Array(bytes)).setMimeType(mime);
  const material = doc.createMaterial(set.name).setMetallicFactor(set.metallic ? 1 : 0).setRoughnessFactor(set.smoothness ? 1 : (set.roughness ?? 0.8));
  material.setBaseColorTexture(texture('albedo', await image(set.albedo, albedoSize).removeAlpha().jpeg({quality: 90}).toBuffer(), 'image/jpeg'));
  if (set.normal) {
    material.setNormalTexture(texture('normal', await image(set.normal, mapSize).removeAlpha().png().toBuffer(), 'image/png'));
    if (set.normalScale) material.setNormalScale(set.normalScale);
  }
  if (set.occlusion || set.smoothness || set.metallic) {
    const n = mapSize * mapSize, orm = Buffer.alloc(n * 3, 255);
    const ao = set.occlusion ? await channel(set.occlusion, 0, mapSize) : null;
    const gloss = set.smoothness ? await channel(set.smoothness.file, set.smoothness.channel, mapSize) : null;
    const metal = set.metallic ? await channel(set.metallic.file, set.metallic.channel, mapSize) : null;
    for (let i = 0; i < n; i++) {
      orm[i * 3] = ao ? ao[i] : 255;
      orm[i * 3 + 1] = gloss ? Math.round(255 - gloss[i] * (set.smoothness.scale ?? 1)) : 255;
      orm[i * 3 + 2] = metal ? metal[i] : 0;
    }
    const map = texture('orm', await sharp(orm, {raw: {width: mapSize, height: mapSize, channels: 3}}).png().toBuffer(), 'image/png');
    if (ao) material.setOcclusionTexture(map);
    if (gloss || metal) material.setMetallicRoughnessTexture(map);
  }
  if (set.emission) {
    material.setEmissiveTexture(texture('emission', await image(set.emission, mapSize).removeAlpha().jpeg({quality: 90}).toBuffer(), 'image/jpeg'));
    material.setEmissiveFactor(set.emissiveFactor ?? [1, 1, 1]);
  }
  return material;
}
