import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const out = 'art/fairy-population/textures/source';
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const stagedRoot = 'test-results/fairy-terraces-assets/monsters';
const staged = JSON.parse(await readFile(`${stagedRoot}/candidates.json`, 'utf8'));
const defaults = ['fairy_monster_10', 'fairy_monster_19', 'fairy_monster_34', 'animal_frog', 'creature_quarry_snail',
  'animal_deer', 'creature_briar_harrow', 'creature_baby_red_dragon', 'creature_goblin_shaman', 'creature_wraith',
  ...['02', '03', '06', '07', '08', '09'].map(n => `fantasy_monster_${n}`), 'fairy_monster_28', 'fairy_monster_31'];
const selected = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',') ?? defaults;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const report: any[] = [];
for (const id of selected) {
  const entry = manifest.assets.find((a: any) => a.id === id) ?? staged.assets.find((a: any) => a.id === id);
  if (!entry) { report.push({ id, missing: true }); continue; }
  const sourcePath = manifest.assets.includes(entry) ? `game/public/assets/${entry.file}` : path.join(stagedRoot, staged.files[id]);
  const doc = await io.read(sourcePath), materials = doc.getRoot().listMaterials();
  const primitives = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
  const textures = [...new Set(materials.map(m => m.getBaseColorTexture()).filter(t => !!t))];
  const row: any = { id, sha256: entry.sha256, sourcePath, size: entry.size,
    hasUV: primitives.some(p => p.getAttribute('TEXCOORD_0')), vertexPainted: primitives.some(p => p.getAttribute('COLOR_0')),
    materials: materials.map(m => ({ name: m.getName(), textureIndex: textures.indexOf(m.getBaseColorTexture()!), factor: m.getBaseColorFactor() })), maps: [] };
  for (const [index, texture] of textures.entries()) {
    const albedo = `${id}-albedo-${index}.png`, uv = `${id}-uv-${index}.png`;
    const image = texture!.getImage()!;
    const meta = await sharp(image).metadata();
    await sharp(image).png().toFile(path.join(out, albedo));
    const width = meta.width!, height = meta.height!;
    const lines: string[] = [];
    let triangles = 0, outsideUV = 0;
    for (const primitive of primitives) {
      if (primitive.getMaterial()?.getBaseColorTexture() !== texture) continue;
      const coords = primitive.getAttribute('TEXCOORD_0');
      if (!coords) continue;
      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? coords.getCount();
      const point: number[] = [];
      for (let t = 0; t + 2 < count; t += 3) {
        const points: string[] = [];
        for (let k = 0; k < 3; k++) {
          coords.getElement(indices ? indices.getScalar(t + k) : t + k, point);
          if (point[0]! < 0 || point[0]! > 1 || point[1]! < 0 || point[1]! > 1) outsideUV++;
          // glTF texture coordinates address the top-left corner with (0, 0).
          points.push(`${(point[0]! * width).toFixed(2)},${(point[1]! * height).toFixed(2)}`);
        }
        lines.push(`<path d="M${points.join('L')}Z"/>`); triangles++;
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#15191d"/><g fill="none" stroke="#b7e7dd" stroke-opacity=".65" stroke-width="${Math.max(.5, width / 2048)}">${lines.join('')}</g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(out, uv));
    row.maps.push({ index, albedo, uv, width, height, triangles, outsideUV,
      materials: materials.filter(m => m.getBaseColorTexture() === texture).map(m => m.getName()) });
  }
  if (row.maps.length > 1) {
    const columns = 3, rows = Math.ceil(row.maps.length / columns), cellSize = 1024;
    row.atlas = { columns, rows, cellSize, albedo: `${id}-albedo-atlas.png`, uv: `${id}-uv-atlas.png`,
      order: row.maps.map((m: any) => ({ index: m.index, column: m.index % columns, row: Math.floor(m.index / columns), materials: m.materials })) };
    for (const kind of ['albedo', 'uv'] as const) {
      const cells = await Promise.all(row.maps.map(async (m: any) => ({
        input: await sharp(path.join(out, m[kind])).resize(cellSize, cellSize).png().toBuffer(),
        left: m.index % columns * cellSize, top: Math.floor(m.index / columns) * cellSize,
      })));
      await sharp({ create: { width: columns * cellSize, height: rows * cellSize, channels: 4, background: '#15191d' } })
        .composite(cells).png().toFile(path.join(out, row.atlas[kind]));
    }
  }
  report.push(row);
  console.log(JSON.stringify({ id, hasUV: row.hasUV, vertexPainted: row.vertexPainted, maps: row.maps.length }));
}
await writeFile(path.join(out, selected === defaults ? 'index.json' : 'selection.json'), JSON.stringify(report, null, 2) + '\n');
