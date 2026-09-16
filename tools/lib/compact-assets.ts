import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { compactModel } from './compact-model.js';

/** Release encodings. Authored originals remain intact, with separate desktop and phone maps. */
export async function packCompactAssets(root: string) {
  const directory = path.join(root, 'assets');
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const compactTextures: Record<string, string> = {};
  const optimizedTextures: Record<string, string> = {};
  const cache = path.resolve(root, '../../.cache/compact-assets-v1');
  await mkdir(cache, { recursive: true });
  await mkdir(path.join(directory, 'compact'), { recursive: true });
  await mkdir(path.join(directory, 'optimized'), { recursive: true });
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(e => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)
      && !['compact', 'optimized'].some(folder => e.parentPath.includes(`${path.sep}${folder}`)));
  let originalBytes = 0, compactBytes = 0, desktopBytes = 0;
  for (const entry of files) {
    const file = path.join(entry.parentPath, entry.name);
    const input = await readFile(file);
    const hash = createHash('sha256').update(input).digest('hex');
    for (const size of [512, 1024]) {
      const phone = size === 512;
      const output = `${phone ? 'compact' : 'optimized'}/${hash}.webp`;
      const cacheFile = path.join(cache, `${hash}${phone ? '' : '.1024'}.webp`);
      let bytes: Buffer;
      try { bytes = await readFile(cacheFile); }
      catch {
        bytes = await sharp(input).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85, alphaQuality: 100, effort: 4 }).toBuffer();
        await writeFile(cacheFile, bytes);
      }
      await writeFile(path.join(directory, output), bytes);
      (phone ? compactTextures : optimizedTextures)[path.relative(directory, file).replaceAll('\\', '/')] = output;
      if (phone) compactBytes += bytes.length;
      else desktopBytes += bytes.length;
    }
    originalBytes += input.length;
  }
  const models = new Map<string, string>();
  for (const entry of manifest.assets) {
    if (!entry.file?.endsWith('.glb')) continue;
    let compactFile = models.get(entry.file);
    if (!compactFile) {
      const input = await readFile(path.join(directory, entry.file));
      const hash = createHash('sha256').update(input).digest('hex');
      let bytes: Buffer;
      const precision = !/altar_ruins_site|corealm_stump_oak|bridge/.test(entry.id);
      const modelKey = `${hash}.meshopt-v4-${precision}`;
      try { bytes = await readFile(path.join(cache, modelKey)); }
      catch {
        bytes = gzipSync(await compactModel(input,precision), { level: 9 });
        await writeFile(path.join(cache, modelKey), bytes);
      }
      compactFile = `${entry.file}.model`;
      await writeFile(path.join(directory, compactFile), bytes);
      models.set(entry.file, compactFile);
    }
    entry.compactFile = compactFile;
  }
  manifest.compactTextures = compactTextures;
  manifest.optimizedTextures = optimizedTextures;
  await writeFile(manifestFile, JSON.stringify(manifest));
  console.info(`Textures: ${(originalBytes / 1e6).toFixed(1)} MB -> phone ${(compactBytes / 1e6).toFixed(1)} MB / desktop ${(desktopBytes / 1e6).toFixed(1)} MB`);
}
