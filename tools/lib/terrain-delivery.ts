import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeWorldData, encodeWorldData, type WorldDataManifest } from '../../game/src/world/worldDataFormat.js';
import type { GeometryData, TerrainCacheData } from '../../game/src/render/terrainCache.js';
import { SCATTER_STREAM_TILE_METRES } from '../../game/src/world/scatter.js';
import { splitMineCutData } from '../../game/src/render/mineCutFace.js';
import type { SolidVolume } from '../../game/src/contracts.js';

/** Split rendered coast triangles without changing a vertex, normal, colour or triangle order. */
export function tileCoast(source: GeometryData, size = 100): { bounds: number[]; geometry: GeometryData }[] {
  const positions = source.attributes.position!.array;
  const groups = new Map<string, number[]>();
  const indices = source.index!;
  for (let i = 0; i < indices.length; i += 3) {
    const x = positions[indices[i]! * 3]!, z = positions[indices[i]! * 3 + 2]!;
    const key = size === Infinity ? 'all' : `${Math.floor(x / size)}:${Math.floor(z / size)}`;
    const group = groups.get(key) ?? []; if (!groups.has(key)) groups.set(key, group);
    group.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
  }
  return [...groups.values()].map(indices => {
    const vertices = [...new Set(indices)], remap = new Map(vertices.map((v,i) => [v,i]));
    const attributes: GeometryData['attributes'] = {};
    for (const [name, attr] of Object.entries(source.attributes)) {
      const ArrayType = attr.array.constructor as typeof Float32Array;
      const array = new ArrayType(vertices.length * attr.itemSize);
      vertices.forEach((v,i) => { for (let c = 0; c < attr.itemSize; c++) array[i*attr.itemSize+c] = attr.array[v*attr.itemSize+c]!; });
      attributes[name] = {...attr, array};
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of vertices) { minX = Math.min(minX,positions[v*3]!); maxX = Math.max(maxX,positions[v*3]!);
      minZ = Math.min(minZ,positions[v*3+2]!); maxZ = Math.max(maxZ,positions[v*3+2]!); }
    return { bounds: [minX,maxX,minZ,maxZ], geometry: { attributes,
      index: Uint32Array.from(indices, v => remap.get(v)!) } };
  });
}

