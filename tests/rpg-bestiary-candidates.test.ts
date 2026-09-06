import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { Page } from 'playwright';
import { installAssetCandidates } from '../tools/lib/assetCandidates.js';

it('serves hash-verified shared candidate images and rejects stale bytes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bestiary-candidate-'));
  try {
    const bytes = Buffer.from('candidate image bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = `textures/imported/${sha256}.png`;
    await mkdir(path.join(dir, 'textures/imported'), { recursive: true });
    await writeFile(path.join(dir, file), bytes);
    const catalog = { assets: [], sharedTextures: [{ file, bytes: bytes.length, sha256, mimeType: 'image/png' }] };
    const catalogPath = path.join(dir, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(catalog));
    const routes = new Map<string, (route: unknown) => Promise<unknown>>();
    const page = { route: async (pattern: string, handler: (route: unknown) => Promise<unknown>) => routes.set(pattern, handler) } as unknown as Page;
    await expect(installAssetCandidates(page, catalogPath)).resolves.toEqual([]);
    let response: any;
    await routes.get(`**/assets/${file}*`)!({ fulfill: async (value: unknown) => { response = value; } });
    expect(response).toEqual({ status: 200, contentType: 'image/png', body: bytes });
    await writeFile(path.join(dir, file), 'stale');
    await expect(installAssetCandidates(page, catalogPath)).rejects.toThrow('Stale shared texture');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
