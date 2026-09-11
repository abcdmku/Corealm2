import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const parts = ['ordinary', 'keepers'];
const output = path.resolve('test-results/wilderness-creatures');
await mkdir(output, { recursive: true });

if (!process.argv.includes('--merge-only')) {
  for (const part of parts) {
    const result = await run(process.execPath, [`tools/wilderness-creatures/${part}/build.mjs`], {
      cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
}

const combined = { assets: [], files: {}, packs: [], sharedTextures: [] };
const ids = new Set();
const textureFiles = new Set();
for (const part of parts) {
  const directory = path.join(output, part);
  const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'));
  for (const entry of catalog.assets) {
    if (ids.has(entry.id)) throw new Error(`Duplicate creature: ${entry.id}`);
    ids.add(entry.id);
    const file = path.resolve(directory, catalog.files?.[entry.id] ?? entry.file);
    const bytes = await readFile(file);
    if (entry.bytes !== bytes.length || entry.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
      throw new Error(`Stale staged creature: ${entry.id}`);
    }
    combined.assets.push(entry);
    combined.files[entry.id] = path.relative(output, file).replaceAll(path.sep, '/');
  }
  for (const pack of [...(catalog.pack ? [catalog.pack] : []), ...(catalog.packs ?? [])]) {
    if (!combined.packs.some(row => row.id === pack.id)) combined.packs.push(pack);
  }
  for (const texture of catalog.sharedTextures ?? []) {
    if (textureFiles.has(texture.file)) continue;
    const source = path.resolve(directory, texture.file), target = path.resolve(output, texture.file);
    if (!target.startsWith(output + path.sep)) throw new Error(`Invalid texture: ${texture.file}`);
    const bytes = await readFile(source);
    if (texture.bytes !== bytes.length || texture.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
      throw new Error(`Stale staged texture: ${texture.file}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    textureFiles.add(texture.file);
    combined.sharedTextures.push(texture);
  }
}

if (combined.assets.length !== 11) throw new Error(`Expected 11 bodies, got ${combined.assets.length}`);
await writeFile(path.join(output, 'catalog.json'), JSON.stringify(combined, null, 2) + '\n');
process.stdout.write(`Staged ${combined.assets.length} Wilderness bodies in ${path.relative(process.cwd(), output)}/catalog.json\n`);