/** Copy-only release transform. Authoring data and navigation geometry remain byte-exact. */
export async function packTerrainDelivery(root: string, subdirectory = 'generated/world') {
  const directory = path.join(root, subdirectory);
  const manifest: WorldDataManifest = JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  manifest.assetTiles=[];
  const semantic=manifest.records['assembly/semantic'];
  if (semantic) {
    const data=decodeWorldData(gunzipSync(await readFile(path.join(directory,semantic.file)))) as any;
    manifest.assetObjects=data.entities.filter((e:any)=>e.view).map((e:any)=>({x:e.position[0],z:e.position[2],
      ids:[e.view.assetId,e.view.depletedAssetId,...(e.view.partAssetIds??[])].filter(Boolean)}));
  }
  const spawns=manifest.records['spawns/world'];
  if(spawns) {
    const data=decodeWorldData(gunzipSync(await readFile(path.join(directory,spawns.file)))) as any;
    if(data.assetObjects) manifest.assetObjects=data.assetObjects;
  }
  for (const [key,entry] of Object.entries(manifest.records).filter(([key])=>key.startsWith('scatter/'))) {
    const tile=decodeWorldData(gunzipSync(await readFile(path.join(directory,entry.file)))) as any;
    const [col,row]=key.slice('scatter/'.length).split(':').map(Number);
    const size=SCATTER_STREAM_TILE_METRES;
    manifest.assetTiles.push({record:key,minX:col!*size,maxX:(col!+1)*size,minZ:row!*size,maxZ:(row!+1)*size,
      ids:[...new Set<string>(tile.regions.flatMap((region:any)=>region.buckets.filter((b:any)=>b.kind!=='grass').map((b:any)=>b.assetId)))]});
  }
  const write = async (key: string, value: unknown) => {
    const bytes = gzipSync(encodeWorldData(value), {level:9});
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(directory, `${hash}.world`), bytes);
    manifest.records[key] = {file:`${hash}.world`,sha256:hash,bytes:bytes.length};
  };
  for (const [key,entry] of Object.entries(manifest.records).filter(([key]) => key.startsWith('site-cut/'))) {
    const cut = decodeWorldData(gunzipSync(await readFile(path.join(directory,entry.file)))) as {geometry:GeometryData;solids:SolidVolume[]};
    if (cut.geometry.surfaceRecord) continue;
    const split=splitMineCutData(key,cut);
    await write(split.record,split.geometry);
    await write(key,split.metadata);
  }
  for (const key of ['terrain/world','terrain/fairy']) {
    const entry = manifest.records[key]; if (!entry) continue;
    const data = decodeWorldData(gunzipSync(await readFile(path.join(directory,entry.file)))) as TerrainCacheData;
    if (Object.values(data.chunks).some(chunk => chunk.surfaceRecord)) continue;
    // The release imports its validated navmesh. Picking receives the exact chunk at area load.
    data.streamedDraws = subdirectory === 'generated/world';
    for (const [id, geometry] of Object.entries(data.chunks)) {
      const record = `terrain-draw/${key}/${id}`;
      await write(record, geometry);
      const positions=geometry.attributes.position!.array;
      let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
      for(let i=0;i<positions.length;i+=3) {
        minX=Math.min(minX,positions[i]!);maxX=Math.max(maxX,positions[i]!);
        minZ=Math.min(minZ,positions[i+2]!);maxZ=Math.max(maxZ,positions[i+2]!);
      }
      const [originX,originZ]=id.split(':').map(Number);
      manifest.assetTiles.push({record,ids:[],minX:originX!,maxX:originX!+maxX-minX,
        minZ:originZ!,maxZ:originZ!+maxZ-minZ});
      data.chunks[id] = data.streamedDraws ? {attributes:{},index:null,surfaceRecord:record}
        : {attributes:{position:geometry.attributes.position!},index:geometry.index,surfaceRecord:record};
    }
    if (data.coast) {
      data.coast.tiles = [];
      for (const [i,tile] of tileCoast(data.coast.geometry).entries()) {
        const record = `terrain-draw/${key}/coast/${i}`;
        await write(record,tile.geometry);
        const [minX,maxX,minZ,maxZ] = tile.bounds as [number,number,number,number];
        data.coast.tiles.push({key:record,minX,maxX,minZ,maxZ});
        manifest.assetTiles.push({record,ids:[],minX,maxX,minZ,maxZ});
      }
      if (data.streamedDraws) {
        for (const [i,tile] of tileCoast(data.coast.dryGeometry).entries()) {
          const record = `terrain-draw/${key}/coast-picking/${i}`;
          await write(record,tile.geometry);
          const [minX,maxX,minZ,maxZ] = tile.bounds as [number,number,number,number];
          data.coast.tiles.push({key:record,minX,maxX,minZ,maxZ,picking:true});
          manifest.assetTiles.push({record,ids:[],minX,maxX,minZ,maxZ});
        }
        data.coast.dryGeometry = {attributes:{},index:null,surfaceRecord:`terrain-draw/${key}/coast-picking`};
      } else data.coast.dryGeometry = tileCoast(data.coast.dryGeometry, Infinity)[0]!.geometry;
      data.coast.geometry = {...data.coast.dryGeometry,surfaceRecord:`terrain-draw/${key}/coast`};
    }
    await write(key, data);
    console.info(`${key}: ${(entry.bytes / 1e6).toFixed(1)} MB -> ${(manifest.records[key]!.bytes / 1e6).toFixed(1)} MB initial`);
  }
  // Draw records unblock shader preparation. Queue them before the larger scatter/model traffic.
  manifest.assetTiles.sort((a,b)=>Number(b.record?.startsWith('terrain-draw/'))-Number(a.record?.startsWith('terrain-draw/')));
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));
}
