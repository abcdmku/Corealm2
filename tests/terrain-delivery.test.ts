import { describe, expect, it } from 'vitest';
import { tileCoast, packTerrainDelivery } from '../tools/lib/terrain-delivery.js';
import * as THREE from 'three';
import { WorldScene, type WorldTerrainSpec } from '../game/src/render/scene.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { MemoryGenerationCache } from './support/generation-cache.js';
import { encodeWorldData, decodeWorldData } from '../game/src/world/worldDataFormat.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { GeometryData } from '../game/src/render/terrainCache.js';
import { cachedWorldValue } from '../game/src/world/cachedWorldValue.js';

describe('released terrain delivery', () => {
  it('restores exact ground and coast picking only when their area is prepared', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'corealm-delivery-'));
    const cold=new WorldScene(new THREE.Scene()), streamed=new WorldScene(new THREE.Scene());
    try {
      const spec:WorldTerrainSpec={bounds:{minX:-4,maxX:4,minZ:-4,maxZ:4},chunkSize:8,metresPerQuad:2,blendMetres:2,
        regions:[{regionId:'fallowmarch',rect:{minX:-4,maxX:4,minZ:-4,maxZ:4},seed:5,character:'plains',baseHeight:3,amplitude:2}],
        coast:{...buildWorldTerrainSpec().coast!,collar:16,shoreline:[8,12],gridStep:2,oceanSize:100}};
      const cache=new MemoryGenerationCache();
      await cold.buildWorldCached(cache,'world',spec);
      const directory=path.join(root,'generated/world');await mkdir(directory,{recursive:true});
      const bytes=gzipSync(encodeWorldData(cache.entries.get('terrain/world')));
      await writeFile(path.join(directory,'source.world'),bytes);
      await writeFile(path.join(directory,'manifest.json'),JSON.stringify({tiles:[],records:{'terrain/world':{file:'source.world',bytes:bytes.length}}}));
      await packTerrainDelivery(root);
      const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
      expect(manifest.assetTiles.find((tile:any)=>tile.record==='terrain-draw/terrain/world/-4:-4:4:4'))
        .toMatchObject({minX:-4,maxX:4,minZ:-4,maxZ:4,ids:[]});
      const loaded:string[]=[];
      const delivery={get:async<T>(key:string,valid:(v:unknown)=>v is T)=>{
        const value=decodeWorldData(gunzipSync(await readFile(path.join(directory,manifest.records[key].file))));
        expect(valid(value),key).toBe(true);loaded.push(key);return value as T;
      },put:async()=>{throw new Error('Must not regenerate terrain');}};
      await streamed.buildWorldCached(delivery,'world',spec);
      expect(loaded).toEqual(['terrain/world']);
      await streamed.prepareTerrainArea(0,0,100);
      const count=loaded.length;await streamed.prepareTerrainArea(0,0,100);expect(loaded).toHaveLength(count);
      expect(loaded.some(key=>key.includes('coast-picking/'))).toBe(true);
      cold.root.updateMatrixWorld(true);streamed.root.updateMatrixWorld(true);
      const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
      for(let x=-18;x<18;x+=2.3)for(let z=-18;z<18;z+=2.7){
        ray.ray.origin.set(x,30,z);
        const expected=ray.intersectObjects(cold.getWalkableMeshes(),false).map(hit=>hit.point.y);
        const actual=ray.intersectObjects(streamed.getWalkableMeshes(),false).map(hit=>hit.point.y);
        expect(actual).toEqual(expected);
        expect(streamed.meshHeightAt(x,z)).toBe(cold.meshHeightAt(x,z));
      }
    } finally {
      cold.dispose();streamed.dispose();
      if (!path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'corealm-delivery-')) throw new Error('Unexpected fixture path');
      await rm(root,{recursive:true,force:true});
    }
  });
  it('retains every indexed triangle and attribute byte when partitioning the coast', () => {
    const source: GeometryData = { attributes: {
      position: {array:new Float32Array([99,1,0, 101,2,0, 99,3,2, 201,4,0]),itemSize:3,normalized:false},
      color: {array:new Float32Array([.11,.12,.13,.21,.22,.23,.31,.32,.33,.41,.42,.43]),itemSize:3,normalized:false},
      aPaved: {array:new Uint8Array([0,127,255,64]),itemSize:1,normalized:true},
    }, index:new Uint16Array([0,1,2,1,3,2]) };
    const tiles = tileCoast(source);
    expect(tiles.length).toBe(2);
    const triangles = (geometry: GeometryData) => Array.from(geometry.index!, i =>
      Object.values(geometry.attributes).flatMap(attr => Array.from(attr.array.slice(i*attr.itemSize,(i+1)*attr.itemSize))));
    expect(tiles.flatMap(tile => triangles(tile.geometry))).toEqual(triangles(source));
    expect(tiles[0]!.bounds).toEqual([99,101,0,2]);
    expect(tiles[0]!.geometry.attributes.aPaved!.array).toBeInstanceOf(Uint8Array);
    expect(tiles[0]!.geometry.attributes.aPaved!.normalized).toBe(true);
  });
  it('restores assembly data without rerunning the generator or sharing mutable session state', async () => {
    let stored: unknown, generated = 0;
    const cache = {get: async <T>(_key:string, valid:(v:unknown)=>v is T) => valid(stored) ? structuredClone(stored) : null,
      put: async (_key:string,v:unknown) => {stored=structuredClone(v);return true;} };
    const valid = (v:unknown): v is {health:number} => typeof (v as any)?.health === 'number';
    const create = () => {generated++;return {health:20};};
    const first = await cachedWorldValue(cache,'assembly/test',create,valid); first.health=0;
    expect(await cachedWorldValue(cache,'assembly/test',create,valid)).toEqual({health:20});
    expect(generated).toBe(1);
  });
});
