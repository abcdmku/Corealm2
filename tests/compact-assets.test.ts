import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { packCompactAssets } from '../tools/lib/compact-assets.js';

it('packs both texture sizes, preserves transparent source art, and reuses the same outputs on a second pack', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'corealm-delivery-'));
  const root = path.join(fixture, 'game', 'dist'), assets = path.join(root, 'assets');
  await mkdir(assets, {recursive:true});
  try {
    const pixels = Buffer.alloc(1200 * 600 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = (i / 4) % 255; pixels[i+1] = 100; pixels[i+2] = 200; pixels[i+3] = i % 16 ? 255 : 0;
    }
    const original = await sharp(pixels, {raw:{width:1200,height:600,channels:4}}).png().toBuffer();
    await writeFile(path.join(assets,'paint.png'), original);
    await writeFile(path.join(assets,'manifest.json'), JSON.stringify({assets:[]}));
    await packCompactAssets(root);
    const manifest = JSON.parse(await readFile(path.join(assets,'manifest.json'),'utf8'));
    for (const [map,width,height] of [[manifest.compactTextures,512,256],[manifest.optimizedTextures,1024,512]] as const) {
      const info = await sharp(await readFile(path.join(assets,map['paint.png']))).metadata();
      expect(info).toMatchObject({format:'webp',width,height,hasAlpha:true});
    }
    expect(await readFile(path.join(assets,'paint.png'))).toEqual(original);
    await packCompactAssets(root);
    expect(JSON.parse(await readFile(path.join(assets,'manifest.json'),'utf8'))).toEqual(manifest);
    expect(await readdir(path.join(assets,'optimized'))).toHaveLength(1);
    expect(await readdir(path.join(assets,'compact'))).toHaveLength(1);
  } finally {
    // mkdtemp created this exact fixture; never remove a parent or a caller-provided path.
    await rm(fixture, {recursive:true,force:true});
  }
});
