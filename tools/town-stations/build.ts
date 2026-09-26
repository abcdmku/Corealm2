/** Author the five reusable world workstations. Stage first; --publish installs accepted models. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO, type Material, type Texture } from '@gltf-transform/core';
import { weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { buildFurnace, buildAnvil, buildCookingRange } from './hot.js';
import { buildCraftingTable, buildFletchingBench } from './benches.js';

const output = 'art/town-stations/candidates';
const pack = { id: 'corealm-original-workshops', name: 'Corealm workshop stations', author: 'Corealm',
  license: 'LicenseRef-Corealm-Original', source: 'tools/town-stations/build.ts' };
const builders = { furnace: buildFurnace, anvil: buildAnvil, range: buildCookingRange,
  crafting_table: buildCraftingTable, fletching_bench: buildFletchingBench };
const oakPng = await sharp('art/town-stations/oak-grain.png').resize(512, 512).png().toBuffer();
const oakPixels = await sharp(oakPng).removeAlpha().raw().toBuffer();
const oakMean = [0, 0, 0];
for (let i = 0; i < oakPixels.length; i++) {
  const srgb = oakPixels[i]! / 255;
  oakMean[i % 3]! += srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
}
for (let i = 0; i < 3; i++) oakMean[i]! /= oakPixels.length / 3;
const records = [];
for (const [kind, build] of Object.entries(builders)) {
  const id = `corealm_station_${kind}`;
  const group = build();
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    || bounds.min.y < -.005 || Math.min(size.x, size.y, size.z) <= 0) throw new Error(`Invalid station bounds: ${id}`);
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(id);
  doc.getRoot().setDefaultScene(scene);
  const textures = new Map<THREE.Texture, Texture>();
  async function texture(source: THREE.Texture): Promise<Texture> {
    const cached = textures.get(source); if (cached) return cached;
    if (!(source instanceof THREE.DataTexture)) throw new Error(`${id}: textures must use DataTexture`);
    const { data, width, height } = source.image;
    if (!data) throw new Error(`${id}: texture pixels are missing`);
    const channels = data.length / (width * height);
    if (![1, 2, 3, 4].includes(channels)) throw new Error('Invalid texture channels');
    const png = await sharp(Buffer.from(data as Uint8Array), {
      raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
    }).png().toBuffer();
    const result = doc.createTexture(source.name).setImage(png).setMimeType('image/png');
    textures.set(source, result); return result;
  }
  const materials = new Map<THREE.MeshStandardMaterial, Material>();
  let oakTexture: Texture | undefined;
  async function material(source: THREE.MeshStandardMaterial): Promise<Material> {
    const cached = materials.get(source); if (cached) return cached;
    const result = doc.createMaterial(source.name)
      .setBaseColorFactor([source.color.r, source.color.g, source.color.b, source.opacity])
      .setMetallicFactor(source.metalness).setRoughnessFactor(source.roughness)
      .setEmissiveFactor(source.emissive.toArray().map(v => Math.min(1, v * source.emissiveIntensity)) as [number, number, number])
      .setDoubleSided(source.side === THREE.DoubleSide);
    if (source.transparent) result.setAlphaMode('BLEND');
    if (source.map) {
      result.setBaseColorTexture(await texture(source.map));
      result.getBaseColorTextureInfo()!.setWrapS(10497).setWrapT(10497);
    }
    if (source.normalMap) {
      result.setNormalTexture(await texture(source.normalMap)).setNormalScale(source.normalScale.x);
      result.getNormalTextureInfo()!.setWrapS(10497).setWrapT(10497);
    }
    if (source.name.startsWith('Workshop oak@')) {
      oakTexture ??= doc.createTexture('GPT oak workshop grain').setImage(oakPng).setMimeType('image/png');
      result.setBaseColorTexture(oakTexture)
        .setBaseColorFactor([...source.color.toArray().map((v, i) => Math.min(1, v / oakMean[i]!)), source.opacity] as [number, number, number, number]);
      result.getBaseColorTextureInfo()!.setWrapS(10497).setWrapT(10497);
    }
    materials.set(source, result); return result;
  }
  const batches = new Map<THREE.MeshStandardMaterial, THREE.BufferGeometry[]>();
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!(child.material instanceof THREE.MeshStandardMaterial)) throw new Error(`${id}: single PBR material per mesh required`);
    const source = child.material;
    let geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    if (geometry.index) { const indexed = geometry; geometry = geometry.toNonIndexed(); indexed.dispose(); }
    const count = geometry.getAttribute('position').count;
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    if (!geometry.hasAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    if (!geometry.hasAttribute('color') || !source.vertexColors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    for (const key of Object.keys(geometry.attributes)) if (!['position','normal','uv','color'].includes(key)) geometry.deleteAttribute(key);
    geometry.clearGroups();
    const batch = batches.get(source) ?? []; batch.push(geometry); batches.set(source, batch);
  });
  let triangles = 0;
  for (const [source, pieces] of batches) {
    const geometry = mergeGeometries(pieces);
    if (!geometry) throw new Error(`Cannot merge ${source.name}`);
    const primitive = doc.createPrimitive().setMaterial(await material(source));
    for (const [name, semantic, type] of [['position','POSITION','VEC3'], ['normal','NORMAL','VEC3'], ['uv','TEXCOORD_0','VEC2'], ['color','COLOR_0','VEC3']] as const) {
      primitive.setAttribute(semantic, doc.createAccessor(name).setType(type)
        .setArray(new Float32Array(geometry.getAttribute(name).array)).setBuffer(buffer));
    }
    triangles += geometry.getAttribute('position').count / 3;
    scene.addChild(doc.createNode(source.name).setMesh(doc.createMesh(source.name).addPrimitive(primitive)));
    geometry.dispose(); pieces.forEach(piece => piece.dispose());
  }
  if (triangles > 50000 || batches.size > 16) throw new Error(`${id}: station geometry budget exceeded`);
  await doc.transform(weld());
  const bytes = await new NodeIO().writeBinary(doc);
  const file = `models/workshops/${kind}.glb`;
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  await writeFile(path.join(output, file), bytes);
  const row = { id, file, pack: pack.id, category: 'prop', is: kind,
    tags: ['workshop', 'station', kind], bytes: bytes.length,
    size: { x: size.x, y: size.y, z: size.z }, base: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    animations: [], materials: [...materials.values()].map(m => m.getName()),
    sha256: createHash('sha256').update(bytes).digest('hex'), triangles, drawCalls: batches.size };
  records.push(row);
  console.log(`${id}: ${triangles} triangles, ${batches.size} batches, ${size.toArray().map(n => n.toFixed(2)).join(' x ')} m`);
}
await writeFile(path.join(output, 'catalogue.json'), JSON.stringify({ pack, assets: records }, null, 2) + '\n');
if (process.argv.includes('--publish')) {
  const manifestPath = 'game/public/assets/manifest.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const record of records) {
    const destination = path.join('game/public/assets', record.file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(output, record.file), destination);
    const { triangles: _triangles, drawCalls: _drawCalls, ...entry } = record;
    const index = manifest.assets.findIndex((asset: { id: string }) => asset.id === entry.id);
    if (index < 0) manifest.assets.push(entry); else manifest.assets[index] = entry;
  }
  if (!manifest.packs.some((row: { id: string }) => row.id === pack.id)) manifest.packs.push(pack);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
