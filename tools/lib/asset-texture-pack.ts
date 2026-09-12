import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface PackedImage { file: string; bytes: Buffer; mimeType: string }

/** Lossless GLB repack: immutable PNG/JPEG bytes become shared, content-addressed files. */
export function packAssetTextures(input: Buffer, file: string): { glb: Buffer; images: PackedImage[] } {
  if (input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2
    || input.readUInt32LE(8) !== input.length || input.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Invalid GLB: ${file}`);
  const jsonLength = input.readUInt32LE(12), binaryHeader = 20 + jsonLength;
  const json = JSON.parse(input.toString('utf8', 20, binaryHeader));
  // External/multiple buffers and nonstandard container chunks retain their original encoding.
  if (json.extensionsUsed?.some((name: string) => /meshopt_compression/.test(name))
    || json.buffers?.length !== 1 || json.buffers[0].uri || binaryHeader + 8 > input.length
    || input.readUInt32LE(binaryHeader + 4) !== 0x004e4942
    || binaryHeader + 8 + input.readUInt32LE(binaryHeader) !== input.length) return { glb: input, images: [] };
  const binary = input.subarray(binaryHeader + 8), images: PackedImage[] = [], extracted = new Set<number>();
  for (const image of json.images ?? []) {
    const extension = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/jpeg' ? 'jpg' : null;
    if (image.bufferView === undefined || !extension) continue;
    const view = json.bufferViews[image.bufferView];
    if (!view || view.buffer !== 0 || (view.byteOffset ?? 0) + view.byteLength > binary.length) throw new Error(`Invalid embedded image: ${file}`);
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const shared = `assets/shared-textures/${hash}.${extension}`;
    images.push({ file: shared, bytes, mimeType: image.mimeType });
    extracted.add(image.bufferView); delete image.bufferView;
    image.uri = path.posix.relative(path.posix.dirname(file), shared);
  }
  if (!images.length) return { glb: input, images };
  const visit = (value: any, reference: (object: any) => void): void => {
    if (!value || typeof value !== 'object') return;
    if (Number.isInteger(value.bufferView)) reference(value);
    for (const child of Object.values(value)) visit(child, reference);
  };
  // An image view can also have an accessor/extension reference. Keep that byte range intact.
  visit(json, object => extracted.delete(object.bufferView));
  const remap = new Map<number, number>(), chunks: Buffer[] = [], views: any[] = [];
  let offset = 0;
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    if (extracted.has(index)) continue;
    if (view.buffer !== 0 || (view.byteOffset ?? 0) + view.byteLength > binary.length) throw new Error(`Invalid buffer view: ${file}`);
    const padding = (4 - offset % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    remap.set(index, views.length); views.push({ ...view, byteOffset: offset });
    chunks.push(bytes); offset += bytes.length;
  }
  visit(json, object => {
    const next = remap.get(object.bufferView);
    if (next === undefined) throw new Error(`Dangling buffer view: ${file}`);
    object.bufferView = next;
  });
  json.bufferViews = views; json.buffers[0].byteLength = offset;
  const rawJson = Buffer.from(JSON.stringify(json)), jsonPadding = (4 - rawJson.length % 4) % 4;
  const binaryPadding = (4 - offset % 4) % 4, binarySize = offset + binaryPadding;
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + rawJson.length + jsonPadding + binarySize, 8);
  header.writeUInt32LE(rawJson.length + jsonPadding, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binarySize, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, rawJson, Buffer.alloc(jsonPadding, 0x20), binHeader, ...chunks, Buffer.alloc(binaryPadding)]), images };
}

/** Operates only on Vite's copied release files; authored models and provenance stay intact. */
export async function packReleaseTextures(root: string) {
  const manifestPath = path.join(root, 'assets/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const shared = new Set<string>(), files = new Map<string, number>();
  const report = { models: 0, embeddedImages: 0, uniqueImages: 0, inputBytes: 0, modelBytes: 0, sharedImageBytes: 0, savedBytes: 0 };
  for (const entry of manifest.assets) {
    if (!entry.file?.endsWith('.glb')) continue;
    const file = path.posix.join('assets', entry.file.replaceAll('\\', '/'));
    const target = path.resolve(root, file);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Asset escapes release directory: ${file}`);
    const previous = files.get(file);
    if (previous !== undefined) { entry.bytes = previous; continue; }
    const input = await readFile(target), packed = packAssetTextures(input, file);
    report.models++; report.inputBytes += input.length; report.modelBytes += packed.glb.length;
    report.embeddedImages += packed.images.length;
    for (const image of packed.images) {
      if (shared.has(image.file)) continue;
      shared.add(image.file); report.sharedImageBytes += image.bytes.length;
      const destination = path.join(root, image.file);
      await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, image.bytes);
    }
    if (packed.images.length) await writeFile(target, packed.glb);
    files.set(file, packed.glb.length); entry.bytes = packed.glb.length;
  }
  report.uniqueImages = shared.size;
  report.savedBytes = report.inputBytes - report.modelBytes - report.sharedImageBytes;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(path.join(root, 'assets/texture-pack.json'), JSON.stringify(report, null, 2));
  console.info(`Release textures: ${report.embeddedImages} images share ${report.uniqueImages} files; ${(report.savedBytes / 1e6).toFixed(1)} MB removed`);
  return report;
}

export function releaseTexturePackPlugin(): Plugin {
  let output = '';
  return { name: 'corealm-release-texture-pack', apply: 'build',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    async writeBundle() { await packReleaseTextures(output); },
  };
}
